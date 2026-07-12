#!/usr/bin/env python3
import argparse
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np


SCHEMA = "kaminos.boundary-splat-attribute-training.v0"
MODEL_SCHEMA = "kaminos-boundary-splat-attribute-mlp-v0"
ROUTE_IDENTITY = "analytic-boundary-splat-teacher-parity-v0"
FEATURES = [
    "sidecar.support",
    "sidecar.coverage",
    "sidecar.ridge",
    "sidecar.footprint",
    "material.density",
    "material.heat",
    "material.fuel",
    "material.detail",
    "fire.energy",
    "fire.temperature",
    "fire.emission",
    "fire.detail",
    "micro.x",
    "micro.y",
    "micro.z",
    "micro.w",
]
OUTPUTS = ["color.r", "color.g", "color.b", "opacity", "radius.x", "radius.y"]
OUTPUT_RANGES = [[0.0, 1.0], [0.0, 1.0], [0.0, 1.0], [0.001, 0.08], [0.2, 6.0], [0.2, 6.0]]


def smoothstep(lower, upper, value):
    t = np.clip((value - lower) / max(1e-8, upper - lower), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def evaluate_teacher(features):
    sidecar = features[:, 0:4]
    material = features[:, 4:8]
    fire = features[:, 8:12]
    micro = features[:, 12:16]
    fire_signal = fire[:, 0] * 1.25 + fire[:, 2] * 0.52 + fire[:, 3] * 0.86 + micro[:, 2] * 0.72 + material[:, 1] * 0.24
    structural_signal = sidecar[:, 2] * smoothstep(0.055, 0.32, sidecar[:, 1]) * smoothstep(0.018, 0.16, fire_signal)
    thermal = smoothstep(0.025, 0.78, material[:, 1] + features[:, 8] * 0.28)
    white_hot = smoothstep(0.42, 1.25, fire_signal)
    cool = np.asarray([0.05, 0.16, 0.72], dtype=np.float32)
    warm = np.asarray([0.86, 0.38, 0.07], dtype=np.float32)
    base_color = cool[None, :] * (1.0 - thermal[:, None]) + warm[None, :] * thermal[:, None]
    white = np.asarray([0.82, 0.72, 0.48], dtype=np.float32)
    white_mix = white_hot[:, None] * 0.52
    color = base_color * (1.0 - white_mix) + white[None, :] * white_mix
    opacity = np.clip(structural_signal * (0.008 + fire_signal * 0.055), 0.002, 0.038)
    radius = 0.60 + sidecar[:, 3] * 2.65 + sidecar[:, 2] * 0.48
    radius_x = radius * (0.72 + sidecar[:, 2] * 0.36)
    radius_y = radius * (1.0 + sidecar[:, 3] * 0.42)
    targets = np.concatenate(
        [color, opacity[:, None], radius_x[:, None], radius_y[:, None]],
        axis=1,
    ).astype(np.float32)
    return targets


def sample_teacher(sample_count, seed):
    rng = np.random.default_rng(seed)
    features = rng.random((sample_count, len(FEATURES)), dtype=np.float32)
    sidecar = features[:, 0:4]
    material = features[:, 4:8]
    fire = features[:, 8:12]
    micro = features[:, 12:16]
    fire_signal = fire[:, 0] * 1.25 + fire[:, 2] * 0.52 + fire[:, 3] * 0.86 + micro[:, 2] * 0.72 + material[:, 1] * 0.24
    structural_signal = sidecar[:, 2] * smoothstep(0.055, 0.32, sidecar[:, 1]) * smoothstep(0.018, 0.16, fire_signal)
    features = features[structural_signal >= 0.11]
    targets = evaluate_teacher(features)
    return features.astype(np.float32), targets


def output_ranges_for_targets(targets, live_support):
    ranges = [list(entry) for entry in OUTPUT_RANGES]
    if live_support:
        for index in (4, 5):
            ranges[index][1] = max(ranges[index][1], float(np.max(targets[:, index])) * 1.05)
    return ranges


class AttributeMlp(nn.Module):
    def __init__(self, hidden_size):
        super().__init__()
        self.hidden = nn.Linear(len(FEATURES), hidden_size)
        self.output = nn.Linear(hidden_size, len(OUTPUTS))

    def __call__(self, inputs):
        return mx.sigmoid(self.output(nn.relu(self.hidden(inputs))))


def observed_ranges(targets):
    return [[float(np.min(targets[:, index])), float(np.max(targets[:, index]))] for index in range(targets.shape[1])]


def write_json(path, payload):
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--job-input")
    parser.add_argument("--feature-input")
    parser.add_argument("--sample-count", type=int, default=65536)
    parser.add_argument("--hidden-size", type=int, default=32)
    parser.add_argument("--steps", type=int, default=1200)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    parser.add_argument("--seed", type=int, default=712)
    parser.add_argument("--probe-only", action="store_true")
    return parser.parse_args()


def main():
    args = parse_args()
    if args.sample_count <= 0 or args.hidden_size <= 0 or args.steps < 0 or args.batch_size <= 0:
        raise ValueError("sample-count, hidden-size, and batch-size must be positive; steps cannot be negative")
    output_dir = Path(args.out_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    started_at = time.time()
    job_input = None
    job_document = None
    job_input_path = None
    if args.job_input:
        job_input_path = Path(args.job_input).resolve()
        job_input_bytes = job_input_path.read_bytes()
        job_document = json.loads(job_input_bytes)
        job_input = {
            "path": str(job_input_path),
            "bytes": len(job_input_bytes),
            "sha256": hashlib.sha256(job_input_bytes).hexdigest(),
        }
    effective_route_identity = (
        job_document.get("routeIdentity")
        if isinstance(job_document, dict) and isinstance(job_document.get("routeIdentity"), str)
        else ROUTE_IDENTITY
    )
    feature_input_value = args.feature_input
    if not feature_input_value and isinstance(job_document, dict):
        feature_entry = job_document.get("featureInput")
        if isinstance(feature_entry, dict):
            feature_input_value = feature_entry.get("path")
        elif isinstance(feature_entry, str):
            feature_input_value = feature_entry
    feature_source = None
    try:
        if feature_input_value:
            feature_input_path = Path(feature_input_value)
            if not feature_input_path.is_absolute() and job_input_path:
                feature_input_path = job_input_path.parent / feature_input_path
            feature_input_path = feature_input_path.resolve()
            feature_bytes = feature_input_path.read_bytes()
            row_bytes = len(FEATURES) * np.dtype(np.float32).itemsize
            if not feature_bytes or len(feature_bytes) % row_bytes != 0:
                raise ValueError(f"feature input byte length must encode a positive multiple of {len(FEATURES)} float32 values")
            feature_sha256 = hashlib.sha256(feature_bytes).hexdigest()
            feature_entry = job_document.get("featureInput") if isinstance(job_document, dict) else None
            if isinstance(feature_entry, dict) and feature_entry.get("sha256") and feature_entry["sha256"] != feature_sha256:
                raise ValueError(f"feature input sha256 mismatch: expected {feature_entry['sha256']}, received {feature_sha256}")
            features = np.frombuffer(feature_bytes, dtype=np.float32).reshape(-1, len(FEATURES)).copy()
            if not np.all(np.isfinite(features)):
                raise ValueError("feature input contains non-finite values")
            targets = evaluate_teacher(features)
            feature_source = {
                "authority": "captured-live-selected-candidates-v0",
                "path": str(feature_input_path),
                "bytes": len(feature_bytes),
                "sha256": feature_sha256,
                "rowCount": int(features.shape[0]),
                "strideFloats": len(FEATURES),
            }
            selection = "preselected-live-candidates"
        else:
            features, targets = sample_teacher(args.sample_count, args.seed)
            selection = "structuralSignal >= 0.11"
    except Exception as error:
        failure_report = {
            "schema": SCHEMA,
            "status": "failed",
            "failurePhase": "feature-input",
            "error": str(error),
            "routeIdentity": effective_route_identity,
            "jobInput": job_input,
            "backend": "mlx",
            "device": str(mx.default_device()),
            "finishedAt": time.time(),
        }
        failure_report["elapsedSeconds"] = failure_report["finishedAt"] - started_at
        write_json(output_dir / "training-report.json", failure_report)
        raise
    output_ranges = output_ranges_for_targets(targets, feature_source is not None)
    report = {
        "schema": SCHEMA,
        "status": "probe-only" if args.probe_only else "training",
        "routeIdentity": effective_route_identity,
        "jobInput": job_input,
        "featureSource": feature_source,
        "backend": "mlx",
        "device": str(mx.default_device()),
        "features": FEATURES,
        "outputs": OUTPUTS,
        "requestedSampleCount": int(features.shape[0]) if feature_source else args.sample_count,
        "selectedSampleCount": int(features.shape[0]),
        "seed": args.seed,
        "hiddenSize": args.hidden_size,
        "teacher": {
            "authority": "exact-analytic-boundary-splat-wgsl-formulas-v0",
            "selection": selection,
            "outputRanges": output_ranges,
            "observedRanges": observed_ranges(targets),
        },
        "modelArtifact": None,
        "startedAt": started_at,
        "finishedAt": None,
        "elapsedSeconds": None,
    }
    if args.probe_only:
        report["finishedAt"] = time.time()
        report["elapsedSeconds"] = report["finishedAt"] - started_at
        write_json(output_dir / "training-report.json", report)
        print(json.dumps({"status": report["status"], "device": report["device"], "selectedSampleCount": report["selectedSampleCount"]}))
        return

    rng = np.random.default_rng(args.seed + 1)
    permutation = rng.permutation(features.shape[0])
    eval_count = max(1, features.shape[0] // 10)
    eval_indices = permutation[:eval_count]
    train_indices = permutation[eval_count:]
    lower = np.asarray([entry[0] for entry in output_ranges], dtype=np.float32)
    upper = np.asarray([entry[1] for entry in output_ranges], dtype=np.float32)
    target_normalized = np.clip((targets - lower) / (upper - lower), 0.0, 1.0).astype(np.float32)
    model = AttributeMlp(args.hidden_size)
    optimizer = optim.Adam(learning_rate=args.learning_rate)

    def loss_fn(active_model, batch_features, batch_targets):
        prediction = active_model(batch_features)
        return mx.mean(mx.square(prediction - batch_targets))

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    losses = []
    for step in range(args.steps):
        batch_indices = rng.choice(train_indices, size=min(args.batch_size, train_indices.shape[0]), replace=False)
        batch_features = mx.array(features[batch_indices])
        batch_targets = mx.array(target_normalized[batch_indices])
        loss, gradients = loss_and_grad(model, batch_features, batch_targets)
        optimizer.update(model, gradients)
        mx.eval(model.parameters(), optimizer.state, loss)
        if step == 0 or (step + 1) % 100 == 0 or step + 1 == args.steps:
            losses.append({"step": step + 1, "loss": float(loss.item())})

    eval_prediction_normalized = np.asarray(model(mx.array(features[eval_indices])))
    eval_prediction = lower + eval_prediction_normalized * (upper - lower)
    absolute_error = np.abs(eval_prediction - targets[eval_indices])
    metrics = {
        "evalSampleCount": int(eval_count),
        "mae": [float(value) for value in np.mean(absolute_error, axis=0)],
        "p95AbsoluteError": [float(value) for value in np.percentile(absolute_error, 95, axis=0)],
        "maxAbsoluteError": [float(value) for value in np.max(absolute_error, axis=0)],
        "lossTrace": losses,
    }
    model_artifact = {
        "schema": MODEL_SCHEMA,
        "architecture": "dense-relu-dense",
        "features": FEATURES,
        "outputs": OUTPUTS,
        "hiddenSize": args.hidden_size,
        "outputRanges": output_ranges,
        "layers": [
            {
                "inputSize": len(FEATURES),
                "outputSize": args.hidden_size,
                "activation": "relu",
                "weights": np.asarray(model.hidden.weight).reshape(-1).astype(float).tolist(),
                "bias": np.asarray(model.hidden.bias).reshape(-1).astype(float).tolist(),
            },
            {
                "inputSize": args.hidden_size,
                "outputSize": len(OUTPUTS),
                "activation": "linear",
                "weights": np.asarray(model.output.weight).reshape(-1).astype(float).tolist(),
                "bias": np.asarray(model.output.bias).reshape(-1).astype(float).tolist(),
            },
        ],
    }
    model_path = output_dir / "model-artifact.json"
    write_json(model_path, model_artifact)
    parity_count = min(64, eval_count)
    parity_path = output_dir / "parity-samples.json"
    write_json(
        parity_path,
        {
            "schema": "kaminos-boundary-splat-attribute-parity-v0",
            "features": features[eval_indices[:parity_count]].astype(float).tolist(),
            "outputs": eval_prediction[:parity_count].astype(float).tolist(),
            "authority": "mlx-eval-prediction-before-json-export-v0",
        },
    )
    compiler_path = Path(__file__).with_name("compile-boundary-splat-attribute-model.mjs")
    compiled_dir = output_dir / "compiled"
    node_path = shutil.which("node")
    if not node_path:
        report["status"] = "failed"
        report["failurePhase"] = "compile"
        report["error"] = "node executable not found"
        report["finishedAt"] = time.time()
        report["elapsedSeconds"] = report["finishedAt"] - started_at
        write_json(output_dir / "training-report.json", report)
        raise RuntimeError(report["error"])
    compile_result = subprocess.run(
        [
            node_path,
            str(compiler_path),
            "--input",
            str(model_path),
            "--out-dir",
            str(compiled_dir),
            "--parity-samples",
            str(parity_path),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if compile_result.returncode != 0:
        report["status"] = "failed"
        report["failurePhase"] = "compile"
        report["error"] = (compile_result.stderr or compile_result.stdout or "compiler failed").strip()
        report["finishedAt"] = time.time()
        report["elapsedSeconds"] = report["finishedAt"] - started_at
        write_json(output_dir / "training-report.json", report)
        raise RuntimeError(report["error"])
    compiled_receipt_path = compiled_dir / "compiled-model.json"
    compiled_receipt = json.loads(compiled_receipt_path.read_text(encoding="utf-8"))
    report["status"] = "trained"
    report["training"] = {
        "steps": args.steps,
        "batchSize": args.batch_size,
        "learningRate": args.learning_rate,
        "trainSampleCount": int(train_indices.shape[0]),
        **metrics,
    }
    report["modelArtifact"] = {
        "path": str(model_path),
        "schema": MODEL_SCHEMA,
        "identity": compiled_receipt["identity"],
        "compiledReceipt": str(compiled_receipt_path),
        "wgsl": compiled_receipt["wgsl"],
        "weights": compiled_receipt["weights"],
    }
    report["finishedAt"] = time.time()
    report["elapsedSeconds"] = report["finishedAt"] - started_at
    write_json(output_dir / "training-report.json", report)
    print(json.dumps({"status": report["status"], "device": report["device"], "elapsedSeconds": report["elapsedSeconds"], "mae": metrics["mae"]}))


if __name__ == "__main__":
    main()
