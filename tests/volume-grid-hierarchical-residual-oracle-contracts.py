#!/usr/bin/env python3
"""Fail-first contracts for the hierarchical residual oracle."""

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


HIER = load("hierarchical_oracle_contract", "volume-grid-hierarchical-residual-oracle-mlx.py")
ORACLE = HIER.ORACLE
FITTER = HIER.FITTER
CONTRACT_SPEC = load("hier_target_contract", "volume-grid16-reconstruction-target-contract.py")

sys.path.insert(0, str(ROOT / "tests"))
oracle_tests = load("hier_oracle_tests", "tests/volume-grid16-ceiling-oracle-contracts.py")
synthetic_medium = oracle_tests.synthetic_medium
synthetic_camera = oracle_tests.synthetic_camera


class HierarchicalResidualContracts(unittest.TestCase):
    def test_residual_receipt_reports_overshoot_and_positive_fractions(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        coarse = ORACLE.analytical_seed_state(medium, mode_count=2, seed=0)
        positive, receipt = HIER.residual_field(lattice, coarse, medium, fine_grid=16)
        self.assertEqual(positive.shape, (16, 16, 16, 8))
        self.assertTrue(all(v >= 0.0 for v in receipt["overshootFraction"][:4]))
        self.assertTrue(any(v > 0.0 for v in receipt["positiveResidualFraction"][:4]))

    def test_blank_positive_residual_fails_loud(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        oversized = {
            "centers": medium.positions[:1].copy(),
            "covariances": np.repeat(np.eye(3)[None] * 4.0, 1, axis=0),
            "emission": np.full((1, 3), 1e6),
            "extinction": np.full(1, 1e6),
        }
        with self.assertRaises(FITTER.SequenceFailure):
            HIER.residual_field(lattice, oversized, medium, fine_grid=16)

    def test_residual_seed_places_modes_on_positive_support(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        coarse = ORACLE.analytical_seed_state(medium, mode_count=2, seed=0)
        positive, _ = HIER.residual_field(lattice, coarse, medium, fine_grid=16)
        seed_state = HIER.residual_seed_state(positive, medium, mode_count=3, fine_grid=16)
        self.assertEqual(seed_state["centers"].shape, (3, 3))
        self.assertTrue(np.all(seed_state["emission"] > 0.0))
        self.assertTrue(np.all(seed_state["extinction"] > 0.0))
        lower = medium.origin
        upper = medium.origin + medium.source_spacing * medium.source_grid
        self.assertTrue(np.all(seed_state["centers"] >= lower - 1e-9))
        self.assertTrue(np.all(seed_state["centers"] <= upper + 1e-9))

    def test_background_changes_the_forward_march(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        coarse = ORACLE.analytical_seed_state(medium, mode_count=2, seed=0)
        free_seed = ORACLE.random_seed_state(medium, mode_count=3, seed=5)
        shared = dict(
            mode_count=3,
            iterations=3,
            fit_width=24,
            fit_samples_per_cell=2,
            seed=5,
            init="warm",
            learning_rate=1e-6,
            initial_state=free_seed,
        )
        bare = ORACLE.fit_modes(medium, lattice, [synthetic_camera()], **shared)
        composed = ORACLE.fit_modes(
            medium, lattice, [synthetic_camera()], background_state=coarse, **shared
        )
        self.assertEqual(composed["backgroundModeCount"], 2)
        self.assertEqual(bare["backgroundModeCount"], 0)
        # Contract: the background materially changes the forward march. Whether
        # it helps is data (a crude coarse seed can overshoot), not a contract.
        self.assertNotAlmostEqual(bare["initialLoss"], composed["initialLoss"], places=6)

    def test_compose_states_preserves_counts_and_order(self) -> None:
        medium = synthetic_medium()
        coarse = ORACLE.analytical_seed_state(medium, mode_count=2, seed=0)
        fine = ORACLE.random_seed_state(medium, mode_count=3, seed=1)
        composed = HIER.compose_states(coarse, fine)
        self.assertEqual(composed["centers"].shape, (5, 3))
        np.testing.assert_allclose(composed["centers"][:2], coarse["centers"])
        np.testing.assert_allclose(composed["centers"][2:], fine["centers"])

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "hier-out"
            exit_code = HIER.execute(
                [
                    "--motion-manifest",
                    str(Path(scratch) / "missing.json"),
                    "--coarse-solution",
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
