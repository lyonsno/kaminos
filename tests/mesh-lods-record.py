# kaminos-test: python
"""Level-set record: coarse levels of a stored mesh, found by the source mesh's sha.

POST /api/mesh-lods registers one level (both meshes must already be stored);
GET /api/mesh-lods?source=<sha>&faces=N returns every level and the best one for a
face budget: the largest level within budget, else the smallest level, flagged.
"""
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
            conn.request(method, url, body if body is None or isinstance(body, bytes) else json.dumps(body).encode(),
                         {'Content-Type': 'application/json'} if isinstance(body, dict) else {})
            response = conn.getresponse()
            value = response.read()
            conn.close()
            return response.status, json.loads(value) if value else None

        stored = {}
        for name in ('hero', 'l5000', 'l1000', 'l500', 'unstored'):
            data = glb(name)
            stored[name] = hashlib.sha256(data).hexdigest()
            if name != 'unstored':
                assert request('POST', '/api/ingest-mesh', data)[0] == 200
        hero = stored['hero']

        def level(name, faces, route='closed-remesh'):
            return {'sha256': stored[name], 'faces': faces, 'route': route, 'textureSize': 512 if faces >= 5000 else 256}

        # Nothing registered yet: an empty set, not an error.
        status, empty = request('GET', f'/api/mesh-lods?source={hero}&faces=2000')
        assert status == 200 and empty['levels'] == [] and empty['choice'] is None, empty

        for name, faces in (('l500', 500), ('l5000', 5000), ('l1000', 1000)):
            status, body = request('POST', '/api/mesh-lods', {'source': hero, 'level': level(name, faces)})
            assert status == 200, body
        # Identical replay is accepted; conflicting metadata for a stored level is not.
        assert request('POST', '/api/mesh-lods', {'source': hero, 'level': level('l1000', 1000)})[0] == 200
        assert request('POST', '/api/mesh-lods', {'source': hero, 'level': level('l1000', 999)})[0] == 400
        # Both meshes must be stored, and identities must be sha256 hex.
        assert request('POST', '/api/mesh-lods', {'source': hero, 'level': level('unstored', 100)})[0] == 400
        assert request('POST', '/api/mesh-lods', {'source': stored['unstored'], 'level': level('l500', 500)})[0] == 400
        assert request('POST', '/api/mesh-lods', {'source': '../x', 'level': level('l500', 500)})[0] == 400

        status, body = request('GET', f'/api/mesh-lods?source={hero}&faces=2000')
        assert status == 200
        assert [l['faces'] for l in body['levels']] == [5000, 1000, 500], 'levels sorted coarse-last'
        assert body['choice']['sha256'] == stored['l1000'] and body['withinBudget'] is True
        assert body['choice']['source'] == f"/api/read?root=generated-meshes&path={stored['l1000']}.glb"
        status, body = request('GET', f'/api/mesh-lods?source={hero}&faces=100')
        assert body['choice']['sha256'] == stored['l500'] and body['withinBudget'] is False
        status, body = request('GET', f'/api/mesh-lods?source={hero}')
        assert body['choice'] is None and len(body['levels']) == 3
        assert request('GET', '/api/mesh-lods?source=nothex')[0] == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
print('Mesh level-set record contracts passed')
