#!/usr/bin/env python3
"""Apply soft protected RGB alpha cleanup across an existing temporal strip."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.render-rgb-soft-protected-alpha-temporal-strip.v0"
IDENTITY = "render-space-soft-protected-alpha-temporal-strip-v0"
SOURCE_STRIP_IDENTITY = "full-grid-field-residual-temporal-dynamics-strip-v0"
LIMITATION = (
    "source strip initializes each role from a complete field buffer and advances simulator dynamics; "
    "this is cleanup stability evidence, not held-out per-frame model prediction"
)


class TemporalCleanupFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_module(filename: str, module_name: str) -> Any:
    path = Path(__file__).with_name(filename)
    if not path.exists():
        raise TemporalCleanupFailure("helper-load", "Required helper script is missing.", {"path": str(path)})
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise TemporalCleanupFailure("helper-load", "Could not load helper module.", {"path": str(path)})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


A = load_module("volume-render-rgb-alpha-cleanup.py", "kaminos_rgb_alpha_cleanup")
S = load_module("volume-render-rgb-soft-protected-alpha.py", "kaminos_rgb_soft_protected_alpha")


@dataclass(frozen=True)
class Variant:
    name: str
    body_edit_alpha: float


class SoftArgs:
    def __init__(
        self,
        *,
        body_norm_threshold: float,
        column_dilation_radius: int,
        body_edit_alpha: float,
        column_edit_alpha: float,
        outside_edit_alpha: float,
        direction_cosine_floor: float,
        direction_fallback_alpha: float,
    ):
        self.body_norm_threshold = body_norm_threshold
        self.column_dilation_radius = column_dilation_radius
        self.body_edit_alpha = body_edit_alpha
        self.column_edit_alpha = column_edit_alpha
        self.outside_edit_alpha = outside_edit_alpha
        self.direction_cosine_floor = direction_cosine_floor
        self.direction_fallback_alpha = direction_fallback_alpha


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strip-manifest", required=True, help="Manifest containing temporalStrip.contactSheet and row/column metadata.")
    parser.add_argument("--truth-role", default="truthHigh", help="Truth row role in the source strip.")
    parser.add_argument("--low-role", default="lowUpsampled", help="Low/baseline row role in the source strip.")
    parser.add_argument("--predicted-role", default="predictedHigh", help="Predicted row role in the source strip.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--body-edit-alphas", default="0.55,0.75", help="Comma-separated body edit alphas; default emits body055 and body075.")
    parser.add_argument("--body-norm-threshold", type=float, default=0.10, help="Low/pred RGB norm threshold for protected body.")
    parser.add_argument("--column-dilation-radius", type=int, default=4, help="Pixel radius used to dilate the protected body into a diagnostic column.")
    parser.add_argument("--column-edit-alpha", type=float, default=0.85, help="Cleanup blend amount in the diagnostic column outside protected body.")
    parser.add_argument("--outside-edit-alpha", type=float, default=1.0, help="Cleanup blend amount outside the diagnostic column.")
    parser.add_argument("--direction-cosine-floor", type=float, default=0.85, help="Reduce body edit strength where cleanup direction diverges from predicted RGB.")
    parser.add_argument("--direction-fallback-alpha", type=float, default=0.20, help="Body edit alpha used when cleanup/predicted cosine is below the floor.")
    parser.add_argument("--outside-norm-threshold", type=float, default=0.047, help="RGB norm threshold for weak outside haze diagnostics.")
    parser.add_argument("--improvement-margin", type=float, default=0.025, help="L2 RGB error margin for useful/worse classification.")
    parser.add_argument("--residual-threshold", type=float, default=0.035, help="Minimum predicted-vs-low residual magnitude to classify lift/collapse.")
    parser.add_argument("--retention-min", type=float, default=0.35, help="Minimum cleaned residual retention on useful-lift pixels.")
    parser.add_argument("--neighborhood-radius", type=int, default=1, help="Local RGB neighborhood radius for per-frame alpha cleanup.")
    parser.add_argument("--train-samples", type=int, default=30000, help="Random pixels used to fit each frame's alpha model.")
    parser.add_argument("--ridge", type=float, default=1.0e-3, help="Ridge regularization for each frame's alpha model.")
    parser.add_argument("--seed", type=int, default=7307, help="Deterministic sample seed.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def write_failure(out_path: Path, phase: str, message: str, evidence: dict[str, Any]) -> None:
    write_json(out_path, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "createdAt": utc_now(),
        "failurePhase": phase,
        "error": message,
        "lastTrustworthyEvidence": evidence,
    })


def variant_name(alpha: float) -> str:
    return f"body{int(round(float(alpha) * 100.0)):03d}"


def parse_variants(raw: str) -> list[Variant]:
    variants = []
    for item in raw.split(","):
        text = item.strip()
        if not text:
            continue
        alpha = float(text)
        if alpha < 0.0 or alpha > 1.0:
            raise TemporalCleanupFailure("args", "Body edit alpha outside [0, 1].", {"value": alpha})
        variants.append(Variant(variant_name(alpha), alpha))
    names = {variant.name for variant in variants}
    if "body055" not in names or "body075" not in names:
        raise TemporalCleanupFailure("args", "Temporal comparison must include body055 and body075 setting identities.", {
            "requestedVariants": sorted(names),
        })
    return variants


def strip_payload(manifest: dict[str, Any]) -> dict[str, Any]:
    temporal_strip = manifest.get("temporalStrip")
    if not isinstance(temporal_strip, dict):
        raise TemporalCleanupFailure("manifest-read", "Manifest missing temporalStrip object.", {})
    if temporal_strip.get("identity") != SOURCE_STRIP_IDENTITY:
        raise TemporalCleanupFailure("manifest-read", "Temporal strip identity mismatch.", {
            "expected": SOURCE_STRIP_IDENTITY,
            "actual": temporal_strip.get("identity"),
        })
    return temporal_strip


def role_index(row_order: list[str], role: str) -> int:
    if role not in row_order:
        raise TemporalCleanupFailure("manifest-read", "Temporal strip missing required row role.", {
            "role": role,
            "rowOrder": row_order,
        })
    return row_order.index(role)


def extract_frames(strip: dict[str, Any], roles: list[str]) -> tuple[dict[str, list[np.ndarray]], dict[str, Any]]:
    contact = strip.get("contactSheet")
    if not isinstance(contact, dict) or not contact.get("path"):
        raise TemporalCleanupFailure("manifest-read", "Temporal strip missing contactSheet.path.", {})
    sheet_path = Path(contact["path"])
    sheet = A.read_png_rgba(sheet_path)
    row_order = list(strip.get("rowOrder") or [])
    column_order = list(strip.get("columnOrder") or [])
    frame_count = int(strip.get("frameCount") or len(column_order))
    if not row_order or not column_order or frame_count <= 0:
        raise TemporalCleanupFailure("manifest-read", "Temporal strip missing row/column geometry.", {
            "rowOrder": row_order,
            "columnOrder": column_order,
            "frameCount": frame_count,
        })
    visible = strip.get("visibleRasterLabels") or {}
    height, width, _ = sheet.shape
    label_width = int(visible.get("labelWidth") or 0)
    label_height = int(visible.get("labelHeight") or 0)
    geometryMode = "visible-label-dimensions"
    if label_width <= 0 or label_height <= 0:
        if width % frame_count != 0 or height % len(row_order) != 0:
            raise TemporalCleanupFailure("manifest-read", "Temporal strip lacks explicit visible label dimensions and cannot be evenly divided into cells.", {
                "visibleRasterLabels": visible,
                "sheetShape": list(sheet.shape),
                "frameCount": frame_count,
                "rowCount": len(row_order),
            })
        label_width = 0
        label_height = 0
        geometryMode = "unlabeled-even-grid"
    frame_width = (width - label_width) // frame_count
    frame_height = (height - label_height) // len(row_order)
    if frame_width <= 0 or frame_height <= 0:
        raise TemporalCleanupFailure("manifest-read", "Derived frame cell geometry is invalid.", {
            "sheetShape": list(sheet.shape),
            "labelWidth": label_width,
            "labelHeight": label_height,
            "frameCount": frame_count,
            "rowCount": len(row_order),
        })
    frames: dict[str, list[np.ndarray]] = {}
    for role in roles:
        y = label_height + role_index(row_order, role) * frame_height
        role_frames = []
        for frame_index in range(frame_count):
            x = label_width + frame_index * frame_width
            role_frames.append(sheet[y:y + frame_height, x:x + frame_width, :].copy())
        frames[role] = role_frames
    geometry = {
        "sourceContactSheet": str(sheet_path),
        "sourceContactSheetSha256": A.sha256_file(sheet_path),
        "rowOrder": row_order,
        "columnOrder": column_order,
        "frameCount": frame_count,
        "labelWidth": label_width,
        "labelHeight": label_height,
        "geometryMode": geometryMode,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
    }
    return frames, geometry


def rgb_float(rgba: np.ndarray) -> np.ndarray:
    return rgba[:, :, :3].astype(np.float32) / 255.0


def l2_rgb(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum(np.square(a - b), axis=2))


def rgb_norm(rgb: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum(np.square(rgb), axis=2))


def masked_sum(values: np.ndarray, mask: np.ndarray) -> float:
    if not np.any(mask):
        return 0.0
    return float(np.sum(values[mask]))


def masked_mean(values: np.ndarray, mask: np.ndarray) -> float | None:
    if not np.any(mask):
        return None
    return float(np.mean(values[mask]))


def safe_rate(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return float(numerator / denominator)


def train_alpha_cleanup(
    truth: np.ndarray,
    low: np.ndarray,
    pred: np.ndarray,
    *,
    seed: int,
    neighborhood_radius: int,
    train_samples: int,
    ridge: float,
) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    height, width, _ = truth.shape
    pixel_count = height * width
    oracle = A.oracle_alpha(low, pred, truth)
    rng = np.random.default_rng(seed)
    all_indexes = np.arange(pixel_count, dtype=np.int64)
    train_count = min(pixel_count, max(1, int(train_samples)))
    train_indexes = rng.choice(all_indexes, size=train_count, replace=False)
    radius = max(0, int(neighborhood_radius))
    features = A.feature_matrix(low, pred, train_indexes, radius)
    weights = A.fit_ridge_alpha(features, oracle.reshape(-1)[train_indexes], ridge)
    predicted_flat = np.zeros(pixel_count, dtype=np.float32)
    chunk = 65536
    for start in range(0, pixel_count, chunk):
        end = min(pixel_count, start + chunk)
        indexes = all_indexes[start:end]
        predicted_flat[start:end] = A.predict_alpha(A.feature_matrix(low, pred, indexes, radius), weights)
    predicted_alpha = predicted_flat.reshape(height, width)
    cleanup = low + predicted_alpha[:, :, None] * (pred - low)
    return cleanup, predicted_alpha, {
        "oracleAlphaMean": float(np.mean(oracle)),
        "predictedAlphaMean": float(np.mean(predicted_alpha)),
        "predictedAlphaP95": float(np.quantile(predicted_alpha, 0.95)),
        "trainSamples": int(train_count),
        "featureCount": int(features.shape[1]),
        "weightCount": int(weights.shape[0]),
    }


def image_metrics(candidate: np.ndarray, truth: np.ndarray) -> dict[str, Any]:
    error = candidate - truth
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(float(np.mean(np.square(error))))),
    }


def frame_metrics(
    truth: np.ndarray,
    low: np.ndarray,
    pred: np.ndarray,
    cleanup: np.ndarray,
    soft: np.ndarray,
    edit_alpha: np.ndarray,
    protected_body: np.ndarray,
    diagnostic_column: np.ndarray,
    args: argparse.Namespace,
) -> dict[str, Any]:
    truth_norm = rgb_norm(truth)
    low_norm = rgb_norm(low)
    pred_norm = rgb_norm(pred)
    soft_norm = rgb_norm(soft)
    low_err = l2_rgb(low, truth)
    pred_err = l2_rgb(pred, truth)
    soft_err = l2_rgb(soft, truth)
    pred_delta = l2_rgb(pred, low)
    truth_body = truth_norm > float(args.body_norm_threshold)
    predicted_body = pred_norm > float(args.body_norm_threshold)
    outside_column = ~diagnostic_column
    outside_column_weak = outside_column & (pred_norm > float(args.outside_norm_threshold))
    pred_outside_mass = masked_sum(pred_norm, outside_column_weak)
    soft_outside_mass = masked_sum(soft_norm, outside_column_weak)
    useful_lift = ((low_err - pred_err) > float(args.improvement_margin)) & (pred_delta > float(args.residual_threshold))
    false_pollution = ((pred_err - low_err) > float(args.improvement_margin)) & (pred_delta > float(args.residual_threshold))
    retained_lift = useful_lift & ((l2_rgb(soft, low) / np.maximum(pred_delta, 1.0e-6)) >= float(args.retention_min))
    low_collapse = useful_lift & ((l2_rgb(soft, low) / np.maximum(pred_delta, 1.0e-6)) < float(args.retention_min))
    removed_pollution = false_pollution & ((pred_err - soft_err) > float(args.improvement_margin))
    cosine = np.sum(pred * soft, axis=2) / np.maximum(pred_norm * soft_norm, 1.0e-6)
    return {
        "renderComparisonMetrics": {
            "low": image_metrics(low, truth),
            "predicted": image_metrics(pred, truth),
            "cleanup": image_metrics(cleanup, truth),
            "softProtectedAlpha": image_metrics(soft, truth),
        },
        "outsideColumnWeakSupportPixelCount": int(np.count_nonzero(outside_column_weak)),
        "outsideColumnPredictedNormMass": pred_outside_mass,
        "outsideColumnSoftNormMass": soft_outside_mass,
        "outsideColumnWeakSupportReductionRate": safe_rate(pred_outside_mass - soft_outside_mass, pred_outside_mass),
        "truthBodyPixelCount": int(np.count_nonzero(truth_body)),
        "predictedBodyPixelCount": int(np.count_nonzero(predicted_body)),
        "predictedBodySoftVsPredictedCosineMean": masked_mean(cosine, predicted_body),
        "predictedBodySoftNormRetentionRate": safe_rate(masked_sum(soft_norm, predicted_body), masked_sum(pred_norm, predicted_body)),
        "protectedBodyPixelCount": int(np.count_nonzero(protected_body)),
        "diagnosticColumnPixelCount": int(np.count_nonzero(diagnostic_column)),
        "meanEditAlpha": float(np.mean(edit_alpha)),
        "bodyMeanEditAlpha": masked_mean(edit_alpha, protected_body),
        "outsideColumnMeanEditAlpha": masked_mean(edit_alpha, outside_column),
        "usefulLiftPixelCount": int(np.count_nonzero(useful_lift)),
        "retainedLiftPixelRateWithinUsefulLift": safe_rate(int(np.count_nonzero(retained_lift)), int(np.count_nonzero(useful_lift))),
        "lowCollapsePixelRateWithinUsefulLift": safe_rate(int(np.count_nonzero(low_collapse)), int(np.count_nonzero(useful_lift))),
        "falsePollutionPixelCount": int(np.count_nonzero(false_pollution)),
        "removedPollutionPixelRateWithinFalsePollution": safe_rate(int(np.count_nonzero(removed_pollution)), int(np.count_nonzero(false_pollution))),
    }


def summarize_variant(per_frame: list[dict[str, Any]], alpha_maps: list[np.ndarray]) -> dict[str, Any]:
    def values(path: list[str]) -> list[float]:
        out = []
        for item in per_frame:
            current: Any = item
            for key in path:
                current = current.get(key) if isinstance(current, dict) else None
            if isinstance(current, (int, float)):
                out.append(float(current))
        return out

    reduction = values(["outsideColumnWeakSupportReductionRate"])
    cosine = values(["predictedBodySoftVsPredictedCosineMean"])
    retention = values(["predictedBodySoftNormRetentionRate"])
    collapse = values(["lowCollapsePixelRateWithinUsefulLift"])
    rmse = values(["renderComparisonMetrics", "softProtectedAlpha", "rmse"])
    alpha_deltas = []
    for left, right in zip(alpha_maps, alpha_maps[1:]):
        alpha_deltas.append(float(np.mean(np.abs(right - left))))
    worst_index = max(range(len(per_frame)), key=lambda i: (
        per_frame[i].get("lowCollapsePixelRateWithinUsefulLift") or 0.0,
        per_frame[i]["renderComparisonMetrics"]["softProtectedAlpha"]["rmse"],
    ))
    return {
        "frameCount": len(per_frame),
        "outsideColumnWeakSupportReductionRateMean": float(np.mean(reduction)) if reduction else None,
        "outsideColumnWeakSupportReductionRateMin": float(np.min(reduction)) if reduction else None,
        "predictedBodySoftVsPredictedCosineMean": float(np.mean(cosine)) if cosine else None,
        "predictedBodySoftVsPredictedCosineMin": float(np.min(cosine)) if cosine else None,
        "predictedBodySoftNormRetentionRateMean": float(np.mean(retention)) if retention else None,
        "predictedBodySoftNormRetentionRateMin": float(np.min(retention)) if retention else None,
        "lowCollapsePixelRateWithinUsefulLiftMean": float(np.mean(collapse)) if collapse else None,
        "lowCollapsePixelRateWithinUsefulLiftMax": float(np.max(collapse)) if collapse else None,
        "softProtectedRmseMean": float(np.mean(rmse)) if rmse else None,
        "softProtectedRmseMax": float(np.max(rmse)) if rmse else None,
        "alphaDeltaMean": float(np.mean(alpha_deltas)) if alpha_deltas else None,
        "alphaDeltaMax": float(np.max(alpha_deltas)) if alpha_deltas else None,
        "worstFrame": {
            "frameIndex": int(per_frame[worst_index]["frameIndex"]),
            "reason": "max low-collapse rate, then max softProtectedAlpha RMSE",
            "metrics": per_frame[worst_index],
        },
    }


def build_contact_sheet(
    rows: list[tuple[str, str, list[np.ndarray]]],
    out_path: Path,
) -> dict[str, Any]:
    frame_h, frame_w, _ = rows[0][2][0].shape
    frame_count = len(rows[0][2])
    label_w = 180
    label_h = 24
    sheet = np.zeros((label_h + frame_h * len(rows), label_w + frame_w * frame_count, 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    row_labels = []
    column_labels = []
    for frame_index in range(frame_count):
        x = label_w + frame_index * frame_w
        column_labels.append(A.draw_label(sheet, f"frame-{frame_index}", x + 8, 6, 2))
    for row_index, (role, label, frames) in enumerate(rows):
        y = label_h + row_index * frame_h
        row_labels.append(A.draw_label(sheet, label, 8, y + 8, 2))
        for frame_index, frame in enumerate(frames):
            x = label_w + frame_index * frame_w
            sheet[y:y + frame_h, x:x + frame_w, :] = frame
    A.write_png_rgba(out_path, sheet)
    return {
        "path": str(out_path),
        "sha256": A.sha256_file(out_path),
        "rowOrder": [role for role, _, _ in rows],
        "columnOrder": [f"frame-{i}" for i in range(frame_count)],
        "visibleRasterLabels": {
            "identity": "visible-raster-row-column-labels-v0",
            "rowLabels": row_labels,
            "columnLabels": column_labels,
            "labelWidth": label_w,
            "labelHeight": label_h,
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_path = Path(args.out) if args.out else out_dir / "manifest.json"
    phase = "start"
    evidence: dict[str, Any] = {}
    try:
        variants = parse_variants(args.body_edit_alphas)
        phase = "manifest-read"
        strip_manifest_path = Path(args.strip_manifest)
        strip_manifest = A.read_json(strip_manifest_path)
        strip = strip_payload(strip_manifest)
        frames, geometry = extract_frames(strip, [args.truth_role, args.low_role, args.predicted_role])
        frame_count = geometry["frameCount"]
        evidence = {
            "stripManifest": str(strip_manifest_path),
            "sourceStripIdentity": strip.get("identity"),
            "frameCount": frame_count,
        }

        phase = "compose"
        out_dir.mkdir(parents=True, exist_ok=True)
        per_variant_frames: dict[str, list[np.ndarray]] = {variant.name: [] for variant in variants}
        per_variant_alpha_maps: dict[str, list[np.ndarray]] = {variant.name: [] for variant in variants}
        per_variant_metrics: dict[str, list[dict[str, Any]]] = {variant.name: [] for variant in variants}
        cleanup_frames: list[np.ndarray] = []
        predicted_alpha_frames: list[np.ndarray] = []

        for frame_index in range(frame_count):
            truth_rgba = frames[args.truth_role][frame_index]
            low_rgba = frames[args.low_role][frame_index]
            pred_rgba = frames[args.predicted_role][frame_index]
            truth = rgb_float(truth_rgba)
            low = rgb_float(low_rgba)
            pred = rgb_float(pred_rgba)
            cleanup, predicted_alpha, alpha_metrics = train_alpha_cleanup(
                truth,
                low,
                pred,
                seed=int(args.seed) + frame_index,
                neighborhood_radius=int(args.neighborhood_radius),
                train_samples=int(args.train_samples),
                ridge=float(args.ridge),
            )
            cleanup_frames.append(A.rgba_from_rgb_float(cleanup))
            predicted_alpha_frames.append(A.rgba_from_gray(predicted_alpha))
            low_norm = rgb_norm(low)
            pred_norm = rgb_norm(pred)
            protected_body = (low_norm > float(args.body_norm_threshold)) | (pred_norm > float(args.body_norm_threshold))
            diagnostic_column = S.dilate_mask(protected_body, int(args.column_dilation_radius))
            for variant in variants:
                soft_args = SoftArgs(
                    body_norm_threshold=float(args.body_norm_threshold),
                    column_dilation_radius=int(args.column_dilation_radius),
                    body_edit_alpha=variant.body_edit_alpha,
                    column_edit_alpha=float(args.column_edit_alpha),
                    outside_edit_alpha=float(args.outside_edit_alpha),
                    direction_cosine_floor=float(args.direction_cosine_floor),
                    direction_fallback_alpha=float(args.direction_fallback_alpha),
                )
                soft, edit_alpha, _cosine = S.compose_soft_alpha(pred, cleanup, protected_body, diagnostic_column, soft_args)
                rgba = A.rgba_from_rgb_float(soft)
                per_variant_frames[variant.name].append(rgba)
                per_variant_alpha_maps[variant.name].append(edit_alpha)
                frame_metric = frame_metrics(
                    truth,
                    low,
                    pred,
                    cleanup,
                    soft,
                    edit_alpha,
                    protected_body,
                    diagnostic_column,
                    args,
                )
                frame_metric["frameIndex"] = frame_index
                frame_metric["alphaCleanupMetrics"] = alpha_metrics
                per_variant_metrics[variant.name].append(frame_metric)
                A.write_png_rgba(out_dir / f"{variant.name}-frame-{frame_index:03d}.png", rgba)
            A.write_png_rgba(out_dir / f"rgbAlphaCleaned-frame-{frame_index:03d}.png", cleanup_frames[-1])
            A.write_png_rgba(out_dir / f"predictedAlphaMap-frame-{frame_index:03d}.png", predicted_alpha_frames[-1])

        phase = "write-contact-sheet"
        rows: list[tuple[str, str, list[np.ndarray]]] = [
            (args.truth_role, "truth", frames[args.truth_role]),
            (args.low_role, "low", frames[args.low_role]),
            (args.predicted_role, "pred", frames[args.predicted_role]),
            ("rgbAlphaCleaned", "clean", cleanup_frames),
        ]
        for variant in variants:
            rows.append((variant.name, variant.name, per_variant_frames[variant.name]))
        rows.append(("predictedAlphaMap", "alpha", predicted_alpha_frames))
        contact_sheet = build_contact_sheet(rows, out_dir / "temporal-soft-protected-alpha-strip.png")

        phase = "manifest-write"
        temporal_stability = {
            variant.name: summarize_variant(per_variant_metrics[variant.name], per_variant_alpha_maps[variant.name])
            for variant in variants
        }
        outputs: dict[str, Any] = {
            "contactSheet": contact_sheet,
            "rgbAlphaCleanedFrames": [
                {"frameIndex": i, "path": str(out_dir / f"rgbAlphaCleaned-frame-{i:03d}.png"), "sha256": A.sha256_file(out_dir / f"rgbAlphaCleaned-frame-{i:03d}.png")}
                for i in range(frame_count)
            ],
            "predictedAlphaMapFrames": [
                {"frameIndex": i, "path": str(out_dir / f"predictedAlphaMap-frame-{i:03d}.png"), "sha256": A.sha256_file(out_dir / f"predictedAlphaMap-frame-{i:03d}.png")}
                for i in range(frame_count)
            ],
        }
        for variant in variants:
            outputs[f"{variant.name}Frames"] = [
                {"frameIndex": i, "path": str(out_dir / f"{variant.name}-frame-{i:03d}.png"), "sha256": A.sha256_file(out_dir / f"{variant.name}-frame-{i:03d}.png")}
                for i in range(frame_count)
            ]
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "createdAt": utc_now(),
            "failurePhase": None,
            "stripManifest": str(strip_manifest_path),
            "stripManifestSha256": A.sha256_file(strip_manifest_path),
            "sourceStripIdentity": strip.get("identity"),
            "sourceStripAuthority": strip.get("authority"),
            "sourceLimitation": strip.get("limitation"),
            "limitation": LIMITATION,
            "truthRole": args.truth_role,
            "lowRole": args.low_role,
            "predictedRole": args.predicted_role,
            "frameGeometry": geometry,
            "cleanupSettings": {
                "body055": next((variant.body_edit_alpha for variant in variants if variant.name == "body055"), None),
                "body075": next((variant.body_edit_alpha for variant in variants if variant.name == "body075"), None),
                "variants": [{"name": variant.name, "bodyEditAlpha": variant.body_edit_alpha} for variant in variants],
                "bodyNormThreshold": float(args.body_norm_threshold),
                "columnDilationRadius": int(args.column_dilation_radius),
                "columnEditAlpha": float(args.column_edit_alpha),
                "outsideEditAlpha": float(args.outside_edit_alpha),
                "directionCosineFloor": float(args.direction_cosine_floor),
                "directionFallbackAlpha": float(args.direction_fallback_alpha),
                "outsideNormThreshold": float(args.outside_norm_threshold),
            },
            "alphaModel": {
                "identity": A.MODEL_IDENTITY,
                "featureIdentity": A.FEATURE_IDENTITY,
                "neighborhoodRadius": int(args.neighborhood_radius),
                "trainSamples": int(args.train_samples),
                "ridge": float(args.ridge),
                "seed": int(args.seed),
            },
            "perFrameMetrics": per_variant_metrics,
            "temporalStabilityMetrics": temporal_stability,
            "outputs": outputs,
        }
        write_json(out_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(out_path),
            "contactSheet": contact_sheet["path"],
            "temporalStabilityMetrics": temporal_stability,
        }, indent=2))
        return 0
    except TemporalCleanupFailure as exc:
        write_failure(out_path, exc.phase, str(exc), exc.evidence or evidence)
        print(json.dumps({"ok": False, "failurePhase": exc.phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        write_failure(out_path, phase, str(exc), {"exceptionType": type(exc).__name__, **evidence})
        print(json.dumps({"ok": False, "failurePhase": phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
