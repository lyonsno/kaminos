"""Rebind an immutable cast to a provisional fitted tree with the existing binder."""
import argparse,hashlib,importlib.util,json,sys,traceback
from pathlib import Path
import numpy as np
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def write(p,d):Path(p).write_text(json.dumps(d,indent=2)+'\n')
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def run(plan_path,out):
    if out.exists() and any(out.iterdir()):raise ValueError('use a new output directory; preserve previous evidence')
    out.mkdir(parents=True,exist_ok=True);report={'status':'failed','phase':'inputs','scriptSha256':sha(__file__)}
    try:
        plan=read(plan_path);config=read(plan['originalInputs']);source=Path(plan['originalBound']);manifest=read(source/'package/manifest.json');fit=read(plan['fit'])
        if sha(source/'package/manifest.json')!=plan['sourceManifestSha256'] or sha(plan['fit'])!=plan['fitSha256']:raise ValueError('source identity differs')
        for p,h in config['expected_sources'].items():
            if sha(p)!=h:raise ValueError('binder/source dependency changed: '+p)
        for name in ['rest.bin','triangles.bin']:
            if sha(source/'package'/name)!=manifest['assets'][name]['sha256']:raise ValueError('geometry changed')
        points=np.fromfile(source/'package/rest.bin',dtype='<f4').reshape(-1,3);triangles=np.fromfile(source/'package/triangles.bin',dtype='<u4').reshape(-1,3)
        bones=manifest['bones'];names=[b['name'] for b in bones];parents=[names.index(b['parent']) if b['parent'] else -1 for b in bones]
        q=np.asarray(fit['joints'],float)
        if q.shape!=(len(bones),3) or not np.isfinite(q).all() or fit['parents']!=parents or not fit['solver']['success']:raise ValueError('incomplete/unsolved fitted tree')
        original_positions=[np.asarray(b['restMatrix'])[:3,3].tolist() for b in bones]
        for i,b in enumerate(bones):
            m=np.eye(4);m[:3,3]=q[i];b['restMatrix']=m.tolist()
        adapter_path=next(p for p in config['expected_sources'] if p.endswith('reference-skin/prepare.py'));mapping=module('reference_aliases',adapter_path).aliases(names)
        semantic=[{**b,'name':mapping[b['name']],'parent':None if b['parent'] is None else mapping[b['parent']]} for b in bones]
        control={'paintedWeightsIncluded':False,'joints':{b['name']:np.asarray(b['restMatrix'])[:3,3].tolist() for b in semantic},'bounds':{'min':points.min(0).tolist(),'max':points.max(0).tolist()},'domainMethod':'surface','surfaceConnectivity':'coincident','articulated':True}
        report.update(phase='binding',planSha256=sha(plan_path),sourceManifestSha256=plan['sourceManifestSha256'],fitSha256=plan['fitSha256'],vertices=len(points),triangles=len(triangles),dependencies=config['expected_sources']);write(out/'report.json',report)
        sys.path[:0]=[config['binder'],config['trunk']];full=module('existing_binder',Path(config['binder'])/'full-creature-binding.py')
        rear=full.bind_geometry(points,triangles,control);result=full.distributed_trunk_weights(points,triangles,rear['edges'],rear['jointWeights'],semantic);weights=result['weights'].astype('<f4')
        if not np.isfinite(weights).all() or np.any(weights<0) or not np.allclose(weights.sum(1),1,atol=1e-6):raise ValueError('invalid partition')
        package=out/'package';package.mkdir();assets={}
        for name,array in [('rest.bin',points),('triangles.bin',triangles),('automatic-weights.bin',weights),('automatic-presets.bin',points[None])]:
            array.tofile(package/name);assets[name]={'sha256':sha(package/name),'bytes':(package/name).stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
        for name in ['rest.bin','triangles.bin']:
            if assets[name]['sha256']!=manifest['assets'][name]['sha256']:raise ValueError('cast geometry was modified')
        retarget={'schema':'kaminos.fitted-rest-motion.v1','method':'incoming-swing-local-deltas','jointNames':names,'sourceRestPositions':original_positions,'fitSourceSha256':plan['fitSha256']}
        frame=read(source/'rig-frame.json');frame.update(bones=bones,retarget=retarget);write(out/'rig-frame.json',frame)
        manifest.update(bones=bones,assets=assets,sourceArmature='Derived anatomical fit of official Cat43',bindingRule={k:v for k,v in result.items() if k not in ['weights','channels']},scope='Unchanged cast, provisional landmark-fitted skeleton and automatic weights; retained motion explicitly retargeted; no anatomical ground truth',fit=retarget)
        manifest['provenance'].update(originalManifestSha256=plan['sourceManifestSha256'],fitSha256=plan['fitSha256'],frameChainSha256=sha(out/'rig-frame.json'))
        write(package/'manifest.json',manifest)
        report.update(status='completed',phase='complete',manifestSha256=sha(package/'manifest.json'),frameSha256=sha(out/'rig-frame.json'),unknownVertices=len(result['unknownVertices']),maxPartitionError=float(np.max(abs(weights.sum(1)-1))),geometryByteIdentical=True)
    except Exception:
        report['error']=traceback.format_exc();write(out/'failure.json',report);raise
    finally:write(out/'report.json',report)
    print(json.dumps(report))
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--plan',type=Path,required=True);a.add_argument('--out',type=Path,required=True);args=a.parse_args();run(args.plan,args.out)
