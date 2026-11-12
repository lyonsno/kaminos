# kaminos-test: python
import importlib.util,unittest,pathlib,sys
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))

@unittest.skipUnless(importlib.util.find_spec('mlx'),'Optional MLX dependency')
class PatternedReference(unittest.TestCase):
 def setUp(self):
  import mlx.core as mx
  mx.set_default_device(mx.cpu)
 def test_source_graph_color_and_roughness_are_not_reinterpreted(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_patterned_metal import material_response,artistic_ior
  wi=mx.array([[0.,0.,1.]]);normal=wi;rgb=mx.array([[.25,.36,.49]])
  n,k=artistic_ior(rgb)
  np.testing.assert_allclose(np.asarray(((n-1)**2+k*k)/((n+1)**2+k*k)),np.asarray(rgb),rtol=1e-6)
  # MaterialX roughness=.5 -> GGX alpha=.25; normal-incidence projected
  # microfacet lobe is D*F/4, followed by the published analytic compensation.
  out=material_response(rgb,mx.array([.5]),mx.array([1.]),normal,wi,wi)
  self.assertTrue(np.isfinite(np.asarray(out)).all())
  np.testing.assert_allclose(np.asarray(out),[[.3539311352251935,.5322304581169113,.7607299672376827]],rtol=2e-6)
 def test_bilinear_repeat_and_graph_v_flip_preserve_native_detail(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_patterned_metal import sample_map
  pixels=mx.array([[[0],[64]],[[128],[255]]],dtype=mx.uint8)
  uv=mx.array([[.25,.75],[.75,.75],[.25,.25],[.75,.25],[1.25,.75],[.5,.5]])
  values=np.asarray(sample_map(pixels,uv))[:,0]
  np.testing.assert_allclose(values,np.array([0,64,128,255,0,111.75])/255,rtol=1e-6,atol=1e-7)
 def test_projected_response_hemispheres_and_directional_character(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_patterned_metal import material_response
  color=mx.full((3,3),.3);rough=mx.full((3,),.25);metal=mx.ones((3,));n=mx.array([[0.,0.,1.]]*3)
  wi=mx.array([[0.,0.,1.],[.6,0.,.8],[0.,0.,-1.]]);wo=mx.array([[0.,0.,1.],[-.6,0.,.8],[0.,0.,1.]])
  actual=np.asarray(material_response(color,rough,metal,n,wi,wo));self.assertTrue(np.isfinite(actual).all());np.testing.assert_array_equal(actual[2],0);self.assertGreater(float(actual[1].mean()),float(actual[0].mean()))
 def test_reference_reuses_the_response_of_identical_coarse_queries(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_patterned_metal import filtered_response,reference_footprint
  q=np.tile(np.array([[.25,.25,0,0,1,0,0,1]],np.float32),(8,1))
  evaluate=lambda x:mx.broadcast_to(x[:,:1]**2,(len(x),3))
  result=np.asarray(filtered_response(evaluate,q,np.random.Generator(np.random.PCG64(41)),reference_footprint(512),reference=True))
  np.testing.assert_array_equal(result,np.broadcast_to(result[0],result.shape),err_msg='A shared nearest-texel query must not acquire eight independent MonteCarlo colors')
 def test_filter_submits_one_batch_without_reducing_the_sample_count(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_patterned_metal import filtered_response,reference_footprint
  calls=[]
  def evaluate(q):
   calls.append(np.asarray(q));return mx.broadcast_to(q[:,:1]**2,(len(q),3))
  q=np.array([[.25,.25,0,0,1,0,0,1],[.75,.75,0,0,1,0,0,1]],np.float32)
  rng=np.random.Generator(np.random.PCG64(41));state=rng.bit_generator.state
  result=np.asarray(filtered_response(evaluate,q,rng,reference_footprint(512)))
  self.assertEqual(len(calls),1,'64 samples must be submitted together, rather than64 host/device evaluations')
  self.assertEqual(len(calls[0]),64*len(q));samples=calls[0].reshape(64,len(q),8)
  np.testing.assert_allclose(result[:,0],np.mean(samples[:,:,0]**2,axis=0),rtol=2e-6)
  other=np.random.Generator(np.random.PCG64());other.bit_generator.state=state
  np.testing.assert_array_equal(result,np.asarray(filtered_response(evaluate,q,other,reference_footprint(512))))
 def test_native_and_coarse_footprints_match_published_sigma(self):
  from neural_appearance_patterned_metal import reference_footprint
  point=reference_footprint(4096);coarse=reference_footprint(512)
  self.assertEqual(point['mode'],'point');self.assertEqual(point['referenceSamples'],1)
  self.assertEqual(coarse['mipLevel'],3);self.assertEqual(coarse['mode'],'gaussian-response');self.assertAlmostEqual(coarse['sigmaUV'],.65*4/4096);self.assertEqual(coarse['trainingSamples'],64);self.assertEqual(coarse['referenceSamples'],256)
  for resolution in [0,513,8192,512.]:
   with self.assertRaises(ValueError):reference_footprint(resolution)
 def test_query_replay_and_point_footprint_are_explicit(self):
  import numpy as np
  from neural_appearance_patterned_metal import reference_queries
  a=np.random.Generator(np.random.PCG64(41));state=a.bit_generator.state;q=reference_queries(a,1024,512)
  b=np.random.Generator(np.random.PCG64());b.bit_generator.state=state
  np.testing.assert_array_equal(q,reference_queries(b,1024,512));self.assertTrue(np.all((q[:,:2]*512)%1==.5));self.assertGreater(np.unique(q[:,0]).size,64)

if __name__=='__main__':unittest.main()
