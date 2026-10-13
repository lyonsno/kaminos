# kaminos-test: python
"""The Kaminos server mounts a local FLUX.2 klein weight package for the authoring page.

Klein reads token-embedding rows with HTTP range requests and refuses anything but 206,
so the mount must honor single byte ranges exactly, and it must never serve outside the package.
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

assert hasattr(serve, 'KLEIN_WEIGHTS_ROOT'), 'Kaminos must accept a local klein weight package root'

with TemporaryDirectory() as directory:
    root = Path(directory) / 'klein'
    for part in ('te', 'dit', 'vae'):
        (root / part).mkdir(parents=True)
        (root / part / 'manifest.json').write_text(json.dumps({'part': part}))
    payload = bytes(range(256)) * 4
    (root / 'te' / 'te-embed.bin').write_bytes(payload)
    (Path(directory) / 'outside.bin').write_bytes(b'secret')

    previous = serve.KLEIN_WEIGHTS_ROOT
    serve.KLEIN_WEIGHTS_ROOT = root.resolve()
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), serve.KaminosHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def get(path, headers=None, method='GET'):
        connection = http.client.HTTPConnection('127.0.0.1', server.server_address[1])
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        body = response.read()
        connection.close()
        return response, body
    try:
        config = serve.runtime_config()['klein']
        assert config == {'weightsUrl': '/klein-weights', 'modelRoot': str(root.resolve()), 'mounted': True}, config

        response, body = get('/klein-weights/te/te-embed.bin', {'Range': 'bytes=10-19'})
        assert response.status == 206, response.status
        assert body == payload[10:20]
        assert response.getheader('Content-Range') == f'bytes 10-19/{len(payload)}'
        assert response.getheader('Content-Length') == '10'

        response, body = get('/klein-weights/te/te-embed.bin', {'Range': f'bytes={len(payload) - 4}-'})
        assert response.status == 206 and body == payload[-4:]

        response, body = get('/klein-weights/te/te-embed.bin')
        assert response.status == 200 and body == payload
        assert response.getheader('Accept-Ranges') == 'bytes'

        response, body = get('/klein-weights/te/te-embed.bin', method='HEAD')
        assert response.status == 200 and body == b'' and response.getheader('Content-Length') == str(len(payload))

        response, body = get('/klein-weights/dit/manifest.json')
        assert response.status == 200 and json.loads(body) == {'part': 'dit'}
        assert response.getheader('Content-Type').startswith('application/json')

        response, _ = get('/klein-weights/te/te-embed.bin', {'Range': f'bytes={len(payload)}-{len(payload) + 3}'})
        assert response.status == 416, 'an unsatisfiable range must fail loud, not return the whole file'

        for escape in ('/klein-weights/../outside.bin', '/klein-weights/%2e%2e/outside.bin', '/klein-weights/te/missing.bin'):
            response, body = get(escape)
            assert response.status == 404 and b'secret' not in body, (escape, response.status)

        serve.KLEIN_WEIGHTS_ROOT = None
        assert serve.runtime_config()['klein'] is None
        response, _ = get('/klein-weights/te/manifest.json')
        assert response.status == 404, 'an unmounted package must not fall through to repository files'
    finally:
        server.shutdown()
        serve.KLEIN_WEIGHTS_ROOT = previous
print('klein weight serving contracts passed')
