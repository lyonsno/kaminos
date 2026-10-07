import importlib.util
import json
from pathlib import Path
import struct
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('native_glb',Path(__file__).parents[1]/'tools/anytop-native-glb.py')
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class NativeDisplay(unittest.TestCase):
    def test_source_keyframes_and_beam_endpoints(self):
        positions=np.array([[[0,1,0],[0,2,0]],[[1,1,0],[2,1,0]],[[1,2,0],[1,1,0]]],dtype=np.float32)
        payload=module.export_glb(positions,[-1,0],['pelvis','forearm'],20,{'label':'observed source fixture'})
        self.assertEqual(struct.unpack('<4sII',payload[:12]),(b'glTF',2,len(payload)))
        json_length=struct.unpack('<I',payload[12:16])[0]
        doc=json.loads(payload[20:20+json_length]);binary=payload[28+json_length:]
        def read(index):
            accessor=doc['accessors'][index];view=doc['bufferViews'][accessor['bufferView']]
            width={'SCALAR':1,'VEC3':3,'VEC4':4}[accessor['type']]
            return np.frombuffer(binary,dtype='<f4',count=accessor['count']*width,offset=view['byteOffset']).reshape(-1,width)
        tracks={}
        for channel in doc['animations'][0]['channels']:
            sampler=doc['animations'][0]['samplers'][channel['sampler']]
            np.testing.assert_allclose(read(sampler['input']).ravel(),[0,.05,.1])
            tracks[(channel['target']['node'],channel['target']['path'])]=read(sampler['output'])
        np.testing.assert_array_equal(tracks[(1,'translation')],positions[:,0])
        np.testing.assert_array_equal(tracks[(2,'translation')],positions[:,1])
        # Renderer beam local endpoints, transformed at every original keyframe,
        # must equal the source parent/child positions, including the -Y case.
        for frame in range(len(positions)):
            x,y,z,w=tracks[(3,'rotation')][frame]
            unit_y=np.array([2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w)])
            mid=tracks[(3,'translation')][frame];length=tracks[(3,'scale')][frame,1]
            np.testing.assert_allclose(mid-unit_y*length/2,positions[frame,0],atol=1e-6)
            np.testing.assert_allclose(mid+unit_y*length/2,positions[frame,1],atol=1e-6)

    def test_partial_nonfinite_and_bad_timing_rejected(self):
        for positions,fps in [(np.zeros((1,2,3)),20),(np.full((2,2,3),np.nan),20),(np.zeros((2,2,3)),0)]:
            with self.assertRaises(ValueError):
                module.export_glb(positions,[-1,0],['pelvis','forearm'],fps,{'label':'bad'})


if __name__=='__main__':
    unittest.main()
