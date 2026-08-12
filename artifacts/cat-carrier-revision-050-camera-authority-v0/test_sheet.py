"""Contracts for the operator-visible revision-050 comparison sheet."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SHEET = ROOT / "revision-050-camera-authority.html"


class EvidenceSheetContract(unittest.TestCase):
    def test_sheet_exposes_complete_matrix_and_provenance(self) -> None:
        self.assertTrue(SHEET.is_file(), "primary evidence sheet is missing")
        markup = SHEET.read_text()
        campaign = json.loads((ROOT / "campaign.json").read_text())
        self.assertEqual(markup.count("data-new-cell-id="), 20)
        self.assertEqual(markup.count("data-control-cell-id="), 12)
        for family in campaign["promptFamilies"]:
            self.assertIn(family["prompt"], markup)
        for source in campaign["sources"].values():
            self.assertIn(source["plateSha256"], markup)
        self.assertIn("flux2-klein-9b", markup)
        self.assertIn("guidance 1.0", markup)

    def test_sheet_distinguishes_live_results_from_prior_controls(self) -> None:
        markup = SHEET.read_text()
        self.assertIn("Frozen revision 048 control", markup)
        self.assertIn("Current revision 050", markup)
        self.assertIn("Camera authority", markup)
        self.assertNotIn("Visual interpretation pending", markup)
        self.assertIn("Camera sign survives", markup)
        self.assertIn("revision 050 materially increases source authority", markup)


if __name__ == "__main__":
    unittest.main()
