#!/usr/bin/env python3
"""Contract for selective, basin-distinct Trellis follow-through."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "trellis-selection.json"
EXPECTED = {
    "revision-048-dragon-seed80301": "scaled-anatomical-elaboration",
    "revision-048-golem-seed80301": "rigid-segmented-surface",
    "revision-048-phantom-seed80302": "translucent-nonrigid-surface",
    "revision-048-maquette-seed80301": "neutral-finished-completion",
    "revision-048-skin-seed80302": "continuous-skin",
    "revision-048-fur-seed80302": "continuous-fur",
}


class TrellisSelectionContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.selection = json.loads(SELECTION.read_text())

    def test_selection_samples_six_distinct_surface_mechanisms(self) -> None:
        candidates = self.selection["candidates"]
        self.assertEqual({item["cellId"] for item in candidates}, set(EXPECTED))
        self.assertEqual(
            {item["role"] for item in candidates},
            set(EXPECTED.values()),
        )

    def test_selection_uses_the_current_carrier_only(self) -> None:
        for candidate in self.selection["candidates"]:
            self.assertTrue(candidate["cellId"].startswith("revision-048-"))

    def test_route_is_the_proven_fast_reconstruction_route(self) -> None:
        self.assertEqual(
            self.selection["route"],
            {
                "jobType": "trellis2mlx_fast",
                "steps": 6,
                "targetFaces": 200000,
                "textureSize": 1024,
            },
        )


if __name__ == "__main__":
    unittest.main()
