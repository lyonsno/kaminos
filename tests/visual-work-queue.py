# kaminos-test: python
"""CPU-only protocol conformance with the caller-selected real Greenroom source.

The visual child here is synthetic. Real browser evidence is collected by
examples/visual-work/cheap-witness.mjs, separately from this queue boundary.
"""
import dataclasses
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest


if __name__ == '__main__' and '--producer' in sys.argv:
    from gpu_queue.models import JobRequest
    from visual_work_batch import run_visual_cases
    context = json.loads(Path(os.environ['GPU_GREENROOM_CONTEXT']).read_text())
    request = JobRequest.from_json((Path(context['queue_dir']) / 'running' / context['job_id'] / 'request.json').read_text())
    def continuation(checkpoint):
        return JobRequest(job_type='command',input_path='',agent_id=request.agent_id,
            repo_root=request.repo_root,command_cwd=request.command_cwd,route_identity=request.route_identity,
            command_argv=request.command_argv,command_env=request.command_env,runtime_hint={'expected_seconds':10})
    out = Path(sys.argv[-1])
    def register(successor):
        if os.environ.get('TEST_REGISTRATION_ZERO') == '1':
            raise SystemExit(0)
        (out / 'registered.json').write_text(successor.to_json())
    run_visual_cases([{'id':'first','args':[]},{'id':'second','args':[]}],repo_root=request.repo_root,
        node=sys.executable,out=out,continuation=continuation,on_submitted=register)
    sys.exit(0)


class QueueConformance(unittest.TestCase):
    @unittest.skipUnless(os.environ.get('KAMINOS_GREENROOM_SOURCE'), 'set KAMINOS_GREENROOM_SOURCE for real queue conformance')
    def test_completed_case_yields_then_resumes_without_repeating(self):
        self.exercise_queue()

    @unittest.skipUnless(os.environ.get('KAMINOS_GREENROOM_SOURCE'), 'set KAMINOS_GREENROOM_SOURCE for real queue conformance')
    def test_registration_zero_exit_is_failed_with_retained_first_case(self):
        self.exercise_queue(registration_zero=True)

    def exercise_queue(self, registration_zero=False):
        source = str(Path(os.environ['KAMINOS_GREENROOM_SOURCE']).resolve())
        sys.path.insert(0, source)
        from gpu_queue.models import JobRequest
        from gpu_queue.queue import GPUQueue
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            queue = GPUQueue(root / 'queue')
            # A tiny synthetic child exercises closure and retention contracts.
            (root / 'visual-work-run.mjs').write_text('''import json,os,pathlib,sys
from gpu_queue.queue import GPUQueue
out=pathlib.Path(sys.argv[sys.argv.index('--out')+1])
(out/'launch.json').write_text(json.dumps({'status':'passed','browserClosed':True}))
(out/'report.json').write_text(json.dumps({'status':'passed','synthetic':True}))
if out.name=='first':
    context=json.loads(pathlib.Path(os.environ['GPU_GREENROOM_CONTEXT']).read_text())
    GPUQueue(context['queue_dir']).pause(owner='fixture-operator')
''')
            script = Path(__file__).resolve()
            request = JobRequest(job_type='command',input_path='',agent_id='fixture-minion',
                repo_root=str(root),command_cwd=str(root),route_identity='fixture/visual-cases',
                command_argv=[sys.executable,str(script),'--producer',str(root/'results')],
                command_env={'PYTHONPATH':os.pathsep.join([source,str(script.parents[1])]),
                    'TEST_REGISTRATION_ZERO': '1' if registration_zero else '0'},cooperative_checkpoint=True)
            queue.submit(request)
            self.assertTrue(queue.run_one({}))
            if registration_zero:
                result = json.loads((root/'results/batch.json').read_text())
                self.assertEqual(result['status'], 'failed')
                self.assertIn('SystemExit(0)', result['error'])
                self.assertEqual(json.loads((root/'results/first/report.json').read_text())['status'], 'passed')
                self.assertFalse((root/'results/second').exists())
                self.assertFalse(list(queue.queue_dir.rglob('checkpoint-handoff.json')))
                failures = list(queue.queue_dir.rglob('registration-failure.json'))
                self.assertEqual(len(failures), 1)
                return
            handoff = json.loads((queue.queue_dir/'done'/request.job_id/'checkpoint-handoff.json').read_text())
            self.assertEqual(handoff['registration'], 'callback-returned')
            checkpoint = json.loads(Path(handoff['checkpoint']).read_text())
            self.assertEqual(checkpoint['payload']['next_unit'], 1)
            first_bytes = (root/'results/first/report.json').read_bytes()
            self.assertFalse((root/'results/second').exists())
            successor = json.loads((root/'results/registered.json').read_text())
            self.assertIsNone(successor['runtime_hint'])
            queue.resume(owner='fixture-operator')
            self.assertTrue(queue.run_one({}))
            self.assertTrue((queue.queue_dir/'done'/handoff['next_job_id']).is_dir())
            self.assertEqual((root/'results/first/report.json').read_bytes(), first_bytes)
            result = json.loads((root/'results/batch.json').read_text())
            self.assertEqual(result['status'], 'passed')
            self.assertEqual([case['id'] for case in result['cases']], ['first','second'])


if __name__ == '__main__':
    unittest.main()
