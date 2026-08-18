import importlib.util
import math
import unittest
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "tools" / "procedural_groom_source_like_request.py"
SPEC = importlib.util.spec_from_file_location("procedural_groom_source_like_request", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)


@unittest.skipUnless(SPEC.loader is not None, "request resolver loader unavailable")
class SourceLikeGroomRequestTest(unittest.TestCase):
    def load_module(self):
        assert SPEC.loader is not None
        SPEC.loader.exec_module(MODULE)
        return MODULE

    def test_default_request_preserves_all_baseline_lengths(self):
        module = self.load_module()
        resolved = module.resolve_groom_request({"densityMultiplier": 12})
        self.assertEqual(resolved["densityMultiplier"], 12)
        self.assertEqual(resolved["ruffLengthMultiplier"], 1.0)
        self.assertEqual(resolved["baselineLengths"], resolved["effectiveLengths"])
        self.assertEqual(resolved["observationSuffix"], "density-12x")

    def test_constitutive_arm_changes_only_ruff_length_by_exact_requested_multiplier(self):
        module = self.load_module()
        resolved = module.resolve_groom_request({
            "densityMultiplier": 12,
            "ruffLengthMultiplier": 2.5,
        })
        self.assertEqual(resolved["effectiveLengths"]["short"], 0.065)
        self.assertEqual(resolved["effectiveLengths"]["puffy"], 0.19)
        self.assertTrue(math.isclose(resolved["effectiveLengths"]["ruff"], 0.85))
        self.assertEqual(resolved["ruffLengthMultiplier"], 2.5)
        self.assertEqual(resolved["observationSuffix"], "density-12x-ruff-length-2p5x")

    def test_nonpositive_or_nonfinite_ruff_multiplier_fails_loud(self):
        module = self.load_module()
        for value in [0, -1, float("inf"), float("nan"), True, "2.5"]:
            with self.subTest(value=value):
                with self.assertRaisesRegex(ValueError, "ruffLengthMultiplier"):
                    module.resolve_groom_request({
                        "densityMultiplier": 12,
                        "ruffLengthMultiplier": value,
                    })


if __name__ == "__main__":
    unittest.main()
