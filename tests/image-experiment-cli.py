# kaminos-test: python
"""The executable import CLI replaces stale success with phase-tagged failures."""
import io, json, runpy, subprocess, sys, tempfile, unittest
from unittest.mock import patch
from pathlib import Path

SCRIPT=Path(__file__).resolve().parents[1]/'tools/image-experiment.py'
class ImportFailures(unittest.TestCase):
    def test_missing_invalid_and_transport_failures_replace_old_or_absent_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for prior in [False,True]:
                for case in ['missing','invalid','request','transport']:
                    with self.subTest(prior=prior,case=case):
                        manifest=root/(case+'.json');output=root/(case+str(prior)+'-report.json')
                        if case=='invalid':manifest.write_text('{broken')
                        if case in ['request','transport']:manifest.write_text(json.dumps({'action':'create','title':'Burners'}))
                        if prior:output.write_text(json.dumps({'id':'old-success'}))
                        run=subprocess.run([sys.executable,str(SCRIPT),'--origin','not-a-url' if case=='request' else 'http://127.0.0.1:1','--manifest',str(manifest),'--out',str(output)],capture_output=True,text=True)
                        self.assertNotEqual(run.returncode,0)
                        self.assertTrue(output.exists(),'a failure must leave its requested artifact')
                        report=json.loads(output.read_text())
                        self.assertEqual(report['status'],'failed');self.assertNotIn('id',report)
                        self.assertEqual(report['phase'],case if case in ['request','transport'] else 'manifest')
                        self.assertTrue(report['error'])

    def test_response_decode_failure_replaces_old_success_but_valid_response_stays_compatible(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);manifest=root/'op.json';output=root/'report.json'
            manifest.write_text(json.dumps({'action':'create','title':'Burners'}))
            for body in ['not JSON','[]',json.dumps({'id':'new-experiment','schema':'kaminos.image-experiment.v1'})]:
                output.write_text(json.dumps({'id':'old-success'}))
                response=io.StringIO(body);response.status=200
                args=[str(SCRIPT),'--origin','http://localhost','--manifest',str(manifest),'--out',str(output)]
                with patch.object(sys,'argv',args),patch('urllib.request.urlopen',return_value=response),patch('sys.stdout',new=io.StringIO()):
                    with self.assertRaises(SystemExit) as terminal:runpy.run_path(str(SCRIPT),run_name='__main__')
                report=json.loads(output.read_text())
                if body in ['not JSON','[]']:
                    self.assertEqual(terminal.exception.code,1);self.assertEqual(report['phase'],'response');self.assertEqual(report['status'],'failed');self.assertNotIn('id',report)
                else:
                    self.assertEqual(terminal.exception.code,0);self.assertEqual(report,json.loads(body))

if __name__=='__main__':unittest.main()
