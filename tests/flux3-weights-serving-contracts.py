# kaminos-test: python
"""Local FLUX.3 packs use the existing mounted-package HTTP route, with no public fallback."""
import http.client
import http.server
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve

assert hasattr(serve, 'FLUX3_WEIGHTS_ROOT'), 'Kaminos must accept an explicit local FLUX.3 package root'

with TemporaryDirectory() as directory:
    root = Path(directory) / 'flux3'
    for part in ('te', 'dit', 'vae'):
        (root / part).mkdir(parents=True)
        (root / part / 'manifest.json').write_text(json.dumps({
            'schema': 'kaminos.flux3-klein.transformer-weights.v1' if part == 'dit' else 'component',
        }))
    payload = bytes(range(256))
    (root / 'te' / 'te-embed.bin').write_bytes(payload)
    (Path(directory) / 'outside.bin').write_bytes(b'secret')
    previous = serve.FLUX3_WEIGHTS_ROOT
    serve.FLUX3_WEIGHTS_ROOT = root.resolve()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()

    def get(path, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1])
        connection.request('GET', path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response, body

    try:
        config = serve.runtime_config()['flux3']
        assert config == {'weightsUrl': '/flux3-weights', 'modelRoot': str(root.resolve()), 'mounted': True}, config
        response, body = get('/flux3-weights/te/te-embed.bin', {'Range': 'bytes=10-19'})
        assert response.status == 206 and body == payload[10:20]
        assert response.getheader('Content-Range') == 'bytes 10-19/256'
        response, body = get('/flux3-weights/dit/manifest.json')
        assert response.status == 200 and json.loads(body)['schema'] == 'kaminos.flux3-klein.transformer-weights.v1'
        for escape in ('/flux3-weights/../outside.bin', '/flux3-weights/%2e%2e/outside.bin'):
            response, body = get(escape)
            assert response.status == 404 and b'secret' not in body
        # Existing FLUX.2 weights must not masquerade as an available FLUX.3 pack.
        (root / 'dit' / 'manifest.json').write_text(json.dumps({'schema': 'kaminos.flux2-klein.transformer-weights.v1'}))
        assert serve.runtime_config()['flux3']['mounted'] is False
        (root / 'dit' / 'manifest.json').write_text('{broken')
        assert serve.runtime_config()['flux3']['mounted'] is False
        (root / 'vae' / 'manifest.json').unlink()
        assert serve.runtime_config()['flux3']['mounted'] is False
        serve.FLUX3_WEIGHTS_ROOT = None
        assert serve.runtime_config()['flux3'] is None
        response, _ = get('/flux3-weights/te/manifest.json')
        assert response.status == 404
    finally:
        server.shutdown()
        server.server_close()
        serve.FLUX3_WEIGHTS_ROOT = previous
print('FLUX.3 local weight serving contracts passed')
