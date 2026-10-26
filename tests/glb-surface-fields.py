# kaminos-test: python
import importlib.util
import io
import json
from pathlib import Path
import struct
import tempfile
import unittest
import subprocess
import sys
import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location('sampler', Path(__file__).resolve().parents[1] / 'tools/glb_surface_fields.py')
sampler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sampler)


def fixture(path, alpha='OPAQUE', matrix=None, extension=None, zero_normal=False):
    # Two equal-area triangles separated in space, with constant UVs at distinct texel centres.
    pos = np.array([[0,0,0],[1,0,0],[0,1,0], [2,0,0],[3,0,0],[2,1,0]], '<f4')
    normals = np.tile([0,0,1], (6,1)).astype('<f4')
    if zero_normal: normals[0] = 0
    uv = np.array([[.25,.25]]*3 + [[.75,.75]]*3, '<f4')
    index = np.arange(6, dtype='<u4')
    color = np.array([[[128,64,32,0],[0,0,255,0]],[[0,255,0,0],[255,128,64,0]]], 'uint8')
    mr = np.array([[[0,64,192],[0,0,0]],[[0,0,0],[0,192,64]]], 'uint8')
    chunks = [index.tobytes(), pos.tobytes(), normals.tobytes(), uv.tobytes()]
    for pixels in [color, mr]:
        stream = io.BytesIO(); Image.fromarray(pixels).save(stream, format='PNG'); chunks.append(stream.getvalue())
    blob = bytearray(); views = []
    for c in chunks:
        views.append({'buffer':0,'byteOffset':len(blob),'byteLength':len(c)})
        blob.extend(c); blob.extend(b'\0'*(-len(blob)%4))
    material = {'pbrMetallicRoughness':{'baseColorTexture':{'index':0},'baseColorFactor':[.5,1,1,.1],
                'metallicRoughnessTexture':{'index':1},'metallicFactor':.5,'roughnessFactor':.5},'alphaMode':alpha}
    if extension: material['extensions'] = extension
    node = {'mesh':0}
    if matrix: node['matrix'] = matrix
    doc = {'asset':{'version':'2.0'},'scene':0,'scenes':[{'nodes':[0]}], 'nodes':[node],
           'buffers':[{'byteLength':len(blob)}], 'bufferViews':views,
           'accessors':[{'bufferView':i,'componentType':5125 if i==0 else 5126,
                         'type':['SCALAR','VEC3','VEC3','VEC2'][i],'count':6} for i in range(4)],
           'meshes':[{'primitives':[{'indices':0,'attributes':{'POSITION':1,'NORMAL':2,'TEXCOORD_0':3},'material':0}]}],
           'materials':[material],'textures':[{'source':0},{'source':1}],
           'images':[{'bufferView':4,'mimeType':'image/png'},{'bufferView':5,'mimeType':'image/png'}]}
    data = json.dumps(doc).encode(); data += b' '*(-len(data)%4)
    path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(data)+len(blob)) + struct.pack('<II',len(data),0x4e4f534a)+data+struct.pack('<II',len(blob),0x004e4942)+blob)


class Sampling(unittest.TestCase):
    def test_interiors_materials_source_ids_and_determinism(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'source.glb'; fixture(p)
            rows, parents, bary, meta = sampler.sample_glb(p, 64)
            self.assertEqual(rows.shape,(64,12)); self.assertTrue(np.isfinite(rows).all())
            self.assertEqual(np.bincount(parents).tolist(),[32,32])
            self.assertTrue((bary>0).all()); np.testing.assert_allclose(bary.sum(1),1,atol=1e-7)
            np.testing.assert_allclose(rows[:,:2], np.c_[bary[:,1]+2*parents,bary[:,2]],atol=1e-7)
            np.testing.assert_allclose(rows[:,3:6],np.tile([0,0,1],(64,1)))
            # RGB texture is sRGB, but glTF baseColorFactor multiplies LINEAR values.
            linear=((128/255+.055)/1.055)**2.4*.5
            red=1.055*linear**(1/2.4)-.055
            np.testing.assert_allclose(rows[:32,6],red,atol=1e-6)
            np.testing.assert_allclose(rows[:32,9:11],np.tile([192/255*.5,64/255*.5],(32,1)),atol=1e-6)
            np.testing.assert_allclose(rows[32:,9:11],np.tile([64/255*.5,192/255*.5],(32,1)),atol=1e-6)
            self.assertTrue((rows[:,11]==1).all(),'OPAQUE ignores alpha texture and factor')
            self.assertEqual(meta['sourceKind'],'sampled-glb'); self.assertEqual(meta['sourceTriangleCount'],2)
            self.assertNotIn('decoderGridSize',meta)
            np.testing.assert_array_equal(rows,sampler.sample_glb(p,64)[0])

    def test_zero_normal_uses_local_face_and_records_the_repair(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'source.glb';fixture(p,zero_normal=True)
            rows, _, _, meta=sampler.sample_glb(p,16)
            np.testing.assert_allclose(rows[:,3:6],np.tile([0,0,1],(16,1)))
            self.assertEqual(meta['normalFallback']['zeroSourceVertices'],1)
            self.assertEqual(meta['normalFallback']['affectedSamples'],8)

    def test_transform_and_normal_inverse_transpose(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'source.glb'; fixture(p,matrix=[2,0,0,0, 0,0,3,0, 0,-4,0,0, 5,6,7,1])
            rows, parents, bary, _ = sampler.sample_glb(p,16)
            np.testing.assert_allclose(rows[:,0],5+2*(bary[:,1]+parents*2),atol=1e-6)
            np.testing.assert_allclose(rows[:,1],6);np.testing.assert_allclose(rows[:,2],7+3*bary[:,2],atol=1e-6)
            np.testing.assert_allclose(rows[:,3:6],np.tile([0,-1,0],(16,1)),atol=1e-6)

    def test_unsupported_material_is_not_silently_flattened(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'source.glb';fixture(p,alpha='BLEND')
            with self.assertRaisesRegex(ValueError,'OPAQUE'):sampler.sample_glb(p,16)
            fixture(p,extension={'KHR_materials_transmission':{'transmissionFactor':1}})
            with self.assertRaisesRegex(ValueError,'material extension'):sampler.sample_glb(p,16)

    def test_cli_failure_report_and_source_preservation(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); p=root/'source.glb';fixture(p,alpha='BLEND')
            original=p.read_bytes()
            command=[sys.executable,str(Path(sampler.__file__)),str(p),str(root/'failed'),'--count','8']
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            report=json.loads((root/'failed/report.json').read_text())
            self.assertFalse(report['ok']);self.assertEqual(report['phase'],'sample')
            self.assertIn('OPAQUE',report['error']);self.assertEqual(p.read_bytes(),original)
            command[3]=str(root)
            self.assertNotEqual(subprocess.run(command,capture_output=True).returncode,0)
            self.assertEqual(p.read_bytes(),original)

if __name__=='__main__':unittest.main()
