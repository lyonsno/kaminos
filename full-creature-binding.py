"""Provisional whole-tree automatic influence extension over the given creature."""
import argparse
import hashlib
import heapq
import json
import math
import time
from pathlib import Path
import numpy as np
from hindquarter_binding import bind_geometry,partial_rotation,JOINT_CHANNELS

def extend_weights(points,edges,rear_weights,bones):
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
        distance=np.full(len(points),np.inf);distance[seed]=0;queue=[(0.,seed)]
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
    if out==baseline or baseline in out.parents or out in [control_path.parent,frame_path.parent]:raise ValueError('output overlaps retained inputs')
    out.mkdir(parents=True,exist_ok=True);digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
    report={'status':'running','phase':'authentication','requestedInputs':vars(args),'output':str(out),'effectiveSolver':'numpy-given-tree-geodesic-dual-quaternion'}
    try:
        if digest(frame_path)!=args.expected_rig_frame_sha256 or digest(baseline/'manifest.json')!=args.expected_baseline_sha256:raise ValueError('given frame or baseline digest mismatch')
        control=json.loads(control_path.read_text());frame=json.loads(frame_path.read_text());old=json.loads((baseline/'manifest.json').read_text())
        if old['candidatePaintedWeights'] is not False or old['sourceSha256']!=control['sourceSha256'] or frame['source']['sourceSceneSha256']!=control['sourceSha256']:raise ValueError('source/candidate identity mismatch')
        if digest(control['geometry']['path'])!=control['geometry']['sha256']:raise ValueError('geometry digest mismatch')
        geom=np.load(control['geometry']['path'])
        if set(geom.files)!={'positions','triangles'}:raise ValueError('candidate includes painted fields')
        rest,triangles=geom['positions'],geom['triangles'];bones=frame['bones']
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
    finally:(out/'build-report.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['control','rig-frame','expected-rig-frame-sha256','baseline','expected-baseline-sha256','out']:parser.add_argument('--'+name,required=True)
    build(parser.parse_args())
