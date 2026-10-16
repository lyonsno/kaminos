"""Carry accepted automatic influences onto a source-authenticated paw correction.

This is a reversible weight-transfer baseline, not a new influence solver.
The four new terminal endpoints deliberately receive zero independent weight.
"""
import argparse
import hashlib
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path
import numpy as np

PAWS={f'{limb}limb-{side}-toe' for limb in ['fore','hind'] for side in ['left','right']}
digest=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()


def transfer_weights(baseline,frame,weights):
    old={b['name']:b for b in baseline['bones']}
    new={b['name']:b for b in frame['bones']}
    if len(old)!=28 or len(new)!=32 or len(new)!=len(frame['bones']) or set(new)-set(old)!={n+'-end' for n in PAWS} or not set(old).issubset(new):
        raise ValueError('not the retained28 to complete-paw32 intervention')
    for name,bone in new.items():
        if name not in old:
            if bone['parent']!=name.removesuffix('-end') or any(b['parent']==name for b in new.values()):
                raise ValueError('new endpoint must be a terminal toe child')
            continue
        if bone['parent']!=old[name]['parent']:
            raise ValueError('retained parent changed')
        a=np.asarray(old[name]['restMatrix']);b=np.asarray(bone['restMatrix'])
        if not np.isfinite(b).all() or not np.allclose(a[:3,:3],b[:3,:3],rtol=0,atol=1e-5):
            raise ValueError('retained joint axes changed')
        if name not in PAWS and not np.allclose(a,b,rtol=0,atol=1e-5):
            raise ValueError('non-paw rest frame changed')
    old_channels=baseline['channels'];channels=['fixed']+list(new)
    if len(set(old_channels))!=len(old_channels) or set(old_channels)!={'fixed',*old}:
        raise ValueError('invalid retained channels')
    if weights.shape!=(baseline['vertices'],len(old_channels)) or not np.isfinite(weights).all() or (weights<0).any() or not np.allclose(weights.sum(axis=1),1,rtol=0,atol=1e-5):
        raise ValueError('invalid retained influences')
    result=np.zeros((len(weights),len(channels)),dtype=weights.dtype)
    for i,name in enumerate(old_channels):result[:,channels.index(name)]=weights[:,i]
    return result,channels


def main():
    parser=argparse.ArgumentParser()
    for name in ['control','rig-frame','expected-rig-frame-sha256','baseline','expected-baseline-sha256','solver-root','solver-revision','out']:
        parser.add_argument('--'+name,required=True)
    args=parser.parse_args()
    out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=False)
    report={'status':'failed','phase':'authentication','argv':sys.argv,'effectiveRoute':'retained-automatic-weights-corrected-paw-rest-frame-dq'}
    try:
        root=Path(args.solver_root).resolve();report['solver']={'root':str(root),'revision':args.solver_revision,'files':{}}
        for name in ['full-creature-binding.py','hindquarter_binding.py']:
            expected=subprocess.check_output(['git','-C',str(root),'show',args.solver_revision+':'+name])
            actual=digest(root/name)
            if actual!=hashlib.sha256(expected).hexdigest():raise ValueError('solver source differs from named revision')
            report['solver']['files'][name]=actual
        sys.path.insert(0,str(root))
        spec=importlib.util.spec_from_file_location('retained_full_binding',root/'full-creature-binding.py')
        solver=importlib.util.module_from_spec(spec);spec.loader.exec_module(solver)
        baseline=Path(args.baseline).resolve();frame_path=Path(args.rig_frame).resolve();control_path=Path(args.control).resolve()
        if digest(baseline/'manifest.json')!=args.expected_baseline_sha256 or digest(frame_path)!=args.expected_rig_frame_sha256:
            raise ValueError('baseline/frame digest mismatch')
        old=json.loads((baseline/'manifest.json').read_text());frame=json.loads(frame_path.read_text());control=json.loads(control_path.read_text())
        # Registered alternate casts have their own geometry identity. Their
        # rig identity is the explicit shared-frame provenance, not sourceSha256.
        if frame['source']['control']['sha256']!=digest(control_path) or old['candidatePaintedWeights'] is not False:
            raise ValueError('control/candidate identity mismatch')
        if frame['source']['sourceSceneSha256']!=control['sourceSha256'] or old['provenance']['rigSourceSha256']!=control['sourceSha256']:
            raise ValueError('registered cast rig source mismatch')
        if old['schema']!='kaminos.live-transport.v3' or frame['schema']!='kaminos.full-given-rig-frame.v1':raise ValueError('unsupported source schema')
        if frame['source']['originalFrame']['sha256']!=old['provenance']['frameChainSha256']:raise ValueError('baseline is not in the retained original frame')
        sources={str(baseline/'manifest.json'):args.expected_baseline_sha256,str(frame_path):args.expected_rig_frame_sha256,str(control_path):digest(control_path)}
        arrays={}
        for name in ['rest.bin','triangles.bin','automatic-weights.bin']:
            asset=old['assets'][name];p=baseline/name
            if digest(p)!=asset['sha256'] or p.stat().st_size!=asset['bytes']:raise ValueError('retained asset mismatch: '+name)
            sources[str(p)]=asset['sha256']
            arrays[name]=np.fromfile(p,dtype='<u4' if name=='triangles.bin' else '<f4').reshape(asset['shape'])
        rest=arrays['rest.bin'];weights,channels=transfer_weights(old,frame,arrays['automatic-weights.bin'])
        report['phase']='articulation'
        presets=[{'name':'Neutral','poseWxyz':{}}]
        for name in sorted(PAWS):
            for angle in [-25,25]:
                half=math.radians(angle)/2
                presets.append({'name':name+' '+str(angle)+' degrees','poseWxyz':{name:[math.cos(half),math.sin(half),0,0]}})
        posed=[]
        for preset in presets:
            matrices=solver.palette(frame['bones'],preset['poseWxyz'])
            preset['palette']=matrices.tolist()
            posed.append(solver.partial_rotation(rest,matrices,weights))
        posed=np.asarray(posed,dtype='<f4')
        if not np.isfinite(posed).all() or not np.allclose(posed[0],rest,rtol=0,atol=1e-6):raise ValueError('neutral/paw deformation invalid')
        arrays.update({'automatic-weights.bin':weights,'automatic-presets.bin':posed})
        assets={}
        for name,array in arrays.items():
            array.tofile(out/name);assets[name]={'sha256':digest(out/name),'bytes':(out/name).stat().st_size,'shape':list(array.shape),'dtype':array.dtype.str}
        for name in ['rest.bin','triangles.bin']:
            if assets[name]['sha256']!=old['assets'][name]['sha256']:raise ValueError('retained geometry changed')
        if sources!={p:digest(p) for p in sources}:raise ValueError('input changed during transfer')
        manifest={**old,'bones':frame['bones'],'channels':channels,'presets':presets,'assets':assets,
            'sourceArmature':'source-derived complete-paw32 analytical tree',
            'bindingRule':{'kind':'retained-automatic-field-name-transfer','sourceRule':old['bindingRule'],'unweightedEndpoints':sorted(n+'-end' for n in PAWS)},
            'provenance':{**old['provenance'],'packageSha256':args.expected_baseline_sha256,'frameChainSha256':args.expected_rig_frame_sha256},
            'scope':'provisional corrected-paw articulation with retained automatic weights; not fresh binding, generated motion or anatomical admission'}
        (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
        report.update(status='completed',phase='complete',inputs=sources,manifestSha256=digest(out/'manifest.json'),vertices=len(rest),bones=32,
            neutralMaxError=float(np.max(np.abs(posed[0]-rest))),
            articulation=[{'name':p['name'],'maxDisplacement':float(np.max(np.linalg.norm(points-rest,axis=1)))} for p,points in zip(presets,posed)])
    except Exception as error:report['error']=repr(error);raise
    finally:(out/'build-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))


if __name__=='__main__':main()
