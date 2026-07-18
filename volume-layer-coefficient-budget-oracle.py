#!/usr/bin/env python3
"""Compare causal fixed-budget quadrature cohorts on exact adjacent states."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import math
import os
import shutil
import traceback
import types
from collections.abc import Iterable
from pathlib import Path
from typing import Any

REPORT_SCHEMA = "kaminos.volume.layer-coefficient-budget-oracle.v0"
MANIFEST_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0"
MOTION_REPORT_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-render.v0"
SELECTION_AUTHORITY = "camera-independent-exact-local-optical-coefficient-selection-v0"
HYSTERESIS_AUTHORITY = "prior-native-cell-membership-schmitt-admission-v0"
ADAPTIVE_HYSTERESIS_AUTHORITY = "previous-state-causal-survival-adaptive-schmitt-admission-v0"
ADAPTIVE_PREDICTION_SOURCE = "previous-state-causal-native-cell-survival-v0"
CAUSAL_SURVIVAL_MODEL_AUTHORITY = "standardized-ridge-native-cell-survival-v0"
CAUSAL_SURVIVAL_TARGET_AUTHORITY = "next-state-stateless-optical-cohort-membership-v0"
CAUSAL_SURVIVAL_FEATURE_AUTHORITY = "previous-state-local-features-coefficients-flow-optical-margin-v0"
CAUSAL_SURVIVAL_FEATURE_COUNT = 41
UNIFORM_AUTHORITY = "camera-independent-native-cell-hash-uniform-selection-v0"
COMPARISON_AUTHORITY = "fixed-candidate-budget-matched-policy-comparator-v0"
DEPOSITS_PER_CANDIDATE = 20
FLOW_TAPS_PER_CANDIDATE = 5
CONTRIBUTION_DEPOSITION_POLICY = "optical-hysteresis-adaptive-mean-contribution-deposition"
CONTRIBUTION_DEPOSIT_RULE = "quota-balanced-variable-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0"
CONTRIBUTION_FOOTPRINT_POLICY = "optical-hysteresis-adaptive-mean-contribution-footprint"
CONTRIBUTION_FOOTPRINT_DEPOSIT_RULE = "contribution-ranked-five-flow-taps-variable-footprint-times-four-bilinear-neighbors-clipped-to-frame-v0"
CONTRIBUTION_FOOTPRINT_MINIMUM_SCALE = 0.75
CONTRIBUTION_SCORE_AUTHORITY = "local-emission-divided-by-one-plus-local-extinction-v0"
CONTRIBUTION_QUOTA_AUTHORITY = "projected-eight-by-eight-screen-times-eight-depth-quota-v0"
CONTRIBUTION_TAP_PATTERNS = {
    3: {
        "offsets": (-1.0, 0.0, 1.0),
        "weights": (0.2, 0.6, 0.2),
        "slots": (0, 3, 6),
    },
    5: {
        "offsets": (-1.0, -0.5, 0.0, 0.5, 1.0),
        "weights": (0.075, 0.225, 0.4, 0.225, 0.075),
        "slots": (0, 1, 3, 5, 6),
    },
    7: {
        "offsets": (-0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 0.75),
        "weights": (0.04, 0.11, 0.22, 0.26, 0.22, 0.11, 0.04),
        "slots": (0, 1, 2, 3, 4, 5, 6),
    },
}
CONTRIBUTION_MAXIMUM_DEPOSITS_PER_CANDIDATE = max(CONTRIBUTION_TAP_PATTERNS) * 4
np: Any = None
ORACLE: Any = None
MOTION: Any = None
LUMA: Any = None
BOUND_IMPLEMENTATION_PAYLOADS: dict[str, bytes] | None = globals().get("BOUND_IMPLEMENTATION_PAYLOADS")
BOUND_SELF_EXECUTION = bool(globals().get("BOUND_SELF_EXECUTION", False))
IMPLEMENTATION_PATH = Path(__file__).resolve()
IMPLEMENTATION_FILENAMES = (
    "volume-layer-coefficient-budget-oracle.py",
    "volume-layer-coefficient-render-oracle.py",
    "volume-layer-coefficient-bilinear-motion-render.py",
)


def invalidate_visual_evidence(out_dir: Path) -> None:
    viewer_path = out_dir / "selection-viewer.html"
    if viewer_path.exists():
        viewer_path.unlink()
    for directory_name in ("images", "states"):
        generated_dir = out_dir / directory_name
        if generated_dir.exists():
            shutil.rmtree(generated_dir)


def write_failed_visual_tombstone(out_dir: Path, failure: dict[str, Any]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "selection-viewer.html").write_text(
        "<!doctype html><html><head><meta charset=\"utf-8\"><title>Evidence failed</title></head>"
        "<body><h1>FAILED — visual evidence is not authoritative</h1><pre>"
        + json.dumps(
            {
                "status": "failed",
                "failurePhase": failure.get("failurePhase"),
                "reason": failure.get("reason"),
            },
            indent=2,
        )
        + "</pre></body></html>"
    )


def load_module(filename: str, name: str) -> Any:
    path = Path(__file__).with_name(filename)
    if BOUND_IMPLEMENTATION_PAYLOADS is not None:
        if filename not in BOUND_IMPLEMENTATION_PAYLOADS:
            raise RuntimeError(f"bound implementation bundle omitted {filename}")
        module = types.ModuleType(name)
        module.__file__ = str(path)
        module.__package__ = ""
        if filename == "volume-layer-coefficient-bilinear-motion-render.py":
            if ORACLE is None:
                raise RuntimeError("bound motion runtime requires the already-bound render oracle")
            module.__dict__["BOUND_ORACLE"] = ORACLE
        exec(compile(BOUND_IMPLEMENTATION_PAYLOADS[filename], str(path), "exec"), module.__dict__)
        return module
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_bound_budget_module(payloads: dict[str, bytes]) -> Any:
    require(set(payloads) == set(IMPLEMENTATION_FILENAMES), "bound budget runtime payload set drifted")
    module = types.ModuleType("kaminos_bound_budget_oracle")
    module.__file__ = str(IMPLEMENTATION_PATH)
    module.__dict__["BOUND_IMPLEMENTATION_PAYLOADS"] = payloads
    module.__dict__["BOUND_SELF_EXECUTION"] = True
    payload = payloads[IMPLEMENTATION_PATH.name]
    exec(compile(payload, str(IMPLEMENTATION_PATH), "exec"), module.__dict__)
    return module


def initialize_runtime() -> None:
    global np, ORACLE, MOTION, LUMA
    if os.environ.get("KAMINOS_BUDGET_ORACLE_FAIL_RUNTIME_INIT") == "1":
        raise RuntimeError("forced runtime initialization failure")
    if np is not None:
        return
    np = importlib.import_module("numpy")
    ORACLE = load_module("volume-layer-coefficient-render-oracle.py", "kaminos_coefficient_oracle")
    MOTION = load_module("volume-layer-coefficient-bilinear-motion-render.py", "kaminos_bilinear_motion")
    LUMA = np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def deposition_work_contract(policies: Iterable[str]) -> dict[str, Any]:
    policy_rows = list(policies)
    require(policy_rows and len(set(policy_rows)) == len(policy_rows), "deposition policies must be nonempty and unique")
    maxima = {
        policy: (
            CONTRIBUTION_MAXIMUM_DEPOSITS_PER_CANDIDATE
            if policy == CONTRIBUTION_DEPOSITION_POLICY
            else DEPOSITS_PER_CANDIDATE
        )
        for policy in policy_rows
    }
    return {
        "nominalDepositsPerCandidate": DEPOSITS_PER_CANDIDATE,
        "maximumDepositsPerCandidate": max(maxima.values()),
        "maximumDepositsPerCandidateByPolicy": maxima,
        "contributionDepositionCouplesTapCountAndFootprintSpacing": CONTRIBUTION_DEPOSITION_POLICY in maxima,
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def capture_implementation_bundle() -> tuple[dict[str, Any], dict[str, bytes]]:
    digest = hashlib.sha256()
    files: dict[str, dict[str, Any]] = {}
    payloads: dict[str, bytes] = BOUND_IMPLEMENTATION_PAYLOADS if BOUND_IMPLEMENTATION_PAYLOADS is not None else {}
    for filename in IMPLEMENTATION_FILENAMES:
        path = IMPLEMENTATION_PATH.with_name(filename)
        if BOUND_IMPLEMENTATION_PAYLOADS is None:
            payload = path.read_bytes()
            payloads[filename] = payload
        else:
            require(filename in BOUND_IMPLEMENTATION_PAYLOADS, f"bound implementation payload is missing {filename}")
            payload = BOUND_IMPLEMENTATION_PAYLOADS[filename]
        file_sha256 = hashlib.sha256(payload).hexdigest()
        encoded_name = filename.encode("utf-8")
        digest.update(len(encoded_name).to_bytes(4, "little"))
        digest.update(encoded_name)
        digest.update(len(payload).to_bytes(8, "little"))
        digest.update(payload)
        files[filename] = {
            "path": str(path),
            "bytes": len(payload),
            "sha256": file_sha256,
        }
    receipt = {
        "authority": "sha256-length-delimited-three-file-python-runtime-bundle-v0",
        "payloadSource": "captured-bound-execution" if BOUND_IMPLEMENTATION_PAYLOADS is not None else "mutable-filesystem-capture",
        "sha256": digest.hexdigest(),
        "files": files,
    }
    return receipt, payloads


def implementation_bundle_receipt() -> dict[str, Any]:
    receipt, _ = capture_implementation_bundle()
    return receipt


def load_json_binding(path: Path) -> tuple[dict[str, Any], str]:
    payload = path.read_bytes()
    return json.loads(payload), hashlib.sha256(payload).hexdigest()


def require_unchanged_binding(path: Path, expected_sha256: str) -> None:
    require(sha256_file(path) == expected_sha256, f"source changed after binding: {path}")


def validate_source_contract(
    manifest: dict[str, Any],
    motion_report: dict[str, Any],
    manifest_sha256: str,
) -> None:
    require(manifest.get("schema") == MANIFEST_SCHEMA, f"manifest schema must be {MANIFEST_SCHEMA}")
    require(motion_report.get("schema") == MOTION_REPORT_SCHEMA, f"motion report schema must be {MOTION_REPORT_SCHEMA}")
    require(motion_report.get("status") == "complete", "motion report is not complete")
    require((motion_report.get("source") or {}).get("manifestSha256") == manifest_sha256, "motion report does not bind this manifest")
    require((manifest.get("sequence") or {}).get("sampleCap") is None, "source corpus applied a hidden sample cap")
    require((manifest.get("sequence") or {}).get("droppedRowCount") == 0, "source corpus dropped candidates")


def stable_hash(values: np.ndarray) -> np.ndarray:
    mixed = values.astype(np.uint64, copy=True)
    mixed ^= mixed >> np.uint64(16)
    mixed *= np.uint64(0x7FEB352D)
    mixed &= np.uint64(0xFFFFFFFF)
    mixed ^= mixed >> np.uint64(15)
    mixed *= np.uint64(0x846CA68B)
    mixed &= np.uint64(0xFFFFFFFF)
    mixed ^= mixed >> np.uint64(16)
    return mixed.astype(np.uint32)


def native_id_sha256(native_ids: np.ndarray) -> str:
    ordered = np.sort(np.asarray(native_ids, dtype="<u4"))
    return hashlib.sha256(ordered.tobytes()).hexdigest()


def native_id_set_receipt(native_ids: np.ndarray) -> dict[str, Any]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    return {
        "count": int(ids.size),
        "distinctCount": int(np.unique(ids).size),
        "sha256": native_id_sha256(ids),
    }


def native_id_transition_receipt(previous_ids: np.ndarray, selected_ids: np.ndarray) -> dict[str, Any]:
    previous = np.asarray(previous_ids, dtype=np.uint32)
    selected = np.asarray(selected_ids, dtype=np.uint32)
    require(previous.ndim == 1 and selected.ndim == 1, "native-ID transition inputs must be one-dimensional")
    require(np.unique(previous).size == previous.size, "previous native-ID transition identities must be unique")
    require(np.unique(selected).size == selected.size, "selected native-ID transition identities must be unique")
    retained = np.intersect1d(selected, previous, assume_unique=True)
    entered = np.setdiff1d(selected, previous, assume_unique=True)
    exited = np.setdiff1d(previous, selected, assume_unique=True)
    return {
        "previous": native_id_set_receipt(previous),
        "selected": native_id_set_receipt(selected),
        "retained": native_id_set_receipt(retained),
        "entered": native_id_set_receipt(entered),
        "exited": native_id_set_receipt(exited),
    }


def native_id_float_receipt(native_ids: np.ndarray, values: np.ndarray) -> dict[str, Any]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    floats = np.asarray(values, dtype=np.float32)
    require(ids.ndim == 1 and floats.ndim == 1, "native-ID float receipt inputs must be one-dimensional")
    require(ids.size == floats.size, "native-ID float receipt row population drifted")
    require(np.unique(ids).size == ids.size, "native-ID float receipt identities must be unique")
    require(np.all(np.isfinite(floats)), "native-ID float receipt values must be finite")
    order = np.argsort(ids, kind="stable")
    ordered_ids = np.asarray(ids[order], dtype="<u4")
    ordered_floats = np.asarray(floats[order], dtype="<f4")
    payload = np.asarray([ids.size], dtype="<u8").tobytes() + ordered_ids.tobytes() + ordered_floats.tobytes()
    return {
        "count": int(ids.size),
        "distinctCount": int(np.unique(ids).size),
        "sha256": hashlib.sha256(payload).hexdigest(),
    }


def fit_causal_survival_ridge(
    features: np.ndarray,
    labels: np.ndarray,
    ridge_alpha: float,
    receipt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    feature_matrix = np.asarray(features, dtype=np.float64)
    target = np.asarray(labels, dtype=np.float64)
    require(feature_matrix.ndim == 2, "causal survival features must be a matrix")
    require(feature_matrix.shape[0] > 0 and feature_matrix.shape[1] > 0, "causal survival features must be nonempty")
    require(target.ndim == 1 and target.size == feature_matrix.shape[0], "causal survival labels must match feature rows")
    require(np.all(np.isfinite(feature_matrix)), "causal survival features must be finite")
    require(np.all(np.isfinite(target)), "causal survival labels must be finite")
    require(np.all((target >= 0.0) & (target <= 1.0)), "causal survival labels must be in [0,1]")
    require(math.isfinite(ridge_alpha) and ridge_alpha > 0.0, "causal survival ridge alpha must be positive and finite")

    feature_mean = np.mean(feature_matrix, axis=0, dtype=np.float64)
    feature_scale = np.std(feature_matrix, axis=0, dtype=np.float64)
    feature_scale = np.where(feature_scale > 1e-8, feature_scale, 1.0)
    normalized = (feature_matrix - feature_mean) / feature_scale
    design = np.concatenate((np.ones((normalized.shape[0], 1), dtype=np.float64), normalized), axis=1)
    gram = design.T @ design / design.shape[0]
    right_hand_side = design.T @ target / design.shape[0]
    regularization = np.eye(design.shape[1], dtype=np.float64) * ridge_alpha
    regularization[0, 0] = 0.0
    parameters = np.linalg.solve(gram + regularization, right_hand_side)
    model = {
        "authority": CAUSAL_SURVIVAL_MODEL_AUTHORITY,
        "targetAuthority": CAUSAL_SURVIVAL_TARGET_AUTHORITY,
        "ridgeAlpha": float(ridge_alpha),
        "featureMean": feature_mean.astype(np.float32),
        "featureScale": feature_scale.astype(np.float32),
        "intercept": float(parameters[0]),
        "weights": parameters[1:].astype(np.float32),
    }
    if receipt is not None:
        model_payload = (
            np.asarray(model["featureMean"], dtype="<f4").tobytes()
            + np.asarray(model["featureScale"], dtype="<f4").tobytes()
            + np.asarray([model["intercept"]], dtype="<f8").tobytes()
            + np.asarray(model["weights"], dtype="<f4").tobytes()
        )
        receipt.update({
            "authority": CAUSAL_SURVIVAL_MODEL_AUTHORITY,
            "targetAuthority": CAUSAL_SURVIVAL_TARGET_AUTHORITY,
            "trainingRows": int(feature_matrix.shape[0]),
            "featureCount": int(feature_matrix.shape[1]),
            "positiveFraction": float(np.mean(target)),
            "ridgeAlpha": float(ridge_alpha),
            "modelSha256": hashlib.sha256(model_payload).hexdigest(),
        })
    return model


def fit_causal_survival_ridge_blocks(
    blocks: Iterable[tuple[np.ndarray, np.ndarray]],
    ridge_alpha: float,
    receipt: dict[str, Any] | None = None,
) -> dict[str, Any]:
    require(math.isfinite(ridge_alpha) and ridge_alpha > 0.0, "causal survival ridge alpha must be positive and finite")

    row_count = 0
    block_count = 0
    feature_count: int | None = None
    feature_sum: np.ndarray | None = None
    feature_square_sum: np.ndarray | None = None
    feature_cross: np.ndarray | None = None
    feature_target_cross: np.ndarray | None = None
    target_sum = 0.0
    for block_index, block in enumerate(blocks):
        require(isinstance(block, tuple) and len(block) == 2, f"causal survival block {block_index} must be a feature-label pair")
        features, labels = block
        feature_matrix = np.asarray(features, dtype=np.float64)
        target = np.asarray(labels, dtype=np.float64)
        require(feature_matrix.ndim == 2 and feature_matrix.shape[0] > 0 and feature_matrix.shape[1] > 0, f"causal survival feature block {block_index} must be a nonempty matrix")
        require(target.ndim == 1 and target.size == feature_matrix.shape[0], f"causal survival label block {block_index} must match feature rows")
        require(np.all(np.isfinite(feature_matrix)), f"causal survival feature block {block_index} must be finite")
        require(np.all(np.isfinite(target)), f"causal survival label block {block_index} must be finite")
        require(np.all((target >= 0.0) & (target <= 1.0)), f"causal survival label block {block_index} must be in [0,1]")
        if feature_count is None:
            feature_count = int(feature_matrix.shape[1])
            feature_sum = np.zeros(feature_count, dtype=np.float64)
            feature_square_sum = np.zeros(feature_count, dtype=np.float64)
            feature_cross = np.zeros((feature_count, feature_count), dtype=np.float64)
            feature_target_cross = np.zeros(feature_count, dtype=np.float64)
        require(feature_matrix.shape[1] == feature_count, "blockwise causal survival feature widths drifted")
        require(
            feature_sum is not None
            and feature_square_sum is not None
            and feature_cross is not None
            and feature_target_cross is not None,
            "blockwise causal survival accumulators are missing",
        )
        block_count += 1
        row_count += int(feature_matrix.shape[0])
        feature_sum += np.sum(feature_matrix, axis=0, dtype=np.float64)
        feature_square_sum += np.einsum("ij,ij->j", feature_matrix, feature_matrix, dtype=np.float64)
        feature_cross += feature_matrix.T @ feature_matrix
        feature_target_cross += feature_matrix.T @ target
        target_sum += float(np.sum(target, dtype=np.float64))
        del feature_matrix, target, features, labels, block

    require(
        row_count > 0
        and feature_count is not None
        and feature_sum is not None
        and feature_square_sum is not None
        and feature_cross is not None
        and feature_target_cross is not None,
        "blockwise causal survival fit accumulated no rows",
    )
    feature_mean = feature_sum / row_count
    feature_variance = np.maximum(feature_square_sum / row_count - feature_mean * feature_mean, 0.0)
    feature_scale = np.sqrt(feature_variance)
    feature_scale = np.where(feature_scale > 1e-8, feature_scale, 1.0)
    normalized_cross = (
        feature_cross - np.outer(feature_sum, feature_sum) / row_count
    ) / (row_count * np.outer(feature_scale, feature_scale))
    normalized_target_cross = (
        feature_target_cross - feature_mean * target_sum
    ) / (row_count * feature_scale)
    design_gram = np.zeros((feature_count + 1, feature_count + 1), dtype=np.float64)
    design_gram[0, 0] = 1.0
    design_gram[1:, 1:] = normalized_cross
    right_hand_side = np.concatenate((
        np.asarray([target_sum / row_count], dtype=np.float64),
        normalized_target_cross,
    ))
    regularization = np.eye(feature_count + 1, dtype=np.float64) * ridge_alpha
    regularization[0, 0] = 0.0
    regularized_gram = design_gram + regularization
    regularized_condition_number = float(np.linalg.cond(regularized_gram))
    require(math.isfinite(regularized_condition_number), "causal survival regularized condition number is nonfinite")
    parameters = np.linalg.solve(regularized_gram, right_hand_side)
    model = {
        "authority": CAUSAL_SURVIVAL_MODEL_AUTHORITY,
        "targetAuthority": CAUSAL_SURVIVAL_TARGET_AUTHORITY,
        "ridgeAlpha": float(ridge_alpha),
        "featureMean": feature_mean.astype(np.float32),
        "featureScale": feature_scale.astype(np.float32),
        "intercept": float(parameters[0]),
        "weights": parameters[1:].astype(np.float32),
    }
    if receipt is not None:
        model_payload = (
            np.asarray(model["featureMean"], dtype="<f4").tobytes()
            + np.asarray(model["featureScale"], dtype="<f4").tobytes()
            + np.asarray([model["intercept"]], dtype="<f8").tobytes()
            + np.asarray(model["weights"], dtype="<f4").tobytes()
        )
        receipt.update({
            "authority": CAUSAL_SURVIVAL_MODEL_AUTHORITY,
            "targetAuthority": CAUSAL_SURVIVAL_TARGET_AUTHORITY,
            "trainingRows": row_count,
            "trainingBlocks": block_count,
            "featureCount": feature_count,
            "positiveFraction": float(target_sum / row_count),
            "ridgeAlpha": float(ridge_alpha),
            "fitStrategy": "iterator-exact-sufficient-statistics-v0",
            "regularizedConditionNumber": regularized_condition_number,
            "modelSha256": hashlib.sha256(model_payload).hexdigest(),
        })
    return model


def predict_causal_survival_ridge(model: dict[str, Any], features: np.ndarray) -> np.ndarray:
    require(model.get("authority") == CAUSAL_SURVIVAL_MODEL_AUTHORITY, "causal survival model authority drifted")
    require(model.get("targetAuthority") == CAUSAL_SURVIVAL_TARGET_AUTHORITY, "causal survival model target authority drifted")
    feature_matrix = np.asarray(features, dtype=np.float64)
    feature_mean = np.asarray(model.get("featureMean"), dtype=np.float64)
    feature_scale = np.asarray(model.get("featureScale"), dtype=np.float64)
    weights = np.asarray(model.get("weights"), dtype=np.float64)
    require(feature_matrix.ndim == 2, "causal survival prediction features must be a matrix")
    require(feature_mean.ndim == feature_scale.ndim == weights.ndim == 1, "causal survival model vectors must be one-dimensional")
    require(feature_matrix.shape[1] == feature_mean.size == feature_scale.size == weights.size, "causal survival prediction feature width drifted")
    require(np.all(np.isfinite(feature_matrix)), "causal survival prediction features must be finite")
    require(np.all(np.isfinite(feature_mean)) and np.all(np.isfinite(feature_scale)), "causal survival normalization is nonfinite")
    require(np.all(feature_scale > 0.0) and np.all(np.isfinite(weights)), "causal survival model parameters are invalid")
    intercept = float(model.get("intercept"))
    require(math.isfinite(intercept), "causal survival model intercept is nonfinite")
    prediction = intercept + ((feature_matrix - feature_mean) / feature_scale) @ weights
    return np.clip(prediction, 0.0, 1.0).astype(np.float32)


def causal_survival_transition_split(
    state_count: int,
    training_transition_count: int,
    calibration_transition_count: int,
) -> dict[str, Any]:
    require(isinstance(state_count, int) and state_count >= 4, "causal survival split requires at least four states")
    transition_count = state_count - 1
    require(
        isinstance(training_transition_count, int) and training_transition_count > 0,
        "causal survival split requires positive training transitions",
    )
    require(
        isinstance(calibration_transition_count, int) and calibration_transition_count >= 0,
        "causal survival calibration transition count must be nonnegative",
    )
    held_start = training_transition_count + calibration_transition_count
    require(held_start < transition_count, "causal survival split must preserve at least one held transition")
    return {
        "trainingTransitionIndices": list(range(training_transition_count)),
        "calibrationTransitionIndices": list(range(training_transition_count, held_start)),
        "heldTransitionIndices": list(range(held_start, transition_count)),
        "heldStateStartIndex": held_start,
    }


def native_id_membership_labels(source_ids: np.ndarray, destination_ids: np.ndarray) -> np.ndarray:
    source = np.asarray(source_ids, dtype=np.uint32)
    destination = np.asarray(destination_ids, dtype=np.uint32)
    require(source.ndim == destination.ndim == 1, "native survival identity cohorts must be one-dimensional")
    require(np.unique(source).size == source.size, "native survival source identities must be unique")
    require(np.unique(destination).size == destination.size, "native survival destination identities must be unique")
    if destination.size == 0:
        return np.zeros(source.size, dtype=np.float32)
    ordered_destination = np.sort(destination)
    positions = np.searchsorted(ordered_destination, source)
    present = positions < ordered_destination.size
    matched_positions = np.minimum(positions, ordered_destination.size - 1)
    present &= ordered_destination[matched_positions] == source
    return present.astype(np.float32)


def causal_survival_feature_matrix(
    source_features: np.ndarray,
    source_coefficients: np.ndarray,
    source_descriptors: np.ndarray,
    selected_rows: np.ndarray,
    optical_scores: np.ndarray,
    entry_threshold: float,
) -> np.ndarray:
    features = np.asarray(source_features)
    coefficients = np.asarray(source_coefficients)
    descriptors = np.asarray(source_descriptors)
    rows = np.asarray(selected_rows, dtype=np.int64)
    scores = np.asarray(optical_scores)
    require(features.ndim == 2 and features.shape[1] == 24, "causal source features must have shape [rows,24]")
    require(coefficients.ndim == 2 and coefficients.shape == (features.shape[0], 8), "causal source coefficients must have shape [rows,8]")
    require(descriptors.ndim == 2 and descriptors.shape == (features.shape[0], 8), "causal source descriptors must have shape [rows,8]")
    require(scores.ndim == 1 and scores.size == features.shape[0], "causal optical scores must match source rows")
    require(rows.ndim == 1 and np.unique(rows).size == rows.size, "causal selected rows must be a unique vector")
    require(np.all((rows >= 0) & (rows < features.shape[0])), "causal selected rows exceed the source population")
    require(math.isfinite(entry_threshold) and entry_threshold > 0.0, "causal optical entry threshold must be positive and finite")
    descriptor_columns = np.asarray([0, 1, 2, 4, 5, 6, 7], dtype=np.int64)
    selected_scores = np.asarray(scores[rows], dtype=np.float32)
    matrix = np.concatenate((
        np.asarray(features[rows], dtype=np.float32),
        np.asarray(coefficients[rows], dtype=np.float32),
        np.asarray(descriptors[rows][:, descriptor_columns], dtype=np.float32),
        selected_scores[:, None],
        (selected_scores / entry_threshold)[:, None],
    ), axis=1)
    require(matrix.shape == (rows.size, CAUSAL_SURVIVAL_FEATURE_COUNT), "causal survival feature width drifted")
    require(np.all(np.isfinite(matrix)), "causal survival feature matrix is nonfinite")
    return matrix


def select_stable_uniform(native_ids: np.ndarray, budget: int) -> np.ndarray:
    require(0 < budget <= native_ids.size, "stable-uniform budget is outside the candidate population")
    order = np.lexsort((native_ids, stable_hash(native_ids)))
    return np.sort(order[:budget])


def optical_energy_scores(coefficients: np.ndarray) -> np.ndarray:
    require(coefficients.ndim == 2 and coefficients.shape[1] == 8, "optical coefficients must have shape [rows,8]")
    emission = np.maximum(coefficients[:, 0:3] + coefficients[:, 4:7], 0.0) @ LUMA
    extinction = np.maximum(coefficients[:, 3] + coefficients[:, 7], 0.0)
    emission_scale = max(float(np.percentile(emission, 99.0)), 1e-8)
    extinction_scale = max(float(np.percentile(extinction, 99.0)), 1e-8)
    return emission / emission_scale + extinction / extinction_scale


def local_transmitted_emission_scores(coefficients: np.ndarray) -> np.ndarray:
    values = np.asarray(coefficients)
    require(values.ndim == 2 and values.shape[1] == 8, "local contribution coefficients must have shape [rows,8]")
    require(np.all(np.isfinite(values)), "local contribution coefficients must be finite")
    emission = np.maximum(values[:, 0:3] + values[:, 4:7], 0.0) @ LUMA
    extinction = np.maximum(values[:, 3] + values[:, 7], 0.0)
    scores = emission / (1.0 + extinction)
    require(np.all(np.isfinite(scores)) and np.all(scores >= 0.0), "local transmitted-emission scores are invalid")
    return np.asarray(scores, dtype=np.float32)


def quota_balanced_contribution_tap_counts(
    native_ids: np.ndarray,
    contribution_scores: np.ndarray,
    quota_keys: np.ndarray,
) -> np.ndarray:
    ids = np.asarray(native_ids, dtype=np.uint32)
    scores = np.asarray(contribution_scores, dtype=np.float64)
    quotas = np.asarray(quota_keys, dtype=np.int64)
    require(ids.ndim == scores.ndim == quotas.ndim == 1, "contribution allocation inputs must be vectors")
    require(ids.size == scores.size == quotas.size > 0, "contribution allocation row populations must match and be nonempty")
    require(np.unique(ids).size == ids.size, "contribution allocation native identities must be unique")
    require(np.all(np.isfinite(scores)), "contribution allocation scores must be finite")
    counts = np.full(ids.size, FLOW_TAPS_PER_CANDIDATE, dtype=np.int8)
    for quota in np.unique(quotas[quotas >= 0]):
        rows = np.flatnonzero(quotas == quota)
        order = rows[np.lexsort((ids[rows], stable_hash(ids[rows]), -scores[rows]))]
        pair_count = order.size // 2
        counts[order[:pair_count]] = 7
        counts[order[order.size - pair_count:]] = 3
        require(
            int(np.sum(counts[rows], dtype=np.int64)) == rows.size * FLOW_TAPS_PER_CANDIDATE,
            "contribution quota changed its fixed tap budget",
        )
    require(int(np.sum(counts, dtype=np.int64)) == ids.size * FLOW_TAPS_PER_CANDIDATE, "contribution allocation changed total tap work")
    return counts


def quota_balanced_contribution_footprint_scales(
    native_ids: np.ndarray,
    contribution_scores: np.ndarray,
    quota_keys: np.ndarray,
    minimum_scale: float = CONTRIBUTION_FOOTPRINT_MINIMUM_SCALE,
) -> np.ndarray:
    ids = np.asarray(native_ids, dtype=np.uint32)
    scores = np.asarray(contribution_scores, dtype=np.float64)
    quotas = np.asarray(quota_keys, dtype=np.int64)
    require(ids.ndim == scores.ndim == quotas.ndim == 1, "contribution footprint inputs must be vectors")
    require(ids.size == scores.size == quotas.size > 0, "contribution footprint row populations must match and be nonempty")
    require(np.unique(ids).size == ids.size, "contribution footprint native identities must be unique")
    require(np.all(np.isfinite(scores)), "contribution footprint scores must be finite")
    require(math.isfinite(minimum_scale) and 0.0 < minimum_scale <= 1.0, "contribution footprint minimum scale must be finite and in (0,1]")
    scales = np.ones(ids.size, dtype=np.float32)
    for quota in np.unique(quotas[quotas >= 0]):
        rows = np.flatnonzero(quotas == quota)
        order = rows[np.lexsort((ids[rows], stable_hash(ids[rows]), -scores[rows]))]
        if order.size == 1:
            scales[order] = minimum_scale
            continue
        rank = np.arange(order.size, dtype=np.float32) / float(order.size - 1)
        scales[order] = minimum_scale + (
            1.0 - minimum_scale
        ) * rank
    require(
        np.all(np.isfinite(scales))
        and np.all(scales >= minimum_scale)
        and np.all(scales <= 1.0),
        "contribution footprint scales escaped the reviewed range",
    )
    return scales


def contribution_quota_context(
    native_ids: np.ndarray,
    kernel_descriptors: np.ndarray,
    coefficients: np.ndarray,
    camera: dict[str, Any],
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    descriptors = np.asarray(kernel_descriptors)
    values = np.asarray(coefficients)
    require(descriptors.ndim == 2 and descriptors.shape == (ids.size, 8), "contribution descriptors must have shape [rows,8]")
    require(values.ndim == 2 and values.shape == (ids.size, 8), "contribution coefficients must have shape [rows,8]")
    require(np.all(np.isfinite(descriptors)), "contribution descriptors must be finite")
    positions = descriptors[:, 0:3]
    pose = camera["cameraPose"]
    ndc, depth, projected = ORACLE.project(positions, pose["matrixWorldInverse"], pose["projectionMatrix"])
    width, height = int(camera["width"]), int(camera["height"])
    pixel_x = (ndc[:, 0] * 0.5 + 0.5) * width
    pixel_y = (1.0 - (ndc[:, 1] * 0.5 + 0.5)) * height
    visible = projected & np.isfinite(depth) & (pixel_x >= 0.0) & (pixel_x < width) & (pixel_y >= 0.0) & (pixel_y < height)
    screen_x = np.clip((pixel_x / max(width, 1) * 8.0).astype(np.int64), 0, 7)
    screen_y = np.clip((pixel_y / max(height, 1) * 8.0).astype(np.int64), 0, 7)
    depth_index = np.zeros(ids.size, dtype=np.int64)
    if np.any(visible):
        near = float(np.min(depth[visible]))
        far = float(np.max(depth[visible]))
        depth_index = np.clip(((depth - near) / max(far - near, 1e-6) * 8.0).astype(np.int64), 0, 7)
    quota_keys = ((depth_index * 8 + screen_y) * 8 + screen_x).astype(np.int64)
    quota_keys[~visible] = -1
    return local_transmitted_emission_scores(values), quota_keys, visible


def contribution_deposition_plan(
    native_ids: np.ndarray,
    kernel_descriptors: np.ndarray,
    coefficients: np.ndarray,
    camera: dict[str, Any],
) -> tuple[np.ndarray, dict[str, Any]]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    scores, quota_keys, visible = contribution_quota_context(ids, kernel_descriptors, coefficients, camera)
    tap_counts = quota_balanced_contribution_tap_counts(ids, scores, quota_keys)
    unique_counts, count_population = np.unique(tap_counts, return_counts=True)
    nominal_taps = int(np.sum(tap_counts, dtype=np.int64))
    return tap_counts, {
        "authority": "fixed-work-target-free-contribution-aware-quadrature-v0",
        "scoreAuthority": CONTRIBUTION_SCORE_AUTHORITY,
        "quotaAuthority": CONTRIBUTION_QUOTA_AUTHORITY,
        "targetUsed": False,
        "candidateRows": int(ids.size),
        "visibleRows": int(np.count_nonzero(visible)),
        "quotaCount": int(np.unique(quota_keys[visible]).size),
        "tapCountDistribution": {str(int(key)): int(value) for key, value in zip(unique_counts, count_population)},
        "nominalTapEvaluations": nominal_taps,
        "nominalDepositEvaluations": nominal_taps * 4,
        "matchedFixedFiveDepositEvaluations": ids.size * DEPOSITS_PER_CANDIDATE,
        "scoreDistribution": {
            "minimum": float(np.min(scores)),
            "p50": float(np.percentile(scores, 50)),
            "p95": float(np.percentile(scores, 95)),
            "maximum": float(np.max(scores)),
        },
    }


def contribution_footprint_plan(
    native_ids: np.ndarray,
    kernel_descriptors: np.ndarray,
    coefficients: np.ndarray,
    camera: dict[str, Any],
    minimum_scale: float = CONTRIBUTION_FOOTPRINT_MINIMUM_SCALE,
) -> tuple[np.ndarray, dict[str, Any]]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    scores, quota_keys, visible = contribution_quota_context(ids, kernel_descriptors, coefficients, camera)
    scales = quota_balanced_contribution_footprint_scales(ids, scores, quota_keys, minimum_scale)
    return scales, {
        "authority": "fixed-five-target-free-contribution-ranked-footprint-v0",
        "scoreAuthority": CONTRIBUTION_SCORE_AUTHORITY,
        "quotaAuthority": CONTRIBUTION_QUOTA_AUTHORITY,
        "targetUsed": False,
        "candidateRows": int(ids.size),
        "visibleRows": int(np.count_nonzero(visible)),
        "quotaCount": int(np.unique(quota_keys[visible]).size),
        "tapCount": FLOW_TAPS_PER_CANDIDATE,
        "nominalTapEvaluations": ids.size * FLOW_TAPS_PER_CANDIDATE,
        "nominalDepositEvaluations": ids.size * DEPOSITS_PER_CANDIDATE,
        "requestedMinimumFootprintScale": minimum_scale,
        "effectiveMinimumFootprintScale": float(np.min(scales[visible])) if np.any(visible) else 1.0,
        "scaleDistribution": {
            "minimum": float(np.min(scales)),
            "p50": float(np.percentile(scales, 50)),
            "p95": float(np.percentile(scales, 95)),
            "maximum": float(np.max(scales)),
        },
        "scoreDistribution": {
            "minimum": float(np.min(scores)),
            "p50": float(np.percentile(scores, 50)),
            "p95": float(np.percentile(scores, 95)),
            "maximum": float(np.max(scores)),
        },
    }


def optical_score_order(native_ids: np.ndarray, scores: np.ndarray) -> np.ndarray:
    return np.lexsort((native_ids, stable_hash(native_ids), -scores))


def select_optical_energy(native_ids: np.ndarray, coefficients: np.ndarray, budget: int) -> np.ndarray:
    require(native_ids.size == coefficients.shape[0], "optical selection row population drifted")
    require(0 < budget <= native_ids.size, "optical-energy budget is outside the candidate population")
    scores = optical_energy_scores(coefficients)
    order = optical_score_order(native_ids, scores)
    return np.sort(order[:budget])


def select_optical_hysteresis(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    budget: int,
    previous_optical_ids: np.ndarray | None,
    hysteresis_ratio: float,
    receipt: dict[str, Any] | None = None,
) -> np.ndarray:
    require(native_ids.size == coefficients.shape[0], "optical-hysteresis selection row population drifted")
    require(np.unique(native_ids).size == native_ids.size, "current optical native IDs must be unique")
    require(0 < budget <= native_ids.size, "optical-hysteresis budget is outside the candidate population")
    require(0.0 <= hysteresis_ratio < 1.0, "hysteresis ratio must be in [0,1)")
    scores = optical_energy_scores(coefficients)
    order = optical_score_order(native_ids, scores)
    entry_threshold = float(scores[order[budget - 1]])
    exit_threshold = entry_threshold * (1.0 - hysteresis_ratio)
    if previous_optical_ids is None or previous_optical_ids.size == 0:
        selected_rows = select_optical_energy(native_ids, coefficients, budget)
        if receipt is not None:
            selected_ids = native_ids[selected_rows]
            receipt.update({
                "authority": HYSTERESIS_AUTHORITY,
                "initializedFromStatelessOptical": True,
                "entryThreshold": entry_threshold,
                "exitThreshold": exit_threshold,
                "previous": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
                "selected": native_id_set_receipt(selected_ids),
                "retained": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
                "entered": native_id_set_receipt(selected_ids),
                "exited": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
            })
        return selected_rows

    previous_ids = np.asarray(previous_optical_ids, dtype=native_ids.dtype)
    require(np.unique(previous_ids).size == previous_ids.size, "previous optical native IDs must be unique")
    previous_mask = np.isin(native_ids, previous_ids)
    retained = np.flatnonzero(previous_mask & (scores >= exit_threshold))
    retained_order = optical_score_order(native_ids[retained], scores[retained])
    retained = retained[retained_order[:budget]]

    selected = np.zeros(native_ids.size, dtype=bool)
    selected[retained] = True
    remaining = budget - retained.size
    if remaining > 0:
        selected[order[~selected[order]][:remaining]] = True
    selected_rows = np.flatnonzero(selected)
    require(selected_rows.size == budget, "optical-hysteresis selector failed to spend the fixed candidate budget")
    if receipt is not None:
        selected_ids = native_ids[selected_rows]
        retained_ids = np.intersect1d(selected_ids, previous_ids, assume_unique=True)
        entered_ids = np.setdiff1d(selected_ids, previous_ids, assume_unique=True)
        exited_ids = np.setdiff1d(previous_ids, selected_ids, assume_unique=True)
        receipt.update({
            "authority": HYSTERESIS_AUTHORITY,
            "initializedFromStatelessOptical": False,
            "entryThreshold": entry_threshold,
            "exitThreshold": exit_threshold,
            "previous": native_id_set_receipt(previous_ids),
            "selected": native_id_set_receipt(selected_ids),
            "retained": native_id_set_receipt(retained_ids),
            "entered": native_id_set_receipt(entered_ids),
            "exited": native_id_set_receipt(exited_ids),
        })
    return selected_rows


def select_optical_adaptive_hysteresis(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    budget: int,
    previous_optical_ids: np.ndarray | None,
    previous_survival_probabilities: np.ndarray | None,
    minimum_ratio: float,
    maximum_ratio: float,
    receipt: dict[str, Any] | None = None,
) -> np.ndarray:
    require(native_ids.size == coefficients.shape[0], "adaptive optical selection row population drifted")
    require(np.unique(native_ids).size == native_ids.size, "current adaptive optical native IDs must be unique")
    require(0 < budget <= native_ids.size, "adaptive optical budget is outside the candidate population")
    require(0.0 <= minimum_ratio <= maximum_ratio < 1.0, "adaptive hysteresis ratios must satisfy 0 <= minimum <= maximum < 1")
    scores = optical_energy_scores(coefficients)
    order = optical_score_order(native_ids, scores)
    entry_threshold = float(scores[order[budget - 1]])

    previous_ids = (
        np.empty(0, dtype=native_ids.dtype)
        if previous_optical_ids is None
        else np.asarray(previous_optical_ids, dtype=native_ids.dtype)
    )
    survival_probabilities = (
        np.empty(0, dtype=np.float32)
        if previous_survival_probabilities is None
        else np.asarray(previous_survival_probabilities, dtype=np.float32)
    )
    require(previous_ids.ndim == 1, "previous adaptive optical native IDs must be one-dimensional")
    require(survival_probabilities.ndim == 1, "previous adaptive survival predictions must be one-dimensional")
    require(np.unique(previous_ids).size == previous_ids.size, "previous adaptive optical native IDs must be unique")
    require(
        previous_ids.size == survival_probabilities.size,
        "previous adaptive optical IDs and survival predictions must have equal populations",
    )
    require(np.all(np.isfinite(survival_probabilities)), "previous adaptive survival predictions must be finite")
    require(
        np.all((survival_probabilities >= 0.0) & (survival_probabilities <= 1.0)),
        "previous adaptive survival predictions must be in [0,1]",
    )

    if previous_ids.size == 0:
        selected_rows = select_optical_energy(native_ids, coefficients, budget)
        if receipt is not None:
            selected_ids = native_ids[selected_rows]
            receipt.update({
                "authority": ADAPTIVE_HYSTERESIS_AUTHORITY,
                "predictionSource": ADAPTIVE_PREDICTION_SOURCE,
                "initializedFromStatelessOptical": True,
                "minimumRatio": float(minimum_ratio),
                "maximumRatio": float(maximum_ratio),
                "effectiveRatioDistribution": {
                    "count": 0,
                    "minimum": None,
                    "mean": None,
                    "maximum": None,
                },
                "matchedMeanRatio": None,
                "entryThreshold": entry_threshold,
                "previous": native_id_set_receipt(previous_ids),
                "survivalPredictions": native_id_float_receipt(previous_ids, survival_probabilities),
                "selected": native_id_set_receipt(selected_ids),
                "retained": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
                "entered": native_id_set_receipt(selected_ids),
                "exited": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
            })
        return selected_rows

    previous_order = np.argsort(previous_ids, kind="stable")
    sorted_previous_ids = previous_ids[previous_order]
    sorted_survival_probabilities = survival_probabilities[previous_order]
    previous_positions = np.searchsorted(sorted_previous_ids, native_ids)
    previous_mask = previous_positions < sorted_previous_ids.size
    matched_positions = np.minimum(previous_positions, sorted_previous_ids.size - 1)
    previous_mask &= sorted_previous_ids[matched_positions] == native_ids
    current_survival_probabilities = np.zeros(native_ids.size, dtype=np.float32)
    current_survival_probabilities[previous_mask] = sorted_survival_probabilities[matched_positions[previous_mask]]
    current_ratios = minimum_ratio + (maximum_ratio - minimum_ratio) * current_survival_probabilities
    effective_ratios = np.asarray(current_ratios[previous_mask], dtype=np.float32)
    matched_mean_ratio = (
        float(np.mean(effective_ratios, dtype=np.float64))
        if effective_ratios.size > 0
        else None
    )
    exit_thresholds = entry_threshold * (1.0 - current_ratios)
    retained = np.flatnonzero(previous_mask & (scores >= exit_thresholds))
    retained_order = optical_score_order(native_ids[retained], scores[retained])
    retained = retained[retained_order[:budget]]

    selected = np.zeros(native_ids.size, dtype=bool)
    selected[retained] = True
    remaining = budget - retained.size
    if remaining > 0:
        selected[order[~selected[order]][:remaining]] = True
    selected_rows = np.flatnonzero(selected)
    require(selected_rows.size == budget, "adaptive optical selector failed to spend the fixed candidate budget")
    if receipt is not None:
        selected_ids = native_ids[selected_rows]
        retained_ids = np.intersect1d(selected_ids, previous_ids, assume_unique=True)
        entered_ids = np.setdiff1d(selected_ids, previous_ids, assume_unique=True)
        exited_ids = np.setdiff1d(previous_ids, selected_ids, assume_unique=True)
        receipt.update({
            "authority": ADAPTIVE_HYSTERESIS_AUTHORITY,
            "predictionSource": ADAPTIVE_PREDICTION_SOURCE,
            "initializedFromStatelessOptical": effective_ratios.size == 0,
            "minimumRatio": float(minimum_ratio),
            "maximumRatio": float(maximum_ratio),
            "effectiveRatioDistribution": {
                "count": int(effective_ratios.size),
                "minimum": float(np.min(effective_ratios)) if effective_ratios.size > 0 else None,
                "mean": matched_mean_ratio,
                "maximum": float(np.max(effective_ratios)) if effective_ratios.size > 0 else None,
            },
            "matchedMeanRatio": matched_mean_ratio,
            "entryThreshold": entry_threshold,
            "previous": native_id_set_receipt(previous_ids),
            "survivalPredictions": native_id_float_receipt(previous_ids, survival_probabilities),
            "selected": native_id_set_receipt(selected_ids),
            "retained": native_id_set_receipt(retained_ids),
            "entered": native_id_set_receipt(entered_ids),
            "exited": native_id_set_receipt(exited_ids),
        })
    return selected_rows


def fixed_budget_selections(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    budget_fraction: float,
    candidate_budget: int | None = None,
    previous_optical_ids: np.ndarray | None = None,
    hysteresis_ratio: float = 0.1,
    selection_receipts: dict[str, dict[str, Any]] | None = None,
) -> dict[str, np.ndarray]:
    require(0.0 < budget_fraction <= 1.0, "budget fraction must be in (0,1]")
    require(np.unique(native_ids).size == native_ids.size, "native-cell candidate IDs must be unique")
    budget = max(1, int(np.floor(native_ids.size * budget_fraction))) if candidate_budget is None else int(candidate_budget)
    require(0 < budget <= native_ids.size, "fixed candidate budget is outside the current state population")
    hysteresis_receipt: dict[str, Any] = {}
    selections = {
        "stable-uniform": select_stable_uniform(native_ids, budget),
        "optical-energy": select_optical_energy(native_ids, coefficients, budget),
        "optical-hysteresis": select_optical_hysteresis(
            native_ids,
            coefficients,
            budget,
            previous_optical_ids,
            hysteresis_ratio,
            hysteresis_receipt,
        ),
    }
    require({rows.size for rows in selections.values()} == {budget}, "selection arms spent different candidate budgets")
    if selection_receipts is not None:
        authorities = {
            "stable-uniform": UNIFORM_AUTHORITY,
            "optical-energy": SELECTION_AUTHORITY,
        }
        for policy in ("stable-uniform", "optical-energy"):
            selection_receipts[policy] = {
                "authority": authorities[policy],
                "selected": native_id_set_receipt(native_ids[selections[policy]]),
            }
        selection_receipts["optical-hysteresis"] = hysteresis_receipt
    return selections


def actual_deposit_count(multiplicity: np.ndarray) -> int:
    return int(np.sum(multiplicity, dtype=np.int64))


def adjacent_motion_receipt(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    step_delta = int(current["steps"]) - int(previous["steps"])
    require(step_delta > 0, "selected adjacent states require a positive step delta")
    previous_error = previous["render"].astype(np.float32) - previous["target"].astype(np.float32)
    current_error = current["render"].astype(np.float32) - current["target"].astype(np.float32)
    return {
        "fromStateId": previous["stateId"],
        "toStateId": current["stateId"],
        "stepDelta": step_delta,
        "nodeIdentityTurnover": MOTION.node_turnover(previous["ids"], current["ids"]),
        "multiplicityChurn": MOTION.multiplicity_churn(previous, current),
        "placementVelocity": MOTION.placement_velocity(previous, current, step_delta),
        "adjacentFramePixelDiffs": {
            "targetMae": MOTION.pixel_mae(previous["target"], current["target"]),
            "renderMae": MOTION.pixel_mae(previous["render"], current["render"]),
            "motionDeltaMae": MOTION.pixel_mae(
                current["render"].astype(np.int16) - previous["render"].astype(np.int16),
                current["target"].astype(np.int16) - previous["target"].astype(np.int16),
            ),
            "errorFieldDeltaMae": float(np.mean(np.abs(current_error - previous_error)) / 255.0),
        },
    }


def validate_adjacent_state_motion(
    report_states: list[dict[str, Any]],
    temporal_by_policy: dict[str, list[dict[str, Any]]],
    policies: list[str],
    mode: str,
) -> None:
    expected_transitions = max(0, len(report_states) - 1) if mode == "sequence" else 0
    require(set(temporal_by_policy) == set(policies), "adjacent-state motion policy buckets drifted")

    def nonnegative_integer(value: Any, label: str) -> int:
        require(isinstance(value, int) and not isinstance(value, bool) and value >= 0, f"{label} must be a nonnegative integer")
        return value

    def finite_nonnegative(value: Any, label: str) -> float:
        require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{label} must be numeric")
        numeric = float(value)
        require(math.isfinite(numeric) and numeric >= 0.0, f"{label} must be finite and nonnegative")
        return numeric

    for policy in policies:
        transitions = temporal_by_policy[policy]
        require(len(transitions) == expected_transitions, f"{policy} adjacent-state motion ledger is partial")
        for index, row in enumerate(transitions):
            previous_state = report_states[index]
            current_state = report_states[index + 1]
            previous_arm = (previous_state.get("arms") or {}).get(policy)
            current_arm = (current_state.get("arms") or {}).get(policy)
            require(isinstance(previous_arm, dict), f"{policy} previous state arm receipt is missing")
            require(isinstance(current_arm, dict), f"{policy} current state arm receipt is missing")
            previous_selected = nonnegative_integer(previous_arm.get("selectedRows"), f"{policy} previous selected rows")
            current_selected = nonnegative_integer(current_arm.get("selectedRows"), f"{policy} current selected rows")
            previous_budget = nonnegative_integer(previous_arm.get("candidateBudget"), f"{policy} previous candidate budget")
            current_budget = nonnegative_integer(current_arm.get("candidateBudget"), f"{policy} current candidate budget")
            require(previous_selected == previous_budget, f"{policy} previous state did not spend its candidate budget")
            require(current_selected == current_budget, f"{policy} current state did not spend its candidate budget")
            expected_step_delta = int(current_state["steps"]) - int(previous_state["steps"])
            require(row.get("fromStateId") == previous_state["stateId"], f"{policy} adjacent-state source identity is misrouted")
            require(row.get("toStateId") == current_state["stateId"], f"{policy} adjacent-state destination identity is misrouted")
            require(expected_step_delta > 0 and row.get("stepDelta") == expected_step_delta, f"{policy} adjacent-state step delta is invalid")

            turnover = row.get("nodeIdentityTurnover")
            require(isinstance(turnover, dict), f"{policy} node turnover evidence is missing")
            previous_count = nonnegative_integer(turnover.get("previousNodeCount"), f"{policy} previous node count")
            current_count = nonnegative_integer(turnover.get("currentNodeCount"), f"{policy} current node count")
            require(previous_count == previous_selected, f"{policy} previous node count disagrees with the state arm")
            require(current_count == current_selected, f"{policy} current node count disagrees with the state arm")
            shared_count = nonnegative_integer(turnover.get("sharedNodeCount"), f"{policy} shared node count")
            entered_count = nonnegative_integer(turnover.get("enteredNodeCount"), f"{policy} entered node count")
            exited_count = nonnegative_integer(turnover.get("exitedNodeCount"), f"{policy} exited node count")
            union_count = nonnegative_integer(turnover.get("unionNodeCount"), f"{policy} union node count")
            require(shared_count <= min(previous_count, current_count), f"{policy} shared node count exceeds a cohort")
            require(entered_count == current_count - shared_count, f"{policy} entered node accounting is inconsistent")
            require(exited_count == previous_count - shared_count, f"{policy} exited node accounting is inconsistent")
            require(union_count == previous_count + current_count - shared_count, f"{policy} union node accounting is inconsistent")
            jaccard = finite_nonnegative(turnover.get("jaccard"), f"{policy} node jaccard")
            turnover_fraction = finite_nonnegative(turnover.get("turnoverFraction"), f"{policy} turnover fraction")
            require(jaccard <= 1.0 and turnover_fraction <= 1.0, f"{policy} turnover fractions exceed one")
            expected_jaccard = shared_count / max(union_count, 1)
            require(abs(jaccard - expected_jaccard) <= 1e-9, f"{policy} node jaccard is inconsistent")
            require(abs(turnover_fraction - (1.0 - expected_jaccard)) <= 1e-9, f"{policy} turnover fraction is inconsistent")

            churn = row.get("multiplicityChurn")
            require(isinstance(churn, dict), f"{policy} multiplicity churn evidence is missing")
            expected_deposit_rule = previous_arm.get("depositRule")
            require(isinstance(expected_deposit_rule, str) and expected_deposit_rule, f"{policy} previous deposit rule is missing")
            require(current_arm.get("depositRule") == expected_deposit_rule, f"{policy} state arms changed deposit rules")
            require(churn.get("depositRule") == expected_deposit_rule, f"{policy} deposit rule drifted")
            maximum_deposits = nonnegative_integer(churn.get("maximumDepositsPerCandidate"), f"{policy} maximum deposits per candidate")
            require(previous_arm.get("maximumDepositsPerCandidate") == maximum_deposits, f"{policy} previous maximum deposit contract drifted")
            require(current_arm.get("maximumDepositsPerCandidate") == maximum_deposits, f"{policy} current maximum deposit contract drifted")
            previous_deposits = nonnegative_integer(
                churn.get("previousActualInBoundsPositiveWeightDepositCount"),
                f"{policy} previous actual positive-weight deposit count",
            )
            current_deposits = nonnegative_integer(
                churn.get("currentActualInBoundsPositiveWeightDepositCount"),
                f"{policy} current actual positive-weight deposit count",
            )
            previous_arm_deposits = nonnegative_integer(
                previous_arm.get("actualInBoundsPositiveWeightDepositCount"),
                f"{policy} previous state in-bounds positive-weight deposit count",
            )
            current_arm_deposits = nonnegative_integer(
                current_arm.get("actualInBoundsPositiveWeightDepositCount"),
                f"{policy} current state in-bounds positive-weight deposit count",
            )
            require(previous_deposits == previous_arm_deposits, f"{policy} previous deposit count disagrees with the state arm")
            require(current_deposits == current_arm_deposits, f"{policy} current deposit count disagrees with the state arm")
            require(previous_deposits <= previous_count * maximum_deposits, f"{policy} previous deposits exceed the fixed workload")
            require(current_deposits <= current_count * maximum_deposits, f"{policy} current deposits exceed the fixed workload")
            require(churn.get("sharedNodeCount") == shared_count, f"{policy} churn shared-node count disagrees with turnover")
            changed_count = nonnegative_integer(churn.get("sharedNodesWithChangedMultiplicity"), f"{policy} changed multiplicity count")
            require(changed_count <= shared_count, f"{policy} changed multiplicity count exceeds shared nodes")
            require(
                churn.get("authority") == "actual-in-bounds-positive-weight-bilinear-deposit-count-v1",
                f"{policy} multiplicity authority drifted",
            )
            if shared_count == 0:
                require(churn.get("meanAbsoluteSharedNodeDepositDelta") is None, f"{policy} empty churn mean must be null")
                require(churn.get("maxAbsoluteSharedNodeDepositDelta") is None, f"{policy} empty churn max must be null")
            else:
                mean_deposit_delta = finite_nonnegative(churn.get("meanAbsoluteSharedNodeDepositDelta"), f"{policy} mean deposit delta")
                max_deposit_delta = finite_nonnegative(churn.get("maxAbsoluteSharedNodeDepositDelta"), f"{policy} max deposit delta")
                require(mean_deposit_delta <= max_deposit_delta <= maximum_deposits, f"{policy} multiplicity delta range is inconsistent")

            velocity = row.get("placementVelocity")
            require(isinstance(velocity, dict), f"{policy} placement velocity evidence is missing")
            require(velocity.get("sharedNodeCount") == shared_count, f"{policy} velocity shared-node count disagrees with turnover")
            visible_taps = nonnegative_integer(velocity.get("sharedVisibleTapCount"), f"{policy} shared visible tap count")
            maximum_taps = maximum_deposits // 4
            require(maximum_taps * 4 == maximum_deposits, f"{policy} maximum deposit count is not four-way bilinear work")
            require(visible_taps <= shared_count * maximum_taps, f"{policy} shared visible taps exceed the arm maximum")
            require(velocity.get("unit") == "screen-pixels-per-simulator-step", f"{policy} placement velocity unit drifted")
            if visible_taps == 0:
                require(all(velocity.get(field) is None for field in ("mean", "p50", "p95", "max")), f"{policy} empty placement statistics must be null")
            else:
                require(velocity.get("authority") == "matched-native-node-flow-tangent-tap-centers-v0", f"{policy} placement authority drifted")
                mean_velocity = finite_nonnegative(velocity.get("mean"), f"{policy} mean placement velocity")
                p50_velocity = finite_nonnegative(velocity.get("p50"), f"{policy} p50 placement velocity")
                p95_velocity = finite_nonnegative(velocity.get("p95"), f"{policy} p95 placement velocity")
                max_velocity = finite_nonnegative(velocity.get("max"), f"{policy} max placement velocity")
                require(p50_velocity <= p95_velocity <= max_velocity and mean_velocity <= max_velocity, f"{policy} placement velocity quantiles are inconsistent")

            image_diffs = row.get("adjacentFramePixelDiffs")
            require(isinstance(image_diffs, dict), f"{policy} adjacent-frame image evidence is missing")
            for field in ("targetMae", "renderMae"):
                value = finite_nonnegative(image_diffs.get(field), f"{policy} {field}")
                require(value <= 1.0, f"{policy} {field} exceeds normalized image range")
            for field in ("motionDeltaMae", "errorFieldDeltaMae"):
                value = finite_nonnegative(image_diffs.get(field), f"{policy} {field}")
                require(value <= 2.0, f"{policy} {field} exceeds normalized difference-field range")


def selection_viewer(
    rows: list[dict[str, Any]],
    policies: list[str],
    evidence_identity: dict[str, Any],
) -> str:
    payload = json.dumps(rows, separators=(",", ":"))
    identity_payload = json.dumps(evidence_identity, separators=(",", ":"))
    options = "".join(f'<option value="{policy}">{policy}</option>' for policy in policies)
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixed-Budget Quadrature Oracle</title><style>
body{{margin:0;background:#0d1013;color:#f4f5f6;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}}header{{position:sticky;top:0;z-index:2;padding:12px;background:#15191d;border-bottom:1px solid #343a40;display:flex;gap:14px;align-items:center;flex-wrap:wrap}}button,select{{background:#222930;color:#fff;border:1px solid #46515b;padding:7px 12px}}input{{width:min(580px,55vw)}}main{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:10px}}figure{{margin:0;background:#15191d;border:1px solid #343a40}}figcaption{{padding:8px;color:#b8c0c8}}img{{display:block;width:100%;height:auto}}pre{{white-space:pre-wrap;margin:0;padding:10px;border-top:1px solid #343a40;color:#b8c0c8}}@media(max-width:900px){{main{{grid-template-columns:1fr}}}}
</style></head><body><header><strong>Fixed-budget quadrature oracle</strong><span id="evidence"></span><select id="policy">{options}</select><button id="prev">◀</button><input id="step" type="range" min="0" max="{len(rows)-1}" value="0"><button id="next">▶</button><span id="label"></span></header><main><figure><figcaption>Exact target</figcaption><img id="target"></figure><figure><figcaption>Selected quadrature</figcaption><img id="render"></figure><figure><figcaption>Residual</figcaption><img id="residual"><pre id="metrics"></pre></figure></main><script>
const rows={payload};const evidenceIdentity={identity_payload};evidence.textContent=`${{evidenceIdentity.status}} · manifest ${{evidenceIdentity.manifestSha256.slice(0,12)}} · motion ${{evidenceIdentity.motionReportSha256.slice(0,12)}} · runtime ${{evidenceIdentity.implementationBundleSha256.slice(0,12)}}`;const slider=document.querySelector('#step');function show(index){{index=Math.max(0,Math.min(rows.length-1,index));slider.value=index;const row=rows[index],arm=row.arms[policy.value];target.src=row.target;render.src=arm.render;residual.src=arm.residual;label.textContent=`${{row.stateId}} · ${{policy.value}} · ${{arm.selectedRows.toLocaleString()}} rows`;metrics.textContent=JSON.stringify({{evidenceIdentity,metrics:arm.metrics}},null,2)}}slider.oninput=()=>show(+slider.value);policy.onchange=()=>show(+slider.value);prev.onclick=()=>show(+slider.value-1);next.onclick=()=>show(+slider.value+1);addEventListener('keydown',event=>{{if(event.key==='ArrowLeft')show(+slider.value-1);if(event.key==='ArrowRight')show(+slider.value+1)}});show(0);
</script></body></html>"""


def stateless_optical_context(
    state: dict[str, Any],
    manifest_path: Path,
    candidate_budget: int,
) -> dict[str, Any]:
    rows = MOTION.load_rows(state, manifest_path)
    native_ids = np.asarray(rows["nativeCellIndices"], dtype=np.uint32)
    coefficients = np.asarray(rows["coefficients"])
    scores = optical_energy_scores(coefficients)
    order = optical_score_order(native_ids, scores)
    require(0 < candidate_budget <= native_ids.size, "causal optical candidate budget exceeds a state population")
    selected_rows = np.sort(order[:candidate_budget])
    return {
        "state": state,
        "rows": rows,
        "nativeIds": native_ids,
        "coefficients": coefficients,
        "opticalScores": scores,
        "entryThreshold": float(scores[order[candidate_budget - 1]]),
        "selectedRows": selected_rows,
        "selectedIds": native_ids[selected_rows],
    }


def causal_survival_transition_examples(
    states: list[dict[str, Any]],
    manifest_path: Path,
    transition_index: int,
    candidate_budget: int,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    require(0 <= transition_index < len(states) - 1, "causal survival transition index is outside the state sequence")
    source = stateless_optical_context(states[transition_index], manifest_path, candidate_budget)
    destination = stateless_optical_context(states[transition_index + 1], manifest_path, candidate_budget)
    feature_matrix = causal_survival_feature_matrix(
        source["rows"]["features"],
        source["coefficients"],
        source["rows"]["kernelDescriptors"],
        source["selectedRows"],
        source["opticalScores"],
        source["entryThreshold"],
    )
    labels = native_id_membership_labels(source["selectedIds"], destination["selectedIds"])
    receipt = {
        "transitionIndex": transition_index,
        "fromStateId": str(states[transition_index]["id"]),
        "toStateId": str(states[transition_index + 1]["id"]),
        "fromSteps": int((states[transition_index].get("replay") or {}).get("completedSteps")),
        "toSteps": int((states[transition_index + 1].get("replay") or {}).get("completedSteps")),
        "trainingRows": int(feature_matrix.shape[0]),
        "featureCount": int(feature_matrix.shape[1]),
        "positiveFraction": float(np.mean(labels)),
        "sourceCohort": native_id_set_receipt(source["selectedIds"]),
        "destinationCohort": native_id_set_receipt(destination["selectedIds"]),
        "targetAuthority": CAUSAL_SURVIVAL_TARGET_AUTHORITY,
        "targetPixelsUsed": False,
        "cameraUsed": False,
    }
    return feature_matrix, labels, receipt


def survival_prediction_metrics(predictions: np.ndarray, labels: np.ndarray) -> dict[str, Any]:
    predicted = np.asarray(predictions, dtype=np.float64)
    target = np.asarray(labels, dtype=np.float64)
    require(predicted.ndim == target.ndim == 1 and predicted.size == target.size > 0, "survival prediction metrics require matched nonempty vectors")
    require(np.all(np.isfinite(predicted)) and np.all((predicted >= 0.0) & (predicted <= 1.0)), "survival predictions must be finite probabilities")
    require(np.all(np.isfinite(target)) and np.all((target >= 0.0) & (target <= 1.0)), "survival labels must be finite probabilities")
    constant = float(np.mean(target))
    brier = float(np.mean((predicted - target) ** 2))
    constant_brier = float(np.mean((constant - target) ** 2))
    return {
        "rows": int(target.size),
        "positiveFraction": constant,
        "predictionMean": float(np.mean(predicted)),
        "predictionP05": float(np.percentile(predicted, 5)),
        "predictionP50": float(np.percentile(predicted, 50)),
        "predictionP95": float(np.percentile(predicted, 95)),
        "mae": float(np.mean(np.abs(predicted - target))),
        "brier": brier,
        "constantBrier": constant_brier,
        "brierImprovementOverConstant": float(constant_brier - brier),
        "thresholdAccuracy": float(np.mean((predicted >= 0.5) == (target >= 0.5))),
    }


def train_causal_survival_model(
    states: list[dict[str, Any]],
    manifest_path: Path,
    candidate_budget: int,
    split: dict[str, Any],
    ridge_alpha: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    training_transitions: list[dict[str, Any]] = []

    def training_blocks() -> Iterable[tuple[np.ndarray, np.ndarray]]:
        for transition_index in split["trainingTransitionIndices"]:
            features, labels, transition_receipt = causal_survival_transition_examples(
                states,
                manifest_path,
                transition_index,
                candidate_budget,
            )
            training_transitions.append(transition_receipt)
            yield features, labels
            del features, labels

    model_receipt: dict[str, Any] = {}
    model = fit_causal_survival_ridge_blocks(
        training_blocks(),
        ridge_alpha,
        receipt=model_receipt,
    )

    calibration_transitions: list[dict[str, Any]] = []
    for transition_index in split["calibrationTransitionIndices"]:
        features, labels, transition_receipt = causal_survival_transition_examples(
            states,
            manifest_path,
            transition_index,
            candidate_budget,
        )
        transition_receipt["metrics"] = survival_prediction_metrics(
            predict_causal_survival_ridge(model, features),
            labels,
        )
        calibration_transitions.append(transition_receipt)
    model_receipt.update({
        "featureAuthority": CAUSAL_SURVIVAL_FEATURE_AUTHORITY,
        "featureCount": CAUSAL_SURVIVAL_FEATURE_COUNT,
        "trainingTransitions": training_transitions,
        "calibrationTransitions": calibration_transitions,
        "chronologicalSplit": split,
        "modelParameters": {
            "featureMean": np.asarray(model["featureMean"]).tolist(),
            "featureScale": np.asarray(model["featureScale"]).tolist(),
            "intercept": model["intercept"],
            "weights": np.asarray(model["weights"]).tolist(),
        },
    })
    return model, model_receipt


def selected_state(
    state: dict[str, Any],
    manifest_path: Path,
    row_indices: np.ndarray,
    path_scale: float,
    policy: str,
    images_dir: Path,
    contribution_footprint_minimum_scale: float,
) -> tuple[dict[str, Any], dict[str, Any]]:
    rows = MOTION.load_rows(state, manifest_path)
    target = MOTION.target_image(state, manifest_path)
    descriptors = rows["kernelDescriptors"]
    selected_rows = {
        "count": int(row_indices.size),
        "features": np.asarray(rows["features"][row_indices]),
        "coefficients": np.asarray(rows["coefficients"][row_indices]),
        "nativeCellIndices": np.asarray(rows["nativeCellIndices"][row_indices], dtype=np.uint32),
        "kernelDescriptors": np.asarray(descriptors[row_indices]),
    }
    camera = MOTION.camera_contract(state)
    tap_counts: np.ndarray | None = None
    tap_patterns: dict[int, dict[str, Any]] | None = None
    tap_scales: np.ndarray | None = None
    deposition_plan: dict[str, Any] | None = None
    if policy == CONTRIBUTION_DEPOSITION_POLICY:
        tap_counts, deposition_plan = contribution_deposition_plan(
            selected_rows["nativeCellIndices"],
            selected_rows["kernelDescriptors"],
            selected_rows["coefficients"],
            camera,
        )
        tap_patterns = CONTRIBUTION_TAP_PATTERNS
    elif policy == CONTRIBUTION_FOOTPRINT_POLICY:
        tap_scales, deposition_plan = contribution_footprint_plan(
            selected_rows["nativeCellIndices"],
            selected_rows["kernelDescriptors"],
            selected_rows["coefficients"],
            camera,
            contribution_footprint_minimum_scale,
        )
    planes, telemetry = ORACLE.rasterize_coefficients(
        selected_rows["kernelDescriptors"][:, 0:3],
        selected_rows["kernelDescriptors"][:, 4:7],
        selected_rows["features"],
        selected_rows["coefficients"],
        camera,
        MOTION.DEPTH_BINS,
        "bilinear",
        tap_counts=tap_counts,
        tap_patterns=tap_patterns,
        tap_scales=tap_scales,
    )
    linear, _, _, _ = ORACLE.compose_planes(planes, path_scale, "total")
    render = ORACLE.tone_map(linear)
    residual = ORACLE.residual_heatmap(render, target)
    del planes, linear

    state_id = str(state["id"])
    target_path = images_dir / f"{state_id}-target.png"
    render_path = images_dir / f"{state_id}-{policy}.png"
    residual_path = images_dir / f"{state_id}-{policy}-residual.png"
    if not target_path.exists():
        ORACLE.write_png(target_path, target)
    ORACLE.write_png(render_path, render)
    ORACLE.write_png(residual_path, residual)
    placements = MOTION.flow_tap_placements(
        selected_rows,
        camera,
        tap_counts=tap_counts,
        tap_patterns=tap_patterns,
        tap_scales=tap_scales,
    )
    tap_weights = MOTION.flow_tap_weights(
        row_indices.size,
        tap_counts=tap_counts,
        tap_patterns=tap_patterns,
    )
    deposit_accounting = MOTION.bilinear_deposit_accounting(
        placements,
        tap_weights,
        camera["width"],
        camera["height"],
    )
    multiplicity = deposit_accounting["actualInBoundsPositiveWeightDeposits"]
    deposit_rule = (
        CONTRIBUTION_DEPOSIT_RULE
        if tap_counts is not None
        else CONTRIBUTION_FOOTPRINT_DEPOSIT_RULE
        if tap_scales is not None
        else "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0"
    )
    maximum_deposits = 28 if tap_counts is not None else DEPOSITS_PER_CANDIDATE
    nominal_deposit_budget = int(
        np.sum(tap_counts, dtype=np.int64) * 4
        if tap_counts is not None
        else row_indices.size * DEPOSITS_PER_CANDIDATE
    )
    require(nominal_deposit_budget == row_indices.size * DEPOSITS_PER_CANDIDATE, "deposition treatment changed nominal work")
    require(
        int(np.sum(deposit_accounting["nominalDepositEvaluations"], dtype=np.int64)) == nominal_deposit_budget,
        "deposit accounting disagrees with nominal work",
    )
    steps = int((state.get("replay") or {}).get("completedSteps"))
    temporal = {
        "stateId": state_id,
        "steps": steps,
        "ids": selected_rows["nativeCellIndices"],
        "placements": placements,
        "multiplicity": multiplicity,
        "depositRule": deposit_rule,
        "maximumDepositsPerCandidate": maximum_deposits,
        "target": target,
        "render": render,
    }
    receipt = {
        "policy": policy,
        "targetUsedForSelection": False,
        "selectedRows": int(row_indices.size),
        "candidateBudget": int(row_indices.size),
        "nominalDepositEvaluationBudget": nominal_deposit_budget,
        "depositRule": deposit_rule,
        "maximumDepositsPerCandidate": maximum_deposits,
        "positiveWeightDepositEvaluationCount": int(
            np.sum(deposit_accounting["positiveWeightDepositEvaluations"], dtype=np.int64)
        ),
        "actualInBoundsPositiveWeightDepositCount": actual_deposit_count(multiplicity),
        "outOfFramePositiveWeightDepositCount": int(
            np.sum(deposit_accounting["outOfFramePositiveWeightDeposits"], dtype=np.int64)
        ),
        "invalidProjectionNominalDepositCount": int(
            np.sum(deposit_accounting["invalidProjectionNominalDeposits"], dtype=np.int64)
        ),
        "retainedQuadratureWeightFraction": {
            "sum": float(np.sum(deposit_accounting["retainedQuadratureWeightFraction"], dtype=np.float64)),
            "meanPerCandidate": float(np.mean(deposit_accounting["retainedQuadratureWeightFraction"])),
            "minimumPerCandidate": float(np.min(deposit_accounting["retainedQuadratureWeightFraction"])),
        },
        "metrics": ORACLE.image_metrics(render, target),
        "rasterTelemetry": telemetry,
        "contributionDeposition": deposition_plan if tap_counts is not None else None,
        "contributionFootprint": deposition_plan if tap_scales is not None else None,
        "images": {
            "render": str(render_path),
            "residual": str(residual_path),
        },
    }
    return receipt, temporal


def run(
    manifest_path: Path,
    motion_report_path: Path,
    manifest: dict[str, Any],
    manifest_sha256: str,
    motion_report: dict[str, Any],
    motion_report_sha256: str,
    out_dir: Path,
    budget_fraction: float,
    mode: str,
    hysteresis_ratio: float,
    adaptive_survival: bool,
    adaptive_minimum_ratio: float,
    adaptive_maximum_ratio: float,
    adaptive_training_transitions: int,
    adaptive_calibration_transitions: int,
    adaptive_ridge_alpha: float,
    contribution_deposition: bool,
    contribution_footprint: bool,
    contribution_footprint_minimum_scale: float,
    implementation_bundle_sha256: str,
    bound_implementation_bundle: dict[str, Any],
) -> tuple[dict[str, Any], str]:
    require(mode in {"frozen", "sequence"}, "mode must be frozen or sequence")
    require(not contribution_deposition or adaptive_survival, "contribution deposition requires the matched-mean adaptive-survival sequence")
    require(not contribution_footprint or adaptive_survival, "contribution footprint requires the matched-mean adaptive-survival sequence")
    require(not (contribution_deposition and contribution_footprint), "contribution deposition and footprint assays must run separately")
    require(
        math.isfinite(contribution_footprint_minimum_scale)
        and 0.0 < contribution_footprint_minimum_scale <= 1.0,
        "contribution footprint minimum scale must be finite and in (0,1]",
    )
    states = manifest.get("states") or []
    require(len(states) >= 2, "budget oracle requires at least two captured exact states")
    budget_anchor_state = states[-1]
    budget_anchor_rows = MOTION.load_rows(budget_anchor_state, manifest_path)
    budget_anchor_population = int(budget_anchor_rows["nativeCellIndices"].shape[0])
    candidate_budget = max(1, int(np.floor(budget_anchor_population * budget_fraction)))
    adaptive_split: dict[str, Any] | None = None
    adaptive_model: dict[str, Any] | None = None
    adaptive_model_receipt: dict[str, Any] | None = None
    if adaptive_survival:
        require(mode == "sequence", "causal adaptive survival requires sequence mode")
        adaptive_split = causal_survival_transition_split(
            len(states),
            adaptive_training_transitions,
            adaptive_calibration_transitions,
        )
        adaptive_model, adaptive_model_receipt = train_causal_survival_model(
            states,
            manifest_path,
            candidate_budget,
            adaptive_split,
            adaptive_ridge_alpha,
        )
        selected_states = states[adaptive_split["heldStateStartIndex"]:]
    else:
        selected_states = [states[-1]] if mode == "frozen" else states
    path_scale = float((motion_report.get("transport") or {}).get("globalPathScale"))
    full_by_state = {str(row["stateId"]): row for row in motion_report.get("states") or []}
    require(all(str(state["id"]) in full_by_state for state in selected_states), "motion report is partial for selected states")

    out_dir.mkdir(parents=True, exist_ok=True)
    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    report_states: list[dict[str, Any]] = []
    policies = (
        [
            "optical-energy",
            "optical-hysteresis-025",
            "optical-hysteresis-035",
            "optical-hysteresis-adaptive-mean",
            "optical-adaptive-hysteresis",
        ]
        if adaptive_survival
        else ["stable-uniform", "optical-energy", "optical-hysteresis"]
    )
    if contribution_deposition:
        policies.append(CONTRIBUTION_DEPOSITION_POLICY)
    if contribution_footprint:
        policies.append(CONTRIBUTION_FOOTPRINT_POLICY)
    temporal_by_policy: dict[str, list[dict[str, Any]]] = {policy: [] for policy in policies}
    previous_by_policy: dict[str, dict[str, Any]] = {}
    previous_hysteresis_ids: np.ndarray | None = None
    previous_hysteresis_ids_by_ratio: dict[str, np.ndarray | None] = {
        "optical-hysteresis-025": None,
        "optical-hysteresis-035": None,
    }
    previous_adaptive_ids: np.ndarray | None = None
    previous_adaptive_predictions: np.ndarray | None = None
    previous_adaptive_mean_ids: np.ndarray | None = None
    adaptive_held_predictions: list[dict[str, Any]] = []
    target_hashes: set[str] = set()
    render_hashes: dict[str, set[str]] = {policy: set() for policy in policies}

    selected_state_start_index = adaptive_split["heldStateStartIndex"] if adaptive_split is not None else 0
    for selected_state_offset, state in enumerate(selected_states):
        state_id = str(state["id"])
        rows = MOTION.load_rows(state, manifest_path)
        ids = np.asarray(rows["nativeCellIndices"], dtype=np.uint32)
        coefficients = np.asarray(rows["coefficients"])
        selection_receipts: dict[str, dict[str, Any]] = {}
        if adaptive_survival:
            optical_rows = select_optical_energy(ids, coefficients, candidate_budget)
            selection_receipts["optical-energy"] = {
                "authority": SELECTION_AUTHORITY,
                "selected": native_id_set_receipt(ids[optical_rows]),
            }
            selections = {"optical-energy": optical_rows}
            for policy, ratio in (("optical-hysteresis-025", 0.25), ("optical-hysteresis-035", 0.35)):
                policy_receipt: dict[str, Any] = {}
                policy_rows = select_optical_hysteresis(
                    ids,
                    coefficients,
                    candidate_budget,
                    previous_hysteresis_ids_by_ratio[policy],
                    ratio,
                    receipt=policy_receipt,
                )
                selections[policy] = policy_rows
                selection_receipts[policy] = policy_receipt
                previous_hysteresis_ids_by_ratio[policy] = ids[policy_rows].copy()
            adaptive_receipt: dict[str, Any] = {}
            adaptive_rows = select_optical_adaptive_hysteresis(
                ids,
                coefficients,
                candidate_budget,
                previous_adaptive_ids,
                previous_adaptive_predictions,
                adaptive_minimum_ratio,
                adaptive_maximum_ratio,
                receipt=adaptive_receipt,
            )
            selections["optical-adaptive-hysteresis"] = adaptive_rows
            selection_receipts["optical-adaptive-hysteresis"] = adaptive_receipt
            adaptive_mean_receipt: dict[str, Any] = {}
            matched_mean_ratio = adaptive_receipt["matchedMeanRatio"]
            if matched_mean_ratio is None:
                adaptive_mean_rows = select_optical_energy(ids, coefficients, candidate_budget)
                selected_adaptive_mean_ids = ids[adaptive_mean_rows]
                adaptive_mean_receipt.update({
                    "initializedFromStatelessOptical": True,
                    **native_id_transition_receipt(
                        np.empty(0, dtype=np.uint32)
                        if previous_adaptive_mean_ids is None
                        else previous_adaptive_mean_ids,
                        selected_adaptive_mean_ids,
                    ),
                })
            else:
                adaptive_mean_rows = select_optical_hysteresis(
                    ids,
                    coefficients,
                    candidate_budget,
                    previous_adaptive_mean_ids,
                    float(matched_mean_ratio),
                    receipt=adaptive_mean_receipt,
                )
            adaptive_mean_receipt.update({
                "authority": "adaptive-prediction-matched-mean-scalar-hysteresis-v0",
                "predictionSource": ADAPTIVE_PREDICTION_SOURCE,
                "matchedMeanRatio": matched_mean_ratio,
                "adaptiveRatioDistribution": dict(adaptive_receipt["effectiveRatioDistribution"]),
            })
            selections["optical-hysteresis-adaptive-mean"] = adaptive_mean_rows
            selection_receipts["optical-hysteresis-adaptive-mean"] = adaptive_mean_receipt
            if contribution_deposition:
                selections[CONTRIBUTION_DEPOSITION_POLICY] = adaptive_mean_rows.copy()
                selection_receipts[CONTRIBUTION_DEPOSITION_POLICY] = {
                    **adaptive_mean_receipt,
                    "authority": "matched-mean-membership-plus-target-free-contribution-deposition-v0",
                    "membershipPolicy": "optical-hysteresis-adaptive-mean",
                    "depositionPolicy": CONTRIBUTION_DEPOSIT_RULE,
                }
            if contribution_footprint:
                selections[CONTRIBUTION_FOOTPRINT_POLICY] = adaptive_mean_rows.copy()
                selection_receipts[CONTRIBUTION_FOOTPRINT_POLICY] = {
                    **adaptive_mean_receipt,
                    "authority": "matched-mean-membership-plus-target-free-contribution-footprint-v0",
                    "membershipPolicy": "optical-hysteresis-adaptive-mean",
                    "depositionPolicy": CONTRIBUTION_FOOTPRINT_DEPOSIT_RULE,
                }
            previous_adaptive_mean_ids = ids[adaptive_mean_rows].copy()
            require(adaptive_model is not None, "causal adaptive model is missing after training")
            state_scores = optical_energy_scores(coefficients)
            state_order = optical_score_order(ids, state_scores)
            state_entry_threshold = float(state_scores[state_order[candidate_budget - 1]])
            adaptive_features = causal_survival_feature_matrix(
                rows["features"],
                coefficients,
                rows["kernelDescriptors"],
                adaptive_rows,
                state_scores,
                state_entry_threshold,
            )
            current_adaptive_predictions = predict_causal_survival_ridge(adaptive_model, adaptive_features)
            current_adaptive_ids = ids[adaptive_rows].copy()
            state_sequence_index = selected_state_start_index + selected_state_offset
            if state_sequence_index < len(states) - 1:
                destination = stateless_optical_context(states[state_sequence_index + 1], manifest_path, candidate_budget)
                held_labels = native_id_membership_labels(current_adaptive_ids, destination["selectedIds"])
                adaptive_held_predictions.append({
                    "fromStateId": state_id,
                    "toStateId": str(states[state_sequence_index + 1]["id"]),
                    "predictionSource": ADAPTIVE_PREDICTION_SOURCE,
                    "targetAuthority": CAUSAL_SURVIVAL_TARGET_AUTHORITY,
                    "targetPixelsUsed": False,
                    "cameraUsed": False,
                    "predictionReceipt": native_id_float_receipt(current_adaptive_ids, current_adaptive_predictions),
                    "metrics": survival_prediction_metrics(current_adaptive_predictions, held_labels),
                })
            previous_adaptive_ids = current_adaptive_ids
            previous_adaptive_predictions = current_adaptive_predictions
        else:
            selections = fixed_budget_selections(
                ids,
                coefficients,
                budget_fraction,
                candidate_budget=candidate_budget,
                previous_optical_ids=previous_hysteresis_ids,
                hysteresis_ratio=hysteresis_ratio,
                selection_receipts=selection_receipts,
            )
            previous_hysteresis_ids = ids[selections["optical-hysteresis"]].copy()
        target = MOTION.target_image(state, manifest_path)
        target_path = images_dir / f"{state_id}-target.png"
        ORACLE.write_png(target_path, target)
        target_hashes.add(MOTION.sha256_pixels(target))
        arms: dict[str, Any] = {}
        for policy, row_indices in selections.items():
            receipt, temporal = selected_state(
                state,
                manifest_path,
                row_indices,
                path_scale,
                policy,
                images_dir,
                contribution_footprint_minimum_scale,
            )
            receipt["populationRows"] = int(ids.size)
            receipt["budgetFractionEffective"] = float(row_indices.size / ids.size)
            receipt["fullSupportMetrics"] = full_by_state[state_id]["metrics"]
            receipt["selection"] = selection_receipts[policy]
            arms[policy] = receipt
            render_hashes[policy].add(MOTION.sha256_pixels(temporal["render"]))
            previous = previous_by_policy.get(policy)
            if previous is not None:
                temporal_by_policy[policy].append(adjacent_motion_receipt(previous, temporal))
            previous_by_policy[policy] = temporal
        require(len({arm["candidateBudget"] for arm in arms.values()}) == 1, f"{state_id} arms spent unequal candidate budgets")
        require(
            len({arm["nominalDepositEvaluationBudget"] for arm in arms.values()}) == 1,
            f"{state_id} arms evaluated unequal nominal deposit workloads",
        )
        report_states.append({
            "stateId": state_id,
            "steps": int((state.get("replay") or {}).get("completedSteps")),
            "populationRows": int(ids.size),
            "target": str(target_path),
            "arms": arms,
        })

    if mode == "sequence":
        require(len(target_hashes) == len(selected_states), "cached-or-static-render: exact targets are duplicated")
        for policy, hashes in render_hashes.items():
            require(len(hashes) == len(selected_states), f"cached-or-static-render: {policy} renders are duplicated")
    validate_adjacent_state_motion(report_states, temporal_by_policy, policies, mode)

    viewer_rows = []
    for row in report_states:
        viewer_rows.append({
            "stateId": row["stateId"],
            "steps": row["steps"],
            "target": str(Path(row["target"]).relative_to(out_dir)),
            "arms": {
                policy: {
                    "selectedRows": arm["selectedRows"],
                    "metrics": arm["metrics"],
                    "render": str(Path(arm["images"]["render"]).relative_to(out_dir)),
                    "residual": str(Path(arm["images"]["residual"]).relative_to(out_dir)),
                }
                for policy, arm in row["arms"].items()
            },
        })
    require_unchanged_binding(manifest_path, manifest_sha256)
    require_unchanged_binding(motion_report_path, motion_report_sha256)
    implementation_bundle_at_completion = implementation_bundle_receipt()
    require(
        implementation_bundle_at_completion["sha256"] == implementation_bundle_sha256,
        "implementation bundle changed after binding",
    )
    viewer_path = out_dir / "selection-viewer.html"
    report = {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": "fixed-candidate-budget-causal-selection-oracle-v0",
        "mode": mode,
        "source": {
            "implementationBundle": bound_implementation_bundle,
            "implementationBundleAtCompletion": implementation_bundle_at_completion,
            "manifestPath": str(manifest_path),
            "manifestSha256": manifest_sha256,
            "motionReportPath": str(motion_report_path),
            "motionReportSha256": motion_report_sha256,
        },
        "selection": {
            "authority": COMPARISON_AUTHORITY,
            "targetUsedForSelection": False,
            "budgetFractionRequested": budget_fraction,
            "candidateBudget": candidate_budget,
            "budgetAnchorStateId": str(budget_anchor_state["id"]),
            "budgetAnchorPopulation": budget_anchor_population,
            **deposition_work_contract(policies),
            "workEquivalence": "equal-selected-candidates-and-equal-nominal-deposit-evaluations; actual-in-bounds-deposits-reported-as-outcome",
            "policies": policies,
            "hysteresis": ({
                "authority": HYSTERESIS_AUTHORITY,
                "ratio": hysteresis_ratio,
                "entryThreshold": "current-state optical-energy kth score",
                "exitThreshold": "entry-threshold-times-one-minus-ratio",
                "identitySource": "previous selected native-cell ids",
            } if not adaptive_survival else None),
            "fixedHysteresisBaselines": ([
                {
                    "policy": "optical-hysteresis-025",
                    "authority": HYSTERESIS_AUTHORITY,
                    "ratio": 0.25,
                    "entryThreshold": "current-state optical-energy kth score",
                    "exitThreshold": "entry-threshold-times-one-minus-ratio",
                    "identitySource": "previous selected native-cell ids",
                },
                {
                    "policy": "optical-hysteresis-035",
                    "authority": HYSTERESIS_AUTHORITY,
                    "ratio": 0.35,
                    "entryThreshold": "current-state optical-energy kth score",
                    "exitThreshold": "entry-threshold-times-one-minus-ratio",
                    "identitySource": "previous selected native-cell ids",
                },
            ] if adaptive_survival else None),
            "adaptiveSurvival": ({
                "authority": ADAPTIVE_HYSTERESIS_AUTHORITY,
                "predictionSource": ADAPTIVE_PREDICTION_SOURCE,
                "minimumRatio": adaptive_minimum_ratio,
                "maximumRatio": adaptive_maximum_ratio,
                "entryThreshold": "current-state optical-energy kth score",
                "exitThreshold": "per-node entry-threshold-times-one-minus-learned-bounded-ratio",
                "identitySource": "previous selected native-cell ids",
                "targetUsedForSelection": False,
                "cameraUsedForSelection": False,
                "model": adaptive_model_receipt,
                "heldPredictionMetrics": adaptive_held_predictions,
                "matchedMeanControl": {
                    "policy": "optical-hysteresis-adaptive-mean",
                    "authority": "adaptive-prediction-matched-mean-scalar-hysteresis-v0",
                    "ratio": "per-state mean of current-matched bounded adaptive ratios; null uses stateless optical",
                    "nodeHeterogeneity": False,
                    "candidateBudgetMatched": True,
                    "nominalDepositWorkMatched": True,
                },
                "contributionDeposition": ({
                    "policy": CONTRIBUTION_DEPOSITION_POLICY,
                    "membershipPolicy": "optical-hysteresis-adaptive-mean",
                    "scoreAuthority": CONTRIBUTION_SCORE_AUTHORITY,
                    "quotaAuthority": CONTRIBUTION_QUOTA_AUTHORITY,
                    "tapCounts": [3, 5, 7],
                    "tapPatterns": CONTRIBUTION_TAP_PATTERNS,
                    "allocationAndFootprintSpacingCoupled": True,
                    "candidateBudgetMatched": True,
                    "nominalDepositWorkMatched": True,
                    "targetUsedForDeposition": False,
                } if contribution_deposition else None),
                "contributionFootprint": ({
                    "policy": CONTRIBUTION_FOOTPRINT_POLICY,
                    "membershipPolicy": "optical-hysteresis-adaptive-mean",
                    "scoreAuthority": CONTRIBUTION_SCORE_AUTHORITY,
                    "quotaAuthority": CONTRIBUTION_QUOTA_AUTHORITY,
                    "tapCount": FLOW_TAPS_PER_CANDIDATE,
                    "tapWeights": CONTRIBUTION_TAP_PATTERNS[5]["weights"],
                    "requestedMinimumScale": contribution_footprint_minimum_scale,
                    "effectiveMinimumScaleByState": {
                        row["stateId"]: row["arms"][CONTRIBUTION_FOOTPRINT_POLICY]["contributionFootprint"]["effectiveMinimumFootprintScale"]
                        for row in report_states
                    },
                    "allocationAndFootprintSpacingCoupled": False,
                    "candidateBudgetMatched": True,
                    "nominalDepositWorkMatched": True,
                    "actualInBoundsDepositsReportedAsOutcome": True,
                    "targetUsedForDeposition": False,
                } if contribution_footprint else None),
            } if adaptive_survival else None),
        },
        "transport": {
            "depthBins": MOTION.DEPTH_BINS,
            "pathScale": path_scale,
            "pathScaleSource": "exact-full-support-sequence-global-calibration-v0",
            "perArmRefit": False,
            "perStateRefit": False,
        },
        "states": report_states,
        "adjacentStateMotion": temporal_by_policy,
        "selectionViewer": str(viewer_path),
    }
    viewer_html = selection_viewer(viewer_rows, policies, {
        "status": "complete",
        "manifestSha256": manifest_sha256,
        "motionReportSha256": motion_report_sha256,
        "implementationBundleSha256": implementation_bundle_sha256,
    })
    return report, viewer_html


def main() -> int:
    global BOUND_IMPLEMENTATION_PAYLOADS
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--motion-report", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--implementation-bundle-sha256", required=True)
    parser.add_argument("--budget-fraction", type=float, default=0.25)
    parser.add_argument("--hysteresis-ratio", type=float, default=0.1)
    parser.add_argument("--adaptive-survival", action="store_true")
    parser.add_argument("--adaptive-minimum-ratio", type=float, default=0.25)
    parser.add_argument("--adaptive-maximum-ratio", type=float, default=0.35)
    parser.add_argument("--adaptive-training-transitions", type=int, default=7)
    parser.add_argument("--adaptive-calibration-transitions", type=int, default=1)
    parser.add_argument("--adaptive-ridge-alpha", type=float, default=1e-3)
    parser.add_argument("--contribution-deposition", action="store_true")
    parser.add_argument("--contribution-footprint", action="store_true")
    parser.add_argument("--contribution-footprint-minimum-scale", type=float, default=CONTRIBUTION_FOOTPRINT_MINIMUM_SCALE)
    parser.add_argument("--mode", choices=("frozen", "sequence"), default="frozen")
    args = parser.parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    motion_report_path = Path(args.motion_report).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    implementation_bundle_sha256 = str(args.implementation_bundle_sha256).lower()
    failure_phase = "visual-evidence-invalidation"
    last_trustworthy_evidence: dict[str, Any] = {
        "implementationPath": str(IMPLEMENTATION_PATH),
        "implementationBundleSha256Expected": implementation_bundle_sha256,
        "manifestPath": str(manifest_path),
        "motionReportPath": str(motion_report_path),
    }
    try:
        invalidate_visual_evidence(out_dir)
        failure_phase = "implementation-binding"
        require(len(implementation_bundle_sha256) == 64 and all(character in "0123456789abcdef" for character in implementation_bundle_sha256), "implementation bundle SHA-256 must be 64 lowercase hexadecimal characters")
        implementation_bundle_at_start, implementation_payloads = capture_implementation_bundle()
        last_trustworthy_evidence["implementationBundleAtStart"] = implementation_bundle_at_start
        require(implementation_bundle_at_start["sha256"] == implementation_bundle_sha256, "launched implementation bundle does not match the externally bound SHA-256")
        BOUND_IMPLEMENTATION_PAYLOADS = implementation_payloads
        failure_phase = "source-validation"
        require(manifest_path.is_file(), f"manifest is missing: {manifest_path}")
        require(motion_report_path.is_file(), f"motion report is missing: {motion_report_path}")
        manifest, manifest_sha256 = load_json_binding(manifest_path)
        motion_report, motion_report_sha256 = load_json_binding(motion_report_path)
        validate_source_contract(manifest, motion_report, manifest_sha256)
        last_trustworthy_evidence["validatedSource"] = {
            "manifestSha256": manifest_sha256,
            "motionReportSha256": motion_report_sha256,
            "motionReportStatus": motion_report.get("status"),
        }
        failure_phase = "runtime-initialization"
        initialize_runtime()
        failure_phase = "fixed-budget-render"
        report, viewer_html = run(
            manifest_path,
            motion_report_path,
            manifest,
            manifest_sha256,
            motion_report,
            motion_report_sha256,
            out_dir,
            args.budget_fraction,
            args.mode,
            args.hysteresis_ratio,
            args.adaptive_survival,
            args.adaptive_minimum_ratio,
            args.adaptive_maximum_ratio,
            args.adaptive_training_transitions,
            args.adaptive_calibration_transitions,
            args.adaptive_ridge_alpha,
            args.contribution_deposition,
            args.contribution_footprint,
            args.contribution_footprint_minimum_scale,
            implementation_bundle_sha256,
            implementation_bundle_at_start,
        )
        last_trustworthy_evidence.update(report["source"])
        failure_phase = "report-publication"
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        failure_phase = "visual-evidence-publication"
        Path(report["selectionViewer"]).write_text(viewer_html)
        print(json.dumps({"status": "complete", "reportPath": str(report_path), "selectionViewer": report["selectionViewer"]}, indent=2))
        return 0
    except Exception as error:
        try:
            last_trustworthy_evidence["implementationBundleAtFailure"] = implementation_bundle_receipt()
        except OSError as digest_error:
            last_trustworthy_evidence["implementationSha256AtFailureError"] = str(digest_error)
        failure = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "reason": str(error),
            "lastTrustworthyEvidence": last_trustworthy_evidence,
            "traceback": traceback.format_exc(),
        }
        try:
            invalidate_visual_evidence(out_dir)
            failure["visualEvidenceDisposition"] = "invalidated"
        except Exception as cleanup_error:
            failure["visualEvidenceDisposition"] = "failed-tombstone-written"
            failure["visualEvidenceInvalidationError"] = str(cleanup_error)
            try:
                write_failed_visual_tombstone(out_dir, failure)
            except Exception as tombstone_error:
                failure["visualEvidenceDisposition"] = "tombstone-write-failed"
                failure["visualEvidenceTombstoneError"] = str(tombstone_error)
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps(failure, indent=2))
        return 1


def execute_bound_main() -> int:
    _, payloads = capture_implementation_bundle()
    module = load_bound_budget_module(payloads)
    return int(module.main())


if __name__ == "__main__":
    raise SystemExit(main() if BOUND_SELF_EXECUTION else execute_bound_main())
