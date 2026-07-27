#!/usr/bin/env python3
"""Fail-first contracts for the progressive coarse-to-fine ladder oracle."""

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


LADDER = load("progressive_ladder_contract", "volume-grid-progressive-ladder-oracle-mlx.py")
FITTER = LADDER.FITTER


class ProgressiveLadderContracts(unittest.TestCase):
    def test_arm_budgets_are_equal_by_construction(self) -> None:
        args = LADDER.parse_args(
            ["--motion-manifest", "/dev/null", "--output-dir", "/tmp/x"]
        )
        schedules = LADDER.arm_schedules(args)
        budgets = {arm["name"]: sum(s["iterations"] for s in arm["stages"]) for arm in schedules}
        self.assertEqual(len(set(budgets.values())), 1, budgets)
        self.assertEqual(budgets["ladder"], 1500)

    def test_unequal_budgets_fail_loud(self) -> None:
        args = LADDER.parse_args(
            [
                "--motion-manifest",
                "/dev/null",
                "--output-dir",
                "/tmp/x",
                "--stage-iterations",
                "400",
                "--jump-iterations",
                "750",
            ]
        )
        report: dict = {}
        with self.assertRaises(FITTER.SequenceFailure):
            LADDER.run(args, report)
        self.assertEqual(report["failurePhase"], "inputs")

    def test_ladder_rungs_are_lawful_integer_restrictions(self) -> None:
        args = LADDER.parse_args(["--motion-manifest", "/dev/null", "--output-dir", "/tmp/x"])
        for rung in (args.rung_coarse, args.rung_mid, args.rung_fine):
            self.assertEqual(96 % rung, 0, f"rung {rung} does not divide the 96^3 source")

    def test_warm_stages_use_damped_rate_except_naive_control(self) -> None:
        args = LADDER.parse_args(["--motion-manifest", "/dev/null", "--output-dir", "/tmp/x"])
        for arm in LADDER.arm_schedules(args):
            for stage in arm["stages"][1:]:
                if arm["name"] == "naive-jump":
                    self.assertEqual(stage["lr"], args.learning_rate)
                else:
                    self.assertEqual(stage["lr"], args.warm_learning_rate)

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "ladder-out"
            exit_code = LADDER.execute(
                [
                    "--motion-manifest",
                    str(Path(scratch) / "missing.json"),
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
