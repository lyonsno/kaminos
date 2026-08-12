#!/usr/bin/env python3
"""Fail-loud contracts for terminal Greenroom evidence."""

import tempfile
import time
import unittest
from pathlib import Path

from build_sheet import (
    image_cell,
    relative,
    source_ids_for_family,
    validate_effective_params,
    validate_ledger_freshness,
)
from collect_flux import sha256_bytes, validate_output, validate_prompt, validate_status


EXPECTED = {
    "jobType": "mflux_flux2_edit_promptfile",
    "source": "/fixture/source.png",
    "promptFile": "/fixture/prompt.txt",
    "output": "/fixture/output.png",
    "seed": 80301,
    "model": "flux2-klein-9b",
    "quantize": 4,
    "width": 512,
    "height": 512,
    "steps": 8,
    "guidance": 1.0,
    "mlxCacheLimitGb": 48,
}


def good_status() -> dict:
    return {
        "job_id": "abc123abc123",
        "status": "done",
        "job_type": EXPECTED["jobType"],
        "exit_code": 0,
        "params": {
            "prompt_file": EXPECTED["promptFile"],
            "seed": str(EXPECTED["seed"]),
            "model": EXPECTED["model"],
            "quantize": str(EXPECTED["quantize"]),
            "width": str(EXPECTED["width"]),
            "height": str(EXPECTED["height"]),
            "steps": str(EXPECTED["steps"]),
            "guidance": str(EXPECTED["guidance"]),
            "mlx_cache_limit_gb": str(EXPECTED["mlxCacheLimitGb"]),
        },
        "effective_route": (
            "/route/mflux-generate-flux2-edit "
            f"--image-paths {EXPECTED['source']} --prompt-file {EXPECTED['promptFile']} "
            f"--output {EXPECTED['output']} --model {EXPECTED['model']} "
            f"--quantize {EXPECTED['quantize']} --height {EXPECTED['height']} "
            f"--width {EXPECTED['width']} --steps {EXPECTED['steps']} "
            f"--guidance {EXPECTED['guidance']} --seed {EXPECTED['seed']} "
            f"--mlx-cache-limit-gb {EXPECTED['mlxCacheLimitGb']}"
        ),
    }


class TerminalEvidenceContract(unittest.TestCase):
    def test_accepts_exact_done_route(self) -> None:
        self.assertEqual(validate_status(good_status(), EXPECTED), [])

    def test_rejects_wrong_route_and_seed(self) -> None:
        status = good_status()
        status["params"]["seed"] = "999"
        status["effective_route"] = status["effective_route"].replace("mflux-generate-flux2-edit", "fallback")
        errors = validate_status(status, EXPECTED)
        self.assertTrue(any("seed" in error for error in errors))
        self.assertTrue(any("effective route" in error for error in errors))

    def test_rejects_nonterminal_success_appearance(self) -> None:
        status = good_status()
        status["status"] = "running"
        self.assertIn("status is running, expected done", validate_status(status, EXPECTED))

    def test_rejects_missing_tiny_or_wrong_size_image(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            missing = root / "missing.png"
            self.assertTrue(validate_output(missing, (512, 512)))
            tiny = root / "tiny.png"
            tiny.write_bytes(b"not an image")
            self.assertTrue(validate_output(tiny, (512, 512)))

    def test_rejects_stale_primary_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "output.png"
            output.write_bytes(
                b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" +
                (512).to_bytes(4, "big") + (512).to_bytes(4, "big") + b"x" * 2048
            )
            started_at = time.time() + 10
            errors = validate_output(output, (512, 512), started_at=started_at)
            self.assertTrue(any("predates" in error for error in errors))

    def test_rejects_prompt_content_drift(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            prompt = Path(directory) / "prompt.txt"
            prompt.write_text("This shape as a dog.\n")
            expected_text = "This shape as a cat."
            errors = validate_prompt(prompt, expected_text, sha256_bytes(expected_text.encode()))
            self.assertTrue(any("content" in error for error in errors))

    def test_rejects_prompt_modified_after_job_start(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            prompt = Path(directory) / "prompt.txt"
            expected_text = "This shape as a cat."
            prompt.write_text(expected_text + "\n")
            errors = validate_prompt(
                prompt,
                expected_text,
                sha256_bytes(expected_text.encode()),
                started_at=time.time() - 10,
            )
            self.assertTrue(any("modified after" in error for error in errors))

    def test_requires_all_effective_route_settings(self) -> None:
        status = good_status()
        status["effective_route"] = status["effective_route"].replace("--quantize 4", "")
        self.assertTrue(any("effective route" in error for error in validate_status(status, EXPECTED)))


class SheetEvidenceContract(unittest.TestCase):
    def test_historical_sibling_paths_remain_linkable(self) -> None:
        sibling = Path(__file__).resolve().parent.parent / "authored-envelope-v0" / "plate3" / "plate.png"
        self.assertTrue(relative(sibling).startswith("../authored-envelope-v0/"))

    def test_control_rows_exist_only_for_executed_controls(self) -> None:
        campaign = {
            "cells": [
                {"sourceId": "revision-048", "family": "phantom"},
                {"sourceId": "revision-048", "family": "dragon"},
                {"sourceId": "revision-029", "family": "dragon"},
            ]
        }
        self.assertEqual(source_ids_for_family(campaign, "phantom"), ["revision-048"])
        self.assertEqual(source_ids_for_family(campaign, "dragon"), ["revision-029", "revision-048"])

    def test_rejects_stale_or_incomplete_result_ledger(self) -> None:
        ledger = {"campaignSha256": "old", "submissionsSha256": "submissions"}
        with self.assertRaises(RuntimeError):
            validate_ledger_freshness(ledger, "campaign", "submissions", state_exists=False)
        ledger["campaignSha256"] = "campaign"
        with self.assertRaises(RuntimeError):
            validate_ledger_freshness(ledger, "campaign", "submissions", state_exists=True)

    def test_rejects_mixed_effective_settings(self) -> None:
        route = {
            "model": "flux2-klein-9b",
            "quantize": 4,
            "width": 512,
            "height": 512,
            "steps": 8,
            "guidance": 1.0,
            "mlxCacheLimitGb": 48,
        }
        params = {
            "model": "flux2-klein-9b",
            "quantize": "4",
            "width": "512",
            "height": "512",
            "steps": "8",
            "guidance": "1.0",
            "mlx_cache_limit_gb": "24",
        }
        with self.assertRaises(RuntimeError):
            validate_effective_params({"cells": {"cell": {"effectiveParams": params}}}, route)

    def test_sensitive_cell_requires_explicit_reveal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "fixture.png"
            image.write_bytes(b"fixture")
            markup = image_cell(image, "skin seed 80413", sensitive_reason="visible superficial abrasion marks")
            self.assertIn("<details", markup)
            self.assertIn("visible superficial abrasion marks", markup)


if __name__ == "__main__":
    unittest.main()
