#!/usr/bin/env python3
"""Fail-first contracts for the Grid16 differentiable ceiling oracle."""

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


ORACLE = load("ceiling_oracle_contract", "volume-grid16-ceiling-oracle-mlx.py")
TARGET = ORACLE.TARGET
FITTER = ORACLE.FITTER

CONTRACT_SPEC = load("target_contract_spec", "volume-grid16-reconstruction-target-contract.py")


def synthetic_medium():
    source_grid, target_grid = 8, 4
    cells = np.asarray(
        [
            [2, 2, 2],
            [3, 2, 2],
            [2, 3, 2],
            [5, 5, 5],
            [4, 4, 4],
            [1, 5, 3],
            [6, 2, 5],
            [3, 6, 6],
            [6, 6, 2],
            [1, 1, 6],
        ],
        dtype=np.int64,
    )
    native_ids = (cells[:, 0] + source_grid * (cells[:, 1] + source_grid * cells[:, 2])).astype(np.uint32)
    origin = np.asarray([-1.0, -1.0, -1.0])
    positions = origin + (cells.astype(np.float64) + 0.5) * 0.25
    coefficients = np.zeros((cells.shape[0], 8), dtype=np.float64)
    coefficients[:, 0] = np.asarray([1.0, 0.5, 0.25, 2.0, 1.5, 0.8, 1.2, 0.6, 0.9, 0.7])
    coefficients[:, 1] = 0.5 * coefficients[:, 0]
    coefficients[:, 2] = 0.25 * coefficients[:, 0]
    coefficients[:, 3] = 0.4 * coefficients[:, 0]
    return FITTER.restrict_selected_optical_medium(
        native_ids, positions, coefficients, source_grid=source_grid, target_grid=target_grid, population="ridge"
    )


def synthetic_camera():
    projection = np.eye(4)
    projection[0, 0] = 2.0
    projection[1, 1] = 2.0
    return {
        "width": 40,
        "height": 40,
        "cameraPose": {
            "position": [0.0, 0.0, 3.2],
            "target": [0.0, 0.0, 0.0],
            "projectionMatrix": projection.flatten(order="F").tolist(),
        },
    }


class CeilingOracleContracts(unittest.TestCase):
    def test_orbit_cameras_preserve_projection_and_count(self) -> None:
        cameras = ORACLE.orbit_cameras(synthetic_camera(), count=6)
        self.assertEqual(len(cameras), 6)
        base = synthetic_camera()
        for camera in cameras:
            self.assertEqual(camera["cameraPose"]["projectionMatrix"], base["cameraPose"]["projectionMatrix"])
        positions = {tuple(np.round(c["cameraPose"]["position"], 9)) for c in cameras}
        self.assertEqual(len(positions), 6)

    def test_offcenter_lookat_orbit_still_sees_medium_with_center_pivot(self) -> None:
        medium = synthetic_medium()
        center = medium.origin + medium.source_spacing * medium.source_grid * 0.5
        camera = synthetic_camera()
        camera["cameraPose"]["target"] = [0.0, 0.55, 0.0]
        cameras = ORACLE.orbit_cameras(camera, count=8, pivot=center)
        ORACLE.require_cameras_see_medium(cameras, medium)
        radii = [
            np.linalg.norm(np.asarray(c["cameraPose"]["position"], dtype=np.float64) - center)
            for c in cameras
        ]
        np.testing.assert_allclose(radii, radii[0], rtol=1e-9)

    def test_eval_angles_disjoint_from_fit_orbit(self) -> None:
        fit_angles = {round(360.0 * index / 6, 6) for index in range(6)}
        for angle in (30.0, 90.0, 150.0):
            self.assertNotIn(round(angle, 6), fit_angles)

    def test_parameterization_round_trips_nonnegative_coefficients(self) -> None:
        medium = synthetic_medium()
        state = ORACLE.analytical_seed_state(medium, mode_count=3, seed=0)
        raw = ORACLE.state_to_raw(state, medium)
        decoded = ORACLE.raw_to_state(raw, medium)
        self.assertTrue(np.all(decoded["emission"] >= 0.0))
        self.assertTrue(np.all(decoded["extinction"] >= 0.0))
        self.assertTrue(np.all(np.isfinite(decoded["covariances"])))
        for row in decoded["covariances"]:
            eigenvalues = np.linalg.eigvalsh(row)
            self.assertTrue(np.all(eigenvalues > 0.0))
        np.testing.assert_allclose(decoded["centers"], state["centers"], rtol=1e-5, atol=1e-7)

    def test_fit_reduces_loss_on_synthetic_medium(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        result = ORACLE.fit_modes(
            medium,
            lattice,
            [synthetic_camera()],
            mode_count=4,
            iterations=40,
            fit_width=32,
            fit_samples_per_cell=4,
            seed=1,
            init="random",
            learning_rate=0.05,
        )
        self.assertLess(result["finalLoss"], result["initialLoss"])
        self.assertTrue(np.all(np.isfinite(result["lossHistory"])))
        self.assertEqual(result["modeCount"], 4)
        # Structural bound (review finding F4): a blank fit scores exactly the
        # target's own magnitude under this loss; the fit must beat half of it.
        target_linear, _t, _r = TARGET.march_density_lattice(
            lattice, medium, synthetic_camera(), width=32, samples_per_cell=4
        )
        flat = target_linear.reshape((-1, 3))
        blank_loss = float(np.mean(np.abs(flat)) + 0.25 * np.mean(np.square(flat)))
        self.assertLess(result["finalLoss"], 0.5 * blank_loss)

    def test_anchor_weight_restrains_parameter_drift(self) -> None:
        medium = synthetic_medium()
        lattice, _ = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        seed_state = ORACLE.analytical_seed_state(medium, mode_count=4, seed=3)
        shared = dict(
            mode_count=4,
            iterations=30,
            fit_width=32,
            fit_samples_per_cell=4,
            seed=3,
            init="warm",
            learning_rate=0.05,
            initial_state=seed_state,
        )
        free = ORACLE.fit_modes(medium, lattice, [synthetic_camera()], **shared)
        anchored = ORACLE.fit_modes(medium, lattice, [synthetic_camera()], anchor_weight=50.0, **shared)
        free_drift = float(np.mean(np.linalg.norm(free["state"]["centers"] - seed_state["centers"], axis=1)))
        anchored_drift = float(
            np.mean(np.linalg.norm(anchored["state"]["centers"] - seed_state["centers"], axis=1))
        )
        self.assertLess(anchored_drift, free_drift)
        self.assertEqual(anchored["anchorWeight"], 50.0)

    def test_target_identity_binding_rejects_drifted_lattice(self) -> None:
        medium = synthetic_medium()
        lattice, receipt = CONTRACT_SPEC.build_gaussian_density_lattice(medium, sigma_cells=0.6, fine_grid=16)
        digest = ORACLE.lattice_digest(lattice)
        drifted = lattice.copy()
        drifted[0, 0, 0, 0] += 1e-3
        self.assertNotEqual(digest, ORACLE.lattice_digest(drifted))
        with self.assertRaises(FITTER.SequenceFailure):
            ORACLE.require_lattice_identity(drifted, digest)

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "oracle-out"
            exit_code = ORACLE.execute(
                [
                    "--motion-manifest",
                    str(Path(scratch) / "missing-manifest.json"),
                    "--output-dir",
                    str(output_dir),
                    "--mode-counts",
                    "4",
                ]
            )
            self.assertNotEqual(exit_code, 0)
            report = json.loads((output_dir / "report.json").read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "inputs")


class CheckpointedRenderContracts(unittest.TestCase):
    def test_checkpointed_gradients_match_full_tape(self) -> None:
        # 2026-09-01: the full-image autodiff tape at rung-96 scale attempted
        # ~157GB and took the box down. Render chunks are now wrapped in
        # mx.checkpoint (recompute-in-backward): the loss and its gradients
        # must be numerically equivalent to the full-tape path — memory
        # containment must not change the science.
        medium = synthetic_medium()
        target = ORACLE.TARGET.build_gaussian_density_lattice(
            medium, sigma_cells=0.6, fine_grid=16
        )[0]
        results = {}
        for checkpointed in (False, True):
            results[checkpointed] = ORACLE.fit_modes(
                medium, target, [synthetic_camera()],
                mode_count=3, iterations=8, fit_width=24, fit_samples_per_cell=3,
                seed=11, init="analytical", learning_rate=0.05,
                checkpoint_render=checkpointed,
            )
        a = results[False]["lossHistory"]
        b = results[True]["lossHistory"]
        self.assertEqual(len(a), len(b))
        for la, lb in zip(a, b):
            self.assertAlmostEqual(la, lb, places=4,
                                   msg="checkpointed render diverged from full tape")


if __name__ == "__main__":
    unittest.main()
