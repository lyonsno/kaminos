"""Published direct-optimization plan; finite caller-selected checkpoint phases.

NVlabs/neuralappearance@305b4b9c train.py: training_bsdf_diropt explicitly
requires one instance and unnormalized latents. Multi-instance encoding is separate.
"""
import math

def validate_plan(options,until):
 p={'steps':100000,'batch':65536,'batchesPerBlock':64,'checkpointPeriod':128,'resolution':256,'seed':41,'candidates':1,'latentNormalization':False,'learningRate':.001,'cosineEndScale':.01,'adamEpsilon':1e-7,'lossKind':'L1WithPowerLog','lossPower':3.,'hiddenLayers':[16,16],'sourceBatchStorage':'raw-arrays',**options}
 if p['sourceBatchStorage'] not in ['raw-arrays','procedural-replay']:raise ValueError('Explicit source batch storage required')
 if not isinstance(p['hiddenLayers'],list) or not p['hiddenLayers'] or any(type(w) is not int or w<1 for w in p['hiddenLayers']):raise ValueError('Positive integer decoder hidden layers required')
 for k in ['steps','batch','batchesPerBlock','checkpointPeriod','resolution','seed']:
  if type(p[k]) is not int or p[k]<(0 if k=='seed' else 1):raise ValueError('Valid direct optimization '+k+' required')
 if p['candidates']!=1 or p['latentNormalization'] is not False:raise ValueError('Published direct optimization requires one instance and unnormalized latents')
 if math.isqrt(p['batch'])**2!=p['batch']:raise ValueError('Square stratified batch required')
 if type(until) is not int or until<1 or until>p['steps'] or until!=p['steps'] and until%p['checkpointPeriod']:raise ValueError('Stop at a retained checkpoint or the complete plan')
 for k in ['learningRate','adamEpsilon','lossPower']:
  if not math.isfinite(p[k]) or p[k]<=0:raise ValueError('Positive finite '+k+' required')
 if p['lossKind']!='L1WithPowerLog' or not math.isfinite(p['cosineEndScale']) or not 0<=p['cosineEndScale']<=1:raise ValueError('Released power-log loss and cosine schedule required')
 return p

def blocks(plan,start,until):
 step=start
 while step<until:
  count=min(plan['batchesPerBlock'],plan['checkpointPeriod']-step%plan['checkpointPeriod'],until-step)
  yield step,count,plan['batch'];step+=count

def storage_bytes(plan,start,until,heldout):
 # All input rows and labels survive. Checkpoints include the latent bundle,
 # raw predictions and complete parameters/Adam state. JSON/ZIP allowances are
 # estimates, explicitly surfaced; they never cap stored results.
 procedural=plan['sourceBatchStorage']=='procedural-replay'
 regenerable=(until-start)*plan['batch']*11*4 if procedural else 0
 raw=((0 if procedural else (until-start)*plan['batch'])+(heldout if start==0 else 0))*11*4
 sizes=[24,*plan['hiddenLayers'],3]
 parameters=(plan['resolution']**2*8+12*8+sum(i*o+o for i,o in zip(sizes,sizes[1:])))*4
 checkpoints=sum(1 for step,number,_ in blocks(plan,start,until) if (step+number)%plan['checkpointPeriod']==0 or step+number==until)+(1 if start==0 else 0)
 archive=checkpoints*(parameters*4+heldout*3*4+65536)
 # Procedural recipes retain both full RNG states and batch digests; 16KiB is
 # an estimate per generated block, not a cap on any recipe or output.
 recipes=sum(1 for _ in blocks(plan,start,until))*16384 if procedural else 0
 return {'rawResponseBytes':raw,'regenerableResponseBytes':regenerable,'parameterBytes':parameters,'checkpointEstimateBytes':archive,'recipeEstimateBytes':recipes,'requiredBytes':raw+archive+recipes,'estimate':('Source inputs/RNG/identities/digests retained for complete regeneration; raw heldout retained. ' if procedural else 'All raw rows retained. ')+'Parameter/optimizer ZIP, JSON and recipe overhead estimated; no output cap.'}
