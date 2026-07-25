#!/usr/bin/env python3
"""Fail-first contracts for the adjacent-state warm-start probe."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent


def load(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


PROBE = load("warmstart_probe_contract", "volume-grid16-temporal-warmstart-probe-mlx.py")
ORACLE = PROBE.ORACLE
FITTER = PROBE.FITTER


class WarmstartProbeContracts(unittest.TestCase):
    def test_warm_init_requires_explicit_state(self) -> None:
        with self.assertRaises(FITTER.SequenceFailure):
            ORACLE.fit_modes(
                None,
                np.zeros((4, 4, 4, 8)),
                [],
                mode_count=4,
                iterations=1,
                fit_width=8,
                fit_samples_per_cell=1,
                seed=0,
                init="warm",
                learning_rate=0.01,
                initial_state=None,
            )

    def test_warm_state_mode_count_mismatch_fails_loud(self) -> None:
        bad_state = {
            "centers": np.zeros((3, 3)),
            "covariances": np.repeat(np.eye(3)[None], 3, axis=0),
            "emission": np.ones((3, 3)),
            "extinction": np.ones(3),
        }
        with self.assertRaises(FITTER.SequenceFailure):
            ORACLE.fit_modes(
                None,
                np.zeros((4, 4, 4, 8)),
                [],
                mode_count=4,
                iterations=1,
                fit_width=8,
                fit_samples_per_cell=1,
                seed=0,
                init="warm",
                learning_rate=0.01,
                initial_state=bad_state,
            )

    def test_residual_correlation_detects_consistency_and_rejects_zero(self) -> None:
        field = np.random.default_rng(7).normal(size=(20, 20, 3))
        self.assertAlmostEqual(PROBE.residual_correlation(field, field), 1.0, places=9)
        self.assertAlmostEqual(PROBE.residual_correlation(field, -field), -1.0, places=9)
        with self.assertRaises(FITTER.SequenceFailure):
            PROBE.residual_correlation(np.zeros((4, 4, 3)), field[:4, :4])

    def test_state_loader_rejects_drifted_mode_count(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "state.json"
            path.write_text(
                json.dumps(
                    {
                        "centers": np.zeros((3, 3)).tolist(),
                        "covariances": np.repeat(np.eye(3)[None], 3, axis=0).tolist(),
                        "emission": np.ones((3, 3)).tolist(),
                        "extinction": np.ones(3).tolist(),
                    }
                )
            )
            with self.assertRaises(FITTER.SequenceFailure):
                PROBE.load_state_json(path, expected_modes=48)

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "probe-out"
            exit_code = PROBE.execute(
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
