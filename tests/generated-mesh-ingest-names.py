# kaminos-test: python
"""A stored mesh can carry a readable name.

Viewer links label a mesh by its filename, so a store of <sha>.glb files shows
hashes. POST /api/ingest-mesh?name=... keeps <sha>.glb as the identity and adds a
hard-linked alias named/<slug>-<sha8>.glb with the same bytes.
"""
import hashlib
import http.client
import json
import os
from pathlib import Path
import struct
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from urllib.parse import quote

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def glb(text):
    document = json.dumps({"asset": {"version": "2.0"}, "extras": {"t": text}}).encode()
    document += b' ' * (-len(document) % 4)
    return b'glTF' + struct.pack('<II', 2, 20 + len(document)) + struct.pack('<II', len(document), 0x4e4f534a) + document


with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    serve.BROWSE_ROOTS['generated-meshes'] = root
    server = ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        def request(method, url, body=None):
            conn = http.client.HTTPConnection(*server.server_address)
            conn.request(method, url, body)
            response = conn.getresponse()
            value = response.read()
            conn.close()
            return response.status, value

        kiln = glb('kiln')
        sha = hashlib.sha256(kiln).hexdigest()
        status, body = request('POST', '/api/ingest-mesh?name=' + quote('Kiln TRELLIS2MLX r512 / LOD 5k remesh tex512'), kiln)
        assert status == 200, (status, body)
        receipt = json.loads(body)
        assert receipt['sha256'] == sha
        assert receipt['source'] == f'/api/read?root=generated-meshes&path={sha}.glb'
        alias = f'named/kiln-trellis2mlx-r512-lod-5k-remesh-tex512-{sha[:8]}.glb'
        assert receipt['named'] == {'path': alias, 'source': '/api/read?root=generated-meshes&path=' + quote(alias, safe='')}, receipt
        assert (root / alias).read_bytes() == kiln
        assert os.path.samefile(root / alias, root / f'{sha}.glb'), 'alias must share the stored bytes'
        assert request('GET', receipt['named']['source']) == (200, kiln)

        # Replay is idempotent and the identity response is unchanged without a name.
        assert request('POST', '/api/ingest-mesh?name=' + quote('Kiln TRELLIS2MLX r512 / LOD 5k remesh tex512'), kiln) == (200, body)
        status, plain = request('POST', '/api/ingest-mesh', kiln)
        assert status == 200 and 'named' not in json.loads(plain)

        # A name with nothing usable is rejected before anything is written.
        bear = glb('bear')
        assert request('POST', '/api/ingest-mesh?name=' + quote('../../ ///'), bear)[0] == 400
        assert not (root / f'{hashlib.sha256(bear).hexdigest()}.glb').exists()
        assert sorted(p.relative_to(root).as_posix() for p in root.rglob('*.glb')) == sorted([f'{sha}.glb', alias])
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
print('Generated mesh readable-name alias contracts passed')
