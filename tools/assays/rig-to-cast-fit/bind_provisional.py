"""Run the retained automatic binder on an explicitly mapped provisional tree.

This assay admits one observed GLB layout. Geometry receives only the recorded
similarity/frame conversion. Original arrays and excluded helper channels are
retained; these hypotheses do not certify anatomy or a motion-model adapter.
"""
import argparse,hashlib,importlib.util,json,struct,sys,traceback
from pathlib import Path
import numpy as np

def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def write(p,d):Path(p).write_text(json.dumps(d,indent=2)+'\n')
def module(name,path):
 s=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m

def run(config_path,out):
 if out.exists() and any(out.iterdir()):raise ValueError('use a new output directory')
 out.mkdir(parents=True,exist_ok=True);report={'status':'failed','phase':'inputs','scriptSha256':sha(__file__)}
 try:
  config=read(config_path)
  required=[config[k] for k in ['cast','plan','placement']]+[str(Path(config['binder'])/n) for n in ['full-creature-binding.py','hindquarter_binding.py']]+[str(Path(config['trunk'])/'trunk_anchors.py')]
  if any(p not in config['expected_sources'] for p in required):raise ValueError('all consumed sources require identity pins')
  for p,h in config['expected_sources'].items():
   if sha(p)!=h:raise ValueError('source identity differs: '+p)
  plan=read(config['plan']);raw=Path(config['cast']).read_bytes();magic,version,length=struct.unpack_from('<III',raw)
  if magic!=0x46546c67 or version!=2 or length!=len(raw):raise ValueError('invalid GLB')
  size,kind=struct.unpack_from('<II',raw,12)
  if kind!=0x4e4f534a:raise ValueError('missing GLB JSON')
  doc=json.loads(raw[20:20+size]);n,kind=struct.unpack_from('<II',raw,20+size);binary=raw[28+size:28+size+n]
  if kind!=0x004e4942 or len(binary)!=n or doc.get('skins') or doc.get('animations'):raise ValueError('expected static binary GLB')
  if len(doc['nodes'])!=1 or len(doc['meshes'])!=1 or len(doc['meshes'][0]['primitives'])!=1:raise ValueError('unobserved GLB hierarchy')
  node=doc['nodes'][0]
  if set(node)-{'mesh','matrix','name'} or node['mesh']!=0:raise ValueError('unobserved node transform')
  primitive=doc['meshes'][0]['primitives'][0]
  if primitive.get('mode',4)!=4:raise ValueError('triangles required')
  def array(index):
   a=doc['accessors'][index];v=doc['bufferViews'][a['bufferView']]
   if a.get('sparse') or v.get('byteStride') or v.get('buffer',0)!=0:raise ValueError('unobserved accessor')
   return np.frombuffer(binary,dtype={5126:'<f4',5125:'<u4',5123:'<u2'}[a['componentType']],count=a['count']*{'VEC3':3,'SCALAR':1}[a['type']],offset=v.get('byteOffset',0)+a.get('byteOffset',0)).copy().reshape(a['count'],-1)
  original=array(primitive['attributes']['POSITION']);triangles=array(primitive['indices']).reshape(-1,3).astype('<u4')
  matrix=np.array(node.get('matrix',np.eye(4).flatten(order='F'))).reshape(4,4,order='F');placement=read(config['placement'])['evidence']['meshAssetLink']['object']
  if placement['source']!='/api/read?root=generated-meshes&path='+sha(config['cast'])+'.glb':raise ValueError('placement belongs to a different cast')
  tr=placement['transform'];scale=np.array(tr['scale'])
  if not np.allclose(scale,scale[0]) or scale[0]<=0 or not np.allclose(tr['rotation'],0) or not np.allclose(matrix[3],[0,0,0,1]) or not np.allclose(matrix[:3,:3].T@matrix[:3,:3],np.eye(3)) or np.linalg.det(matrix[:3,:3])<=0:raise ValueError('only observed positive similarity admitted')
  world=(original@matrix[:3,:3].T+matrix[:3,3])*scale[0]+tr['position']
  names=[j['name'] for j in plan['joints']];q=np.array([j['head'] for j in plan['joints']]);parents=[j['parent'] for j in plan['joints']]
  roles=config['roles'];inactive=set(config['inactive'])
  if set(roles)!=set(names) or not inactive.issubset(names) or len(set(roles.values()))!=len(names):raise ValueError('incomplete/aliased role mapping')
  if any(p and p not in names for p in parents):raise ValueError('unresolved parent')
  support=config.get('axial_support')
  if support is not None:
   if not isinstance(support,list) or len(support)<2 or any(not isinstance(n,str) or n not in names or n in inactive for n in support) or len(set(support))!=len(support) or support[0]!=config['root'] or any(parents[names.index(n)]!=p for p,n in zip(support,support[1:])):raise ValueError('axial support must be an explicit active chain from the root')
  root=names.index(config['root']);leg_a,leg_b=[names.index(x) for x in config['lengthReference']];unit=float(np.linalg.norm(q[leg_a]-q[leg_b]))
  if not np.isfinite(q).all() or unit<=0:raise ValueError('invalid joint frame')
  basis=np.diag([-1.,1.,-1.]);conversion=np.eye(4);conversion[:3,:3]=basis/unit;conversion[:3,3]=-basis@q[root]/unit
  points=((world-q[root])@basis.T/unit).astype('<f4');normalized=(q-q[root])@basis.T/unit
  bones=[]
  for i,name in enumerate(names):
   m=np.eye(4);m[:3,3]=normalized[i];bones.append({'name':name,'parent':parents[i],'restMatrix':m.tolist(),'semanticRole':roles[name]})
  semantic=[{**b,'name':roles[b['name']],'parent':roles[b['parent']] if b['parent'] else None} for b in bones if b['name'] not in inactive]
  if any(b['parent'] and b['parent'] not in {x['name'] for x in semantic} for b in semantic):raise ValueError('inactive helpers cannot parent active controls')
  control={'paintedWeightsIncluded':False,'joints':{b['name']:np.array(b['restMatrix'])[:3,3].tolist() for b in semantic},'bounds':{'min':points.min(0).tolist(),'max':points.max(0).tolist()},'domainMethod':'surface','surfaceConnectivity':'coincident','articulated':True}
  report.update(phase='binding',sources=config['expected_sources'],vertices=len(points),triangles=len(triangles),unit=unit,nativeWorldToBinding=conversion.tolist(),inactive=sorted(inactive));write(out/'report.json',report)
  sys.path[:0]=[config['binder'],config['trunk']];full=module('existing_full_binder',Path(config['binder'])/'full-creature-binding.py')
  rear=full.bind_geometry(points,triangles,control)
  if support is None:result=full.distributed_trunk_weights(points,triangles,rear['edges'],rear['jointWeights'],semantic)
  else:
   # Caller-selected support through the unchanged transverse-ray seed rule.
   anchors=module('provisional_axial_anchors',Path(config['trunk'])/'trunk_anchors.py');anchors.AXIAL=tuple(roles[n] for n in support)
   seeds,receipt=anchors.derive_trunk_anchors(points,triangles,semantic)
   result=full.extend_weights(points,rear['edges'],rear['jointWeights'],semantic,seed_overrides=seeds)
   result['trunkAnchors']={**receipt,'controls':support,'semanticControls':list(anchors.AXIAL),'sourceSha256':sha(Path(config['trunk'])/'trunk_anchors.py')}
  weights=np.zeros((len(points),len(names)+1),dtype='<f4');weights[:,0]=result['weights'][:,0]
  for i,name in enumerate(names,1):
   if name not in inactive:weights[:,i]=result['weights'][:,result['channels'].index(roles[name])]
  if not np.isfinite(weights).all() or weights.min()<0 or not np.allclose(weights.sum(1),1,atol=1e-6):raise ValueError('invalid influence partition')
  package=out/'package';package.mkdir();assets={}
  for name,a in [('rest.bin',points),('triangles.bin',triangles),('automatic-weights.bin',weights),('automatic-presets.bin',points[None])]:
   a.tofile(package/name);assets[name]={'sha256':sha(package/name),'bytes':a.nbytes,'shape':list(a.shape),'dtype':a.dtype.str}
  frame={'schema':'kaminos.provisional-static-rig-frame.v1','nativeWorldToBinding':conversion.tolist(),'meshNodeMatrix':matrix.tolist(),'nativePlacement':tr,'bones':bones,'scope':'Static provisional joints only; no generated motion mapping'};write(out/'rig-frame.json',frame)
  manifest={'schema':'kaminos.live-transport.v3','status':'completed','sourceSha256':sha(config['cast']),'sourceCast':'Lerm floor-excluded retained cast','sourceArmature':'Provisional SOMA30 topology with independent tail controls','vertices':len(points),'triangles':len(triangles),'channels':['fixed']+names,'bones':bones,'assets':assets,'candidatePaintedWeights':False,'reference':{'kind':'none','reason':'Generated cast without a painted skin reference'},'provenance':{'packageSha256':sha(config['cast']),'rigSourceSha256':sha(config['plan']),'frameChainSha256':sha(out/'rig-frame.json')},'presets':[{'name':'neutral','poseWxyz':{}}],'bindingRule':{k:v for k,v in result.items() if k not in ['weights','channels']},'inactiveHelperChannels':sorted(inactive),'scope':'Provisional reuse of existing automatic body rule on a biped, not validated anatomical binding or Kimodo motion'}
  restored=(points.astype(float)*unit)@basis+q[root];error=float(np.max(np.abs(restored-world)))
  if error>2e-6 or not np.array_equal(np.fromfile(package/'triangles.bin',dtype='<u4').reshape(-1,3),triangles):raise ValueError('cast coordinate preservation failed')
  # Publish a loadable package only after every preservation check passes.
  write(package/'manifest.json',manifest)
  report.update(status='completed',phase='complete',manifestSha256=sha(package/'manifest.json'),maxWorldCoordinateRoundtripError=error,trianglesUnchanged=True,unknownVertices=len(result['unknownVertices']),maxPartitionError=float(np.max(abs(weights.sum(1)-1))))
 except Exception:
  report['error']=traceback.format_exc();write(out/'failure.json',report);raise
 finally:write(out/'report.json',report)
 print(json.dumps({k:report[k] for k in ['status','phase','vertices','triangles','unknownVertices','manifestSha256'] if k in report}))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--inputs',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.inputs,a.out)
