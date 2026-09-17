"""Exercise the existing canonical HTTP capture route; no GPU or model work."""
import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from urllib.request import Request, urlopen
from http.server import ThreadingHTTPServer

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('kaminos_serve', root / 'serve.py')
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)

with TemporaryDirectory(prefix='moge-capture-http-') as directory:
    server_module.ROOT = Path(directory).resolve()
    server_module.VOLUME_CAPTURE_DIR = server_module.ROOT / 'artifacts/volume-captures'
    with ThreadingHTTPServer(('127.0.0.1', 0), server_module.KaminosHandler) as server:
        server_module.PORT = server.server_port
        worker = Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            captures = []
            for run_id in ('test-run-1', 'test-run-2'):
                payload = {'kind': 'moge-frame-timing', 'name': run_id, 'runId': run_id,
                           'status': 'failed', 'failure': {'phase': 'synthetic-http-conformance'},
                           'frameTimes': [0, 8.3, 16.7, 41.1], 'routeResult': None}
                request = Request(f'http://127.0.0.1:{server.server_port}/api/volume-capture',
                                  data=json.dumps(payload).encode(),
                                  headers={'Content-Type': 'application/json'})
                with urlopen(request) as response:
                    saved = json.load(response)
                assert saved['ok'] is True
                document = json.loads(Path(saved['path']).read_text())
                assert document['capture'] == payload
                captures.append(saved['path'])
            assert captures[0] != captures[1]
            assert all(Path(path).is_file() for path in captures)
            print('PASS: two distinct raw captures survive actual canonical HTTP POST and disk readback')
        finally:
            server.shutdown()
            worker.join()
