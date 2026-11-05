# kaminos-test: python
"""Startup's opt-in raw scene transport preserves bytes and avoids JSON codecs."""
import io,json,socket,sys,unittest
from types import SimpleNamespace
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock,patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import serve

class StartupRead(unittest.TestCase):
 def read(self,root,name,raw=None):
  handler=serve.KaminosHandler.__new__(serve.KaminosHandler);handler.wfile=io.BytesIO();handler.send_response=Mock();handler.send_header=Mock();handler.end_headers=Mock();handler.refuse_sf3d_source=lambda target:False
  query={'root':[root],'path':[name]}
  if raw is not None:query['raw']=[raw]
  handler.handle_read(query);return handler
 def test_raw_scene_is_exact_utf8_bytes_without_json_parse_or_encode(self):
  with TemporaryDirectory() as tmp,patch.dict(serve.BROWSE_ROOTS,{'scenes':Path(tmp)}):
   original=' { "checkpoint": [1.000,2e1], "label": "kiln ☀" }\n'.encode();Path(tmp,'saved.kaminos.json').write_bytes(original)
   with patch.object(serve.json,'loads',wraps=json.loads) as loads,patch.object(serve.json,'dumps',wraps=json.dumps) as dumps:
    h=self.read('scenes','saved.kaminos.json','1');self.assertEqual(h.wfile.getvalue(),original);self.assertEqual(loads.call_count,0);self.assertEqual(dumps.call_count,0)
   h.send_response.assert_called_once_with(200);self.assertIn(('Content-Length',str(len(original))),[c.args for c in h.send_header.call_args_list])
 def test_opt_in_keeps_normal_json_validation_and_path_refusal(self):
  with TemporaryDirectory() as tmp,patch.dict(serve.BROWSE_ROOTS,{'scenes':Path(tmp),'other':Path(tmp)}):
   Path(tmp,'broken.json').write_text('{broken')
   h=self.read('scenes','broken.json');h.send_response.assert_called_once_with(500)
   h=self.read('other','broken.json','1');h.send_response.assert_called_once_with(500)
   h=self.read('scenes','broken.json','1');self.assertEqual(h.wfile.getvalue(),b'{broken')
   h=self.read('scenes','../outside.kaminos.json','1');h.send_response.assert_called_once_with(403)
   h=self.read('scenes','missing.kaminos.json','1');h.send_response.assert_called_once_with(404)
 def test_real_handler_returns_structured_refusal_for_open_or_pre_header_metadata_failure(self):
  class Wire:
   def __init__(self):self.input=io.BytesIO(b'GET /api/read?root=scenes&path=unreadable.kaminos.json&raw=1 HTTP/1.0\r\nHost: localhost\r\n\r\n');self.output=bytearray()
   def makefile(self,*args,**kwargs):return self.input
   def sendall(self,body):self.output.extend(body)
  with TemporaryDirectory() as tmp,patch.dict(serve.BROWSE_ROOTS,{'scenes':Path(tmp)}):
   target=Path(tmp,'unreadable.kaminos.json');target.write_text('{}');original_open=Path.open
   def open_file(path,*args,**kwargs):
    if path.resolve()==target.resolve():raise PermissionError('scene is unreadable')
    return original_open(path,*args,**kwargs)
   for failure in ('open','metadata'):
    wire=Wire()
    with self.subTest(failure=failure):
     with (patch.object(Path,'open',open_file) if failure=='open' else patch.object(serve.os,'fstat',side_effect=OSError('file metadata unavailable'))):
      serve.KaminosHandler(wire,('127.0.0.1',1),SimpleNamespace(server_name='localhost',server_port=0))
     header,body=bytes(wire.output).split(b'\r\n\r\n',1);self.assertIn(b'500 Internal Server Error',header);self.assertIn(b'Cache-Control: no-store',header);self.assertEqual(json.loads(body),{'error':'Failed to read file'})
   wire=Wire()
   def interrupted(source,destination):destination.write(b'{');raise OSError('read interrupted after headers')
   with patch.object(serve.shutil,'copyfileobj',interrupted):
    with self.assertRaisesRegex(OSError,'read interrupted'):serve.KaminosHandler(wire,('127.0.0.1',1),SimpleNamespace(server_name='localhost',server_port=0))
   header,body=bytes(wire.output).split(b'\r\n\r\n',1);self.assertIn(b'200 OK',header);self.assertEqual(body,b'{','a partial scene never has an error JSON document appended to it')
 def test_socket_activation_uses_os_capacity_for_pending_connections(self):
  server=serve.KaminosServer(('127.0.0.1',0),serve.KaminosHandler,bind_and_activate=False);server.socket.close();server.socket=Mock();server.server_activate();server.socket.listen.assert_called_once_with(socket.SOMAXCONN);server.server_close()
if __name__=='__main__':unittest.main()
