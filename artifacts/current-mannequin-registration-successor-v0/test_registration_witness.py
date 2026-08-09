import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class RegistrationWitnessTest(unittest.TestCase):
    def setUp(self):
        self.result = json.loads((ROOT / "registration-results.json").read_text())

    def test_source_identity_is_exact(self):
        source = self.result["source"]
        self.assertEqual(source["object"], "Cube.056")
        self.assertEqual(
            source["sha256"],
            "ba04387f9e20c47a297450b0cc93747ae2f5918d5ab48a39820273c871b5ef48",
        )

    def test_only_one_global_similarity_transform_is_admitted(self):
        self.assertEqual(self.result["method"]["transformClass"], "global_similarity")
        self.assertFalse(self.result["method"]["allowsLocalDeformation"])
        self.assertFalse(self.result["method"]["allowsAnatomicalLandmarkEditing"])

    def test_each_cast_has_authenticated_replayable_views(self):
        self.assertEqual(len(self.result["casts"]), 3)
        for cast in self.result["casts"]:
            glb = (ROOT / cast["glb"]).resolve()
            self.assertTrue(glb.is_file())
            self.assertEqual(hashlib.sha256(glb.read_bytes()).hexdigest(), cast["glbSha256"])
            self.assertEqual(len(cast["views"]), 3)
            for view in cast["views"]:
                self.assertTrue((ROOT / view).is_file())
            self.assertGreater(cast["fit"]["sampleCount"], 100)
            self.assertGreater(cast["fit"]["scale"], 0)


if __name__ == "__main__":
    unittest.main()
