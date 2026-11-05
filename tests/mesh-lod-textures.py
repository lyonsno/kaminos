# kaminos-test: python
import hashlib, http.client, json, struct, sys, tempfile, threading, zlib
from pathlib import Path
from http.server import ThreadingHTTPServer
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve

def glb(size,shift=0):
    def chunk(kind,data):
        return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',size,size,8,6,0,0,0))+chunk(b'IDAT',zlib.compress((b'\0'+b'\xff'*size*4)*size))+chunk(b'IEND',b'')
    arrays=[struct.pack('<9f',0,0,0,1,0,0,0,1,0),struct.pack('<6f',shift,0,1,0,0,1),struct.pack('<3I',0,1,2),png]
    binary=b'';views=[]
    for data in arrays:
        binary+=b'\0'*(-len(binary)%4);views.append({'buffer':0,'byteOffset':len(binary),'byteLength':len(data)});binary+=data
    doc={'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0}],
      'meshes':[{'primitives':[{'attributes':{'POSITION':0,'TEXCOORD_0':1},'indices':2,'material':0}]}],
      'buffers':[{'byteLength':len(binary)}],'bufferViews':views,'accessors':[
        {'bufferView':0,'componentType':5126,'count':3,'type':'VEC3'},
        {'bufferView':1,'componentType':5126,'count':3,'type':'VEC2'},
        {'bufferView':2,'componentType':5125,'count':3,'type':'SCALAR'}],
      'images':[{'bufferView':3,'mimeType':'image/png'}],'textures':[{'source':0}],
      'materials':[{'pbrMetallicRoughness':{'baseColorTexture':{'index':0}}}]}
    text=json.dumps(doc).encode();text+=b' '*(-len(text)%4);binary+=b'\0'*(-len(binary)%4)
    return b'glTF'+struct.pack('<II',2,28+len(text)+len(binary))+struct.pack('<II',len(text),0x4e4f534a)+text+struct.pack('<II',len(binary),0x004e4942)+binary

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);serve.BROWSE_ROOTS['generated-meshes']=root
    server=ThreadingHTTPServer(('127.0.0.1',0),serve.KaminosHandler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    def request(method,url,body=None):
        connection=http.client.HTTPConnection(*server.server_address)
        connection.request(method,url,json.dumps(body).encode() if body is not None else None,{'Content-Type':'application/json'})
        response=connection.getresponse();data=response.read();connection.close()
        try:value=json.loads(data)
        except ValueError:value=data.decode()
        return response.status,value
    try:
        def store(data):
            sha=hashlib.sha256(data).hexdigest();(root/(sha+'.glb')).write_bytes(data);return sha
        source,base,high,bad=store(glb(16)),store(glb(2)),store(glb(8)),store(glb(4,.25))
        assert serve.save_mesh_lod_level({'source':source,'level':{'sha256':base,'faces':1,'route':'fixture','textureSize':2}})
        payload={'source':source,'geometry':base,'variants':[{'sha256':high,'textureSize':8,'gpuBytes':340,'relativeTexelSize':1/8}]}
        status,receipt=request('POST','/api/mesh-lod-textures',payload)
        assert status==200,(status,receipt)
        assert receipt['textureSet']['variants'][0]['gpuBytes']==340
        assert request('POST','/api/mesh-lod-textures',payload)[0]==200
        status,state=request('GET',f'/api/mesh-lods?source={source}')
        assert state['levels'][0]['textureSet']['variants'][0]['sha256']==high
        assert high in serve.mesh_lod_level_index(),'appearance assets are derived, not independent catalog heroes'
        # The server checks actual GLBs, not just equal face counts or caller metadata.
        wrong={**payload,'variants':[{'sha256':bad,'textureSize':4,'gpuBytes':84,'relativeTexelSize':.25}]}
        assert request('POST','/api/mesh-lod-textures',wrong)[0]==400,'changed UVs must not be admitted'
        wrong={**payload,'variants':[{**payload['variants'][0],'gpuBytes':1}]}
        assert request('POST','/api/mesh-lod-textures',wrong)[0]==400,'caller cannot understate texture cost'
        wrong={**payload,'variants':[{**payload['variants'][0],'sha256':'f'*64}]}
        assert request('POST','/api/mesh-lod-textures',wrong)[0]==400
        # Cross-store scene reconstruction copies the appearance dependencies too.
        destination=root/'import';destination.mkdir();serve._import_mesh_lod_sidecar(source,[root],destination)
        assert (destination/(high+'.glb')).read_bytes()==(root/(high+'.glb')).read_bytes()
        # Beauty-only geometry lives outside legacy levels and keeps the same appearance contract.
        hidden=root/'.lod-beauty';hidden.mkdir(exist_ok=True)
        beauty_bytes=glb(3);beauty=hashlib.sha256(beauty_bytes).hexdigest();(hidden/(beauty+'.glb')).write_bytes(beauty_bytes)
        serve.save_mesh_lod_level({'source':source,'level':{'sha256':beauty,'faces':1,'route':'trellis-simplify+pairing','purpose':'beauty'}})
        assert request('POST','/api/mesh-lod-textures',{**payload,'geometry':beauty})[0]==200
        status,state=request('GET',f'/api/mesh-lods?source={source}&purpose=beauty')
        assert any(level['sha256']==beauty and level['textureSet']['variants'][0]['sha256']==high for level in state['levels'])
        destination_two=root/'import-beauty';serve._import_mesh_lod_sidecar(source,[root],destination_two)
        assert (destination_two/'.lod-beauty'/(beauty+'.glb')).read_bytes()==beauty_bytes
        assert (destination_two/(high+'.glb')).read_bytes()==(root/(high+'.glb')).read_bytes()
    finally:
        server.shutdown();server.server_close()
