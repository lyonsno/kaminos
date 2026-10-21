# kaminos-test: python
"""The page's Greenroom lease, through the server, against the real gpu-greenroom CLI on an isolated queue."""
import ast
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SCRIPT=Path(__file__).resolve().parents[1]/'serve.py'
TREE=ast.parse(SCRIPT.read_text())
FUNCTIONS={node.name:node for node in TREE.body if isinstance(node,ast.FunctionDef)}
def function(name,namespace):
    exec(compile(ast.Module(body=[FUNCTIONS[name]],type_ignores=[]),str(SCRIPT),'exec'),namespace)
    return namespace[name]

def real_greenroom():
    # The suite runner's sandbox stubs gpu-greenroom so tests never reach the shop's queue; this test then
    # skips. It runs against the real CLI (isolated queue directory) standalone or with KAMINOS_TEST_SANDBOX=off.
    path=os.environ.get('KAMINOS_GREENROOM_BIN') or shutil.which('gpu-greenroom')
    if not path:return None
    probe=subprocess.run([path,'--version'],capture_output=True,text=True)
    return path if probe.returncode==0 and 'sandbox' not in (probe.stdout+probe.stderr) else None
GREENROOM=real_greenroom()

@unittest.skipUnless(GREENROOM,'needs the real gpu-greenroom CLI: not installed, or stubbed by the test-runner sandbox')
class GreenroomPageLease(unittest.TestCase):
    def setUp(self):
        self.queue=Path(tempfile.mkdtemp())
        self.lease=function('greenroom_page_lease',{'json':json,'re':__import__('re'),'Path':Path,'subprocess':subprocess,'os':os})
    def tearDown(self):shutil.rmtree(self.queue,ignore_errors=True)
    def call(self,payload):return self.lease(payload,greenroom_bin=GREENROOM,queue_dir=str(self.queue),server_pid=os.getpid(),repo_root='/kaminos')
    def current(self):return json.loads((self.queue/'leases'/'current.json').read_text())

    def test_a_page_run_holds_the_gpu_then_releases_it(self):
        held=self.call({'action':'claim','runId':'r1','route':'trellis2.image-generation.webgpu.v0'})
        self.assertEqual(held['status'],'held',held);self.assertEqual(held['leaseId'],'kaminos-page-r1')
        lease=self.current()
        self.assertEqual((lease['lifecycle_state'],lease['owner'],lease['effective_route'],lease['pid']),('active','kaminos-page','trellis2.image-generation.webgpu.v0',os.getpid()))
        self.assertEqual(self.call({'action':'renew','leaseId':'kaminos-page-r1'})['status'],'held')
        self.assertEqual(self.call({'action':'release','leaseId':'kaminos-page-r1','reason':'run finished'})['status'],'released')
        self.assertEqual(self.current()['lifecycle_state'],'released')

    def test_a_running_queue_job_makes_the_page_wait_and_names_it(self):
        job=self.queue/'running'/'job123';job.mkdir(parents=True);(job/'status.json').write_text(json.dumps({'status':'running','job_id':'job123'}))
        waiting=self.call({'action':'claim','runId':'r2','route':'t'})
        self.assertEqual(waiting['status'],'waiting');self.assertEqual(waiting['heldBy'],['job123'])

    def test_a_page_inside_that_running_job_is_already_covered_by_it(self):
        job=self.queue/'running'/'job123';job.mkdir(parents=True);(job/'status.json').write_text(json.dumps({'status':'running','job_id':'job123'}))
        self.assertEqual(self.call({'action':'claim','runId':'r3','route':'t','insideJob':'job123'}),{'status':'inside-job','jobId':'job123'})
        self.assertEqual(self.call({'action':'claim','runId':'r4','route':'t','insideJob':'nojob'})['status'],'waiting','an unknown job covers nothing')

    def test_only_page_leases_can_be_renewed_or_released_through_the_page(self):
        with self.assertRaises(PermissionError):self.call({'action':'release','leaseId':'someone-elses-lease','reason':'x'})
        with self.assertRaises(PermissionError):self.call({'action':'renew','leaseId':'../x'})

if __name__=='__main__':unittest.main()
