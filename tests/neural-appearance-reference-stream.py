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
