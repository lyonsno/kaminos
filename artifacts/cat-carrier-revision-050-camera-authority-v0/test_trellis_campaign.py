"""Contracts for the bounded revision-050 Trellis child tranche."""

import hashlib
import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "trellis-selection.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TrellisSelectionContract(unittest.TestCase):
    def test_selection_binds_exact_six_authenticated_flux_outputs(self) -> None:
        selection = json.loads(SELECTION.read_text())
        campaign = ROOT / selection["sourceCampaign"]
        ledger_path = ROOT / selection["sourceResultLedger"]
        self.assertEqual(selection["sourceCampaignSha256"], digest(campaign))
        self.assertEqual(selection["sourceResultLedgerSha256"], digest(ledger_path))
        ledger = json.loads(ledger_path.read_text())
        expected = {
            "revision-050-matched-dragon-seed80301",
            "revision-050-matched-maquette-seed80301",
            "revision-050-matched-cat-seed80301",
            "revision-050-matched-golem-seed80301",
            "revision-050-oblique-negative-35-golem-seed80301",
            "revision-050-oblique-positive-35-golem-seed80301",
        }
        candidates = {row["cellId"] for row in selection["candidates"]}
        self.assertEqual(candidates, expected)
        for cell_id in candidates:
            record = ledger["cells"][cell_id]
            output = ROOT / record["output"]
            self.assertTrue(output.is_file())
            self.assertEqual(record["outputSha256"], digest(output))

    def test_route_is_fixed_to_known_fast_mac_contract(self) -> None:
        route = json.loads(SELECTION.read_text())["route"]
        self.assertEqual(
            route,
            {
                "jobType": "trellis2mlx_fast",
                "seed": 42,
                "steps": 6,
                "targetFaces": 200000,
                "textureSize": 1024,
            },
        )


if __name__ == "__main__":
    unittest.main()
