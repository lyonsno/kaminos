"""Verify that the completed sheet shows every generated cell and external control."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class ResultBundleContract(unittest.TestCase):
    def test_complete_ledger_and_sheet_provenance(self) -> None:
        campaign = json.loads((ROOT / "campaign.json").read_text())
        ledger = json.loads((ROOT / "result-ledger.json").read_text())
        sheet = (ROOT / "prompt-lighting-sheet.html").read_text()
        self.assertEqual(len(ledger["cells"]), 16)
        self.assertEqual({cell["id"] for cell in ledger["cells"]}, {cell["id"] for cell in campaign["cells"]})
        self.assertEqual(len(ledger["externalControls"]), 2)
        for record in ledger["cells"]:
            self.assertEqual(record["failureState"], "none")
            self.assertEqual(record["status"], "done")
            self.assertTrue(record["outputSha256"])
            self.assertIn(f'data-cell-id="{record["id"]}"', sheet)
            for field in ("sourceSha256", "prompt", "seed", "jobId", "output", "outputSha256", "effectiveRoute"):
                self.assertIn(str(record[field]), sheet)
        for control in ledger["externalControls"]:
            self.assertEqual(control["failureState"], "none")
            self.assertIn(f'data-control-id="{control["id"]}"', sheet)
            self.assertIn(control["outputSha256"], sheet)
        dragon_start = sheet.index("<h2>Dragon lighting</h2>")
        stone_start = sheet.index("<h2>Stone diagnostic</h2>")
        self.assertLess(dragon_start, sheet.index('data-control-id="revision-050-matched-dragon-seed80301"'), stone_start)
        self.assertLess(stone_start, sheet.index('data-control-id="revision-050-matched-golem-seed80301"'))
