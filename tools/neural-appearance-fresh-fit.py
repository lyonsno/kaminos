#!/usr/bin/env python3
"""Fresh geometric source -> released direct-optimization route -> native bundle.

One instance, raw latents, Xavier/zero initialization, power-log loss, corrected
Adam, cosine schedule and fresh stratified UniformRusinkiewicz batches. The
geometric integral teacher, FP32 MLX and UniformRus alternative are explicit
integration choices, not the complete encoder/sampler/auxiliary pipeline.
"""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,traceback,uuid
from neural_appearance_fresh_plan import validate_plan,blocks,storage_bytes
from neural_appearance_source_stream import create_source_stream,load_batch_arrays


def digest(path):return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def atomic_json(path,value):
 path=pathlib.Path(path);temporary=path.with_name(path.name+'.pending');temporary.write_text(json.dumps(value,indent=2)+'\n');temporary.replace(path)

def run(args):
 out=pathlib.Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True);stream=None
 report={'status':'running','phase':'admission','job':os.environ.get('GREENROOM_JOB_ID'),'repoRoot':str(pathlib.Path.cwd()),'configPath':str(pathlib.Path(args.config).resolve()),'checkpoints':[],'rawBatches':[],'proceduralBatches':[]}
 canonical=out/'report.json';previous=canonical.read_bytes() if canonical.exists() else None;canonical_allowed=previous is None
 attempt=out/'attempts'/(uuid.uuid4().hex+'.json') if previous is not None else None
 def publish():
  if attempt:attempt.parent.mkdir(parents=True,exist_ok=True);atomic_json(attempt,report)
  if canonical_allowed:atomic_json(canonical,report)
 publish()
 try:
  if previous is not None and not args.resume:raise ValueError('Existing fit output requires its explicit resume checkpoint')
  if not report['job']:raise RuntimeError('Greenroom admission required')
  report['sourceCommit']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
  if report['sourceCommit']!=os.environ.get('EXPECTED_COMMIT') or subprocess.check_output(['git','status','--porcelain'],text=True).strip():raise RuntimeError('Pinned clean training source required')
  config_path=pathlib.Path(args.config).resolve();config=json.loads(config_path.read_bytes());report['config']=config;report['configHash']=digest(config_path);report['sourceHash']=config['capture']['sourceSha256'];plan=validate_plan(config['fit'],args.until);report['effectiveRecipe']=plan
  report['claim']='Released single-instance direct optimization on '+('the ported PatternedMetal reference graph (not NVIDIA backend execution)' if config['capture'].get('kind')=='nvidia-patterned-metal' else 'own geometric integral')+'; no encoder, reference-importance mixture, sampler, auxiliary decoder or FP16 arithmetic claim.'
  resume=json.loads(pathlib.Path(args.resume).read_bytes()) if args.resume else None;start=0
  if resume:
   if any(resume.get(k)!=report[k] for k in ['sourceCommit','configHash','sourceHash']) or resume.get('output')!=str(out) or resume.get('schema')!='kaminos.appearance-fit-resume.v1':raise ValueError('Resume source/config/output identity changed')
   start=resume['step']
   if type(start) is not int or start<1 or start>=args.until or start%plan['checkpointPeriod']:raise ValueError('Resume must advance a complete retained checkpoint')
   if digest(resume['state']['path'])!=resume['state']['sha256']:raise ValueError('Resume optimizer/parameter digest mismatch')
   report['checkpoints']=resume['checkpoints'];report['rawBatches']=resume['rawBatches'];report['proceduralBatches']=resume.get('proceduralBatches',[]);report['resumedFrom']=str(pathlib.Path(args.resume).resolve())
  heldout_count=config['capture']['heldout'];size=storage_bytes(plan,start,args.until,heldout_count);report['storage']={**size,'freeBytes':shutil.disk_usage(out).free}
  if size['requiredBytes']>report['storage']['freeBytes']:raise RuntimeError('Insufficient space for all raw inputs and checkpoints; no capture attempted')
  report['phase']='runtime';publish()
  import numpy as np
  import mlx.core as mx
  from neural_appearance_pool import CandidatePool
  from neural_appearance_mlx import appearance_response_loss,appearance_learning_rate
  if not mx.metal.is_available():raise RuntimeError('Metal MLX required; no CPU training fallback')
  mx.set_default_device(mx.gpu);report['backend']={'library':'mlx','device':str(mx.default_device()),'metalAvailable':True}
  pool=CandidatePool(plan['resolution'],16,[plan['seed']],epsilon=plan['adamEpsilon'],loss_kind=plan['lossKind'],loss_power=plan['lossPower'],recipe='published-direct',hidden_layers=plan['hiddenLayers'])
  if resume:pool.load_state(resume['state']['path'])
  if previous is not None:
   prior=json.loads(previous)
   if any(prior.get(k)!=report[k] for k in ['sourceCommit','configHash','sourceHash']):raise ValueError('Existing execution and resume identity differ')
   prior_path=attempt.with_suffix('.prior.json');prior_path.write_bytes(previous);report['previousReport']={'path':str(prior_path),'sha256':hashlib.sha256(previous).hexdigest()};canonical_allowed=True
  source_out=out/('source-'+report['job']+'-'+str(start));report['phase']='source-start';publish()
  if source_out.exists():raise ValueError('Source invocation already exists; preserve it and use a distinct execution job')
  stream=create_source_stream(pathlib.Path.cwd(),config_path,source_out,report['sourceCommit'],report['sourceHash'],args.resume,resume['sourceCounter'] if resume else 0)
  stream.start();report['sourceReady']=stream.ready
  if resume:
   heldout=resume['heldout'];hq,ht=load_batch_arrays(heldout)
  else:
   (hq,ht),heldout=stream.batch('heldout',heldout_count,1);report['rawBatches'].append(heldout)
  hq,ht=mx.array(hq),mx.array(ht)
  def checkpoint(step):
   report['phase']='checkpoint';report['completedSteps']=step;publish();predicted=pool.predict(hq)[0];loss=appearance_response_loss(predicted,ht,plan['lossKind'],plan['lossPower']);log_loss=appearance_response_loss(predicted,ht);mx.eval(predicted,loss,log_loss)
   if not bool(mx.all(mx.isfinite(predicted)).item()):raise ValueError('Nonfinite heldout prediction')
   target=out/('step-'+str(step));bundle=pool.export(0,target,{'kind':'own-mlx-published-direct','step':step,'sourceCommit':report['sourceCommit'],'sourceHash':report['sourceHash'],'configHash':report['configHash'],'teacher':stream.ready,'recipe':plan})
   predicted_path=target/'heldout.f32';np.asarray(predicted).astype('<f4').tofile(predicted_path)
   item={'step':step,'heldoutTrainingLoss':float(loss.item()),'heldoutLogL1':float(log_loss.item()),'predictions':{'path':str(predicted_path),'sha256':digest(predicted_path)},**bundle};report['checkpoints'].append(item)
   state_path=target/'training-state.npz';temporary=target/'training-state.pending.npz';pool.save_state(str(temporary));temporary.replace(state_path)
   state={'schema':'kaminos.appearance-fit-resume.v1','output':str(out),'sourceCommit':report['sourceCommit'],'configHash':report['configHash'],'sourceHash':report['sourceHash'],'step':step,'sourceCounter':stream.counter,'sourceStates':dict(stream.states),'state':{'path':str(state_path),'sha256':digest(state_path)},'heldout':heldout,'checkpoints':list(report['checkpoints']),'rawBatches':list(report['rawBatches'])}
   state.update(proceduralBatches=list(report['proceduralBatches']),sourceRuntime=stream.ready.get('runtime'))
   atomic_json(target/'resume.json',state);report['latestResume']=str(target/'resume.json');publish();print(json.dumps(item),flush=True)
  if not resume:checkpoint(0)
  for begin,count,batch in blocks(plan,start,args.until):
   report['phase']='source-batch';report['completedSteps']=begin;publish();(q,t),receipt=stream.batch('training',batch,count);report['proceduralBatches' if receipt.get('storage')=='procedural-replay' else 'rawBatches'].append(receipt);q,t=mx.array(q),mx.array(t);report['phase']='fit';publish()
   for offset in range(count):
    step=begin+offset;learning_rate=appearance_learning_rate(step,plan['steps'],plan['learningRate'],plan['cosineEndScale']);losses=pool.step(q[offset*batch:(offset+1)*batch],t[offset*batch:(offset+1)*batch],learning_rate)
   report['lastTrainingLoss']=float(losses[0].item());report['completedSteps']=begin+count;publish()
   if (begin+count)%plan['checkpointPeriod']==0 or begin+count==args.until:checkpoint(begin+count)
  report['phase']='source-close';publish();stream.close();stream=None;report['status']='passed';report['phase']='complete' if args.until==plan['steps'] else 'checkpoint-complete';report['completePlan']=args.until==plan['steps']
 except BaseException:
  report['status']='failed';report['error']=traceback.format_exc();raise
 finally:
  if stream:
   try:stream.close()
   except BaseException:
    report['sourceCloseError']=traceback.format_exc();report['status']='failed'
  publish()
 return report

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('config');parser.add_argument('output');parser.add_argument('--until',required=True,type=int);parser.add_argument('--resume');run(parser.parse_args())
