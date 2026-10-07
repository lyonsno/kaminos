import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import numpy as np

class GenerationPack(unittest.TestCase):
    def test_wrong_source_preserves_terminal_without_model_calls(self):
        script=Path(__file__).parents[1]/'pack-generation.py'
        self.assertTrue(script.is_file(),'Package cached complete weights without calling the MLX generation pipeline.')
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder)
            args=['--repo-root',str(script.parents[2]),'--expected-commit','0'*40,'--out',str(root/'out')]
            for name in ['trellis-snapshot','dino-reference','sparse-reference','shape-reference','decoder-reference','occupancy-reference']:
                args.extend(['--'+name,str(root/'missing')])
            run=subprocess.run([sys.executable,str(script),*args],capture_output=True,text=True)
            self.assertNotEqual(run.returncode,0)
            m=json.loads((root/'out'/'manifest.json').read_text())
            self.assertEqual(m['status'],'failed');self.assertEqual(m['phase'],'source-identity')
            self.assertEqual(m['modelCalls'],0);self.assertIn('error',m)

    def test_checkpoint_precision_and_complete_coverage(self):
        script=Path(__file__).parents[1]/'pack-generation.py';self.assertTrue(script.is_file())
        spec=importlib.util.spec_from_file_location('generation_pack',script);pack=importlib.util.module_from_spec(spec);spec.loader.exec_module(pack)
        np.testing.assert_array_equal(pack.decode_tensor(bytes.fromhex('803f813f'),'BF16',[2]),[1,1.0078125])
        np.testing.assert_array_equal(pack.decode_tensor(np.array([.25,-.5],dtype='<f2').tobytes(),'F16',[2]),[.25,-.5])
        with self.assertRaisesRegex(ValueError,'complete'):pack.decode_tensor(b'\0\0','F32',[2])
        with self.assertRaisesRegex(ValueError,'precision'):pack.decode_tensor(b'\0','I8',[1])

if __name__=='__main__':unittest.main()
