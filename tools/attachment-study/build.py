"""Build explicit provisional packages; source assets are immutable inputs."""
from pathlib import Path
import argparse,json,hashlib,traceback,subprocess,sys,shutil
import numpy as np
from concavity import surface,edge_penalty,distances,redistribute

sha=lambda p:hashlib.sha256(Path(p).read_bytes()).hexdigest()
write=lambda p,d:Path(p).write_text(json.dumps(d,indent=2)+'\n')
parser=argparse.ArgumentParser();parser.add_argument('--inputs',required=True);parser.add_argument('--out',required=True);args=parser.parse_args()
out=Path(args.out);out.mkdir(parents=True,exist_ok=True)
report={'status':'failed','phase':'source-provenance','cases':[]}
write(out/'report.json',report)
try:
 source_root=Path(__file__).resolve().parents[2]
 report.update({'method':'rest-surface concavity cost; exact-position welded graph; shoulder-local support; conservative chest transfer','settings':{'gain':1.,'normalRadiusArmLengths':.08,'costSupportArmLengths':1.2,'affinityTemperature':.18},'sourceRoot':str(source_root),'sourceRevision':subprocess.check_output(['git','-C',str(source_root),'rev-parse','HEAD'],text=True).strip(),'sourceFiles':{p.name:sha(p) for p in [Path(__file__),Path(__file__).with_name('concavity.py')]}})
 report['phase']='input-provenance';write(out/'report.json',report)
 report['inputsSha256']=sha(args.inputs)
 for case in json.loads(Path(args.inputs).read_text()):
  root=Path(case['path']);m=json.loads((root/'manifest.json').read_text());assert sha(root/'manifest.json')==case['sha256']
  data={}
  for name,d in m['assets'].items():
   assert sha(root/name)==d['sha256']; data[name]=np.fromfile(root/name,dtype=d['dtype']).reshape(d['shape'])
  p=data['rest.bin'];tri=data['triangles.bin'];w=data['automatic-weights.bin'];bones={b['name']:np.asarray(b['restMatrix']) for b in m['bones']};heads={k:v[:3,3] for k,v in bones.items()};channels=m['channels']
  arm=np.mean([np.linalg.norm(heads['forelimb-'+s+'-elbow']-heads['forelimb-'+s+'-shoulder']) for s in ['left','right']]);assert arm>0
  report['phase']=case['id']+':normals';write(out/'report.json',report)
  u,inv,e,length,n,meta=surface(p,tri,.08*arm);attenuation={};fields={};sideRows=[]
  concavity=np.zeros(len(u))
  for side,other in [('left','right'),('right','left')]:
   report['phase']=case['id']+':'+side;write(out/'report.json',report)
   head=heads['forelimb-'+side+'-shoulder'];elbow=heads['forelimb-'+side+'-elbow'];scale=np.linalg.norm(elbow-head);lateral=head-heads['forelimb-'+other+'-shoulder'];lateral/=np.linalg.norm(lateral)
   target=head+.55*(elbow-head)+.10*lateral;seed=int(np.argmin(np.sum((u-target)**2,axis=1)))
   midpoint=(u[e[:,0]]+u[e[:,1]])*.5;rad=np.linalg.norm(midpoint-head,axis=1)/(1.2*scale);support=np.maximum(1-rad**2,0)**2
   penalty=edge_penalty(u,n,e,scale)*support
   np.maximum.at(concavity,e[:,0],penalty/np.maximum(length,1e-15));np.maximum.at(concavity,e[:,1],penalty/np.maximum(length,1e-15))
   a=distances(len(u),e,length,seed);b=distances(len(u),e,length+penalty,seed);known=np.isfinite(a)&np.isfinite(b);dose=np.zeros(len(u));dose[known]=np.maximum(b[known]-a[known],0)
   # Original chest share protects clearly limb-owned distal regions. This is a
   # soft shared-attachment prior, not an assertion of anatomical ownership.
   ids=[channels.index('forelimb-'+side+'-'+j) for j in ['shoulder','elbow','wrist','toe']];limb=w[:,ids].sum(axis=1);chest=w[:,channels.index('spine-chest')];mixed=np.divide(chest,chest+limb,out=np.zeros(len(w)),where=chest+limb>0)
   factor=np.exp(-dose[inv]*mixed/.18);attenuation[side]=factor;fields[side+'Dose']=dose[inv]
   sideRows.append({'side':side,'armLength':scale,'seedWelded':seed,'seedPoint':u[seed].tolist(),'unknownVertices':int(np.sum(~known[inv])),'penalizedEdges':int(np.sum(penalty>0)),'doseMax':float(dose.max()),'doseP95':float(np.quantile(dose,.95))})
  proposed=redistribute(w,channels,attenuation).astype(w.dtype);assert np.isfinite(proposed).all() and proposed.min()>=0 and np.max(np.abs(proposed.sum(axis=1)-w.sum(axis=1)))<2e-6
  changed=[channels.index('spine-chest')]+[channels.index('forelimb-'+s+'-'+j) for s in ['left','right'] for j in ['shoulder','elbow','wrist','toe']];unchanged=[i for i in range(len(channels)) if i not in changed];assert np.array_equal(w[:,unchanged],proposed[:,unchanged])
  dest=out/case['id'];dest.mkdir(exist_ok=False)
  for name in ['rest.bin','triangles.bin']:shutil.copy2(root/name,dest/name)
  proposed.tofile(dest/'automatic-weights.bin')
  # Package presets are zero at rest only; runtime comparison supplies actual poses.
  presets=p[None].copy();presets.astype('<f4').tofile(dest/'automatic-presets.bin')
  cm=json.loads(json.dumps(m));cm['presets']=[{'name':'neutral','label':'Neutral · candidate rest','poseWxyz':{},'palette':np.repeat(np.eye(4)[None],len(channels),axis=0).tolist()}]
  cm['reference']={'kind':'none','reason':'Provisional concavity attachment experiment; no painted reference claim'};cm['bindingRule']={'rule':report['method'],'sourceManifestSha256':case['sha256'],'settings':report['settings']};cm['scope']='Provisional binding experiment, not adopted; actual comparison pose is supplied by native skeleton experiment'
  for name,a in [('rest.bin',p),('triangles.bin',tri),('automatic-weights.bin',proposed),('automatic-presets.bin',presets.astype('<f4'))]:cm['assets'][name]={'sha256':sha(dest/name),'shape':list(a.shape),'dtype':a.dtype.str,'bytes':(dest/name).stat().st_size}
  write(dest/'manifest.json',cm)
  fore=[i for i,c in enumerate(channels) if c.startswith('forelimb-')];before=w[:,fore].sum(axis=1);after=proposed[:,fore].sum(axis=1);removed=before-after
  field=np.column_stack([concavity[inv],before,after,removed,fields['leftDose'],fields['rightDose']]).astype('<f4');field.tofile(dest/'diagnostic.f32');write(dest/'diagnostic.json',{'sourceManifestSha256':case['sha256'],'candidateManifestSha256':sha(dest/'manifest.json'),'fields':['concavityCostPerLength','originalForelimbShare','candidateForelimbShare','transferredToChest','leftCostDistance','rightCostDistance'],'shape':list(field.shape),'sha256':sha(dest/'diagnostic.f32'),'authority':'rest geometry inference and retained weights; no authored valley curve'})
  row={**case,'candidate':str(dest),'candidateSha256':sha(dest/'manifest.json'),'vertices':len(p),'surface':meta,'sides':sideRows,'geometryUnchanged':all(sha(dest/n)==sha(root/n) for n in ['rest.bin','triangles.bin']),'unchangedChannels':[channels[i] for i in unchanged],'maxPartitionError':float(np.max(np.abs(proposed.sum(axis=1)-1))),'transferMax':float(removed.max()),'transferP95':float(np.quantile(removed,.95)),'verticesTransferOver01':int(np.sum(removed>.01))}
  report['cases'].append(row);write(out/'report.json',report)
 report.update(status='completed',phase='complete')
except Exception:
 report['error']=traceback.format_exc();raise
finally:write(out/'report.json',report)
