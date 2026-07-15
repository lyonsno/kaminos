#!/usr/bin/env python3
"""Train a source-visible candidate-only correction above a coarse front scaffold."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.sparse-temporal-front-detail-probe.v0"
IDENTITY = "fixed-source-gated-temporal-front-detail-student-v0"
ADMISSION_IDENTITY = "fixed-full-source-delta-envelope-trilinear-v1"
ARCHITECTURE = "candidate-only-tanh-temporal-front-detail-head-v0"
FEATURE_IDENTITY = "all-current-source-all-source-delta-coarse-temporal-spatial-v0"
CHANNELS = [
    "velocityX", "velocityY", "velocityZ", "densityCarrier",
    "smokeDensity", "heat", "fuel", "detail",
    "flame", "ember", "visibleFireCarrier", "combustionFront",
    "microdetail", "interfaceShred", "fireLick", "emberFleck", "frontTopology",
]


class ProbeFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(
        payload,
        indent=2,
        default=lambda value: value.item() if isinstance(value, np.generic) else str(value),
    ) + "\n")


def load_coarse_module() -> Any:
    path = Path(__file__).resolve().with_name("volume-coarse-support-front-scaffold.py")
    if not path.exists():
        raise ProbeFailure("coarse-load", f"missing coarse scaffold producer: {path}")
    spec = importlib.util.spec_from_file_location("kaminos_coarse_scaffold", path)
    if spec is None or spec.loader is None:
        raise ProbeFailure("coarse-load", "cannot load coarse scaffold producer")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_transition(raw: str) -> tuple[Path, Path, Path, Path]:
    parts = raw.split(":", 3)
    if len(parts) != 4 or not all(parts):
        raise ProbeFailure(
            "arguments",
            "transition arguments must be PREVIOUS_SOURCE:PREVIOUS_TEACHER:CURRENT_SOURCE:CURRENT_TEACHER",
        )
    return tuple(Path(value).resolve() for value in parts)  # type: ignore[return-value]


def resize_axis(values: np.ndarray, target: int, axis: int) -> np.ndarray:
    source = values.shape[axis]
    coordinate = (np.arange(target, dtype=np.float32) + 0.5) * (source / target) - 0.5
    lower = np.floor(coordinate).astype(np.intp)
    upper = lower + 1
    fraction = coordinate - lower
    lower = np.clip(lower, 0, source - 1)
    upper = np.clip(upper, 0, source - 1)
    shape = [1] * values.ndim
    shape[axis] = target
    fraction = fraction.reshape(shape)
    return np.take(values, lower, axis=axis) * (1.0 - fraction) + np.take(values, upper, axis=axis) * fraction


def trilinear_resize(values: np.ndarray, target: int) -> np.ndarray:
    return resize_axis(resize_axis(resize_axis(values, target, 2), target, 1), target, 0).astype(np.float32)


def source_fields(frame: dict[str, Any]) -> np.ndarray:
    grid = int(frame["sourceGrid"])
    fluid = np.asarray(frame["fluid"], dtype=np.float32).reshape(grid, grid, grid, 16)
    front = np.asarray(frame["front"], dtype=np.float32).reshape(grid, grid, grid, 1)
    return np.concatenate((fluid, front), axis=3).astype(np.float32)


def load_calibration(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ProbeFailure("calibration-load", f"missing calibration: {path}")
    payload = json.loads(path.read_text())
    if payload.get("schema") != "kaminos.pyro.fixed-source-delta-calibration.v1":
        raise ProbeFailure("calibration-load", "calibration schema mismatch")
    if payload.get("identity") != ADMISSION_IDENTITY:
        raise ProbeFailure("calibration-load", "calibration identity mismatch")
    if payload.get("status") != "captured" or payload.get("failurePhase") is not None:
        raise ProbeFailure("calibration-load", "calibration is not a captured artifact")
    required_authority = {
        "authority": "source-manifests-only-fixed-threshold-v0",
        "runtimeTruthUsed": False,
        "targetArtifactsRead": False,
        "targetErrorRankingUsed": False,
        "runtimeTopK": False,
        "dynamicPercentile": False,
        "hiddenCandidateCap": False,
        "sourceOnlyThresholdRule": "train-pair-channel-qscale-max-envelope-dense-quantile-v0",
    }
    if any(payload.get(key) != value for key, value in required_authority.items()):
        raise ProbeFailure("calibration-load", "calibration source-only authority is missing or incoherent")
    if payload.get("sourceFieldChannelOrder") != CHANNELS:
        raise ProbeFailure("calibration-load", "calibration source field channel order mismatch")
    producer = payload.get("producer") or {}
    producer_path = Path(str(producer.get("scriptPath") or "")).resolve()
    if producer.get("identity") != "volume-source-delta-admission-calibration.py":
        raise ProbeFailure("calibration-load", "calibration producer identity mismatch")
    if not producer_path.exists() or sha256_file(producer_path) != producer.get("scriptSha256"):
        raise ProbeFailure("calibration-load", "calibration producer script is missing or SHA-256 differs")
    scales = np.asarray(payload.get("channelScales"), dtype=np.float32)
    if scales.shape != (17,) or not np.all(np.isfinite(scales)) or np.any(scales <= 0.0):
        raise ProbeFailure("calibration-load", "calibration requires 17 positive finite channel scales")
    threshold = float(payload.get("threshold"))
    if not math.isfinite(threshold):
        raise ProbeFailure("calibration-load", "calibration threshold is non-finite")
    return {**payload, "path": str(path), "sha256": sha256_file(path), "scalesArray": scales}


def replay_calibration_rule(
    previous: dict[str, Any], current: dict[str, Any], calibration: dict[str, Any],
) -> dict[str, Any]:
    scale_quantile = float(calibration.get("scaleQuantile"))
    coverage_quantile = float(calibration.get("coverageCalibrationQuantile"))
    if not (0.0 < scale_quantile <= 1.0) or not (0.0 <= coverage_quantile < 1.0):
        raise ProbeFailure("source-gate-replay", "calibration quantiles are outside their valid ranges")
    calibration_delta = np.abs(source_fields(current) - source_fields(previous))
    scales = np.quantile(
        calibration_delta.astype(np.float64),
        scale_quantile,
        axis=(0, 1, 2),
        method="linear",
    ).astype(np.float32)
    if not np.array_equal(scales, calibration["scalesArray"]):
        raise ProbeFailure(
            "source-gate-replay",
            "calibration channel scales differ from recomputed source-only scales",
        )
    score_source = np.max(
        np.clip(np.abs(calibration_delta) / scales.reshape(1, 1, 1, 17), 0.0, 1.0),
        axis=3,
    )
    score = trilinear_resize(score_source.astype(np.float32), int(current["teacherGrid"]))
    threshold = float(np.quantile(
        score.astype(np.float64), coverage_quantile, method="linear",
    ))
    if not math.isclose(threshold, float(calibration["threshold"]), rel_tol=0.0, abs_tol=1.0e-12):
        raise ProbeFailure(
            "source-gate-replay",
            "calibration threshold differs from recomputed source-only threshold",
        )
    return {
        "scales": scales,
        "threshold": threshold,
        "channelScaleParity": True,
        "thresholdParity": True,
    }


def fixed_source_gate(
    previous: dict[str, Any], current: dict[str, Any], calibration: dict[str, Any], pair: str,
) -> dict[str, Any]:
    if previous["sourceGrid"] != current["sourceGrid"] or previous["teacherGrid"] != current["teacherGrid"]:
        raise ProbeFailure("source-gate-replay", "transition grids differ")
    source_delta = source_fields(current) - source_fields(previous)
    score_source = np.max(
        np.clip(np.abs(source_delta) / calibration["scalesArray"].reshape(1, 1, 1, 17), 0.0, 1.0),
        axis=3,
    )
    score = trilinear_resize(score_source, int(current["teacherGrid"]))
    mask = score >= np.float32(calibration["threshold"])
    expected = (calibration.get("pairs") or {}).get(pair)
    if not expected:
        raise ProbeFailure("source-gate-replay", f"calibration lacks pair {pair}")
    actual_count = int(np.count_nonzero(mask))
    expected_count = int(expected.get("candidateCount"))
    actual_coverage = float(np.mean(mask))
    expected_coverage = float(expected.get("coverage"))
    if actual_count != expected_count:
        raise ProbeFailure("source-gate-replay", f"candidate count mismatch for {pair}", {
            "pair": pair, "expectedCandidateCount": expected_count, "actualCandidateCount": actual_count,
            "expectedCoverage": expected_coverage, "actualCoverage": actual_coverage,
        })
    if abs(actual_coverage - expected_coverage) > 1.0e-12:
        raise ProbeFailure("source-gate-replay", f"candidate coverage mismatch for {pair}")
    receipt = {
        "pair": pair,
        "score": score,
        "mask": mask,
        "indexes": np.flatnonzero(mask.reshape(-1)),
        "candidateCount": actual_count,
        "coverage": actual_coverage,
        "exactCandidateCountParity": True,
        "exactCoverageParity": True,
    }
    if expected.get("energyCapture") is not None:
        receipt["expectedEnergyCapture"] = float(expected["energyCapture"])
    return receipt


def load_coarse(
    module: Any, manifest_path: Path, frames_by_step: dict[int, dict[str, Any]],
) -> tuple[dict[int, dict[str, np.ndarray]], dict[str, Any], dict[str, Any]]:
    if not manifest_path.exists():
        raise ProbeFailure("coarse-load", f"missing coarse manifest: {manifest_path}")
    manifest = json.loads(manifest_path.read_text())
    if manifest.get("schema") != module.SCHEMA or manifest.get("status") != "captured":
        raise ProbeFailure("coarse-load", "coarse manifest is not captured")
    checkpoint_info = manifest.get("checkpoint") or {}
    checkpoint_path = Path(str(checkpoint_info.get("path") or "")).resolve()
    if not checkpoint_path.exists() or sha256_file(checkpoint_path) != checkpoint_info.get("sha256"):
        raise ProbeFailure("coarse-load", "coarse checkpoint missing or SHA-256 differs")
    role_bindings = (manifest.get("inputs") or {}).get("bindings") or {}
    bindings_by_step = {int(value["step"]): value for value in role_bindings.values()}
    with np.load(checkpoint_path, allow_pickle=False) as checkpoint:
        checkpoint_schema = str(checkpoint["schema"][0])
        checkpoint_identity = str(checkpoint["identity"][0])
        checkpoint_architecture = str(checkpoint["architecture"][0])
        checkpoint_bindings = json.loads(str(checkpoint["bindingsJson"][0]))
        state = {
            "w1": checkpoint["w1"].astype(np.float32),
            "b1": checkpoint["b1"].astype(np.float32),
            "supportW": checkpoint["supportW"].astype(np.float32),
            "supportB": np.float32(checkpoint["supportB"][0]),
            "frontW": checkpoint["frontW"].astype(np.float32),
            "frontB": np.float32(checkpoint["frontB"][0]),
            "frontMean": np.float32(checkpoint["frontMean"][0]),
            "frontStd": np.float32(checkpoint["frontStd"][0]),
        }
        feature_mean = checkpoint["featureMean"].astype(np.float32)
        feature_std = checkpoint["featureStd"].astype(np.float32)
        scaffold_grid = int(checkpoint["scaffoldGrid"][0])
        front_gain = float(checkpoint["frontGain"][0])
        support_threshold = float(checkpoint["supportThreshold"][0])
    if checkpoint_bindings != role_bindings:
        raise ProbeFailure("coarse-load", "coarse checkpoint bindings differ from manifest bindings")
    if checkpoint_schema != module.SCHEMA or checkpoint_identity != manifest.get("identity"):
        raise ProbeFailure("coarse-load", "coarse checkpoint schema or identity differs from manifest")
    if checkpoint_architecture != (manifest.get("student") or {}).get("architecture"):
        raise ProbeFailure("coarse-load", "coarse checkpoint architecture differs from manifest")
    if scaffold_grid != int((manifest.get("inputs") or {}).get("scaffoldGrid") or 0):
        raise ProbeFailure("coarse-load", "coarse checkpoint scaffold grid differs from manifest")
    manifest_gain = float((manifest.get("front") or {}).get("calibration", {}).get("gain"))
    manifest_threshold = float((manifest.get("support") or {}).get("thresholdSelection", {}).get("threshold"))
    if np.float32(front_gain) != np.float32(manifest_gain) or np.float32(support_threshold) != np.float32(manifest_threshold):
        raise ProbeFailure("coarse-load", "coarse checkpoint calibration differs from manifest")
    predictions = {}
    for step, frame in frames_by_step.items():
        binding = bindings_by_step.get(step)
        if not binding:
            raise ProbeFailure("coarse-load", f"coarse checkpoint lacks source binding for step {step}")
        if binding.get("sourceManifestSha256") != frame["sourceSha256"] or binding.get("teacherManifestSha256") != frame["teacherSha256"]:
            raise ProbeFailure("coarse-load", f"coarse source/teacher binding differs for step {step}")
        dataset = module.frame_dataset(frame, scaffold_grid, float(manifest["labels"]["support"]["teacherThreshold"]))
        normalized = ((dataset["features"] - feature_mean) / feature_std).astype(np.float32)
        support, front = module.predict(normalized, state)
        front = (front * np.float32(front_gain)).astype(np.float32)
        teacher_grid = int(frame["teacherGrid"])
        predictions[step] = {
            "support": trilinear_resize(support.reshape(scaffold_grid, scaffold_grid, scaffold_grid), teacher_grid),
            "front": trilinear_resize(front.reshape(scaffold_grid, scaffold_grid, scaffold_grid), teacher_grid),
        }
    receipt = {
        "manifestPath": str(manifest_path),
        "manifestSha256": sha256_file(manifest_path),
        "checkpointPath": str(checkpoint_path),
        "checkpointSha256": checkpoint_info["sha256"],
        "identity": manifest["identity"],
        "scaffoldGrid": scaffold_grid,
        "frontGain": front_gain,
        "sourceBindingParity": True,
        "checkpointManifestBindingParity": True,
    }
    return predictions, receipt, manifest


def teacher_residual(module: Any, frame: dict[str, Any]) -> np.ndarray:
    grid = int(frame["teacherGrid"])
    return (
        np.asarray(frame["teacherFront"], dtype=np.float32)
        - module.teacher_baseline_front(frame)
    ).reshape(grid, grid, grid)


def candidate_features(
    previous: dict[str, Any], current: dict[str, Any], coarse: dict[int, dict[str, np.ndarray]], indexes: np.ndarray,
) -> np.ndarray:
    teacher_grid = int(current["teacherGrid"])
    previous_source = source_fields(previous)
    current_source = source_fields(current)
    delta_source = current_source - previous_source
    columns = []
    for channel in range(17):
        columns.append(trilinear_resize(current_source[..., channel], teacher_grid).reshape(-1)[indexes])
    for channel in range(17):
        columns.append(trilinear_resize(delta_source[..., channel], teacher_grid).reshape(-1)[indexes])
    current_coarse = coarse[int(current["step"])]
    previous_coarse = coarse[int(previous["step"])]
    front_delta = current_coarse["front"] - previous_coarse["front"]
    support_delta = current_coarse["support"] - previous_coarse["support"]
    columns.extend([
        current_coarse["front"].reshape(-1)[indexes],
        front_delta.reshape(-1)[indexes],
        current_coarse["support"].reshape(-1)[indexes],
        support_delta.reshape(-1)[indexes],
    ])
    for field in (current_coarse["front"], front_delta):
        grad_z, grad_y, grad_x = np.gradient(field)
        columns.extend([
            grad_x.reshape(-1)[indexes], grad_y.reshape(-1)[indexes], grad_z.reshape(-1)[indexes],
        ])
    cells = teacher_grid ** 3
    linear = np.arange(cells, dtype=np.int64)[indexes]
    x = linear % teacher_grid
    y = (linear // teacher_grid) % teacher_grid
    z = linear // (teacher_grid * teacher_grid)
    denominator = max(1, teacher_grid - 1)
    columns.extend([
        x.astype(np.float32) / denominator * 2.0 - 1.0,
        y.astype(np.float32) / denominator * 2.0 - 1.0,
        z.astype(np.float32) / denominator * 2.0 - 1.0,
    ])
    source_grid = int(current["sourceGrid"])
    for coordinate in (x, y, z):
        source_coordinate = (coordinate.astype(np.float32) + 0.5) * (source_grid / teacher_grid) - 0.5
        columns.append((source_coordinate - np.floor(source_coordinate)) * 2.0 - 1.0)
    features = np.stack(columns, axis=1).astype(np.float32)
    if features.shape[1] != 50 or not np.all(np.isfinite(features)):
        raise ProbeFailure("feature-construction", "candidate feature shape or finiteness differs", {
            "shape": list(features.shape),
        })
    return features


def train_student(features: np.ndarray, target: np.ndarray, weights: np.ndarray, args: argparse.Namespace) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    rng = np.random.default_rng(args.seed)
    hidden_width = int(args.hidden_width)
    target_mean = np.float32(np.average(target, weights=weights))
    target_std = np.float32(max(float(np.sqrt(np.average((target - target_mean) ** 2, weights=weights))), 1.0e-6))
    normalized_target = ((target - target_mean) / target_std).astype(np.float32)
    state = {
        "w1": rng.normal(0.0, math.sqrt(2.0 / features.shape[1]), (features.shape[1], hidden_width)).astype(np.float32),
        "b1": np.zeros(hidden_width, np.float32),
        "w2": rng.normal(0.0, math.sqrt(1.0 / hidden_width), hidden_width).astype(np.float32),
        "b2": np.float32(0.0),
        "targetMean": target_mean,
        "targetStd": target_std,
    }
    names = ("w1", "b1", "w2", "b2")
    first = {name: np.zeros_like(state[name], np.float32) for name in names}
    second = {name: np.zeros_like(state[name], np.float32) for name in names}
    update = 0
    losses = []
    for epoch in range(int(args.epochs)):
        order = rng.permutation(features.shape[0])
        weighted_loss = 0.0
        batches = 0
        for start in range(0, order.size, int(args.batch_size)):
            batch = order[start:start + int(args.batch_size)]
            x = features[batch]
            y = normalized_target[batch]
            w = weights[batch].astype(np.float32)
            hidden = np.tanh(x @ state["w1"] + state["b1"])
            prediction = hidden @ state["w2"] + state["b2"]
            denominator = max(float(np.sum(w)), 1.0)
            derivative = np.float32(2.0) * (prediction - y) * w / denominator
            gradients = {
                "w2": hidden.T @ derivative + np.float32(args.weight_decay) * state["w2"],
                "b2": np.asarray(np.sum(derivative), dtype=np.float32),
            }
            hidden_derivative = derivative[:, None] * state["w2"][None, :] * (1.0 - hidden * hidden)
            gradients["w1"] = x.T @ hidden_derivative + np.float32(args.weight_decay) * state["w1"]
            gradients["b1"] = np.sum(hidden_derivative, axis=0)
            update += 1
            for name in names:
                gradient = np.asarray(gradients[name], dtype=np.float32)
                first[name] = 0.9 * first[name] + 0.1 * gradient
                second[name] = 0.999 * second[name] + 0.001 * gradient * gradient
                first_hat = first[name] / (1.0 - 0.9 ** update)
                second_hat = second[name] / (1.0 - 0.999 ** update)
                state[name] = np.asarray(
                    state[name] - np.float32(args.learning_rate) * first_hat / (np.sqrt(second_hat) + 1.0e-8),
                    dtype=np.float32,
                )
            weighted_loss += float(np.sum(w * (prediction - y) ** 2) / denominator)
            batches += 1
        losses.append({"epoch": epoch + 1, "weightedNormalizedMse": weighted_loss / max(1, batches)})
    return state, losses


def predict(features: np.ndarray, state: dict[str, Any]) -> np.ndarray:
    hidden = np.tanh(features @ state["w1"] + state["b1"])
    normalized = hidden @ state["w2"] + state["b2"]
    return (normalized * state["targetStd"] + state["targetMean"]).astype(np.float32)


def comparison(prediction: np.ndarray, truth: np.ndarray) -> dict[str, Any]:
    prediction64 = prediction.astype(np.float64).reshape(-1)
    truth64 = truth.astype(np.float64).reshape(-1)
    baseline_sse = float(np.sum(truth64 * truth64))
    error = prediction64 - truth64
    prediction_sse = float(np.sum(error * error))
    if np.std(prediction64) <= 1.0e-12 or np.std(truth64) <= 1.0e-12:
        correlation = 0.0
    else:
        correlation = float(np.corrcoef(prediction64, truth64)[0, 1])
    return {
        "rmse": float(np.sqrt(np.mean(error * error))),
        "correlation": correlation,
        "relativeErrorReductionVsCoarse": float(1.0 - prediction_sse / max(baseline_sse, 1.0e-20)),
        "truthEnergy": baseline_sse,
        "predictionEnergy": float(np.sum(prediction64 * prediction64)),
        "errorEnergy": prediction_sse,
    }


def field_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, Any]:
    prediction64 = prediction.astype(np.float64).reshape(-1)
    truth64 = truth.astype(np.float64).reshape(-1)
    error = prediction64 - truth64
    truth_energy = float(np.sum(truth64 * truth64))
    prediction_energy = float(np.sum(prediction64 * prediction64))
    if np.std(prediction64) <= 1.0e-12 or np.std(truth64) <= 1.0e-12:
        correlation = 0.0
    else:
        correlation = float(np.corrcoef(prediction64, truth64)[0, 1])
    return {
        "rmse": float(np.sqrt(np.mean(error * error))),
        "correlation": correlation,
        "energyRetention": float(prediction_energy / max(truth_energy, 1.0e-20)),
        "explainedEnergy": float(1.0 - np.sum(error * error) / max(truth_energy, 1.0e-20)),
        "truthEnergy": truth_energy,
        "predictionEnergy": prediction_energy,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--coarse-manifest", required=True)
    parser.add_argument("--calibration", required=True)
    parser.add_argument("--train-transition", required=True)
    parser.add_argument("--test-transition", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--hidden-width", type=int, default=16)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--ridge-weight", type=float, default=1.0)
    parser.add_argument("--temporal-weight", type=float, default=2.0)
    parser.add_argument("--seed", type=int, default=1729)
    return parser.parse_args()


def producer_receipt(args: argparse.Namespace) -> dict[str, Any]:
    path = Path(__file__).resolve()
    return {
        "identity": path.name,
        "scriptPath": str(path),
        "scriptSha256": sha256_file(path),
        "invocation": {
            "hiddenWidth": int(args.hidden_width),
            "epochs": int(args.epochs),
            "batchSize": int(args.batch_size),
            "learningRate": float(args.learning_rate),
            "weightDecay": float(args.weight_decay),
            "ridgeWeight": float(args.ridge_weight),
            "temporalWeight": float(args.temporal_weight),
            "seed": int(args.seed),
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    phase = "arguments"
    evidence: dict[str, Any] = {}
    try:
        if args.hidden_width <= 0 or args.epochs <= 0 or args.batch_size <= 0:
            raise ProbeFailure(phase, "hidden width, epochs, and batch size must be positive")
        module = load_coarse_module()
        train_paths = parse_transition(args.train_transition)
        test_paths = parse_transition(args.test_transition)
        phase = "input-validation"
        frame_paths = [
            (train_paths[0], train_paths[1]), (train_paths[2], train_paths[3]),
            (test_paths[0], test_paths[1]), (test_paths[2], test_paths[3]),
        ]
        frames = [module.load_frame(source, teacher) for source, teacher in frame_paths]
        frames_by_step: dict[int, dict[str, Any]] = {}
        for frame in frames:
            existing = frames_by_step.get(int(frame["step"]))
            if existing and (existing["sourceSha256"] != frame["sourceSha256"] or existing["teacherSha256"] != frame["teacherSha256"]):
                raise ProbeFailure(phase, "same step has different source or teacher authority")
            frames_by_step[int(frame["step"])] = frame
        train_previous, train_current, test_previous, test_current = frames
        if train_current["step"] != test_previous["step"]:
            raise ProbeFailure(phase, "train current frame must equal test previous frame")
        if not (train_previous["step"] < train_current["step"] < test_current["step"]):
            raise ProbeFailure(phase, "transitions must advance across three ordered distinct steps")
        if len({(frame["route"], frame["backend"], frame["sourceGrid"], frame["teacherGrid"]) for frame in frames}) != 1:
            raise ProbeFailure(phase, "transition route/backend/grid identities differ")
        evidence = {
            str(step): {
                "sourceManifestSha256": frame["sourceSha256"],
                "teacherManifestSha256": frame["teacherSha256"],
            }
            for step, frame in frames_by_step.items()
        }
        calibration = load_calibration(Path(args.calibration).resolve())
        coarse, coarse_receipt, coarse_manifest = load_coarse(
            module, Path(args.coarse_manifest).resolve(), frames_by_step,
        )

        phase = "source-gate-replay"
        train_pair = f"{train_previous['step']}-{train_current['step']}"
        test_pair = f"{test_previous['step']}-{test_current['step']}"
        if calibration.get("calibrationPair") != train_pair:
            raise ProbeFailure(phase, "calibration pair differs from the training transition")
        expected_identity = (
            int(train_current["sourceGrid"]), int(train_current["teacherGrid"]),
            train_current["route"], train_current["backend"],
        )
        calibration_identity = (
            int(calibration.get("sourceGrid") or 0), int(calibration.get("targetGrid") or 0),
            calibration.get("route"), calibration.get("backend"),
        )
        if calibration_identity != expected_identity:
            raise ProbeFailure(phase, "calibration route, backend, or grid identity differs")
        calibration_bindings = calibration.get("sourceBindings") or {}
        for step, frame in frames_by_step.items():
            binding = calibration_bindings.get(str(step)) or {}
            if (
                binding.get("manifestSha256") != frame["sourceSha256"]
                or binding.get("fluidSha256") != frame["artifactHashes"]["sourceFluid"]
                or binding.get("frontSha256") != frame["artifactHashes"]["sourceFront"]
            ):
                raise ProbeFailure(phase, f"calibration source binding differs for step {step}")
        calibration_replay = replay_calibration_rule(
            train_previous, train_current, calibration,
        )
        calibration["scalesArray"] = calibration_replay["scales"]
        calibration["threshold"] = calibration_replay["threshold"]
        gates = {
            "train": fixed_source_gate(train_previous, train_current, calibration, train_pair),
            "test": fixed_source_gate(test_previous, test_current, calibration, test_pair),
        }

        phase = "dataset-construction"
        train_features = candidate_features(train_previous, train_current, coarse, gates["train"]["indexes"])
        test_features = candidate_features(test_previous, test_current, coarse, gates["test"]["indexes"])
        train_truth_previous = teacher_residual(module, train_previous) - coarse[int(train_previous["step"])]["front"]
        train_truth_current = teacher_residual(module, train_current) - coarse[int(train_current["step"])]["front"]
        held_truth = teacher_residual(module, test_current) - coarse[int(test_current["step"])]["front"]
        train_indexes = gates["train"]["indexes"]
        train_target = train_truth_current.reshape(-1)[train_indexes].astype(np.float32)
        temporal_train = (train_truth_current - train_truth_previous)
        grad_z, grad_y, grad_x = np.gradient(train_truth_current)
        ridge = np.sqrt(grad_x * grad_x + grad_y * grad_y + grad_z * grad_z).reshape(-1)[train_indexes]
        temporal = np.abs(temporal_train).reshape(-1)[train_indexes]
        ridge_scale = max(float(np.quantile(ridge, 0.95)), 1.0e-8)
        temporal_scale = max(float(np.quantile(temporal, 0.95)), 1.0e-8)
        train_weights = (
            1.0
            + np.float32(args.ridge_weight) * np.clip(ridge / ridge_scale, 0.0, 1.0)
            + np.float32(args.temporal_weight) * np.clip(temporal / temporal_scale, 0.0, 1.0)
        ).astype(np.float32)
        feature_mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
        feature_std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
        feature_std[feature_std < 1.0e-6] = 1.0
        train_normalized = ((train_features - feature_mean) / feature_std).astype(np.float32)
        test_normalized = ((test_features - feature_mean) / feature_std).astype(np.float32)

        phase = "model-fit"
        state, losses = train_student(train_normalized, train_target, train_weights, args)
        train_candidate_prediction = predict(train_normalized, state)
        held_candidate_prediction = predict(test_normalized, state)
        teacher_grid = int(test_current["teacherGrid"])
        train_prediction = np.zeros(teacher_grid ** 3, dtype=np.float32)
        held_prediction = np.zeros(teacher_grid ** 3, dtype=np.float32)
        train_prediction[gates["train"]["indexes"]] = train_candidate_prediction
        held_prediction[gates["test"]["indexes"]] = held_candidate_prediction
        train_prediction = train_prediction.reshape(teacher_grid, teacher_grid, teacher_grid)
        held_prediction = held_prediction.reshape(teacher_grid, teacher_grid, teacher_grid)

        phase = "checkpoint-write"
        bindings = {
            "coarseManifestSha256": coarse_receipt["manifestSha256"],
            "coarseCheckpointSha256": coarse_receipt["checkpointSha256"],
            "calibrationSha256": calibration["sha256"],
            "frames": evidence,
            "trainFeatureSha256": sha256_bytes(train_features.astype("<f4", copy=False).tobytes()),
            "testFeatureSha256": sha256_bytes(test_features.astype("<f4", copy=False).tobytes()),
            "trainTargetSha256": sha256_bytes(train_target.astype("<f4", copy=False).tobytes()),
        }
        checkpoint_path = out_dir / "sparse-temporal-front-detail-student.npz"
        np.savez_compressed(
            checkpoint_path,
            schema=np.asarray([SCHEMA]), identity=np.asarray([IDENTITY]), architecture=np.asarray([ARCHITECTURE]),
            featureMean=feature_mean, featureStd=feature_std,
            w1=state["w1"], b1=state["b1"], w2=state["w2"], b2=np.asarray([state["b2"]], np.float32),
            targetMean=np.asarray([state["targetMean"]], np.float32), targetStd=np.asarray([state["targetStd"]], np.float32),
            bindingsJson=np.asarray([json.dumps(bindings, sort_keys=True)]),
        )

        phase = "checkpoint-replay"
        with np.load(checkpoint_path, allow_pickle=False) as replay:
            replay_state = {
                "w1": replay["w1"].astype(np.float32), "b1": replay["b1"].astype(np.float32),
                "w2": replay["w2"].astype(np.float32), "b2": np.float32(replay["b2"][0]),
                "targetMean": np.float32(replay["targetMean"][0]), "targetStd": np.float32(replay["targetStd"][0]),
            }
            replay_train = predict(
                ((train_features - replay["featureMean"].astype(np.float32)) / replay["featureStd"].astype(np.float32)).astype(np.float32),
                replay_state,
            )
            replay_test = predict(
                ((test_features - replay["featureMean"].astype(np.float32)) / replay["featureStd"].astype(np.float32)).astype(np.float32),
                replay_state,
            )
            replay_bindings = json.loads(str(replay["bindingsJson"][0]))
        output_parity = np.array_equal(replay_train, train_candidate_prediction) and np.array_equal(replay_test, held_candidate_prediction)
        binding_parity = replay_bindings == bindings
        if not output_parity or not binding_parity:
            raise ProbeFailure(phase, "serialized fine checkpoint replay differs", {
                "outputParity": output_parity, "sourceBindingParity": binding_parity,
            })

        phase = "output-write"
        held_truth_delta = held_truth - train_truth_current
        predicted_delta = held_prediction - train_prediction
        spatial = comparison(held_prediction, held_truth)
        temporal_metrics = comparison(predicted_delta, held_truth_delta)
        held_teacher_residual = teacher_residual(module, test_current)
        previous_teacher_residual = teacher_residual(module, test_previous)
        held_coarse = coarse[int(test_current["step"])]["front"]
        previous_coarse = coarse[int(test_previous["step"])]["front"]
        held_composed = held_coarse + held_prediction
        previous_composed = previous_coarse + train_prediction
        coarse_spatial = field_metrics(held_coarse, held_teacher_residual)
        composed_spatial = field_metrics(held_composed, held_teacher_residual)
        composed_temporal = field_metrics(
            held_composed - previous_composed,
            held_teacher_residual - previous_teacher_residual,
        )
        held_detail_path = out_dir / "held-front-detail.f32"
        train_detail_path = out_dir / "train-front-detail.f32"
        held_composed_path = out_dir / "held-composed-front-residual.f32"
        held_detail_path.write_bytes(held_prediction.astype("<f4", copy=False).tobytes())
        train_detail_path.write_bytes(train_prediction.astype("<f4", copy=False).tobytes())
        held_composed_path.write_bytes(held_composed.astype("<f4", copy=False).tobytes())
        output_descriptor = lambda path, channel: {
            "path": str(path), "sha256": sha256_file(path), "byteLength": path.stat().st_size,
            "dtype": "float32-le", "shape": [teacher_grid, teacher_grid, teacher_grid, 1],
            "channelOrder": [channel],
        }
        candidate_count = int(test_features.shape[0])
        per_candidate_macs = 50 * int(args.hidden_width) + int(args.hidden_width)
        total_macs = candidate_count * per_candidate_macs
        dense_teacher_two_head_macs = (160 ** 3) * 2 * 8928
        projection_ratio = total_macs / dense_teacher_two_head_macs
        projected_range = [338.48 * projection_ratio, 529.86 * projection_ratio]
        coarse_projection = (coarse_manifest.get("runtimeProjection") or {}).get(
            "projectedMillisecondsFromMeasuredDenseTeacherRange"
        )
        if not isinstance(coarse_projection, list) or len(coarse_projection) != 2:
            raise ProbeFailure("output-write", "coarse arithmetic projection is missing")
        combined_range = [
            float(coarse_projection[index]) + projected_range[index] for index in range(2)
        ]
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "producer": producer_receipt(args),
            "authority": "diagnostic-teacher-distillation-source-visible-admission-v0",
            "runtimeTruthAvailable": False,
            "frameRoles": {"trainTransition": train_pair, "testTransition": test_pair},
            "inputs": {
                "sourceGrid": int(test_current["sourceGrid"]), "teacherGrid": teacher_grid,
                "route": test_current["route"], "backend": test_current["backend"], "bindings": evidence,
            },
            "coarseScaffold": coarse_receipt,
            "admission": {
                "identity": calibration["identity"],
                "calibrationPath": calibration["path"], "calibrationSha256": calibration["sha256"],
                "threshold": float(calibration["threshold"]), "scaleQuantile": float(calibration["scaleQuantile"]),
                "channelScales": calibration["channelScales"],
                "calibrationRuleReplay": {
                    "channelScaleParity": calibration_replay["channelScaleParity"],
                    "thresholdParity": calibration_replay["thresholdParity"],
                    "selectedOn": train_pair,
                    "testDataUsedForSelection": False,
                },
                "authority": calibration["authority"],
                "runtimeTruthUsed": calibration["runtimeTruthUsed"],
                "targetArtifactsRead": calibration["targetArtifactsRead"],
                "targetErrorRankingUsed": calibration["targetErrorRankingUsed"],
                "runtimeTopK": calibration["runtimeTopK"],
                "dynamicPercentile": calibration["dynamicPercentile"],
                "hiddenCandidateCap": calibration["hiddenCandidateCap"],
                "train": {key: value for key, value in gates["train"].items() if key not in ("score", "mask", "indexes")},
                "test": {key: value for key, value in gates["test"].items() if key not in ("score", "mask", "indexes")},
            },
            "features": {
                "identity": FEATURE_IDENTITY, "featureCount": 50,
                "currentSourceFieldCount": 17, "sourceDeltaFieldCount": 17,
                "coarseFrontSupportTemporalCount": 4, "coarseGradientCount": 6,
                "positionCount": 3, "sourceSubcellCount": 3,
                "sourceFieldChannelOrder": CHANNELS, "allSourceFieldsPreserved": True,
            },
            "target": {
                "identity": "teacher-front-residual-minus-learned-coarse-front-v0",
                "admissionIndependentOfTarget": True,
                "ridgeWeight": float(args.ridge_weight), "temporalWeight": float(args.temporal_weight),
                "ridgeScaleQ95": ridge_scale, "temporalScaleQ95": temporal_scale,
                "heldPreviousPredictionRole": "training-transition-current-frame-in-sample",
            },
            "student": {
                "architecture": ARCHITECTURE, "candidateOnly": True,
                "inputWidth": 50, "hiddenWidth": int(args.hidden_width),
                "trainingRows": int(train_features.shape[0]), "heldRows": int(test_features.shape[0]),
                "training": {"epochs": int(args.epochs), "batchSize": int(args.batch_size), "losses": losses},
            },
            "held": {
                "spatial": spatial,
                "temporal": temporal_metrics,
                "coarseSpatial": coarse_spatial,
                "composedSpatial": composed_spatial,
                "composedTemporal": composed_temporal,
            },
            "checkpoint": {
                "path": str(checkpoint_path), "sha256": sha256_file(checkpoint_path),
                "byteLength": checkpoint_path.stat().st_size,
                "replay": {"outputParity": output_parity, "sourceBindingParity": binding_parity},
            },
            "runtimeProjection": {
                "identity": "arithmetic-only-candidate-detail-head-projection-v0",
                "candidateCount": candidate_count,
                "candidateCoverage": float(gates["test"]["coverage"]),
                "inputFeatureCount": 50,
                "hiddenWidth": int(args.hidden_width),
                "multiplyAccumulatesPerCandidate": per_candidate_macs,
                "multiplyAccumulatesPerFrame": total_macs,
                "ratioVsMeasuredDenseTeacherTwoHeadArithmetic": projection_ratio,
                "projectedMillisecondsFromMeasuredDenseTeacherRange": projected_range,
                "measuredGpuRuntime": None,
                "combinedWithCoarse": {
                    "projectedMillisecondsFromMeasuredDenseTeacherRange": combined_range,
                    "measuredGpuRuntime": None,
                },
                "capped": False,
                "disclaimer": "Candidate-head MAC scaling only; admission, feature construction, memory traffic, dispatch, compaction, interpolation, and synchronization are not measured here.",
            },
            "outputs": {
                "trainDetail": output_descriptor(train_detail_path, "frontTopologyDetail"),
                "heldDetail": output_descriptor(held_detail_path, "frontTopologyDetail"),
                "heldComposedFrontResidual": output_descriptor(held_composed_path, "frontTopologyResidual"),
            },
            "claims": {
                "fixedGateReplayExact": True,
                "fieldImprovementMeasured": True,
                "runtimeMeasured": False,
                "renderedMotionInspected": False,
                "productionClosure": False,
            },
        }
        write_json(manifest_path, report)
        print(json.dumps({
            "status": "captured", "manifest": str(manifest_path),
            "heldSpatialRelativeErrorReduction": spatial["relativeErrorReductionVsCoarse"],
            "heldTemporalRelativeErrorReduction": temporal_metrics["relativeErrorReductionVsCoarse"],
        }))
        return 0
    except Exception as error:
        if isinstance(error, ProbeFailure):
            phase = error.phase
            failure_evidence = error.evidence
        else:
            failure_evidence = {}
        report = {
            "schema": SCHEMA, "identity": IDENTITY, "status": "failed", "failurePhase": phase,
            "producer": producer_receipt(args), "error": str(error),
            "lastTrustworthyEvidence": {**evidence, **failure_evidence},
        }
        write_json(manifest_path, report)
        print(json.dumps({"status": "failed", "failurePhase": phase, "error": str(error)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
