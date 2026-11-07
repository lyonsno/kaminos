# kaminos-test: python
import hashlib,json,struct,sys,tempfile,unittest
from pathlib import Path
from threading import Thread
from unittest.mock import patch
from urllib.request import Request,urlopen
from urllib.error import HTTPError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve
class ConditioningHttp(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.mount=patch.dict(serve.BROWSE_ROOTS,{'image-conditioning':self.root});self.mount.start();self.server=serve.http.server.ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler);self.thread=Thread(target=self.server.serve_forever,daemon=True);self.thread.start();self.url=f'http://127.0.0.1:{self.server.server_port}'
 def tearDown(self):
  self.server.shutdown();self.server.server_close();self.thread.join();self.mount.stop();self.tmp.cleanup()
 def call(self,path,body=None):
  try:
   with urlopen(Request(self.url+path,data=body)) as r:return r.status,json.load(r)
  except HTTPError as e:return e.code,e.read()
 def body(self):
  header=json.dumps({'schema':'kaminos.conditioning-geometry.v1','width':2,'height':2,'metadata':{'cacheKey':'a'*64,'source':{'source':'/api/read?root=image-inbox&path=test.png','sha256':'b'*64},'producerSha256':'c'*64,'route':{'status':'real'}}}).encode();return struct.pack('<I',len(header))+header+b'\0'*((-len(header))%4)+struct.pack('<16f',*([1]*16))
 def test_roundtrip_and_incomplete_refusal(self):
  body=self.body();status,entry=self.call('/api/image-conditioning',body);self.assertEqual(status,200,entry);self.assertEqual(entry['sha256'],hashlib.sha256(body).hexdigest());self.assertEqual((self.root/(entry['sha256']+'.bin')).read_bytes(),body)
  with urlopen(self.url+entry['source']) as r:self.assertEqual(r.read(),body,'native geometry consumer receives exact binary bytes')
  status,cached=self.call('/api/image-conditioning?key='+'a'*64);self.assertEqual(status,200);self.assertEqual(cached,entry)
  status,_=self.call('/api/image-conditioning',body[:-4]);self.assertEqual(status,400)
  status,again=self.call('/api/image-conditioning?key='+'a'*64);self.assertEqual(again,entry)
 def test_missing_cache_is_explicit(self):
  status,value=self.call('/api/image-conditioning?key='+'f'*64);self.assertEqual(status,200,value);self.assertIsNone(value)
if __name__=='__main__':unittest.main()
