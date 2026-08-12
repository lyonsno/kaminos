"""Contracts for the selected prompt-lighting Trellis continuation."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from trellis_contract import (
    primary_output_errors,
    route_errors,
    validate_result_coverage,
    validated_orbit_outputs,
)


ROOT = Path(__file__).resolve().parent
SELECTION = ROOT / "trellis-selection.json"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class TrellisContinuationContract(unittest.TestCase):
    def test_selection_binds_exact_five_authenticated_flux_outputs(self) -> None:
        self.assertTrue(SELECTION.is_file(), "frozen Trellis selection is missing")
        selection = json.loads(SELECTION.read_text())
        ledger_path = ROOT / selection["sourceResultLedger"]
        self.assertEqual(selection["sourceResultLedgerSha256"], digest(ledger_path))
        ledger = json.loads(ledger_path.read_text())
        expected = {
            "generic-04-seed80301",
            "generic-04-seed80302",
            "stone-thick-overlapping-slabs-seed80301",
            "dragon-lighting-01-seed80301",
            "dragon-lighting-02-seed80301",
        }
        candidates = {row["cellId"] for row in selection["candidates"]}
        self.assertEqual(candidates, expected)
        for cell_id in candidates:
            record = next(row for row in ledger["cells"] if row["id"] == cell_id)
            output = ROOT / record["output"]
            self.assertTrue(output.is_file())
            self.assertEqual(record["outputSha256"], digest(output))

    def test_route_is_fixed_to_authenticated_fast_contract(self) -> None:
        self.assertTrue(SELECTION.is_file(), "frozen Trellis selection is missing")
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

    def test_route_validation_rejects_fallback_duplicate_and_wrong_config(self) -> None:
        expected = {
            "input": "/tmp/input.png",
            "output": "/tmp/output.glb",
            "seed": 42,
            "steps": 6,
            "targetFaces": 200000,
            "textureSize": 1024,
        }
        good = (
            "/venv/bin/python -u generate.py --image /tmp/input.png "
            "--output /tmp/output.glb --seed 42 --steps 6 "
            "--target-faces 200000 --texture-size 1024"
        )
        self.assertEqual(route_errors(good, expected), [])
        self.assertTrue(route_errors(good.replace("generate.py", "fallback.py"), expected))
        self.assertTrue(route_errors(good + " --image /tmp/input.png", expected))
        self.assertTrue(route_errors(good.replace("--steps 6", "--steps 7"), expected))

    def test_primary_output_validation_rejects_missing_blank_and_stale_bytes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.glb"
            self.assertTrue(primary_output_errors(output))
            output.write_bytes(b"blank")
            self.assertTrue(primary_output_errors(output))
            output.write_bytes(b"x" * 8192)
            expected = digest(output)
            self.assertEqual(primary_output_errors(output, expected), [])
            output.write_bytes(b"y" * 8192)
            self.assertTrue(primary_output_errors(output, expected))

    def test_result_coverage_rejects_partial_or_stale_selection(self) -> None:
        selection = {"candidates": [{"cellId": "a"}, {"cellId": "b"}]}
        ledger = {"selectionSha256": "selection-sha", "cells": {"a": {}, "b": {}}}
        self.assertEqual(
            validate_result_coverage(selection, ledger, "selection-sha"),
            ["a", "b"],
        )
        ledger["cells"].pop("b")
        with self.assertRaisesRegex(RuntimeError, "exactly cover"):
            validate_result_coverage(selection, ledger, "selection-sha")
        ledger["cells"]["b"] = {}
        ledger["selectionSha256"] = "stale"
        with self.assertRaisesRegex(RuntimeError, "selection"):
            validate_result_coverage(selection, ledger, "selection-sha")

    def test_orbit_requires_six_hash_bound_frames(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            outputs = []
            for index in range(6):
                frame = Path(directory) / f"frame-{index}.png"
                frame.write_bytes(f"frame-{index}".encode())
                outputs.append({"path": str(frame), "sha256": digest(frame)})
            manifest = {"status": "completed", "outputs": outputs}
            self.assertEqual(len(validated_orbit_outputs(manifest)), 6)
            outputs.pop()
            with self.assertRaisesRegex(RuntimeError, "six"):
                validated_orbit_outputs(manifest)


if __name__ == "__main__":
    unittest.main()
