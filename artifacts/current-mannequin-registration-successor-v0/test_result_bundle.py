#!/usr/bin/env python3
"""Result bundle must expose all cells and their effective Greenroom routes."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = json.loads((ROOT / "campaign.json").read_text())
RESULTS = ROOT / "flux-results.json"
SHEET = ROOT / "flux-screen.html"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ResultBundleTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.results = json.loads(RESULTS.read_text())

    def test_every_campaign_cell_has_a_nonblank_authenticated_output(self) -> None:
        self.assertEqual(len(self.results["cells"]), len(CAMPAIGN["fluxCells"]))
        for cell in self.results["cells"]:
            output = ROOT / cell["outputPath"]
            self.assertTrue(output.is_file(), output)
            self.assertGreater(output.stat().st_size, 8192)
            self.assertEqual(sha256(output), cell["outputSha256"])

    def test_every_cell_records_the_effective_route(self) -> None:
        for cell in self.results["cells"]:
            receipt = ROOT / cell["receiptPath"]
            payload = json.loads(receipt.read_text())
            self.assertEqual(payload["status"], "done")
            self.assertEqual(payload["job_type"], "mflux_flux2_edit_promptfile")
            self.assertIn("mflux-generate-flux2-edit", payload["effective_route"])
            self.assertEqual(payload["exit_code"], 0)

    def test_sheet_names_source_prompt_settings_and_every_output(self) -> None:
        sheet = SHEET.read_text()
        self.assertIn(CAMPAIGN["source"]["sha256"], sheet)
        for prompt in CAMPAIGN["prompts"]:
            self.assertIn(prompt["text"], sheet)
        for cell in self.results["cells"]:
            self.assertIn(cell["outputPath"], sheet)
        self.assertIn("Guidance 1.0", sheet)
        self.assertIn("Steps 8", sheet)


if __name__ == "__main__":
    unittest.main()
