#!/usr/bin/env python3
"""Contracts for the first simulation-grid multiscale fitting sequence."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-multiscale-fitting-sequence.py"


def load_module():
    spec = importlib.util.spec_from_file_location("multiscale_fitting_sequence", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    assert SCRIPT.is_file(), "multiscale fitting sequence implementation is missing"
    source = SCRIPT.read_text()
    for token in (
        "kaminos.volume.multiscale-fitting-sequence.v0",
        "simulation-grid-restriction-not-screen-downsample-v0",
        "integratedEmission",
        "integratedExtinction",
        "stablePrimitiveIdentity",
        "captureCadence",
        "target",
        "reconstruction",
        "residual",
        "failurePhase",
        "lastTrustworthyEvidence",
        "sampleCap",
        "droppedRowCount",
        "continuousOrbit",
        "playPauseScrub",
        "assetUrl",
        "Play fit",
        "hard-full",
        "soft-frozen-covariance",
        "soft-full",
        "soft-optics-exclusive-geometry",
        "restricted-medium-raymarch-reference",
        "restricted-cell-ewa-control",
    ):
        assert token in source, f"sequence evidence contract omitted {token}"
    assert 'id="auto"' not in source, "automatic orbit remains coupled to fitting playback"

    module = load_module()
    grid = 4
    native_ids = np.arange(grid**3, dtype=np.uint32)
    cells = np.stack(
        (
            native_ids % grid,
            (native_ids // grid) % grid,
            native_ids // (grid * grid),
        ),
        axis=1,
    ).astype(np.float64)
    origin = np.asarray((-1.0, -2.0, 0.5), dtype=np.float64)
    spacing = np.asarray((0.5, 0.25, 0.75), dtype=np.float64)
    positions = origin + (cells + 0.5) * spacing
    coefficients = np.zeros((native_ids.size, 8), dtype=np.float64)
    coefficients[:, 0] = 1.0 + cells[:, 0]
    coefficients[:, 1] = 0.5
    coefficients[:, 2] = 0.25
    coefficients[:, 3] = 0.1 + 0.01 * cells[:, 2]
    coefficients[:, 4] = 0.75
    coefficients[:, 7] = 0.2

    restricted = module.restrict_selected_optical_medium(
        native_ids,
        positions,
        coefficients,
        source_grid=grid,
        target_grid=2,
        population="ridge",
    )
    assert restricted.grid == 2
    assert restricted.positions.shape == (8, 3)
    assert restricted.coefficients.shape == (8, 8)
    assert np.all(restricted.coefficients[:, 4:] == 0.0)
    assert np.allclose(restricted.coefficients.sum(axis=0), coefficients[:, :4].sum(axis=0).tolist() + [0.0] * 4)
    assert np.allclose(restricted.remainder_mass[4:], coefficients[:, 4:].sum(axis=0))
    assert restricted.conservation["conserved"] is True
    assert restricted.conservation["sourceCellVolume"] == 1.0
    assert restricted.conservation["targetCellVolume"] == 8.0

    # Identity restriction (factor 1): the ceiling probe fits at the source's
    # native resolution, so target_grid == source_grid must be lawful and be
    # an exact identity — same active cells, same per-cell coefficients,
    # unchanged spacing, conservation intact.
    identity = module.restrict_selected_optical_medium(
        native_ids,
        positions,
        coefficients,
        source_grid=grid,
        target_grid=grid,
        population="ridge",
    )
    assert identity.grid == grid
    ridge_active = np.flatnonzero(coefficients[:, :4].sum(axis=1) > 0.0)
    assert identity.positions.shape == (ridge_active.size, 3)
    assert np.allclose(identity.positions, positions[ridge_active])
    assert np.allclose(identity.coefficients[:, :4], coefficients[ridge_active, :4])
    assert np.all(identity.coefficients[:, 4:] == 0.0)
    assert identity.conservation["conserved"] is True
    assert identity.conservation["targetCellVolume"] == 1.0
    assert np.allclose(identity.conservation["targetSpacing"], identity.conservation["sourceSpacing"])

    homogeneous_coefficients = np.zeros((native_ids.size, 8), dtype=np.float64)
    homogeneous_coefficients[:, 0] = 0.25
    homogeneous = module.restrict_selected_optical_medium(
        native_ids,
        -1.0 + (cells + 0.5) * 0.5,
        homogeneous_coefficients,
        source_grid=grid,
        target_grid=2,
        population="ridge",
    )
    homogeneous_camera = {
        "width": 1,
        "height": 1,
        "cameraPose": {
            "position": [0.0, 0.0, 3.0],
            "target": [0.0, 0.0, 0.0],
            "projectionMatrix": [
                1.0, 0.0, 0.0, 0.0,
                0.0, 1.0, 0.0, 0.0,
                0.0, 0.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 1.0,
            ],
        },
    }
    homogeneous_raymarch, homogeneous_transmittance, homogeneous_receipt = module.render_restricted_medium(
        homogeneous,
        homogeneous_camera,
        width=1,
        samples_per_cell=4,
    )
    assert np.allclose(homogeneous_raymarch[0, 0], [1.0, 0.0, 0.0], atol=1e-12)
    assert np.allclose(homogeneous_transmittance, 1.0)
    assert homogeneous_receipt["identity"] == "restricted-voxel-native-step-raymarch-v1"
    assert homogeneous_receipt["nativeStepScale"] == 1.0
    assert homogeneous_receipt["gaussianPathScaleApplied"] is False
    try:
        module.render_restricted_medium(
            homogeneous,
            homogeneous_camera,
            width=1,
            samples_per_cell=0,
        )
    except module.SequenceFailure as exc:
        assert "samples_per_cell must be positive" in str(exc)
    else:
        raise AssertionError("non-positive raymarch sampling produced false reference evidence")

    oracle = module.restricted_medium_oracle_state(restricted)
    assert oracle.iteration == -1
    assert np.array_equal(oracle.mode_ids, restricted.coarse_cell_ids.astype(np.uint64))
    assert np.array_equal(oracle.positions, restricted.positions)
    assert np.array_equal(oracle.covariances, restricted.covariances)
    assert np.array_equal(oracle.coefficients, restricted.coefficients)
    assert np.array_equal(oracle.source_row_counts, restricted.source_counts)
    assert np.allclose(oracle.coefficients.sum(axis=0), restricted.coefficients.sum(axis=0))

    sequence = module.fit_optical_modes(
        restricted,
        primitive_count=3,
        iteration_count=4,
        soft_neighbors=2,
        temperature_cells=1.0,
    )
    assert len(sequence) == 5
    expected_ids = sequence[0].mode_ids
    assert np.array_equal(expected_ids, np.arange(3, dtype=np.uint64))
    for step in sequence:
        assert np.array_equal(step.mode_ids, expected_ids)
        assert np.allclose(step.coefficients.sum(axis=0), restricted.coefficients.sum(axis=0), rtol=1e-10, atol=1e-10)
        assert np.all(np.linalg.eigvalsh(step.covariances) > 0.0)

    arm_sequences = {
        arm: module.fit_optical_modes(
            restricted,
            primitive_count=3,
            iteration_count=2,
            soft_neighbors=2,
            temperature_cells=1.0,
            assignment_arm=arm,
        )
        for arm in (
            "hard-full",
            "soft-frozen-covariance",
            "soft-full",
            "soft-optics-exclusive-geometry",
        )
    }
    initial = arm_sequences["hard-full"][0]
    for arm, arm_sequence in arm_sequences.items():
        assert len(arm_sequence) == 3, arm
        assert np.array_equal(arm_sequence[0].positions, initial.positions), arm
        assert np.array_equal(arm_sequence[0].covariances, initial.covariances), arm
        assert np.array_equal(arm_sequence[0].coefficients, initial.coefficients), arm
        for step in arm_sequence:
            assert np.array_equal(step.mode_ids, initial.mode_ids), arm
            assert np.allclose(step.coefficients.sum(axis=0), restricted.coefficients.sum(axis=0)), arm
    for step in arm_sequences["soft-frozen-covariance"][1:]:
        assert np.array_equal(step.covariances, initial.covariances)
    hybrid_first = arm_sequences["soft-optics-exclusive-geometry"][1]
    hard_first = arm_sequences["hard-full"][1]
    soft_first = arm_sequences["soft-full"][1]
    assert np.array_equal(hybrid_first.positions, hard_first.positions)
    assert np.array_equal(hybrid_first.covariances, hard_first.covariances)
    assert np.array_equal(hybrid_first.coefficients, soft_first.coefficients)

    with tempfile.TemporaryDirectory() as temporary:
        output = Path(temporary) / "failed"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "--manifest",
                str(Path(temporary) / "missing.json"),
                "--mode-module",
                str(ROOT / "volume-grid96-off-lattice-optical-modes.py"),
                "--output-dir",
                str(output),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0, "missing source manifest falsely succeeded"
        report = json.loads((output / "report.json").read_text())
        assert report["status"] == "failed"
        assert report["failurePhase"] == "source-validation"
        assert report["lastTrustworthyEvidence"]["requestedManifest"].endswith("missing.json")

    print("volume multiscale fitting sequence contracts passed")


if __name__ == "__main__":
    main()
