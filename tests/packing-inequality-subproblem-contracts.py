"""Selection policy tests; backend conformance uses the saved severe subproblem."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('subproblem', ROOT / 'tools/packing-inequality-subproblem.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def response(x, success=True):
    return SimpleNamespace(x=np.array(x, dtype=float), success=success, nit=1,
                           message='ok' if success else 'Inequality constraints incompatible')


class SelectionContracts(unittest.TestCase):
    problem = dict(jacobian=[[1.]], gaps=[-1.], pair=[1.], radius=2., bounds=[[-2., 2.]])

    def test_failed_refinement_retains_valid_primary(self):
        with patch.object(module, 'minimize', side_effect=[response([1., 0.]), response([0., 0.], False)]):
            r = module.solve(self.problem)
        self.assertEqual(r['status'], 'solved')
        self.assertEqual(r['direction'], [1.])
        self.assertEqual(r['directionSource'], 'minimax')
        self.assertEqual(r['refinementStatus'], 'failed')
        self.assertFalse(r['minimumNorm']['success'])

    def test_invalid_refinement_retains_valid_primary(self):
        with patch.object(module, 'minimize', side_effect=[response([1., 0.]), response([0., 0.])]):
            r = module.solve(self.problem)
        self.assertEqual(r['status'], 'solved')
        self.assertEqual(r['direction'], [1.])
        self.assertEqual(r['refinementStatus'], 'invalid')

    def test_successful_refinement_still_selected(self):
        with patch.object(module, 'minimize', side_effect=[response([1.5, 0.]), response([1., 0.])]):
            r = module.solve(self.problem)
        self.assertEqual(r['direction'], [1.])
        self.assertEqual(r['directionSource'], 'minimum-norm')
        self.assertEqual(r['refinementStatus'], 'succeeded')

    def test_primary_success_flag_does_not_override_constraints(self):
        cases = [([0., 0.], self.problem), ([3., 0.], self.problem),
                 ([1., -1.], self.problem), ([1., 0.], dict(self.problem, bounds=[[-.5, .5]])),
                 ([float('nan'), 0.], self.problem)]
        for x, p in cases:
            with self.subTest(x=x, bounds=p['bounds']):
                with patch.object(module, 'minimize', side_effect=[response(x), response([1., 0.])]) as call:
                    r = module.solve(p)
                self.assertEqual(r['status'], 'subproblem-failed')
                self.assertNotIn('direction', r)
                self.assertEqual(call.call_count, 1)

    def test_failed_primary_is_not_salvaged(self):
        with patch.object(module, 'minimize', return_value=response([1., 0.], False)) as call:
            r = module.solve(self.problem)
        self.assertEqual(r['status'], 'subproblem-failed')
        self.assertNotIn('direction', r)
        self.assertEqual(call.call_count, 1)

    def test_nonfinite_refinement_survives_actual_json_boundary(self):
        script = '''
import numpy as np, runpy
from types import SimpleNamespace
from unittest.mock import patch
first = SimpleNamespace(x=np.array([1., 0.]), success=True, nit=1, message='ok')
second = SimpleNamespace(x=np.array([float('nan'), 0.]), success=False, nit=1, message='failed')
with patch('scipy.optimize.minimize', side_effect=[first, second]):
    runpy.run_path('tools/packing-inequality-subproblem.py', run_name='__main__')
'''
        proc = subprocess.run([sys.executable, '-c', script], input=json.dumps(self.problem),
                              text=True, capture_output=True, cwd=ROOT)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        r = json.loads(proc.stdout)
        self.assertEqual(r['status'], 'solved')
        self.assertEqual(r['direction'], [1.])
        self.assertEqual(r['directionSource'], 'minimax')
        self.assertFalse(r['minimumNorm']['finite'])
        self.assertEqual(r['minimumNorm']['x'][0], 'nan')

    def test_observed_severe_subproblem_has_usable_direction(self):
        saved = json.loads((ROOT / 'artifacts/packing-source-gap-repair-0915/severe/step-002.json').read_text())
        r = module.solve(saved['subproblem'])
        self.assertTrue(r['minimax']['success'])
        self.assertEqual(r['status'], 'solved')
        self.assertEqual(len(r['direction']), 18)
        self.assertLessEqual(np.linalg.norm(r['direction']), saved['subproblem']['radius'] + 1e-8)
        # The observed backend failure is retained, not silently reclassified as success.
        if not r['minimumNorm']['success']:
            self.assertEqual(r['directionSource'], 'minimax')
            self.assertEqual(r['refinementStatus'], 'failed')
            self.assertEqual(r['direction'], r['minimax']['x'][:-1])


if __name__ == '__main__':
    unittest.main()
