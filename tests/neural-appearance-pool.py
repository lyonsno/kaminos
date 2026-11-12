# kaminos-test: python
import unittest,importlib.util,pathlib,sys,tempfile
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))
@unittest.skipUnless(importlib.util.find_spec('mlx'),'Optional MLX training dependency')
class CandidateTraining(unittest.TestCase):
 def test_independent_candidates_and_pruned_optimizer_custody(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_pool import CandidatePool
  from neural_appearance_mlx import Appearance
  mx.set_default_device(mx.cpu);q=mx.array([[.25,.25,0,0,1,0,0,1],[.75,.75,.3,0,(1-.09)**.5,-.3,0,(1-.09)**.5]]);target=mx.full((2,3),.4)
  pool=CandidatePool(2,16,[11,29]);other=CandidatePool(2,16,[29]);initial=np.asarray(pool.predict(q));self.assertEqual(initial.shape,(2,2,3))
  for i,seed in enumerate([11,29]):np.testing.assert_allclose(initial[i],np.asarray(Appearance(2,16,seed)(q)),rtol=1e-6,atol=1e-7)
  loss=np.asarray(pool.step(q,target,.001));self.assertEqual(loss.shape,(2,));self.assertTrue(np.isfinite(loss).all());other.step(q,target,.001)
  pool.prune(1,[1.,.1]);self.assertEqual(pool.seeds,[29]);pool.step(q,target,.001);other.step(q,target,.001)
  np.testing.assert_allclose(np.asarray(pool.predict(q)),np.asarray(other.predict(q)),rtol=1e-6,atol=1e-7)
  self.assertFalse(np.array_equal(initial[1],np.asarray(pool.predict(q))[0]))
 def test_source_adam_bias_and_invalid_gradient_convention(self):
  import mlx.core as mx
  import mlx.optimizers as optim
  import numpy as np
  from neural_appearance_pool import SourceAdam
  mx.set_default_device(mx.cpu);p={'x':mx.array([1.])};g={'x':mx.array([2.])};expected=1.-.001*2./(2.+1e-7)
  fixed=SourceAdam().apply_gradients(g,p);legacy=optim.Adam(.001,eps=1e-7).apply_gradients(g,p)
  self.assertAlmostEqual(float(fixed['x'].item()),expected,places=7);self.assertGreater(abs(float(legacy['x'].item())-expected),.001)
  safe=SourceAdam().apply_gradients({'x':mx.array([float('nan')])},p);np.testing.assert_array_equal(np.asarray(safe['x']),[1.])
 def test_export_preserves_continuing_candidate_parameters(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_pool import CandidatePool
  mx.set_default_device(mx.cpu);q=mx.array([[.25,.25,0,0,1,0,0,1]]);t=mx.full((1,3),.3);a=CandidatePool(2,16,[1,2]);b=CandidatePool(2,16,[1,2])
  a.step(q,t,.001);b.step(q,t,.001)
  with tempfile.TemporaryDirectory() as out:a.export(1,out,{'kind':'unit-test'})
  a.step(q,t,.001);b.step(q,t,.001);np.testing.assert_allclose(np.asarray(a.predict(q)),np.asarray(b.predict(q)),rtol=1e-7,atol=1e-8)
 def test_resume_preserves_candidates_and_optimizer(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_pool import CandidatePool
  mx.set_default_device(mx.cpu);q=mx.array([[.25,.25,0,0,1,0,0,1]]);t=mx.full((1,3),.3);a=CandidatePool(2,16,[3,7]);a.step(q,t,.001)
  with tempfile.TemporaryDirectory() as out:
   file=str(pathlib.Path(out)/'state.npz');a.save_state(file);b=CandidatePool(2,16,[3,7]);b.load_state(file);a.step(q,t,.001);b.step(q,t,.001)
   np.testing.assert_allclose(np.asarray(a.predict(q)),np.asarray(b.predict(q)),rtol=1e-7,atol=1e-8)
 def test_published_direct_initialization(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_mlx import Appearance
  mx.set_default_device(mx.cpu);model=Appearance(2,16,41,recipe='published-direct');np.testing.assert_array_equal(np.asarray(model.latents),np.zeros((4,8)))
  rng=np.random.RandomState(41)
  for layer in [model.rotation,*model.layers]:
   outputs,inputs=layer.weight.shape;bound=(6/(inputs+outputs))**.5
   np.testing.assert_array_equal(np.asarray(layer.weight),rng.uniform(-bound,bound,(outputs,inputs)).astype(np.float32))
   if 'bias' in layer:np.testing.assert_array_equal(np.asarray(layer.bias),np.zeros(outputs))
  self.assertFalse(model.checkpoint()['latents']['normalize'])
 def test_schedule_boundaries_and_no_silent_candidate_loss(self):
  from neural_appearance_pool import scheduled_value
  self.assertEqual([scheduled_value([64,16,4,1],i,100000) for i in [0,24999,25000,49999,50000,99999,100000]],[64,64,16,16,4,1,1])
 def test_large_decoder_trains_exports_and_resumes_without_small_fallback(self):
  import json
  import mlx.core as mx
  import numpy as np
  from neural_appearance_pool import CandidatePool
  mx.set_default_device(mx.cpu);q=mx.array([[.25,.25,0,0,1,0,0,1],[.75,.75,.3,0,(1-.09)**.5,-.3,0,(1-.09)**.5]]);t=mx.full((2,3),.4)
  pool=CandidatePool(2,16,[41],recipe='published-direct',hidden_layers=[128]*4)
  self.assertEqual([tuple(l.weight.shape) for l in pool.model.layers],[(128,24),(128,128),(128,128),(128,128),(3,128)])
  before=np.asarray(pool.predict(q));self.assertTrue(np.isfinite(before).all());pool.step(q,t,.001)
  self.assertFalse(np.array_equal(before,np.asarray(pool.predict(q))))
  with tempfile.TemporaryDirectory() as out:
   exported=pool.export(0,out,{'kind':'unit-test'});raw=json.loads(pathlib.Path(exported['path']).read_text())
   self.assertEqual(raw['decoder']['hidden_layers'],[128]*4);self.assertEqual(len(raw['decoder']['_params']['network']['mlp_layers']),5)
   file=str(pathlib.Path(out)/'state.npz');pool.save_state(file)
   resumed=CandidatePool(2,16,[41],recipe='published-direct',hidden_layers=[128]*4);resumed.load_state(file)
   pool.step(q,t,.001);resumed.step(q,t,.001);np.testing.assert_array_equal(np.asarray(pool.predict(q)),np.asarray(resumed.predict(q)))
   small=CandidatePool(2,16,[41],recipe='published-direct')
   with self.assertRaisesRegex(ValueError,'architecture'):small.load_state(file)
 def test_explicit_small_architecture_preserves_both_existing_initializations(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_mlx import Appearance
  from mlx.utils import tree_flatten
  mx.set_default_device(mx.cpu)
  for recipe in ['legacy','published-direct']:
   implicit=Appearance(2,16,41,recipe=recipe);explicit=Appearance(2,16,41,recipe=recipe,hidden_layers=[16,16])
   for (ka,a),(kb,b) in zip(tree_flatten(implicit.parameters()),tree_flatten(explicit.parameters())):
    self.assertEqual(ka,kb);np.testing.assert_array_equal(np.asarray(a),np.asarray(b))
if __name__=='__main__':unittest.main()
