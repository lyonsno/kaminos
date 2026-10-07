import hashlib,http.client,json,struct,sys,tempfile,threading
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve
with tempfile.TemporaryDirectory() as directory:
 root=Path(directory);serve.BROWSE_ROOTS['generated-meshes']=root
 document=b'{"asset":{"version":"2.0"}}';document+=b' '*(-len(document)%4)
 glb=b'glTF'+struct.pack('<II',2,20+len(document))+struct.pack('<II',len(document),0x4e4f534a)+document
 sha=hashlib.sha256(glb).hexdigest();(root/(sha+'.glb')).write_bytes(glb)
 server=ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
 def request(method,path,body=None):
  conn=http.client.HTTPConnection(*server.server_address);conn.request(method,path,body,{'Content-Type':'application/json'});r=conn.getresponse();value=r.read();conn.close();return r.status,json.loads(value)
 generation={'schema':'kaminos.asset-generation.v1','runId':'observed-run-a','input':{'source':'/api/read?root=image-inbox&path=input.png','sha256':'a'*64},'route':'sf3d.image-to-mesh.webgpu-local.v0','sha256':sha,'bytes':len(glb),'receiptValidation':{'ok':True}}
 result={'source':f'/api/read?root=generated-meshes&path={sha}.glb','sha256':sha,'name':'Chair.glb','generation':generation}
 try:
  status,body=request('POST','/api/mesh-generation-origin',json.dumps(result));assert status==200,(status,body)
  status,again=request('POST','/api/mesh-generation-origin',json.dumps(result));assert status==200 and again==body,(status,again)
  status,listing=request('GET','/api/browse?root=generated-meshes');entry=next(e for e in listing['entries'] if e['name']==sha+'.glb');assert entry['generation']==generation;assert entry['display']['title']=='Chair.glb'
  second={**result,'generation':{**generation,'runId':'observed-run-b'}};assert request('POST','/api/mesh-generation-origin',json.dumps(second))[0]==200
  metadata=json.loads((root/('.'+sha+'.glb.origins.json')).read_text());assert set(metadata['origins'])=={'observed-run-a','observed-run-b'}
  assert request('POST','/api/mesh-generation-origin',json.dumps({**result,'sha256':'../outside'}))[0]==400
  assert request('POST','/api/mesh-generation-origin',json.dumps({**result,'generation':{**generation,'sha256':'b'*64}}))[0]==400
  assert (root/(sha+'.glb')).read_bytes()==glb
 finally:server.shutdown();server.server_close();thread.join()
print('Generated origin persistence, repeated write, multiple runs, fresh browsing and rejection pass')
