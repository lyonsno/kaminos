"""Caller-owned provisional fit; original cast, rig and motion remain immutable."""
import argparse, hashlib, json, traceback
from pathlib import Path
import numpy as np
from fit_tree import fit_tree
from inspect_surface import render

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def run(plan_path,out):
    out.mkdir(parents=True,exist_ok=True)
    report={'status':'failed','phase':'inputs','plan':str(plan_path),'sourceScriptSha256':sha(__file__)}
    try:
        plan=json.loads(plan_path.read_text());package=Path(plan['package']);manifest=package/'manifest.json'
        if sha(manifest)!=plan['manifestSha256']:raise ValueError('source manifest digest mismatch')
        m=json.loads(manifest.read_text())
        for name in ['rest.bin','triangles.bin']:
            if sha(package/name)!=m['assets'][name]['sha256']:raise ValueError('source geometry digest mismatch')
        p=np.fromfile(package/'rest.bin',dtype='<f4').reshape(-1,3);t=np.fromfile(package/'triangles.bin',dtype='<u4').reshape(-1,3)
        names=[b['name'] for b in m['bones']];parents=[names.index(b['parent']) if b['parent'] else -1 for b in m['bones']];rest=np.array([b['restMatrix'] for b in m['bones']])[:,:3,3]
        targets=[{**a,'joint':names.index(a['name'])} for a in plan['landmarks']]
        report.update(phase='fitting',sourceManifestSha256=sha(manifest),planSha256=sha(plan_path),fitSourceSha256=sha(Path(__file__).with_name('fit_tree.py')),surfaceUnchanged=True,jointNames=names,parents=parents,originalJoints=rest.tolist())
        (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
        modes=plan.get('modes',['pose-only'])
        if not modes or any(mode not in ['pose-only','proportions'] for mode in modes):raise ValueError('unknown fitting mode')
        for vary in [mode=='proportions' for mode in modes]:
            mode='proportions' if vary else 'pose-only';fit=fit_tree(rest,parents,targets,vary_lengths=vary)
            (out/(mode+'.json')).write_text(json.dumps(fit,indent=2)+'\n');render(p,t,rest,names,parents,out/(mode+'.png'),np.array(fit['joints']))
            report[mode]={'path':str(out/(mode+'.json')),'sha256':sha(out/(mode+'.json')),'landmarkRms':fit['landmarkRms'],'solver':fit['solver'],'maxOriginalLengthError':fit['maxOriginalLengthError']}
        report.update(status='completed',phase='complete')
    except Exception:
        report['error']=traceback.format_exc();(out/'failure.json').write_text(json.dumps(report,indent=2)+'\n');raise
    finally:(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report))

if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--plan',type=Path,required=True);a.add_argument('--out',type=Path,required=True);args=a.parse_args();run(args.plan,args.out)
