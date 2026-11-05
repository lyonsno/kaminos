# kaminos-test: python
"""Malformed restricted catalogs fail through the real HTTP and import boundaries."""
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


class MemorySocket:
    def __init__(self, request):
        self.input, self.output = io.BytesIO(request), io.BytesIO()

    def makefile(self, *args, **kwargs):
        return self.input

    def sendall(self, data):
        self.output.write(data)


class RestrictedCatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old_root = serve.BROWSE_ROOTS['generated-meshes']
        self.addCleanup(serve.BROWSE_ROOTS.__setitem__, 'generated-meshes', self.old_root)
        serve.BROWSE_ROOTS['generated-meshes'] = self.root
        self.old_scenes = serve.SCENES_DIR
        self.addCleanup(setattr, serve, 'SCENES_DIR', self.old_scenes)
        serve.SCENES_DIR = self.root / 'local-scenes'
        serve.SCENES_DIR.mkdir()
        self.source = hashlib.sha256(b'hero').hexdigest()
        self.digest = hashlib.sha256(b'beauty').hexdigest()
        self.level = {'sha256': self.digest, 'faces': 100, 'route': 'direct', 'purpose': 'beauty'}
        self.path = self.root / ('.' + self.source + '.glb.lods.json')
        self.bad = [None, {}, [{'purpose': 'beauty'}]]
        self.bad += [[{**self.level, **change}] for change in (
            {'sha256': 'bad'}, {'faces': '100'}, {'faces': True}, {'faces': 0},
            {'route': ''}, {'route': []}, {'purpose': 'unknown'}, {'error': 'bad'},
            {'error': {'relative': {'max': 0, 'mean': 0, 'p95': -1}}},
        )]

    def document(self, restricted):
        return {'schema': 'kaminos.lod-set.v0', 'source': self.source, 'levels': [], 'beautyLevels': restricted}

    def http(self):
        request = f'GET /api/mesh-lods?source={self.source}&faces=100&purpose=beauty&prepare=client HTTP/1.0\r\nHost: localhost\r\n\r\n'.encode()
        sock = MemorySocket(request)
        try:
            serve.KaminosHandler(sock, ('127.0.0.1', 1), SimpleNamespace(server_address=('127.0.0.1', 0)))
        except (KeyError, TypeError, AttributeError) as error:
            self.fail('Malformed restricted record escaped the structured HTTP response: ' + repr(error))
        header, body = sock.output.getvalue().split(b'\r\n\r\n', 1)
        return int(header.split()[1]), json.loads(body)

    def test_http_rejects_malformed_records_with_json(self):
        for bad in self.bad:
            with self.subTest(bad=bad):
                self.path.write_text(json.dumps(self.document(bad)))
                status, response = self.http()
                self.assertEqual(status, 500)
                self.assertEqual(response['phase'], 'mesh-lods-record')
                self.assertIn('beauty', response['error'].lower())
        self.path.write_text(json.dumps(self.document([{**self.level, 'futureAdditiveField': {'x': 1}}])))
        status, response = self.http()
        self.assertEqual(status, 200)
        self.assertEqual(response['choice']['sha256'], self.digest)

    def test_import_rejects_before_publishing_sidecar_or_tiers(self):
        foreign = self.root / 'foreign'
        foreign.mkdir()
        (foreign / (self.digest + '.glb')).write_bytes(b'beauty')
        for bad in self.bad:
            with self.subTest(bad=bad):
                (foreign / self.path.name).write_text(json.dumps(self.document(bad)))
                destination = self.root / 'destination'
                with self.assertRaises(serve.MeshLodRecordError):
                    serve._import_mesh_lod_sidecar(self.source, [foreign], destination)
                self.assertFalse((destination / self.path.name).exists())
                self.assertFalse((destination / '.lod-beauty' / (self.digest + '.glb')).exists())

    def test_scene_import_returns_error_without_saving_invalid_scene(self):
        scenes = self.root / 'foreign' / 'scenes'
        meshes = scenes.parent / 'assets' / 'generated-meshes'
        scenes.mkdir(parents=True); meshes.mkdir(parents=True)
        scene = scenes / 'kiln.kaminos.json'
        scene.write_text(json.dumps({'objects': [{'source': f'/api/read?root=generated-meshes&path={self.source}.glb'}]}))
        (self.root / (self.source + '.glb')).write_bytes(b'hero')
        (meshes / self.path.name).write_text(json.dumps(self.document(None)))
        handler = serve.KaminosHandler.__new__(serve.KaminosHandler)
        body = b'{}'
        handler.client_address = ('127.0.0.1', 1)
        handler.headers = {'Content-Length': str(len(body))}
        handler.rfile = io.BytesIO(body)
        handler._scene_library_scene_path = lambda *args: (scenes, scene)
        replies = []
        handler.send_json = lambda value, status=200: replies.append((status, value))
        handler.handle_scene_library_import()
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0][0], 400)
        self.assertEqual(replies[0][1]['phase'], 'mesh-lods-import')
        self.assertFalse(self.path.exists())
        self.assertEqual(list(serve.SCENES_DIR.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
