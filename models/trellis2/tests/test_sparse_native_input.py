import importlib.util
import copy
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import numpy as np

spec = importlib.util.spec_from_file_location('block_export', Path(__file__).parents[1] / 'export-sparse-block.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeInputContract(unittest.TestCase):
    def test_authenticated_native_input_loader_exists(self):
        self.assertTrue(callable(getattr(module, 'load_native_block_input', None)),
                        'Missing authenticated hidden/modulation input from the observed native route.')

    def test_rejects_false_native_authority_and_changed_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tensors = {'block1.input': np.zeros((4096, 1536), dtype='<f4'),
                       'modulation': np.zeros((1, 9216), dtype='<f4')}
            raw, observed = {}, {}
            for name, array in tensors.items():
                file = root / f'{name}.f32'
                array.tofile(file)
                sha = module.digest(file)
                raw[name] = {'path': str(file), 'byteLength': array.nbytes, 'sha256': sha}
                observed[name] = {'shape': list(array.shape), 'dtype': 'f32', 'sha256': sha}
            source_sha = hashlib.sha256(b'observed-source').hexdigest()
            native = {'commit': 'a' * 40, 'expectedCommit': 'a' * 40, 'dirty': '', 'finishedAt': 'observed',
                      'repoRoot': str(root), 'status': 'failed', 'phase': 'native-block-execution',
                      'error': {'message': 'whole-block numerical comparison failed'},
                      'requestedUrl': 'http://127.0.0.1:1/', 'effectiveUrl': 'http://127.0.0.1:1/',
                      'prefixFixtureSha256': 'b' * 64, 'rawOutputs': raw,
                      'servedSources': {name: source_sha for name in ['models/trellis2/sparse-block-witness.js',
                          'models/trellis2/sparse-block.js', 'models/trellis2/sparse-prefix.js',
                          'webgpu-inference-kit/src/inference-runtime.js']},
                      'result': {'sessionId': 'actual-test-session', 'errors': [],
                          'requestedRoute': 'trellis2.sparse-flow-block.webgpu.v0',
                          'effectiveRoute': 'trellis2.sparse-flow-block.webgpu.v0',
                          'backend': {'vendor': 'apple', 'architecture': 'metal-3', 'isFallbackAdapter': False},
                          'composition': {'observedBlockIndex': 1, 'sameSession': True, 'sameJob': True,
                              'readbackBetweenBlocks': False, 'reusedResidentBlockHidden': True,
                              'incomingHiddenSnapshot': 'queue-ordered-GPU-copy-before-block1; observer-readback-after-chain'},
                          'reference': {'source': {'commit': 'c' * 40}, 'checkpoint': {'sha256': 'd' * 64},
                              'conditioning': {'sha256': 'e' * 64}},
                          'inputs': {'block1.input': observed['block1.input']},
                          'outputs': {'modulation': observed['modulation']}}}
            report = root / 'report.json'
            def load(value):
                report.write_text(json.dumps(value))
                return module.load_native_block_input(report, block_index=1, prefix={'source': {'commit': 'c' * 40}},
                    prefix_sha='b' * 64, checkpoint_sha='d' * 64, conditioning_sha='e' * 64)
            with patch.object(module.subprocess, 'check_output', return_value=b'observed-source'):
                hidden, modulation, evidence = load(native)
                self.assertEqual(hidden.shape, (4096, 1536))
                self.assertEqual(modulation.shape, (1, 9216))
                self.assertEqual(evidence['nativeSessionId'], 'actual-test-session')
                # Synthetic rows test local admission only; live capture establishes the external route.
                changes = [lambda n: n.update(dirty=' M shader'),
                    lambda n: n.update(commit='f' * 40),
                    lambda n: n.update(finishedAt=None),
                    lambda n: n.update(effectiveUrl='http://wrong-route/'),
                    lambda n: n.update(cleanupErrors=[{'message': 'lost terminal evidence'}]),
                    lambda n: n.update(phase='native-device'),
                    lambda n: n.update(prefixFixtureSha256='f' * 64),
                    lambda n: n['result'].update(errors=['GPU validation failure']),
                    lambda n: n['result'].update(effectiveRoute='CPU-fallback'),
                    lambda n: n['result']['backend'].update(isFallbackAdapter=True),
                    lambda n: n['result']['composition'].update(readbackBetweenBlocks=True),
                    lambda n: n['result']['composition'].update(observedBlockIndex=0),
                    lambda n: n['result']['reference']['conditioning'].update(sha256='f' * 64),
                    lambda n: n['result']['inputs']['block1.input'].update(shape=[4095, 1536]),
                    lambda n: n['result']['inputs']['block1.input'].update(dtype='f16'),
                    lambda n: n['rawOutputs']['block1.input'].update(sha256='f' * 64),
                    lambda n: n['rawOutputs']['modulation'].update(byteLength=0),
                    lambda n: n['servedSources'].pop('models/trellis2/sparse-block.js'),
                    lambda n: n['servedSources'].update({'models/trellis2/sparse-block.js': 'f' * 64})]
                for change in changes:
                    bad = copy.deepcopy(native)
                    change(bad)
                    with self.assertRaises(ValueError):
                        load(bad)
                with (root / 'modulation.f32').open('r+b') as file:
                    file.write(np.float32(float('nan')).tobytes())
                # Even a self-consistent changed digest cannot turn nonfinite bytes into an input.
                sha = module.digest(root / 'modulation.f32')
                bad = copy.deepcopy(native)
                bad['rawOutputs']['modulation']['sha256'] = sha
                bad['result']['outputs']['modulation']['sha256'] = sha
                with self.assertRaisesRegex(ValueError, 'nonfinite'):
                    load(bad)


if __name__ == '__main__':
    unittest.main()
