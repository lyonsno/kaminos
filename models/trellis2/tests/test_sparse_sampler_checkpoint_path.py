import importlib.util
from pathlib import Path
import tempfile
import unittest

script = Path(__file__).parents[1] / 'export-sparse-sampler.py'
spec = importlib.util.spec_from_file_location('sampler_export', script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CheckpointModelPath(unittest.TestCase):
    def test_keep_source_format_name_instead_of_resolved_blob(self):
        self.assertTrue(callable(getattr(module, 'model_checkpoint_path', None)),
            'Source MLX loader must receive the observed named safetensors path, not the extensionless resolved HF blob.')
        with tempfile.TemporaryDirectory() as folder:
            blob = Path(folder) / 'ca01377c485bec418076d38ee80166d32dc776d744f2553b835cba1e97a7abf6'
            blob.write_bytes(b'raw-observed-format-routing-contract')
            named = Path(folder) / 'ss_flow_img_dit_1_3B_64_bf16.safetensors'
            named.symlink_to(blob)
            self.assertEqual(module.model_checkpoint_path(named, blob), named.absolute())
            with self.assertRaisesRegex(ValueError, 'named.*safetensors'):
                module.model_checkpoint_path(blob, blob)
            other = Path(folder) / 'other.safetensors'
            other.write_bytes(b'other')
            with self.assertRaisesRegex(ValueError, 'same checkpoint'):
                module.model_checkpoint_path(other, blob)


if __name__ == '__main__':
    unittest.main()
