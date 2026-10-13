import argparse
import importlib.util
import json
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

parser=argparse.ArgumentParser()
parser.add_argument('--host-root',required=True)
parser.add_argument('--stone-root',required=True)
parser.add_argument('--index',required=True)
parser.add_argument('--port',type=int,required=True)
args=parser.parse_args()
host_root=Path(args.host_root).resolve(strict=True)
stone_root=Path(args.stone_root).resolve(strict=True)
index=Path(args.index).resolve(strict=True)
sys.path.insert(0,str(host_root))
sys.argv=[str(host_root/'serve.py'),str(args.port)]
spec=importlib.util.spec_from_file_location('stone_composition_host',host_root/'serve.py')
host=importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
from workbench_experiments import discover_experiments

class Handler(host.KaminosHandler):
    def route(self,head=False):
        requested=unquote(urlparse(self.path).path)
        if requested in ('/','/index.html'):
            target=index
        elif requested=='/api/workbench-experiments':
            modules=discover_experiments(host_root,'experiments')+['/__stone'+name for name in discover_experiments(stone_root,'experiments')]
            self.send_json({'modules':modules,'mount':'derived-host-composition'});return True
        elif requested.startswith('/__stone/'):
            target=(stone_root/requested.removeprefix('/__stone/')).resolve()
            if not target.is_relative_to(stone_root) or any(part.startswith('.') for part in target.relative_to(stone_root).parts):
                self.send_error(403);return True
        else:
            return False
        if not target.is_file():
            self.send_error(404);return True
        data=target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type','text/javascript' if target.suffix in ('.js','.mjs') else mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('Content-Length',str(len(data)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Kaminos-Composition','derived-source-not-host-adoption')
        self.end_headers()
        if not head:self.wfile.write(data)
        return True
    def do_GET(self):
        if not self.route():super().do_GET()
    def do_HEAD(self):
        if not self.route(head=True):super().do_HEAD()

os.chdir(host_root)
print(json.dumps({'hostRoot':str(host_root),'stoneRoot':str(stone_root),'derivedIndex':str(index),'port':args.port,'claim':'provisional-shared-host-composition'}),flush=True)
host.http.server.ThreadingHTTPServer(('127.0.0.1',args.port),Handler).serve_forever()
