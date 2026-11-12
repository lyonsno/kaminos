"""Caller-owned, integrity-checked source stream. No route or stale-batch fallback."""
import hashlib,json,os,pathlib,re,subprocess
HASH=re.compile(r'^[a-f0-9]{64}$')
def create_source_stream(repo,config,out,expected_commit,expected_source_hash,resume_path=None,resume_counter=0):
 settings=json.loads(pathlib.Path(config).read_bytes());kind=settings['capture'].get('kind','geometry')
 if kind=='nvidia-patterned-metal':
  from neural_appearance_reference_stream import ReferenceStream
  return ReferenceStream(repo,config,out,expected_commit,expected_source_hash,resume_path,resume_counter)
 if kind!='geometry' or settings['fit'].get('sourceBatchStorage','raw-arrays')!='raw-arrays':raise ValueError('Unsupported source route/storage; geometry requires all raw arrays')
 return SourceStream(repo,config,out,expected_commit,expected_source_hash,resume_path,resume_counter)
def validate_batch_reply(request,reply,identity):
 if not isinstance(reply,dict) or reply.get('schema')!='kaminos.appearance-source-batch.v1':raise ValueError('Source batch schema required')
 if type(reply.get('id')) is not int or reply['id']!=request['id'] or type(reply.get('rows')) is not int or reply['rows']!=request['batchSize']*request['batches']:raise ValueError('Requested source batch identity/count changed')
 if any(reply.get(k)!=request[k] for k in ['kind','batchSize','batches']) or any(type(reply.get(k)) is not int or not 0<=reply[k]<=0xffffffff for k in ['seedBefore','seedAfter']):raise ValueError('Source batch semantics/RNG state changed')
 if any(reply.get(k)!=identity[k] for k in ['sourceCommit','sourceHash']) or reply.get('route')!='hardware' or reply.get('isFallbackAdapter') is not False:raise ValueError('Source batch effective route/identity changed')
 for name,channels in [('queries',8),('labels',3)]:
  field=reply.get(name)
  if not isinstance(field,dict) or not isinstance(field.get('path'),str) or not pathlib.Path(field['path']).is_absolute() or not HASH.fullmatch(field.get('sha256','')) or type(field.get('bytes')) is not int or field['bytes']!=reply['rows']*channels*4:raise ValueError('Complete source batch field required: '+name)
 return reply

def load_batch_arrays(reply):
 import numpy as np
 values=[]
 for name,channels in [('queries',8),('labels',3)]:
  field=reply[name];data=pathlib.Path(field['path']).read_bytes()
  if len(data)!=field['bytes'] or hashlib.sha256(data).hexdigest()!=field['sha256']:raise ValueError('Source field byte count/digest mismatch: '+name)
  a=np.frombuffer(data,dtype='<f4').reshape((reply['rows'],channels)).copy()
  if not np.isfinite(a).all() or name=='labels' and (a<0).any():raise ValueError('Nonfinite/negative source response')
  values.append(a)
 return tuple(values)

class SourceStream:
 def __init__(self,repo,config,out,expected_commit,expected_source_hash,resume_path=None,resume_counter=0):
  self.repo=pathlib.Path(repo).resolve();self.config=pathlib.Path(config).resolve();self.out=pathlib.Path(out).resolve();self.expected_commit=expected_commit;self.expected_source_hash=expected_source_hash;self.process=None;self.stderr=None;self.counter=resume_counter;self.records=[];self.last_reply=None;self.resume_path=resume_path
 def start(self):
  self.out.mkdir(parents=True,exist_ok=True);self.stderr=(self.out/'stderr.log').open('w');self.process=subprocess.Popen(['node','tools/neural-appearance-source-stream.mjs',str(self.config),str(self.out)]+([str(self.resume_path)] if self.resume_path else []),cwd=self.repo,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=self.stderr,text=True,env={**os.environ,'SHADER_HERDER_STRICT_METAL':'1'})
  self.ready=self._read()
  if self.ready.get('schema')!='kaminos.appearance-source-ready.v1' or self.ready.get('sourceCommit')!=self.expected_commit or self.ready.get('sourceHash')!=self.expected_source_hash or self.ready.get('route')!='hardware' or self.ready.get('isFallbackAdapter') is not False or self.ready.get('queryLayout')!='UV/viewXYZ/lightXYZ' or self.ready.get('response')!='projected-bsdf':raise ValueError('Source stream effective identity/route/layout differs')
  config=json.loads(self.config.read_bytes())
  if self.ready.get('configHash')!=hashlib.sha256(self.config.read_bytes()).hexdigest() or self.ready.get('teacherCommit')!=config['capture']['teacherCommit']:raise ValueError('Source stream config/teacher identity differs')
  self.states=dict(self.ready['sourceStates']);return self
 def _read(self):
  line=self.process.stdout.readline()
  if not line:raise RuntimeError('Source stream closed before its next response; inspect source report/stderr')
  value=json.loads(line);self.last_reply=value
  if not isinstance(value,dict) or value.get('schema')=='kaminos.appearance-source-error.v1':raise RuntimeError('Source stream failed: '+str(value))
  return value
 def batch(self,kind,batch_size,batches):
  request={'id':self.counter,'kind':kind,'batchSize':batch_size,'batches':batches};self.counter+=1;self.process.stdin.write(json.dumps(request)+'\n');self.process.stdin.flush();reply=validate_batch_reply(request,self._read(),self.ready);self.records.append(reply);self.states[kind]=reply['seedAfter'];return load_batch_arrays(reply),reply
 def close(self):
  code=None
  try:
   if self.process:
    try:self.process.stdin.close()
    except BrokenPipeError:pass
    code=self.process.wait();self.process.stdout.close();self.process=None
  finally:
   if self.stderr:self.stderr.close();self.stderr=None
  if code:raise RuntimeError('Source stream exited '+str(code))
