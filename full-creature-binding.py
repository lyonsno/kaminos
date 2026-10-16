"""Provisional whole-tree automatic influence extension over the given creature."""
import argparse
import hashlib
import heapq
import json
import math
import time
import sys
from pathlib import Path
import numpy as np
from hindquarter_binding import bind_geometry,partial_rotation,JOINT_CHANNELS

OUTPUT_NAMES=('rest.bin','triangles.bin','automatic-weights.bin','automatic-presets.bin','manifest.json','build-report.json')

def protect_output_file(path,inputs):
    path=Path(path)
    if path.is_symlink():raise ValueError('output file alias (symlink): '+str(path))
    if path.exists() and path.stat().st_nlink>1:raise ValueError('output file alias (hardlink): '+str(path))
    for source in inputs:
        source=Path(source)
        if path.resolve()==source.resolve() or (path.exists() and source.exists() and path.samefile(source)):
            raise ValueError('output overlaps retained input: '+str(path))

def protect_outputs(out,inputs):
    for name in OUTPUT_NAMES:protect_output_file(Path(out)/name,inputs)

def referenced_paths(value):
    result=[]
    if isinstance(value,dict):
        if isinstance(value.get('path'),str):result.append(Path(value['path']))
        for child in value.values():result.extend(referenced_paths(child))
    elif isinstance(value,list):
        for child in value:result.extend(referenced_paths(child))
    return result

def protect_report_destination(report_path,out,inputs,paths_known):
    if not paths_known:raise ValueError('retained input paths unresolved; refusal report goes to stderr')
    protect_output_file(report_path,inputs)
    for name in OUTPUT_NAMES:
        if name!='build-report.json' and report_path.resolve()==(out/name).resolve():
            raise ValueError('report collides with generated package asset: '+name)

def validate_source_frame(control,frame,baseline,control_sha):
    if frame['source']['control']['sha256']!=control_sha:raise ValueError('control-frame source digest mismatch')
    if baseline['candidatePaintedWeights'] is not False or baseline['sourceSha256']!=control['sourceSha256'] or frame['source']['sourceSceneSha256']!=control['sourceSha256']:
        raise ValueError('source/candidate identity mismatch')
    if baseline['sourceCast']!=control['cast']:raise ValueError('cast source identity mismatch')

def extend_weights(points,edges,rear_weights,bones,seed_overrides=None):
    epsilon=np.finfo(rear_weights.dtype).eps*16
    if not np.isfinite(rear_weights).all() or rear_weights.min() < -epsilon or not np.allclose(rear_weights.sum(axis=1),1,rtol=0,atol=epsilon):
        raise ValueError('invalid automatic rear partition')
    # Source arithmetic produced at most one-ulp overfull/negative residuals.
    # Normalize that numeric roundoff, but reject a materially invalid partition.
    rear_weights=np.maximum(rear_weights,0);rear_weights/=rear_weights.sum(axis=1)[:,None]
    names=[b['name'] for b in bones];channels=['fixed']+names
    if len(set(names))!=len(names) or 'pelvis' not in names:raise ValueError('invalid given tree')
    heads={b['name']:np.asarray(b['restMatrix'])[:3,3] for b in bones}
    adjacency=[[] for _ in points]
    for (a,b),length in zip(edges,np.linalg.norm(points[edges[:,1]]-points[edges[:,0]],axis=1)):
        adjacency[a].append((int(b),float(length)));adjacency[b].append((int(a),float(length)))
    seeds={};distances=[]
    for name in names:
        target=heads[name].copy()
        children=[b['name'] for b in bones if b['parent']==name]
        chain=[c for c in children if name.startswith('forelimb-') and c.startswith(name.split('-')[0]+'-'+name.split('-')[1]+'-')]
        if chain:
            target+=.55*(heads[chain[0]]-target)
            side='left' if '-left-' in name else 'right'
            other=name.replace('-'+side+'-','-'+('right' if side=='left' else 'left')+'-')
            if other in heads:
                lateral=heads[name]-heads[other];lateral/=max(np.linalg.norm(lateral),1e-12);target+=.10*lateral
        seed=int(np.argmin(np.sum((points-target)**2,axis=1)));seeds[name]=seed
        sources={seed}
        if seed_overrides and name in seed_overrides:
            extra=seed_overrides[name]
            if not extra or any(not isinstance(i,(int,np.integer)) or i<0 or i>=len(points) for i in extra):raise ValueError('invalid additional trunk seed')
            sources.update(int(i) for i in extra)
        distance=np.full(len(points),np.inf);queue=[]
        for source in sorted(sources):distance[source]=0;heapq.heappush(queue,(0.,source))
        while queue:
            value,index=heapq.heappop(queue)
            if value!=distance[index]:continue
            for neighbor,length in adjacency[index]:
                proposed=value+length
                if proposed<distance[neighbor]:distance[neighbor]=proposed;heapq.heappush(queue,(proposed,neighbor))
        distances.append(distance)
    distances=np.asarray(distances).T
    weights=np.zeros((len(points),len(channels)))
    rear_names=JOINT_CHANNELS[2:]
    rear_total=rear_weights[:,2:].sum(axis=1)
    for old_index,name in enumerate(JOINT_CHANNELS[2:],2):
        if name in names:weights[:,channels.index(name)]=rear_weights[:,old_index]
        elif np.any(rear_weights[:,old_index]>0):raise ValueError('given tree missing active rear control')
    body=[i for i,name in enumerate(names) if name not in rear_names]
    body_dist=distances[:,body];known=np.isfinite(body_dist).any(axis=1)
    nearest=np.min(body_dist[known],axis=1)
    affinity=np.exp(-(body_dist[known]-nearest[:,None])/.18);affinity/=affinity.sum(axis=1)[:,None]
    weights[np.ix_(known,np.asarray(body)+1)]+=(1-rear_total[known,None])*affinity
    weights[~known,channels.index('pelvis')]+=1-rear_total[~known]
    # Added paw controls refine the existing hock share, preserving its total.
    for side in ['left','right']:
        hock=f'hindlimb-{side}-hock';toe=f'hindlimb-{side}-toe'
        if hock not in names or toe not in names:continue
        d=distances[:,[names.index(hock),names.index(toe)]];reached=np.isfinite(d).any(axis=1)
        minimum=np.min(d[reached],axis=1);a=np.exp(-(d[reached]-minimum[:,None])/.18);a/=a.sum(axis=1)[:,None]
        share=weights[reached,channels.index(hock)].copy();weights[reached,channels.index(hock)]=share*a[:,0]
        weights[reached,channels.index(toe)]+=share*a[:,1]
    unknown=np.flatnonzero(~np.isfinite(distances).any(axis=1))
    weights[unknown]=0;weights[unknown,channels.index('pelvis')]=1
    if not np.isfinite(weights).all() or weights.min() < -epsilon or not np.allclose(weights.sum(axis=1),1,rtol=0,atol=epsilon):
        raise ValueError(f'incomplete full-tree partition: min={weights.min()}, sums={weights.sum(axis=1).min()}/{weights.sum(axis=1).max()}, rear={rear_total.min()}/{rear_total.max()}')
    weights=np.maximum(weights,0);weights/=weights.sum(axis=1)[:,None]
    return {'weights':weights,'channels':channels,'seeds':seeds,'unknownVertices':unknown.tolist(),
            'bodyUnreachedVertices':np.flatnonzero(~known).tolist(),
            'rule':'given-rig surface-geodesic body assignment plus retained automatic rear mobility; hock-toe refinement; no paint',
            'blendFemurs':.18,'unknownPolicy':'explicit unseeded components carried by pelvis, not declared anatomically attached'}

def distributed_trunk_weights(points,triangles,edges,rear_weights,bones):
    from trunk_anchors import derive_trunk_anchors
    seeds,receipt=derive_trunk_anchors(points,triangles,bones)
    result=extend_weights(points,edges,rear_weights,bones,seed_overrides=seeds)
    result['trunkAnchors']=receipt
    return result

def rebind_complete_paws(points,edges,baseline,original_bones,candidate_bones):
    """Repartition only four distal parent/toe shares; endpoint channels stay zero.

    This is the source28 -> complete-paw32 intervention, not a general tree
    retargeter. Existing trunk, head, tail and proximal influences stay exact.
    """
    old={b['name']:b for b in original_bones};new={b['name']:b for b in candidate_bones}
    toes=[f'{limb}-{side}-toe' for limb in ['hindlimb','forelimb'] for side in ['left','right']]
    endpoints=[name+'-end' for name in toes]
    if (len(original_bones)!=28 or len(old)!=28 or len(candidate_bones)!=32 or len(new)!=32
            or not set(toes).issubset(old) or set(new)!=set(old)|set(endpoints)):
        raise ValueError('complete-paw route requires the retained28 and four terminal toe endpoints')
    for name,bone in new.items():
        matrix=np.asarray(bone['restMatrix'],dtype=float)
        if (matrix.shape!=(4,4) or not np.isfinite(matrix).all()
                or not np.array_equal(matrix[3],[0,0,0,1])
                or not np.allclose(matrix[:3,:3].T@matrix[:3,:3],np.eye(3),atol=1e-7)
                or np.linalg.det(matrix[:3,:3])<=0):
            raise ValueError('invalid complete-paw rest frame')
        if name in old:
            previous=np.asarray(old[name]['restMatrix'],dtype=float)
            if bone['parent']!=old[name]['parent'] or not np.allclose(matrix[:3,:3],previous[:3,:3],rtol=0,atol=1e-7):
                raise ValueError('complete-paw edit changed an existing parent or orientation')
            if name not in toes and not np.allclose(matrix,previous,rtol=0,atol=1e-7):
                raise ValueError('complete-paw edit changed an unrelated rest frame')
        else:
            toe=name[:-4]
            if (bone['parent']!=toe or any(b['parent']==name for b in candidate_bones)
                    or not np.allclose(matrix[:3,:3],np.asarray(new[toe]['restMatrix'])[:3,:3],rtol=0,atol=1e-7)):
                raise ValueError('added paw joint is not the matching terminal endpoint')
    for toe in toes:
        parent=toe.rsplit('-',1)[0]+('-hock' if toe.startswith('hindlimb-') else '-wrist')
        if old[toe]['parent']!=parent:raise ValueError('unexpected paw parent')
        a=np.asarray(new[toe]['restMatrix'])[:3,3];b=np.asarray(new[toe+'-end']['restMatrix'])[:3,3]
        if np.linalg.norm(b-a)<1e-8:raise ValueError('degenerate paw segment')
    points=np.asarray(points,dtype=float);edges=np.asarray(edges);baseline=np.asarray(baseline)
    old_channels=['fixed']+[b['name'] for b in original_bones];channels=['fixed']+[b['name'] for b in candidate_bones]
    if points.ndim!=2 or points.shape[1]!=3 or not np.isfinite(points).all():raise ValueError('invalid paw geometry')
    if edges.ndim!=2 or edges.shape[1]!=2 or not np.issubdtype(edges.dtype,np.integer) or (edges<0).any() or (edges>=len(points)).any():raise ValueError('invalid paw surface graph')
    if (baseline.shape!=(len(points),len(old_channels)) or not np.isfinite(baseline).all()
            or (baseline<0).any() or not np.allclose(baseline.sum(axis=1),1,rtol=0,atol=1e-6)):
        raise ValueError('invalid accepted influence partition')
    weights=np.zeros((len(points),len(channels)),dtype=baseline.dtype)
    for i,name in enumerate(old_channels):weights[:,channels.index(name)]=baseline[:,i]
    adjacency=[[] for _ in points]
    for (a,b),length in zip(edges,np.linalg.norm(points[edges[:,1]]-points[edges[:,0]],axis=1)):
        adjacency[a].append((int(b),float(length)));adjacency[b].append((int(a),float(length)))
    def distance(seed):
        values=np.full(len(points),np.inf);values[seed]=0;queue=[(0.,seed)]
        while queue:
            value,index=heapq.heappop(queue)
            if value!=values[index]:continue
            for neighbor,length in adjacency[index]:
                proposed=value+length
                if proposed<values[neighbor]:values[neighbor]=proposed;heapq.heappush(queue,(proposed,neighbor))
        return values
    receipts=[];changed=set()
    for toe in toes:
        parent=old[toe]['parent'];names=[parent,toe];changed.update(names)
        head=lambda name:np.asarray(new[name]['restMatrix'])[:3,3]
        targets=[head(parent),head(toe)+.55*(head(toe+'-end')-head(toe))]
        seeds=[int(np.argmin(np.sum((points-target)**2,axis=1))) for target in targets]
        distances=np.column_stack([distance(seed) for seed in seeds]);known=np.isfinite(distances).any(axis=1)
        minimum=distances[known].min(axis=1);affinity=np.exp(-(distances[known]-minimum[:,None])/.18)
        affinity/=affinity.sum(axis=1)[:,None]
        indices=[channels.index(n) for n in names];share=baseline[:,[old_channels.index(n) for n in names]].astype(float).sum(axis=1)
        weights[np.ix_(known,indices)]=(share[known,None]*affinity).astype(baseline.dtype)
        receipts.append({'toe':toe,'parent':parent,'endpoint':toe+'-end','seeds':seeds,'targets':[t.tolist() for t in targets],
                         'coincidentSeeds':seeds[0]==seeds[1],
                         'unreachedActiveVertices':np.flatnonzero(~known&(share>0)).tolist()})
    unchanged=[n for n in old_channels if n not in changed]
    if not np.isfinite(weights).all() or (weights<0).any() or not np.allclose(weights.sum(axis=1),baseline.sum(axis=1),rtol=0,atol=1e-6):
        raise ValueError('incomplete corrected-paw partition')
    return {'weights':weights,'channels':channels,'unchangedChannels':unchanged,'zeroInfluenceEndpoints':endpoints,'paws':receipts,
            'rule':'preserve accepted non-paw influences; geodesic distal-parent/toe repartition with conserved per-vertex pair share',
            'blendFemurs':.18,'unreachedPolicy':'preserve prior pair partition and report active vertices; no new attachment claim'}

def preserve_nontrunk_channels(proposed,baseline,channels):
    proposed=np.asarray(proposed);baseline=np.asarray(baseline)
    if proposed.shape!=baseline.shape or baseline.ndim!=2 or baseline.shape[1]!=len(channels):raise ValueError('comparison influence shape mismatch')
    if not np.isfinite(proposed).all() or not np.isfinite(baseline).all() or (proposed<0).any() or (baseline<0).any():raise ValueError('invalid comparison influences')
    target=[i for i,n in enumerate(channels) if n in ['pelvis','spine-lumbar','spine-chest'] or n.startswith('forelimb-')]
    untouched=[i for i in range(len(channels)) if i not in target]
    share=baseline[:,target].astype(float).sum(axis=1)
    affinity=proposed[:,target].astype(float);total=affinity.sum(axis=1)
    result=baseline.copy();known=total>0
    result[np.ix_(known,target)]=(affinity[known]*share[known,None]/total[known,None]).astype(baseline.dtype)
    if not np.array_equal(result[:,untouched],baseline[:,untouched]) or not np.allclose(result.sum(axis=1),baseline.sum(axis=1),atol=1e-6):raise ValueError('nontrunk preservation failed')
    return result

def palette(bones,pose):
    rest={b['name']:np.asarray(b['restMatrix']) for b in bones};world={};result=[np.eye(4)]
    for b in bones:
        n=b['name'];local=np.linalg.inv(rest[b['parent']])@rest[n] if b['parent'] else rest[n].copy()
        q=pose.get(n,[1.,0,0,0]);w,x,y,z=q
        delta=np.eye(4);delta[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],
            [2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
        world[n]=(world[b['parent']]@local if b['parent'] else local)@delta
        result.append(world[n]@np.linalg.inv(rest[n]))
    return np.asarray(result)

def build(args):
    out=Path(args.out).resolve();control_path=Path(args.control).resolve();frame_path=Path(args.rig_frame).resolve();baseline=Path(args.baseline).resolve()
    inputs=[control_path,frame_path,baseline/'manifest.json']+[baseline/name for name in OUTPUT_NAMES]
    report_path=Path(getattr(args,'report',None) or out/'build-report.json').absolute()
    digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
    paths_known=False
    report={'status':'running','phase':'source-path-discovery','requestedInputs':vars(args),'output':str(out),'effectiveSolver':'numpy-given-tree-geodesic-dual-quaternion'}
    try:
        # Parse only to discover protected paths. This grants no input authority.
        # Complete this before any refusal can write a report destination.
        control=json.loads(control_path.read_text());frame=json.loads(frame_path.read_text());old=json.loads((baseline/'manifest.json').read_text())
        inputs.extend(referenced_paths(control));inputs.extend(referenced_paths(frame))
        inputs.extend(baseline/name for name in old.get('assets',{}))
        paths_known=True;report['phase']='output-protection'
        if out==baseline or baseline in out.parents or out in [control_path.parent,frame_path.parent]:raise ValueError('output overlaps retained inputs')
        protect_outputs(out,inputs);protect_report_destination(report_path,out,inputs,paths_known)
        out.mkdir(parents=True,exist_ok=True);report['phase']='authentication'
        if digest(frame_path)!=args.expected_rig_frame_sha256 or digest(baseline/'manifest.json')!=args.expected_baseline_sha256:raise ValueError('given frame or baseline digest mismatch')
        validate_source_frame(control,frame,old,digest(control_path))
        if digest(control['geometry']['path'])!=control['geometry']['sha256']:raise ValueError('geometry digest mismatch')
        geom=np.load(control['geometry']['path'])
        if set(geom.files)!={'positions','triangles'}:raise ValueError('candidate includes painted fields')
        rest,triangles=geom['positions'],geom['triangles'];bones=frame['bones']
        for name,array,dtype in [('rest.bin',rest.astype('<f4'),'<f4'),('triangles.bin',triangles.astype('<u4'),'<u4')]:
            path=baseline/name;asset=old['assets'][name]
            if digest(path)!=asset['sha256'] or not np.array_equal(np.fromfile(path,dtype=dtype).reshape(array.shape),array):
                raise ValueError('whole-tree input changed accepted geometry: '+name)
        if len(bones)!=28:raise ValueError('given full tree is not the28-joint source')
        report['phase']='automatic-influences';start=time.monotonic()
        binding=bind_geometry(rest,triangles,{**control,'domainMethod':'surface','surfaceConnectivity':'coincident','articulated':True})
        extended=extend_weights(rest,binding['edges'],binding['jointWeights'],bones);report['bindingSeconds']=time.monotonic()-start
        qx=lambda degrees:[math.cos(math.radians(degrees)/2),math.sin(math.radians(degrees)/2),0,0]
        presets=[{'name':p['name'],'poseWxyz':p['poseWxyz']} for p in old['presets']]
        old_names={b['name'] for b in old['bones']}
        for b in bones:
            if b['name'] not in old_names:presets.append({'name':b['name'],'poseWxyz':{b['name']:qx(20)}})
        presets.append({'name':'root-turn','poseWxyz':{'pelvis':[math.cos(math.pi/12),0,0,math.sin(math.pi/12)]}})
        presets.append({'name':'full-crouch','poseWxyz':{**old['presets'][-1]['poseWxyz'],
            'forelimb-left-shoulder':qx(20),'forelimb-left-elbow':qx(35),'forelimb-left-wrist':qx(-20),
            'forelimb-right-shoulder':qx(-15),'forelimb-right-elbow':qx(25),'forelimb-right-wrist':qx(-10),
            'spine-chest':qx(10),'neck':qx(-10),'tail-1':qx(15),'tail-2':qx(15)}})
        automatic=[]
        for p in presets:
            matrices=palette(bones,p['poseWxyz']);p['palette']=matrices.tolist()
            automatic.append(partial_rotation(rest,matrices,extended['weights']))
        automatic=np.asarray(automatic,dtype='<f4')
        asset=old['assets']['automatic-presets.bin'];baseline_path=baseline/'automatic-presets.bin'
        if digest(baseline_path)!=asset['sha256']:raise ValueError('automatic baseline digest mismatch')
        prior=np.fromfile(baseline_path,dtype='<f4').reshape(len(old['presets']),len(rest),3)
        baseline_errors=[{'name':p['name'],'maxError':float(np.max(np.abs(automatic[i]-prior[i]))),
            'rmsError':float(np.sqrt(np.mean((automatic[i]-prior[i])**2)))} for i,p in enumerate(old['presets'])]
        arrays={'rest.bin':rest.astype('<f4'),'triangles.bin':triangles.astype('<u4'),
                'automatic-weights.bin':extended['weights'].astype('<f4'),'automatic-presets.bin':automatic}
        assets={}
        for name,array in arrays.items():
            path=out/name;array.tofile(path);assets[name]={'sha256':digest(path),'bytes':path.stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
        manifest={'schema':'kaminos.live-transport.v3','status':'completed','sourceSha256':control['sourceSha256'],'sourceCast':control['cast'],
            'sourceArmature':'given28-joint tree','vertices':len(rest),'triangles':len(triangles),'bones':bones,
            'channels':extended['channels'],'presets':presets,'assets':assets,'candidatePaintedWeights':False,
            'reference':{'kind':'none','reason':'Whole-body automatic prototype; source paint does not provide a full-body reference'},
            'bindingRule':{k:v for k,v in extended.items() if k not in ['weights','channels']},
            'provenance':{'packageSha256':args.expected_baseline_sha256,'rigSourceSha256':control['sourceSha256'],'frameChainSha256':args.expected_rig_frame_sha256},
            'acceptedRearBaselineComparison':baseline_errors,'scope':'provisional given-tree full-body posing; not generated-motion, muscle simulation or anatomical attachment admission'}
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2))
        report.update(status='completed',phase='completed',manifestSha256=digest(out/'manifest.json'),bones=len(bones),presets=len(presets),
            unknownVertices=len(extended['unknownVertices']),acceptedRearBaselineComparison=baseline_errors)
    except Exception as error:report.update(status='failed',error=str(error));raise
    finally:
        # An unsafe report path must not turn a refusal into an input overwrite.
        # Callers can choose an independent --report path for durable refusal.
        try:protect_report_destination(report_path,out,inputs,paths_known)
        except ValueError as error:
            report['reportWriteRefused']=str(error)
            print(json.dumps(report),file=sys.stderr)
        else:
            report_path.parent.mkdir(parents=True,exist_ok=True)
            report_path.write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['control','rig-frame','expected-rig-frame-sha256','baseline','expected-baseline-sha256','out']:parser.add_argument('--'+name,required=True)
    parser.add_argument('--report',help='Independent report destination; use outside output directory to retain alias-refusal evidence')
    build(parser.parse_args())
