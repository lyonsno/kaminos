#!/usr/bin/env python3
"""Fail-first contracts for the Grid16 mass-conserving reconstruction target."""

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


TARGET = load("reconstruction_target_contract", "volume-grid16-reconstruction-target-contract.py")
FITTER = TARGET.FITTER


def synthetic_medium() -> object:
    source_grid, target_grid = 8, 4
    cells = np.asarray(
        [
            [2, 2, 2],
            [3, 2, 2],
            [2, 3, 2],
            [5, 5, 5],
            [4, 4, 4],
        ],
        dtype=np.int64,
    )
    native_ids = (cells[:, 0] + source_grid * (cells[:, 1] + source_grid * cells[:, 2])).astype(np.uint32)
    spacing = 0.25
    origin = np.asarray([-1.0, -1.0, -1.0])
    positions = origin + (cells.astype(np.float64) + 0.5) * spacing
    coefficients = np.zeros((cells.shape[0], 8), dtype=np.float64)
    coefficients[:, 0] = np.asarray([1.0, 0.5, 0.25, 2.0, 1.5])
    coefficients[:, 1] = 0.5 * coefficients[:, 0]
    coefficients[:, 2] = 0.25 * coefficients[:, 0]
    coefficients[:, 3] = np.asarray([0.4, 0.2, 0.1, 0.8, 0.6])
    return FITTER.restrict_selected_optical_medium(
        native_ids,
        positions,
        coefficients,
        source_grid=source_grid,
        target_grid=target_grid,
        population="ridge",
    )


def synthetic_camera() -> dict:
    projection = np.eye(4)
    projection[0, 0] = 2.0
    projection[1, 1] = 2.0
    return {
        "width": 48,
        "height": 48,
        "cameraPose": {
            "position": [0.0, 0.0, 3.2],
            "target": [0.0, 0.0, 0.0],
            "projectionMatrix": projection.flatten(order="F").tolist(),
        },
    }


class GaussianBasisContracts(unittest.TestCase):
    def test_gaussian_lattice_conserves_channel_mass(self) -> None:
        medium = synthetic_medium()
        lattice, receipt = TARGET.build_gaussian_density_lattice(medium, sigma_cells=0.5, fine_grid=32)
        self.assertEqual(receipt["identity"], TARGET.GAUSSIAN_RECONSTRUCTION_IDENTITY)
        self.assertTrue(receipt["conserved"])
        for relative in receipt["relativeMassError"]:
            self.assertLessEqual(relative, TARGET.MASS_TOLERANCE)

    def test_truncated_kernel_window_fails_loud_not_silent(self) -> None:
        medium = synthetic_medium()
        with self.assertRaises(FITTER.SequenceFailure):
            TARGET.build_gaussian_density_lattice(
                medium,
                sigma_cells=0.5,
                fine_grid=32,
                truncation_sigmas=0.8,
            )

    def test_bspline_lattice_conserves_channel_mass(self) -> None:
        medium = synthetic_medium()
        lattice, receipt = TARGET.build_bspline_density_lattice(medium, fine_grid=32)
        self.assertEqual(receipt["identity"], TARGET.BSPLINE_RECONSTRUCTION_IDENTITY)
        self.assertTrue(receipt["conserved"])

    def test_march_matches_voxel_energy_on_full_pass(self) -> None:
        medium = synthetic_medium()
        camera = synthetic_camera()
        lattice, _ = TARGET.build_gaussian_density_lattice(medium, sigma_cells=0.5, fine_grid=32)
        linear, transmittance, receipt = TARGET.march_density_lattice(
            lattice,
            medium,
            camera,
            width=48,
            samples_per_cell=8,
        )
        self.assertEqual(receipt["identity"], TARGET.MARCH_IDENTITY)
        self.assertGreater(float(np.max(linear)), 0.0)
        self.assertLess(float(np.min(transmittance)), 1.0)
        voxel_linear, _voxel_t, _voxel_receipt = FITTER.render_restricted_medium(
            medium,
            camera,
            width=48,
            samples_per_cell=8,
        )
        gaussian_energy = float(np.sum(linear))
        voxel_energy = float(np.sum(voxel_linear))
        self.assertGreater(gaussian_energy, 0.35 * voxel_energy)
        self.assertLess(gaussian_energy, 2.5 * voxel_energy)

    def test_blank_medium_march_fails_loud(self) -> None:
        medium = synthetic_medium()
        lattice = np.zeros((32, 32, 32, 8), dtype=np.float64)
        with self.assertRaises(FITTER.SequenceFailure):
            TARGET.march_density_lattice(
                lattice,
                medium,
                synthetic_camera(),
                width=48,
                samples_per_cell=4,
            )

    def test_failure_before_primary_output_writes_durable_report(self) -> None:
        with tempfile.TemporaryDirectory() as scratch:
            output_dir = Path(scratch) / "target-contract-out"
            exit_code = TARGET.execute(
                [
                    "--motion-manifest",
                    str(Path(scratch) / "missing-manifest.json"),
                    "--output-dir",
                    str(output_dir),
                ]
            )
            self.assertNotEqual(exit_code, 0)
            report_path = output_dir / "report.json"
            self.assertTrue(report_path.is_file())
            report = json.loads(report_path.read_text())
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["failurePhase"], "inputs")
            self.assertIn("missing-manifest.json", report["failureMessage"])


if __name__ == "__main__":
    unittest.main()
