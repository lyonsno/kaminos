# kaminos-test: manual — observed MLX source and CPU xatlas/Trimesh environment.
"""Actual source atlas must emit its post-UV normal law, not a worker basis."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
import trimesh

source,expected,out=Path(sys.argv[1]).resolve(),sys.argv[2],Path(sys.argv[3]).resolve()
out.mkdir(parents=True,exist_ok=True);clean=out/'clean';clean.mkdir(exist_ok=True)
v=np.array([[0,0,0],[1,0,0],[0,1,0],[0,0,1]],dtype='<f4')
f=np.array([[0,1,2],[1,0,3]],dtype='<u4')
def row(name,values):
    b=values.tobytes();(clean/name).write_bytes(b)
    return dict(file=name,shape=list(values.shape),byteLength=len(b),sha256=hashlib.sha256(b).hexdigest())
(clean/'report.json').write_text(json.dumps(dict(schema='trellis2.mesh-postprocess.v0',status='succeeded',
    arrays=dict(vertices=row('vertices.f32',v),triangles=row('faces.u32',f)))))
runner=Path(__file__).resolve().parents[1]/'unwrap-retained-mesh.py'
result=subprocess.run([sys.executable,'-B',str(runner),'--source-root',str(source),
    '--expected-source-commit',expected,'--clean-root',str(clean),'--out',str(out/'atlas')],capture_output=True,text=True)
assert result.returncode==0,result.stdout+result.stderr
r=json.loads((out/'atlas/report.json').read_text())
assert 'normals' in r['arrays'],'actual source atlas must return post-UV authored normals, not delegate to the SF3D worker'
assert r['normalBasis']['rule']=='source-resume-export/Trimesh-post-UV'
assert r['normalBasis']['frame']=='model-local' and r['modelCalls']==0
def read(key,dtype):
    row=r['arrays'][key];b=(out/'atlas'/row['file']).read_bytes()
    assert hashlib.sha256(b).hexdigest()==row['sha256'] and len(b)==row['byteLength']
    return np.frombuffer(b,dtype=dtype).reshape(row['shape'])
av,af,an=read('vertices','<f4'),read('triangles','<u4'),read('normals','<f4')
np.testing.assert_array_equal(av[af],v[f])
world=av.copy();world[:,1],world[:,2]=av[:,2],-av[:,1]
reference=trimesh.Trimesh(vertices=world,faces=af,process=False).vertex_normals
local=reference.copy();local[:,1],local[:,2]=-reference[:,2],reference[:,1]
np.testing.assert_array_equal(an,local.astype('<f4'))
assert r['source']['generateSha256']==hashlib.sha256((source/'generate.py').read_bytes()).hexdigest()
print('Actual MLX xatlas and resume-export prefix preserve triangles and return source post-UV normals in model-local coordinates.')
