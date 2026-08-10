import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]


class HistoricalRegistrationWitnessTest(unittest.TestCase):
    def setUp(self):
        self.result = json.loads((ROOT / "historical-registration-results.json").read_text())

    def test_historical_source_and_cast_are_exact(self):
        self.assertEqual(
            self.result["source"]["sha256"],
            "cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e",
        )
        self.assertEqual(
            self.result["cast"]["sha256"],
            "372887134a3994e2d980f14419ef7bc8bdcbc36c275feaeeaf53c311fffcf24d",
        )
        for key in ("source", "cast"):
            recorded = Path(self.result[key]["path"])
            self.assertFalse(recorded.is_absolute())
            path = REPO_ROOT / recorded
            self.assertTrue(path.is_file())
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), self.result[key]["sha256"])

    def test_fit_uses_global_similarity_without_local_edits(self):
        method = self.result["method"]
        self.assertEqual(method["transformClass"], "global_similarity")
        self.assertFalse(method["allowsLocalDeformation"])
        self.assertFalse(method["allowsAnatomicalLandmarkEditing"])

    def test_witness_has_metric_and_three_nonblank_views(self):
        fit = self.result["fit"]
        self.assertGreater(fit["sampleCount"], 100)
        self.assertGreater(fit["scale"], 0)
        self.assertGreaterEqual(fit["normalizedMedianDistance"], 0)
        self.assertGreaterEqual(fit["normalizedP90Distance"], fit["normalizedMedianDistance"])
        self.assertEqual(len(self.result["views"]), 3)
        for relative in self.result["views"]:
            path = ROOT / relative
            self.assertTrue(path.is_file())
            self.assertGreater(path.stat().st_size, 10_000)


if __name__ == "__main__":
    unittest.main()
