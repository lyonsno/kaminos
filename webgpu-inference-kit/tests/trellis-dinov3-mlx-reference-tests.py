"""Small CPU-only checks for the pinned MLX reference exporter."""

import importlib.util
import unittest
from types import SimpleNamespace
from pathlib import Path

import mlx.core as mx
import numpy as np


SCRIPT = Path(__file__).resolve().parents[1] / "tools/trellis-dinov3-mlx-reference.py"
SPEC = importlib.util.spec_from_file_location("trellis_dinov3_mlx_reference", SCRIPT)
REFERENCE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFERENCE)


class ReferenceArrayTests(unittest.TestCase):
    def test_evaluated_mlx_tensor_preserves_f32_values(self):
        mx.set_default_device(mx.cpu)
        result = REFERENCE.np_f32(mx, mx.array([[1.25, -2.5]], dtype=mx.float32))
        self.assertEqual(result.shape, (1, 2))
        self.assertEqual(result.dtype, np.float32)
        np.testing.assert_array_equal(result, [[1.25, -2.5]])


class FullConditioningContractTests(unittest.TestCase):
    def test_full_conditioning_rejects_native_source_revision_or_file_drift(self):
        self.assertTrue(
            hasattr(REFERENCE, "require_pinned_full_conditioning_source"),
            "full-conditioning must reject source identity outside the reviewed TRELLIS reference",
        )
        revision = "cddaf3cb8a9f28956114956ebe754d6661a3f695"
        source_sha256 = "5e56c76b947bbd59e9353c06470101ac28b6462649161cc8dd3740b2cf66403c"
        REFERENCE.require_pinned_full_conditioning_source(revision, source_sha256)

        with self.assertRaisesRegex(ValueError, "revision"):
            REFERENCE.require_pinned_full_conditioning_source("changed-revision", source_sha256)
        with self.assertRaisesRegex(ValueError, "source digest"):
            REFERENCE.require_pinned_full_conditioning_source(revision, "changed-source-digest")

    def test_full_layer_inventory_includes_every_checkpointed_block_without_truncation(self):
        self.assertTrue(
            hasattr(REFERENCE, "layer_weight_tensors"),
            "full-conditioning export must enumerate all block weights through one shared inventory",
        )
        projection = lambda: SimpleNamespace(weight=object(), bias=object())
        layers = []
        for _ in range(24):
            layers.append(SimpleNamespace(
                norm1=projection(),
                attention=SimpleNamespace(
                    q_proj=projection(), k_proj=SimpleNamespace(weight=object()),
                    v_proj=projection(), o_proj=projection(),
                ),
                layer_scale1=object(),
                norm2=projection(),
                mlp=SimpleNamespace(up_proj=projection(), down_proj=projection()),
                layer_scale2=object(),
            ))

        weights = REFERENCE.layer_weight_tensors(SimpleNamespace(layers=layers))
        self.assertEqual(len(weights), 24 * 17)
        self.assertEqual(weights["layer0_norm1_weight"], layers[0].norm1.weight)
        self.assertEqual(weights["layer23_layer_scale2"], layers[23].layer_scale2)
        self.assertIn("layer23_mlp_down_weight", weights)
        self.assertNotIn("layer24_norm1_weight", weights)

    def test_full_conditioning_output_requires_the_native_f32_feature_abi(self):
        self.assertTrue(
            hasattr(REFERENCE, "validate_full_conditioning_features"),
            "full conditioning must validate rather than recast the final DINO tensor",
        )
        valid = np.zeros((1, 1029, 1024), dtype=np.float32)
        result = REFERENCE.validate_full_conditioning_features(valid)
        self.assertEqual(result.shape, (1, 1029, 1024))
        self.assertEqual(result.dtype, np.float32)

        with self.assertRaisesRegex(ValueError, "shape"):
            REFERENCE.validate_full_conditioning_features(np.zeros((1, 1024, 1024), dtype=np.float32))
        with self.assertRaisesRegex(ValueError, "float32"):
            REFERENCE.validate_full_conditioning_features(valid.astype(np.float16))


if __name__ == "__main__":
    unittest.main()
