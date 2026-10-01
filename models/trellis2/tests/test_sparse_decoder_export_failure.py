import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class SparseDecoderExport(unittest.TestCase):
    def test_pre_model_failure_preserves_decoder_report(self):
        script=Path(__file__).parents[1]/'export-sparse-decoder.py'
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            run=subprocess.run([sys.executable,str(script),'--repo-root',str(script.parents[2]),
                '--expected-commit','0'*40,'--source-root',str(root/'missing-source'),
                '--synthetic','--out',str(root/'out')],capture_output=True,text=True)
            self.assertTrue((root/'out'/'manifest.json').is_file(),'Decoder source export must preserve early failure before its primary tensor outputs.')
            report=json.loads((root/'out'/'manifest.json').read_text())
            self.assertNotEqual(run.returncode,0)
            self.assertEqual(report['schema'],'trellis2.sparse-decoder-reference.v0')
            self.assertEqual(report['phase'],'source')
            self.assertEqual(report['modelCalls'],0)

if __name__=='__main__':unittest.main()
