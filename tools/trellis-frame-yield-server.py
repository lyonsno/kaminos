"""Serve the normal app plus exact retained fixtures and caller-owned assay evidence."""
import importlib.util,json,sys,os,hashlib
from pathlib import Path
from urllib.parse import urlparse,unquote
cfg=json.loads(Path(sys.argv[1]).read_text());root=Path(cfg['repoRoot']).resolve();out=Path(cfg['output']);out.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(root));os.chdir(root)
spec=importlib.util.spec_from_file_location('frame_yield_serve',root/'serve.py');serve=importlib.util.module_from_spec(spec);spec.loader.exec_module(serve)
class Handler(serve.KaminosHandler):
 def do_GET(self):
  route=unquote(urlparse(self.path).path)
  if route.startswith('/__frame_fixture/'):
   parts=route.removeprefix('/__frame_fixture/').split('/')
   if len(parts)!=2 or parts[0] not in cfg['fixtureRoots'] or Path(parts[1]).name!=parts[1]:self.send_error(400);return
   p=Path(cfg['fixtureRoots'][parts[0]])/parts[1]
   if not p.is_file():self.send_error(404);return
   self.send_response(200);self.send_header('Content-Length',str(p.stat().st_size));self.end_headers()
   with p.open('rb')as f:
    while data:=f.read(1024*1024):self.wfile.write(data)
   return
  return super().do_GET()
 def do_POST(self):
  route=urlparse(self.path).path
  if not route.startswith('/__frame_yield/'):return super().do_POST()
  name=route.removeprefix('/__frame_yield/')
  if not name or name[0]=='.'or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-'for c in name):self.send_error(400);return
  raw=self.rfile.read(int(self.headers['Content-Length']));(out/name).write_bytes(raw)
  receipt=json.dumps({'file':name,'byteLength':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}).encode()
  self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(receipt)));self.end_headers();self.wfile.write(receipt)
serve.KaminosServer(('127.0.0.1',cfg['port']),Handler).serve_forever()
