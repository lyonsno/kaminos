#!/usr/bin/env python3
"""Validate the matched latest-envelope authority probe."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
CAMPAIGN = ROOT / "campaign.json"
LEDGER = ROOT / "result-ledger.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class LatestEnvelopeAuthorityProbeTest(unittest.TestCase):
    def test_campaign_is_exactly_the_two_matched_cells(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        self.assertEqual(campaign["schema"], "kaminos.latest-envelope-authority-probe.v0")
        self.assertEqual(len(campaign["cells"]), 2)
        self.assertEqual({cell["seed"] for cell in campaign["cells"]}, {80413})
        self.assertEqual({cell["source"] for cell in campaign["cells"]}, {"source/latest-envelope-029.png"})
        self.assertEqual(
            {cell["prompt"] for cell in campaign["cells"]},
            {
                "Elaborate this mannequin into a finished creature.",
                "This shape covered in broad layered fur tufts.",
            },
        )
        for cell in campaign["cells"]:
            self.assertEqual(cell["model"], "flux2-klein-9b")
            self.assertEqual(cell["quantize"], 4)
            self.assertEqual(cell["steps"], 8)
            self.assertEqual(cell["guidance"], 1.0)
            self.assertEqual([cell["width"], cell["height"]], [512, 512])

    def test_source_is_authenticated_to_revision_029(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        source = campaign["source"]
        blend = Path(source["effectiveBlend"])
        plate = ROOT / source["plate"]
        self.assertEqual(blend.name, "cat-bauplan-029.blend")
        self.assertEqual(source["object"], "Cube.056")
        self.assertEqual(sha256(blend), source["blendSha256"])
        self.assertEqual(sha256(plate), source["plateSha256"])
        self.assertGreater(plate.stat().st_size, 1024)

    def test_results_preserve_effective_route_and_nonblank_outputs(self) -> None:
        ledger = json.loads(LEDGER.read_text())
        self.assertEqual(len(ledger["cells"]), 2)
        for cell in ledger["cells"]:
            self.assertEqual(cell["status"], "done")
            self.assertEqual(cell["exitCode"], 0)
            self.assertIn("mflux_flux2_edit_promptfile", cell["jobType"])
            self.assertIn("--seed 80413", cell["effectiveRoute"])
            self.assertIn("--guidance 1.0", cell["effectiveRoute"])
            self.assertIn("latest-envelope-029.png", cell["effectiveRoute"])
            output = ROOT / cell["output"]
            receipt = ROOT / cell["rawReceipt"]
            self.assertGreater(output.stat().st_size, 1024)
            self.assertEqual(sha256(output), cell["outputSha256"])
            self.assertEqual(sha256(receipt), cell["rawReceiptSha256"])
            raw = json.loads(receipt.read_text())
            self.assertEqual(raw["job_id"], cell["jobId"])
            self.assertEqual(raw["status"], "done")
            for field in (
                "effective_argv",
                "effective_cwd",
                "effective_env",
                "effective_defaults",
                "request_path",
                "stdout_path",
                "stderr_path",
                "worker",
            ):
                self.assertIn(field, raw)
            self.assertTrue(raw["worker"]["commit"])
            self.assertEqual(raw["effective_route"], cell["effectiveRoute"])

    def test_operator_sheet_keeps_source_prompt_settings_and_output_adjacent(self) -> None:
        campaign = json.loads(CAMPAIGN.read_text())
        sheet = (ROOT / "authority-probe.html").read_text()
        self.assertIn("latest-envelope-029.png", sheet)
        self.assertIn("seed 80413", sheet)
        self.assertIn("guidance 1.0", sheet)
        for cell in campaign["cells"]:
            self.assertIn(cell["id"], sheet)
            self.assertIn(cell["prompt"], sheet)


if __name__ == "__main__":
    unittest.main()
