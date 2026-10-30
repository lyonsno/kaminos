# kaminos-test: python
"""The Kaminos server mounts a local TRELLIS checkpoint package for TRELLIS in the page.

The page fetches the package manifest and then each tensor file by name; the mount must
serve exactly the package and never a file outside it.
"""
import http.client
import http.server
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import threading

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve
from model_installations import ModelInstallations


with TemporaryDirectory() as directory:
    root = Path(directory) / 'pack'
    root.mkdir()
    manifest = json.dumps({'schema': 'trellis2.generation-inputs.v0'}).encode()
    (root / 'manifest.json').write_bytes(manifest)
    payload = bytes(range(256)) * 8
    (root / 'dino.patchBias.f32').write_bytes(payload)
    (Path(directory) / 'outside.bin').write_bytes(b'secret')

    previous = serve.MODEL_INSTALLATIONS
    serve.MODEL_INSTALLATIONS = ModelInstallations(environ={'KAMINOS_TRELLIS_CHECKPOINT_ROOT':str(root.resolve())}, config_path=root.parent/'no-installations.json')
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def get(path):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1])
        connection.request('GET', path)
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response, body
    try:
        import hashlib
        config = serve.runtime_config()['trellisPage']
        assert config == {'checkpointUrl': '/trellis-checkpoints', 'modelRoot': str(root.resolve()), 'mounted': True,
                          'manifestSha256': hashlib.sha256(manifest).hexdigest()}, config
        response, body = get('/trellis-checkpoints/manifest.json')
        assert response.status == 200 and body == manifest
        response, body = get('/trellis-checkpoints/dino.patchBias.f32')
        assert response.status == 200 and body == payload
        response, body = get('/trellis-checkpoints/../outside.bin')
        assert response.status == 404, response.status
        response, body = get('/trellis-checkpoints/%2e%2e/outside.bin')
        assert response.status == 404, response.status
    finally:
        server.shutdown()
        serve.MODEL_INSTALLATIONS = previous

previous = serve.MODEL_INSTALLATIONS
serve.MODEL_INSTALLATIONS = ModelInstallations(environ={}, config_path=root.parent/'no-installations.json')
try:
    assert serve.runtime_config()['trellisPage'] is None
finally:
    serve.MODEL_INSTALLATIONS = previous
print('TRELLIS checkpoint mount serves the package and nothing outside it')
