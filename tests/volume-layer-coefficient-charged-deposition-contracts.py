#!/usr/bin/env python3
"""Fail-first contracts for fixed-five charged bilinear deposition reduction."""

from __future__ import annotations

import copy
import importlib.util
import inspect
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]


def load_module(filename: str, name: str):
    path = ROOT / filename
    specification = importlib.util.spec_from_file_location(name, path)
    assert specification is not None and specification.loader is not None
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


budget = load_module("volume-layer-coefficient-budget-oracle.py", "kaminos_budget_oracle_charged")
budget.initialize_runtime()
render = budget.ORACLE
motion = budget.MOTION


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require(
    hasattr(budget, "CONTRIBUTION_CHARGED_DEPOSITION_POLICY"),
    "the fixed-five charged-deposition policy does not exist",
)
require(
    "contribution_charged_deposition" in inspect.signature(budget.run).parameters,
    "the governed oracle cannot launch charged deposition",
)
require(
    "charged_deposition_neighbor_limit" in inspect.signature(budget.run).parameters,
    "the governed oracle hides the requested charged-neighbor limit",
)
require(
    "bilinear_neighbor_limit" in inspect.signature(render.rasterize_coefficients).parameters,
    "the rasterizer cannot reduce charged bilinear deposition work",
)
require(
    "bilinear_neighbor_limit" in inspect.signature(motion.bilinear_deposit_accounting).parameters,
    "the temporal accounting cannot witness reduced charged work",
)

work_contract = budget.deposition_work_contract(
    [
        budget.CONTRIBUTION_FOOTPRINT_POLICY,
        budget.CONTRIBUTION_CHARGED_DEPOSITION_POLICY,
    ],
    charged_deposition_neighbor_limit=3,
)
require(
    work_contract["maximumDepositsPerCandidateByPolicy"]
    == {
        budget.CONTRIBUTION_FOOTPRINT_POLICY: 20,
        budget.CONTRIBUTION_CHARGED_DEPOSITION_POLICY: 15,
    },
    "charged deposition did not expose the real five-times-three work ceiling",
)
require(
    work_contract["logicalTapsPerCandidate"] == 5,
    "charged deposition changed logical tangent support",
)

camera = {
    "cameraIndex": 0,
    "width": 32,
    "height": 32,
    "cameraPose": {
        "matrixWorldInverse": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
        "projectionMatrix": [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0],
    },
}
positions = np.asarray(
    [
        [-0.217, -0.153, -1.0],
        [0.184, -0.127, -1.0],
        [-0.164, 0.211, -1.0],
        [0.237, 0.193, -1.0],
    ],
    dtype=np.float32,
)
tangents = np.tile(np.asarray([[1.0, 0.0, 0.0]], dtype=np.float32), (4, 1))
features = np.zeros((4, 24), dtype=np.float32)
features[:, 2:4] = 0.5
coefficients = np.zeros((4, 8), dtype=np.float32)
coefficients[:, 0] = np.asarray([1.0, 2.0, 3.0, 4.0], dtype=np.float32)
tap_scales = np.asarray([0.75, 0.6875, 0.625, 1.0], dtype=np.float32)

baseline_planes, baseline_telemetry = render.rasterize_coefficients(
    positions,
    tangents,
    features,
    coefficients,
    camera,
    8,
    "bilinear",
    tap_scales=tap_scales,
)
charged_planes, charged_telemetry = render.rasterize_coefficients(
    positions,
    tangents,
    features,
    coefficients,
    camera,
    8,
    "bilinear",
    tap_scales=tap_scales,
    bilinear_neighbor_limit=3,
)
require(
    baseline_telemetry["nominalTapEvaluations"]
    == charged_telemetry["nominalTapEvaluations"]
    == positions.shape[0] * 5,
    "charged deposition changed five-tap logical work",
)
require(
    charged_telemetry["requestedChargedDepositEvaluations"] == positions.shape[0] * 15,
    "charged deposition hid or misreported requested scatter work",
)
require(
    charged_telemetry["effectivePositiveWeightDepositEvaluations"]
    <= charged_telemetry["requestedChargedDepositEvaluations"],
    "effective charged work exceeded its requested ceiling",
)
require(
    charged_telemetry["requestedChargedDepositEvaluations"]
    < baseline_telemetry["requestedChargedDepositEvaluations"],
    "charged deposition did not reduce work relative to four-neighbor bilinear",
)
require(
    abs(float(np.sum(charged_planes[..., 0])) - float(np.sum(coefficients[:, 0]))) <= 1e-4,
    "charged deposition failed to conserve coefficient mass",
)
require(
    abs(float(np.sum(baseline_planes[..., 0])) - float(np.sum(charged_planes[..., 0]))) <= 1e-4,
    "charged deposition changed total rasterized coefficient mass",
)
require(
    charged_telemetry["quadratureRule"]
    == budget.CONTRIBUTION_CHARGED_DEPOSITION_RULE,
    "charged raster telemetry hid its effective deposition rule",
)
try:
    render.rasterize_coefficients(
        positions,
        tangents,
        features,
        coefficients,
        camera,
        8,
        "bilinear",
        tap_counts=np.full(positions.shape[0], 5, dtype=np.int32),
        tap_patterns=budget.CONTRIBUTION_TAP_PATTERNS,
        bilinear_neighbor_limit=3,
    )
except ValueError as error:
    require(
        "charged bilinear neighbor reduction requires fixed-five tap layout" in str(error),
        "variable-tap reduced-neighbor rejection failed for the wrong reason",
    )
else:
    raise AssertionError("variable-tap rasterization silently published reduced work under a four-neighbor rule")

rows = {
    "kernelDescriptors": np.concatenate(
        (
            positions,
            np.arange(4, dtype=np.float32)[:, None],
            tangents,
            np.ones((4, 1), dtype=np.float32),
        ),
        axis=1,
    ),
    "features": features,
}
placements = motion.flow_tap_placements(rows, camera, tap_scales=tap_scales)
tap_weights = motion.flow_tap_weights(positions.shape[0])
baseline_accounting = motion.bilinear_deposit_accounting(
    placements,
    tap_weights,
    camera["width"],
    camera["height"],
)
charged_accounting = motion.bilinear_deposit_accounting(
    placements,
    tap_weights,
    camera["width"],
    camera["height"],
    bilinear_neighbor_limit=3,
)
require(
    int(np.sum(charged_accounting["requestedChargedDepositEvaluations"], dtype=np.int64))
    == positions.shape[0] * 15,
    "temporal accounting disagrees with requested charged work",
)
require(
    int(np.sum(charged_accounting["actualInBoundsPositiveWeightDeposits"], dtype=np.int64))
    < int(np.sum(baseline_accounting["actualInBoundsPositiveWeightDeposits"], dtype=np.int64)),
    "temporal accounting observed no actual charged-work reduction",
)
require(
    np.all(charged_accounting["actualInBoundsPositiveWeightDeposits"] <= 15),
    "a charged candidate exceeded the five-times-three deposit ceiling",
)
require(
    np.allclose(
        charged_accounting["retainedQuadratureWeightFraction"],
        baseline_accounting["retainedQuadratureWeightFraction"],
        atol=1e-6,
    ),
    "charged accounting failed to preserve in-frame quadrature mass",
)

tie_samples = render.bilinear_pixel_samples(
    np.asarray([0.5], dtype=np.float32),
    np.asarray([0.5], dtype=np.float32),
    bilinear_neighbor_limit=3,
)
tie_weights = np.asarray([float(sample_weight[0]) for _, _, sample_weight in tie_samples])
require(
    np.allclose(tie_weights, np.asarray([1.0 / 3.0, 1.0 / 3.0, 1.0 / 3.0, 0.0]), atol=1e-7),
    "equal bilinear weights did not retain the first three declared neighbors deterministically",
)
tie_accounting = motion.bilinear_deposit_accounting(
    np.asarray([[[0.5, 0.5]]], dtype=np.float32),
    np.asarray([[1.0]], dtype=np.float32),
    1,
    1,
    bilinear_neighbor_limit=3,
)
require(
    tie_accounting["actualInBoundsPositiveWeightDeposits"].tolist() == [1]
    and tie_accounting["outOfFramePositiveWeightDeposits"].tolist() == [2]
    and np.allclose(tie_accounting["retainedQuadratureWeightFraction"], [1.0 / 3.0]),
    "temporal accounting disagrees with deterministic equal-weight tie retention",
)

original_motion = budget.MOTION
original_footprint_plan = budget.contribution_footprint_plan


class GovernedMotionStub:
    DEPTH_BINS = original_motion.DEPTH_BINS

    @staticmethod
    def load_rows(_state, _manifest_path):
        return {
            "features": features,
            "coefficients": coefficients,
            "nativeCellIndices": np.arange(positions.shape[0], dtype=np.uint32),
            "kernelDescriptors": rows["kernelDescriptors"],
        }

    @staticmethod
    def target_image(state, _manifest_path):
        row_grid, column_grid = np.indices((32, 32), dtype=np.uint8)
        offset = int((state.get("replay") or {}).get("completedSteps", 0))
        return np.stack(
            (
                row_grid * 5 + offset,
                column_grid * 7 + offset,
                (row_grid + column_grid) * 3 + offset,
            ),
            axis=2,
        ).astype(np.uint8)

    @staticmethod
    def camera_contract(_state):
        return camera

    flow_tap_placements = staticmethod(original_motion.flow_tap_placements)
    flow_tap_weights = staticmethod(original_motion.flow_tap_weights)
    bilinear_deposit_accounting = staticmethod(original_motion.bilinear_deposit_accounting)
    node_turnover = staticmethod(original_motion.node_turnover)
    multiplicity_churn = staticmethod(original_motion.multiplicity_churn)
    placement_velocity = staticmethod(original_motion.placement_velocity)
    pixel_mae = staticmethod(original_motion.pixel_mae)


def governed_footprint_plan(*_args):
    return tap_scales.copy(), {
        "requestedMinimumFootprintScale": 0.625,
        "effectiveMinimumFootprintScale": 0.625,
    }


try:
    budget.MOTION = GovernedMotionStub
    budget.contribution_footprint_plan = governed_footprint_plan
    governed_states = [
        {"id": "charged-governed-a", "replay": {"completedSteps": 1}},
        {"id": "charged-governed-b", "replay": {"completedSteps": 2}},
    ]
    governed_receipts: list[dict[str, dict]] = []
    governed_temporal: dict[str, list[dict]] = {
        budget.CONTRIBUTION_FOOTPRINT_POLICY: [],
        budget.CONTRIBUTION_CHARGED_DEPOSITION_POLICY: [],
    }
    with tempfile.TemporaryDirectory() as temporary_directory:
        images_dir = Path(temporary_directory)
        for state in governed_states:
            state_receipts: dict[str, dict] = {}
            for policy in governed_temporal:
                receipt, temporal = budget.selected_state(
                    state,
                    Path("unused-manifest.json"),
                    np.arange(positions.shape[0], dtype=np.int64),
                    1.0,
                    policy,
                    images_dir,
                    0.625,
                    charged_deposition_neighbor_limit=3,
                )
                state_receipts[policy] = receipt
                governed_temporal[policy].append(temporal)
            governed_receipts.append(state_receipts)
    for state_index in range(2):
        control = governed_receipts[state_index][budget.CONTRIBUTION_FOOTPRINT_POLICY]
        treatment = governed_receipts[state_index][budget.CONTRIBUTION_CHARGED_DEPOSITION_POLICY]
        require(control["selectedRows"] == treatment["selectedRows"] == positions.shape[0], "governed treatment changed candidate membership")
        require(control["nominalTapEvaluationBudget"] == treatment["nominalTapEvaluationBudget"] == positions.shape[0] * 5, "governed treatment changed logical tap work")
        require(control["requestedChargedDepositEvaluationBudget"] == positions.shape[0] * 20, "governed control hid four-neighbor work")
        require(treatment["requestedChargedDepositEvaluationBudget"] == positions.shape[0] * 15, "governed treatment hid three-neighbor work")
        require(treatment["depositRule"] == treatment["rasterTelemetry"]["quadratureRule"] == budget.CONTRIBUTION_CHARGED_DEPOSITION_RULE, "governed treatment published contradictory rule identities")
    report_states = [
        {
            "stateId": governed_states[index]["id"],
            "steps": governed_states[index]["replay"]["completedSteps"],
            "arms": governed_receipts[index],
        }
        for index in range(2)
    ]
    adjacent = {
        policy: [budget.adjacent_motion_receipt(temporal_rows[0], temporal_rows[1])]
        for policy, temporal_rows in governed_temporal.items()
    }
    budget.validate_adjacent_state_motion(
        report_states,
        adjacent,
        list(governed_temporal),
        "sequence",
    )
    contradictory_states = copy.deepcopy(report_states)
    contradictory_states[1]["arms"][budget.CONTRIBUTION_CHARGED_DEPOSITION_POLICY]["rasterTelemetry"]["requestedChargedDepositEvaluations"] += 1
    try:
        budget.validate_adjacent_state_motion(
            contradictory_states,
            adjacent,
            list(governed_temporal),
            "sequence",
        )
    except ValueError as error:
        require("requested charged work receipt disagrees" in str(error), "adjacent witness failed for the wrong reason")
    else:
        raise AssertionError("adjacent witness accepted contradictory charged-work receipts")
finally:
    budget.MOTION = original_motion
    budget.contribution_footprint_plan = original_footprint_plan

for invalid_limit in (0, 5, -1, True):
    try:
        render.rasterize_coefficients(
            positions,
            tangents,
            features,
            coefficients,
            camera,
            8,
            "bilinear",
            tap_scales=tap_scales,
            bilinear_neighbor_limit=invalid_limit,
        )
    except ValueError as error:
        require("bilinear neighbor limit must be an integer in [1,4]" in str(error), "invalid limit failed for the wrong reason")
    else:
        raise AssertionError(f"invalid charged neighbor limit was silently accepted: {invalid_limit}")

for governed_limit in (1, 2, 4, True):
    try:
        budget.deposition_work_contract(
            [budget.CONTRIBUTION_CHARGED_DEPOSITION_POLICY],
            charged_deposition_neighbor_limit=governed_limit,
        )
    except ValueError as error:
        require("requires exactly three bilinear neighbors" in str(error), "governed limit failed for the wrong reason")
    else:
        raise AssertionError(f"governed charged deposition accepted a non-three limit: {governed_limit}")

print("volume layer coefficient charged deposition contracts passed")
