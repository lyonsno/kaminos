# kaminos-test: python
import importlib.util,json,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))

class SourceRoute(unittest.TestCase):
 def test_geometry_cannot_silently_adopt_procedural_retention(self):
  from neural_appearance_source_stream import create_source_stream,SourceStream
  with tempfile.TemporaryDirectory() as out:
   c=pathlib.Path(out)/'config.json';c.write_text(json.dumps({'capture':{'kind':'geometry'},'fit':{'sourceBatchStorage':'procedural-replay'}}))
   with self.assertRaisesRegex(ValueError,'geometry'):create_source_stream('.',c,out,'a','b')
   c.write_text(json.dumps({'capture':{},'fit':{}}));self.assertIsInstance(create_source_stream('.',c,out,'a','b'),SourceStream)

@unittest.skipUnless(importlib.util.find_spec('mlx'),'Optional MLX dependency')
class ProceduralFailure(unittest.TestCase):
 def test_coarse_labels_integrate_the_published_native_texel_footprint(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_reference_stream import ReferenceStream
  mx.set_default_device(mx.cpu)
  class Surface:
   def __init__(self):self.calls=[]
   def evaluate(self,q):
    self.calls.append(np.asarray(q));return mx.broadcast_to(q[:,:1]**2,(len(q),3))
  with tempfile.TemporaryDirectory() as out:
   stream=ReferenceStream('.',pathlib.Path(out)/'config.json',out,'a','b');stream.report={'status':'running','requests':[]};stream.rng={'training':np.random.Generator(np.random.PCG64(41))};stream.states={};stream.resolution=512;stream.teacher=Surface();stream.mip_level=3;stream.source_resolution=4096;stream.prefilter_samples={'training':64,'heldout':256};stream.ready={'route':'mlx-metal-ported-reference','runtime':{},'footprint':{}}
   (queries,labels),receipt=stream.batch('training',4,1)
   self.assertEqual(len(stream.teacher.calls),64,'mip3 labels must integrate64 authored responses, rather than one stride-eight point lookup')
   samples=np.stack(stream.teacher.calls)
   self.assertTrue(np.all((samples[:,:,:2]*4096)%1==.5));self.assertGreater(np.unique(samples[:,:,:2].reshape(-1,2),axis=0).shape[0],4)
   np.testing.assert_array_equal(samples[:,:,2:],np.broadcast_to(np.asarray(queries)[None,:,2:],samples[:,:,2:].shape))
   np.testing.assert_allclose(np.asarray(labels)[:,0],np.mean(samples[:,:,0]**2,axis=0),rtol=2e-6)
 def test_failed_source_batch_stays_failed_after_close(self):
  import mlx.core as mx
  import numpy as np
  from neural_appearance_reference_stream import ReferenceStream
  mx.set_default_device(mx.cpu)
  class Broken:
   def evaluate(self,q):raise RuntimeError('specific teacher failure')
  with tempfile.TemporaryDirectory() as out:
   stream=ReferenceStream('.',pathlib.Path(out)/'config.json',out,'a','b');stream.report={'status':'running','phase':'waiting-request','requests':[]};stream.rng={'training':np.random.Generator(np.random.PCG64(41))};stream.states={};stream.resolution=2;stream.teacher=Broken()
   with self.assertRaisesRegex(RuntimeError,'specific teacher failure'):stream.batch('training',4,1)
   stream.close();r=json.loads((pathlib.Path(out)/'report.json').read_text());self.assertEqual(r['status'],'failed');self.assertEqual(r['phase'],'batch-failed');self.assertIn('specific teacher failure',r['error'])

if __name__=='__main__':unittest.main()
