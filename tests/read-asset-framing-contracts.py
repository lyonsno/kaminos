# kaminos-test: python
"""Actual handle_read over HTTP preserves complete bytes and explicit framing."""
import ast, json, tempfile, threading, unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
from urllib.request import urlopen

source=Path(__file__).resolve().parents[1]/'serve.py'
tree=ast.parse(source.read_text())
handler=next(n for n in tree.body if isinstance(n,ast.ClassDef) and any(
    isinstance(child,ast.FunctionDef) and child.name=='handle_read' for child in n.body))
read=next(n for n in handler.body if isinstance(n,ast.FunctionDef) and n.name=='handle_read')

class ReadAssetFraming(unittest.TestCase):
    def test_exact_payload_lengths_and_original_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);namespace={'BROWSE_ROOTS':{'asset':root},'SPLAT_EXTENSIONS':set(),
                'splat_asset_root_allows_pointer':lambda _:False,'json':json}
            exec(compile(ast.Module(body=[read],type_ignores=[]),str(source),'exec'),namespace)
            class Endpoint(BaseHTTPRequestHandler):
                handle_read=namespace['handle_read']
                def refuse_sf3d_source(self,_):return False
                def log_message(self,*_):pass
                def do_GET(self):self.handle_read(parse_qs(urlparse(self.path).query))
            server=ThreadingHTTPServer(('127.0.0.1',0),Endpoint)
            thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
            try:
                for name,body in [('mesh.glb',b'glTF'+bytes(range(256))*4),('image.png',b'\x89PNG\r\n\x1a\n'),('mesh.ply',b'ply\nend_header\n')]:
                    (root/name).write_bytes(body)
                    with urlopen(f'http://127.0.0.1:{server.server_port}/api/read?root=asset&path={name}') as response:
                        self.assertEqual(response.status,200)
                        self.assertEqual(response.headers.get('Content-Length'),str(len(body)),
                            'asset response must declare the exact body length before browser stream consumption')
                        self.assertEqual(response.read(),body)
            finally:server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
