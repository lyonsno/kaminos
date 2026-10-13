# kaminos-test: python
"""Actual packager input block against observed MLX DINO normalization."""
import ast
from pathlib import Path
import tempfile
import unittest
import numpy as np
from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1]/'pack-prepared-generation.py'
tree = ast.parse(SCRIPT.read_text())
body = next(n for n in tree.body if isinstance(n,ast.Try)).body
start = next(i for i,n in enumerate(body) if isinstance(n,ast.With) and 'Image.open(image_path)' in ast.unparse(n))
end = next(i for i,n in enumerate(body[start:],start) if isinstance(n,ast.If) and 'values.shape' in ast.unparse(n.test))
block = ast.Module(body=body[start:end+1],type_ignores=[])

class SourceNormalization(unittest.TestCase):
    def test_actual_input_block_preserves_source_rounding(self):
        # Observed source: MLX1201553 trellmlx/models/dinov3.py:328–333,
        # SHA5e56c76b947bbd59e9353c06470101ac28b6462649161cc8dd3740b2cf66403c.
        # NumPy F32 pixel/255, then decimal F64 statistics, then MLX F32 input.
        # The live saved-bear prefix replay independently reports 374400/786432
        # differing old values, max2.384185791015625e-7; no neural call needed.
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder)/'source.png'
            rgb=np.arange(16*16*3,dtype=np.uint16).reshape(16,16,3).astype(np.uint8)
            Image.fromarray(rgb).save(p)
            ns=dict(Image=Image,np=np,image_path=p,original=dict(image={
                'mean':np.asarray([.485,.456,.406],dtype=np.float32).tolist(),
                'std':np.asarray([.229,.224,.225],dtype=np.float32).tolist()}))
            exec(compile(block,str(SCRIPT),'exec'),ns)
            resized=np.array(Image.open(p).convert('RGB').resize((512,512),Image.LANCZOS),dtype=np.float32)/255.0
            reference=np.ascontiguousarray(((resized-np.array([.485,.456,.406]))/np.array([.229,.224,.225]))[None],dtype='<f4')
            np.testing.assert_array_equal(ns['values'],reference,
                err_msg='packaged conditioning input must equal the observed MLX normalization, not early-F32 statistics')
            self.assertEqual(ns['values'].dtype,np.float32)
            ns['original']['image']['mean'][0]=.5
            with self.assertRaisesRegex(ValueError,'normalization differs'):
                exec(compile(block,str(SCRIPT),'exec'),ns)

if __name__=='__main__':unittest.main()
