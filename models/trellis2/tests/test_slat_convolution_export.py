import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

class ConvolutionExport(unittest.TestCase):
    def test_missing_reference_retains_failure_before_operation(self):
        script=Path(__file__).parents[1]/'export-slat-convolution.py'
        self.assertTrue(script.is_file(),'Capture the actual first convolution from the retained projection, not a full decoder.')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            run=subprocess.run([sys.executable,str(script),'--repo-root',str(script.parents[2]),
                '--source-root',str(root/'missing-source'),'--expected-commit','0'*40,
                '--reference',str(root/'missing-reference'),'--reference-sha256','0'*64,
                '--projection',str(root/'missing-projection'),'--projection-sha256','0'*64,
                '--out',str(root/'out')],capture_output=True,text=True)
            self.assertNotEqual(run.returncode,0)
            m=json.loads((root/'out'/'manifest.json').read_text())
            self.assertEqual(m['schema'],'trellis2.slat-convolution-reference.v0')
            self.assertEqual(m['status'],'failed');self.assertEqual(m['phase'],'parent-reference')
            self.assertEqual(m['operationCalls'],0);self.assertEqual(m['fullDecoderCalls'],0)
            self.assertIn('error',m)

if __name__=='__main__':unittest.main()
