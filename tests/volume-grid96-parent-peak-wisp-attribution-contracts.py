#!/usr/bin/env python3
"""Contracts for the exact-source Grid96 parent peak/wisp attribution socket."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-parent-peak-wisp-attribution.py"
assert SCRIPT.exists(), "Grid96 parent peak/wisp attribution producer is missing"

spec = importlib.util.spec_from_file_location("kaminos_grid96_parent_attribution", SCRIPT)
assert spec is not None and spec.loader is not None
MODULE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MODULE)


# Peak and wisp residuals are independent target-relative underfit fields. A
# bright flat pixel must not become a wisp, and a dim edge must not become a peak.
candidate = np.zeros((4, 4, 3), dtype=np.uint8)
target = np.zeros_like(candidate)
target[0, 0] = 255
target[2:, 2:] = 96
peak, wisp, thresholds = MODULE.positive_residual_fields(candidate, target)
assert peak.shape == (4, 4) and wisp.shape == (4, 4)
assert peak[0, 0] > 0.0
assert wisp[0, 0] > 0.0
assert not np.array_equal(peak, wisp), "peak and wisp labels were merged"
assert thresholds["peakLumaPercentile"] == 99.0
assert thresholds["wispGradientPercentile"] == 97.5


# Footprint integration must see residual away from the projected center and
# preserve raw overlap separately from optical/transmittance weighting.
peak_field = np.zeros((3, 4), dtype=np.float32)
wisp_field = np.zeros_like(peak_field)
peak_field[1, 2] = 2.0
wisp_field[1, 2] = 3.0
transmittance = np.ones((2, 3, 4), dtype=np.float32)
transmittance[0, 1, 2] = 0.25
sample_x = np.asarray((1, 2), dtype=np.int32)
sample_y = np.asarray((1, 1), dtype=np.int32)
sample_weight = np.asarray((0.5, 0.5), dtype=np.float32)
sample_depth = np.asarray((0, 0), dtype=np.int32)
row_index = np.asarray((0, 0), dtype=np.int64)
labels = MODULE.integrate_footprint_fragments(
    row_count=1,
    row_index=row_index,
    sample_x=sample_x,
    sample_y=sample_y,
    sample_depth=sample_depth,
    sample_weight=sample_weight,
    transmittance_before=transmittance,
    local_optical_weight=np.asarray((0.8,), dtype=np.float32),
    peak_field=peak_field,
    wisp_field=wisp_field,
)
column = {name: index for index, name in enumerate(MODULE.PER_CAMERA_ORDER)}
assert np.isclose(labels[0, column["viewportKernelMass"]], 1.0)
assert np.isclose(labels[0, column["peakResidualOverlap"]], 1.0)
assert np.isclose(labels[0, column["wispResidualOverlap"]], 1.5)
assert np.isclose(labels[0, column["peakImportance"]], 0.2)
assert np.isclose(labels[0, column["wispImportance"]], 0.3)
assert labels[0, column["peakImportance"]] < labels[0, column["peakResidualOverlap"]]


# Reduction retains calibration and held-out roles, all parent rows, and both
# labels. It must not substitute camera aggregates for the source rows.
per_camera = np.zeros((3, 2, len(MODULE.PER_CAMERA_ORDER)), dtype=np.float32)
per_camera[:, :, column["projected"]] = 1.0
per_camera[0, :, column["peakImportance"]] = (1.0, 2.0)
per_camera[1:, :, column["peakImportance"]] = ((3.0, 4.0), (5.0, 6.0))
per_camera[0, :, column["wispImportance"]] = (7.0, 8.0)
per_camera[1:, :, column["wispImportance"]] = ((9.0, 10.0), (11.0, 12.0))
reduced = MODULE.reduce_camera_attribution(per_camera, calibration_camera_slot=0)
reduced_column = {name: index for index, name in enumerate(MODULE.REDUCED_ORDER)}
assert reduced.shape == (2, len(MODULE.REDUCED_ORDER))
assert reduced[:, reduced_column["peakImportance.calibration"]].tolist() == [1.0, 2.0]
assert reduced[:, reduced_column["peakImportance.heldMean"]].tolist() == [4.0, 5.0]
assert reduced[:, reduced_column["wispImportance.heldMaximum"]].tolist() == [11.0, 12.0]
assert reduced[:, reduced_column["projectedCameraCount"]].tolist() == [3.0, 3.0]


with tempfile.TemporaryDirectory(prefix="kaminos-grid96-parent-attribution-") as temp:
    root = Path(temp)
    output = root / "output"
    missing_registry = root / "missing-registry.json"
    completed = subprocess.run(
        (
            sys.executable,
            str(SCRIPT),
            "--source-registry",
            str(missing_registry),
            "--manifest",
            str(root / "missing-manifest.json"),
            "--capture-report",
            str(root / "missing-capture.json"),
            "--output-dir",
            str(output),
            "--path-scale",
            "3.8845837491755066",
        ),
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode != 0
    failure = json.loads((output / "report.json").read_text())
    assert failure["status"] == "failed"
    assert failure["failurePhase"] == "source-registry-validation"
    assert failure["requested"]["sourceRegistry"] == str(missing_registry.resolve())
    assert not (output / "grid96-parent-peak-wisp-attribution-manifest.json").exists()

print("volume-grid96 parent peak/wisp attribution contracts passed")
