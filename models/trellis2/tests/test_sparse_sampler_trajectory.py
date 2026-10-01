import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np

SCRIPT = Path(__file__).parents[1] / 'export-sparse-sampler.py'


class SamplerTrajectory(unittest.TestCase):
    def test_full_schedule_failure_is_durable(self):
        with tempfile.TemporaryDirectory() as folder:
            output = Path(folder) / 'reference'
            run = subprocess.run([sys.executable, str(SCRIPT), '--repo-root', str(SCRIPT.parents[2]),
                '--expected-commit', '0' * 40, '--source-root', str(Path(folder) / 'missing-source'),
                '--flow-fixture', str(Path(folder) / 'missing-flow'), '--full-schedule',
                '--first-step-fixture', str(Path(folder) / 'missing-first'), '--out', str(output)], capture_output=True, text=True)
            self.assertTrue((output / 'manifest.json').is_file(), 'Full sparse schedule export must retain terminal failure before any primary output.')
            report = json.loads((output / 'manifest.json').read_text())
            self.assertNotEqual(run.returncode, 0)
            self.assertEqual(report['schema'], 'trellis2.sparse-sampler-trajectory-reference.v0')
            self.assertEqual(report['phase'], 'source')
            self.assertEqual(report['modelCalls'], 0)

    def test_reused_state_identity_and_completeness(self):
        spec = importlib.util.spec_from_file_location('sampler_export_trajectory', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertTrue(callable(getattr(module, 'load_trajectory_start', None)), 'Missing authenticated complete first-step reuse, not another full source run.')
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            values = np.arange(32768, dtype='<f4').reshape(1, 8, 16, 16, 16)
            values.tofile(root / 'sample.f32')
            sha, commit = 'a' * 64, 'b' * 40
            base = {'source': {'commit': commit}, 'sample': {'sha256': sha}, 'conditioning': {'sha256': sha}, 'checkpoint': {'sha256': sha}}
            manifest = {'schema': 'trellis2.sparse-sampler-reference.v0', 'status': 'succeeded', **base,
                'source': {'commit': commit, 'dirty': ''}, 'producer': {'commit': commit, 'dirty': ''},
                'flowFixture': {'sha256': sha}, 'referenceRoute': 'pinned-MLX-GPU-source-first-step-sampler/fast-SDPA/two-pass-LN/mlx-sum-QK/F32-CFG-Euler',
                'stepIndex': 0, 'stepsExecuted': 1, 'modelCalls': 2, 'blocksExecuted': 60,
                'tensors': {'sample': {'file': 'sample.f32', 'shape': list(values.shape), 'dtype': 'float32', 'byteLength': values.nbytes, 'sha256': module.digest(root / 'sample.f32')}}}
            (root / 'manifest.json').write_text(json.dumps(manifest))
            observed, state = module.load_trajectory_start(root, base, sha, commit)
            np.testing.assert_array_equal(state, values)
            for field, wrong in [('status', 'failed'), ('modelCalls', 0), ('stepIndex', 1), ('blocksExecuted', 2)]:
                changed = dict(manifest, **{field: wrong}); (root / 'manifest.json').write_text(json.dumps(changed))
                with self.assertRaises(ValueError): module.load_trajectory_start(root, base, sha, commit)
            (root / 'manifest.json').write_text(json.dumps(manifest)); (root / 'sample.f32').write_bytes(b'partial')
            with self.assertRaises(ValueError): module.load_trajectory_start(root, base, sha, commit)


if __name__ == '__main__':
    unittest.main()
