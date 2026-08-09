#!/usr/bin/env python3
"""Trellis receives only visually admitted, nonredundant FLUX outputs."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = json.loads((ROOT / "campaign.json").read_text())
ADMISSION = json.loads((ROOT / "visual-admission.json").read_text())
LEDGER = ROOT / "trellis-submission-ledger.json"


class TrellisPromotionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.ledger = json.loads(LEDGER.read_text())

    def test_only_promoted_cells_are_submitted(self) -> None:
        admitted = {
            (cell["promptId"], cell["seed"])
            for cell in ADMISSION["cells"]
            if cell["promotedToTrellis"]
        }
        submitted = {(job["promptId"], job["seed"]) for job in self.ledger["jobs"]}
        self.assertEqual(submitted, admitted)
        self.assertLessEqual(len(submitted), CAMPAIGN["trellisPromotion"]["maximumCandidates"])

    def test_each_job_names_the_exact_source_output(self) -> None:
        flux = json.loads((ROOT / "flux-results.json").read_text())
        outputs = {
            (cell["promptId"], cell["seed"]): cell["outputPath"]
            for cell in flux["cells"]
        }
        for job in self.ledger["jobs"]:
            self.assertEqual(job["inputPath"], outputs[(job["promptId"], job["seed"])])


if __name__ == "__main__":
    unittest.main()
