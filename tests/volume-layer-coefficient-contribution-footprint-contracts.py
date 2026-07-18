#!/usr/bin/env python3
"""Fail-first contracts for fixed-five contribution-ranked footprint concentration."""

from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-budget-oracle.py"
SPEC = importlib.util.spec_from_file_location("kaminos_budget_oracle_footprint", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODULE.initialize_runtime()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require(
    hasattr(MODULE, "CONTRIBUTION_FOOTPRINT_POLICY"),
    "the fixed-five contribution-footprint policy does not exist",
)
require(
    "contribution_footprint" in inspect.signature(MODULE.run).parameters,
    "the governed oracle cannot launch the contribution-footprint arm",
)

work_contract = MODULE.deposition_work_contract([
    "optical-hysteresis-adaptive-mean",
    MODULE.CONTRIBUTION_FOOTPRINT_POLICY,
])
require(work_contract["nominalDepositsPerCandidate"] == 20, "footprint treatment changed nominal work")
require(work_contract["maximumDepositsPerCandidate"] == 20, "footprint treatment invented extra taps")
require(
    work_contract["maximumDepositsPerCandidateByPolicy"]
    == {
        "optical-hysteresis-adaptive-mean": 20,
        MODULE.CONTRIBUTION_FOOTPRINT_POLICY: 20,
    },
    "footprint treatment is not matched to fixed-five work",
)
require(
    work_contract["contributionDepositionCouplesTapCountAndFootprintSpacing"] is False,
    "footprint-only treatment was mislabeled as variable tap count",
)

native_ids = np.asarray([90, 12, 44, 71, 3, 28, 61, 8, 105, 34], dtype=np.uint32)
scores = np.asarray([0.2, 0.9, 0.4, 0.7, 0.3, 0.8, 0.1, 1.0, 0.6, 0.5], dtype=np.float32)
quota_keys = np.asarray([0, 0, 0, 0, 1, 1, 1, 1, 2, 2], dtype=np.int64)
scales = MODULE.quota_balanced_contribution_footprint_scales(native_ids, scores, quota_keys)
require(scales.shape == scores.shape, "footprint scale plan changed row population")
require(np.all(np.isfinite(scales)), "footprint scale plan contains nonfinite values")
require(np.all((scales >= 0.75) & (scales <= 1.0)), "footprint scale escaped the reviewed range")
for quota in np.unique(quota_keys):
    rows = np.flatnonzero(quota_keys == quota)
    order = rows[np.argsort(-scores[rows], kind="stable")]
    require(np.all(np.diff(scales[order]) >= 0.0), "higher local contribution received a wider footprint")
    require(abs(float(scales[order[0]]) - 0.75) <= 1e-6, "quota peak did not receive the narrow footprint")
    require(abs(float(scales[order[-1]]) - 1.0) <= 1e-6, "quota tail did not retain the baseline footprint")

permutation = np.asarray([8, 4, 2, 0, 9, 3, 7, 1, 6, 5], dtype=np.int64)
permuted_scales = MODULE.quota_balanced_contribution_footprint_scales(
    native_ids[permutation], scores[permutation], quota_keys[permutation]
)
require(
    dict(zip(native_ids.tolist(), scales.tolist()))
    == dict(zip(native_ids[permutation].tolist(), permuted_scales.tolist())),
    "footprint concentration depends on source row order",
)

offscreen_quotas = np.asarray([-1, -1, 7, 7], dtype=np.int64)
offscreen_scales = MODULE.quota_balanced_contribution_footprint_scales(
    np.asarray([101, 102, 103, 104], dtype=np.uint32),
    np.asarray([0.1, 0.9, 0.2, 0.8], dtype=np.float32),
    offscreen_quotas,
)
require(offscreen_scales[offscreen_quotas < 0].tolist() == [1.0, 1.0], "offscreen rows entered footprint ranking")

camera = {
    "cameraIndex": 0,
    "width": 32,
    "height": 32,
    "cameraPose": {
        "matrixWorldInverse": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
        "projectionMatrix": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
    },
}
positions = np.asarray([
    [-0.25, -0.25, -1.0],
    [0.25, -0.25, -1.0],
    [-0.25, 0.25, -1.0],
    [0.25, 0.25, -1.0],
], dtype=np.float32)
tangents = np.tile(np.asarray([[1.0, 0.0, 0.0]], dtype=np.float32), (4, 1))
features = np.zeros((4, 24), dtype=np.float32)
features[:, 2:4] = 0.5
coefficients = np.zeros((4, 8), dtype=np.float32)
coefficients[:, 0] = np.asarray([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
raster_scales = np.asarray([0.75, 0.8, 0.9, 1.0], dtype=np.float32)
planes, telemetry = MODULE.ORACLE.rasterize_coefficients(
    positions,
    tangents,
    features,
    coefficients,
    camera,
    8,
    "bilinear",
    tap_scales=raster_scales,
)
require(telemetry["quadratureRule"] == MODULE.CONTRIBUTION_FOOTPRINT_DEPOSIT_RULE, "raster hid the footprint rule")
require(telemetry["nominalTapEvaluations"] == 20, "footprint raster changed five-tap work")
require(abs(float(np.sum(planes[..., 0])) - float(np.sum(coefficients[:, 0]))) <= 1e-4, "footprint raster lost coefficient mass")

motion_descriptors = np.zeros((4, 8), dtype=np.float32)
motion_descriptors[:, 0:3] = positions
motion_descriptors[:, 3] = np.arange(4, dtype=np.float32)
motion_descriptors[:, 4:7] = tangents
motion_rows = {
    "kernelDescriptors": motion_descriptors,
    "features": features,
}
placements = MODULE.MOTION.flow_tap_placements(motion_rows, camera, tap_scales=raster_scales)
weights = MODULE.MOTION.flow_tap_weights(4)
require(placements.shape == (4, 5, 2), "footprint treatment changed tap-slot multiplicity")
require(np.all(np.isfinite(placements)), "visible fixed-five placements disappeared")
require(np.allclose(np.sum(weights, axis=1), 1.0), "fixed-five weights stopped conserving coefficient mass")
baseline_placements = MODULE.MOTION.flow_tap_placements(motion_rows, camera)
baseline_radius = np.linalg.norm(baseline_placements[:, 0] - baseline_placements[:, 2], axis=1)
scaled_radius = np.linalg.norm(placements[:, 0] - placements[:, 2], axis=1)
require(np.allclose(scaled_radius / baseline_radius, raster_scales, atol=1e-5), "motion witness did not apply the planned footprint scale")

print("volume layer coefficient contribution footprint contracts passed")
