"""Same given rig and motion; point versus distributed trunk attachment per cast."""
import argparse
import hashlib
import importlib.util
import json
import sys
import time
from pathlib import Path
import numpy as np
from hindquarter_binding import bind_geometry,partial_rotation,JOINT_CHANNELS
spec=importlib.util.spec_from_file_location('full_binding',Path(__file__).with_name('full-creature-binding.py'))
full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)
digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def build(args):
    inputs_path=Path(args.inputs).resolve();out=Path(args.out).resolve();report_path=Path(args.report).absolute()
    report={'status':'running','phase':'path-discovery','requested':vars(args),'effectiveSolver':'given-rig-geodesic-point-vs-ray-distributed-axial','casts':[]}
    protected=[inputs_path];leaves=[];paths_known=False
    try:
        state=json.loads(inputs_path.read_text())
        if state.get('schema')!='kaminos.trunk-multicast-inputs.v1':raise ValueError('unknown input state')
        protected+=full.referenced_paths(state)
        frame=json.loads(Path(state['rigFrame']['path']).read_text());control=json.loads(Path(state['control']['path']).read_text())
        template=json.loads(Path(state['poseTemplate']['path']).read_text())
        protected+=full.referenced_paths(frame)+full.referenced_paths(control)
        source_cases=[]
        for c in state['casts']:
            root=Path(c['sourceCase']['path']).resolve();m=json.loads((root/'manifest.json').read_text());source_cases.append((c,root,m))
            protected+=[root/'manifest.json']+[root/n for n in m['assets']]
            if (root/'frame-chain.json').exists():protected.append(root/'frame-chain.json')
            if not c['slug'].replace('-','').isalnum():raise ValueError('invalid output slug')
            leaves.extend(out/(c['slug']+'-'+mode) for mode in ['point','distributed'])
        paths_known=True;report['phase']='output-protection'
        if report_path.resolve()==out/'catalog.json':raise ValueError('report collides with catalog')
        full.protect_output_file(out/'catalog.json',protected)
        for leaf in leaves:
            full.protect_outputs(leaf,protected);full.protect_report_destination(report_path,leaf,protected,True)
            if leaf.exists() and any(leaf.iterdir()):raise ValueError('retain prior nonempty package: '+str(leaf))
        report['phase']='authentication'
        if not source_cases:raise ValueError('empty comparison cohort')
        for name in ['rigFrame','control','poseTemplate','motion']:
            if digest(state[name]['path'])!=state[name]['sha256']:raise ValueError(name+' digest mismatch')
        if frame['schema']!='kaminos.full-given-rig-frame.v1' or len(frame['bones'])!=28:raise ValueError('not the retained given28 rig')
        if frame['source']['control']['sha256']!=state['control']['sha256'] or frame['source']['sourceSceneSha256']!=control['sourceSha256']:raise ValueError('control-frame mismatch')
        bones=frame['bones'];channels=['fixed']+[b['name'] for b in bones];presets=template['presets'];catalog=[]
        for c,root,m in source_cases:
            if digest(root/'manifest.json')!=c['sourceCase']['sha256']:raise ValueError('case digest mismatch')
            if m['schema'] not in ['kaminos.live-transport.v2','kaminos.live-transport.v3'] or m['candidatePaintedWeights'] is not False:raise ValueError('not an unpainted variable/full case')
            if m['provenance']['rigSourceSha256']!=control['sourceSha256']:raise ValueError('case rig source mismatch')
            for b in m['bones']:
                target=next((x for x in bones if x['name']==b['name']),None)
                if target is None or b['parent']!=target['parent'] or not np.allclose(b['restMatrix'],target['restMatrix'],rtol=0,atol=1e-5):raise ValueError('case rest-frame mismatch')
            if m['schema'].endswith('v2'):
                if digest(root/'frame-chain.json')!=m['provenance']['frameChainSha256']:raise ValueError('cast bridge digest mismatch')
                bridge=json.loads((root/'frame-chain.json').read_text())
                if any(x['residualSourceUnits']>1e-4 for x in bridge['anchorMapping']):raise ValueError('cast anchor bridge mismatch')
            elif m['provenance']['frameChainSha256']!=state['rigFrame']['sha256']:raise ValueError('full case frame mismatch')
            def array(name,dtype):
                asset=m['assets'][name];p=root/name
                if digest(p)!=asset['sha256'] or p.stat().st_size!=asset['bytes']:raise ValueError('source asset mismatch '+name)
                return np.fromfile(p,dtype=dtype).reshape(asset['shape'])
            rest=array('rest.bin','<f4');triangles=array('triangles.bin','<u4');prior=array('automatic-weights.bin','<f4')
            if len(rest)!=m['vertices'] or len(triangles)!=m['triangles']:raise ValueError('source geometry count mismatch')
            report['phase']='binding-'+c['slug'];start=time.monotonic()
            # Borrow the already reviewed exact-coincidence graph, not its newly recomputed rear weights.
            graph=bind_geometry(rest,triangles,{**control,'bounds':{'min':rest.min(axis=0).tolist(),'max':rest.max(axis=0).tolist()},'domainMethod':'surface','surfaceConnectivity':'coincident','articulated':False})
            if m['schema'].endswith('v3'):
                if m['channels']!=channels:raise ValueError('full channel inventory mismatch')
                baseline=prior.copy();rear=np.zeros((len(rest),8))
                for j,n in enumerate(JOINT_CHANNELS[2:],2):
                    rear[:,j]=baseline[:,channels.index(n)]
                    if n.endswith('-hock'):rear[:,j]+=baseline[:,channels.index(n.replace('-hock','-toe'))]
                rear[:,0]=1-rear[:,2:].sum(axis=1)
                rear=np.maximum(rear,0);rear/=rear.sum(axis=1)[:,None]
            else:
                if m['channels']!=JOINT_CHANNELS:raise ValueError('rear channel inventory mismatch')
                rear=prior;baseline=full.extend_weights(rest,graph['edges'],rear,bones)['weights'].astype('<f4')
            proposal=full.distributed_trunk_weights(rest,triangles,graph['edges'],rear,bones)
            candidate=full.preserve_nontrunk_channels(proposal['weights'],baseline,channels)
            targets=[i for i,n in enumerate(channels) if n in ['pelvis','spine-lumbar','spine-chest'] or n.startswith('forelimb-')]
            unchanged=[i for i in range(len(channels)) if i not in targets]
            if not np.array_equal(candidate[:,unchanged],baseline[:,unchanged]):raise ValueError('unrelated channel changed')
            row={'slug':c['slug'],'label':c['label'],'sourceCase':c['sourceCase'],'sourceCast':m['sourceCast'],'vertices':len(rest),'triangles':len(triangles),'bindingSeconds':time.monotonic()-start,'trunkAnchors':proposal['trunkAnchors'],'unchangedChannels':[channels[i] for i in unchanged],'packages':[]}
            for mode,weights in [('point',baseline),('distributed',candidate)]:
                leaf=out/(c['slug']+'-'+mode);leaf.mkdir(parents=True,exist_ok=True)
                arrays={'rest.bin':rest,'triangles.bin':triangles,'automatic-weights.bin':weights.astype('<f4'),
                        'automatic-presets.bin':np.asarray([partial_rotation(rest,full.palette(bones,p['poseWxyz']),weights) for p in presets],dtype='<f4')}
                assets={}
                for n,a in arrays.items():
                    p=leaf/n;a.tofile(p);assets[n]={'sha256':digest(p),'bytes':p.stat().st_size,'shape':list(a.shape),'dtype':a.dtype.str}
                for n in ['rest.bin','triangles.bin']:
                    if assets[n]['sha256']!=m['assets'][n]['sha256']:raise ValueError('geometry bytes changed')
                manifest={'schema':'kaminos.live-transport.v3','status':'completed','sourceSha256':m['sourceSha256'],'sourceCast':m['sourceCast'],
                          'sourceArmature':'same retained given28 tree','vertices':len(rest),'triangles':len(triangles),'bones':bones,'channels':channels,'presets':presets,'assets':assets,'candidatePaintedWeights':False,
                          'reference':{'kind':'none','reason':'Automatic point-versus-distributed comparison; no full-body expert-painted reference'},
                          'bindingRule':{'kind':'point-geodesic' if mode=='point' else 'distributed-axial-geodesic','blendFemurs':.18,'trunkAnchors':proposal['trunkAnchors'] if mode=='distributed' else None,'unchangedChannels':row['unchangedChannels']},
                          'provenance':{'packageSha256':c['sourceCase']['sha256'],'rigSourceSha256':control['sourceSha256'],'frameChainSha256':state['rigFrame']['sha256'],'castFrameChainSha256':m['provenance']['frameChainSha256']},
                          'scope':'provisional automatic attachment comparison; fixed rig/geometry/motion; no packing or anatomical admission'}
                (leaf/'manifest.json').write_text(json.dumps(manifest,indent=2));row['packages'].append({'mode':mode,'path':str(leaf),'sha256':digest(leaf/'manifest.json')})
            report['casts'].append(row);catalog.append(row)
        out.mkdir(parents=True,exist_ok=True);(out/'catalog.json').write_text(json.dumps({'status':'completed','inputs':str(inputs_path),'casts':catalog,'motion':state['motion'],'rigFrame':state['rigFrame']},indent=2))
        report.update(status='completed',phase='completed',catalog=str(out/'catalog.json'))
    except Exception as error:report.update(status='failed',error=str(error));raise
    finally:
        try:
            if not paths_known:raise ValueError('protected paths unresolved')
            for leaf in leaves:full.protect_report_destination(report_path,leaf,protected,True)
            if report_path.resolve()==out/'catalog.json':raise ValueError('report collides with catalog')
        except ValueError as error:
            report['reportWriteRefused']=str(error);print(json.dumps(report),file=sys.stderr)
        else:report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2))
    print(json.dumps({'status':report['status'],'phase':report['phase'],'casts':[{'slug':c['slug'],'packages':c['packages']} for c in report['casts']]}))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for n in ['inputs','out','report']:parser.add_argument('--'+n,required=True)
    build(parser.parse_args())
