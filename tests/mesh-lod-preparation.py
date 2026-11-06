# kaminos-test: python
"""Completion is source/geometry/appearance coverage, not just five proxy rows."""
import hashlib
import io
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import serve


def glb(tag, faces=1, texture=0):
    # Real GLB layout; repeated triangles keep the large-mesh policy fixture small.
    positions = struct.pack('<9f', 0, 0, 0, 1, 0, 0, 0, 1, 0)
    indices = struct.pack('<3I', 0, 1, 2) * faces
    binary = positions + indices
    doc = {'asset': {'version': '2.0', 'generator': tag}, 'scene': 0,
           'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0}],
           'meshes': [{'primitives': [{'attributes': {'POSITION': 0}, 'indices': 1}]}],
           'buffers': [{'byteLength': len(binary)}],
           'bufferViews': [{'buffer': 0, 'byteOffset': 0, 'byteLength': len(positions)},
                           {'buffer': 0, 'byteOffset': len(positions), 'byteLength': len(indices)}],
           'accessors': [{'bufferView': 0, 'componentType': 5126, 'count': 3, 'type': 'VEC3'},
                         {'bufferView': 1, 'componentType': 5125, 'count': faces * 3, 'type': 'SCALAR'}]}
    if texture:
        # Completion inspects PNG dimensions without decoding pixels; encoding is
        # exercised by the existing real-PNG appearance/HTTP contract tests.
        image = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', texture, texture)
        doc['images'] = [{'bufferView': 2, 'mimeType': 'image/png'}]
        doc['bufferViews'].append({'buffer': 0, 'byteOffset': len(binary), 'byteLength': len(image)})
        binary += image
    doc['buffers'][0]['byteLength'] = len(binary)
    text = json.dumps(doc).encode(); text += b' ' * (-len(text) % 4)
    binary += b'\0' * (-len(binary) % 4)
    return b'glTF' + struct.pack('<II', 2, 28 + len(text) + len(binary)) + struct.pack('<II', len(text), 0x4e4f534a) + text + struct.pack('<II', len(binary), 0x004e4942) + binary


class Preparation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.mount = patch.dict(serve.BROWSE_ROOTS, {'generated-meshes': self.root})
        self.mount.start()
        self.content = glb('source', 100001, 16)
        self.source = self.store(self.content)
        self.record = {'schema': 'kaminos.lod-set.v0', 'source': self.source, 'levels': []}
        for target in [25000, 10000, 5000, 1000, 500]:
            self.record['levels'].append({'sha256': self.store(glb(str(target))), 'faces': 1, 'targetFaces': target,
                                         'route': 'closed-remesh+projection+trellis-simplify'})
        self.save()

    def tearDown(self):
        self.mount.stop(); self.temp.cleanup()

    def store(self, data):
        sha = hashlib.sha256(data).hexdigest()
        (self.root / (sha + '.glb')).write_bytes(data)
        return sha

    def save(self):
        (self.root / ('.' + self.source + '.glb.lods.json')).write_text(json.dumps(self.record))

    def beauty(self):
        sha = self.store(glb('beauty'))
        self.record['beautyLevels'] = [{'sha256': sha, 'faces': 1, 'targetFaces': 100000, 'purpose': 'beauty', 'route': 'trellis-simplify+pairing'}]
        self.save()

    def appearance(self):
        geometries = [self.source] + [r['sha256'] for r in self.record['levels'] + self.record.get('beautyLevels', [])]
        self.record['textureSets'] = {s: {'schema': 'kaminos.lod-textures.v1', 'geometry': s,
                                        'variants': [{'sha256': s, 'textureSize': 16, 'gpuBytes': 1364, 'relativeTexelSize': 1 / 16}]} for s in geometries}
        self.save()

    def test_five_proxy_slots_do_not_hide_missing_beauty_and_appearance(self):
        self.assertFalse(serve.mesh_lod_targets_missing(self.source))
        self.assertTrue(serve.should_auto_prepare_mesh_lods(self.source, self.content), 'old complete proxy ladders must enter quality preparation')
        status = serve.mesh_lod_preparation_status(self.source)
        self.assertEqual(status['missingBeautyTargets'], [100000])
        self.assertEqual(len(status['missingAppearance']), 6)

    def test_beauty_alone_does_not_hide_missing_appearance(self):
        self.beauty()
        self.assertTrue(serve.should_auto_prepare_mesh_lods(self.source, self.content), 'appearance remains missing after beauty publication')

    def test_missing_published_bytes_are_not_complete_catalog_coverage(self):
        self.beauty(); self.appearance()
        sha = self.record['beautyLevels'][0]['sha256']
        (self.root / (sha + '.glb')).unlink()
        self.assertFalse(serve.mesh_lod_preparation_status(self.source)['complete'], 'metadata alone cannot establish available products')

    def test_pending_preparation_is_shared_across_submitters_and_failure_has_durable_state(self):
        queue = self.root / 'queue'; queue.mkdir()
        calls = []
        config = {'greenroomBin':'fake-greenroom','queueDir':str(queue),'source':'test'}
        def run(argv, **kwargs):
            calls.append(argv)
            (queue / 'pending' / 'same-job').mkdir(parents=True)
            return subprocess.CompletedProcess(argv, 0, json.dumps({'job_id':'same-job','queue_dir':str(queue)}), '')
        with patch.object(serve, 'greenroom_lease_config', return_value=config), patch.object(serve, '_mesh_lod_source_identity', return_value='a'*40), patch.object(serve.subprocess, 'run', side_effect=run):
            first = serve.submit_mesh_lod_prepare(self.source, 8095)
            second = serve.submit_mesh_lod_prepare(self.source, 8096)
        self.assertEqual(first['jobId'], second['jobId'])
        self.assertEqual(len(calls), 1)
        (queue / 'pending' / 'same-job').rmdir()
        with patch.object(serve, 'greenroom_lease_config', return_value=config), patch.object(serve, '_mesh_lod_source_identity', return_value='a'*40), patch.object(serve.subprocess, 'run', return_value=subprocess.CompletedProcess([],1,'','submission refused')):
            with self.assertRaisesRegex(RuntimeError, 'submission refused'):
                serve.submit_mesh_lod_prepare(self.source, 8095)
        state = json.loads((self.root / '.lod-prepare-reports' / self.source / 'state.json').read_text())
        self.assertEqual(state['status'], 'failed')
        self.assertEqual(state['phase'], 'submission')
        self.assertIn('submission refused', state['error'])

    def test_complete_quality_does_not_requeue_but_missing_variant_does(self):
        self.beauty(); self.appearance()
        status = serve.mesh_lod_preparation_status(self.source)
        self.assertTrue(status['complete'])
        self.assertFalse(serve.should_auto_prepare_mesh_lods(self.source, self.content))
        self.record['textureSets'][self.source]['variants'] = []
        self.save()
        self.assertFalse(serve.mesh_lod_preparation_status(self.source)['complete'])
        self.assertTrue(serve.should_auto_prepare_mesh_lods(self.source, self.content))

    def test_small_untextured_source_needs_neither_beauty_nor_appearance(self):
        self.content = glb('small', 1)
        old = self.source; self.source = self.store(self.content)
        self.record['source'] = self.source; self.save()
        status = serve.mesh_lod_preparation_status(self.source)
        self.assertEqual(status['sourceFaces'], 1)
        self.assertEqual(status['missingBeautyTargets'], [])
        self.assertEqual(status['missingAppearance'], [])
        self.assertTrue(status['complete'])
        self.assertFalse(serve.should_auto_prepare_mesh_lods(self.source, self.content))

    def get(self, query=''):
        data = f'GET /api/mesh-lods?source={self.source}{query} HTTP/1.0\r\nHost: localhost\r\n\r\n'.encode()
        class Socket:
            def __init__(self): self.output = io.BytesIO()
            def makefile(self, *_): return io.BytesIO(data)
            def sendall(self, value): self.output.write(value)
        socket = Socket()
        serve.KaminosHandler(socket, ('127.0.0.1', 1234), SimpleNamespace(server_address=('127.0.0.1', 8095)))
        status, body = socket.output.getvalue().split(b'\r\n\r\n', 1)
        self.assertIn(b'200 OK', status)
        return json.loads(body)

    def test_real_get_reports_quality_and_enqueues_a_legacy_ladder_only_on_auto_route(self):
        with patch.object(serve, 'enqueue_mesh_lod_prepare', return_value=True) as enqueue:
            client = self.get('&prepare=client')
            self.assertEqual(client.get('preparation', {}).get('missingBeautyTargets'), [100000])
            enqueue.assert_not_called()
            automatic = self.get('&prepare=auto')
            enqueue.assert_called_once_with(self.source, server_port=8095)
            self.assertEqual(len(automatic['levels']), 5, 'existing usable proxies remain available')

    def test_configured_preparation_uses_greenroom_and_rejects_a_false_success(self):
        queue = self.root / 'queue'; queue.mkdir()
        calls = []
        def run(argv, **kwargs):
            calls.append(argv)
            if argv[0] == 'fake-greenroom':
                directory = queue / 'done' / 'job-1'; directory.mkdir(parents=True)
                (directory / 'receipt.json').write_text(json.dumps({'job_id':'job-1','status':'done','exit_code':0}))
                return subprocess.CompletedProcess(argv, 0, json.dumps({'job_id':'job-1','queue_dir':str(queue)}), '')
            return subprocess.CompletedProcess(argv, 0, '', '')
        with patch.object(serve, 'greenroom_lease_config', return_value={'greenroomBin':'fake-greenroom','queueDir':str(queue),'source':'test'}), patch.object(serve, '_mesh_lod_source_identity', return_value='a'*40), patch.object(serve.subprocess, 'run', side_effect=run):
            result = serve._default_mesh_lod_prepare_runner(self.source, 8095)
        self.assertEqual(calls[0][0], 'fake-greenroom', 'heavy preparation must use the configured queue')
        self.assertEqual(result['status'], 'failed', 'process exit zero without the requested products is not completion')
        self.assertEqual(result['jobId'], 'job-1')


if __name__ == '__main__':
    unittest.main()
