#!/usr/bin/env python3
"""Fit a tiny debug-flow-carrier to RGB fire reconstruction decoder."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.pyro-rgb-reconstruction-decoder.v0"
IDENTITY = "carrier-to-rgb-local-neighborhood-decoder-v0"
FEATURE_IDENTITY = "debug-flow-rgb-local-neighborhood-height-luma-interactions-v1"
PAIR_AUTHORITY = "sequential-route-captures-not-frame-locked"
LOW_CARRIER_INPUT_ROLE = "lowCarrierInput"
RGB_TARGET_ROLE = "rgbTarget"
RAW_BASELINE_ROLE = "rawCarrierResizeBaseline"
GLOBAL_BASELINE_ROLE = "globalColorLinearBaseline"
LOCAL_DECODER_ROLE = "localNeighborhoodRgbDecoder"
LIMITATION = "same-sequential-capture-carrier-to-rgb-diagnostic-not-frame-locked-product-proof"


class DecoderFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_alpha_helpers() -> Any:
    helper_path = Path(__file__).with_name("volume-render-rgb-alpha-cleanup.py")
    if not helper_path.exists():
        raise DecoderFailure("helper-load", "RGB alpha cleanup helper script is missing.", {"path": str(helper_path)})
    spec = importlib.util.spec_from_file_location("kaminos_rgb_alpha_cleanup", helper_path)
    if spec is None or spec.loader is None:
        raise DecoderFailure("helper-load", "Could not load RGB alpha cleanup helper module.", {"path": str(helper_path)})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


H = load_alpha_helpers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset-manifest", required=True, help="Manifest from volume-pyro-rgb-reconstruction-dataset.mjs.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--neighborhood-radius", type=int, default=1, help="Local input neighborhood radius.")
    parser.add_argument("--train-samples", type=int, default=50000, help="Deterministic training pixels for the tiny model.")
    parser.add_argument("--test-samples", type=int, default=30000, help="Deterministic held-out pixels for metrics.")
    parser.add_argument("--ridge", type=float, default=1.0e-3, help="Ridge regularization for linear solves.")
    parser.add_argument("--seed", type=int, default=730709, help="Deterministic pixel split seed.")
    parser.add_argument("--body-threshold", type=float, default=0.20, help="Target RGB norm threshold for body metrics.")
    parser.add_argument("--background-threshold", type=float, default=0.055, help="Target RGB norm threshold for empty/dark background metrics.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def dataset_payload(path: Path) -> dict[str, Any]:
    payload = read_json(path)
    dataset = payload.get("dataset", payload)
    if not isinstance(dataset, dict):
        raise DecoderFailure("manifest-read", "Dataset manifest root is not an object.", {"path": str(path)})
    if dataset.get("schema") != "kaminos.volume.pyro-rgb-reconstruction-dataset.v0":
        raise DecoderFailure("manifest-read", "Dataset manifest schema mismatch.", {
            "path": str(path),
            "schema": dataset.get("schema"),
        })
    if dataset.get("pairAuthority") != PAIR_AUTHORITY:
        raise DecoderFailure("manifest-read", "Dataset pair authority is not the expected sequential non-frame-locked identity.", {
            "expected": PAIR_AUTHORITY,
            "actual": dataset.get("pairAuthority"),
        })
    return dataset


def capture_path(dataset: dict[str, Any], role: str) -> Path:
    captures = dataset.get("captures", {})
    capture = captures.get(role)
    if not isinstance(capture, dict):
        raise DecoderFailure("manifest-read", "Dataset missing required capture role.", {"role": role})
    effective = capture.get("effective") if isinstance(capture.get("effective"), dict) else {}
    path = effective.get("path") or capture.get("out")
    if not path:
        raise DecoderFailure("manifest-read", "Dataset capture role has no image path.", {"role": role})
    return Path(path)


def capture_effective(dataset: dict[str, Any], role: str) -> dict[str, Any]:
    capture = dataset.get("captures", {}).get(role, {})
    effective = capture.get("effective")
    return effective if isinstance(effective, dict) else {}


def rgb_float(path: Path) -> tuple[np.ndarray, np.ndarray]:
    rgba = H.read_png_rgba(path)
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0
    return rgb, rgba


def resize_nearest(rgb: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    target_h, target_w = shape
    source_h, source_w = rgb.shape[:2]
    if (source_h, source_w) == (target_h, target_w):
        return rgb.copy()
    y = np.minimum((np.arange(target_h) * source_h / target_h).astype(np.int64), source_h - 1)
    x = np.minimum((np.arange(target_w) * source_w / target_w).astype(np.int64), source_w - 1)
    return rgb[y[:, None], x[None, :], :]


def rgb_norm(rgb: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum(np.square(rgb), axis=2))


def feature_grid(input_rgb: np.ndarray, radius: int, interactions: bool = True) -> np.ndarray:
    radius = max(0, int(radius))
    h, w, _ = input_rgb.shape
    padded = np.pad(input_rgb, ((radius, radius), (radius, radius), (0, 0)), mode="reflect")
    chunks = []
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            chunks.append(padded[radius + dy:radius + dy + h, radius + dx:radius + dx + w, :])
    local = np.concatenate(chunks, axis=2)
    yy, xx = np.meshgrid(
        np.linspace(-1.0, 1.0, h, dtype=np.float32),
        np.linspace(-1.0, 1.0, w, dtype=np.float32),
        indexing="ij",
    )
    luma = np.sum(input_rgb * np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32), axis=2)
    norm = rgb_norm(input_rgb)
    extras = np.stack([xx, yy, luma, norm, np.ones_like(luma)], axis=2)
    if not interactions:
        return np.concatenate([local, extras], axis=2).astype(np.float32)
    center = input_rgb
    nonlinear = [
        local * yy[:, :, None],
        local * luma[:, :, None],
        np.square(center),
        (center[:, :, 0:1] - center[:, :, 1:2]),
        (center[:, :, 0:1] - center[:, :, 2:3]),
    ]
    return np.concatenate([local, *nonlinear, extras], axis=2).astype(np.float32)


def solve_ridge(features: np.ndarray, target: np.ndarray, indices: np.ndarray, ridge: float) -> np.ndarray:
    x = features.reshape(-1, features.shape[2])[indices].astype(np.float64)
    y = target.reshape(-1, 3)[indices].astype(np.float64)
    xtx = x.T @ x
    penalty = np.eye(xtx.shape[0], dtype=np.float64) * max(float(ridge), 0.0)
    penalty[-1, -1] = 0.0
    xty = x.T @ y
    return np.linalg.solve(xtx + penalty, xty)


def apply_linear(features: np.ndarray, weights: np.ndarray, chunk: int = 250000) -> np.ndarray:
    flat = features.reshape(-1, features.shape[2]).astype(np.float64)
    out = np.zeros((flat.shape[0], 3), dtype=np.float32)
    for start in range(0, flat.shape[0], chunk):
        stop = min(start + chunk, flat.shape[0])
        out[start:stop] = np.clip(flat[start:stop] @ weights, 0.0, 1.0).astype(np.float32)
    return out.reshape(features.shape[0], features.shape[1], 3)


def split_indices(pixel_count: int, train_samples: int, test_samples: int, seed: int) -> tuple[np.ndarray, np.ndarray]:
    rng = np.random.default_rng(seed)
    perm = rng.permutation(pixel_count)
    train_count = min(max(1, int(train_samples)), max(1, pixel_count - 1))
    test_count = min(max(1, int(test_samples)), max(1, pixel_count - train_count))
    train = perm[:train_count]
    test = perm[train_count:train_count + test_count]
    if test.size == 0:
        test = perm[-1:]
    return train, test


def error_rgb(predicted: np.ndarray, target: np.ndarray) -> np.ndarray:
    return predicted - target


def metrics_for(predicted: np.ndarray, target: np.ndarray, heldout: np.ndarray, body_mask: np.ndarray, background_mask: np.ndarray) -> dict[str, Any]:
    err = error_rgb(predicted, target)
    abs_err = np.abs(err)
    sq_err = np.square(err)
    flat_abs = abs_err.reshape(-1, 3)
    flat_sq = sq_err.reshape(-1, 3)
    held_abs = flat_abs[heldout]
    held_sq = flat_sq[heldout]
    per_pixel_l2 = np.sqrt(np.sum(sq_err, axis=2))
    return {
        "mae": float(np.mean(abs_err)),
        "rmse": float(np.sqrt(np.mean(sq_err))),
        "heldOutPixelMetrics": {
            "mae": float(np.mean(held_abs)),
            "rmse": float(np.sqrt(np.mean(held_sq))),
            "pixelCount": int(heldout.size),
        },
        "bodyMetrics": masked_metrics(per_pixel_l2, body_mask),
        "backgroundMetrics": masked_metrics(per_pixel_l2, background_mask),
    }


def masked_metrics(values: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    count = int(np.count_nonzero(mask))
    if count <= 0:
        return {"pixelCount": 0, "meanL2": None, "p95L2": None}
    masked = values[mask]
    return {
        "pixelCount": count,
        "meanL2": float(np.mean(masked)),
        "p95L2": float(np.percentile(masked, 95)),
    }


def high_frequency_energy(rgb: np.ndarray) -> float:
    center = rgb[1:-1, 1:-1, :]
    neighbor_mean = (
        rgb[:-2, 1:-1, :] +
        rgb[2:, 1:-1, :] +
        rgb[1:-1, :-2, :] +
        rgb[1:-1, 2:, :]
    ) * 0.25
    return float(np.mean(np.abs(center - neighbor_mean)))


def grid_ghost_metrics(predicted: np.ndarray, target: np.ndarray, raw: np.ndarray, color: np.ndarray) -> dict[str, Any]:
    decoder_error_hf = high_frequency_energy(np.abs(predicted - target))
    color_error_hf = high_frequency_energy(np.abs(color - target))
    raw_error_hf = high_frequency_energy(np.abs(raw - target))
    return {
        "identity": "gridGhostMetrics",
        "targetHighFrequencyEnergy": high_frequency_energy(target),
        "rawCarrierHighFrequencyEnergy": high_frequency_energy(raw),
        "decoderHighFrequencyEnergy": high_frequency_energy(predicted),
        "rawErrorHighFrequencyEnergy": raw_error_hf,
        "globalColorErrorHighFrequencyEnergy": color_error_hf,
        "decoderErrorHighFrequencyEnergy": decoder_error_hf,
        "decoderVsGlobalErrorHighFrequencyRatio": float(decoder_error_hf / max(color_error_hf, 1.0e-8)),
        "decoderVsRawErrorHighFrequencyRatio": float(decoder_error_hf / max(raw_error_hf, 1.0e-8)),
    }


def improvement_summary(metrics: dict[str, Any]) -> dict[str, Any]:
    raw = metrics[RAW_BASELINE_ROLE]
    color = metrics[GLOBAL_BASELINE_ROLE]
    local = metrics[LOCAL_DECODER_ROLE]
    return {
        "decoderRmseReductionVsRaw": rate(raw["rmse"] - local["rmse"], raw["rmse"]),
        "decoderRmseReductionVsGlobalColor": rate(color["rmse"] - local["rmse"], color["rmse"]),
        "decoderHeldOutRmseReductionVsRaw": rate(
            raw["heldOutPixelMetrics"]["rmse"] - local["heldOutPixelMetrics"]["rmse"],
            raw["heldOutPixelMetrics"]["rmse"],
        ),
        "decoderHeldOutRmseReductionVsGlobalColor": rate(
            color["heldOutPixelMetrics"]["rmse"] - local["heldOutPixelMetrics"]["rmse"],
            color["heldOutPixelMetrics"]["rmse"],
        ),
    }


def rate(numerator: float, denominator: float) -> float | None:
    if abs(denominator) <= 1.0e-12:
        return None
    return float(numerator / denominator)


def error_heat(predicted: np.ndarray, target: np.ndarray) -> np.ndarray:
    l2 = np.sqrt(np.sum(np.square(predicted - target), axis=2))
    scale = np.percentile(l2, 98) if np.any(l2 > 0) else 1.0
    heat = np.clip(l2 / max(float(scale), 1.0e-6), 0.0, 1.0)
    rgb = np.zeros((*heat.shape, 3), dtype=np.float32)
    rgb[:, :, 0] = heat
    rgb[:, :, 1] = heat * 0.25
    rgb[:, :, 2] = 1.0 - heat
    return rgb


def contact_sheet(frames: list[tuple[str, str, np.ndarray]], out_path: Path) -> dict[str, Any]:
    frame_h, frame_w, _ = frames[0][2].shape
    label_h = 24
    sheet = np.zeros((frame_h + label_h, frame_w * len(frames), 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    labels = []
    for index, (role, label_text, rgba) in enumerate(frames):
        x = index * frame_w
        sheet[label_h:label_h + frame_h, x:x + frame_w, :] = rgba
        label = H.draw_label(sheet, label_text, x + 8, 6, 2)
        label["role"] = role
        label["displayLabel"] = label_text
        labels.append(label)
    H.write_png_rgba(out_path, sheet)
    return {
        "path": str(out_path),
        "sha256": H.sha256_file(out_path),
        "columnOrder": [role for role, _, _ in frames],
        "visibleRasterLabels": {
            "identity": "visible-raster-role-labels-v0",
            "columnLabels": labels,
        },
    }


def write_output(path: Path, rgb: np.ndarray, role: str, display_label: str) -> dict[str, Any]:
    rgba = H.rgba_from_rgb_float(rgb)
    H.write_png_rgba(path, rgba)
    return {
        "role": role,
        "displayLabel": display_label,
        "path": str(path),
        "sha256": H.sha256_file(path),
    }


def write_failure(out_path: Path | None, out_dir: Path | None, phase: str, message: str, evidence: dict[str, Any]) -> None:
    target = out_path or ((out_dir / "manifest.json") if out_dir is not None else None)
    if target is None:
        return
    write_json(target, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "failurePhase": phase,
        "error": message,
        "evidence": evidence,
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_path = Path(args.out) if args.out else out_dir / "manifest.json"
    phase = "start"
    try:
        phase = "manifest-read"
        dataset_manifest_path = Path(args.dataset_manifest)
        dataset = dataset_payload(dataset_manifest_path)
        input_path = capture_path(dataset, LOW_CARRIER_INPUT_ROLE)
        target_path = capture_path(dataset, RGB_TARGET_ROLE)

        phase = "image-read"
        input_rgb, input_rgba = rgb_float(input_path)
        target_rgb, target_rgba = rgb_float(target_path)
        raw_resized = resize_nearest(input_rgb, target_rgb.shape[:2])

        phase = "training"
        h, w, _ = target_rgb.shape
        pixel_count = h * w
        train_indices, test_indices = split_indices(pixel_count, args.train_samples, args.test_samples, args.seed)
        raw_features = feature_grid(raw_resized, 0, interactions=False)
        color_weights = solve_ridge(raw_features, target_rgb, train_indices, args.ridge)
        global_color = apply_linear(raw_features, color_weights)

        local_features = feature_grid(raw_resized, args.neighborhood_radius, interactions=True)
        local_weights = solve_ridge(local_features, target_rgb, train_indices, args.ridge)
        local_decoder = apply_linear(local_features, local_weights)

        phase = "metrics"
        target_norm = rgb_norm(target_rgb)
        body_mask = target_norm >= float(args.body_threshold)
        background_mask = target_norm <= float(args.background_threshold)
        metrics = {
            RAW_BASELINE_ROLE: metrics_for(raw_resized, target_rgb, test_indices, body_mask, background_mask),
            GLOBAL_BASELINE_ROLE: metrics_for(global_color, target_rgb, test_indices, body_mask, background_mask),
            LOCAL_DECODER_ROLE: metrics_for(local_decoder, target_rgb, test_indices, body_mask, background_mask),
        }
        metrics["improvementSummary"] = improvement_summary(metrics)
        metrics["gridGhostMetrics"] = grid_ghost_metrics(local_decoder, target_rgb, raw_resized, global_color)

        phase = "image-write"
        out_dir.mkdir(parents=True, exist_ok=True)
        outputs = {
            "carrierInput": write_output(out_dir / "carrier-input-resized.png", raw_resized, "carrierInput", "CARRIER"),
            "rgbTarget": write_output(out_dir / "rgb-target.png", target_rgb, "rgbTarget", "TARGET"),
            RAW_BASELINE_ROLE: write_output(out_dir / "raw-carrier-resize-baseline.png", raw_resized, RAW_BASELINE_ROLE, "RAW"),
            GLOBAL_BASELINE_ROLE: write_output(out_dir / "global-color-linear-baseline.png", global_color, GLOBAL_BASELINE_ROLE, "COLOR"),
            LOCAL_DECODER_ROLE: write_output(out_dir / "local-neighborhood-rgb-decoder.png", local_decoder, LOCAL_DECODER_ROLE, "LOCAL"),
            "decoderErrorHeat": write_output(out_dir / "decoder-error-heat.png", error_heat(local_decoder, target_rgb), "decoderErrorHeat", "ERR"),
        }
        sheet = contact_sheet([
            ("carrierInput", "CARRIER", H.rgba_from_rgb_float(raw_resized)),
            ("rgbTarget", "TARGET", target_rgba),
            (GLOBAL_BASELINE_ROLE, "COLOR", H.rgba_from_rgb_float(global_color)),
            (LOCAL_DECODER_ROLE, "LOCAL", H.rgba_from_rgb_float(local_decoder)),
            ("decoderErrorHeat", "ERR", H.rgba_from_rgb_float(error_heat(local_decoder, target_rgb))),
        ], out_dir / "pyro-rgb-reconstruction-decoder-contact.png")
        outputs["contactSheet"] = sheet

        phase = "manifest-write"
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "completed",
            "createdAt": utc_now(),
            "datasetManifest": str(dataset_manifest_path),
            "pairAuthority": PAIR_AUTHORITY,
            "limitation": LIMITATION,
            "featureIdentity": FEATURE_IDENTITY,
            "roles": {
                "input": LOW_CARRIER_INPUT_ROLE,
                "target": RGB_TARGET_ROLE,
                "rawBaseline": RAW_BASELINE_ROLE,
                "globalColorBaseline": GLOBAL_BASELINE_ROLE,
                "localDecoder": LOCAL_DECODER_ROLE,
            },
            "model": {
                "identity": IDENTITY,
                "neighborhoodRadius": int(args.neighborhood_radius),
                "ridge": float(args.ridge),
                "featureCount": int(local_features.shape[2]),
                "globalColorFeatureCount": int(raw_features.shape[2]),
                "trainSamplesRequested": int(args.train_samples),
                "trainSamplesEffective": int(train_indices.size),
                "testSamplesRequested": int(args.test_samples),
                "testSamplesEffective": int(test_indices.size),
                "seed": int(args.seed),
            },
            "sourceRouteIdentity": {
                "datasetRoutes": dataset.get("routes", {}),
                LOW_CARRIER_INPUT_ROLE: capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("requestedRouteIdentity"),
                RGB_TARGET_ROLE: capture_effective(dataset, RGB_TARGET_ROLE).get("requestedRouteIdentity"),
            },
            "effectiveWitnessIdentity": {
                LOW_CARRIER_INPUT_ROLE: {
                    "effectiveRoute": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("effectiveRoute"),
                    "prototypeIdentity": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("prototypeIdentity"),
                    "backend": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("backend"),
                    "timing": capture_effective(dataset, LOW_CARRIER_INPUT_ROLE).get("timing"),
                },
                RGB_TARGET_ROLE: {
                    "effectiveRoute": capture_effective(dataset, RGB_TARGET_ROLE).get("effectiveRoute"),
                    "prototypeIdentity": capture_effective(dataset, RGB_TARGET_ROLE).get("prototypeIdentity"),
                    "backend": capture_effective(dataset, RGB_TARGET_ROLE).get("backend"),
                    "timing": capture_effective(dataset, RGB_TARGET_ROLE).get("timing"),
                },
            },
            "sourceChecksums": {
                LOW_CARRIER_INPUT_ROLE: H.sha256_file(input_path),
                RGB_TARGET_ROLE: H.sha256_file(target_path),
                "datasetManifest": H.sha256_file(dataset_manifest_path),
            },
            "imageShape": {
                "inputOriginal": list(input_rgb.shape),
                "target": list(target_rgb.shape),
                "modelInput": list(raw_resized.shape),
            },
            "metrics": metrics,
            "outputs": outputs,
            "failurePhase": None,
        }
        write_json(out_path, manifest)
        print(json.dumps(manifest, indent=2))
        return 0
    except DecoderFailure as error:
        write_failure(out_path, out_dir, error.phase, str(error), error.evidence)
        print(json.dumps({
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": error.phase,
            "error": str(error),
            "evidence": error.evidence,
        }, indent=2), file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001 - preserve unexpected failure phase in a manifest.
        write_failure(out_path, out_dir, phase, str(error), {"exceptionType": type(error).__name__})
        print(json.dumps({
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failed",
            "failurePhase": phase,
            "error": str(error),
            "evidence": {"exceptionType": type(error).__name__},
        }, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
