# kaminos-test: python
import unittest,importlib.util,pathlib,sys,tempfile,json
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))

@unittest.skipUnless(importlib.util.find_spec('mlx'),'MLX is an optional Metal training dependency')
class PortableTraining(unittest.TestCase):
 def test_decoder_mapping_and_export(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_mlx import Appearance,smelu
  mx.set_default_device(mx.cpu)
  m=Appearance(2,16,1)
  for l in m.layers:l.weight=mx.zeros_like(l.weight);l.bias=mx.zeros_like(l.bias)
  m.layers[-1].bias=mx.array([-2.,-1.,0.])
  q=mx.array([[.25,.25,0,0,1,0,0,1],[.75,.25,0,0,1,.6,0,.8],[.25,.75,0,0,-1,0,0,1]])
  actual=np.asarray(m(q));expected=np.array([1e5*np.exp(-2)/(1e5+np.exp(-2)),1e5*np.exp(-1)/(1e5+np.exp(-1)),1e5/(1+1e5)])
  np.testing.assert_allclose(actual[:2],np.repeat(expected[None],2,axis=0),rtol=1e-6,atol=1e-7);np.testing.assert_array_equal(actual[2],[0,0,0])
  np.testing.assert_allclose(np.asarray(smelu(mx.array([-1.,0.,1.]))),[-.01,.12375,1.],atol=1e-6)
  with tempfile.TemporaryDirectory() as d:
   result=m.save_bundle(d,{'kind':'unit-test'});raw=json.loads(pathlib.Path(result['path']).read_text())
   self.assertEqual(raw['decoder']['hidden_layers'],[16,16]);self.assertEqual(len(raw['decoder']['_params']['network']['mlp_layers']),3)
   self.assertEqual((pathlib.Path(d)/'latents.f32').stat().st_size,2*2*8*4)
 def test_tiny_negative_uv_stays_in_wrapped_texel(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_mlx import Appearance
  mx.set_default_device(mx.cpu);m=Appearance(2,16,41)
  q=mx.array([[.25,.99999,0,0,1,0,0,1],[.25,-1e-9,0,0,1,0,0,1]])
  actual=np.asarray(m(q));np.testing.assert_allclose(actual[0],actual[1],rtol=1e-7,atol=1e-8)
 def test_optimizer_reduces_response_error(self):
  import mlx.core as mx
  import mlx.nn as nn
  import mlx.optimizers as optim
  from neural_appearance_mlx import Appearance
  mx.set_default_device(mx.cpu);m=Appearance(2,16,3);q=mx.array([[.25,.25,0,0,1,0,0,1]]*8);target=mx.full((8,3),.4)
  def loss(m):return mx.mean((m(q)-target)**2)
  initial=float(loss(m).item());update=nn.value_and_grad(m,loss);optimizer=optim.Adam(.01)
  for _ in range(20):value,g=update(m);optimizer.update(m,g);mx.eval(m.parameters(),optimizer.state,value)
  self.assertLess(float(loss(m).item()),initial)

if __name__=='__main__':unittest.main()
