# kaminos-test: python
import importlib.util
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch
import sys

spec = importlib.util.spec_from_file_location("visual_work_batch", Path(__file__).resolve().parents[1] / "visual_work_batch.py")
batch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(batch)


class BatchTests(unittest.TestCase):
    def test_failed_case_never_acknowledges_or_advances(self):
        calls = []
        def units(cases, **hooks):
            for case in cases:
                calls.append(case['id'])
                hooks['perform'](case)
        fake = types.ModuleType('gpu_queue.cooperative')
        fake.run_units = units
        with tempfile.TemporaryDirectory() as out, patch.dict(sys.modules, {'gpu_queue.cooperative': fake}):
            with self.assertRaises(FileNotFoundError):
                batch.run_visual_cases([{'id':'a','args':[]}, {'id':'b','args':[]}], repo_root=out,
                    node='/missing-node',out=out,continuation=None,on_submitted=None)
            self.assertEqual(calls, ['a'])
            report = json.loads((Path(out) / 'batch.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['active'], 'a')
            self.assertEqual(report['cases'], [])

    def test_successor_drops_prior_workload_estimates(self):
        request = types.SimpleNamespace(runtime_hint={'expected_seconds':10},runtime_profile={'profile':'cheap'})
        fake = types.ModuleType('gpu_queue.cooperative')
        def units(cases, **hooks):
            self.assertIs(hooks['quiesce'](), True)
            self.assertIs(hooks['continuation']('/checkpoint'), request)
            hooks['on_submitted'](request)
            raise SystemExit(0)
        fake.run_units = units
        registered = []
        with tempfile.TemporaryDirectory() as out, patch.dict(sys.modules, {'gpu_queue.cooperative': fake}):
            with self.assertRaises(SystemExit):
                batch.run_visual_cases([], repo_root=out,node='node',out=out,
                    continuation=lambda _:request,on_submitted=registered.append)
            self.assertIsNone(request.runtime_hint)
            self.assertIsNone(request.runtime_profile)
            self.assertEqual(registered, [request])
            self.assertEqual(json.loads((Path(out) / 'batch.json').read_text())['status'], 'yielded')

    def test_duplicate_output_refused_before_execution(self):
        fake = types.ModuleType('gpu_queue.cooperative')
        fake.run_units = lambda *a,**k: self.fail('must validate before execution')
        with tempfile.TemporaryDirectory() as out, patch.dict(sys.modules, {'gpu_queue.cooperative': fake}):
            with self.assertRaisesRegex(ValueError, 'unique'):
                batch.run_visual_cases([{'id':'a','args':[]},{'id':'a','args':[]}],repo_root=out,node='node',out=out,
                    continuation=None,on_submitted=None)

    def test_registration_exit_is_failure_not_yield(self):
        fake = types.ModuleType('gpu_queue.cooperative')
        def units(cases, **hooks):
            hooks['continuation']('/checkpoint')
            raise SystemExit(9)
        fake.run_units = units
        with tempfile.TemporaryDirectory() as out, patch.dict(sys.modules, {'gpu_queue.cooperative': fake}):
            with self.assertRaises(SystemExit):
                batch.run_visual_cases([],repo_root=out,node='node',out=out,
                    continuation=lambda _:None,on_submitted=None)
            self.assertEqual(json.loads((Path(out)/'batch.json').read_text())['status'],'failed')


if __name__ == '__main__':
    unittest.main()
