# kaminos-test: manual -- Offline ONNX-export conformance; run with the documented export interpreter.
"""Dynamic image grids must survive the exact Qwen3.5 vision export."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from transformers.models.qwen3_5.configuration_qwen3_5 import Qwen3_5VisionConfig
from transformers.models.qwen3_5.modeling_qwen3_5 import Qwen3_5VisionModel
from transformers.vision_utils import get_vision_interpolation_indices_and_weights, get_vision_position_ids

root = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('pup_vision', root / 'models/bfl-pup/vision_export.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def inputs(config, h, w):
    grid = torch.tensor([[1, h, w]], dtype=torch.int64)
    pixel_width = config.in_channels * config.temporal_patch_size * config.patch_size ** 2
    pixels = torch.linspace(-1, 1, h * w * pixel_width).reshape(h * w, pixel_width)
    positions = get_vision_position_ids(grid, config.spatial_merge_size)
    indices, weights = get_vision_interpolation_indices_and_weights(
        grid, int(config.num_position_embeddings ** .5), align_corners=True,
        spatial_merge_size=config.spatial_merge_size)
    return pixels, positions, indices, weights, grid


class VisionExportContract(unittest.TestCase):
    def test_multiple_images_require_separate_encoder_calls(self):
        config = Qwen3_5VisionConfig(depth=1, hidden_size=32, intermediate_size=64,
            num_heads=4, out_hidden_size=16, patch_size=2, temporal_patch_size=2,
            num_position_embeddings=16)
        vision = Qwen3_5VisionModel(config).eval()
        args = list(inputs(config, 4, 4))
        args[-1] = torch.tensor([[1, 2, 4], [1, 2, 4]], dtype=torch.int64)
        with self.assertRaisesRegex(ValueError, 'one image'):
            module.VisionForExport(vision)(*args)

    def test_other_image_grid_matches_canonical_vision(self):
        torch.manual_seed(7)
        config = Qwen3_5VisionConfig(depth=1, hidden_size=32, intermediate_size=64,
            num_heads=4, out_hidden_size=16, patch_size=2, temporal_patch_size=2,
            num_position_embeddings=16)
        config._attn_implementation = 'sdpa'
        vision = Qwen3_5VisionModel(config).eval()
        wrapper = module.VisionForExport(vision).eval()
        names = ['pixel_values', 'position_ids', 'interp_indices', 'interp_weights', 'grid_thw']
        first = inputs(config, 4, 4)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'vision.onnx'
            with torch.no_grad():
                torch.onnx.export(wrapper, first, target, input_names=names,
                    output_names=['image_features'], opset_version=17, dynamo=False,
                    dynamic_axes={**{name: {0: 'patches' if name != 'grid_thw' else 'images'} for name in names},
                                  'image_features': {0: 'features'}})
            session = ort.InferenceSession(str(target), providers=['CPUExecutionProvider'])
            for h, w in [(4, 4), (4, 6), (6, 4)]:
                args = inputs(config, h, w)
                feed = {name: value.numpy() for name, value in zip(names, args)}
                actual = session.run(None, {i.name: feed[i.name] for i in session.get_inputs()})[0]
                with torch.no_grad():
                    expected = vision(args[0], args[-1]).pooler_output.numpy()
                self.assertEqual(actual.shape, (h * w // 4, config.out_hidden_size))
                np.testing.assert_allclose(actual, expected, rtol=2e-4, atol=2e-5)


if __name__ == '__main__':
    unittest.main()
