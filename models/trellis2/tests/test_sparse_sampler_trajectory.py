import ast
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
    def test_actual_complete_schedule_clocks_are_json_serializable(self):
        # Exercise the exporter's actual clock-construction loop without model
        # loading. The live failure was numpy.bool_ entering this report.
        tree = ast.parse(SCRIPT.read_text())
        loop = next(node for node in ast.walk(tree) if isinstance(node, ast.For)
            and isinstance(node.target, ast.Name) and node.target.id == 'i'
            and isinstance(node.iter, ast.Call) and isinstance(node.iter.func, ast.Name)
            and node.iter.func.id == 'range')
        config = {'steps': 12, 'guidanceStrength': 7.5, 'guidanceInterval': [.6, 1], 'rescaleT': 5, 'sigmaMin': 1e-5}
        times = np.linspace(1, 0, 13)
        times = config['rescaleT'] * times / (1 + (config['rescaleT'] - 1) * times)
        scope = {'np': np, 'config': config, 'steps': 12, 'times': times, 'report': {'clocks': []}}
        exec(compile(ast.fix_missing_locations(ast.Module(body=[loop], type_ignores=[])), str(SCRIPT), 'exec'), scope)
        clocks = json.loads(json.dumps(scope['report']))['clocks']
        self.assertEqual(len(clocks), 12)
        self.assertEqual([row['guided'] for row in clocks], [True] * 10 + [False] * 2)
        self.assertTrue(all(type(row['guided']) is bool for row in scope['report']['clocks']))

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
