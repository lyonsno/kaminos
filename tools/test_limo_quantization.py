import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import torch
from optimum.quanto import QModuleMixin

import limo_quantization as quant


class LimoQuantizationTests(unittest.TestCase):
    def test_integer_weights_are_frozen_and_projection_is_preserved(self):
        torch.manual_seed(19)
        model = torch.nn.Sequential(torch.nn.Linear(256, 256), torch.nn.Linear(256, 64)).half()
        original = model[1].weight.detach().clone()
        names = quant.quantize_linears(model, 4, exclude=('1',))
        self.assertEqual(names, ['0'])
        self.assertIsInstance(model[0], QModuleMixin)
        self.assertTrue(model[0].frozen)
        self.assertEqual(model[0].weight.qtype.bits, 4)
        self.assertNotIsInstance(model[1], QModuleMixin)
        torch.testing.assert_close(model[1].weight, original, rtol=0, atol=0)

    def test_serialized_integer_weights_reload_without_float_materialization(self):
        for bits, ratio in ((4, .4), (8, .65)):
            with self.subTest(bits=bits), tempfile.TemporaryDirectory() as temp:
                torch.manual_seed(31)
                model = quant.tiny_model()
                inputs = torch.randn(1, 4, 256).half()
                quant.quantize_linears(model, bits)
                expected = model(inputs)
                root = Path(temp) / 'packed'
                record = quant.save_package(model, root, {'fixture': 'seed31'})
                self.assertLess(record['weights']['bytes'], 263168 * ratio)
                restored, _ = quant.load_package(quant.tiny_model('meta'), root)
                torch.testing.assert_close(restored(inputs), expected, rtol=0, atol=0)
                self.assertTrue(all(m.frozen for m in restored.modules() if isinstance(m, QModuleMixin)))

    def test_missing_quantized_tensor_cannot_be_accepted_as_reload(self):
        with tempfile.TemporaryDirectory() as temp:
            model = quant.tiny_model()
            quant.quantize_linears(model, 4)
            root = Path(temp) / 'packed'
            record = quant.save_package(model, root, {})
            state = quant.load_file(str(root / 'weights.safetensors'))
            key = next(name for name in state if 'weight._data' in name)
            del state[key]
            quant.save_file(state, str(root / 'weights.safetensors'))
            # Even when an attacker updates the container checksum, tensor coverage fails.
            record['weights'] = {'bytes': (root / 'weights.safetensors').stat().st_size,
                                 'sha256': quant.digest(root / 'weights.safetensors')}
            quant.save_json(root / 'package.json', record)
            with self.assertRaisesRegex(ValueError, 'coverage'):
                quant.load_package(quant.tiny_model('meta'), root)

    def test_aliases_preserve_tied_embedding_without_duplicate_payload(self):
        class Tied(torch.nn.Module):
            def __init__(self, device='cpu'):
                super().__init__()
                self.shared = torch.nn.Embedding(512, 256, device=device, dtype=torch.float16)
                self.alias = self.shared
                self.proj = torch.nn.Linear(256, 256, device=device, dtype=torch.float16)
        with tempfile.TemporaryDirectory() as temp:
            model = Tied()
            quant.quantize_linears(model, 4)
            root = Path(temp) / 'packed'
            record = quant.save_package(model, root, {})
            self.assertEqual(record['aliases'], {'alias.weight': 'shared.weight'})
            restored, _ = quant.load_package(Tied('meta'), root)
            torch.testing.assert_close(restored.alias.weight, model.shared.weight, rtol=0, atol=0)

    def test_wrong_map_or_altered_container_fails_loud(self):
        with tempfile.TemporaryDirectory() as temp:
            model = quant.tiny_model()
            quant.quantize_linears(model, 4)
            root = Path(temp) / 'packed'
            record = quant.save_package(model, root, {})
            record['quantization']['nonexistent'] = record['quantization'].pop('0')
            quant.save_json(root / 'package.json', record)
            with self.assertRaisesRegex(ValueError, 'module absent'):
                quant.load_package(quant.tiny_model('meta'), root)
            with (root / 'weights.safetensors').open('ab') as stream:
                stream.write(b'bad')
            with self.assertRaisesRegex(ValueError, 'digest'):
                quant.load_package(quant.tiny_model('meta'), root)

    def test_early_route_failure_preserves_failed_report(self):
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'out'
            with patch.object(quant, 'require_mps', side_effect=RuntimeError('no MPS')):
                with self.assertRaisesRegex(RuntimeError, 'no MPS'):
                    quant.main(['--output-dir', str(output), '--route-check'])
            result = json.loads((output / 'conversion.json').read_text())
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['phase'], 'initialization')
            self.assertTrue(result['requested']['routeCheck'])
            self.assertNotIn('effective', result)

    def test_no_eligible_layers_and_unsupported_bits_fail(self):
        with self.assertRaisesRegex(ValueError, 'no eligible'):
            quant.quantize_linears(torch.nn.Sequential(torch.nn.LayerNorm(4)), 4)
        with self.assertRaisesRegex(ValueError, '4 or 8'):
            quant.quantize_linears(quant.tiny_model(), 2)

    def test_queue_created_directory_accepts_run_but_existing_report_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(quant, 'require_mps', side_effect=RuntimeError('no MPS')):
                with self.assertRaisesRegex(RuntimeError, 'no MPS'):
                    quant.main(['--output-dir', temp, '--route-check'])
            before = (Path(temp) / 'conversion.json').read_bytes()
            with self.assertRaisesRegex(FileExistsError, 'prior conversion'):
                quant.main(['--output-dir', temp, '--route-check'])
            self.assertEqual((Path(temp) / 'conversion.json').read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
