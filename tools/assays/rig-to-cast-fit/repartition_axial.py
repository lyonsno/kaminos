"""Provisional axial-share redistribution over two identical retained skins."""
import argparse,hashlib,json,shutil,traceback
from pathlib import Path
import numpy as np

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def write(p,v):Path(p).write_text(json.dumps(v,indent=2)+'\n')
def repartition(baseline,proposed,indices):
 a=np.asarray(baseline);b=np.asarray(proposed)
 if a.ndim!=2 or a.shape!=b.shape or a.dtype!=np.float32 or b.dtype!=np.float32 or not indices or any(type(i)!=int or i<0 or i>=a.shape[1] for i in indices) or len(set(indices))!=len(indices):raise ValueError('matching float32 partitions and unique axial channels required')
 for w in [a,b]:
  if not np.isfinite(w).all() or (w<0).any() or not np.allclose(w.sum(1),1,atol=1e-6,rtol=0):raise ValueError('invalid input influence partition')
 budget=a[:,indices].sum(1,dtype=np.float64);proposal=b[:,indices].sum(1,dtype=np.float64)
 if np.any((budget>0)&(proposal==0)):raise ValueError('proposed axial support missing for an existing axial share')
 ratio=np.divide(budget,proposal,out=np.zeros_like(budget),where=proposal>0)
 result=a.copy();result[:,indices]=(b[:,indices].astype(np.float64)*ratio[:,None]).astype(np.float32)
 if not np.isfinite(result).all() or not np.allclose(result.sum(1),1,atol=1e-6,rtol=0):raise ValueError('redistributed partition invalid')
 return result

def run(inputs,out):
 if out.exists() and any(out.iterdir()):raise ValueError('use a new output directory')
 out.mkdir(parents=True,exist_ok=True);report={'status':'failed','phase':'inputs','scriptSha256':sha(__file__)}
 try:
  c=read(inputs);sources=[]
  for key in ['baseline','proposed']:
   root=Path(c[key]);m=read(root/'manifest.json')
   if sha(root/'manifest.json')!=c[key+'_sha256'] or m['schema']!='kaminos.live-transport.v3' or m['status']!='completed':raise ValueError('source manifest identity or state differs')
   for name,spec in m['assets'].items():
    p=root/name
    if p.parent!=root or p.stat().st_size!=spec['bytes'] or sha(p)!=spec['sha256']:raise ValueError('source asset identity differs')
   sources.append((root,m))
  (base,a),(candidate,b)=sources
  for key in ['vertices','triangles','channels','bones','sourceSha256']:
   if a[key]!=b[key]:raise ValueError('skins do not share exact geometry/rig identity')
  for name in ['rest.bin','triangles.bin','automatic-presets.bin']:
   if a['assets'][name]!=b['assets'][name]:raise ValueError('skins do not share exact retained geometry')
  names=c['axial_support'];indices=[a['channels'].index(n) for n in names]
  shape=(a['vertices'],len(a['channels']));old=np.fromfile(base/'automatic-weights.bin',dtype='<f4').reshape(shape);new=np.fromfile(candidate/'automatic-weights.bin',dtype='<f4').reshape(shape)
  report.update(phase='redistribute',baselineSha256=c['baseline_sha256'],proposedSha256=c['proposed_sha256'],controls=names)
  result=repartition(old,new,indices);other=[i for i in range(shape[1]) if i not in indices]
  if not np.array_equal(result[:,other],old[:,other]):raise ValueError('non-axial influence changed')
  package=out/'package';package.mkdir()
  for name in ['rest.bin','triangles.bin','automatic-presets.bin']:shutil.copy2(base/name,package/name)
  result.tofile(package/'automatic-weights.bin');m=json.loads(json.dumps(a));m['assets']['automatic-weights.bin']['sha256']=sha(package/'automatic-weights.bin')
  m['bindingRule']={'rule':'baseline non-axial weights fixed; baseline axial budget repartitioned by proposed relative axial weights','baselineManifestSha256':c['baseline_sha256'],'proposedManifestSha256':c['proposed_sha256'],'controls':names,'proposedTrunkAnchors':b['bindingRule'].get('trunkAnchors')};m['scope']='Provisional same-cast axial redistribution; native bend judgment required'
  report.update(status='completed',phase='complete',vertices=shape[0],triangles=a['triangles'],nonAxialWeightsByteIdentical=True,restAndTrianglesUnchanged=True,maxPartitionError=float(abs(result.sum(1)-1).max()))
  write(package/'manifest.json',m);report['manifestSha256']=sha(package/'manifest.json')
 except Exception:report['status']='failed';report['error']=traceback.format_exc();write(out/'failure.json',report);raise
 finally:write(out/'report.json',report)
 print(json.dumps(report))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inputs',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.inputs,a.out)
