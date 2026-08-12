"""Fail-first manifest contract for the revision-050 prompt-lighting matrix."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"


class PromptLightingCampaignContract(unittest.TestCase):
    def setUp(self) -> None:
        self.assertTrue(CAMPAIGN.is_file(), "frozen 16-cell campaign manifest is missing")
        self.campaign = json.loads(CAMPAIGN.read_text())

    def test_exact_unique_16_cell_matrix(self) -> None:
        cells = self.campaign["cells"]
        self.assertEqual(len(cells), 16)
        self.assertEqual(len({cell["id"] for cell in cells}), 16)
        generic = [cell for cell in cells if cell["group"] == "generic-ladder"]
        self.assertEqual(len(generic), 12)
        self.assertEqual({cell["seed"] for cell in generic}, {80301, 80302})
        self.assertEqual(len({cell["promptId"] for cell in generic}), 6)
        self.assertEqual(len([cell for cell in cells if cell["group"] == "dragon-lighting"]), 3)
        self.assertEqual(len([cell for cell in cells if cell["group"] == "stone-diagnostic"]), 1)

    def test_prompt_files_bind_exact_bytes_and_frozen_text(self) -> None:
        expected_generic = [
            "Creature.", "This shape as a creature.", "Complete this creature.", "This shape covered in skin.",
            "Elaborate this shape into a finished creature.", "Elaborate this shape into a richly detailed creature.",
        ]
        prompts = {row["id"]: row for row in self.campaign["promptRecords"]}
        self.assertEqual([prompts[f"generic-{index:02d}"]["text"] for index in range(1, 7)], expected_generic)
        base = "Elaborate this armature into a finished creature with scaly hide, ridged spine, and horned head."
        clauses = ["Even diffuse studio lighting.", "Raking side lighting.", "Soft rim light with frontal fill."]
        self.assertEqual([prompts[f"dragon-lighting-{index:02d}"]["text"] for index in range(1, 4)], [f"{base} {clause}" for clause in clauses])
        self.assertEqual(prompts["stone-thick-overlapping-slabs"]["text"], "This creature built from thick overlapping weathered stone slabs.")
        for prompt in prompts.values():
            path = ROOT / prompt["file"]
            self.assertEqual(path.read_bytes(), prompt["bytesUtf8"].encode("utf-8"))
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), prompt["bytesSha256"])

    def test_source_route_and_immutable_controls_are_bound(self) -> None:
        source = self.campaign["source"]
        source_path = ROOT / source["path"]
        self.assertEqual(hashlib.sha256(source_path.read_bytes()).hexdigest(), source["sha256"])
        route = self.campaign["fluxRoute"]
        self.assertEqual(route["jobType"], "mflux_flux2_edit_promptfile")
        self.assertEqual(route["model"], "flux2-klein-9b")
        self.assertEqual((route["quantize"], route["width"], route["height"], route["steps"], route["guidance"], route["mlxCacheLimitGb"]), (4, 512, 512, 8, 1.0, 48))
        controls = self.campaign["externalControls"]
        self.assertEqual([control["id"] for control in controls], ["revision-050-matched-dragon-seed80301", "revision-050-matched-golem-seed80301"])
        for control in controls:
            self.assertEqual(control["kind"], "external-control")
            self.assertEqual(hashlib.sha256((ROOT / control["output"]).read_bytes()).hexdigest(), control["outputSha256"])
            self.assertEqual(hashlib.sha256((ROOT / control["campaignLedger"]).read_bytes()).hexdigest(), control["campaignLedgerSha256"])


if __name__ == "__main__":
    unittest.main()
