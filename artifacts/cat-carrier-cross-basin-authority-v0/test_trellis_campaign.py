#!/usr/bin/env python3
"""Contract for selective, basin-distinct Trellis follow-through."""

import json
import ast
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
                "seed": 42,
                "steps": 6,
                "targetFaces": 200000,
                "textureSize": 1024,
            },
        )

    def test_submitter_passes_every_parameter_in_one_parameter_group(self) -> None:
        tree = ast.parse((ROOT / "submit_trellis.py").read_text())
        command = next(
            node.value
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign)
            and any(isinstance(target, ast.Name) and target.id == "command" for target in node.targets)
            and isinstance(node.value, ast.List)
        )
        literal_p_flags = [
            item.value
            for item in command.elts
            if isinstance(item, ast.Constant) and item.value == "-p"
        ]
        self.assertEqual(literal_p_flags, ["-p"])


if __name__ == "__main__":
    unittest.main()
