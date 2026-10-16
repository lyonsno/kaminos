# kaminos-test: python
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
import numpy as np
import test_candidate_bind_frame as fixture


class ConditionedFrameCliTests(unittest.TestCase):
    def test_real_conditioning_layout_without_forward_capture(self):
        f = fixture.CandidateFrameTests(); f.setUp()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, value in [('old',f.plan),('new',f.candidate),('control',f.control)]:
                (root/(name+'.json')).write_text(json.dumps(value))
            sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
            f.control['sourceSha256'] = 'a'*64
            (root/'control.json').write_text(json.dumps(f.control))
            f.frame['source'] = {'control':{'sha256':sha(root/'control.json')},'plan':{'sha256':sha(root/'old.json')}}
            (root/'frame.json').write_text(json.dumps(f.frame))
            np.save(root/'cond.npy', {'observed':{'joint_names':f.names,'parents':f.parents,'tpos_first_frame':np.asarray(f.positions)}})
            command = [sys.executable,str(Path(__file__).resolve().parents[1]/'tools/build_candidate_bind_frame.py'),
                '--original-plan',str(root/'old.json'),'--candidate-plan',str(root/'new.json'),
                '--original-frame',str(root/'frame.json'),'--control',str(root/'control.json'),
                '--asset-cond',str(root/'cond.npy'),'--asset-key','observed','--out',str(root/'out')]
            result = subprocess.run(command,capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            frame = json.loads((root/'out/rig-frame.json').read_text())
            self.assertEqual(frame['source']['assetConditioningSha256'],sha(root/'cond.npy'))
            self.assertLess(max(e['residualSourceNormalized'] for e in frame['canonicalRestHeadErrors']),1e-10)
            command[command.index('observed')] = 'missing'
            command[-1] = str(root/'refused')
            result = subprocess.run(command,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            report = json.loads((root/'refused/report.json').read_text())
            self.assertEqual(report['status'],'failed')
            self.assertIn('missing',report['error'])
