# kaminos-test: manual -- pinned optional ONNX export environment
"""Package rewrites preserve cache layout and every external tensor byte."""
import importlib.util
import tempfile
import unittest
from pathlib import Path
import onnx
from onnx import helper, TensorProto
spec=importlib.util.spec_from_file_location('package',Path(__file__).parents[1]/'models/bfl-pup/prepare_package.py')
p=importlib.util.module_from_spec(spec); spec.loader.exec_module(p)

class PackageTests(unittest.TestCase):
 def test_tensor_boundary_shards_and_cache_metadata(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); (root/'weights').write_bytes(bytes(range(64)))
   ts=[]
   for i,(offset,size) in enumerate([(0,24),(24,24),(48,16)]):
    t=TensorProto(name=f'w{i}',data_type=TensorProto.UINT8,dims=[size])
    t.data_location=TensorProto.EXTERNAL
    for k,v in [('location','weights'),('offset',str(offset)),('length',str(size))]:
     entry=t.external_data.add(); entry.key=k; entry.value=v
    ts.append(t)
   graph=helper.make_graph([helper.make_node('Identity',['past.0.conv'],['present.0.conv'])],'decoder',
    [helper.make_tensor_value_info('past.0.conv',TensorProto.FLOAT16,['batch_size',8192,3]),
     helper.make_tensor_value_info('past_key_values.3.key',TensorProto.FLOAT16,['batch_size',4,'past_sequence_length','kv_cache_dim'])],
    [helper.make_tensor_value_info('present.0.conv',TensorProto.FLOAT16,['batch_size',8192,3])],ts)
   model=helper.make_model(graph); onnx.save(model,root/'decoder.onnx')
   out=root/'out'; out.mkdir()
   count=p.package_graph(root/'decoder.onnx',out/'decoder_model_merged_q4f16.onnx',head_dim=256,chunk_bytes=40)
   self.assertEqual(count,2)
   loaded=onnx.load(out/'decoder_model_merged_q4f16.onnx',load_external_data=False)
   self.assertEqual(loaded.graph.input[0].name,'past_conv.0')
   self.assertEqual(loaded.graph.node[0].input[0],'past_conv.0')
   self.assertEqual(loaded.graph.node[0].output[0],'present_conv.0')
   self.assertEqual(loaded.graph.input[0].type.tensor_type.elem_type,TensorProto.FLOAT16)
   self.assertEqual(loaded.graph.input[1].type.tensor_type.shape.dim[3].dim_value,256)
   for source,tensor in zip(ts,loaded.graph.initializer):
    a={e.key:e.value for e in source.external_data}; b={e.key:e.value for e in tensor.external_data}
    raw=(out/b['location']).read_bytes()[int(b['offset']):int(b['offset'])+int(b['length'])]
    self.assertEqual(raw,(root/'weights').read_bytes()[int(a['offset']):int(a['offset'])+int(a['length'])])
 def test_no_partial_source_can_pass(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d); (root/'weights').write_bytes(b'a')
   t=TensorProto(name='w',data_type=TensorProto.UINT8,dims=[2]); t.data_location=TensorProto.EXTERNAL
   for k,v in [('location','weights'),('offset','0'),('length','2')]:
    entry=t.external_data.add();entry.key=k;entry.value=v
   onnx.save(helper.make_model(helper.make_graph([],'g',[],[],[t])),root/'g.onnx')
   (root/'out').mkdir()
   with self.assertRaisesRegex(ValueError,'incomplete'):
    p.package_graph(root/'g.onnx',root/'out'/'g.onnx',head_dim=256)

if __name__=='__main__': unittest.main()
