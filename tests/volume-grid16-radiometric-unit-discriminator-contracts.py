#!/usr/bin/env python3
"""Contracts for the Grid16 Raymarch-to-EWA radiometric unit discriminator."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "volume-grid16-radiometric-unit-discriminator.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def main() -> None:
    assert SCRIPT_PATH.is_file(), "radiometric unit discriminator implementation is missing"
    implementation = load(SCRIPT_PATH, "grid16_radiometric_unit_discriminator_contract")

    coefficients = np.arange(24, dtype=np.float64).reshape((3, 8))
    emission = implementation.component_coefficients(coefficients, "emission-only")
    extinction = implementation.component_coefficients(coefficients, "extinction-only")
    combined = implementation.component_coefficients(coefficients, "combined")
    assert np.array_equal(emission[:, [0, 1, 2, 4, 5, 6]], coefficients[:, [0, 1, 2, 4, 5, 6]])
    assert np.count_nonzero(emission[:, [3, 7]]) == 0
    assert np.array_equal(extinction[:, [3, 7]], coefficients[:, [3, 7]])
    assert np.count_nonzero(extinction[:, [0, 1, 2, 4, 5, 6]]) == 0
    assert np.array_equal(combined, coefficients)
    assert not np.shares_memory(emission, coefficients)
    assert not np.shares_memory(extinction, coefficients)
    assert not np.shares_memory(combined, coefficients)

    target = np.asarray(
        [
            [[0.2, 0.4, 0.6], [0.1, 0.3, 0.5]],
            [[0.0, 0.1, 0.2], [0.7, 0.8, 0.9]],
        ],
        dtype=np.float64,
    )
    treatment = target * 0.25
    metrics = implementation.linear_rgb_metrics(target, treatment)
    assert metrics["targetMeanLuma"] > metrics["treatmentMeanLuma"]
    assert np.isclose(metrics["meanLumaRatio"], 0.25)
    assert metrics["linearMae"] > 0.0
    assert len(metrics["targetIntegratedRgb"]) == 3
    assert len(metrics["treatmentIntegratedRgb"]) == 3

    target_transmittance = np.asarray([[1.0, 0.8], [0.5, 0.2]], dtype=np.float64)
    treatment_transmittance = np.asarray([[1.0, 0.9], [0.6, 0.3]], dtype=np.float64)
    transport = implementation.transmittance_metrics(target_transmittance, treatment_transmittance)
    assert transport["transmittanceMae"] > 0.0
    assert transport["targetMeanOpacity"] > transport["treatmentMeanOpacity"]

    emitted = np.asarray([[[0.4, 0.2, 0.1], [0.3, 0.6, 0.9]]], dtype=np.float64)
    optical_depth = np.asarray([[0.0, 1e-12]], dtype=np.float64)
    transferred, transmittance = implementation.homogeneous_transfer(emitted, optical_depth)
    assert np.allclose(transferred, emitted), "zero-extinction emission limit was deleted"
    assert np.allclose(transmittance, 1.0)

    identity = np.eye(4, dtype=np.float64)
    perspective = np.asarray(
        [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, -1.0, -1.0],
            [0.0, 0.0, -1.0, 0.0],
        ],
        dtype=np.float64,
    )
    camera = {
        "width": 100,
        "height": 100,
        "cameraPose": {
            "matrixWorldInverse": identity.reshape(-1, order="F").tolist(),
            "projectionMatrix": perspective.reshape(-1, order="F").tolist(),
        },
    }
    positions = np.asarray([[0.0, 0.0, -2.0], [0.0, 0.0, -4.0]], dtype=np.float64)
    scales = implementation.projected_native_cell_area_scales(
        positions,
        camera,
        np.ones(3, dtype=np.float64),
    )
    assert np.allclose(scales, [625.0, 156.25], rtol=2e-4, atol=1e-6)
    assert np.isclose(scales[0] / scales[1], 4.0, rtol=2e-4)

    sequence = {
        "frames": [
            {
                "iteration": 2,
                "objective": 4.5,
                "maximumPositionDelta": 0.25,
                "primitives": [
                    {
                        "id": 9,
                        "position": [1.0, 2.0, 3.0],
                        "covariance": np.eye(3, dtype=np.float64).tolist(),
                        "coefficients": np.arange(8, dtype=np.float64).tolist(),
                        "sourceRowCount": 7,
                    }
                ],
            }
        ]
    }
    replay_state = implementation.sequence_mode_state(sequence, 2)
    assert replay_state.iteration == 2
    assert replay_state.mode_ids.tolist() == [9]
    assert replay_state.positions.tolist() == [[1.0, 2.0, 3.0]]
    assert replay_state.coefficients.tolist() == [np.arange(8, dtype=np.float64).tolist()]
    assert replay_state.source_row_counts.tolist() == [7]

    with tempfile.TemporaryDirectory() as temporary_name:
        output_dir = Path(temporary_name)
        missing_sequence = output_dir / "missing-sequence.json"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--target-sequence",
                str(missing_sequence),
                "--output-dir",
                str(output_dir),
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        report_path = output_dir / "report.json"
        assert report_path.is_file(), "pre-output failure did not write a durable report"
        report = json.loads(report_path.read_text())
        assert report["status"] == "failed"
        assert report["failurePhase"] == "source-validation"
        assert report["requested"]["target_sequence"] == str(missing_sequence)
        assert report["claimBoundary"]["radiometricClosureClaimed"] is False

    source = SCRIPT_PATH.read_text()
    for component in ("emission-only", "extinction-only", "combined"):
        assert f'"{component}"' in source
    assert '"grid16-restricted-raymarch"' in source
    assert '"grid16-cell-event-ewa"' in source
    assert '"legacy-low-tau-source-deletion"' in source
    assert '"corrected-zero-limit"' in source
    assert '"native-cell-projected-area-jacobian"' in source
    assert '"fitInvoked": False' in source
    print("volume Grid16 radiometric unit discriminator contracts passed")


if __name__ == "__main__":
    main()
