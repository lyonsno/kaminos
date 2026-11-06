# kaminos-test: python
"""Beauty-only eligibility is explicit on registration and HTTP selection."""
import hashlib
import http.client
import json
from pathlib import Path
import sys
import struct
import tempfile
import threading
from http.server import ThreadingHTTPServer
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

with tempfile.TemporaryDirectory() as folder:
    root = Path(folder)
    serve.BROWSE_ROOTS['generated-meshes'] = root
    source, shared, beauty = [hashlib.sha256(v).hexdigest() for v in (b'hero', b'shared', b'beauty')]
    for sha in (source, shared, beauty):
        (root / (sha + '.glb')).write_bytes(b'local registration fixture')
    serve.save_mesh_lod_level({'source': source, 'level': {'sha256': shared, 'faces': 25000, 'route': 'closed'}})
    serve.save_mesh_lod_level({'source': source, 'level': {'sha256': beauty, 'faces': 100017, 'route': 'trellis-simplify+pairing', 'purpose': 'beauty', 'closed': False}})
    raw_record = json.loads((root / ('.' + source + '.glb.lods.json')).read_text())
    assert [level['sha256'] for level in raw_record['levels']] == [shared], 'old servers must retain a safe shared catalog when reading the sidecar directly'
    assert [level['sha256'] for level in raw_record['beautyLevels']] == [beauty]
    server = ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    def get(query):
        connection = http.client.HTTPConnection(*server.server_address)
        connection.request('GET', f'/api/mesh-lods?source={source}&prepare=client&' + query)
        response = connection.getresponse()
        data = json.loads(response.read())
        connection.close()
        return response.status, data
    try:
        document = json.dumps({'asset': {'version': '2.0'}}).encode()
        document += b' ' * (-len(document) % 4)
        blob = b'glTF' + struct.pack('<II', 2, 20 + len(document)) + struct.pack('<II', len(document), 0x4e4f534a) + document
        digest = hashlib.sha256(blob).hexdigest()
        conn = http.client.HTTPConnection(*server.server_address)
        conn.request('POST', '/api/ingest-mesh?role=beauty-lod', blob)
        response = conn.getresponse(); receipt = json.loads(response.read()); conn.close()
        assert response.status == 200 and receipt['sha256'] == digest, receipt
        assert (root / '.lod-beauty' / (digest + '.glb')).read_bytes() == blob
        assert not (root / (digest + '.glb')).exists(), 'old asset browsers must not acquire a loose derived mesh'
        conn = http.client.HTTPConnection(*server.server_address)
        conn.request('GET', receipt['source']); response = conn.getresponse(); fetched = response.read(); conn.close()
        assert response.status == 200 and fetched == blob
        destination = root / 'imported'
        serve._import_mesh_lod_sidecar(source, [root], destination)
        imported = json.loads((destination / ('.' + source + '.glb.lods.json')).read_text())
        assert imported['beautyLevels'] == raw_record['beautyLevels']
        source_two = hashlib.sha256(b'second-source').hexdigest()
        (root / (source_two + '.glb')).write_bytes(b'second-source')
        serve.save_mesh_lod_level({'source': source_two, 'level': {'sha256': digest, 'faces': 1, 'route': 'trellis-simplify+pairing', 'purpose': 'beauty'}})
        serve._import_mesh_lod_sidecar(source_two, [root], destination)
        assert (destination / '.lod-beauty' / (digest + '.glb')).read_bytes() == blob
        assert not (destination / (digest + '.glb')).exists()
        assert serve.mesh_lod_level_index()[digest]['source'] == source_two
        status, data = get('faces=150000')
        assert status == 200 and data['choice']['sha256'] == shared, data
        assert [level['sha256'] for level in data['levels']] == [shared], 'older clients must never see beauty-only levels in their shared catalog'
        assert [level['sha256'] for level in data['beautyLevels']] == [beauty, shared]
        status, data = get('faces=150000&purpose=beauty')
        assert status == 200 and data['choice']['sha256'] == beauty, data
        assert get('faces=150000&route=trellis-simplify%2Bpairing')[1]['choice'] is None
        assert get('faces=150000&purpose=unknown')[0] == 400
        for value in ('unknown', '', False, [], {}):
            try:
                serve.save_mesh_lod_level({'source': source, 'level': {'sha256': beauty, 'faces': 100017, 'route': 'trellis-simplify+pairing', 'purpose': value}})
            except ValueError:
                pass
            else:
                raise AssertionError(f'invalid purpose accepted: {value!r}')
    finally:
        server.shutdown()
        server.server_close()
print('PASS beauty eligibility, explicit HTTP choice, unknown purpose refusal')
