import importlib.util
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).parents[1] / "tools" / "compare-procedural-groom-estimation.py"


def load_script():
    spec = importlib.util.spec_from_file_location("procedural_groom_comparison", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProceduralGroomComparisonTests(unittest.TestCase):
    def setUp(self):
        self.module = load_script()

    def _mask(self, root, name, pixels, size=(4, 4)):
        path = Path(root) / name
        values = bytearray(size[0] * size[1])
        for x, y in pixels:
            values[y * size[0] + x] = 255
        self.module.write_grayscale_png(path, size[0], size[1], values)
        return path

    def test_mask_metrics_penalize_an_all_frame_false_positive(self):
        with tempfile.TemporaryDirectory() as root:
            truth = self._mask(root, "truth.png", {(1, 1), (2, 1)})
            predicted = self._mask(
                root,
                "predicted.png",
                {(x, y) for x in range(4) for y in range(4)},
            )
            metrics = self.module.mask_metrics(predicted, truth)
            self.assertEqual(metrics["intersectionPixels"], 2)
            self.assertEqual(metrics["predictedPixels"], 16)
            self.assertAlmostEqual(metrics["iou"], 0.125)
            self.assertAlmostEqual(metrics["precision"], 0.125)
            self.assertAlmostEqual(metrics["recall"], 1.0)

    def test_blank_truth_fails_instead_of_becoming_a_perfect_empty_match(self):
        with tempfile.TemporaryDirectory() as root:
            truth = self._mask(root, "truth.png", set())
            predicted = self._mask(root, "predicted.png", set())
            with self.assertRaisesRegex(ValueError, "truth mask is blank"):
                self.module.mask_metrics(predicted, truth)

    def test_different_image_dimensions_fail_loud(self):
        with tempfile.TemporaryDirectory() as root:
            truth = self._mask(root, "truth.png", {(1, 1)}, size=(4, 4))
            predicted = self._mask(root, "predicted.png", {(1, 1)}, size=(5, 4))
            with self.assertRaisesRegex(ValueError, "dimensions"):
                self.module.mask_metrics(predicted, truth)

    def test_best_match_is_selected_by_iou_not_by_semantic_name(self):
        candidates = {
            "short-coat": {"iou": 0.05},
            "puffy-coat": {"iou": 0.72},
            "ruff": {"iou": 0.31},
        }
        self.assertEqual(self.module.select_best_truth_match(candidates), "puffy-coat")

    def test_public_evidence_path_does_not_emit_the_private_repo_root(self):
        repo_root = Path("/private/tmp/private-agent-worktree")
        path = repo_root / "artifacts" / "mask.png"
        self.assertEqual(
            self.module.public_evidence_path(path, repo_root),
            "artifacts/mask.png",
        )


if __name__ == "__main__":
    unittest.main()
