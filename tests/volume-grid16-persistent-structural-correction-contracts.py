#!/usr/bin/env python3
"""Contracts for persistent Grid16 signed source-space structural correction."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = ROOT / "volume-grid16-persistent-structural-correction.py"


def load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def synthetic_medium(module):
    positions = np.asarray(
        [
            [-1.5, 0.0, 0.0],
            [-0.5, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.5, 0.0, 0.0],
            [1.5, 0.0, 0.0],
        ],
        dtype=np.float64,
    )
    coefficients = np.zeros((positions.shape[0], 8), dtype=np.float64)
    coefficients[[0, 4], 0] = 1.0
    coefficients[2, 0] = 0.02
    return SimpleNamespace(
        positions=positions,
        coefficients=coefficients,
        spacing=np.ones(3, dtype=np.float64),
        source_spacing=np.ones(3, dtype=np.float64),
    )


def synthetic_state(module):
    return module.FITTER.ModeState(
        iteration=1,
        mode_ids=np.asarray([7, 11], dtype=np.uint64),
        positions=np.asarray([[-0.5, 0.0, 0.0], [0.5, 0.0, 0.0]], dtype=np.float64),
        covariances=np.repeat((np.eye(3, dtype=np.float64) * 0.45)[None, ...], 2, axis=0),
        coefficients=np.asarray(
            [
                [1.01, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
                [1.01, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            ],
            dtype=np.float64,
        ),
        source_row_counts=np.asarray([3, 2], dtype=np.uint32),
        objective=0.0,
        maximum_position_delta=0.0,
    )


def main() -> int:
    assert SCRIPT_PATH.is_file(), "persistent structural correction implementation is missing"
    module = load(SCRIPT_PATH, "grid16_persistent_structural_correction_contract")
    medium = synthetic_medium(module)
    state = synthetic_state(module)

    forces, receipt = module.signed_source_space_forces(medium, state)
    assert forces.shape == state.positions.shape
    assert forces[0, 0] < 0.0 and forces[1, 0] > 0.0, "cavity residual did not push neighboring modes apart"
    assert np.allclose(forces[:, 1:], 0.0, atol=1e-12)
    assert receipt["undercoveredMass"] > 0.0
    assert receipt["overcoveredMass"] > 0.0
    assert np.isclose(receipt["targetMass"], receipt["predictedMass"], rtol=1e-12, atol=1e-12)

    corrected, correction_receipt = module.apply_signed_source_space_correction(
        medium,
        state,
        trust_radius_cells=0.1,
        soft_neighbors=2,
        temperature_cells=0.9,
    )
    displacement = np.linalg.norm(corrected.positions - state.positions, axis=1)
    assert np.max(displacement) <= 0.1 + 1e-12
    assert np.array_equal(corrected.mode_ids, state.mode_ids)
    assert np.array_equal(corrected.covariances, state.covariances)
    assert np.allclose(
        np.sum(corrected.coefficients, axis=0, dtype=np.float64),
        np.sum(medium.coefficients, axis=0, dtype=np.float64),
        rtol=1e-12,
        atol=1e-12,
    )
    assert correction_receipt["birthCount"] == 0
    assert correction_receipt["deathCount"] == 0
    assert correction_receipt["covariancePolicy"] == "fixed-input-covariance"
    assert correction_receipt["coefficientPolicy"] == "target-state-conservative-soft-ownership"

    with tempfile.TemporaryDirectory() as temporary:
        output_dir = Path(temporary) / "failed"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT_PATH),
                "--source-sequence",
                str(Path(temporary) / "missing-source.json"),
                "--target-sequence",
                str(Path(temporary) / "missing-target.json"),
                "--motion-manifest",
                str(Path(temporary) / "missing-motion.json"),
                "--output-dir",
                str(output_dir),
            ],
            check=False,
            capture_output=True,
            text=True,
        )
        assert result.returncode != 0
        report_path = output_dir / "report.json"
        assert report_path.is_file(), "pre-output failure did not write a durable report"
        report = module.FITTER.load_json(report_path) if hasattr(module.FITTER, "load_json") else None
        if report is None:
            import json

            report = json.loads(report_path.read_text(encoding="utf-8"))
        assert report["status"] == "failed"
        assert report["failurePhase"] == "source-validation"
        assert report["claimBoundary"]["structuralProgressClaimed"] is False

    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert '"source-space-signed-mass-residual-force-v0"' in source
    assert '"native-cell-projected-area-jacobian"' in source
    assert '"fixed-input-covariance"' in source
    assert '"target-state-conservative-soft-ownership"' in source
    print("volume Grid16 persistent structural correction contracts passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
