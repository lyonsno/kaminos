#!/usr/bin/env python3
"""Fail-first contracts for the yielding long-motion pipeline."""

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


PIPE = load("yielding_pipeline_contract", "volume-longmotion-yielding-pipeline-mlx.py")
ORACLE = PIPE.ORACLE
FITTER = PIPE.FITTER
CONTRACT_SPEC = load("pipe_target_contract", "volume-grid16-reconstruction-target-contract.py")

oracle_tests = load("pipe_oracle_tests", "tests/volume-grid16-ceiling-oracle-contracts.py")
synthetic_medium = oracle_tests.synthetic_medium
synthetic_camera = oracle_tests.synthetic_camera


class YieldingFitContracts(unittest.TestCase):
    def test_checkpoint_resume_continues_as_one_optimization(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        with tempfile.TemporaryDirectory() as scratch:
            ckpt = Path(scratch) / "fit.npz"
            pending = Path(scratch) / "pending"
            pending.mkdir()
            shared = dict(
                mode_count=3,
                fit_width=32,
                fit_samples_per_cell=4,
                seed=7,
                init="analytical",
                learning_rate=0.05,
            )
            # Chunk 1: yield after the first check (waiter present from step 10)
            first = ORACLE.fit_modes(
                medium, lattice, [synthetic_camera()],
                iterations=40, checkpoint_path=ckpt,
                yield_pending_dir=pending,
                yield_min_seconds=0.0,
                **shared,
            )
            (pending / "waiter").write_text("x")
            second = ORACLE.fit_modes(
                medium, lattice, [synthetic_camera()],
                iterations=40, checkpoint_path=ckpt,
                yield_pending_dir=pending,
                yield_min_seconds=0.0,
                **shared,
            )
            self.assertFalse(second["finished"])
            self.assertTrue(ckpt.is_file())
            self.assertGreater(second["completedSteps"], 0)
            self.assertLess(second["completedSteps"], 40)
            # Clear the waiter; resume must pick up the saved step and finish
            (pending / "waiter").unlink()
            third = ORACLE.fit_modes(
                medium, lattice, [synthetic_camera()],
                iterations=40, checkpoint_path=ckpt,
                yield_pending_dir=pending,
                yield_min_seconds=0.0,
                **shared,
            )
            self.assertTrue(third["finished"])
            self.assertEqual(third["startStep"], second["completedSteps"] - 1)
            self.assertEqual(third["completedSteps"], 40)
            # First (uninterrupted) chunk finished normally
            self.assertTrue(first["finished"])

    def test_minimum_residency_is_wall_clock_not_steps(self) -> None:
        # A 300-STEP quantum is 5 minutes at seat speed and 15 HOURS at
        # memory-thrash speed (3.4 min/step, measured 2026-08-24 holding a
        # 20-job operator assay hostage; candyman packets 041528Z/082932Z).
        # Residency amortization must be wall-clock: a generation earns its
        # startup with seconds of GPU residency, then defers to waiters at
        # the NEXT STEP regardless of how many steps that residency bought.
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        with tempfile.TemporaryDirectory() as scratch:
            ckpt = Path(scratch) / "fit.npz"
            pending = Path(scratch) / "pending"
            pending.mkdir()
            (pending / "waiter").write_text("x")
            # Quantum far above the fit's runtime: waiter present the whole
            # time, but the fit must complete without yielding.
            held = ORACLE.fit_modes(
                medium, lattice, [synthetic_camera()],
                mode_count=3, iterations=30, fit_width=32, fit_samples_per_cell=4,
                seed=7, init="analytical", learning_rate=0.05,
                checkpoint_path=ckpt, yield_pending_dir=pending,
                yield_min_seconds=3600.0,
            )
            self.assertTrue(held["finished"],
                            "yielded before the wall-clock residency elapsed")
            ckpt.unlink(missing_ok=True)
            # Zero quantum: the same fit must yield almost immediately —
            # within a handful of steps, NOT a step-count quantum later.
            released = ORACLE.fit_modes(
                medium, lattice, [synthetic_camera()],
                mode_count=3, iterations=30, fit_width=32, fit_samples_per_cell=4,
                seed=7, init="analytical", learning_rate=0.05,
                checkpoint_path=ckpt, yield_pending_dir=pending,
                yield_min_seconds=0.0,
            )
            self.assertFalse(released["finished"])
            self.assertLessEqual(released["completedSteps"], 3,
                                 "waiter check did not run at the first post-quantum step")

    def test_wall_clock_quantum_is_universal(self) -> None:
        # With residency measured in seconds, seat stages and chain hops need
        # no separate policies and step-count quanta must be fully retired —
        # any surviving yield_min_steps is a latent 15-hour hostage.
        pipeline_source = (ROOT / "volume-longmotion-yielding-pipeline-mlx.py").read_text()
        oracle_source = (ROOT / "volume-grid16-ceiling-oracle-mlx.py").read_text()
        self.assertNotIn("yield_min_steps", pipeline_source)
        self.assertNotIn("yield_min_steps", oracle_source)
        self.assertNotIn("hop_fit_yield_quantum", pipeline_source)
        self.assertIn("yield_min_seconds", pipeline_source)
        self.assertIn("yield_min_seconds", oracle_source)

    def test_setup_cache_is_wired(self) -> None:
        # Every generation was rebuilding all chain-state mediums+lattices
        # from raw source rows — an unyieldable multi-minute block, measured
        # live holding operator jobs behind pure setup. The pipeline must
        # expose a setup-cache directory and route state setup through the
        # cache module.
        self.assertTrue(hasattr(PIPE, "SETUP_CACHE"),
                        "pipeline does not load the setup cache module")
        import argparse
        parser_source = (ROOT / "volume-longmotion-yielding-pipeline-mlx.py").read_text()
        self.assertIn("--setup-cache-dir", parser_source)
        self.assertIn("load_or_build", parser_source)

    def test_seat_only_mode_exists(self) -> None:
        # Memory pilots and seat probes have no use for chain hops or witness
        # renders; the unyieldable render tail measured ~30 min of fleet-facing
        # GPU hold (operator escalation 2026-08-31). Seat-only runs must stop
        # after the ladder and report complete.
        source = (ROOT / "volume-longmotion-yielding-pipeline-mlx.py").read_text()
        self.assertIn("--seat-only", source)
        self.assertIn("seat-only", source.split("Phase 2")[0], "seat-only gate must precede the chain phase")

    def test_checkpoint_preserves_adam_moments(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        with tempfile.TemporaryDirectory() as scratch:
            ckpt = Path(scratch) / "fit.npz"
            pending = Path(scratch) / "pending"
            pending.mkdir()
            (pending / "waiter").write_text("x")
            ORACLE.fit_modes(
                medium, lattice, [synthetic_camera()],
                mode_count=3, iterations=40, fit_width=32, fit_samples_per_cell=4,
                seed=7, init="analytical", learning_rate=0.05,
                checkpoint_path=ckpt, yield_pending_dir=pending,
                yield_min_seconds=0.0,
            )
            archive = np.load(ckpt)
            opt_keys = [k for k in archive.files if k.startswith("opt.")]
            self.assertTrue(any(".m" in k for k in opt_keys), f"no Adam m moments in {opt_keys[:5]}")
            self.assertTrue(any(".v" in k for k in opt_keys), f"no Adam v moments in {opt_keys[:5]}")
            self.assertIn("__step__", archive.files)

    def test_progress_roundtrip_and_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            path = Path(scratch) / "progress.json"
            fresh = PIPE.load_progress(path)
            self.assertEqual(fresh, {"phase": "seat", "seatStage": 0, "chainHop": 0})
            fresh["phase"] = "chain"
            fresh["chainHop"] = 7
            PIPE.save_progress(path, fresh)
            self.assertEqual(PIPE.load_progress(path)["chainHop"], 7)

    def test_yield_mode_requires_resubmit_cli(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            code = PIPE.execute(
                [
                    "--motion-manifest", "/dev/null",
                    "--chain-states", "a,b",
                    "--output-dir", scratch,
                    "--yield-pending-dir", scratch,
                ]
            )
            self.assertEqual(code, 2)

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "out"
            code = PIPE.execute(
                [
                    "--motion-manifest", str(Path(scratch) / "missing.json"),
                    "--chain-states", "coefficient-state-120,coefficient-state-118",
                    "--output-dir", str(output_dir),
                ]
            )
            self.assertNotEqual(code, 0)
            report = json.loads((output_dir / "report.json").read_text())
            self.assertEqual(report["status"], "failed")


if __name__ == "__main__":
    unittest.main()
