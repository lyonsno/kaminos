# kaminos-test: python
import importlib.util,pathlib,sys,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))
class FreshPlan(unittest.TestCase):
 def test_source_supported_direct_route_and_complete_blocks(self):
  from neural_appearance_fresh_plan import validate_plan,blocks
  options={'steps':100000,'batch':65536,'batchesPerBlock':64,'checkpointPeriod':128,'resolution':256,'seed':41,'candidates':1,'latentNormalization':False}
  p=validate_plan(options,128);self.assertEqual(list(blocks(p,0,128)),[(0,64,65536),(64,64,65536)])
  self.assertEqual(list(blocks(p,128,256)),[(128,64,65536),(192,64,65536)])
  for delta in [{'candidates':64},{'latentNormalization':True},{'batch':3},{'checkpointPeriod':0}]:
   with self.subTest(delta=delta),self.assertRaises(ValueError):validate_plan({**options,**delta},128)
  with self.assertRaises(ValueError):validate_plan(options,129)
 def test_storage_accounts_for_all_raw_rows_and_resume(self):
  from neural_appearance_fresh_plan import validate_plan,storage_bytes
  p=validate_plan({'steps':4,'batch':4,'batchesPerBlock':2,'checkpointPeriod':2,'resolution':2,'seed':41,'candidates':1,'latentNormalization':False},4)
  size=storage_bytes(p,0,4,4);self.assertEqual(size['rawResponseBytes'],(4*4+4)*11*4);self.assertGreater(size['requiredBytes'],size['rawResponseBytes'])
 def test_large_published_decoder_is_explicit_and_storage_counts_it(self):
  from neural_appearance_fresh_plan import validate_plan,storage_bytes
  small=validate_plan({'resolution':2},128);large=validate_plan({'resolution':2,'hiddenLayers':[128,128,128,128]},128)
  self.assertEqual(small['hiddenLayers'],[16,16]);self.assertEqual(large['hiddenLayers'],[128]*4)
  self.assertEqual(storage_bytes(large,0,128,4)['parameterBytes'],(2*2*8+53219)*4)
  self.assertGreater(storage_bytes(large,0,128,4)['checkpointEstimateBytes'],storage_bytes(small,0,128,4)['checkpointEstimateBytes'])
  for value in [[],[0],[True],[-1],[16.5],'128,128']:
   with self.subTest(value=value),self.assertRaises(ValueError):validate_plan({'hiddenLayers':value},128)
if __name__=='__main__':unittest.main()
