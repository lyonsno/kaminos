"""Small CPU-only checks for the pinned MLX reference exporter."""

import importlib.util
import unittest
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


if __name__ == "__main__":
    unittest.main()
