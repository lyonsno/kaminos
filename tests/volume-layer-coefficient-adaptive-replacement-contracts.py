#!/usr/bin/env python3
"""Fail-first contracts for causal per-node quadrature replacement pressure."""

from __future__ import annotations

import ast
import importlib.util
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-budget-oracle.py"
SPEC = importlib.util.spec_from_file_location("kaminos_budget_oracle_adaptive", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
MODULE.np = np
MODULE.LUMA = np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


source_tree = ast.parse(MODULE_PATH.read_text())
for dictionary in (node for node in ast.walk(source_tree) if isinstance(node, ast.Dict)):
    literal_keys = [
        key.value
        for key in dictionary.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    ]
    require(
        len(literal_keys) == len(set(literal_keys)),
        f"evidence dictionary contains duplicate literal keys near line {dictionary.lineno}",
    )


ids = np.asarray([3, 55, 7, 66, 42], dtype=np.uint32)
coefficients = np.zeros((ids.size, 8), dtype=np.float32)
coefficients[:, 0] = np.asarray([8.0, 7.0, 6.1, 4.1, 0.3], dtype=np.float32)
previous_ids = np.asarray([3, 55, 66], dtype=np.uint32)

uninitialized = MODULE.select_optical_adaptive_hysteresis(
    ids,
    coefficients,
    3,
    None,
    None,
    minimum_ratio=0.25,
    maximum_ratio=0.35,
)
require(
    np.array_equal(uninitialized, MODULE.select_optical_energy(ids, coefficients, 3)),
    "first-state adaptive replacement did not initialize from stateless optical",
)

high_survival = np.asarray([0.5, 0.5, 1.0], dtype=np.float32)
receipt = {}
adaptive = MODULE.select_optical_adaptive_hysteresis(
    ids,
    coefficients,
    3,
    previous_ids,
    high_survival,
    minimum_ratio=0.25,
    maximum_ratio=0.35,
    receipt=receipt,
)
require(set(ids[adaptive].tolist()) == {3, 55, 66}, "high predicted survival did not retain the near-boundary node")
require(adaptive.size == 3, "adaptive replacement changed the fixed candidate budget")
require(receipt["minimumRatio"] == 0.25 and receipt["maximumRatio"] == 0.35, "adaptive pressure bounds drifted")
require(receipt["predictionSource"] == "previous-state-causal-native-cell-survival-v0", "prediction authority drifted")
require(receipt["survivalPredictions"]["count"] == previous_ids.size, "prediction receipt lost rows")
require(receipt["effectiveRatioDistribution"]["count"] == previous_ids.size, "adaptive ratio receipt lost prior nodes")
require(
    np.isclose(receipt["effectiveRatioDistribution"]["mean"], 0.25 + 0.1 * float(np.mean(high_survival))),
    "adaptive ratio receipt lost the exact scalar mean",
)
require(
    receipt["matchedMeanRatio"] == receipt["effectiveRatioDistribution"]["mean"],
    "matched-mean scalar control ratio disagrees with adaptive allocation",
)

matched_mean = MODULE.select_optical_hysteresis(
    ids,
    coefficients,
    3,
    previous_ids,
    receipt["matchedMeanRatio"],
)
require(
    set(ids[matched_mean].tolist()) == {3, 7, 55},
    "matched-mean scalar control accidentally preserved the heterogeneous near-boundary survivor",
)

missing_high_ids = np.asarray([3, 55, 7, 42], dtype=np.uint32)
missing_high_coefficients = np.zeros((missing_high_ids.size, 8), dtype=np.float32)
missing_high_coefficients[:, 0] = np.asarray([8.0, 7.0, 6.1, 4.2], dtype=np.float32)
missing_high_receipt = {}
MODULE.select_optical_adaptive_hysteresis(
    missing_high_ids,
    missing_high_coefficients,
    3,
    previous_ids,
    high_survival,
    minimum_ratio=0.25,
    maximum_ratio=0.35,
    receipt=missing_high_receipt,
)
require(
    missing_high_receipt["effectiveRatioDistribution"]["count"] == 2,
    "missing prior IDs contaminated the effective adaptive ratio population",
)
require(
    np.isclose(missing_high_receipt["matchedMeanRatio"], 0.30),
    "missing high-survival prediction contaminated the matched scalar mean",
)
missing_high_scalar = MODULE.select_optical_hysteresis(
    missing_high_ids,
    missing_high_coefficients,
    3,
    np.asarray([3, 55, 42], dtype=np.uint32),
    missing_high_receipt["matchedMeanRatio"],
)
require(
    set(missing_high_ids[missing_high_scalar].tolist()) == {3, 7, 55},
    "stale adaptive identity changed the matched-mean scalar cohort",
)

zero_incumbent_receipt = {}
zero_incumbent = MODULE.select_optical_adaptive_hysteresis(
    missing_high_ids,
    missing_high_coefficients,
    3,
    np.asarray([101, 102], dtype=np.uint32),
    np.asarray([0.0, 1.0], dtype=np.float32),
    minimum_ratio=0.25,
    maximum_ratio=0.35,
    receipt=zero_incumbent_receipt,
)
require(
    np.array_equal(zero_incumbent, MODULE.select_optical_energy(missing_high_ids, missing_high_coefficients, 3)),
    "zero eligible incumbents did not collapse adaptive selection to stateless optical",
)
require(
    zero_incumbent_receipt["effectiveRatioDistribution"]["count"] == 0
    and zero_incumbent_receipt["matchedMeanRatio"] is None,
    "zero-incumbent adaptive pressure falsely reported an effective scalar mean",
)
require(
    zero_incumbent_receipt["initializedFromStatelessOptical"] is True,
    "zero-incumbent adaptive fallback was not identified as stateless optical",
)

fallback_transition = MODULE.native_id_transition_receipt(
    np.asarray([3, 55, 42], dtype=np.uint32),
    np.asarray([3, 55, 7], dtype=np.uint32),
)
require(
    fallback_transition["retained"] == MODULE.native_id_set_receipt(np.asarray([3, 55], dtype=np.uint32)),
    "stateless fallback lost retained identities",
)
require(
    fallback_transition["entered"] == MODULE.native_id_set_receipt(np.asarray([7], dtype=np.uint32)),
    "stateless fallback mislabeled entered identities",
)
require(
    fallback_transition["exited"] == MODULE.native_id_set_receipt(np.asarray([42], dtype=np.uint32)),
    "stateless fallback mislabeled exited identities",
)

low_survival = np.asarray([0.5, 0.5, 0.0], dtype=np.float32)
replaced = MODULE.select_optical_adaptive_hysteresis(
    ids,
    coefficients,
    3,
    previous_ids,
    low_survival,
    minimum_ratio=0.25,
    maximum_ratio=0.35,
)
require(set(ids[replaced].tolist()) == {3, 7, 55}, "low predicted survival did not admit the stronger newcomer")

reversed_rows = MODULE.select_optical_adaptive_hysteresis(
    ids[::-1],
    coefficients[::-1],
    3,
    previous_ids[::-1],
    high_survival[::-1],
    minimum_ratio=0.25,
    maximum_ratio=0.35,
)
require(
    set(ids[::-1][reversed_rows].tolist()) == {3, 55, 66},
    "adaptive replacement depends on current-row or prior-prediction order",
)

invalid_cases = [
    (previous_ids, None, "missing prior survival predictions"),
    (previous_ids, np.asarray([0.5, 0.5], dtype=np.float32), "partial prior survival predictions"),
    (previous_ids, np.asarray([0.5, np.nan, 0.5], dtype=np.float32), "nonfinite prior survival predictions"),
    (previous_ids, np.asarray([0.5, 1.1, 0.5], dtype=np.float32), "out-of-range prior survival predictions"),
    (np.asarray([3, 3, 66], dtype=np.uint32), high_survival, "duplicate prior prediction identities"),
]
for bad_ids, bad_predictions, label in invalid_cases:
    try:
        MODULE.select_optical_adaptive_hysteresis(
            ids,
            coefficients,
            3,
            bad_ids,
            bad_predictions,
            minimum_ratio=0.25,
            maximum_ratio=0.35,
        )
    except ValueError:
        pass
    else:
        raise AssertionError(f"{label} escaped the causal adaptive selector")

try:
    MODULE.select_optical_adaptive_hysteresis(
        ids,
        coefficients,
        3,
        previous_ids,
        high_survival,
        minimum_ratio=0.35,
        maximum_ratio=0.25,
    )
except ValueError:
    pass
else:
    raise AssertionError("reversed adaptive pressure bounds escaped validation")

training_features = np.asarray([
    [-2.0, 0.1],
    [-1.5, -0.2],
    [-1.0, 0.3],
    [-0.5, -0.1],
    [0.5, 0.2],
    [1.0, -0.3],
    [1.5, 0.1],
    [2.0, -0.2],
], dtype=np.float32)
training_labels = np.asarray([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0], dtype=np.float32)
model_receipt = {}
model = MODULE.fit_causal_survival_ridge(
    training_features,
    training_labels,
    ridge_alpha=1e-3,
    receipt=model_receipt,
)
predictions = MODULE.predict_causal_survival_ridge(model, training_features)
require(np.all(predictions[:4] < 0.5), "causal ridge failed to reject synthetic non-survivors")
require(np.all(predictions[4:] > 0.5), "causal ridge failed to retain synthetic survivors")
require(model_receipt["trainingRows"] == training_features.shape[0], "causal ridge receipt lost training rows")
require(model_receipt["featureCount"] == training_features.shape[1], "causal ridge receipt lost feature width")
require(model_receipt["targetAuthority"] == "next-state-stateless-optical-cohort-membership-v0", "causal ridge target authority drifted")

reversed_model = MODULE.fit_causal_survival_ridge(
    training_features[::-1],
    training_labels[::-1],
    ridge_alpha=1e-3,
)
reversed_predictions = MODULE.predict_causal_survival_ridge(reversed_model, training_features)
require(
    np.allclose(predictions, reversed_predictions, rtol=1e-5, atol=1e-6),
    "causal ridge depends materially on training row order",
)

blocked_receipt = {}
blocked_model = MODULE.fit_causal_survival_ridge_blocks(
    (
        pair
        for pair in (
            (training_features[:3], training_labels[:3]),
            (training_features[3:6], training_labels[3:6]),
            (training_features[6:], training_labels[6:]),
        )
    ),
    ridge_alpha=1e-3,
    receipt=blocked_receipt,
)
blocked_predictions = MODULE.predict_causal_survival_ridge(blocked_model, training_features)
require(
    np.allclose(predictions, blocked_predictions, rtol=1e-5, atol=1e-6),
    "blockwise causal ridge drifted from the dense exact fit",
)
require(blocked_receipt["trainingRows"] == training_features.shape[0], "blockwise causal ridge lost training rows")
require(blocked_receipt["trainingBlocks"] == 3, "blockwise causal ridge lost block accounting")
require(blocked_receipt["fitStrategy"] == "iterator-exact-sufficient-statistics-v0", "blockwise causal ridge is not iterator-fed")
require(np.isfinite(blocked_receipt["regularizedConditionNumber"]), "blockwise causal ridge lost numerical conditioning evidence")

invalid_training_cases = [
    (training_features[:, :0], training_labels, "empty causal feature width"),
    (training_features, training_labels[:-1], "partial causal labels"),
    (training_features.copy(), training_labels.copy(), "nonfinite causal features"),
    (training_features, np.asarray([0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.1], dtype=np.float32), "out-of-range causal labels"),
]
invalid_training_cases[2][0][0, 0] = np.nan
for bad_features, bad_labels, label in invalid_training_cases:
    try:
        MODULE.fit_causal_survival_ridge(bad_features, bad_labels, ridge_alpha=1e-3)
    except ValueError:
        pass
    else:
        raise AssertionError(f"{label} escaped causal ridge validation")

split = MODULE.causal_survival_transition_split(
    state_count=12,
    training_transition_count=7,
    calibration_transition_count=1,
)
require(split["trainingTransitionIndices"] == list(range(7)), "causal split training chronology drifted")
require(split["calibrationTransitionIndices"] == [7], "causal split calibration chronology drifted")
require(split["heldTransitionIndices"] == [8, 9, 10], "causal split held chronology drifted")
require(split["heldStateStartIndex"] == 8, "causal split held-state initialization drifted")

source_ids = np.asarray([20, 10, 30], dtype=np.uint32)
destination_ids = np.asarray([30, 20], dtype=np.uint32)
membership = MODULE.native_id_membership_labels(source_ids, destination_ids)
require(np.array_equal(membership, np.asarray([1.0, 0.0, 1.0], dtype=np.float32)), "native survival labels lost source-row alignment")

source_features = np.arange(3 * 24, dtype=np.float32).reshape(3, 24)
source_coefficients = np.arange(3 * 8, dtype=np.float32).reshape(3, 8) / 10.0
source_descriptors = np.asarray([
    [1.0, 2.0, 3.0, 20.0, 0.1, 0.2, 0.3, 0.4],
    [4.0, 5.0, 6.0, 10.0, 0.5, 0.6, 0.7, 0.8],
    [7.0, 8.0, 9.0, 30.0, 0.9, 1.0, 1.1, 1.2],
], dtype=np.float32)
selected_rows = np.asarray([2, 0], dtype=np.int64)
optical_scores = np.asarray([0.8, 0.7, 1.2], dtype=np.float32)
causal_features = MODULE.causal_survival_feature_matrix(
    source_features,
    source_coefficients,
    source_descriptors,
    selected_rows,
    optical_scores,
    entry_threshold=0.6,
)
require(causal_features.shape == (2, 41), "causal local feature width drifted")
require(np.array_equal(causal_features[:, :24], source_features[selected_rows]), "causal source features lost selected-row order")
require(np.array_equal(causal_features[:, 24:32], source_coefficients[selected_rows]), "causal coefficients lost selected-row order")
require(
    np.array_equal(causal_features[:, 32:39], source_descriptors[selected_rows][:, [0, 1, 2, 4, 5, 6, 7]]),
    "causal descriptors included identity or lost local flow channels",
)
require(np.allclose(causal_features[:, 39], optical_scores[selected_rows]), "causal optical score feature drifted")
require(np.allclose(causal_features[:, 40], optical_scores[selected_rows] / 0.6), "causal optical margin feature drifted")

print("volume layer coefficient adaptive replacement contracts passed")
