# kaminos-test: python
import copy,hashlib,importlib.util,pathlib,sys,tempfile,unittest
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'tools'))
from neural_appearance_source_stream import validate_batch_reply,load_batch_arrays
class StreamIdentity(unittest.TestCase):
 def test_reject_stale_partial_fallback_and_changed_source(self):
  identity={'sourceCommit':'a'*40,'sourceHash':'b'*64};request={'id':5,'kind':'training','batchSize':4,'batches':2}
  field={'path':'/caller/queries.f32','sha256':'c'*64,'bytes':8*8*4}
  valid={'schema':'kaminos.appearance-source-batch.v1','id':5,'rows':8,'kind':'training','batchSize':4,'batches':2,'seedBefore':41,'seedAfter':42,**identity,'route':'hardware','isFallbackAdapter':False,'queries':field,'labels':{**field,'path':'/caller/labels.f32','bytes':8*3*4}}
  self.assertEqual(validate_batch_reply(request,valid,identity),valid)
  changes=[lambda r:r.update(id=4),lambda r:r.update(rows=7),lambda r:r.update(kind='heldout'),lambda r:r.update(batchSize=8),lambda r:r.update(batches=1),lambda r:r.pop('seedAfter'),lambda r:r.update(sourceCommit='d'*40),lambda r:r.update(sourceHash='d'*64),lambda r:r.update(route='compiler-only'),lambda r:r.update(isFallbackAdapter=True),lambda r:r.pop('labels'),lambda r:r['queries'].update(bytes=1),lambda r:r['labels'].update(sha256='invalid')]
  for change in changes:
   with self.subTest(change=change):
    r=copy.deepcopy(valid);change(r)
    with self.assertRaises(ValueError):validate_batch_reply(request,r,identity)
 def test_raw_integrity_and_nonfinite_rejection(self):
  import numpy as np
  with tempfile.TemporaryDirectory() as directory:
   root=pathlib.Path(directory);reply={'rows':1}
   for key,array in [('queries',np.array([[.5,.5,0,0,1,0,0,1]],dtype='<f4')),('labels',np.array([[.1,.2,.3]],dtype='<f4'))]:
    payload=array.tobytes();file=root/key;file.write_bytes(payload);reply[key]={'path':str(file),'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload)}
   self.assertEqual(load_batch_arrays(reply)[0].shape,(1,8))
   file=root/'labels';file.write_bytes(b'bad')
   with self.assertRaisesRegex(ValueError,'digest'):load_batch_arrays(reply)
   payload=np.array([[np.nan,0,0]],dtype='<f4').tobytes();file.write_bytes(payload);reply['labels'].update(sha256=hashlib.sha256(payload).hexdigest())
   with self.assertRaisesRegex(ValueError,'Nonfinite'):load_batch_arrays(reply)
if __name__=='__main__':unittest.main()
