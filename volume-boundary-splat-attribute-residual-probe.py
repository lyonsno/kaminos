#!/usr/bin/env python3
"""Learn source-conditioned color/opacity residuals for frozen surviving splats."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.boundary-splat-attribute-residual-probe.v0"
IDENTITY = "survival-conditioned-exact-cell-color-opacity-residual-v0"
SURVIVAL_AUTHORITY = "validation-selected-candidate-survival-mask-v0"
TARGET_AUTHORITY = "same-cell-high-splat-color-opacity-v0"
LOW_COPY_IDENTITY = "low-copy-color-opacity-control-v0"
LINEAR_IDENTITY = "linear-residual-color-opacity-v0"
MLP_IDENTITY = "tiny-mlp-residual-color-opacity-v0"
DENSE_AUTHORITY = "survival-conditioned-color-opacity-grid-v0"
CHECKPOINT_AUTHORITY = "checkpoint-plus-checksum-bound-survival-conditioned-attributes-v0"
REPLAY_STATUS = "source-target-survival-bound-verified"
TARGET_CHANNELS = ["color.r", "color.g", "color.b", "opacity"]
TARGET_COLUMNS = np.asarray([4, 5, 6, 7], dtype=np.int64)
OUTPUT_MIN = np.asarray([0.0, 0.0, 0.0, 0.0], dtype=np.float32)
OUTPUT_MAX = np.asarray([1.0, 1.0, 1.0, 0.08], dtype=np.float32)


def load_local_module(name: str, filename: str):
    path = Path(__file__).resolve().with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load local module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_displacement = load_local_module(
    "kaminos_attribute_displacement_helpers",
    "volume-boundary-splat-displacement-probe.py",
)
_support = load_local_module(
    "kaminos_attribute_support_helpers",
    "volume-exact-basin-support-probe.py",
)
ProbeFailure = _displacement.ProbeFailure


def sha256_bytes(value: bytes) -> str:
    return _displacement.sha256_bytes(value)


def sha256_file(path: Path) -> str:
    return _displacement.sha256_file(path)


def write_json(path: Path, payload: dict[str, Any]) -> None:
    _displacement.write_json(path, payload)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--low-manifest", required=True)
    parser.add_argument("--high-manifest", required=True)
    parser.add_argument("--survival-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--spatial-block-size", type=int, default=18)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=36)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--ridge-alpha", type=float, default=1.0e-3)
    parser.add_argument("--seed", type=int, default=9517)
    return parser.parse_args()


def resolve_descriptor_path(descriptor: dict[str, Any], manifest_path: Path) -> Path:
    raw = descriptor.get("path")
    if not isinstance(raw, str) or not raw:
        raise ProbeFailure("survival-binding", "survival mask descriptor is missing a path")
    path = Path(raw)
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def load_survival(
    path: Path,
    low: dict[str, Any],
    high: dict[str, Any],
    low_indexes: np.ndarray,
) -> dict[str, Any]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        raise ProbeFailure("survival-binding", f"cannot read survival manifest: {error}") from error
    if manifest.get("schema") != "kaminos.volume.boundary-splat-survival-probe.v0":
        raise ProbeFailure("survival-binding", "unsupported survival manifest schema")
    if manifest.get("status") != "captured" or manifest.get("failurePhase") is not None:
        raise ProbeFailure("survival-binding", "survival manifest is not captured and failure-free")
    source = manifest.get("source") or {}
    source_low = source.get("lowManifest") or {}
    source_high = source.get("highManifest") or {}
    if source_low.get("sha256") != low["sha256"]:
        raise ProbeFailure("survival-binding", "survival low manifest sha256 does not match effective low source", {
            "expected": low["sha256"], "actual": source_low.get("sha256"),
        })
    if source_high.get("sha256") != high["sha256"]:
        raise ProbeFailure("survival-binding", "survival high manifest sha256 does not match effective high target", {
            "expected": high["sha256"], "actual": source_high.get("sha256"),
        })
    if int(source.get("grid") or 0) != low["grid"]:
        raise ProbeFailure("survival-binding", "survival grid does not match source grid")
    source_pair = source.get("sourcePair") or {}
    low_payload = ((low["manifest"].get("sourceCapture") or {}).get("payloadSha256"))
    if source_pair.get("payloadSha256") != low_payload:
        raise ProbeFailure("survival-binding", "survival source payload does not match low/high source state")

    descriptor = ((manifest.get("denseOutputs") or {}).get("boundarySplatSurvivalMask") or {})
    expected_shape = [low["grid"], low["grid"], low["grid"], 1]
    if descriptor.get("shape") != expected_shape:
        raise ProbeFailure("survival-binding", "survival mask shape does not match source grid", {
            "expected": expected_shape, "actual": descriptor.get("shape"),
        })
    if descriptor.get("channelOrder") != ["boundarySplatSurvivalMask"]:
        raise ProbeFailure("survival-binding", "survival mask channel order is not exact")
    if descriptor.get("authority") != SURVIVAL_AUTHORITY:
        raise ProbeFailure("survival-binding", "survival mask authority is not accepted")
    mask_path = resolve_descriptor_path(descriptor, path)
    if not mask_path.is_file():
        raise ProbeFailure("survival-binding", "survival mask artifact does not exist", {"path": str(mask_path)})
    mask_bytes = mask_path.read_bytes()
    expected_bytes = low["grid"] ** 3 * 4
    if len(mask_bytes) != expected_bytes or descriptor.get("byteLength") != len(mask_bytes):
        raise ProbeFailure("survival-binding", "survival mask byte length is incoherent", {
            "expected": expected_bytes, "actual": len(mask_bytes),
        })
    mask_sha = sha256_bytes(mask_bytes)
    if descriptor.get("sha256") != mask_sha:
        raise ProbeFailure("survival-binding", "survival mask checksum mismatch")
    replay = ((manifest.get("checkpoint") or {}).get("replay") or {})
    checkpoint = manifest.get("checkpoint") or {}
    checkpoint_source = checkpoint.get("sourceBinding") or {}
    checkpoint_target = checkpoint.get("targetBinding") or {}
    if checkpoint_source.get("lowManifestSha256") != low["sha256"]:
        raise ProbeFailure("survival-binding", "survival checkpoint source binding does not match low manifest")
    if checkpoint_target.get("highManifestSha256") != high["sha256"]:
        raise ProbeFailure("survival-binding", "survival checkpoint target binding does not match high manifest")
    required_replay_truth = (
        "sourceBindingParity",
        "targetBindingParity",
        "thresholdParity",
        "probabilityParity",
        "keepMaskParity",
    )
    if replay.get("status") != "source-target-bound-verified" or any(
        replay.get(key) is not True for key in required_replay_truth
    ):
        raise ProbeFailure("survival-binding", "survival checkpoint replay is not source-target bound and verified", {
            "status": replay.get("status"),
            "requiredTrueFields": list(required_replay_truth),
        })
    if replay.get("outputSha256") != mask_sha:
        raise ProbeFailure("survival-binding", "survival checkpoint replay does not bind the effective mask")
    mask = np.frombuffer(mask_bytes, dtype="<f4").copy()
    if not np.all(np.isfinite(mask)) or not np.all((mask == 0.0) | (mask == 1.0)):
        raise ProbeFailure("survival-binding", "survival mask must contain finite binary float32 values")
    candidate_keep = mask[low_indexes] == np.float32(1.0)
    kept = int(np.count_nonzero(candidate_keep))
    if descriptor.get("candidateCount") != int(low_indexes.size):
        raise ProbeFailure("survival-binding", "survival candidate count does not match low splats")
    if descriptor.get("keptCandidateCount") != kept:
        raise ProbeFailure("survival-binding", "survival kept count does not match mask contents")
    return {
        "manifest": manifest,
        "manifestPath": str(path),
        "manifestSha256": sha256_file(path),
        "mask": mask,
        "candidateKeep": candidate_keep,
        "maskArtifact": {
            "path": str(mask_path),
            "sha256": mask_sha,
            "byteLength": len(mask_bytes),
            "shape": expected_shape,
            "authority": SURVIVAL_AUTHORITY,
            "candidateCount": int(low_indexes.size),
            "keptCandidateCount": kept,
        },
    }


def spatial_split(pair_coords: np.ndarray, block_size: int, seed: int) -> tuple[np.ndarray, dict[str, Any]]:
    roles = _displacement.spatial_roles(pair_coords, block_size, seed)
    receipt = {
        "identity": "spatial-block-hash-holdout-v0",
        "guardBandIdentity": "pointwise-candidate-feature-zero-radius-guard-v0",
        "guardRadius": 0,
        "spatialBlockSize": max(1, int(block_size)),
        "hashConstants": [73856093, 19349663, 83492791],
        "hashSeed": int(seed),
        "roleBins": {"test": [0, 1], "validation": [2, 3], "train": [4, 5, 6, 7, 8, 9]},
        "roleAuthority": "whole spatial blocks over exact same-cell surviving pairs; pointwise features require no neighborhood guard",
        "guardBandRows": 0,
        "activeRows": int(pair_coords.shape[0]),
        "testRows": int(np.count_nonzero(roles == 0)),
        "validationRows": int(np.count_nonzero(roles == 1)),
        "trainRows": int(np.count_nonzero(roles == 2)),
        "testDataUsedForSelection": False,
    }
    if min(receipt["testRows"], receipt["validationRows"], receipt["trainRows"]) <= 0:
        raise ProbeFailure("dataset-split", "spatial split produced an empty role", receipt)
    return roles, receipt


def clip_attributes(values: np.ndarray) -> np.ndarray:
    return np.clip(values, OUTPUT_MIN.reshape(1, -1), OUTPUT_MAX.reshape(1, -1)).astype(np.float32)


def metric_block(predicted: np.ndarray, target: np.ndarray) -> dict[str, Any]:
    predicted = np.asarray(predicted, dtype=np.float32)
    target = np.asarray(target, dtype=np.float32)
    if predicted.shape != target.shape or predicted.ndim != 2 or predicted.shape[1] != 4:
        raise ProbeFailure("evaluation", "attribute prediction/target shapes are incoherent")
    error = predicted - target
    absolute = np.abs(error)
    channels = []
    for index, name in enumerate(TARGET_CHANNELS):
        channels.append({
            "name": name,
            "rmse": float(np.sqrt(np.mean(error[:, index].astype(np.float64) ** 2))),
            "mae": float(np.mean(absolute[:, index], dtype=np.float64)),
            "predictionMin": float(np.min(predicted[:, index])),
            "predictionMax": float(np.max(predicted[:, index])),
            "targetMin": float(np.min(target[:, index])),
            "targetMax": float(np.max(target[:, index])),
        })
    normalized = error / (OUTPUT_MAX - OUTPUT_MIN).reshape(1, -1)
    return {
        "rowCount": int(target.shape[0]),
        "aggregateRmse": float(np.sqrt(np.mean(error.astype(np.float64) ** 2))),
        "aggregateMae": float(np.mean(absolute, dtype=np.float64)),
        "normalizedAggregateRmse": float(np.sqrt(np.mean(normalized.astype(np.float64) ** 2))),
        "normalizedAggregateMae": float(np.mean(np.abs(normalized), dtype=np.float64)),
        "channels": channels,
    }


def role_metrics(predicted: np.ndarray, target: np.ndarray, roles: np.ndarray) -> dict[str, Any]:
    result = {}
    for name, mask in (
        ("validation", roles == 1),
        ("test", roles == 0),
        ("train", roles == 2),
        ("all", np.ones(roles.shape, dtype=np.bool_)),
    ):
        result[name] = metric_block(predicted[mask], target[mask])
    return result


def checkpoint_text(value: np.ndarray) -> str:
    return str(value.reshape(-1)[0])


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    phase = "arguments"
    try:
        low_path = Path(args.low_manifest).resolve()
        high_path = Path(args.high_manifest).resolve()
        survival_path = Path(args.survival_manifest).resolve()

        phase = "input-validation"
        low = _displacement.load_export(low_path, require_fields=True)
        high = _displacement.load_export(high_path, require_fields=False)
        if low["grid"] != high["grid"]:
            raise ProbeFailure("input-validation", "low/high grids differ")
        if low["manifest"].get("effectiveRoute") != high["manifest"].get("effectiveRoute"):
            raise ProbeFailure("input-validation", "low/high effective routes differ")
        source_pair = _displacement.matched_source_capture(low, high)

        phase = "dataset-construction"
        grid = low["grid"]
        low_indexes, low_coords = _displacement.decode_cells(low["splats"], grid)
        high_indexes, _ = _displacement.decode_cells(high["splats"], grid)
        survival = load_survival(survival_path, low, high, low_indexes)
        high_row_by_cell = {int(cell): row for row, cell in enumerate(high_indexes.tolist())}
        overlap = np.asarray([int(cell) in high_row_by_cell for cell in low_indexes.tolist()], dtype=np.bool_)
        pair_low_rows = np.flatnonzero(survival["candidateKeep"] & overlap).astype(np.int64)
        if pair_low_rows.size == 0:
            raise ProbeFailure("dataset-construction", "no survival-kept exact same-cell pairs exist")
        pair_high_rows = np.asarray(
            [high_row_by_cell[int(low_indexes[row])] for row in pair_low_rows.tolist()],
            dtype=np.int64,
        )
        all_features, feature_receipt = _displacement.build_features(low, low_indexes, low_coords)
        pair_features = all_features[pair_low_rows]
        low_attributes_all = low["splats"][:, TARGET_COLUMNS].astype(np.float32, copy=True)
        low_attributes_pair = low_attributes_all[pair_low_rows]
        target_attributes = high["splats"][pair_high_rows][:, TARGET_COLUMNS].astype(np.float32, copy=True)
        residual = target_attributes - low_attributes_pair
        roles, split_receipt = spatial_split(low_coords[pair_low_rows], args.spatial_block_size, args.seed)
        train_mask = roles == 2

        phase = "feature-standardization"
        train_features, normalized, normalization = _displacement.standardize(
            pair_features[train_mask], pair_features, all_features,
        )
        pair_features_normalized, all_features_normalized = normalized

        phase = "model-fit"
        ridge_states: list[dict[str, Any]] = []
        mlp_states: list[dict[str, Any]] = []
        mlp_training: list[dict[str, Any]] = []
        ridge_pair_residuals = np.zeros_like(residual)
        mlp_pair_residuals = np.zeros_like(residual)
        mlp_all_residuals = np.zeros((low_indexes.size, 4), dtype=np.float32)
        rng = np.random.default_rng(args.seed)
        for channel in range(4):
            ridge_state = _support.fit_ridge_residual(
                train_features,
                residual[train_mask, channel],
                alpha=float(args.ridge_alpha),
            )
            mlp_state, training = _support.train_mlp(
                train_features,
                residual[train_mask, channel],
                args,
                rng,
                binary=False,
            )
            ridge_states.append(ridge_state)
            mlp_states.append(mlp_state)
            mlp_training.append({"channel": TARGET_CHANNELS[channel], **training})
            ridge_pair_residuals[:, channel] = _support.predict_ridge_residual(
                pair_features_normalized, ridge_state,
            )
            mlp_pair_residuals[:, channel] = _support.predict_mlp(
                pair_features_normalized, mlp_state, binary=False,
            )
            mlp_all_residuals[:, channel] = _support.predict_mlp(
                all_features_normalized, mlp_state, binary=False,
            )

        low_copy_pair = clip_attributes(low_attributes_pair)
        ridge_pair = clip_attributes(low_attributes_pair + ridge_pair_residuals)
        mlp_pair = clip_attributes(low_attributes_pair + mlp_pair_residuals)
        low_metrics = role_metrics(low_copy_pair, target_attributes, roles)
        ridge_metrics = role_metrics(ridge_pair, target_attributes, roles)
        mlp_metrics = role_metrics(mlp_pair, target_attributes, roles)

        phase = "checkpoint-write"
        low_indexes_sha = sha256_bytes(low_indexes.astype("<i8", copy=False).tobytes(order="C"))
        high_indexes_sha = sha256_bytes(high_indexes.astype("<i8", copy=False).tobytes(order="C"))
        pair_low_rows_sha = sha256_bytes(pair_low_rows.astype("<i8", copy=False).tobytes(order="C"))
        pair_high_rows_sha = sha256_bytes(pair_high_rows.astype("<i8", copy=False).tobytes(order="C"))
        checkpoint_path = out_dir / "color-opacity-residual-model.npz"
        np.savez_compressed(
            checkpoint_path,
            schema=np.asarray([SCHEMA]),
            identity=np.asarray([IDENTITY]),
            targetAuthority=np.asarray([TARGET_AUTHORITY]),
            targetChannels=np.asarray(TARGET_CHANNELS),
            outputMin=OUTPUT_MIN,
            outputMax=OUTPUT_MAX,
            normalizationMean=normalization["mean"],
            normalizationStd=normalization["std"],
            ridgeWeights=np.stack([state["weights"] for state in ridge_states]),
            ridgeBias=np.asarray([state["bias"] for state in ridge_states], dtype=np.float32),
            mlpW1=np.stack([state["w1"] for state in mlp_states]),
            mlpB1=np.stack([state["b1"] for state in mlp_states]),
            mlpW2=np.stack([state["w2"] for state in mlp_states]),
            mlpB2=np.stack([state["b2"] for state in mlp_states]),
            mlpTargetMean=np.asarray([state["targetMean"] for state in mlp_states], dtype=np.float32),
            mlpTargetStd=np.asarray([state["targetStd"] for state in mlp_states], dtype=np.float32),
            sourceManifestSha256=np.asarray([low["sha256"]]),
            sourcePayloadSha256=np.asarray([source_pair["payloadSha256"]]),
            sourceCandidateIndexesSha256=np.asarray([low_indexes_sha]),
            targetManifestSha256=np.asarray([high["sha256"]]),
            targetCandidateIndexesSha256=np.asarray([high_indexes_sha]),
            survivalManifestSha256=np.asarray([survival["manifestSha256"]]),
            survivalMaskSha256=np.asarray([survival["maskArtifact"]["sha256"]]),
            pairLowRowsSha256=np.asarray([pair_low_rows_sha]),
            pairHighRowsSha256=np.asarray([pair_high_rows_sha]),
        )

        phase = "checkpoint-replay"
        with np.load(checkpoint_path, allow_pickle=False) as replay:
            contract_parity = bool(
                checkpoint_text(replay["schema"]) == SCHEMA
                and checkpoint_text(replay["identity"]) == IDENTITY
                and checkpoint_text(replay["targetAuthority"]) == TARGET_AUTHORITY
                and replay["targetChannels"].astype(str).tolist() == TARGET_CHANNELS
                and np.array_equal(replay["outputMin"].astype(np.float32), OUTPUT_MIN)
                and np.array_equal(replay["outputMax"].astype(np.float32), OUTPUT_MAX)
            )
            if not contract_parity:
                raise ProbeFailure("checkpoint-replay", "serialized checkpoint attribute contract differs", {
                    "schema": checkpoint_text(replay["schema"]),
                    "identity": checkpoint_text(replay["identity"]),
                    "targetAuthority": checkpoint_text(replay["targetAuthority"]),
                    "targetChannels": replay["targetChannels"].astype(str).tolist(),
                    "outputMin": replay["outputMin"].astype(float).tolist(),
                    "outputMax": replay["outputMax"].astype(float).tolist(),
                })
            replay_all_features = (
                (all_features - replay["normalizationMean"].astype(np.float32))
                / replay["normalizationStd"].astype(np.float32)
            ).astype(np.float32)
            replay_all_residuals = np.zeros_like(mlp_all_residuals)
            replay_pair_ridge_residuals = np.zeros_like(ridge_pair_residuals)
            for channel in range(4):
                replay_state = {
                    "w1": replay["mlpW1"][channel].astype(np.float32),
                    "b1": replay["mlpB1"][channel].astype(np.float32),
                    "w2": replay["mlpW2"][channel].astype(np.float32),
                    "b2": replay["mlpB2"][channel].astype(np.float32),
                    "targetMean": float(replay["mlpTargetMean"][channel]),
                    "targetStd": float(replay["mlpTargetStd"][channel]),
                }
                replay_all_residuals[:, channel] = _support.predict_mlp(
                    replay_all_features, replay_state, binary=False,
                )
                replay_ridge_state = {
                    "weights": replay["ridgeWeights"][channel].astype(np.float32),
                    "bias": float(replay["ridgeBias"][channel]),
                }
                replay_pair_ridge_residuals[:, channel] = _support.predict_ridge_residual(
                    replay_all_features[pair_low_rows], replay_ridge_state,
                )
            replay_bindings = {
                "lowManifestSha256": checkpoint_text(replay["sourceManifestSha256"]),
                "sourcePayloadSha256": checkpoint_text(replay["sourcePayloadSha256"]),
                "candidateIndexesSha256": checkpoint_text(replay["sourceCandidateIndexesSha256"]),
                "highManifestSha256": checkpoint_text(replay["targetManifestSha256"]),
                "highCandidateIndexesSha256": checkpoint_text(replay["targetCandidateIndexesSha256"]),
                "survivalManifestSha256": checkpoint_text(replay["survivalManifestSha256"]),
                "survivalMaskSha256": checkpoint_text(replay["survivalMaskSha256"]),
                "pairLowRowsSha256": checkpoint_text(replay["pairLowRowsSha256"]),
                "pairHighRowsSha256": checkpoint_text(replay["pairHighRowsSha256"]),
            }
        effective_bindings = {
            "lowManifestSha256": low["sha256"],
            "sourcePayloadSha256": source_pair["payloadSha256"],
            "candidateIndexesSha256": low_indexes_sha,
            "highManifestSha256": high["sha256"],
            "highCandidateIndexesSha256": high_indexes_sha,
            "survivalManifestSha256": survival["manifestSha256"],
            "survivalMaskSha256": survival["maskArtifact"]["sha256"],
            "pairLowRowsSha256": pair_low_rows_sha,
            "pairHighRowsSha256": pair_high_rows_sha,
        }
        source_binding_parity = all(
            replay_bindings[key] == effective_bindings[key]
            for key in ("lowManifestSha256", "sourcePayloadSha256", "candidateIndexesSha256")
        )
        target_binding_parity = all(
            replay_bindings[key] == effective_bindings[key]
            for key in ("highManifestSha256", "highCandidateIndexesSha256", "pairLowRowsSha256", "pairHighRowsSha256")
        )
        survival_binding_parity = all(
            replay_bindings[key] == effective_bindings[key]
            for key in ("survivalManifestSha256", "survivalMaskSha256")
        )
        prediction_parity = bool(np.array_equal(replay_all_residuals, mlp_all_residuals))
        linear_prediction_parity = bool(np.array_equal(replay_pair_ridge_residuals, ridge_pair_residuals))
        if not source_binding_parity or not target_binding_parity or not survival_binding_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint ancestry differs", {
                "expected": effective_bindings, "actual": replay_bindings,
            })
        if not prediction_parity or not linear_prediction_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint does not reproduce predictions", {
                "mlpPredictionParity": prediction_parity,
                "linearPredictionParity": linear_prediction_parity,
            })

        phase = "dense-output-write"
        live_predicted_attributes = clip_attributes(low_attributes_all + mlp_all_residuals)
        all_predicted_attributes = clip_attributes(low_attributes_all + replay_all_residuals)
        kept_rows = np.flatnonzero(survival["candidateKeep"])
        live_dense = np.zeros((grid ** 3, 4), dtype="<f4")
        replay_dense = np.zeros((grid ** 3, 4), dtype="<f4")
        live_dense[low_indexes[kept_rows]] = live_predicted_attributes[kept_rows]
        replay_dense[low_indexes[kept_rows]] = all_predicted_attributes[kept_rows]
        dense_output_parity = bool(np.array_equal(live_dense, replay_dense))
        live_dense_bytes = live_dense.tobytes(order="C")
        replay_dense_bytes = replay_dense.tobytes(order="C")
        dense_output_byte_parity = live_dense_bytes == replay_dense_bytes
        if not dense_output_parity or not dense_output_byte_parity:
            raise ProbeFailure("checkpoint-replay", "serialized checkpoint does not reproduce dense output")
        dense_path = out_dir / "boundary-splat-color-opacity.f32"
        dense_bytes = replay_dense_bytes
        dense_path.write_bytes(dense_bytes)
        dense_artifact = {
            "path": str(dense_path),
            "sha256": sha256_bytes(dense_bytes),
            "byteLength": len(dense_bytes),
            "shape": [grid, grid, grid, 4],
            "channelOrder": TARGET_CHANNELS,
            "authority": DENSE_AUTHORITY,
            "applicationIdentity": "survival-fixed-color-opacity-override-v0",
            "candidateCount": int(low_indexes.size),
            "survivalKeptCandidateCount": int(kept_rows.size),
            "labeledSameCellCandidateCount": int(pair_low_rows.size),
            "nonSurvivorPolicy": "zero",
            "candidateMutationPolicy": "attribute override only; no birth, movement, or simulator mutation",
        }

        checkpoint = {
            "path": str(checkpoint_path),
            "sha256": sha256_file(checkpoint_path),
            "byteLength": checkpoint_path.stat().st_size,
            "authority": CHECKPOINT_AUTHORITY,
            "targetDataUsedForTraining": True,
            "targetDataUsedForCalibration": False,
            "testDataUsedForSelection": False,
            "sourceBinding": {
                "lowManifestSha256": low["sha256"],
                "sourcePayloadSha256": source_pair["payloadSha256"],
                "candidateIndexesSha256": low_indexes_sha,
            },
            "targetBinding": {
                "highManifestSha256": high["sha256"],
                "highCandidateIndexesSha256": high_indexes_sha,
                "targetAuthority": TARGET_AUTHORITY,
                "pairLowRowsSha256": pair_low_rows_sha,
                "pairHighRowsSha256": pair_high_rows_sha,
            },
            "survivalBinding": {
                "survivalManifestSha256": survival["manifestSha256"],
                "survivalMaskSha256": survival["maskArtifact"]["sha256"],
                "survivalAuthority": SURVIVAL_AUTHORITY,
            },
            "replay": {
                "status": REPLAY_STATUS,
                "sourceBindingParity": source_binding_parity,
                "targetBindingParity": target_binding_parity,
                "survivalBindingParity": survival_binding_parity,
                "contractParity": contract_parity,
                "predictionParity": prediction_parity,
                "linearPredictionParity": linear_prediction_parity,
                "denseOutputParity": dense_output_parity,
                "denseOutputByteParity": dense_output_byte_parity,
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
                "survivalManifest": {"path": str(survival_path), "sha256": survival["manifestSha256"]},
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
                "survivalArtifact": survival["maskArtifact"],
            },
            "dataset": {
                "identity": IDENTITY,
                "featureAuthority": feature_receipt,
                "targetAuthority": TARGET_AUTHORITY,
                "targetChannels": TARGET_CHANNELS,
                "targetColumns": TARGET_COLUMNS.tolist(),
                "lowCandidateCount": int(low_indexes.size),
                "highCandidateCount": int(high_indexes.size),
                "survivalKeptCandidateCount": int(np.count_nonzero(survival["candidateKeep"])),
                "exactOverlapCount": int(np.count_nonzero(overlap)),
                "sameCellTrainingPopulation": int(pair_low_rows.size),
                "survivingWithoutSameCellHighLabel": int(np.count_nonzero(survival["candidateKeep"] & ~overlap)),
                "candidateMutationPolicy": "survival fixed; attributes only",
                "outputRanges": {
                    name: {"minimum": float(OUTPUT_MIN[index]), "maximum": float(OUTPUT_MAX[index])}
                    for index, name in enumerate(TARGET_CHANNELS)
                },
            },
            "split": split_receipt,
            "models": {
                "lowCopy": {"identity": LOW_COPY_IDENTITY, **low_metrics},
                "linearResidual": {
                    "identity": LINEAR_IDENTITY,
                    "ridgeAlpha": float(args.ridge_alpha),
                    **ridge_metrics,
                },
                "mlpResidual": {
                    "identity": MLP_IDENTITY,
                    "decomposition": "four independent scalar residual heads with shared source features",
                    "training": mlp_training,
                    **mlp_metrics,
                },
            },
            "denseOutputs": {"colorOpacity": dense_artifact},
            "checkpoint": checkpoint,
            "producer": {
                "script": {"path": str(Path(__file__).resolve()), "sha256": sha256_file(Path(__file__).resolve())},
                "arguments": vars(args),
            },
            "limitations": [
                "same-state train-role exact-high color and opacity targets enter fitting",
                "held test remains audit-only and no model or threshold selection consumes it",
                "false-positive surviving candidates have no same-cell high attribute label but still receive source-conditioned inference",
                "membership is frozen and the attribute probe cannot birth, remove, or move candidates",
                "same-replay spatial holdout does not establish cross-replay or cross-basin transfer",
                "field-space metrics do not establish a renderer-visible improvement",
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
