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

    def test_GL02_naming_a_running_job_never_exempts_the_page(self):
        job=self.queue/'running'/'job123';job.mkdir(parents=True);(job/'status.json').write_text(json.dumps({'status':'running','job_id':'job123'}))
        self.assertEqual(self.call({'action':'claim','runId':'r3','route':'t','insideJob':'job123'})['status'],'waiting')

    def test_renew_reports_the_lease_lifecycle_greenroom_records(self):
        self.call({'action':'claim','runId':'r5','route':'t'})
        self.assertEqual(self.call({'action':'renew','leaseId':'kaminos-page-r5'})['lifecycle'],'active')

    def test_only_page_leases_can_be_renewed_or_released_through_the_page(self):
        with self.assertRaises(PermissionError):self.call({'action':'release','leaseId':'someone-elses-lease','reason':'x'})
        with self.assertRaises(PermissionError):self.call({'action':'renew','leaseId':'../x'})

if __name__=='__main__':unittest.main()


class GreenroomLeaseConfig(unittest.TestCase):
    """Which Greenroom a page lease goes through; a server with nothing set still finds this machine's Greenroom."""
    def resolve(self,env,home,which=None):
        fn=function('greenroom_lease_config',{'os':__import__('types').SimpleNamespace(environ=env),'json':json,'Path':Path,
            'shutil':__import__('types').SimpleNamespace(which=lambda name:which)})
        old=Path.home;Path.home=staticmethod(lambda:Path(home))
        try:return fn()
        finally:Path.home=old
    def machine(self):
        home=Path(tempfile.mkdtemp());(home/'.local/bin').mkdir(parents=True);(home/'.local/state/gpu-greenroom').mkdir(parents=True)
        cli=home/'.local/bin/gpu-greenroom';cli.write_text('#!/bin/sh\n');self.addCleanup(shutil.rmtree,home,True);return home,cli
    def test_explicit_environment_wins(self):
        home,cli=self.machine();q=Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,q,True)
        got=self.resolve({'KAMINOS_GREENROOM_BIN':str(cli),'KAMINOS_GREENROOM_QUEUE_DIR':str(q)},home)
        self.assertEqual((got['queueDir'],got['source']),(str(q),'environment'))
    def test_a_server_with_nothing_set_uses_this_machines_installed_greenroom_and_its_default_queue(self):
        home,cli=self.machine()
        got=self.resolve({},home)
        self.assertEqual((got['greenroomBin'],got['queueDir'],got['source']),(str(cli),str(home/'.local/state/gpu-greenroom'),'installed-default'))
    def test_GL03_a_broken_explicit_configuration_fails_instead_of_running_unleased(self):
        home,cli=self.machine();q=Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,q,True)
        bad=Path(tempfile.mkdtemp())/'trellis.json';bad.write_text('{not json')
        for env in [{'KAMINOS_GREENROOM_BIN':'/missing/gpu-greenroom','KAMINOS_GREENROOM_QUEUE_DIR':str(q)},
                    {'KAMINOS_GREENROOM_BIN':str(cli),'KAMINOS_GREENROOM_QUEUE_DIR':'/missing/queue'},
                    {'KAMINOS_GREENROOM_BIN':str(cli)},
                    {'KAMINOS_TRELLIS_CONFIG':str(bad)},
                    {'KAMINOS_TRELLIS_CONFIG':'/missing/trellis.json'}]:
            with self.subTest(env=env),self.assertRaises(ValueError):self.resolve(env,home)
    def test_a_trellis_config_without_greenroom_keys_falls_through_to_the_installed_greenroom(self):
        home,cli=self.machine();cfg=Path(tempfile.mkdtemp())/'trellis.json';cfg.write_text('{}')
        self.assertEqual(self.resolve({'KAMINOS_TRELLIS_CONFIG':str(cfg)},home)['source'],'installed-default')
    def test_no_greenroom_on_the_machine_is_unconfigured(self):
        home=Path(tempfile.mkdtemp());self.addCleanup(shutil.rmtree,home,True)
        self.assertIsNone(self.resolve({},home))
