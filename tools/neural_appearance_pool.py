"""Vectorized independent appearance candidates using the released pruning schedule.

Canonical schedule/pruning/Adam equations: NVlabs/neuralappearance@305b4b9c.
Float32 MLX direct-latent optimization; encoder and FP16 gradient scaling are not used.
"""
import math
import numpy as np
import mlx.core as mx
import mlx.optimizers as optim
from mlx.utils import tree_map,tree_flatten,tree_unflatten
from neural_appearance_mlx import Appearance,appearance_response_loss


def scheduled_value(values,iteration,iterations):
 if not values or any(not isinstance(x,int) or x<1 for x in values) or iteration<0 or iterations<=0:raise ValueError('Positive schedule values and phase iterations required')
 return values[min(int(iteration/(iterations/len(values))),len(values)-1)]


class SourceAdam(optim.Adam):
 def __init__(self,learning_rate=.001,epsilon=1e-7):
  super().__init__(learning_rate,betas=[.9,.999],eps=epsilon,bias_correction=True)
 def init_single(self,parameter,state):
  # The public state setter asks MLX to initialize again. Keep retained moments
  # after candidate pruning; initialize only a genuinely absent parameter state.
  if 'm' in state and 'v' in state and state['m'].shape==parameter.shape and state['v'].shape==parameter.shape:return
  super().init_single(parameter,state)
 def apply_single(self,gradient,parameter,state):
  # Author ignore_invalid_gradients sets invalid entries to zero, then applies
  # ordinary moment decay and bias correction (it does not skip the update).
  gradient=mx.where(mx.isfinite(gradient),gradient,0)
  return super().apply_single(gradient,parameter,state)


class CandidatePool:
 def __init__(self,resolution,width,seeds,*,epsilon=1e-7,loss_kind='L1WithPowerLog',loss_power=3,recipe='legacy',hidden_layers=None):
  if not seeds or len(set(seeds))!=len(seeds) or any(not isinstance(x,int) or x<0 for x in seeds):raise ValueError('Distinct nonnegative candidate seeds required')
  models=[Appearance(resolution,width,seed,recipe=recipe,hidden_layers=hidden_layers) for seed in seeds];self.model=models[0];self.seeds=list(seeds)
  self.parameters=tree_map(lambda *xs:mx.stack(xs),*[m.parameters() for m in models]);self.optimizer=SourceAdam(epsilon=epsilon)
  def forward(parameters,queries):self.model.update(parameters);return self.model(queries)
  def objective(parameters,queries,labels):return appearance_response_loss(forward(parameters,queries),labels,loss_kind,loss_power)
  self.forward=mx.vmap(forward,in_axes=(0,None));gradient=mx.vmap(mx.value_and_grad(objective),in_axes=(0,None,None));self.gradient=gradient if mx.default_device()==mx.cpu else mx.compile(gradient)
 def predict(self,queries):return self.forward(self.parameters,queries)
 def step(self,queries,labels,learning_rate):
  if not math.isfinite(learning_rate) or learning_rate<=0:raise ValueError('Positive learning rate required')
  losses,gradients=self.gradient(self.parameters,queries,labels);self.optimizer.learning_rate=learning_rate;self.parameters=self.optimizer.apply_gradients(gradients,self.parameters);mx.eval(self.parameters,self.optimizer.state,losses)
  if not bool(mx.all(mx.isfinite(losses)).item()):raise ValueError('Nonfinite candidate objective')
  return losses
 def prune(self,count,losses):
  values=np.asarray(losses)
  if not isinstance(count,int) or count<1 or count>len(self.seeds) or values.shape!=(len(self.seeds),) or not np.isfinite(values).all():raise ValueError('Finite per-candidate losses and valid survivor count required')
  indices=mx.array(np.argsort(values,kind='stable')[:count].astype(np.int32));old_count=len(self.seeds)
  self.parameters=tree_map(lambda x:x[indices],self.parameters)
  self.optimizer.state=tree_map(lambda x:x[indices] if isinstance(x,mx.array) and x.ndim and x.shape[0]==old_count else x,self.optimizer.state)
  self.seeds=[self.seeds[int(i)] for i in np.asarray(indices)];mx.eval(self.parameters,self.optimizer.state)
  return values[np.asarray(indices)]
 def export(self,index,out,provenance):
  if not isinstance(index,int) or index<0 or index>=len(self.seeds):raise ValueError('Retained candidate index required')
  self.model.update(tree_map(lambda x:x[index],self.parameters))
  return self.model.save_bundle(out,{**provenance,'candidateSeed':self.seeds[index]})
 def save_state(self,path):
  mx.eval(self.parameters,self.optimizer.state)
  arrays={'parameters:'+k:v for k,v in tree_flatten(self.parameters)};arrays.update({'optimizer:'+k:v for k,v in tree_flatten(self.optimizer.state)})
  mx.savez(path,**arrays)
 def load_state(self,path):
  arrays=mx.load(path)
  parameters=[(k.removeprefix('parameters:'),v) for k,v in arrays.items() if k.startswith('parameters:')]
  expected={k:tuple(v.shape) for k,v in tree_flatten(self.parameters)}
  if {k:tuple(v.shape) for k,v in parameters}!=expected:raise ValueError('Resume parameter architecture changed')
  self.parameters=tree_unflatten(parameters)
  self.optimizer.state=tree_unflatten([(k.removeprefix('optimizer:'),v) for k,v in arrays.items() if k.startswith('optimizer:')])
  if any(x.shape[0]!=len(self.seeds) for _,x in tree_flatten(self.parameters)):raise ValueError('Resume candidate count changed')
  mx.eval(self.parameters,self.optimizer.state)
