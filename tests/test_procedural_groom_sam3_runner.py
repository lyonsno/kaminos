import importlib.util
import unittest
from pathlib import Path

import numpy as np


RUNNER = Path(__file__).parents[1] / "tools" / "run-procedural-groom-sam3.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_sam3", RUNNER)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class Sam3RunnerContractTest(unittest.TestCase):
    def test_normalized_boxes_are_clamped_and_scaled_to_pixels(self):
        self.assertEqual(
            MODULE.pixel_box({"x_min": -0.1, "y_min": 0.25, "x_max": 1.1, "y_max": 0.75}, 100, 80),
            [0.0, 20.0, 100.0, 60.0],
        )
        with self.assertRaisesRegex(ValueError, "positive area"):
            MODULE.pixel_box({"x_min": 0.5, "y_min": 0.5, "x_max": 0.4, "y_max": 0.6}, 100, 80)

    def test_union_mask_is_binary_and_reports_no_detection_without_fake_pixels(self):
        empty = MODULE.union_masks(np.zeros((0, 5, 7), dtype=np.uint8), 5, 7)
        self.assertEqual(empty.shape, (5, 7))
        self.assertEqual(int(empty.sum()), 0)

        masks = np.zeros((2, 5, 7), dtype=np.uint8)
        masks[0, 1:3, 2:4] = 1
        masks[1, 2:4, 3:5] = 1
        combined = MODULE.union_masks(masks, 5, 7)
        self.assertEqual(set(np.unique(combined)), {0, 255})
        self.assertEqual(int((combined > 0).sum()), 7)


if __name__ == "__main__":
    unittest.main()
