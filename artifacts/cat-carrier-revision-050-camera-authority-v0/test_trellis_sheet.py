#!/usr/bin/env python3
"""Contracts for the revision-050 source-to-cast comparison surface."""

import hashlib
import tempfile
import unittest
from pathlib import Path

from build_trellis_sheet import (
    job_provenance_label,
    validate_campaign_bindings,
    validate_display_provenance,
    validated_orbit_outputs,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Revision050TrellisSheetContract(unittest.TestCase):
    def setUp(self) -> None:
        self.campaign = {
            "sources": {
                "source-a": {
                    "plate": "source/source-a/plate.png",
                    "plateSha256": "plate-sha",
                }
            },
            "promptFamilies": [
                {"id": "golem", "prompt": "A stone creature.", "promptFile": "prompts/golem.txt"}
            ],
            "fluxRoute": {"model": "flux2-klein-9b", "steps": 8, "guidance": 1.0},
        }
        self.selection = {"candidates": [{"cellId": "cell-a", "sourceId": "source-a"}]}
        self.flux = {
            "campaignSha256": "campaign-sha",
            "cells": {
                "cell-a": {
                    "jobId": "flux-1",
                    "sourceId": "source-a",
                    "family": "golem",
                    "prompt": "A stone creature.",
                    "promptSha256": hashlib.sha256(b"A stone creature.").hexdigest(),
                    "seed": 80301,
                    "output": "runs/cell-a/output.png",
                    "outputSha256": "image-sha",
                }
            },
        }
        self.trellis = {
            "selectionSha256": "selection-sha",
            "cells": {
                "cell-a": {
                    "jobId": "trellis-1",
                    "input": "runs/cell-a/output.png",
                    "inputSha256": "image-sha",
                    "output": "trellis/cell-a/output.glb",
                    "outputSha256": "glb-sha",
                }
            },
        }

    def test_campaign_bindings_reject_stale_or_partial_evidence(self) -> None:
        validate_campaign_bindings(
            self.selection,
            self.flux,
            self.trellis,
            "campaign-sha",
            "selection-sha",
        )
        self.trellis["selectionSha256"] = "stale"
        with self.assertRaisesRegex(RuntimeError, "selection"):
            validate_campaign_bindings(
                self.selection,
                self.flux,
                self.trellis,
                "campaign-sha",
                "selection-sha",
            )

    def test_display_provenance_binds_source_prompt_flux_and_trellis(self) -> None:
        validate_display_provenance(
            self.campaign,
            self.selection["candidates"][0],
            self.flux["cells"]["cell-a"],
            self.trellis["cells"]["cell-a"],
        )
        self.trellis["cells"]["cell-a"]["inputSha256"] = "wrong"
        with self.assertRaisesRegex(RuntimeError, "FLUX output"):
            validate_display_provenance(
                self.campaign,
                self.selection["candidates"][0],
                self.flux["cells"]["cell-a"],
                self.trellis["cells"]["cell-a"],
            )

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

    def test_operator_label_names_both_routes_and_effective_settings(self) -> None:
        label = job_provenance_label(
            self.campaign["fluxRoute"],
            self.flux["cells"]["cell-a"],
            self.trellis["cells"]["cell-a"],
            {"seed": 42, "steps": 6, "targetFaces": 200000, "textureSize": 1024},
        )
        self.assertIn("FLUX job flux-1", label)
        self.assertIn("guidance 1.0", label)
        self.assertIn("Trellis job trellis-1", label)
        self.assertIn("200000 target faces", label)


if __name__ == "__main__":
    unittest.main()
