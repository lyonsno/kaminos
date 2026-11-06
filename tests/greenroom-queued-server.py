# kaminos-test: python
"""Server validation of the observed queued-admission CLI JSON contract."""
import ast
import json
import os
from pathlib import Path
import re
from types import SimpleNamespace
import unittest

source = Path(__file__).resolve().parents[1] / 'serve.py'
node = next(n for n in ast.parse(source.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'greenroom_page_lease')


class QueuedAdmission(unittest.TestCase):
    def call(self, response, action='queued-claim', code=0):
        self.argv = None
        def run(argv, **kwargs):
            self.argv = argv
            return SimpleNamespace(returncode=code, stdout=json.dumps(response), stderr='unsupported admission' if code else '')
        scope = dict(json=json, os=os, Path=Path, re=re, subprocess=SimpleNamespace(run=run))
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(source), 'exec'), scope)
        return scope['greenroom_page_lease']({'action':action, 'runId':'run1', 'route':'fixture/prompt'},
            greenroom_bin='/fixture/cli', queue_dir='/fixture/queue', server_pid=123, repo_root='/fixture/kaminos')

    def test_passes_actual_admission_identity_and_queue_position(self):
        response = dict(status='waiting', jobId='external-kaminos-page-run1', position=3, ahead=['a','b'], heldBy=['batch'], paused=False)
        self.assertEqual(self.call(response), response)
        self.assertEqual(self.argv[:5], ['/fixture/cli','--queue-dir','/fixture/queue','lease','queued-claim'])
        self.assertIn('/fixture/kaminos', self.argv)
        self.assertIn('123', self.argv)
        self.assertIn('fixture/prompt', self.argv)

    def test_stale_or_missing_cli_capability_fails_instead_of_waiting_forever(self):
        with self.assertRaisesRegex(RuntimeError, 'unsupported admission'):
            self.call({}, code=2)

    def test_wrong_job_lease_or_missing_position_cannot_look_admitted(self):
        for response in [dict(status='held', jobId='wrong', leaseId='kaminos-page-run1'),
                         dict(status='held', jobId='external-kaminos-page-run1', leaseId='foreign'),
                         dict(status='waiting', jobId='external-kaminos-page-run1')]:
            with self.subTest(response=response), self.assertRaises(RuntimeError):
                self.call(response)

    def test_explicit_operator_hold_has_no_fabricated_queue_position(self):
        response = dict(status='waiting', jobId='external-kaminos-page-run1', position=None, queueHeld=True)
        self.assertEqual(self.call(response), response)

    def test_withdrawal_is_bound_to_this_run(self):
        result = self.call(dict(status='cancelled', jobId='external-kaminos-page-run1'), action='withdraw-queued')
        self.assertEqual(result['status'], 'cancelled')
        self.assertEqual(self.argv[-2:], ['--lease-id','kaminos-page-run1'])


if __name__ == '__main__':
    unittest.main()
