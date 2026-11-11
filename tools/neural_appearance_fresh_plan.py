"""Published direct-optimization plan; finite caller-selected checkpoint phases.

NVlabs/neuralappearance@305b4b9c train.py: training_bsdf_diropt explicitly
requires one instance and unnormalized latents. Multi-instance encoding is separate.
"""
import math

def validate_plan(options,until):
 p={'steps':100000,'batch':65536,'batchesPerBlock':64,'checkpointPeriod':128,'resolution':256,'seed':41,'candidates':1,'latentNormalization':False,'learningRate':.001,'cosineEndScale':.01,'adamEpsilon':1e-7,'lossKind':'L1WithPowerLog','lossPower':3.,**options}
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
 raw=((until-start)*plan['batch']+(heldout if start==0 else 0))*11*4
 parameters=plan['resolution']**2*8*4+(12*8+24*16+16+16*16+16+16*3+3)*4
 checkpoints=sum(1 for step,number,_ in blocks(plan,start,until) if (step+number)%plan['checkpointPeriod']==0 or step+number==until)+(1 if start==0 else 0)
 archive=checkpoints*(parameters*4+heldout*3*4+65536)
 return {'rawResponseBytes':raw,'checkpointEstimateBytes':archive,'requiredBytes':raw+archive,'estimate':'All rows retained; parameter/optimizer ZIP and decoder JSON overhead estimated'}
