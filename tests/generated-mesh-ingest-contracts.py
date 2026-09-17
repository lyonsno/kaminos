import hashlib
import http.client
import json
from pathlib import Path
import struct
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

with tempfile.TemporaryDirectory() as directory:
    serve.BROWSE_ROOTS['generated-meshes'] = Path(directory)
    server = ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        def request(method, url, body=None):
            conn = http.client.HTTPConnection(*server.server_address)
            conn.request(method, url, body)
            response = conn.getresponse()
            value = response.read()
            status = response.status
            conn.close()
            return status, value
        document = b'{"asset":{"version":"2.0"}} '
        document += b' ' * (-len(document) % 4)
        glb = b'glTF' + struct.pack('<II', 2, 20 + len(document)) + struct.pack('<II', len(document), 0x4e4f534a) + document
        status, body = request('POST','/api/ingest-mesh',glb)
        assert status == 200, (status, body)
        receipt = json.loads(body)
        assert receipt['sha256'] == hashlib.sha256(glb).hexdigest()
        assert request('GET',receipt['source']) == (200,glb)
        assert request('POST','/api/ingest-mesh',glb) == (200,body)
        for invalid in (b'', b'not a glb', glb[:-1], glb[:4]+struct.pack('<I',1)+glb[8:]):
            assert request('POST','/api/ingest-mesh',invalid)[0] == 400
        assert len(list(Path(directory).glob('*.glb'))) == 1
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
print('Generated mesh HTTP persistence, identity, replay and rejection contracts passed')
