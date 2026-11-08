# kaminos-test: python
import base64,hashlib,http.client,json,struct,sys,tempfile,threading,unittest
from pathlib import Path
from http.server import ThreadingHTTPServer
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve
import trellis_history

class History(unittest.TestCase):
 def test_actual_http_roundtrip_and_immutable_bytes(self):
  with tempfile.TemporaryDirectory() as directory:
   old=serve.BROWSE_ROOTS['generated-meshes'];serve.BROWSE_ROOTS['generated-meshes']=Path(directory)
   server=ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
   def call(method,url,value=None):
    conn=http.client.HTTPConnection(*server.server_address);conn.request(method,url,json.dumps(value) if value is not None else None,{'Content-Type':'application/json'});r=conn.getresponse();body=r.read();conn.close();return r.status,body
   data=struct.pack('<iiiiii',0,0,0,1,2,3)
   frame={'schema':'trellis2.voxel-frame.v1','representation':'occupied-cells','id':'coarse:12','runId':'owned/run with spaces','stage':'occupancy-coordinates','routeId':'trellis2.occupancy-coordinates.webgpu.v0','count':2,'step':12,'steps':12,'atSeconds':1,'grid':{'dimensions':[4,4,4]},'layout':{'dtype':'int32','shape':[2,3],'rowOrder':'z-y-x-lexicographic'},'spatial':{'frame':'trellis-source','gridToSource':{'scale':[.25]*3,'offset':[-.5]*3},'cellCenterOffset':[.5]*3,'sourceToGltf':[1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1]}}
   payload={'schema':trellis_history.SCHEMA,'runId':frame['runId'],'label':'Kiln history','source':{'kind':'live-generation','routeId':'trellis2.image-generation.webgpu.v0'},'frame':frame,'coordinatesBase64':base64.b64encode(data).decode()}
   from urllib.parse import urlencode
   url='/api/trellis-history?'+urlencode({'runId':frame['runId']})
   try:
    interrupted={**payload,'runId':'interrupted-save','frame':{**frame,'runId':'interrupted-save'}}
    replace=trellis_history.os.replace
    def interrupt_frame(source,target):
     if str(target).endswith('.i32'):raise OSError('Interrupted before publishing complete coordinate bytes')
     return replace(source,target)
    with patch.object(trellis_history.os,'replace',side_effect=interrupt_frame):
     with self.assertRaisesRegex(OSError,'Interrupted'):trellis_history.save_history(serve.trellis_history_root(),interrupted)
    self.assertFalse((trellis_history.run_directory(serve.trellis_history_root(),'interrupted-save')/'history.json').exists())
    trellis_history.save_history(serve.trellis_history_root(),interrupted)
    self.assertEqual(trellis_history.read_frame(serve.trellis_history_root(),'interrupted-save',frame['id']),data,'an interrupted save can retry without a conflicting partial frame')
    self.assertEqual(call('GET',url)[0],404)
    for key,bad in [('grid',None),('layout',[]),('spatial',None),('spatial',{**frame['spatial'],'gridToSource':None})]:
     with self.subTest(malformed=key,value=bad):
      status,body=call('POST','/api/trellis-history',{**payload,'frame':{**frame,key:bad}})
      self.assertEqual(status,400,body);self.assertEqual(json.loads(body)['phase'],'trellis-history')
    status,body=call('POST','/api/trellis-history',payload);self.assertEqual(status,200,body)
    self.assertEqual(call('POST','/api/trellis-history',payload)[0],200,'retry is idempotent')
    status,body=call('GET',url);value=json.loads(body);self.assertEqual(status,200);self.assertEqual(len(value['frames']),1);self.assertEqual(value['frames'][0]['coordinates']['sha256'],hashlib.sha256(data).hexdigest())
    self.assertEqual(call('GET',url+'&'+urlencode({'frameId':frame['id']})),(200,data))
    self.assertEqual(call('POST','/api/trellis-history',{**payload,'coordinatesBase64':base64.b64encode(data[:-4]).decode()})[0],400)
    self.assertEqual(call('POST','/api/trellis-history',{**payload,'frame':{**frame,'runId':'another-run'}})[0],400)
    self.assertEqual(call('POST','/api/trellis-history',{**payload,'source':{'kind':'retained-reference-replay'}})[0],400)
    changed=struct.pack('<iiiiii',0,0,0,1,2,2)
    self.assertEqual(call('POST','/api/trellis-history',{**payload,'coordinatesBase64':base64.b64encode(changed).decode()})[0],400)
    self.assertEqual(call('GET',url+'&'+urlencode({'frameId':frame['id']})),(200,data),'conflicts do not overwrite the snapshot')
    terminal={k:v for k,v in payload.items() if k not in ('frame','coordinatesBase64')};terminal['status']='completed'
    self.assertEqual(call('POST','/api/trellis-history',terminal)[0],200)
    self.assertEqual(json.loads(call('GET',url)[1])['status'],'completed')
    gap={**terminal,'gaps':[{'id':'refined:12','stage':'cascade-support','reason':'Source retired before copy admission'}]}
    self.assertEqual(call('POST','/api/trellis-history',gap)[0],200);self.assertEqual(json.loads(call('GET',url)[1])['status'],'incomplete')
    empty={**terminal,'runId':'empty'};self.assertEqual(call('POST','/api/trellis-history',empty)[0],200);self.assertEqual(json.loads(call('GET','/api/trellis-history?runId=empty')[1])['status'],'incomplete')
    path=trellis_history.run_directory(serve.trellis_history_root(),frame['runId'])/(trellis_history.identity(frame['id'])+'.i32');path.write_bytes(b'changed')
    self.assertEqual(call('GET',url+'&'+urlencode({'frameId':frame['id']}))[0],400,'corrupt stored bytes fail loudly')
   finally:server.shutdown();server.server_close();thread.join();serve.BROWSE_ROOTS['generated-meshes']=old

if __name__=='__main__':unittest.main()
