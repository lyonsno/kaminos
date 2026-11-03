# kaminos-test: python
import importlib.util, json, pathlib, tempfile, unittest, hashlib
spec=importlib.util.spec_from_file_location('installations',pathlib.Path(__file__).resolve().parents[1]/'model_installations.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class NativeQwenInstallation(unittest.TestCase):
 def test_registered_manifest_and_payload_mount_without_replacing_onnx(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp); package=root/'weights';package.mkdir();(package/'model.safetensors').write_bytes(b'1234');(package/'tokenizer.json').write_text('{}');(package/'config.json').write_text('{}')
   manifest={'schema':'kaminos.qwen35-text-weights.v1','config':{'text_config':{}},'source':{'configSha256':hashlib.sha256(b'{}').hexdigest(),'files':{'model.safetensors':{'bytes':4}}},'tensors':{'x':{'file':'model.safetensors'}}}
   (package/'weights.json').write_text(json.dumps(manifest));catalog=root/'models.json';catalog.write_text(json.dumps({'schema':m.SCHEMA,'models':{'pup':{'root':'existing-onnx'}}}))
   m.register_model('qwen35',package,catalog)
   self.assertEqual(json.loads(catalog.read_text())['models']['pup']['root'],'existing-onnx')
   config=m.ModelInstallations(environ={},config_path=catalog).browser_config();self.assertTrue(config['qwen35']['mounted']);self.assertEqual(config['qwen35']['modelUrl'],'/qwen35-weights');self.assertEqual(config['qwen35']['manifestUrl'],'/qwen35-weights/weights.json')
   self.assertEqual(config['qwen35']['manifestSha256'],hashlib.sha256((package/'weights.json').read_bytes()).hexdigest())
   (package/'model.safetensors').write_bytes(b'1');self.assertEqual(m.ModelInstallations(environ={},config_path=catalog).availability('qwen35')['status'],'unavailable')
if __name__=='__main__':unittest.main()
