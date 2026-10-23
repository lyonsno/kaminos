"""Conversion-only tests through the real CLI boundary; exporter/backend is synthetic."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
spec=importlib.util.spec_from_file_location('retained_metal_adapter',ROOT/'finish-retained-metal.py')
adapter=importlib.util.module_from_spec(spec);spec.loader.exec_module(adapter)


class MetalMaterialConversion(unittest.TestCase):
    def test_real_adapter_checkpoint_has_f32_source_affine_channels_and_preserves_raw(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'source';(source/'scripts').mkdir(parents=True)
            # Explicit stand-in records that conversion precedes exporter invocation.
            (source/'scripts/source_metal_remesh_finishing.py').write_text('def run(args):\n    return {"status":"complete","syntheticExporter":True}\n')
            def descriptor(name,value,dtype):
                data=value.tobytes();(root/name).write_bytes(data)
                return {'file':name,'dtype':dtype,'shape':list(value.shape),'byteLength':len(data),'sha256':hashlib.sha256(data).hexdigest()}
            features=np.array([[-1,-.5,0,.25,1,2],[.632819,.329929,.504693,0,-.08445444,1]],dtype=np.float32)
            material={'root':str(root),'resolution':32,
                'features':descriptor('material.f32',features,'f32'),
                'coordinates':descriptor('coords.i32',np.array([[0,0,0],[1,0,0]],dtype=np.int32),'i32')}
            mesh={'vertices':descriptor('vertices.f32',np.array([[0,0,0],[1,0,0],[0,1,0]],dtype=np.float32),'float32'),
                  'triangles':descriptor('triangles.u32',np.array([[0,1,2]],dtype=np.uint32),'uint32')}
            (root/'mesh.json').write_text(json.dumps(mesh));(root/'material.json').write_text(json.dumps(material))
            raw=(root/'material.f32').read_bytes();out=root/'output'
            argv=['adapter','--source-root',str(source),'--expected-source-commit','a'*40,
                '--mesh-input',str(root/'mesh.json'),'--material-input',str(root/'material.json'),
                '--grid-size','32','--target-faces','8','--texture-size','64','--band','1','--project-back','0',
                '--backend-manifest',str(root/'backend.json'),'--output-dir',str(out)]
            with patch.object(sys,'argv',argv),patch.object(adapter,'git_source_identity',return_value={'commit':'a'*40,'dirty':''}):
                self.assertEqual(adapter.main(),0)
            with np.load(out/'checkpoints/texture.npz') as converted:
                self.assertEqual(converted['tex_np'].dtype,np.float32)
                np.testing.assert_array_equal(converted['tex_np'],features*np.float32(.5)+np.float32(.5),
                    err_msg='Metal checkpoint must carry source-affine material channels, not raw decoder features')
            self.assertEqual((root/'material.f32').read_bytes(),raw)


if __name__=='__main__':unittest.main()
