"""Rebind only corrected distal paw shares on authenticated existing casts."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import sys
import numpy as np

spec=importlib.util.spec_from_file_location('full_binding',Path(__file__).with_name('full-creature-binding.py'))
full=importlib.util.module_from_spec(spec);spec.loader.exec_module(full)
digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()

def graph(points,triangles):
    edges=np.unique(np.sort(np.concatenate([triangles[:,[0,1]],triangles[:,[1,2]],triangles[:,[2,0]]]),axis=1),axis=0)
    # Same exact-coincidence virtual links as the accepted surface binder.
    # No geometry/index welding or near-coincidence threshold is introduced.
    _,first,inverse=np.unique(points,axis=0,return_index=True,return_inverse=True)
    representative=first[inverse];copies=np.flatnonzero(representative!=np.arange(len(points)))
    if len(copies):edges=np.concatenate([edges,np.column_stack([copies,representative[copies]])])
    return edges,len(copies)

def build(args):
    state_path=Path(args.inputs).resolve();out=Path(args.out).resolve();report_path=Path(args.report).absolute()
    protected=[state_path];roots=[];leaves=[];known=False
    report={'status':'running','phase':'path-discovery','requested':vars(args),'effectiveSolver':'accepted-surface-geodesic-distal-pair-repartition','casts':[]}
    try:
        state=json.loads(state_path.read_text());protected+=full.referenced_paths(state)
        if state.get('schema')!='kaminos.complete-paw-bind-inputs.v1':raise ValueError('unknown corrected-paw inputs')
        original=json.loads(Path(state['originalFrame']['path']).read_text());candidate=json.loads(Path(state['candidateFrame']['path']).read_text())
        protected+=full.referenced_paths(original)+full.referenced_paths(candidate)
        sources=[];slugs=set()
        for row in state['casts']:
            slug=row['slug'];root=Path(row['sourceCase']['path']).resolve()
            if not isinstance(slug,str) or not slug.replace('-','').isalnum() or slug in slugs:raise ValueError('invalid/duplicate cast slug')
            slugs.add(slug);roots.append(root);manifest=json.loads((root/'manifest.json').read_text())
            protected+=[root/'manifest.json']+[root/name for name in manifest['assets']]
            leaves.append(out/slug);sources.append((row,root,manifest))
        known=True;report['phase']='output-protection'
        if out.exists() and any(out.iterdir()):raise ValueError('preserve nonempty output root')
        if any(out==root or root in out.parents or report_path.resolve()==root or root in report_path.resolve().parents for root in roots):raise ValueError('output overlaps retained cast directory')
        full.protect_output_file(out/'catalog.json',protected);full.protect_output_file(report_path,protected)
        if report_path.resolve()==out/'catalog.json':raise ValueError('report collides with catalog')
        for leaf in leaves:
            full.protect_outputs(leaf,protected);full.protect_report_destination(report_path,leaf,protected,True)
        report['phase']='authentication'
        for key in ['originalFrame','candidateFrame','candidatePlan']:
            if digest(state[key]['path'])!=state[key]['sha256']:raise ValueError(key+' digest mismatch')
        for frame in [original,candidate]:
            for entry in frame['source'].values():
                if isinstance(entry,dict) and 'path' in entry and 'sha256' in entry and digest(entry['path'])!=entry['sha256']:raise ValueError('frame source chain digest mismatch')
        if candidate['source']['originalFrame']['sha256']!=state['originalFrame']['sha256'] or candidate['source']['plan']['sha256']!=state['candidatePlan']['sha256']:raise ValueError('candidate frame lineage mismatch')
        if original['source']['sourceSceneSha256']!=candidate['source']['sourceSceneSha256']:raise ValueError('candidate source scene mismatch')
        if not sources:raise ValueError('empty cast cohort')
        report['inputs']={str(p):digest(p) for p in protected if p.is_file()}
        bones=candidate['bones'];presets=[{'name':'neutral','poseWxyz':{}}]
        for limb in ['hindlimb','forelimb']:
            for side in ['left','right']:
                for degrees in [-25,25]:
                    angle=math.radians(degrees)/2
                    presets.append({'name':f'{limb}-{side}-toe-{degrees:+d}','poseWxyz':{f'{limb}-{side}-toe':[math.cos(angle),math.sin(angle),0,0]}})
        for row,root,m in sources:
            report['phase']='binding-'+row['slug']
            if digest(root/'manifest.json')!=row['sourceCase']['sha256']:raise ValueError('source case digest mismatch')
            if m['schema']!='kaminos.live-transport.v3' or m['candidatePaintedWeights'] is not False or m['provenance']['frameChainSha256']!=state['originalFrame']['sha256'] or m['provenance']['rigSourceSha256']!=original['source']['sourceSceneSha256']:raise ValueError('not the authenticated accepted full-body source')
            if m['channels']!=['fixed']+[b['name'] for b in m['bones']]:raise ValueError('source influence order mismatch')
            if m['bones']!=original['bones']:raise ValueError('source cast/frame bone records differ')
            arrays={}
            for name,dtype in [('rest.bin','<f4'),('triangles.bin','<u4'),('automatic-weights.bin','<f4')]:
                asset=m['assets'][name];path=root/name
                if digest(path)!=asset['sha256'] or path.stat().st_size!=asset['bytes'] or asset['dtype']!=dtype:raise ValueError('source asset identity mismatch: '+name)
                arrays[name]=np.fromfile(path,dtype=dtype).reshape(asset['shape'])
            points=arrays['rest.bin'];triangles=arrays['triangles.bin'];baseline=arrays['automatic-weights.bin']
            if points.shape!=(m['vertices'],3) or triangles.shape!=(m['triangles'],3) or (triangles>=len(points)).any():raise ValueError('invalid source geometry')
            edges,seams=graph(points,triangles)
            bound=full.rebind_complete_paws(points,edges,baseline,m['bones'],bones)
            posed=[]
            for preset in presets:
                matrices=full.palette(bones,preset['poseWxyz']);preset['palette']=matrices.tolist()
                posed.append(full.partial_rotation(points,matrices,bound['weights']))
            leaf=out/row['slug'];leaf.mkdir(parents=True,exist_ok=False)
            result={'rest.bin':points,'triangles.bin':triangles,'automatic-weights.bin':bound['weights'].astype('<f4'),'automatic-presets.bin':np.asarray(posed,dtype='<f4')}
            assets={}
            for name,array in result.items():
                path=leaf/name;array.tofile(path);assets[name]={'sha256':digest(path),'bytes':path.stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
            if any(assets[n]['sha256']!=m['assets'][n]['sha256'] for n in ['rest.bin','triangles.bin']):raise ValueError('source geometry bytes changed')
            binding_rule={key:value for key,value in bound.items() if key not in ['weights','channels']}
            manifest={'schema':'kaminos.live-transport.v3','status':'completed','sourceSha256':m['sourceSha256'],'sourceCast':m['sourceCast'],'sourceArmature':'separate complete-paw32 candidate','vertices':len(points),'triangles':len(triangles),'bones':bones,'channels':bound['channels'],'presets':presets,'assets':assets,'candidatePaintedWeights':False,'reference':{'kind':'none','reason':'Changed toe pivots invalidate old painted pose comparisons'},'bindingRule':binding_rule,'provenance':{'packageSha256':row['sourceCase']['sha256'],'rigSourceSha256':m['provenance']['rigSourceSha256'],'frameChainSha256':state['candidateFrame']['sha256'],'originalFrameSha256':state['originalFrame']['sha256'],'candidatePlanSha256':state['candidatePlan']['sha256']},'scope':'provisional complete-paw32 binding; non-paw influences preserved; not generated gait, packing or anatomical attachment admission'}
            (leaf/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
            report['casts'].append({'slug':row['slug'],'label':row['label'],'path':str(leaf),'sha256':digest(leaf/'manifest.json'),'vertices':len(points),'bones':len(bones),'channels':len(bound['channels']),'virtualCoincidentLinks':seams,'unchangedChannels':bound['unchangedChannels'],'zeroInfluenceEndpoints':bound['zeroInfluenceEndpoints'],'paws':bound['paws'],'geometryBytesPreserved':True,'neutralMaxError':float(np.max(np.abs(result['automatic-presets.bin'][0]-points)))})
        if report['inputs']!={str(p):digest(p) for p in protected if p.is_file()}:raise ValueError('retained input changed during binding')
        (out/'catalog.json').write_text(json.dumps({'status':'completed','inputs':str(state_path),'candidateFrame':state['candidateFrame'],'casts':report['casts']},indent=2)+'\n')
        report.update(status='completed',phase='complete',catalog=str(out/'catalog.json'))
    except Exception as error:report.update(status='failed',error=repr(error));raise
    finally:
        try:
            full.protect_report_destination(report_path,out,protected,known)
            for leaf in leaves:full.protect_report_destination(report_path,leaf,protected,known)
            if report_path.resolve()==out/'catalog.json' or any(root in report_path.resolve().parents for root in roots):raise ValueError('unsafe report destination')
        except ValueError as error:report['reportWriteRefused']=str(error);print(json.dumps(report),file=sys.stderr)
        else:report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'status':report['status'],'phase':report['phase'],'casts':report['casts']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    for name in ['inputs','out','report']:parser.add_argument('--'+name,required=True)
    build(parser.parse_args())
