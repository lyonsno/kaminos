#!/usr/bin/env python3
"""Every admitted Trellis cast must have a replayable six-view orbit."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "trellis-results.json"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TrellisResultsTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = json.loads(RESULTS.read_text())

    def test_three_authenticated_casts_completed_on_the_effective_route(self) -> None:
        self.assertEqual(len(self.results["casts"]), 3)
        for cast in self.results["casts"]:
            glb = ROOT / cast["glbPath"]
            receipt = json.loads((ROOT / cast["receiptPath"]).read_text())
            self.assertTrue(glb.is_file(), glb)
            self.assertGreater(glb.stat().st_size, 100_000)
            self.assertEqual(sha256(glb), cast["glbSha256"])
            self.assertEqual(receipt["status"], "done")
            self.assertEqual(receipt["job_type"], "trellis2mlx_fast")
            self.assertIn("trellis2mlx", receipt["effective_route"])

    def test_each_cast_has_six_authenticated_orbit_views(self) -> None:
        for cast in self.results["casts"]:
            manifest = json.loads((ROOT / cast["orbitManifestPath"]).read_text())
            self.assertEqual(manifest["status"], "completed")
            self.assertEqual(len(manifest["outputs"]), 6)
            self.assertEqual(manifest["glb"]["sha256"], cast["glbSha256"])
            self.assertFalse(Path(manifest["glb"]["path"]).is_absolute())
            for view in manifest["outputs"]:
                self.assertFalse(Path(view["path"]).is_absolute())
                image = ROOT / view["path"]
                self.assertTrue(image.is_file(), image)
                self.assertEqual(sha256(image), view["sha256"])

    def test_comparison_sheet_exposes_every_view(self) -> None:
        sheet = (ROOT / "trellis-screen.html").read_text()
        for cast in self.results["casts"]:
            self.assertIn(cast["glbSha256"], sheet)
            manifest = json.loads((ROOT / cast["orbitManifestPath"]).read_text())
            for view in manifest["outputs"]:
                self.assertIn(view["path"], sheet)


if __name__ == "__main__":
    unittest.main()
