#!/usr/bin/env python3
"""Contracts for the human-visible Trellis reconstruction comparison."""

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from build_trellis_sheet import (
    job_provenance_label,
    validate_display_provenance,
    validate_flux_ledger_binding,
    validate_reconstruction_bindings,
    validated_orbit_outputs,
)


def content_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ReconstructionSheetContract(unittest.TestCase):
    def setUp(self) -> None:
        self.campaign = {
            "promptFamilies": [{"id": "dragon", "prompt": "Dragon prompt."}],
        }
        self.flux_record = {
            "jobId": "flux-123",
            "family": "dragon",
            "prompt": "Dragon prompt.",
            "output": "runs/cell/output.png",
            "outputSha256": "image-sha",
        }
        self.trellis_record = {
            "jobId": "trellis-456",
            "input": "runs/cell/output.png",
            "inputSha256": "image-sha",
            "effectiveRoute": (
                "python generate.py --image /tmp/input.png --output /tmp/output.glb "
                "--seed 42 --steps 6 --target-faces 200000 --texture-size 1024"
            ),
        }
        self.route = {
            "jobType": "trellis2mlx_fast",
            "seed": 42,
            "steps": 6,
            "targetFaces": 200000,
            "textureSize": 1024,
        }

    def test_rejects_stale_selection_binding(self) -> None:
        selection = {"candidates": [{"cellId": "cell-a"}]}
        ledger = {
            "selectionSha256": "stale",
            "cells": {"cell-a": {"output": "trellis/cell-a/output.glb"}},
        }
        with self.assertRaisesRegex(RuntimeError, "selection"):
            validate_reconstruction_bindings(selection, ledger, "current")

    def test_rejects_partial_candidate_coverage(self) -> None:
        selection = {"candidates": [{"cellId": "cell-a"}, {"cellId": "cell-b"}]}
        ledger = {
            "selectionSha256": "current",
            "cells": {"cell-a": {"output": "trellis/cell-a/output.glb"}},
        }
        with self.assertRaisesRegex(RuntimeError, "exactly cover"):
            validate_reconstruction_bindings(selection, ledger, "current")

    def test_rejects_flux_ledger_from_a_stale_campaign(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "campaign"):
            validate_flux_ledger_binding({"campaignSha256": "stale"}, "current")

    def test_orbit_images_are_hash_bound_and_complete(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            outputs = []
            for index in range(6):
                frame = root / f"frame-{index}.png"
                frame.write_bytes(f"frame-{index}".encode())
                outputs.append({"path": str(frame), "sha256": content_sha256(frame)})
            self.assertEqual(len(validated_orbit_outputs({"status": "completed", "outputs": outputs})), 6)
            outputs[2]["sha256"] = "wrong"
            with self.assertRaisesRegex(RuntimeError, "hash"):
                validated_orbit_outputs({"status": "completed", "outputs": outputs})

    def test_display_provenance_binds_prompt_input_and_effective_route(self) -> None:
        validate_display_provenance(
            self.campaign,
            self.flux_record,
            self.trellis_record,
            self.route,
            "/tmp/input.png",
            "/tmp/output.glb",
        )

        self.flux_record["prompt"] = "Stale prompt."
        with self.assertRaisesRegex(RuntimeError, "prompt"):
            validate_display_provenance(
                self.campaign,
                self.flux_record,
                self.trellis_record,
                self.route,
                "/tmp/input.png",
                "/tmp/output.glb",
            )

    def test_display_provenance_rejects_stale_trellis_route(self) -> None:
        self.trellis_record["effectiveRoute"] = self.trellis_record["effectiveRoute"].replace(
            "--steps 6",
            "--steps 60",
        )
        with self.assertRaisesRegex(RuntimeError, "route"):
            validate_display_provenance(
                self.campaign,
                self.flux_record,
                self.trellis_record,
                self.route,
                "/tmp/input.png",
                "/tmp/output.glb",
            )

    def test_job_label_distinguishes_flux_and_trellis_receipts(self) -> None:
        label = job_provenance_label(self.flux_record, self.trellis_record, self.route)
        self.assertIn("Flux job flux-123", label)
        self.assertIn("Trellis job trellis-456", label)


if __name__ == "__main__":
    unittest.main()
