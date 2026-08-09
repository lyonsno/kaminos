#!/usr/bin/env python3
"""Contract for the concise FLUX screen and selective Trellis successor."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).parent
CAMPAIGN = ROOT / "campaign.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class CampaignContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.campaign = json.loads(CAMPAIGN.read_text())

    def test_source_is_authenticated_full_density_envelope(self) -> None:
        source = ROOT / self.campaign["source"]["path"]
        self.assertTrue(source.is_file(), source)
        self.assertGreater(source.stat().st_size, 4096)
        self.assertEqual(sha256(source), self.campaign["source"]["sha256"])
        self.assertEqual(self.campaign["source"]["triangleCount"], 2070)

    def test_matrix_is_three_short_prompts_crossed_with_two_seeds(self) -> None:
        prompts = self.campaign["prompts"]
        seeds = self.campaign["seeds"]
        cells = self.campaign["fluxCells"]
        self.assertEqual(len(prompts), 3)
        self.assertEqual(seeds, [80301, 80413])
        self.assertEqual(len(cells), 6)
        self.assertEqual(
            {(cell["promptId"], cell["seed"]) for cell in cells},
            {(prompt["id"], seed) for prompt in prompts for seed in seeds},
        )
        for prompt in prompts:
            prompt_path = ROOT / prompt["path"]
            text = prompt_path.read_text().strip()
            self.assertEqual(text, prompt["text"])
            self.assertLessEqual(len(text.split()), 8)
            self.assertNotIn("without", text.lower())
            self.assertNotIn("avoid", text.lower())

    def test_route_and_promotion_boundary_are_exact(self) -> None:
        route = self.campaign["fluxRoute"]
        self.assertEqual(route["jobType"], "mflux_flux2_edit_promptfile")
        self.assertEqual(route["model"], "flux2-klein-9b")
        self.assertEqual(route["dimensions"], [512, 512])
        self.assertEqual(route["steps"], 8)
        self.assertEqual(route["guidance"], 1.0)
        self.assertEqual(self.campaign["trellisPromotion"]["maximumCandidates"], 3)
        self.assertIn("happy-safe", self.campaign["trellisPromotion"]["predicate"])
        self.assertIn("distinct", self.campaign["trellisPromotion"]["predicate"])


if __name__ == "__main__":
    unittest.main()
