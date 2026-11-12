"""In-process pinned MaterialX teacher; immutable inputs plus replayable batches.

Training arrays are deterministic derivatives of the retained author maps,
PCG64 state, query generator, source evaluator and effective MLX runtime.
Held-out rows are retained as raw float32. No existing raw corpus is removed.
"""
import hashlib,json,pathlib,traceback
import numpy as np
from neural_appearance_patterned_metal import PatternedMetal,reference_queries,FALCOR_SOURCE

def digest(data):return hashlib.sha256(data).hexdigest()

class ReferenceStream:
 def __init__(self,repo,config,out,expected_commit,expected_source_hash,resume_path=None,resume_counter=0):
  self.repo=pathlib.Path(repo).resolve();self.config=pathlib.Path(config).resolve();self.out=pathlib.Path(out).resolve();self.expected_commit=expected_commit;self.expected_source_hash=expected_source_hash;self.resume_path=resume_path;self.counter=resume_counter;self.records=[]
 def save(self):
  self.out.mkdir(parents=True,exist_ok=True);(self.out/'report.json').write_text(json.dumps(self.report,indent=2)+'\n')
 def start(self):
  import mlx.core as mx
  self.report={'status':'running','phase':'admission','provider':'ported-PatternedMetal-MLX','requests':[]};self.save()
  try:
   self.settings=json.loads(self.config.read_bytes());c=self.settings['capture'];fit=self.settings['fit']
   if c.get('kind')!='nvidia-patterned-metal' or fit.get('sourceBatchStorage')!='procedural-replay' or c.get('teacherCommit')!=FALCOR_SOURCE:raise ValueError('Explicit PatternedMetal procedural source route required')
   if not mx.metal.is_available() or mx.default_device()!=mx.gpu:raise RuntimeError('Metal reference source required; no CPU fallback')
   path=pathlib.Path(c['sourcePath']);data=path.read_bytes()
   if digest(data)!=self.expected_source_hash:raise ValueError('Reference manifest hash differs')
   self.teacher=PatternedMetal(path);self.resolution=fit['resolution'];self.rng={name:np.random.Generator(np.random.PCG64(seed)) for name,seed in [('training',c['seed']),('heldout',c.get('heldoutSeed',c['seed']+1))]}
   resumed=json.loads(pathlib.Path(self.resume_path).read_bytes()) if self.resume_path else None
   if resumed:
    if any(resumed.get(k)!=v for k,v in [('sourceCommit',self.expected_commit),('sourceHash',self.expected_source_hash),('configHash',digest(self.config.read_bytes()))]):raise ValueError('Reference resume identity changed')
    for name,rng in self.rng.items():rng.bit_generator.state=resumed['sourceStates'][name]
   self.states={name:rng.bit_generator.state for name,rng in self.rng.items()}
   self.ready={'schema':'kaminos.appearance-source-ready.v1','sourceCommit':self.expected_commit,'sourceHash':self.expected_source_hash,'teacherCommit':FALCOR_SOURCE,'configHash':digest(self.config.read_bytes()),'route':'mlx-metal-ported-reference','isFallbackAdapter':False,'queryLayout':'UV/viewXYZ/lightXYZ','response':'projected-bsdf','sourceStates':self.states,'runtime':{'mlx':mx.__version__,'numpy':np.__version__,'rng':'PCG64','device':str(mx.default_device())},'material':self.teacher.manifest,'footprint':{'mode':'point','nativeMapSampling':'bilinear-repeat','latentResolution':self.resolution,'uvSnap':'latent-texel-center','spatialAverage':False}}
   if resumed and resumed.get('sourceRuntime')!=self.ready['runtime']:raise ValueError('Reference replay runtime changed')
   self.report.update(phase='waiting-request',identity=self.ready);self.save();return self
  except BaseException:
   self.report.update(status='failed',phase='source-start-failed',error=traceback.format_exc());self.save();raise
 def batch(self,kind,batch_size,batches):
  try:return self._batch(kind,batch_size,batches)
  except BaseException:
   self.report.update(status='failed',phase='batch-failed',error=traceback.format_exc());self.save();raise
 def _batch(self,kind,batch_size,batches):
  import mlx.core as mx
  if kind not in self.rng or type(batch_size) is not int or batch_size<1 or type(batches) is not int or batches<1:raise ValueError('Complete reference batch required')
  request={'id':self.counter,'kind':kind,'batchSize':batch_size,'batches':batches};self.counter+=1;self.report.update(phase='evaluate',active=request);self.save()
  before=self.rng[kind].bit_generator.state
  queries=np.concatenate([reference_queries(self.rng[kind],batch_size,self.resolution) for _ in range(batches)])
  q=mx.array(queries);labels=self.teacher.evaluate(q);mx.eval(labels);values=np.asarray(labels)
  if not np.isfinite(values).all() or (values<0).any():raise ValueError('Nonfinite/negative reference response')
  self.states[kind]=self.rng[kind].bit_generator.state
  receipt={'schema':'kaminos.appearance-procedural-batch.v1',**request,'rows':len(queries),'sourceCommit':self.expected_commit,'sourceHash':self.expected_source_hash,'route':self.ready['route'],'sourceRuntime':self.ready['runtime'],'stateBefore':before,'stateAfter':self.states[kind],'footprint':self.ready['footprint'],'storage':'procedural-replay','queries':{'sha256':digest(queries.tobytes()),'bytes':queries.nbytes},'labels':{'sha256':digest(values.tobytes()),'bytes':values.nbytes}}
  if kind=='heldout':
   receipt['storage']='raw-arrays';directory=self.out/'blocks'/str(request['id']);directory.mkdir(parents=True)
   for name,array in [('queries',queries),('labels',values)]:
    file=directory/(name+'.f32');array.astype('<f4').tofile(file);receipt[name]['path']=str(file)
  self.records.append(receipt);self.report['requests'].append(receipt);self.report.update(phase='waiting-request',active=None);self.save();return (q,labels),receipt
 def close(self):
  if self.report['status']!='failed':self.report.update(status='passed',phase='complete')
  self.save();self.teacher=None
