#!/usr/bin/env python3
"""Fail-loud contract for the cross-basin carrier-authority campaign."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"

SEEDS = [80301, 80302, 80413]
PROMPTS = {
    "dragon": "Elaborate this armature into a finished creature with scaly hide, ridged spine, and horned head.",
    "golem": "Elaborate this armature into a finished creature of mossy weathered stone with lichen and cracked plates.",
    "phantom": "Elaborate this armature into a finished creature with translucent drifting form and hollow glowing eyes.",
    "maquette": "Elaborate this partially finished maquette into a finished creature.",
    "skin": "This shape covered in skin.",
    "fur": "This shape covered in fur.",
    "cat": "This shape as a cat.",
    "unknown-creature": "This shape as an unknown creature.",
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CampaignContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.campaign = json.loads(CAMPAIGN.read_text())

    def test_sources_are_frozen_and_distinct(self) -> None:
        sources = self.campaign["sources"]
        self.assertEqual(set(sources), {"revision-029", "revision-048"})
        self.assertNotEqual(sources["revision-029"]["plateSha256"], sources["revision-048"]["plateSha256"])
        for source in sources.values():
            plate = ROOT / source["plate"]
            self.assertTrue(plate.is_file(), plate)
            self.assertEqual(sha256(plate), source["plateSha256"])

    def test_precedent_is_not_mislabeled_as_predecessor(self) -> None:
        precedent = self.campaign["historicalPrecedent"]
        self.assertEqual(precedent["role"], "fertile-basin-precedent-not-causal-control")
        self.assertNotIn(precedent["sourcePlateSha256"], {
            source["plateSha256"] for source in self.campaign["sources"].values()
        })

    def test_prompt_text_is_exact_and_file_backed(self) -> None:
        families = {item["id"]: item for item in self.campaign["promptFamilies"]}
        self.assertEqual(set(families), set(PROMPTS))
        for family_id, expected in PROMPTS.items():
            family = families[family_id]
            self.assertEqual(family["prompt"], expected)
            self.assertEqual((ROOT / family["promptFile"]).read_text().strip(), expected)

    def test_matrix_is_24_treatment_plus_9_predecessor_controls(self) -> None:
        cells = self.campaign["cells"]
        treatment = [cell for cell in cells if cell["sourceId"] == "revision-048"]
        controls = [cell for cell in cells if cell["sourceId"] == "revision-029"]
        self.assertEqual(len(cells), 33)
        self.assertEqual(len(treatment), 24)
        self.assertEqual(len(controls), 9)
        self.assertEqual(
            {(cell["family"], cell["seed"]) for cell in treatment},
            {(family, seed) for family in PROMPTS for seed in SEEDS},
        )
        self.assertEqual(
            {(cell["family"], cell["seed"]) for cell in controls},
            {(family, seed) for family in ("maquette", "dragon", "golem") for seed in SEEDS},
        )

    def test_cells_have_unique_identity_and_exact_route(self) -> None:
        cells = self.campaign["cells"]
        self.assertEqual(len({cell["id"] for cell in cells}), len(cells))
        self.assertEqual(len({cell["outputDir"] for cell in cells}), len(cells))
        self.assertEqual(
            self.campaign["fluxRoute"],
            {
                "jobType": "mflux_flux2_edit_promptfile",
                "model": "flux2-klein-9b",
                "quantize": 4,
                "width": 512,
                "height": 512,
                "steps": 8,
                "guidance": 1.0,
                "mlxCacheLimitGb": 48,
            },
        )


if __name__ == "__main__":
    unittest.main()
