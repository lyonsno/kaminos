import importlib.util
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "boundary-splat-radiance-mlx.py"
SPEC = importlib.util.spec_from_file_location("boundary_splat_radiance_mlx", SCRIPT_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FrameSplitTest(unittest.TestCase):
    def test_default_reuses_all_frames_for_backward_compatible_training_and_evaluation(self):
        split = MODULE.resolve_frame_splits(["a", "b", "c"], None, None)
        self.assertEqual(split["trainIndices"], [0, 1, 2])
        self.assertEqual(split["evaluationIndices"], [0, 1, 2])
        self.assertEqual(split["authority"], "all-frames-train-and-evaluate-v0")

        queued_split = MODULE.resolve_frame_splits(["a", "b", "c"], "all", "all")
        self.assertEqual(queued_split, split)

    def test_explicit_holdout_is_disjoint_and_preserves_frame_identity(self):
        split = MODULE.resolve_frame_splits(["a", "b", "c"], "0,1", "2")
        self.assertEqual(split["trainIndices"], [0, 1])
        self.assertEqual(split["evaluationIndices"], [2])
        self.assertEqual(split["trainFrameIds"], ["a", "b"])
        self.assertEqual(split["evaluationFrameIds"], ["c"])
        self.assertEqual(split["authority"], "explicit-disjoint-frame-holdout-v0")

    def test_explicit_holdout_rejects_overlap(self):
        with self.assertRaisesRegex(ValueError, "must not overlap"):
            MODULE.resolve_frame_splits(["a", "b", "c"], "0,1", "1,2")

    def test_explicit_holdout_rejects_duplicates_and_out_of_range_indices(self):
        with self.assertRaisesRegex(ValueError, "duplicate"):
            MODULE.resolve_frame_splits(["a", "b", "c"], "0,0", "2")
        with self.assertRaisesRegex(ValueError, "out of range"):
            MODULE.resolve_frame_splits(["a", "b", "c"], "0,1", "3")


if __name__ == "__main__":
    unittest.main()
