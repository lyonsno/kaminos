# kaminos-test: python
"""Beauty-only eligibility is explicit on registration and HTTP selection."""
import hashlib
import http.client
import json
from pathlib import Path
import sys
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
