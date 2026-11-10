import unittest,importlib.util,copy,tempfile,subprocess,sys,json
from pathlib import Path
import numpy as np
spec=importlib.util.spec_from_file_location('exporter',Path(__file__).with_name('hand_replay_variants.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Variants(unittest.TestCase):
 def test_preserve_geometry_camera_and_recorded_frame(self):
  reg=np.zeros((21,778));reg[:,0]=1;v=np.arange(2334,dtype=float).reshape(778,3)/10000
  base={'captureId':'a','timeMs':123,'image':'/original.jpg','hands':[{'vertices':v.tolist(),'joints':(reg@v).tolist(),'cropBox':[0,0,10,10],'camera':{'translation':[.1,.2,.6],'intrinsics':[640,640,320,240],'fitRmsePx':2}}]*3}
  result=m.augment_frame(base,[v*2,v*3],reg)
  self.assertEqual(result['hands'][:3],base['hands']);self.assertEqual(result['timeMs'],123);self.assertEqual(result['image'],'/original.jpg');self.assertEqual(len(result['hands']),5)
  for h,want in zip(result['hands'][3:],[v*2,v*3]):
   np.testing.assert_array_equal(h['vertices'],want);np.testing.assert_allclose(np.array(h['joints'][0])+h['camera']['translation'],np.array(base['hands'][0]['joints'][0])+[.1,.2,.6]);self.assertNotIn('fitRmsePx',h['camera'])
 def test_reject_partial_and_wrong_capture(self):
  images=[{'captureId':'a','sha256':'x'}];row={'captureId':'a','input':images[0],'sourceSha256':'x','status':'observed','completePredictionValid':True,'verticesMeters':np.zeros((778,3)).tolist()}
  self.assertEqual(len(m.validate_rows([row],images)),1)
  with self.assertRaisesRegex(ValueError,'partial_payload'):m.validate_rows([],images)
  bad=copy.deepcopy(row);bad['captureId']='other'
  with self.assertRaisesRegex(ValueError,'input_identity'):m.validate_rows([bad],images)
  bad=copy.deepcopy(row);bad['verticesMeters']=[[0,0,0]]
  with self.assertRaisesRegex(ValueError,'invalid_vertices'):m.validate_rows([bad],images)
 def test_route_identity(self):
  report={'status':'observed','primaryOutputWritten':True,'inputCount':685,'completed':685,'effectiveRoute':'mobrecon_densestack_dsconv_cpu_replay','manifestSha256':'manifest','identity':{'device':'cpu','backend':'pytorch','decoder':'dsconv','checkpointSha256':'weights','jointRegressorSha256':'reg'}}
  m.validate_report(report,'weights','manifest','reg')
  for key,val in [('device','mps'),('checkpointSha256','wrong')]:
   bad=copy.deepcopy(report);bad['identity'][key]=val
   with self.assertRaisesRegex(ValueError,'replay_identity'):m.validate_report(bad,'weights','manifest','reg')
 def test_missing_input_replaces_old_success(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'export-report.json').write_text('{"status":"observed","oldMarker":true}')
   r=subprocess.run([sys.executable,str(Path(m.__file__)),'--input',str(p/'missing.json'),'--output',tmp,'--url-prefix','/scratch/test'],capture_output=True,text=True)
   self.assertNotEqual(r.returncode,0);report=json.loads((p/'export-report.json').read_text());self.assertEqual(report['status'],'failed');self.assertFalse(report['primaryOutputWritten']);self.assertIn('scriptSha256',report);self.assertNotIn('oldMarker',report)
if __name__=='__main__':unittest.main()
