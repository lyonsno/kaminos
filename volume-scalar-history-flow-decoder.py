#!/usr/bin/env python3
"""Supervise diagnostic flow from scalar history without low velocity inputs."""

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


SCHEMA = "kaminos.volume.scalar-history-flow-decoder.v0"
IDENTITY = "scalar-history-flow-transposition-decoder-v0"
SCALAR_HISTORY_FEATURE_IDENTITY = "oracle-high-scalar-history-position-features-no-low-velocity-v0"
DIAGNOSTIC_RGB_TARGET_IDENTITY = "derived-flow-debug-diagnostic-rgb-v0"
DEFAULT_CARRIERS = [
    "densityCarrier",
    "smokeDensity",
    "heat",
    "flame",
    "ember",
    "visibleFireCarrier",
    "combustionFront",
    "microdetail",
    "interfaceShred",
    "fireLick",
    "emberFleck",
    "frontTopology",
]
TARGET_CHANNELS = ["red", "green", "blue"]

_PROXY_PATH = Path(__file__).with_name("volume-scalar-derived-transport-proxy.py")
_PROXY_SPEC = importlib.util.spec_from_file_location("volume_scalar_derived_transport_proxy", _PROXY_PATH)
if _PROXY_SPEC is None or _PROXY_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_PROXY_PATH}")
_PROXY = importlib.util.module_from_spec(_PROXY_SPEC)
_PROXY_SPEC.loader.exec_module(_PROXY)

_LABEL_PATH = Path(__file__).with_name("volume-full-grid-diagnostic-rgb-context-ablation.py")
_LABEL_SPEC = importlib.util.spec_from_file_location("volume_full_grid_diagnostic_rgb_context_ablation", _LABEL_PATH)
if _LABEL_SPEC is None or _LABEL_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_LABEL_PATH}")
_LABEL = importlib.util.module_from_spec(_LABEL_SPEC)
_LABEL_SPEC.loader.exec_module(_LABEL)

_CHANNEL_PATH = Path(__file__).with_name("volume-full-grid-field-per-channel-probe.py")
_CHANNEL_SPEC = importlib.util.spec_from_file_location("volume_full_grid_field_per_channel_probe", _CHANNEL_PATH)
if _CHANNEL_SPEC is None or _CHANNEL_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_CHANNEL_PATH}")
_CHANNEL = importlib.util.module_from_spec(_CHANNEL_SPEC)
_CHANNEL_SPEC.loader.exec_module(_CHANNEL)

_APPLY_PATH = Path(__file__).with_name("volume-full-grid-field-residual-apply.py")
_APPLY_SPEC = importlib.util.spec_from_file_location("volume_full_grid_field_residual_apply", _APPLY_PATH)
if _APPLY_SPEC is None or _APPLY_SPEC.loader is None:
    raise RuntimeError(f"Unable to load {_APPLY_PATH}")
_APPLY = importlib.util.module_from_spec(_APPLY_SPEC)
_APPLY_SPEC.loader.exec_module(_APPLY)

ALL_CHANNELS = list(_PROXY.ALL_CHANNELS)


class DecoderFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--train-frame-t0", type=int, default=1000)
    parser.add_argument("--train-frame-t1", type=int, default=1200)
    parser.add_argument("--test-frame-pairs", default="1200:1400,1400:1600")
    parser.add_argument("--carrier-channel-list", default=",".join(DEFAULT_CARRIERS))
    parser.add_argument("--train-samples", type=int, default=60_000)
    parser.add_argument("--test-samples", type=int, default=35_000)
    parser.add_argument("--support-sample-fraction", type=float, default=0.55)
    parser.add_argument("--hidden-width", type=int, default=48)
    parser.add_argument("--epochs", type=int, default=55)
    parser.add_argument("--learning-rate", type=float, default=2.0e-3)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--weight-decay", type=float, default=1.0e-5)
    parser.add_argument("--preview-slice-y", type=int)
    parser.add_argument("--seed", type=int, default=9719)
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_failure(path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    payload = {
        "schema": SCHEMA,
        "status": "failed",
        "identity": IDENTITY,
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, DecoderFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(path, payload)


def parse_frame_pairs(raw: str) -> list[tuple[int, int]]:
    pairs = []
    for part in raw.split(","):
        if not part.strip():
            continue
        bits = part.split(":")
        if len(bits) != 2:
            raise DecoderFailure("args", "Frame pairs must be t0:t1 comma-separated.", {"value": raw})
        t0, t1 = int(bits[0]), int(bits[1])
        if t1 <= t0:
            raise DecoderFailure("args", "Frame pair t1 must be greater than t0.", {"pair": part})
        pairs.append((t0, t1))
    if not pairs:
        raise DecoderFailure("args", "No test frame pairs selected.", {"value": raw})
    return pairs


def parse_carriers(raw: str) -> list[str]:
    carriers = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = [name for name in carriers if name not in ALL_CHANNELS]
    if unknown:
        raise DecoderFailure("args", "Unknown scalar carrier.", {"unknown": unknown, "available": ALL_CHANNELS})
    if any(name in ("velocityX", "velocityY", "velocityZ") for name in carriers):
        raise DecoderFailure("args", "Velocity channels are forbidden for this no-low-velocity scalar history decoder.", {"carrierChannelList": carriers})
    return carriers


def load_frame(motion: dict[str, Any], time_ms: int) -> dict[str, Any]:
    key = str(int(time_ms))
    path = motion.get("highManifests", {}).get(key)
    if not path:
        raise DecoderFailure("manifest-read", "Missing high frame manifest.", {"timeMs": time_ms, "availableHigh": sorted(motion.get("highManifests", {}).keys())})
    return _PROXY.load_export(Path(path))


def sample_indexes(cell_count: int, count: int, support: np.ndarray, support_fraction: float, rng: np.random.Generator, exclude: np.ndarray | None = None) -> np.ndarray:
    count = min(max(1, int(count)), int(cell_count))
    exclude_set = set(int(x) for x in exclude.tolist()) if exclude is not None and exclude.size else set()
    support = support.astype(np.int64, copy=False)
    if exclude_set:
        support = np.array([int(x) for x in support.tolist() if int(x) not in exclude_set], dtype=np.int64)
    support_target = min(support.shape[0], int(count * max(0.0, min(1.0, float(support_fraction)))))
    chosen: list[int] = []
    if support_target > 0:
        chosen.extend(rng.choice(support, size=support_target, replace=False).astype(np.int64).tolist())
    needed = count - len(chosen)
    chosen_set = set(chosen) | exclude_set
    while needed > 0:
        randoms = rng.integers(0, cell_count, size=max(needed * 2, needed + 64), dtype=np.int64)
        for value in randoms.tolist():
            if value in chosen_set:
                continue
            chosen.append(int(value))
            chosen_set.add(int(value))
            needed -= 1
            if needed == 0:
                break
    return np.array(chosen, dtype=np.int64)


def target_rgb(frame: dict[str, Any], indexes: np.ndarray) -> np.ndarray:
    rgb, _ = _LABEL.derived_flow_debug_rgb(frame["fluid"], indexes, int(frame["grid"]))
    return np.clip(rgb, 0.0, 1.0).astype(np.float32, copy=False)


def support_from_target(rgb: np.ndarray, indexes: np.ndarray) -> np.ndarray:
    norm = np.linalg.norm(rgb.astype(np.float64), axis=1)
    threshold = max(1.0e-5, float(np.quantile(norm, 0.90)) * 0.35)
    return indexes[np.flatnonzero(norm > threshold)]


def position_basis(indexes: np.ndarray, grid: int) -> np.ndarray:
    x = indexes % grid
    y = (indexes // grid) % grid
    z = indexes // (grid * grid)
    low_dummy = np.zeros((indexes.shape[0], len(_APPLY.FLUID_CHANNELS) + len(_APPLY.FRONT_CHANNELS)), dtype=np.float32)
    full = _APPLY.build_features(low_dummy, x.astype(np.int64), y.astype(np.int64), z.astype(np.int64), grid)
    return full[:, 2 * low_dummy.shape[1]:].astype(np.float32, copy=False)


def scalar_history_features(frame0: dict[str, Any], frame1: dict[str, Any], indexes: np.ndarray, carriers: list[str]) -> np.ndarray:
    c0 = _PROXY.channel_values(frame0, indexes, carriers)
    c1 = _PROXY.channel_values(frame1, indexes, carriers)
    scale = np.quantile(np.abs(np.concatenate([c0, c1], axis=0)).astype(np.float64), 0.95, axis=0).astype(np.float32)
    scale = np.where(scale < np.float32(1.0e-6), np.float32(1.0), scale)
    c0n = c0 / scale.reshape(1, -1)
    c1n = c1 / scale.reshape(1, -1)
    delta = c1n - c0n
    pos = position_basis(indexes, int(frame0["grid"]))
    energy = np.linalg.norm(np.concatenate([c0n, c1n], axis=1).astype(np.float32), axis=1, keepdims=True)
    return np.concatenate([c0n, c1n, delta, np.abs(delta), energy, pos], axis=1).astype(np.float32, copy=False)


def vector_metrics(prediction: np.ndarray, truth: np.ndarray) -> dict[str, float]:
    err = prediction.astype(np.float64) - truth.astype(np.float64)
    abs_err = np.abs(err)
    return {
        "mse": float(np.mean(err * err)),
        "rmse": float(math.sqrt(float(np.mean(err * err)))),
        "mae": float(np.mean(abs_err)),
        "maxAbs": float(np.max(abs_err)) if abs_err.size else 0.0,
    }


def debugRgbCorrelation(prediction: np.ndarray, truth: np.ndarray) -> float | None:
    a = prediction.reshape(-1).astype(np.float64)
    b = truth.reshape(-1).astype(np.float64)
    if float(np.std(a)) <= 1.0e-12 or float(np.std(b)) <= 1.0e-12:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def standardize(train_features: np.ndarray, test_features: np.ndarray) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    mean = np.mean(train_features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.std(train_features, axis=0, dtype=np.float64).astype(np.float32)
    std = np.where(std < np.float32(1.0e-6), np.float32(1.0), std)
    return (
        ((train_features - mean.reshape(1, -1)) / std.reshape(1, -1)).astype(np.float32),
        ((test_features - mean.reshape(1, -1)) / std.reshape(1, -1)).astype(np.float32),
        {
            "identity": "train-feature-standardization-v0",
            "featureCount": int(train_features.shape[1]),
            "zeroStdFeatureCount": int(np.count_nonzero(std == 1.0)),
            "mean": mean,
            "std": std,
        },
    )


def apply_standardization(features: np.ndarray, standardization: dict[str, Any]) -> np.ndarray:
    return ((features - standardization["mean"].reshape(1, -1)) / standardization["std"].reshape(1, -1)).astype(np.float32)


def train_component_heads(train_features: np.ndarray, train_target: np.ndarray, args: argparse.Namespace, feature_role: str) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
    states = {}
    reports = []
    dummy_test = train_features[:1]
    train_args = argparse.Namespace(
        hidden_width=int(args.hidden_width),
        epochs=int(args.epochs),
        learning_rate=float(args.learning_rate),
        batch_size=int(args.batch_size),
        weight_decay=float(args.weight_decay),
    )
    for component_index, component_name in enumerate(TARGET_CHANNELS):
        rng = np.random.default_rng(int(args.seed) + component_index * 1009 + (0 if feature_role == "scalar" else 100000))
        _residual, report, state = _CHANNEL.train_scalar_mlp(
            train_features,
            train_target[:, component_index],
            dummy_test,
            train_args,
            rng,
            training_objective={
                "identity": "scalar-history-flow-decoder-supervised-mse-v0",
                "featureRole": feature_role,
                "diagnosticRgbTargetIdentity": DIAGNOSTIC_RGB_TARGET_IDENTITY,
                "component": component_name,
            },
        )
        states[component_name] = state
        reports.append(report)
    return states, {
        "hiddenWidth": int(args.hidden_width),
        "epochs": int(args.epochs),
        "learningRate": float(args.learning_rate),
        "batchSize": int(args.batch_size),
        "weightDecay": float(args.weight_decay),
    }, reports


def predict_rgb(features_std: np.ndarray, states: dict[str, Any]) -> np.ndarray:
    parts = [_CHANNEL.predict_scalar_mlp(features_std, states[name]) for name in TARGET_CHANNELS]
    return np.clip(np.stack(parts, axis=1), 0.0, 1.0).astype(np.float32)


def image_from_rgb_flat(values: np.ndarray, grid: int) -> np.ndarray:
    return np.asarray(np.round(np.clip(values.reshape(grid, grid, 3), 0.0, 1.0)[::-1, :, :] * 255.0), dtype=np.uint8)


def write_contact_sheet(out_dir: Path, rows: list[tuple[str, np.ndarray]], grid: int, slice_y: int) -> dict[str, Any]:
    label_h = 28
    gap = 6
    width = grid
    height = label_h + len(rows) * grid + max(0, len(rows) - 1) * gap
    sheet = np.zeros((height, width, 3), dtype=np.uint8)
    labels = [_LABEL.draw_label(sheet, f"y={slice_y}", 8, 8, scale=2)]
    y = label_h
    for label, values in rows:
        sheet[y:y + grid, :, :] = image_from_rgb_flat(values, grid)
        labels.append(_LABEL.draw_label(sheet, label, 8, y + 8, scale=2))
        y += grid + gap
    path = out_dir / "scalar-history-flow-decoder-contact.png"
    _LABEL.write_png_rgb(path, sheet)
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "visibleRasterLabels": {
            "identity": "burned-contact-sheet-labels-v0",
            "labels": labels,
        },
    }


def source_receipt(frame: dict[str, Any]) -> dict[str, Any]:
    return {
        "manifest": frame["path"],
        "manifestSha256": sha256_file(Path(frame["path"])),
        "grid": int(frame["grid"]),
        "fluid": {"path": str(frame["fluidPath"]), "sha256": frame["fluidDescriptor"].get("sha256")},
        "front": {"path": str(frame["frontPath"]), "sha256": frame["frontDescriptor"].get("sha256")},
        "routeIdentity": frame["manifest"].get("routeIdentity"),
        "effectiveRoute": frame["manifest"].get("effectiveRoute"),
        "backend": frame["manifest"].get("backend"),
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    evidence = {"args": vars(args)}
    try:
        motion_path = Path(args.motion_manifest).resolve()
        motion = read_json(motion_path)
        if motion.get("schema") != "kaminos.temporal-velocity-closure-motion.v0":
            raise DecoderFailure("manifest-read", "Motion manifest schema mismatch.", {"schema": motion.get("schema")})
        carriers = parse_carriers(args.carrier_channel_list)
        test_pairs = parse_frame_pairs(args.test_frame_pairs)
        train0 = load_frame(motion, int(args.train_frame_t0))
        train1 = load_frame(motion, int(args.train_frame_t1))
        grid = int(train0["grid"])
        if train1["grid"] != grid:
            raise DecoderFailure("manifest-read", "Train frame grid mismatch.")
        cell_count = grid ** 3
        rng = np.random.default_rng(int(args.seed))
        support_scan = rng.choice(cell_count, size=min(cell_count, max(int(args.train_samples), 120_000)), replace=False)
        support = support_from_target(target_rgb(train1, support_scan), support_scan)
        train_indexes = sample_indexes(cell_count, int(args.train_samples), support, float(args.support_sample_fraction), rng)
        train_target = target_rgb(train1, train_indexes)
        train_scalar_features = scalar_history_features(train0, train1, train_indexes, carriers)
        train_position_features = position_basis(train_indexes, grid)
        scalar_train_std, _dummy_scalar_test, scalar_std = standardize(train_scalar_features, train_scalar_features[:1])
        position_train_std, _dummy_position_test, position_std = standardize(train_position_features, train_position_features[:1])
        scalar_states, scalar_train_config, scalar_reports = train_component_heads(scalar_train_std, train_target, args, "scalar")
        position_states, position_train_config, position_reports = train_component_heads(position_train_std, train_target, args, "position")
        target_mean = np.mean(train_target, axis=0, dtype=np.float64).astype(np.float32)

        frameHoldoutMetrics = []
        preview_rows: list[tuple[str, np.ndarray]] = []
        preview_pair_label = None
        slice_y = grid // 2 if args.preview_slice_y is None else max(0, min(grid - 1, int(args.preview_slice_y)))
        slice_indexes = _PROXY.high_slice_indexes(grid, slice_y)

        for pair_index, (t0, t1) in enumerate(test_pairs):
            frame0 = load_frame(motion, t0)
            frame1 = load_frame(motion, t1)
            test_support_scan = rng.choice(cell_count, size=min(cell_count, max(int(args.test_samples), 80_000)), replace=False)
            test_support = support_from_target(target_rgb(frame1, test_support_scan), test_support_scan)
            test_indexes = sample_indexes(cell_count, int(args.test_samples), test_support, float(args.support_sample_fraction), rng)
            truth = target_rgb(frame1, test_indexes)
            scalar_features = scalar_history_features(frame0, frame1, test_indexes, carriers)
            position_features = position_basis(test_indexes, grid)
            scalar_pred = predict_rgb(apply_standardization(scalar_features, scalar_std), scalar_states)
            position_pred = predict_rgb(apply_standardization(position_features, position_std), position_states)
            mean_pred = np.repeat(target_mean.reshape(1, 3), test_indexes.shape[0], axis=0)
            frame_metrics = {
                "framePairIdentity": f"{t0}->{t1}",
                "sampleCount": int(test_indexes.shape[0]),
                "meanTargetBaseline": {
                    "metrics": vector_metrics(mean_pred, truth),
                    "debugRgbCorrelation": debugRgbCorrelation(mean_pred, truth),
                },
                "positionOnlyBaseline": {
                    "metrics": vector_metrics(position_pred, truth),
                    "debugRgbCorrelation": debugRgbCorrelation(position_pred, truth),
                },
                "truthHighScalarHistoryDecoder": {
                    "metrics": vector_metrics(scalar_pred, truth),
                    "debugRgbCorrelation": debugRgbCorrelation(scalar_pred, truth),
                },
            }
            frameHoldoutMetrics.append(frame_metrics)
            if pair_index == 0:
                preview_pair_label = f"{t0}->{t1}"
                slice_truth = target_rgb(frame1, slice_indexes)
                slice_scalar = predict_rgb(apply_standardization(scalar_history_features(frame0, frame1, slice_indexes, carriers), scalar_std), scalar_states)
                slice_position = predict_rgb(apply_standardization(position_basis(slice_indexes, grid), position_std), position_states)
                slice_mean = np.repeat(target_mean.reshape(1, 3), slice_indexes.shape[0], axis=0)
                preview_rows = [
                    ("truthHigh", slice_truth),
                    ("meanBase", slice_mean),
                    ("posOnly", slice_position),
                    ("scalarHist", slice_scalar),
                ]

        contact = write_contact_sheet(out_dir, preview_rows, grid, slice_y)
        manifest = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": IDENTITY,
            "authority": "oracle-high-scalar-history-supervised-flow-decoder-no-low-velocity-input",
            "motionManifest": str(motion_path),
            "motionManifestSha256": sha256_file(motion_path),
            "trainFramePairIdentity": f"{int(args.train_frame_t0)}->{int(args.train_frame_t1)}",
            "testFramePairIdentities": [f"{t0}->{t1}" for t0, t1 in test_pairs],
            "previewFramePairIdentity": preview_pair_label,
            "highGrid": grid,
            "carrierChannelList": carriers,
            "diagnosticRgbTargetIdentity": DIAGNOSTIC_RGB_TARGET_IDENTITY,
            "noLowVelocityInputPolicy": {
                "identity": "no-low-velocity-input-policy-v0",
                "excludedLowVelocityInputs": ["lowUpsampledVelocityX", "lowUpsampledVelocityY", "lowUpsampledVelocityZ", "velocityX", "velocityY", "velocityZ"],
                "note": "Inputs are oracle high scalar carrier history plus position only. Low velocity and high velocity are target/diagnostic only, never predictor inputs.",
            },
            "scalarHistoryFeatureIdentity": {
                "identity": SCALAR_HISTORY_FEATURE_IDENTITY,
                "featureOrder": ["carrierT0", "carrierT1", "carrierDelta", "absCarrierDelta", "historyEnergy", "positionBasis"],
                "featureCount": int(train_scalar_features.shape[1]),
                "positionBasisSource": "volume-full-grid-field-residual-apply.py position/Fourier/RBF tail",
            },
            "training": {
                "trainSamples": int(train_indexes.shape[0]),
                "hiddenWidth": int(args.hidden_width),
                "epochs": int(args.epochs),
                "learningRate": float(args.learning_rate),
                "batchSize": int(args.batch_size),
                "scalarTrainConfig": scalar_train_config,
                "positionTrainConfig": position_train_config,
                "scalarComponentReports": scalar_reports,
                "positionComponentReports": position_reports,
            },
            "frameHoldoutMetrics": frameHoldoutMetrics,
            "roles": {
                "meanTargetBaseline": "constant train target mean, no velocity input",
                "positionOnlyBaseline": "position basis only, no velocity input",
                "truthHighScalarHistoryDecoder": "oracle high scalar history plus position, no velocity input",
            },
            "sourceChecksums": {
                "trainT0": source_receipt(train0),
                "trainT1": source_receipt(train1),
            },
            "contactSheet": contact,
            "visibleRasterLabels": contact["visibleRasterLabels"],
            "limitations": [
                "Oracle high scalar history is an upper-bound transposition substrate, not a product input.",
                "This is a sampled same-route temporal holdout over frame times, not route-family generalization.",
                "No low velocity input is used; high velocity is used only through the diagnostic RGB target.",
            ],
        }
        write_json(manifest_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_path),
            "contactSheet": contact["path"],
            "trainFramePairIdentity": manifest["trainFramePairIdentity"],
            "frameHoldoutMetrics": [
                {
                    "framePairIdentity": m["framePairIdentity"],
                    "meanRmse": m["meanTargetBaseline"]["metrics"]["rmse"],
                    "positionRmse": m["positionOnlyBaseline"]["metrics"]["rmse"],
                    "scalarHistoryRmse": m["truthHighScalarHistoryDecoder"]["metrics"]["rmse"],
                    "scalarHistoryDebugRgbCorrelation": m["truthHighScalarHistoryDecoder"]["debugRgbCorrelation"],
                }
                for m in frameHoldoutMetrics
            ],
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(manifest_path, "unknown", error, evidence)
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
