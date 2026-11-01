# kaminos-test: python
"""Axial redistribution must not steal weights from established limbs/tail."""
import importlib.util
from pathlib import Path
import numpy as np
p=Path(__file__).resolve().parents[1]/'tools/assays/rig-to-cast-fit/repartition_axial.py'
spec=importlib.util.spec_from_file_location('axial_repartition',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);repartition=m.repartition
old=np.array([[.1,.4,.2,.3],[0,0,0,1],[0,.2,.8,0]],dtype=np.float32)
new=np.array([[.2,.1,.6,.1],[0,0,0,1],[0,.7,.3,0]],dtype=np.float32)
result=repartition(old,new,[1,2])
assert np.array_equal(result[:,[0,3]],old[:,[0,3]]),'new axial proposal stole fixed/limb influence'
assert np.allclose(result[:,[1,2]].sum(1),old[:,[1,2]].sum(1),atol=1e-7)
assert np.allclose(result.sum(1),1,atol=1e-6) and np.all(result>=0)
assert np.allclose(result[0,1:3],[.6/7,.6*6/7],atol=1e-7)
for candidate,indices in [(new,[1,1]),(new,[9]),(new[:1],[1,2]),(new*np.nan,[1,2]),(np.array([[0,0,0,1]]*3,dtype=np.float32),[1,2])]:
 try:repartition(old,candidate,indices)
 except ValueError:pass
 else:raise AssertionError('invalid or unsupported proposed partition was accepted')
print('axial share redistribution preserves every other channel and rejects missing support')

# Tiny package exercises publication and the exact-file identity checks.
import json, tempfile, contextlib, io
with tempfile.TemporaryDirectory() as tmp:
 root=Path(tmp)
 config={'axial_support':['neck','head']}
 for label,weights in [('baseline',old),('proposed',new)]:
  source=root/label;source.mkdir()
  arrays={'rest.bin':np.arange(9,dtype='<f4'),'triangles.bin':np.array([0,1,2],dtype='<u4'),'automatic-presets.bin':np.eye(4,dtype='<f4'),'automatic-weights.bin':weights}
  assets={}
  for name,array in arrays.items():
   array.tofile(source/name);assets[name]={'bytes':(source/name).stat().st_size,'sha256':m.sha(source/name)}
  manifest={'schema':'kaminos.live-transport.v3','status':'completed','vertices':3,'triangles':1,'channels':['fixed','neck','head','arm'],'bones':[],'sourceSha256':'same-cast','assets':assets,'bindingRule':{}}
  m.write(source/'manifest.json',manifest);config[label]=str(source);config[label+'_sha256']=m.sha(source/'manifest.json')
 inputs=root/'inputs.json';m.write(inputs,config)
 with contextlib.redirect_stdout(io.StringIO()):m.run(inputs,root/'valid')
 report=m.read(root/'valid/report.json');assert report['status']=='completed' and report['nonAxialWeightsByteIdentical']
 assert np.array_equal(np.fromfile(root/'valid/package/automatic-weights.bin',dtype='<f4').reshape(old.shape),result)
 assert (root/'valid/package/rest.bin').read_bytes()==(root/'baseline/rest.bin').read_bytes()
 for label,mutate in [('wrong-manifest',lambda:config.update(proposed_sha256='wrong')),('tampered-asset',lambda:(root/'proposed/automatic-weights.bin').write_bytes(b'bad'))]:
  config['proposed_sha256']=m.sha(root/'proposed/manifest.json');mutate();m.write(inputs,config)
  try:m.run(inputs,root/label)
  except ValueError:pass
  else:raise AssertionError('changed source admitted')
  assert m.read(root/label/'report.json')['status']=='failed'
  assert (root/label/'failure.json').is_file() and not (root/label/'package/manifest.json').exists()
