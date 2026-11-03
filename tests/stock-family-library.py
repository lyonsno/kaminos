# kaminos-test: python
import copy, hashlib, http.client, json, sys, tempfile, threading, unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve

class StockLibrary(unittest.TestCase):
 def test_internal_family_roundtrip_updates_and_conflicts(self):
  with tempfile.TemporaryDirectory() as temporary:
   root=Path(temporary);data=b'source fixture';sha=hashlib.sha256(data).hexdigest();(root/(sha+'.glb')).write_bytes(data)
   source={'url':f'/api/read?root=generated-meshes&path={sha}.glb','sha256':sha,'profile':{'min':-.5,'max':.5,'xMin':-.1,'xMax':.1,'locks':[]}}
   recipe={'schema':'kaminos.stock-family.v1','source':source,'sources':[source],'variants':[{'id':'short','label':'Short','length':.7,'bend':0,'protect':True}]}
   with patch.dict(serve.BROWSE_ROOTS,{'generated-meshes':root}):
    server=ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    def request(path,payload=None):
     c=http.client.HTTPConnection(*server.server_address);c.request('POST' if payload is not None else 'GET',path,json.dumps(payload) if payload is not None else None,{'Content-Type':'application/json'});r=c.getresponse();body=r.read();c.close();return r.status,json.loads(body)
    try:
     status,saved=request('/api/stock-families',{'name':'Workshop channels','recipe':recipe});self.assertEqual(status,200,saved)
     self.assertEqual(saved['schema'],'kaminos.stock-family-asset.v1');self.assertEqual(saved['recipe'],recipe)
     catalog=request('/api/authoring-assets?collection=generated-meshes')[1];entry=next(e for e in catalog['entries'] if e['kind']=='stock-family')
     self.assertEqual(entry['label'],'Workshop channels');self.assertEqual(request(entry['source'])[1],saved)
     changed=copy.deepcopy(recipe);changed['variants'][0]['length']=2
     payload={'id':saved['id'],'revision':saved['revision'],'name':'Workshop channels','recipe':changed}
     status,updated=request('/api/stock-families',payload);self.assertEqual(status,200,updated);self.assertEqual(updated['id'],saved['id']);self.assertNotEqual(updated['revision'],saved['revision'])
     self.assertEqual(len(list(root.glob('*.stock-family.json'))),1)
     self.assertEqual(request('/api/stock-families',payload)[0],409,'stale writers must not overwrite')
     self.assertEqual(request(entry['source'])[1],updated)
     for bad in [{'id':'../escape'}, {'recipe':{**recipe,'source':{**source,'url':'https://example.com/unretained.glb'}}}, {'recipe':{**recipe,'sources':[{**source,'sha256':'0'*64}]}}]:
      self.assertEqual(request('/api/stock-families',{'name':'Bad','recipe':recipe,**bad})[0],400)
     (root/(sha+'.glb')).write_bytes(b'changed bytes')
     self.assertEqual(request('/api/stock-families',{'name':'Bad digest','recipe':recipe})[0],400)
    finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
