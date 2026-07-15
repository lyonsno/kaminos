#!/usr/bin/env python3
"""Learn which already-admitted low-grid boundary splats should survive."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.boundary-splat-survival-probe.v0"
IDENTITY = "candidate-only-exact-cell-survival-v0"
LABEL_AUTHORITY = "exact-low-candidate-cell-in-high-accepted-set-v0"
SPLIT_IDENTITY = "spatial-block-hash-holdout-v0"
SPLIT_GUARD_IDENTITY = "pointwise-candidate-feature-zero-radius-guard-v0"
KEEP_ALL_IDENTITY = "keep-all-low-candidates-control-v0"
MLP_IDENTITY = "tiny-binary-mlp-candidate-survival-v0"
THRESHOLD_IDENTITY = "uncapped-validation-jaccard-threshold-sweep-v0"
ANTI_COLLAPSE_IDENTITY = "minimum-recall-survival-gate-v0"
DENSE_AUTHORITY = "validation-selected-candidate-survival-mask-v0"
DENSE_CHANNEL = "boundarySplatSurvivalMask"
CHECKPOINT_AUTHORITY = "checkpoint-plus-checksum-bound-candidate-survival-v0"
REPLAY_STATUS = "source-target-bound-verified"


def load_local_module(name: str, filename: str):
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load local module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_displacement = load_local_module("kaminos_displacement_probe_helpers", "volume-boundary-splat-displacement-probe.py")
_support = load_local_module("kaminos_support_probe_helpers", "volume-exact-basin-support-probe.py")
ProbeFailure = _displacement.ProbeFailure


def write_json(path: Path, payload: dict[str, Any]) -> None:
    _displacement.write_json(path, payload)


def sha256_bytes(value: bytes) -> str:
    return _displacement.sha256_bytes(value)


def sha256_file(path: Path) -> str:
    return _displacement.sha256_file(path)


def spatial_split(coords: np.ndarray, block_size: int, seed: int) -> tuple[np.ndarray, dict[str, Any]]:
    roles = _displacement.spatial_roles(coords, block_size, seed)
    receipt = {
        "identity": SPLIT_IDENTITY,
        "guardBandIdentity": SPLIT_GUARD_IDENTITY,
        "guardRadius": 0,
        "spatialBlockSize": max(1, int(block_size)),
        "hashConstants": [73856093, 19349663, 83492791],
        "hashSeed": int(seed),
        "roleBins": {"test": [0, 1], "validation": [2, 3], "train": [4, 5, 6, 7, 8, 9]},
        "roleAuthority": "whole spatial blocks; pointwise candidate features and exact-cell labels require no neighborhood guard",
        "guardBandRows": 0,
        "activeRows": int(coords.shape[0]),
        "testRows": int(np.count_nonzero(roles == 0)),
        "validationRows": int(np.count_nonzero(roles == 1)),
        "trainRows": int(np.count_nonzero(roles == 2)),
    }
    if min(receipt["testRows"], receipt["validationRows"], receipt["trainRows"]) <= 0:
        raise ProbeFailure("dataset-split", "spatial split produced an empty role", receipt)
    return roles, receipt


def validate_split_class_coverage(labels: np.ndarray, roles: np.ndarray) -> dict[str, Any]:
    labels = np.asarray(labels, dtype=np.bool_)
    roles = np.asarray(roles, dtype=np.int8)
    if labels.shape != roles.shape:
        raise ProbeFailure("dataset-split", "labels and spatial roles have different shapes")
    coverage: dict[str, Any] = {}
    for name, role in (("test", 0), ("validation", 1), ("train", 2)):
        role_labels = labels[roles == role]
        coverage[name] = {
            "rowCount": int(role_labels.size),
            "positiveLabelCount": int(np.count_nonzero(role_labels)),
            "negativeLabelCount": int(np.count_nonzero(~role_labels)),
        }
    invalid = {
        name: values
        for name, values in coverage.items()
        if values["positiveLabelCount"] == 0 or values["negativeLabelCount"] == 0
    }
    if invalid:
        raise ProbeFailure(
            "dataset-split",
            "every spatial role must contain both positive and negative candidate-membership labels",
            {"roles": coverage, "invalidRoles": sorted(invalid)},
        )
    return coverage


def survival_metrics(keep: np.ndarray, labels: np.ndarray, threshold: float | None = None) -> dict[str, Any]:
    keep = np.asarray(keep, dtype=np.bool_)
    truth = np.asarray(labels, dtype=np.bool_)
    if keep.shape != truth.shape:
        raise ProbeFailure("evaluation", "survival mask and labels have different shapes")
    true_positive = int(np.count_nonzero(keep & truth))
    false_positive = int(np.count_nonzero(keep & ~truth))
    false_negative = int(np.count_nonzero(~keep & truth))
    true_negative = int(np.count_nonzero(~keep & ~truth))
    precision = true_positive / max(1, true_positive + false_positive)
    recall = true_positive / max(1, true_positive + false_negative)
    union = true_positive + false_positive + false_negative
    jaccard = true_positive / max(1, union)
    result = {
        "rowCount": int(truth.size),
        "positiveLabelCount": int(np.count_nonzero(truth)),
        "negativeLabelCount": int(np.count_nonzero(~truth)),
        "keptCandidateCount": int(np.count_nonzero(keep)),
        "removedCandidateCount": int(np.count_nonzero(~keep)),
        "truePositive": true_positive,
        "falsePositive": false_positive,
        "falseNegative": false_negative,
        "trueNegative": true_negative,
        "precision": float(precision),
        "recall": float(recall),
        "jaccard": float(jaccard),
        "exactOverlapRetained": true_positive,
        "lowOnlyRemoved": true_negative,
        "exactOverlapLost": false_negative,
        "duplicateDestinationCount": 0,
    }
    if threshold is not None:
        result["threshold"] = float(threshold)
    return result


def select_survival_threshold(
    probability: np.ndarray,
    labels: np.ndarray,
    minimum_recall: float,
) -> dict[str, Any]:
    probability = np.asarray(probability, dtype=np.float32).reshape(-1)
    labels = np.asarray(labels, dtype=np.bool_).reshape(-1)
    if probability.shape != labels.shape or probability.size == 0:
        raise ProbeFailure("threshold-selection", "validation probability and label rows are incoherent")
    if not np.all(np.isfinite(probability)):
        raise ProbeFailure("threshold-selection", "validation probability contains non-finite values")
    minimum_recall = float(minimum_recall)
    if minimum_recall < 0.0 or minimum_recall > 1.0:
        raise ProbeFailure("arguments", "minimum recall must be in [0, 1]")

    unique = np.unique(probability.astype(np.float64))[::-1]
    no_keep_threshold = float(np.nextafter(np.float32(unique[0]), np.float32(math.inf)))
    thresholds = np.concatenate([[no_keep_threshold], unique])
    points: list[dict[str, Any]] = []
    eligible: list[dict[str, Any]] = []
    for threshold in thresholds.tolist():
        metrics = survival_metrics(probability >= np.float32(threshold), labels, threshold)
        point = {
            "threshold": float(threshold),
            "keptCandidateCount": metrics["keptCandidateCount"],
            "metrics": metrics,
            "eligibleUnderMinimumRecall": bool(metrics["recall"] + 1.0e-12 >= minimum_recall),
        }
        points.append(point)
        if point["eligibleUnderMinimumRecall"]:
            eligible.append(point)
    if not eligible:
        raise ProbeFailure("threshold-selection", "no validation threshold satisfies the minimum recall floor", {
            "minimumRecall": minimum_recall,
            "positiveLabelCount": int(np.count_nonzero(labels)),
        })
    selected = max(
        eligible,
        key=lambda point: (
            point["metrics"]["jaccard"],
            point["metrics"]["precision"],
            -point["keptCandidateCount"],
            point["threshold"],
        ),
    )
    return {
        "identity": THRESHOLD_IDENTITY,
        "antiCollapseIdentity": ANTI_COLLAPSE_IDENTITY,
        "selectedOn": "validation",
        "testDataUsedForSelection": False,
        "minimumRecall": minimum_recall,
        "capped": False,
        "pointCount": len(points),
        "points": points,
        "eligiblePointCount": len(eligible),
        "selected": selected,
        "threshold": selected["threshold"],
    }


def role_metrics(
    keep_all: np.ndarray,
    learned_keep: np.ndarray,
    labels: np.ndarray,
    roles: np.ndarray,
) -> tuple[dict[str, Any], dict[str, Any]]:
    masks = {
        "validation": roles == 1,
        "test": roles == 0,
        "train": roles == 2,
        "all": np.ones(roles.shape, dtype=np.bool_),
    }
    control: dict[str, Any] = {}
    learned: dict[str, Any] = {}
    for name, mask in masks.items():
        control[name] = survival_metrics(keep_all[mask], labels[mask])
        learned[name] = survival_metrics(learned_keep[mask], labels[mask])
        learned[name]["jaccardDeltaVsKeepAll"] = learned[name]["jaccard"] - control[name]["jaccard"]
        learned[name]["candidateCountDeltaVsKeepAll"] = (
            learned[name]["keptCandidateCount"] - control[name]["keptCandidateCount"]
        )
    return control, learned


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--low-manifest", required=True)
    parser.add_argument("--high-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--spatial-block-size", type=int, default=18)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--minimum-recall", type=float, default=0.9)
    parser.add_argument("--seed", type=int, default=9413)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    phase = "arguments"
    try:
        low_path = Path(args.low_manifest).resolve()
        high_path = Path(args.high_manifest).resolve()
        phase = "input-validation"
        low = _displacement.load_export(low_path, require_fields=True)
        high = _displacement.load_export(high_path, require_fields=False)
        if low["grid"] != high["grid"]:
            raise ProbeFailure("input-validation", "low/high grids differ", {
                "lowGrid": low["grid"], "highGrid": high["grid"],
            })
        if low["manifest"].get("effectiveRoute") != high["manifest"].get("effectiveRoute"):
            raise ProbeFailure("input-validation", "low/high effective routes differ")
        source_pair = _displacement.matched_source_capture(low, high)

        phase = "dataset-construction"
        grid = low["grid"]
        low_indexes, low_coords = _displacement.decode_cells(low["splats"], grid)
        high_indexes, _ = _displacement.decode_cells(high["splats"], grid)
        high_set = set(int(value) for value in high_indexes.tolist())
        labels = np.asarray([int(value) in high_set for value in low_indexes.tolist()], dtype=np.bool_)
        features, feature_receipt = _displacement.build_features(low, low_indexes, low_coords)
        roles, split_receipt = spatial_split(low_coords, args.spatial_block_size, args.seed)
        split_receipt["classCoverage"] = validate_split_class_coverage(labels, roles)
        train_mask = roles == 2
        validation_mask = roles == 1
        test_mask = roles == 0

        phase = "feature-standardization"
        train_features, normalized, normalization = _displacement.standardize(
            features[train_mask], features[validation_mask], features[test_mask], features,
        )
        validation_features, test_features, all_features = normalized

        phase = "model-fit"
        rng = np.random.default_rng(args.seed)
        mlp_state, mlp_training = _support.train_mlp(
            train_features,
            labels[train_mask].astype(np.float32),
            args,
            rng,
            binary=True,
        )
        validation_probability = _support.predict_mlp(validation_features, mlp_state, binary=True)
        test_probability = _support.predict_mlp(test_features, mlp_state, binary=True)
        all_probability = _support.predict_mlp(all_features, mlp_state, binary=True)

        phase = "threshold-selection"
        calibration = select_survival_threshold(
            validation_probability,
            labels[validation_mask],
            minimum_recall=args.minimum_recall,
        )
        threshold = float(calibration["threshold"])
        learned_keep = all_probability >= np.float32(threshold)
        keep_all = np.ones(labels.shape, dtype=np.bool_)
        control_metrics, learned_metrics = role_metrics(keep_all, learned_keep, labels, roles)

        phase = "checkpoint-write"
        source_candidate_indexes_sha = sha256_bytes(low_indexes.astype("<i8", copy=False).tobytes(order="C"))
        high_candidate_indexes_sha = sha256_bytes(high_indexes.astype("<i8", copy=False).tobytes(order="C"))
        label_vector_sha = sha256_bytes(labels.astype(np.uint8, copy=False).tobytes(order="C"))
        checkpoint_path = out_dir / "survival-model.npz"
        np.savez_compressed(
            checkpoint_path,
            schema=np.asarray([SCHEMA]),
            identity=np.asarray([IDENTITY]),
            labelAuthority=np.asarray([LABEL_AUTHORITY]),
            normalizationMean=normalization["mean"],
            normalizationStd=normalization["std"],
            mlpW1=mlp_state["w1"],
            mlpB1=mlp_state["b1"],
            mlpW2=mlp_state["w2"],
            mlpB2=mlp_state["b2"],
            threshold=np.asarray([threshold], dtype=np.float32),
            minimumRecall=np.asarray([args.minimum_recall], dtype=np.float32),
            sourceManifestSha256=np.asarray([low["sha256"]]),
            sourcePayloadSha256=np.asarray([source_pair["payloadSha256"]]),
            sourceCandidateIndexesSha256=np.asarray([source_candidate_indexes_sha]),
            targetManifestSha256=np.asarray([high["sha256"]]),
            targetCandidateIndexesSha256=np.asarray([high_candidate_indexes_sha]),
            targetLabelVectorSha256=np.asarray([label_vector_sha]),
        )

        phase = "checkpoint-replay"
        with np.load(checkpoint_path, allow_pickle=False) as replay:
            replay_features = (
                (features - replay["normalizationMean"].astype(np.float32))
                / replay["normalizationStd"].astype(np.float32)
            ).astype(np.float32)
            replay_state = {
                "w1": replay["mlpW1"].astype(np.float32),
                "b1": replay["mlpB1"].astype(np.float32),
                "w2": replay["mlpW2"].astype(np.float32),
                "b2": replay["mlpB2"].astype(np.float32),
                "targetMean": 0.0,
                "targetStd": 1.0,
            }
            replay_probability = _support.predict_mlp(replay_features, replay_state, binary=True)
            replay_threshold = float(replay["threshold"][0])
            replay_keep = replay_probability >= np.float32(replay_threshold)
            replay_binding = {
                "lowManifestSha256": str(replay["sourceManifestSha256"][0]),
                "sourcePayloadSha256": str(replay["sourcePayloadSha256"][0]),
                "candidateIndexesSha256": str(replay["sourceCandidateIndexesSha256"][0]),
            }
            replay_target_binding = {
                "highManifestSha256": str(replay["targetManifestSha256"][0]),
                "highCandidateIndexesSha256": str(replay["targetCandidateIndexesSha256"][0]),
                "labelVectorSha256": str(replay["targetLabelVectorSha256"][0]),
            }
        effective_binding = {
            "lowManifestSha256": low["sha256"],
            "sourcePayloadSha256": source_pair["payloadSha256"],
            "candidateIndexesSha256": source_candidate_indexes_sha,
        }
        effective_target_binding = {
            "highManifestSha256": high["sha256"],
            "highCandidateIndexesSha256": high_candidate_indexes_sha,
            "labelVectorSha256": label_vector_sha,
        }
        source_binding_parity = replay_binding == effective_binding
        target_binding_parity = replay_target_binding == effective_target_binding
        threshold_parity = bool(np.float32(replay_threshold) == np.float32(threshold))
        probability_parity = bool(np.array_equal(replay_probability, all_probability))
        keep_mask_parity = bool(np.array_equal(replay_keep, learned_keep))
        if not source_binding_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint source binding differs", {
                "expected": effective_binding, "actual": replay_binding,
            })
        if not target_binding_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint target binding differs", {
                "expected": effective_target_binding, "actual": replay_target_binding,
            })
        if not threshold_parity or not probability_parity or not keep_mask_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint does not reproduce the survival gate", {
                "thresholdParity": threshold_parity,
                "probabilityParity": probability_parity,
                "keepMaskParity": keep_mask_parity,
            })

        phase = "dense-output-write"
        dense = np.zeros(grid ** 3, dtype="<f4")
        dense[low_indexes] = replay_keep.astype(np.float32)
        dense_path = out_dir / "boundary-splat-survival-mask.f32"
        dense_bytes = dense.tobytes(order="C")
        dense_path.write_bytes(dense_bytes)
        dense_artifact = {
            "path": str(dense_path),
            "sha256": sha256_bytes(dense_bytes),
            "byteLength": len(dense_bytes),
            "shape": [grid, grid, grid, 1],
            "channelOrder": [DENSE_CHANNEL],
            "authority": DENSE_AUTHORITY,
            "applicationIdentity": "survival-only-remove-rejected-low-candidates-v0",
            "candidateCount": int(low_indexes.size),
            "keptCandidateCount": int(np.count_nonzero(replay_keep)),
            "removedCandidateCount": int(np.count_nonzero(~replay_keep)),
            "nonCandidatePolicy": "zero",
            "candidateMutationPolicy": "keep-or-remove only; no birth, move, or attribute mutation",
        }

        overlap = int(np.count_nonzero(labels))
        checkpoint = {
            "path": str(checkpoint_path),
            "sha256": sha256_file(checkpoint_path),
            "byteLength": checkpoint_path.stat().st_size,
            "targetDataUsedForTraining": True,
            "targetDataUsedForCalibration": True,
            "testDataUsedForSelection": False,
            "sourceBinding": {**effective_binding, "authority": CHECKPOINT_AUTHORITY},
            "targetBinding": {**effective_target_binding, "authority": CHECKPOINT_AUTHORITY},
            "threshold": threshold,
            "minimumRecall": float(args.minimum_recall),
            "replay": {
                "status": REPLAY_STATUS,
                "sourceBindingParity": source_binding_parity,
                "targetBindingParity": target_binding_parity,
                "thresholdParity": threshold_parity,
                "probabilityParity": probability_parity,
                "keepMaskParity": keep_mask_parity,
                "outputSha256": dense_artifact["sha256"],
            },
        }
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "source": {
                "lowManifest": {"path": str(low_path), "sha256": low["sha256"]},
                "highManifest": {"path": str(high_path), "sha256": high["sha256"]},
                "sourcePair": source_pair,
                "grid": grid,
                "effectiveRoute": low["manifest"].get("effectiveRoute"),
                "lowBackend": low["manifest"].get("backend"),
                "highBackend": high["manifest"].get("backend"),
                "lowArtifacts": {
                    "fluid": low["fluidArtifact"],
                    "boundary": low["boundaryArtifact"],
                    "splats": low["splatArtifact"],
                },
                "highArtifacts": {"splats": high["splatArtifact"]},
            },
            "dataset": {
                "identity": IDENTITY,
                "labelAuthority": LABEL_AUTHORITY,
                "featureAuthority": feature_receipt,
                "lowCandidateCount": int(low_indexes.size),
                "highCandidateCount": int(high_indexes.size),
                "exactOverlapCount": overlap,
                "lowOnlyCount": int(low_indexes.size - overlap),
                "highOnlyCount": int(high_indexes.size - overlap),
                "positiveLabelCount": overlap,
                "negativeLabelCount": int(low_indexes.size - overlap),
                "candidateMutationPolicy": "survival only",
            },
            "split": split_receipt,
            "models": {
                "keepAll": {"identity": KEEP_ALL_IDENTITY, **control_metrics},
                "mlpSurvival": {
                    "identity": MLP_IDENTITY,
                    "training": mlp_training,
                    "calibration": calibration,
                    **learned_metrics,
                },
            },
            "denseOutputs": {"boundarySplatSurvivalMask": dense_artifact},
            "checkpoint": checkpoint,
            "producer": {
                "script": {"path": str(Path(__file__).resolve()), "sha256": sha256_file(Path(__file__).resolve())},
                "arguments": vars(args),
            },
            "limitations": [
                "same-state train-role exact-high membership labels enter fitting",
                "guarded validation membership selects the threshold; held test remains audit-only",
                "the gate can only remove already-admitted low candidates",
                "the gate cannot birth or move splats, alter attributes, or mutate simulator fields",
                "same-replay spatial holdout does not establish cross-replay or cross-basin transfer",
            ],
        }
        write_json(manifest_path, report)
        print(json.dumps({"ok": True, "manifest": str(manifest_path), "checkpoint": checkpoint}, indent=2))
        return 0
    except ProbeFailure as error:
        write_json(manifest_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": error.phase,
            "error": {"name": type(error).__name__, "message": str(error), "details": error.details},
            "arguments": vars(args),
        })
        print(f"{error.phase}: {error}", file=sys.stderr)
        return 1
    except Exception as error:
        write_json(manifest_path, {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": {"name": type(error).__name__, "message": str(error)},
            "arguments": vars(args),
        })
        raise


if __name__ == "__main__":
    raise SystemExit(main())
