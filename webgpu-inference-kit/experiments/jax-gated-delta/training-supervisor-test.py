"""Local negative-path tests; fake producer results cannot prove GPU behavior."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from contextlib import nullcontext
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('trainer_supervisor', Path(__file__).with_name('training-greenroom.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SupervisorTests(unittest.TestCase):
    def test_rejects_stale_or_unreleased_producer_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'manifest.json'
            manifest.write_text('{}')
            fake = root / 'fake-node'
            fake.write_text('#!' + sys.executable + '\n' + '''
import json, pathlib, sys
args=sys.argv[1:]; output=pathlib.Path(args[args.index('--out')+1])
case=pathlib.Path(__file__).with_name('case').read_text()
invocation=args[args.index('--invocation-id')+1] if '--invocation-id' in args else 'old-run'
checkpoint=output.with_name('checkpoint.json');checkpoint.write_text('{}')
import hashlib
r={'schema':'kaminos.training-report.v1','invocation':invocation,
   'status':'completed','progress':{'update':1,'total':1},
   'manifest':{'sha256':hashlib.sha256(pathlib.Path(args[args.index('--manifest')+1]).read_bytes()).hexdigest()},
   'checkpoint':{'path':str(checkpoint),'sha256':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'update':1},
   'cleanup':{'browserClosed':True,'serverClosed':True},'backend':{'effective':'webgpu','vendor':'apple'}}
if case=='stale':r['invocation']='old-run'
if case=='release':r['cleanup']['browserClosed']=False
if case=='fallback':r['backend']['effective']='cpu'
if case=='partial':r['progress']['update']=0
if case=='checkpoint':r['checkpoint']['sha256']='wrong'
output.write_text(json.dumps(r))
print(json.dumps({'event':'terminal','report':str(output),'status':'completed'}),flush=True)
''')
            fake.chmod(0o700)
            for case in ('stale', 'release', 'fallback', 'partial', 'checkpoint'):
                with self.subTest(case=case):
                    (root / 'case').write_text(case)
                    out = root / (case + '.json')
                    args = SimpleNamespace(out=str(out), manifest=str(manifest), resume=None,
                        node=str(fake), chrome='unused', expected_vendor='apple', on_submitted=None)
                    self.assertNotIn('GPU_GREENROOM_CONTEXT', os.environ)
                    fake_sdk = SimpleNamespace(cooperative=SimpleNamespace(__file__=__file__))
                    fake_cancel = SimpleNamespace(cancellation=lambda: nullcontext(SimpleNamespace(checkpoint=lambda: None)))
                    with patch.dict(sys.modules, {'gpu_queue': fake_sdk, 'gpu_queue.cancellation': fake_cancel}):
                        self.assertEqual(module.supervise(args), 1)
                    report = json.loads(out.read_text())
                    self.assertEqual(report['status'], 'failed')
                    self.assertFalse(report['memory_released'])
                    self.assertEqual(report['child_exit'], 0)
                    self.assertEqual(report['phase'], 'browser-launch')


if __name__ == '__main__':
    unittest.main()
