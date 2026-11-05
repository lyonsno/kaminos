# kaminos-test: python
"""Startup's opt-in raw scene transport preserves bytes and avoids JSON codecs."""
import io,json,socket,sys,unittest
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
 def test_socket_activation_uses_os_capacity_for_pending_connections(self):
  server=serve.KaminosServer(('127.0.0.1',0),serve.KaminosHandler,bind_and_activate=False);server.socket.close();server.socket=Mock();server.server_activate();server.socket.listen.assert_called_once_with(socket.SOMAXCONN);server.server_close()
if __name__=='__main__':unittest.main()
