#!/usr/bin/env python3
"""Fail-first contracts for camera-independent Grid96 subcell quadrature."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-grid96-conserved-subcell-quadrature.py"
SPEC = importlib.util.spec_from_file_location("kaminos_grid96_subcell_quadrature", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


native_ids = np.asarray([91, 7, 42, 3, 101, 66, 18, 55], dtype=np.uint32)
importance = np.asarray([0.4, 0.9, 0.1, 0.7, 0.3, 0.2, 0.8, 0.6], dtype=np.float32)
counts = MODULE.balanced_adaptive_counts(native_ids, importance, adaptive_fraction=0.25)
require(set(counts.tolist()) == {3, 5, 7}, "adaptive plan did not exercise all reviewed child counts")
require(int(np.sum(counts)) == native_ids.size * 5, "adaptive plan changed the equal child budget")
require(int(np.count_nonzero(counts == 3)) == int(np.count_nonzero(counts == 7)), "adaptive budget is not balanced")
reverse_counts = MODULE.balanced_adaptive_counts(native_ids[::-1], importance[::-1], adaptive_fraction=0.25)
require(
    dict(zip(native_ids.tolist(), counts.tolist()))
    == dict(zip(native_ids[::-1].tolist(), reverse_counts.tolist())),
    "adaptive membership depends on source row order",
)

positions = np.asarray([
    [0.0, 0.0, 0.0],
    [1.0, 0.0, 0.0],
    [2.0, 0.0, 0.0],
    [3.0, 0.0, 0.0],
    [4.0, 0.0, 0.0],
    [5.0, 0.0, 0.0],
    [6.0, 0.0, 0.0],
    [7.0, 0.0, 0.0],
], dtype=np.float32)
tangents = np.asarray([
    [1.0, 1.0, 0.0],
    [0.0, 1.0, 0.0],
    [0.0, 0.0, 0.0],
    [1.0, 0.0, 0.0],
    [1.0, 1.0, 1.0],
    [0.0, 0.0, 1.0],
    [1.0, -1.0, 0.0],
    [0.0, 1.0, 1.0],
], dtype=np.float32)
normals = np.asarray([[0.0, 1.0, 0.0]] * native_ids.size, dtype=np.float32)
normal_valid = np.asarray([1, 1, 1, 0, 1, 0, 1, 1], dtype=bool)
radii = np.linspace(0.01, 0.018, native_ids.size, dtype=np.float32)

directions, fallback = MODULE.structure_tangent_directions(
    native_ids, tangents, normals, normal_valid
)
require(np.all(np.isfinite(directions)), "structure tangent directions contain nonfinite values")
require(np.allclose(np.linalg.norm(directions, axis=1), 1.0, atol=1e-6), "structure tangent directions are not unit length")
require(
    np.allclose(np.sum(directions[normal_valid] * normals[normal_valid], axis=1), 0.0, atol=1e-6),
    "valid structure normals were not removed from the tangent direction",
)
require(bool(fallback[2]), "zero tangent did not disclose deterministic fallback use")

coefficients = np.arange(native_ids.size * 8, dtype=np.float32).reshape(native_ids.size, 8) / 17.0
plan = MODULE.world_child_plan(
    native_ids=native_ids,
    positions=positions,
    tangents=tangents,
    normals=normals,
    normal_valid=normal_valid,
    radii=radii,
    coefficients=coefficients,
    counts=counts,
)
require(plan["childPositions"].shape == (native_ids.size * 5, 3), "equal-budget plan emitted the wrong child population")
require(plan["childCoefficients"].shape == (native_ids.size * 5, 8), "child coefficient shape drifted")
require(np.array_equal(np.bincount(plan["parentRows"], minlength=native_ids.size), counts), "a parent was dropped or assigned the wrong count")
offsets = plan["childPositions"] - positions[plan["parentRows"]]
require(
    np.all(np.linalg.norm(offsets, axis=1) <= radii[plan["parentRows"]] + 1e-7),
    "child position escaped its parent world radius",
)
for row in range(native_ids.size):
    children = plan["parentRows"] == row
    require(
        np.allclose(np.sum(plan["childCoefficients"][children], axis=0), coefficients[row], atol=1e-6),
        f"parent {row} lost optical coefficient mass",
    )
require(plan["receipt"]["cameraIndependent"] is True, "world plan did not declare camera independence")
require(plan["receipt"]["droppedParentCount"] == 0, "world plan dropped a parent")
require(plan["receipt"]["maxPerParentCoefficientConservationError"] <= 1e-6, "conservation receipt exceeds tolerance")

sheet_plan = MODULE.world_child_plan(
    native_ids=native_ids,
    positions=positions,
    tangents=tangents,
    normals=normals,
    normal_valid=np.ones(native_ids.size, dtype=bool),
    radii=radii,
    coefficients=coefficients,
    counts=np.full(native_ids.size, 5, dtype=np.int16),
    geometry="sheet-cross",
)
require(sheet_plan["receipt"]["geometry"] == "sheet-cross", "sheet plan hid its geometry")
for row in range(native_ids.size):
    child_offsets = sheet_plan["childPositions"][sheet_plan["parentRows"] == row] - positions[row]
    require(np.linalg.matrix_rank(child_offsets, tol=1e-7) == 2, f"sheet parent {row} collapsed back to a line")
    require(
        np.allclose(np.sum(sheet_plan["childCoefficients"][sheet_plan["parentRows"] == row], axis=0), coefficients[row], atol=1e-6),
        f"sheet parent {row} lost coefficient mass",
    )

depth_plan = {
    "childPositions": np.asarray([[0.0, 0.0, -1.0], [0.0, 0.0, -2.0]], dtype=np.float64),
    "childCoefficients": np.asarray([
        [1.0, 0.0, 0.0, 0.2, 0.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.3, 0.0, 0.0, 0.0, 0.0],
    ], dtype=np.float32),
}
identity_matrix = np.eye(4, dtype=np.float64).reshape(-1, order="F").tolist()
depth_camera = {
    "cameraIndex": 0,
    "width": 4,
    "height": 4,
    "cameraPose": {"matrixWorldInverse": identity_matrix, "projectionMatrix": identity_matrix},
}
depth_planes, depth_receipt = MODULE.rasterize_world_children(depth_plan, depth_camera, 4, "bilinear")
occupied_depths = np.flatnonzero(np.any(depth_planes != 0.0, axis=(1, 2, 3)))
require(occupied_depths.size == 2, "world children inherited one parent depth bin")
require(depth_receipt["independentChildDepth"] is True, "raster receipt hid shared-depth reuse")
require(
    np.allclose(np.sum(depth_planes, axis=(0, 1, 2)), np.sum(depth_plan["childCoefficients"], axis=0), atol=1e-6),
    "in-frame bilinear deposition did not conserve coefficient charge",
)

permuted = MODULE.world_child_plan(
    native_ids=native_ids[::-1],
    positions=positions[::-1],
    tangents=tangents[::-1],
    normals=normals[::-1],
    normal_valid=normal_valid[::-1],
    radii=radii[::-1],
    coefficients=coefficients[::-1],
    counts=counts[::-1],
)
for native_id in native_ids:
    left_parent = int(np.flatnonzero(native_ids == native_id)[0])
    right_parent = int(np.flatnonzero(native_ids[::-1] == native_id)[0])
    left = plan["childPositions"][plan["parentRows"] == left_parent]
    right = permuted["childPositions"][permuted["parentRows"] == right_parent]
    require(np.allclose(left, right), f"native cell {native_id} child geometry depends on source row order")

try:
    MODULE.world_child_plan(
        native_ids=native_ids,
        positions=positions,
        tangents=tangents,
        normals=normals,
        normal_valid=normal_valid,
        radii=radii,
        coefficients=np.where(coefficients == 0.0, -1.0, coefficients),
        counts=counts,
    )
except ValueError:
    pass
else:
    raise AssertionError("negative optical coefficients escaped validation")

with tempfile.TemporaryDirectory() as temporary:
    report_path = Path(temporary) / "failure.json"
    out_dir = Path(temporary) / "out"
    result = subprocess.run([
        sys.executable,
        str(MODULE_PATH),
        "--manifest", str(Path(temporary) / "missing-manifest.json"),
        "--capture-report", str(Path(temporary) / "missing-capture.json"),
        "--baseline-report", str(Path(temporary) / "missing-baseline.json"),
        "--out-dir", str(out_dir),
        "--report", str(report_path),
    ], check=False, capture_output=True, text=True)
    require(result.returncode != 0, "missing source artifacts falsely succeeded")
    require(report_path.is_file(), "pre-output failure did not write a durable report")
    failure = json.loads(report_path.read_text())
    require(failure.get("status") == "failed", "failure report masqueraded as complete")
    require(failure.get("failurePhase") == "source-validation", "failure report lost the trustworthy phase")
    require(not (out_dir / "index.html").exists(), "stale gallery survived a source-validation failure")

print("grid96 conserved subcell quadrature contracts passed")
