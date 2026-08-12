"""Final bundle contract for the prompt-lighting Trellis continuation."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from trellis_contract import validate_result_coverage, validated_orbit_outputs


ROOT = Path(__file__).resolve().parent


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TrellisResultBundleContract(unittest.TestCase):
    def test_complete_synthetic_bundle_satisfies_provenance_contract(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            selection = {"candidates": [{"cellId": "synthetic-cell"}]}
            selection_sha256 = "a" * 64
            ledger = {
                "selectionSha256": selection_sha256,
                "cells": {"synthetic-cell": {}},
            }
            self.assertEqual(
                validate_result_coverage(selection, ledger, selection_sha256),
                ["synthetic-cell"],
            )
            outputs = []
            for index in range(6):
                frame = root / f"frame-{index}.png"
                frame.write_bytes((f"frame-{index}" * 700).encode())
                outputs.append({"path": str(frame), "sha256": digest(frame)})
            self.assertEqual(
                validated_orbit_outputs({"status": "completed", "outputs": outputs}),
                [root / f"frame-{index}.png" for index in range(6)],
            )

    def test_complete_ledger_orbits_and_sheet_provenance(self) -> None:
        if not (ROOT / "trellis-result-ledger.json").is_file():
            self.skipTest("post-run Trellis bundle does not exist before submission")
        for failure in ("trellis-collection-state.json", "trellis-orbit-state.json", "trellis-completion-failure.json"):
            self.assertFalse((ROOT / failure).exists(), f"unresolved failure state: {failure}")
        selection_path = ROOT / "trellis-selection.json"
        selection = json.loads(selection_path.read_text())
        ledger = json.loads((ROOT / "trellis-result-ledger.json").read_text())
        expected = {row["cellId"] for row in selection["candidates"]}
        self.assertEqual(set(ledger["cells"]), expected)
        self.assertEqual(ledger["selectionSha256"], digest(selection_path))
        for record in ledger["cells"].values():
            output = ROOT / record["output"]
            self.assertEqual(record["outputSha256"], digest(output))
            manifest = json.loads((output.parent / "orbit-manifest.json").read_text())
            self.assertEqual(manifest["glb"]["sha256"], record["outputSha256"])
            validated_orbit_outputs(manifest)
        sheet = ROOT / "prompt-lighting-trellis-sheet.html"
        self.assertTrue(sheet.is_file())
        markup = sheet.read_text()
        for cell_id in expected:
            self.assertIn(cell_id, markup)


if __name__ == "__main__":
    unittest.main()
