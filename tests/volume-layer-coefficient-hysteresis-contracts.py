#!/usr/bin/env python3
"""Fail-first contracts for persistent optical quadrature admission."""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-budget-oracle.py"
SPEC = importlib.util.spec_from_file_location("kaminos_budget_oracle_hysteresis", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODULE.np = np
MODULE.LUMA = np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)

assert MODULE.COMPARISON_AUTHORITY != MODULE.SELECTION_AUTHORITY, (
    "aggregate comparator authority still impersonates the stateless optical arm"
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


ids = np.asarray([91, 7, 42, 3, 101, 66, 18, 55], dtype=np.uint32)
previous_ids = np.asarray([3, 55, 66], dtype=np.uint32)
coefficients = np.zeros((ids.size, 8), dtype=np.float32)
coefficients[:, 0] = np.asarray([0.1, 6.1, 0.3, 8.0, 0.4, 6.0, 0.6, 7.0], dtype=np.float32)

stateless = MODULE.select_optical_energy(ids, coefficients, 3)
uninitialized = MODULE.select_optical_hysteresis(ids, coefficients, 3, None, hysteresis_ratio=0.1)
require(
    np.array_equal(uninitialized, stateless),
    "first-state hysteretic selection drifted from the stateless optical control",
)

tied_coefficients = np.zeros_like(coefficients)
tied_coefficients[ids == 3, 0] = 10.0
tied_coefficients[ids == 55, 0] = 9.0
tied_coefficients[ids == 66, 0] = 0.01
tied_coefficients[ids == 7, 0] = 8.0
tied_coefficients[ids == 42, 0] = 8.0
tied_a = MODULE.select_optical_hysteresis(ids, tied_coefficients, 3, previous_ids, hysteresis_ratio=0.1)
tied_b = MODULE.select_optical_hysteresis(ids[::-1], tied_coefficients[::-1], 3, previous_ids[::-1], hysteresis_ratio=0.1)
require(
    set(ids[tied_a].tolist()) == set(ids[::-1][tied_b].tolist()),
    "exact-score hysteretic ties depend on row or prior-membership order",
)
require(66 not in set(ids[tied_a].tolist()), "tie fixture did not force a prior member to exit")
require(
    len(set(ids[tied_a].tolist()) & {7, 42}) == 1,
    "tie fixture did not force two tied newcomers to compete for one slot",
)

hysteretic = MODULE.select_optical_hysteresis(
    ids,
    coefficients,
    3,
    previous_ids,
    hysteresis_ratio=0.1,
)
require(hysteretic.size == 3, "hysteretic selector changed the fixed budget")
require(
    set(ids[hysteretic].tolist()) == {3, 55, 66},
    "hysteretic selector replaced a prior member for a near-boundary newcomer",
)

reversed_hysteretic = MODULE.select_optical_hysteresis(
    ids[::-1],
    coefficients[::-1],
    3,
    previous_ids[::-1],
    hysteresis_ratio=0.1,
)
require(
    set(ids[::-1][reversed_hysteretic].tolist()) == {3, 55, 66},
    "hysteretic membership depends on row or previous-membership order",
)

clear_replacement = coefficients.copy()
clear_replacement[ids == 7, 0] = 12.0
clear_replacement[ids == 66, 0] = 0.05
receipt = {}
replaced = MODULE.select_optical_hysteresis(
    ids,
    clear_replacement,
    3,
    previous_ids,
    hysteresis_ratio=0.1,
    receipt=receipt,
)
require(
    set(ids[replaced].tolist()) == {3, 7, 55},
    "hysteretic selector retained a stale member after a clear causal-score replacement",
)
expected_receipts = {
    "previous": previous_ids,
    "selected": np.asarray([3, 7, 55], dtype=np.uint32),
    "retained": np.asarray([3, 55], dtype=np.uint32),
    "entered": np.asarray([7], dtype=np.uint32),
    "exited": np.asarray([66], dtype=np.uint32),
}
for label, expected_ids in expected_receipts.items():
    expected = MODULE.native_id_set_receipt(expected_ids)
    require(receipt[label] == expected, f"hysteresis {label} receipt does not bind the truthful native-ID set")
require(
    receipt["selected"]["count"] == receipt["retained"]["count"] + receipt["entered"]["count"],
    "selected receipt count is not retained plus entered",
)
require(
    receipt["previous"]["count"] == receipt["retained"]["count"] + receipt["exited"]["count"],
    "previous receipt count is not retained plus exited",
)

present = ids != 66
missing_previous = MODULE.select_optical_hysteresis(
    ids[present],
    coefficients[present],
    3,
    previous_ids,
    hysteresis_ratio=0.1,
)
require(
    66 not in set(ids[present][missing_previous].tolist()),
    "hysteretic selector retained a node absent from the current state",
)

try:
    MODULE.select_optical_hysteresis(
        ids,
        coefficients,
        3,
        np.asarray([3, 3, 55], dtype=np.uint32),
        hysteresis_ratio=0.1,
    )
except ValueError:
    pass
else:
    raise AssertionError("duplicate prior native IDs double-spent hysteretic membership")

try:
    MODULE.select_optical_hysteresis(
        np.asarray([1, 1, 2], dtype=np.uint32),
        np.ones((3, 8), dtype=np.float32),
        2,
        np.asarray([1], dtype=np.uint32),
        hysteresis_ratio=0.1,
        receipt={},
    )
except ValueError:
    pass
else:
    raise AssertionError("direct hysteretic selection accepted duplicate current native IDs")

try:
    MODULE.fixed_budget_selections(
        np.asarray([1, 1, 2], dtype=np.uint32),
        np.zeros((3, 8), dtype=np.float32),
        2.0 / 3.0,
        previous_optical_ids=np.asarray([1], dtype=np.uint32),
    )
except ValueError:
    pass
else:
    raise AssertionError("duplicate native IDs double-spent the exact candidate budget")

selection_receipts = {}
MODULE.fixed_budget_selections(
    ids,
    coefficients,
    3.0 / ids.size,
    previous_optical_ids=previous_ids,
    hysteresis_ratio=0.1,
    selection_receipts=selection_receipts,
)
require(selection_receipts["stable-uniform"]["authority"] == MODULE.UNIFORM_AUTHORITY, "uniform receipt authority drifted")
require(selection_receipts["optical-energy"]["authority"] == MODULE.SELECTION_AUTHORITY, "optical receipt authority drifted")
require(selection_receipts["optical-hysteresis"]["authority"] == MODULE.HYSTERESIS_AUTHORITY, "hysteresis receipt authority drifted")
require(
    {"previous", "selected", "retained", "entered", "exited"} <= set(selection_receipts["optical-hysteresis"]),
    "hysteresis receipt lost set accounting",
)

policies = ["stable-uniform", "optical-energy", "optical-hysteresis"]
complete_transition = {
    "fromStateId": "a",
    "toStateId": "b",
    "stepDelta": 2,
    "nodeIdentityTurnover": {
        "previousNodeCount": 3,
        "currentNodeCount": 3,
        "sharedNodeCount": 2,
        "enteredNodeCount": 1,
        "exitedNodeCount": 1,
        "unionNodeCount": 4,
        "jaccard": 0.5,
        "turnoverFraction": 0.5,
    },
    "multiplicityChurn": {
        "depositRule": "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0",
        "maximumDepositsPerCandidate": 20,
        "previousActualInBoundsPositiveWeightDepositCount": 40,
        "currentActualInBoundsPositiveWeightDepositCount": 39,
        "sharedNodeCount": 2,
        "sharedNodesWithChangedMultiplicity": 1,
        "meanAbsoluteSharedNodeDepositDelta": 0.5,
        "maxAbsoluteSharedNodeDepositDelta": 1,
        "authority": "actual-in-bounds-positive-weight-bilinear-deposit-count-v1",
    },
    "placementVelocity": {
        "sharedNodeCount": 2,
        "sharedVisibleTapCount": 10,
        "mean": 0.4,
        "p50": 0.2,
        "p95": 0.9,
        "max": 1.1,
        "unit": "screen-pixels-per-simulator-step",
        "authority": "matched-native-node-flow-tangent-tap-centers-v0",
    },
    "adjacentFramePixelDiffs": {
        "targetMae": 0.02,
        "renderMae": 0.05,
        "motionDeltaMae": 2.0,
        "errorFieldDeltaMae": 2.0,
    },
}
report_states = [
    {
        "stateId": "a",
        "steps": 10,
        "arms": {
            policy: {
                "selectedRows": 3,
                "candidateBudget": 3,
                "actualInBoundsPositiveWeightDepositCount": 40,
                "depositRule": "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0",
                "maximumDepositsPerCandidate": 20,
            }
            for policy in policies
        },
    },
    {
        "stateId": "b",
        "steps": 12,
        "arms": {
            policy: {
                "selectedRows": 3,
                "candidateBudget": 3,
                "actualInBoundsPositiveWeightDepositCount": 39,
                "depositRule": "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0",
                "maximumDepositsPerCandidate": 20,
            }
            for policy in policies
        },
    },
]
MODULE.validate_adjacent_state_motion(
    report_states,
    {policy: [dict(complete_transition)] for policy in policies},
    policies,
    "sequence",
)
undercounted = {policy: [copy.deepcopy(complete_transition)] for policy in policies}
undercounted["optical-hysteresis"][0]["multiplicityChurn"]["previousActualInBoundsPositiveWeightDepositCount"] = 20
undercounted["optical-hysteresis"][0]["multiplicityChurn"]["currentActualInBoundsPositiveWeightDepositCount"] = 19
try:
    MODULE.validate_adjacent_state_motion(report_states, undercounted, policies, "sequence")
except ValueError:
    pass
else:
    raise AssertionError("internally consistent partial deposit ledger escaped state-arm binding")

partial = {policy: [dict(complete_transition)] for policy in policies}
partial["optical-hysteresis"] = []
try:
    MODULE.validate_adjacent_state_motion(report_states, partial, policies, "sequence")
except ValueError:
    pass
else:
    raise AssertionError("partial hysteresis motion ledger passed the runtime evidence gate")

empty_components = {policy: [dict(complete_transition)] for policy in policies}
empty_components["optical-hysteresis"][0]["placementVelocity"] = {}
try:
    MODULE.validate_adjacent_state_motion(
        report_states,
        empty_components,
        policies,
        "sequence",
    )
except ValueError:
    pass
else:
    raise AssertionError("empty adjacent-state evidence component passed the runtime gate")

wrong_pair = {policy: [dict(complete_transition)] for policy in policies}
wrong_pair["optical-hysteresis"][0]["toStateId"] = "a"
try:
    MODULE.validate_adjacent_state_motion(
        report_states,
        wrong_pair,
        policies,
        "sequence",
    )
except ValueError:
    pass
else:
    raise AssertionError("misrouted adjacent-state pair passed the runtime gate")

nonfinite = {policy: [copy.deepcopy(complete_transition)] for policy in policies}
nonfinite["optical-hysteresis"][0]["adjacentFramePixelDiffs"]["renderMae"] = float("nan")
try:
    MODULE.validate_adjacent_state_motion(
        report_states,
        nonfinite,
        policies,
        "sequence",
    )
except ValueError:
    pass
else:
    raise AssertionError("non-finite adjacent-state image instability passed the runtime gate")

out_of_range_difference = {policy: [copy.deepcopy(complete_transition)] for policy in policies}
out_of_range_difference["optical-hysteresis"][0]["adjacentFramePixelDiffs"]["motionDeltaMae"] = 2.000001
try:
    MODULE.validate_adjacent_state_motion(
        report_states,
        out_of_range_difference,
        policies,
        "sequence",
    )
except ValueError:
    pass
else:
    raise AssertionError("difference-field MAE above its normalized maximum passed the runtime gate")

out_of_range_image = {policy: [copy.deepcopy(complete_transition)] for policy in policies}
out_of_range_image["optical-hysteresis"][0]["adjacentFramePixelDiffs"]["targetMae"] = 1.000001
try:
    MODULE.validate_adjacent_state_motion(
        report_states,
        out_of_range_image,
        policies,
        "sequence",
    )
except ValueError:
    pass
else:
    raise AssertionError("image MAE above its normalized maximum passed the runtime gate")

print("volume layer coefficient hysteresis contracts passed")
