"""Execute the identified TRELLIS2MLX xatlas helper on a retained cleaned mesh."""
import argparse
import ast
import hashlib
import importlib.metadata
import json
from pathlib import Path
import subprocess
import sys
import time
import traceback
import numpy as np

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source-root',type=Path,required=True)
p.add_argument('--expected-source-commit',required=True)
p.add_argument('--clean-root',type=Path,required=True)
p.add_argument('--out',type=Path,required=True)
a=p.parse_args();source=a.source_root.resolve();clean=a.clean_root.resolve();out=a.out.resolve()
out.mkdir(parents=True,exist_ok=True)
report={'schema':'trellis2.source-atlas.v0','status':'running','phase':'source-admission',
        'modelCalls':0,'route':'Trellis2MLX uv_unwrap/xatlas; winding repair disabled','command':sys.argv}
started=time.perf_counter()
def h(data):return hashlib.sha256(data).hexdigest()
def persist():(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
persist()
try:
    commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()
    dirty=subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True)
    if commit!=a.expected_source_commit or dirty:raise ValueError('exact clean unwrap source required')
    script=source/'trellmlx/texture_bake.py';raw=script.read_bytes()
    report['source']={'root':str(source),'commit':commit,'dirty':dirty,'moduleSha256':h(raw)}
    tree=ast.parse(raw)
    fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='uv_unwrap')
    namespace={'np':np}
    exec(compile(ast.Module(body=[fn],type_ignores=[]),str(script),'exec'),namespace)
    clean_raw=(clean/'report.json').read_bytes();m=json.loads(clean_raw)
    if m.get('schema')!='trellis2.mesh-postprocess.v0' or m.get('status')!='succeeded':
        raise ValueError('complete cleaned mesh required')
    report['cleanReportSha256']=h(clean_raw)
    def read(name,dtype):
        row=m['arrays'][name];file=clean/row['file']
        if not file.resolve().is_relative_to(clean):raise ValueError('cleaned array outside input root')
        data=file.read_bytes()
        if h(data)!=row['sha256'] or len(data)!=row['byteLength']:raise ValueError('changed cleaned mesh')
        return np.frombuffer(data,dtype=dtype).reshape(row['shape'])
    vertices=read('vertices','<f4');faces=read('triangles','<u4')
    report['phase']='source-xatlas';persist()
    v,f,uv,mapping=namespace['uv_unwrap'](vertices,faces,fix_winding=False)
    if not np.array_equal(v[f],vertices[faces]):raise ValueError('xatlas changed ordered triangle positions')
    if not np.isfinite(uv).all() or uv.min()<0 or uv.max()>1:raise ValueError('finite bounded source UV required')
    arrays={}
    for name,values,dtype in [('vertices',v,'<f4'),('triangles',f,'<u4'),('uvs',uv,'<f4')]:
        values=np.ascontiguousarray(values,dtype=dtype);data=values.tobytes();file=name+'.bin'
        (out/file).write_bytes(data)
        arrays[name]={'file':file,'shape':list(values.shape),'byteLength':len(data),'sha256':h(data)}
    report.update(status='succeeded',phase=None,arrays=arrays,completeTrianglePositionsUnchanged=True,
        xatlasVersion=importlib.metadata.version('xatlas'),maxIterations=0,fixWinding=False,
        inputVertices=len(vertices),outputVertices=len(v),faces=len(f))
except Exception as error:
    report.update(status='failed',error={'message':str(error),'traceback':traceback.format_exc()})
finally:
    report['elapsedSeconds']=time.perf_counter()-started;persist()
sys.exit(0 if report['status']=='succeeded' else 1)
