#!/usr/bin/env python3
"""Fail-first contracts for fixed-work contribution-aware quadrature."""

from __future__ import annotations

import importlib.util
import inspect
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-budget-oracle.py"
SPEC = importlib.util.spec_from_file_location("kaminos_budget_oracle_contribution", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODULE.initialize_runtime()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require(
    "contribution_deposition" in inspect.signature(MODULE.run).parameters,
    "the governed oracle cannot launch the contribution-deposition arm",
)

work_contract = MODULE.deposition_work_contract([
    "optical-hysteresis-adaptive-mean",
    MODULE.CONTRIBUTION_DEPOSITION_POLICY,
])
require(work_contract["nominalDepositsPerCandidate"] == 20, "equal nominal deposition work drifted")
require(work_contract["maximumDepositsPerCandidate"] == 28, "top-level report hid the seven-tap maximum")
require(
    work_contract["maximumDepositsPerCandidateByPolicy"]
    == {
        "optical-hysteresis-adaptive-mean": 20,
        MODULE.CONTRIBUTION_DEPOSITION_POLICY: 28,
    },
    "top-level report cannot distinguish fixed-five and variable-tap maxima",
)
require(
    work_contract["contributionDepositionCouplesTapCountAndFootprintSpacing"] is True,
    "report hides that the treatment jointly changes tap allocation and footprint spacing",
)


native_ids = np.asarray([90, 12, 44, 71, 3, 28, 61, 8, 105, 34], dtype=np.uint32)
scores = np.asarray([0.2, 0.9, 0.4, 0.7, 0.3, 0.8, 0.1, 1.0, 0.6, 0.5], dtype=np.float32)
quota_keys = np.asarray([0, 0, 0, 0, 1, 1, 1, 1, 2, 2], dtype=np.int64)
counts = MODULE.quota_balanced_contribution_tap_counts(native_ids, scores, quota_keys)
require(set(counts.tolist()) <= {3, 5, 7}, "contribution allocator invented an unreviewed tap count")
require(int(np.sum(counts)) == native_ids.size * MODULE.FLOW_TAPS_PER_CANDIDATE, "contribution allocator changed total tap work")
for quota in np.unique(quota_keys):
    rows = np.flatnonzero(quota_keys == quota)
    require(int(np.sum(counts[rows])) == rows.size * MODULE.FLOW_TAPS_PER_CANDIDATE, "a spatial/depth quota borrowed work from another quota")
    order = rows[np.argsort(-scores[rows], kind="stable")]
    require(np.all(np.diff(counts[order]) <= 0), "higher local contribution received fewer taps inside a quota")

permutation = np.asarray([8, 4, 2, 0, 9, 3, 7, 1, 6, 5], dtype=np.int64)
permuted_counts = MODULE.quota_balanced_contribution_tap_counts(
    native_ids[permutation], scores[permutation], quota_keys[permutation]
)
count_by_id = dict(zip(native_ids.tolist(), counts.tolist()))
permuted_by_id = dict(zip(native_ids[permutation].tolist(), permuted_counts.tolist()))
require(count_by_id == permuted_by_id, "contribution tap assignment depends on source row order")

tied_scores = np.ones(native_ids.size, dtype=np.float32)
tied_counts_a = MODULE.quota_balanced_contribution_tap_counts(native_ids, tied_scores, quota_keys)
tied_counts_b = MODULE.quota_balanced_contribution_tap_counts(
    native_ids[::-1], tied_scores[::-1], quota_keys[::-1]
)
require(
    dict(zip(native_ids.tolist(), tied_counts_a.tolist()))
    == dict(zip(native_ids[::-1].tolist(), tied_counts_b.tolist())),
    "exact-score tap ties depend on source row order",
)

offscreen_ids = np.asarray([101, 102, 103, 104], dtype=np.uint32)
offscreen_scores = np.asarray([0.1, 0.9, 0.2, 0.8], dtype=np.float32)
offscreen_quotas = np.asarray([-1, -1, 7, 7], dtype=np.int64)
offscreen_counts = MODULE.quota_balanced_contribution_tap_counts(
    offscreen_ids,
    offscreen_scores,
    offscreen_quotas,
)
require(
    offscreen_counts[offscreen_quotas < 0].tolist() == [5, 5],
    "off-screen rows participated in contribution quota ranking",
)
require(
    int(np.sum(offscreen_counts)) == offscreen_ids.size * MODULE.FLOW_TAPS_PER_CANDIDATE,
    "excluding off-screen rows changed fixed total tap work",
)

coefficients = np.zeros((4, 8), dtype=np.float32)
coefficients[:, 0] = np.asarray([4.0, 4.0, 1.0, 0.0], dtype=np.float32)
coefficients[:, 3] = np.asarray([0.1, 8.0, 0.1, 0.0], dtype=np.float32)
transmitted = MODULE.local_transmitted_emission_scores(coefficients)
require(transmitted[0] > transmitted[1], "local extinction did not reduce predicted transmitted contribution")
require(transmitted[0] > transmitted[2], "stronger local emission did not increase predicted transmitted contribution")
require(transmitted[3] == 0.0, "zero local emission produced nonzero contribution")

patterns = MODULE.CONTRIBUTION_TAP_PATTERNS
require(set(patterns) == {3, 5, 7}, "contribution quadrature patterns drifted")
for tap_count, pattern in patterns.items():
    offsets = np.asarray(pattern["offsets"], dtype=np.float32)
    weights = np.asarray(pattern["weights"], dtype=np.float32)
    slots = np.asarray(pattern["slots"], dtype=np.int64)
    require(offsets.size == weights.size == slots.size == tap_count, f"{tap_count}-tap pattern width drifted")
    require(abs(float(np.sum(weights)) - 1.0) <= 1e-6, f"{tap_count}-tap pattern does not conserve per-node coefficient mass")
    require(np.all(np.diff(offsets) > 0), f"{tap_count}-tap offsets are not strictly ordered")
    require(np.unique(slots).size == tap_count, f"{tap_count}-tap temporal slots are not unique")

camera = {
    "cameraIndex": 0,
    "width": 32,
    "height": 32,
    "cameraPose": {
        "matrixWorldInverse": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
        "projectionMatrix": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
    },
}
plan_ids = np.asarray([201, 202], dtype=np.uint32)
plan_descriptors = np.zeros((2, 8), dtype=np.float32)
plan_coefficients = np.zeros((2, 8), dtype=np.float32)
plan_coefficients[:, 0] = np.asarray([1.0, 2.0], dtype=np.float32)
original_project = MODULE.ORACLE.project
try:
    MODULE.ORACLE.project = lambda *_args, **_kwargs: (
        np.asarray([[-1.015625, 0.0], [0.0, 0.0]], dtype=np.float32),
        np.asarray([1.0, 1.0], dtype=np.float32),
        np.asarray([True, True]),
    )
    plan_counts, plan_receipt = MODULE.contribution_deposition_plan(
        plan_ids,
        plan_descriptors,
        plan_coefficients,
        camera,
    )
finally:
    MODULE.ORACLE.project = original_project
require(plan_counts.tolist() == [5, 5], "negative fractional screen coordinate entered contribution ranking")
require(plan_receipt["visibleRows"] == 1, "negative fractional screen coordinate was labeled visible")
require(plan_receipt["quotaCount"] == 1, "off-screen sentinel was counted as a projected quota")

positions = np.asarray([
    [-0.25, -0.25, -1.0],
    [0.25, -0.25, -1.0],
    [-0.25, 0.25, -1.0],
    [0.25, 0.25, -1.0],
], dtype=np.float32)
tangents = np.tile(np.asarray([[1.0, 0.0, 0.0]], dtype=np.float32), (4, 1))
features = np.zeros((4, 24), dtype=np.float32)
features[:, 2:4] = 0.5
raster_coefficients = np.zeros((4, 8), dtype=np.float32)
raster_coefficients[:, 0] = np.asarray([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
raster_counts = np.asarray([7, 3, 7, 3], dtype=np.int8)
planes, telemetry = MODULE.ORACLE.rasterize_coefficients(
    positions,
    tangents,
    features,
    raster_coefficients,
    camera,
    8,
    "bilinear",
    tap_counts=raster_counts,
    tap_patterns=patterns,
)
require(telemetry.get("quadratureRule") == MODULE.CONTRIBUTION_DEPOSIT_RULE, "raster receipt hid the contribution quadrature rule")
require(telemetry.get("nominalTapEvaluations") == 20, "raster receipt changed equal tap work")
require(abs(float(np.sum(planes[..., 0])) - float(np.sum(raster_coefficients[:, 0]))) <= 1e-4, "variable-tap raster failed to conserve coefficient mass")

edge_positions = np.asarray([
    [-1.015625, 0.0, -1.0],
    [0.0, 0.0, -1.0],
], dtype=np.float32)
edge_tangents = np.tile(np.asarray([[1.0, 0.0, 0.0]], dtype=np.float32), (2, 1))
edge_features = np.zeros((2, 24), dtype=np.float32)
edge_coefficients = np.zeros((2, 8), dtype=np.float32)
edge_coefficients[:, 0] = np.asarray([100.0, 1.0], dtype=np.float32)
edge_planes, edge_telemetry = MODULE.ORACLE.rasterize_coefficients(
    edge_positions,
    edge_tangents,
    edge_features,
    edge_coefficients,
    camera,
    8,
    "bilinear",
)
require(edge_telemetry["projectedRows"] == 1, "negative fractional pixel coordinate entered the raster cohort")
require(abs(float(np.sum(edge_planes[..., 0])) - 1.0) <= 1e-4, "negative fractional pixel coordinate deposited at the frame edge")

edge_motion_rows = {
    "kernelDescriptors": np.concatenate((edge_positions, edge_tangents, np.ones((2, 1)), np.zeros((2, 1))), axis=1),
    "features": edge_features,
}
edge_placements = MODULE.MOTION.flow_tap_placements(edge_motion_rows, camera)
require(not np.any(np.isfinite(edge_placements[0])), "negative fractional pixel coordinate entered the motion placement ledger")
require(np.all(np.isfinite(edge_placements[1])), "visible pixel coordinate disappeared from the motion placement ledger")

motion_rows = {
    "kernelDescriptors": np.concatenate((positions, tangents, np.ones((4, 1)), np.zeros((4, 1))), axis=1),
    "features": features,
}
placements = MODULE.MOTION.flow_tap_placements(
    motion_rows,
    camera,
    tap_counts=raster_counts,
    tap_patterns=patterns,
)
require(placements.shape == (4, 7, 2), "variable-tap placement slots cannot expose tap-count churn")
require(np.sum(np.isfinite(placements).all(axis=2), axis=1).tolist() == raster_counts.tolist(), "placement slots do not match active tap counts")
multiplicity = MODULE.MOTION.bilinear_deposit_multiplicity(placements, 32, 32)
temporal = {
    "ids": np.asarray([1, 2, 3, 4], dtype=np.uint32),
    "placements": placements,
    "multiplicity": multiplicity,
    "depositRule": MODULE.CONTRIBUTION_DEPOSIT_RULE,
    "maximumDepositsPerCandidate": 28,
}
churn = MODULE.MOTION.multiplicity_churn(temporal, temporal)
require(churn["depositRule"] == MODULE.CONTRIBUTION_DEPOSIT_RULE, "temporal receipt relabeled variable taps as fixed-five")
require(churn["maximumDepositsPerCandidate"] == 28, "temporal receipt hid the seven-tap maximum")

boundary_placements = np.asarray([
    [[4.0, 4.0]],
    [[-0.25, 4.0]],
    [[np.nan, np.nan]],
], dtype=np.float32)
boundary_weights = np.ones((3, 1), dtype=np.float32)
boundary_accounting = MODULE.MOTION.bilinear_deposit_accounting(
    boundary_placements,
    boundary_weights,
    8,
    8,
)
require(
    boundary_accounting["nominalDepositEvaluations"].tolist() == [4, 4, 4],
    "bilinear accounting changed nominal work",
)
require(
    boundary_accounting["positiveWeightDepositEvaluations"].tolist() == [1, 2, 0],
    "bilinear accounting counted zero-weight neighbors as deposits",
)
require(
    boundary_accounting["actualInBoundsPositiveWeightDeposits"].tolist() == [1, 1, 0],
    "bilinear accounting miscounted actual in-bounds deposits",
)
require(
    boundary_accounting["outOfFramePositiveWeightDeposits"].tolist() == [0, 1, 0],
    "bilinear accounting hid positive-weight frame clipping",
)
require(
    boundary_accounting["invalidProjectionNominalDeposits"].tolist() == [0, 0, 4],
    "bilinear accounting relabeled invalid projection as clipping",
)
require(
    np.allclose(boundary_accounting["retainedQuadratureWeightFraction"], [1.0, 0.75, 0.0]),
    "bilinear accounting misstated retained quadrature-weight fraction",
)

for bad_ids, bad_scores, bad_quotas, reason in (
    (np.asarray([1, 1], dtype=np.uint32), np.asarray([1.0, 2.0]), np.asarray([0, 0]), "duplicate identities"),
    (np.asarray([1, 2], dtype=np.uint32), np.asarray([1.0, np.nan]), np.asarray([0, 0]), "nonfinite score"),
    (np.asarray([1, 2], dtype=np.uint32), np.asarray([1.0]), np.asarray([0, 0]), "row mismatch"),
):
    try:
        MODULE.quota_balanced_contribution_tap_counts(bad_ids, bad_scores, bad_quotas)
    except ValueError:
        pass
    else:
        raise AssertionError(f"contribution allocator accepted {reason}")

print("volume layer coefficient contribution deposition contracts passed")
