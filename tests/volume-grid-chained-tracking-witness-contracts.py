#!/usr/bin/env python3
"""Fail-first contracts for the chained tracking witness."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


CHAIN = load("chained_witness_contract", "volume-grid-chained-tracking-witness-mlx.py")
FITTER = CHAIN.FITTER


class ChainedWitnessContracts(unittest.TestCase):
    def test_witness_html_embeds_states_and_is_selfcontained(self) -> None:
        html = CHAIN.witness_html(["120", "118", "116"], {"120": {"heldMae": 0.1}}, "damped")
        self.assertIn("120", html)
        self.assertIn("tracked-${data.chain}-state-", html)
        self.assertIn("target-state-", html)
        self.assertNotIn("http://", html.split("<script>")[1])
        self.assertGreater(len(html), 1500)

    def test_single_state_chain_fails_loud(self) -> None:
        args = CHAIN.parse_args(
            [
                "--motion-manifest",
                "/dev/null",
                "--source-solution",
                "/dev/null",
                "--output-dir",
                "/tmp/x",
                "--chain-states",
                "coefficient-state-120",
            ]
        )
        report: dict = {}
        with self.assertRaises(FITTER.SequenceFailure):
            CHAIN.run(args, report)

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "chain-out"
            exit_code = CHAIN.execute(
                [
                    "--motion-manifest",
                    str(Path(scratch) / "missing.json"),
                    "--source-solution",
                    str(Path(scratch) / "missing-state.json"),
                    "--output-dir",
                    str(output_dir),
                ]
            )
            self.assertNotEqual(exit_code, 0)
            report = json.loads((output_dir / "report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "inputs")


if __name__ == "__main__":
    unittest.main()
