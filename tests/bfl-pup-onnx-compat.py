# kaminos-test: manual -- pinned optional ONNX export environment
"""Compare browser lowering to canonical Transformers5.20.2 math on small tensors."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np
import onnx
from onnx import helper as h,TensorProto as T,numpy_helper as nh
import onnxruntime as ort
import torch
from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5RMSNormGated,Qwen3_5TextRotaryEmbedding,apply_rotary_pos_emb
from transformers.models.qwen3_5.configuration_qwen3_5 import Qwen3_5TextConfig
spec=importlib.util.spec_from_file_location('compat',Path(__file__).parents[1]/'models/bfl-pup/onnx_browser_compat.py');c=importlib.util.module_from_spec(spec);spec.loader.exec_module(c)
def run(nodes,inputs,outputs,inits,feeds):
 model=h.make_model(h.make_graph(nodes,'tiny',inputs,outputs,inits),opset_imports=[h.make_opsetid('',22),h.make_opsetid('com.microsoft',1)],ir_version=10)
 c.browser_compatible(model)
 onnx.checker.check_model(model)
 return ort.InferenceSession(model.SerializeToString(),providers=['CPUExecutionProvider']).run(None,feeds)
class CompatTests(unittest.TestCase):
 def test_absent_legacy_window_means_unwindowed(self):
  for op in ['CausalConvWithState','LinearAttention']:
   model=h.make_model(h.make_graph([h.make_node(op,['x'],['y'],name='legacy',domain='com.microsoft',state_window=0)],'g',[],[]))
   c.browser_compatible(model)
   self.assertFalse(any(a.name=='state_window' for a in model.graph.node[0].attribute))
   model=h.make_model(h.make_graph([h.make_node(op,['x'],['y'],name='legacy',domain='com.microsoft',state_window=1)],'g',[],[]))
   with self.assertRaisesRegex(ValueError,'window'):c.browser_compatible(model)
 def test_grouped_delta_heads(self):
  q=np.arange(24,dtype=np.float32).reshape(1,3,8)/50;k=q*.6;v=np.arange(48,dtype=np.float32).reshape(1,3,16)/40
  state=np.zeros((1,4,4,4),np.float32);g=np.full((1,3,4),-.1,np.float32);beta=np.full((1,3,4),.3,np.float32)
  values={'q':q,'k':k,'v':v,'state':state,'g':g,'beta':beta}
  inputs=[h.make_tensor_value_info(n,T.FLOAT,list(a.shape)) for n,a in values.items()]
  outs=[h.make_tensor_value_info('y',T.FLOAT,[1,3,16]),h.make_tensor_value_info('present',T.FLOAT,[1,4,4,4])]
  result=run([h.make_node('LinearAttention',list(values),['y','present'],name='linear',domain='com.microsoft',q_num_heads=2,kv_num_heads=4,update_rule='gated_delta',scale=1.,state_window=0)],inputs,outs,[],values)
  qr=np.repeat(q.reshape(1,3,2,4),2,axis=2);kr=np.repeat(k.reshape(1,3,2,4),2,axis=2);vr=v.reshape(1,3,4,4);memory=state.copy();ys=[]
  for t in range(3):
   memory*=np.exp(g[:,t,:,None,None]);delta=vr[:,t]-np.einsum('bhd,bhdv->bhv',kr[:,t],memory)
   memory+=beta[:,t,:,None,None]*np.einsum('bhd,bhv->bhdv',kr[:,t],delta)
   ys.append(np.einsum('bhd,bhdv->bhv',qr[:,t],memory))
  np.testing.assert_allclose(result[0],np.stack(ys,axis=1).reshape(1,3,16),rtol=1e-5,atol=1e-6)
  np.testing.assert_allclose(result[1],memory,rtol=1e-5,atol=1e-6)
 def test_gate(self):
  a=np.linspace(-15,15,24,dtype=np.float16).reshape(1,6,4);b=a*.6;bias=np.array([-.4,.1,.8,-1],np.float32);scale=-np.exp(np.array([0,1,-1,.5],np.float32))
  out=run([h.make_node('LinearAttentionGate',['a','bias','scale','b'],['g','beta'],name='gate',domain='com.microsoft')],[h.make_tensor_value_info(n,T.FLOAT16,[1,6,4]) for n in ['a','b']],[h.make_tensor_value_info(n,T.FLOAT16,[1,6,4]) for n in ['g','beta']],[nh.from_array(bias,'bias'),nh.from_array(scale,'scale')],{'a':a,'b':b})
  expected=(torch.nn.functional.softplus(torch.from_numpy(a).float()+torch.from_numpy(bias))*torch.from_numpy(scale)).half().numpy()
  np.testing.assert_allclose(out[0],expected,rtol=.001,atol=.0001);np.testing.assert_allclose(out[1],torch.from_numpy(b).sigmoid().numpy(),rtol=.001,atol=.0001)
 def test_gated_norm(self):
  x=np.linspace(-2,2,48,dtype=np.float16).reshape(1,3,16);z=x*.7;weight=np.array([.5,1,1.25,2],np.float16)
  out=run([h.make_node('GatedRMSNorm',['x','w','z'],['y'],name='norm',domain='com.microsoft',epsilon=1e-6)],[h.make_tensor_value_info(n,T.FLOAT16,[1,3,16]) for n in ['x','z']],[h.make_tensor_value_info('y',T.FLOAT16,[1,3,16])],[nh.from_array(weight,'w')],{'x':x,'z':z})[0]
  ref=Qwen3_5RMSNormGated(4).half();ref.weight.data=torch.from_numpy(weight)
  expected=ref(torch.from_numpy(x).reshape(1,3,4,4),torch.from_numpy(z).reshape(1,3,4,4)).reshape(1,3,16).detach().numpy()
  np.testing.assert_allclose(out,expected,rtol=.002,atol=.001)
 def test_multiaxis_rotary_and_unrotated_tail(self):
  cfg=Qwen3_5TextConfig(head_dim=32,rope_parameters={'rope_type':'default','rope_theta':10000000,'partial_rotary_factor':.5,'mrope_section':[3,3,2],'mrope_interleaved':True})
  rotary=Qwen3_5TextRotaryEmbedding(cfg)
  pos=np.array([[[0,1,2],[3,4,5]],[[4,3,2],[2,1,0]],[[1,2,3],[5,2,7]]],np.int64)
  x=np.linspace(-1,1,2*3*2*32,dtype=np.float32).reshape(2,3,64)
  angles=torch.arange(16).float()[:,None]*rotary.inv_freq[None,:]
  out=run([h.make_node('MRotaryEmbedding',['x','p','cos','sin'],['y'],name='rope',domain='com.microsoft',num_heads=2,rotary_embedding_dim=16,interleaved=0,mrope_layout=1,mrope_section=[3,3,2],is_packed_batching=0)],[h.make_tensor_value_info('x',T.FLOAT,[2,3,64]),h.make_tensor_value_info('p',T.INT64,[3,2,3])],[h.make_tensor_value_info('y',T.FLOAT,[2,3,64])],[nh.from_array(angles.cos().numpy(),'cos'),nh.from_array(angles.sin().numpy(),'sin')],{'x':x,'p':pos})[0]
  q=torch.from_numpy(x).reshape(2,3,2,32);co,si=rotary(q,torch.from_numpy(pos));expected=apply_rotary_pos_emb(q,q,co,si,unsqueeze_dim=2)[0].numpy().reshape(x.shape)
  np.testing.assert_allclose(out,expected,rtol=1e-6,atol=1e-6)
  np.testing.assert_array_equal(out.reshape(2,3,2,32)[...,16:],q.numpy()[...,16:])
if __name__=='__main__':unittest.main()
