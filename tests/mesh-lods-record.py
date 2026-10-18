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

        # Choosing by measured error: the coarsest level whose chosen statistic fits.
        other = {}
        for name in ('hero2', 'e5000', 'e1000', 'e500'):
            data = glb(name); other[name] = hashlib.sha256(data).hexdigest()
            assert request('POST', '/api/ingest-mesh', data)[0] == 200
        for name, faces, mx, mean in (('e5000', 5000, 0.004, 0.001), ('e1000', 1000, 0.012, 0.003), ('e500', 500, 0.03, 0.008)):
            measured = {'sha256': other[name], 'faces': faces, 'route': 'closed-remesh', 'textureSize': 256,
                        'error': {'relative': {'max': mx, 'p95': mx * 0.6, 'mean': mean}}}
            assert request('POST', '/api/mesh-lods', {'source': other['hero2'], 'level': measured})[0] == 200
        status, body = request('GET', f"/api/mesh-lods?source={other['hero2']}&maxError=0.01")
        assert body['choice']['sha256'] == other['e5000'] and body['withinBudget'] is True, body['choice']
        status, body = request('GET', f"/api/mesh-lods?source={other['hero2']}&maxError=0.01&stat=mean")
        assert body['choice']['sha256'] == other['e500'] and body['withinBudget'] is True
        status, body = request('GET', f"/api/mesh-lods?source={other['hero2']}&maxError=0.001")
        assert body['choice']['sha256'] == other['e5000'] and body['withinBudget'] is False, 'finest level, flagged'
        assert request('GET', f"/api/mesh-lods?source={other['hero2']}&maxError=0.01&stat=median")[0] == 400
        assert request('GET', f"/api/mesh-lods?source={other['hero2']}&maxError=0.01&faces=100")[0] == 400
        for bad in ('nan', 'inf', '-0.1'):
            assert request('GET', f"/api/mesh-lods?source={other['hero2']}&maxError={bad}")[0] == 400, bad
        for bad_error in ({'relative': {'max': True, 'p95': 0, 'mean': 0}}, {'relative': {'max': 0.1}}, {'relative': {'max': -1, 'p95': 0, 'mean': 0}}, 'x'):
            junk = glb('junk-' + str(bad_error)); junk_sha = hashlib.sha256(junk).hexdigest()
            assert request('POST', '/api/ingest-mesh', junk)[0] == 200
            assert request('POST', '/api/mesh-lods', {'source': other['hero2'], 'level': {'sha256': junk_sha, 'faces': 77, 'route': 'x', 'error': bad_error}})[0] == 400, bad_error
        # Review M1: registered levels are representations of the hero, not assets of their own.
        catalog = serve.authoring_asset_catalog('generated-meshes')
        listed = {Path(e['source'].split('path=')[-1]).stem for e in catalog['entries']}
        assert hero in listed and other['hero2'] in listed
        assert not listed & {stored['l5000'], stored['l1000'], stored['l500'], other['e5000']}, 'levels hidden from the asset list'
        status, browse = request('GET', '/api/browse?root=generated-meshes&path=')
        rows = {e['name']: e for e in browse['entries']}
        assert rows[stored['l1000'] + '.glb']['lodOf'] == {'source': hero, 'faces': 1000}
        assert 'lodOf' not in rows[hero + '.glb']

        # Review M2: one level per (faces, route) for a source; a second sha for it is refused.
        twin = glb('l1000-rerun'); twin_sha = hashlib.sha256(twin).hexdigest()
        assert request('POST', '/api/ingest-mesh', twin)[0] == 200
        assert request('POST', '/api/mesh-lods', {'source': hero, 'level': {**level('l1000', 1000), 'sha256': twin_sha}})[0] == 400

        # Review N1: tighter validation.
        for bad in ({'faces': True}, {'textureSize': 'big'}, {'sha256': hero}, {'route': ''}):
            assert request('POST', '/api/mesh-lods', {'source': hero, 'level': {**level('l500', 500), **bad}})[0] == 400, bad

        # Review N2: a corrupt record is a server-side fault, not a client error.
        corrupt = glb('corrupt-hero'); corrupt_sha = hashlib.sha256(corrupt).hexdigest()
        assert request('POST', '/api/ingest-mesh', corrupt)[0] == 200
        (root / f'.{corrupt_sha}.glb.lods.json').write_text('{not json')
        status, body = request('GET', f'/api/mesh-lods?source={corrupt_sha}&faces=10')
        assert status == 500 and body['phase'] == 'mesh-lods-record', (status, body)

        # Levels registered without an error measurement are never chosen by error.
        status, body = request('GET', f'/api/mesh-lods?source={hero}&maxError=1')
        assert body['choice'] is None and body['unmeasured'] == 3, body
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
print('Mesh level-set record contracts passed')
