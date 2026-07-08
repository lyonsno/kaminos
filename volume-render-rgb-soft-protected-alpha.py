#!/usr/bin/env python3
"""Blend RGB cleanup with damped edits inside a protected diagnostic body."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.render-rgb-soft-protected-alpha.v0"
IDENTITY = "render-space-soft-protected-alpha-v0"
MASK_IDENTITY = "soft-protected-alpha-from-low-pred-energy-v0"


class SoftAlphaFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_alpha_helpers() -> Any:
    helper_path = Path(__file__).with_name("volume-render-rgb-alpha-cleanup.py")
    if not helper_path.exists():
        raise SoftAlphaFailure("helper-load", "RGB alpha cleanup helper script is missing.", {"path": str(helper_path)})
    spec = importlib.util.spec_from_file_location("kaminos_rgb_alpha_cleanup", helper_path)
    if spec is None or spec.loader is None:
        raise SoftAlphaFailure("helper-load", "Could not load RGB alpha cleanup helper module.", {"path": str(helper_path)})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


H = load_alpha_helpers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-manifest", required=True, help="Render manifest with truth/low/predicted role PNGs.")
    parser.add_argument("--truth-role", default="truthHigh", help="Truth render role to use for diagnostics.")
    parser.add_argument("--low-role", default="lowUpsampled", help="Low/baseline render role used for protection masks.")
    parser.add_argument("--predicted-role", default="predictedAll", help="Predicted render role to edit.")
    parser.add_argument("--cleanup-image", help="Optional cleaned RGB PNG to blend from.")
    parser.add_argument("--cleanup-manifest", help="Optional RGB alpha cleanup manifest; uses outputs.rgbAlphaCleaned.path.")
    parser.add_argument("--cleanup-role", default="rgbAlphaCleaned", help="Cleanup manifest output role to read.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--body-norm-threshold", type=float, default=0.10, help="Low/pred RGB norm threshold for protected body.")
    parser.add_argument("--column-dilation-radius", type=int, default=4, help="Pixel radius used to dilate the protected body into a diagnostic column.")
    parser.add_argument("--body-edit-alpha", type=float, default=0.55, help="Cleanup blend amount inside the high-norm protected body.")
    parser.add_argument("--column-edit-alpha", type=float, default=0.85, help="Cleanup blend amount in the diagnostic column outside the protected body.")
    parser.add_argument("--outside-edit-alpha", type=float, default=1.0, help="Cleanup blend amount outside the diagnostic column.")
    parser.add_argument("--direction-cosine-floor", type=float, default=0.85, help="Reduce body edit strength where cleanup direction diverges from predicted RGB.")
    parser.add_argument("--direction-fallback-alpha", type=float, default=0.25, help="Body edit alpha used when cleanup/predicted cosine is below the floor.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


def role_output(render_manifest: dict[str, Any], role: str) -> dict[str, Any]:
    outputs = render_manifest.get("outputs", [])
    if isinstance(outputs, dict):
        output = outputs.get(role)
        if isinstance(output, dict):
            return output
    for output in outputs if isinstance(outputs, list) else []:
        if output.get("role") == role:
            return output
    raise SoftAlphaFailure("manifest-read", "Render manifest missing required role.", {"role": role})


def image_path_from_role(render_manifest: dict[str, Any], role: str) -> Path:
    output = role_output(render_manifest, role)
    path = output.get("path")
    if not path:
        raise SoftAlphaFailure("manifest-read", "Render manifest role missing path.", {"role": role})
    return Path(path)


def cleanup_path_from_args(args: argparse.Namespace) -> Path:
    if args.cleanup_image:
        return Path(args.cleanup_image)
    if not args.cleanup_manifest:
        raise SoftAlphaFailure("manifest-read", "Soft protected alpha requires --cleanup-image or --cleanup-manifest.", {})
    manifest_path = Path(args.cleanup_manifest)
    manifest = H.read_json(manifest_path)
    outputs = manifest.get("outputs", {})
    role_output_payload = outputs.get(args.cleanup_role)
    if not isinstance(role_output_payload, dict) or not role_output_payload.get("path"):
        raise SoftAlphaFailure("manifest-read", "Cleanup manifest missing requested output role path.", {
            "cleanupManifest": str(manifest_path),
            "cleanupRole": args.cleanup_role,
        })
    return Path(role_output_payload["path"])


def rgb_float(path: Path) -> tuple[np.ndarray, np.ndarray]:
    rgba = H.read_png_rgba(path)
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0
    return rgb, rgba


def rgb_norm(rgb: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum(np.square(rgb), axis=2))


def dilate_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    radius = max(0, int(radius))
    if radius == 0:
        return mask.copy()
    height, width = mask.shape
    padded = np.pad(mask, radius, mode="constant", constant_values=False)
    out = np.zeros_like(mask, dtype=bool)
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx * dx + dy * dy > radius * radius:
                continue
            y0 = radius + dy
            x0 = radius + dx
            out |= padded[y0:y0 + height, x0:x0 + width]
    return out


def compose_soft_alpha(
    pred: np.ndarray,
    cleanup: np.ndarray,
    protected_body: np.ndarray,
    diagnostic_column: np.ndarray,
    args: argparse.Namespace,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    edit_alpha = np.full(protected_body.shape, np.clip(float(args.outside_edit_alpha), 0.0, 1.0), dtype=np.float32)
    edit_alpha[diagnostic_column] = np.clip(float(args.column_edit_alpha), 0.0, 1.0)
    edit_alpha[protected_body] = np.clip(float(args.body_edit_alpha), 0.0, 1.0)

    pred_norm = rgb_norm(pred)
    cleanup_norm = rgb_norm(cleanup)
    cosine = np.sum(pred * cleanup, axis=2) / np.maximum(pred_norm * cleanup_norm, 1.0e-6)
    divergent_body = protected_body & (cosine < float(args.direction_cosine_floor))
    edit_alpha[divergent_body] = np.minimum(edit_alpha[divergent_body], np.clip(float(args.direction_fallback_alpha), 0.0, 1.0))

    result = pred * (1.0 - edit_alpha[:, :, None]) + cleanup * edit_alpha[:, :, None]
    return result, edit_alpha, cosine


def gray_map(values: np.ndarray) -> np.ndarray:
    return H.rgba_from_gray(values.astype(np.float32))


def contact_sheet(frames: list[tuple[str, str, np.ndarray]], out_path: Path) -> dict[str, Any]:
    frame_h, frame_w, _ = frames[0][2].shape
    label_h = 24
    sheet = np.zeros((frame_h + label_h, frame_w * len(frames), 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    labels = []
    for index, (role, display_label, rgba) in enumerate(frames):
        x = index * frame_w
        sheet[label_h:label_h + frame_h, x:x + frame_w, :] = rgba
        label = H.draw_label(sheet, display_label, x + 8, 6, 2)
        label["role"] = role
        label["displayLabel"] = display_label
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


def image_metrics(candidate: np.ndarray, truth: np.ndarray, truth_signal_threshold: float = 0.08) -> dict[str, Any]:
    error = candidate - truth
    mse = float(np.mean(np.square(error)))
    abs_error = np.abs(error)
    truth_signal = np.max(truth, axis=2) > truth_signal_threshold
    return {
        "mae": float(np.mean(abs_error)),
        "rmse": float(np.sqrt(mse)),
        "maskedMae": float(np.mean(abs_error[truth_signal])) if np.any(truth_signal) else None,
        "truthSignalMaskThreshold": truth_signal_threshold,
        "truthSignalPixelCount": int(np.count_nonzero(truth_signal)),
    }


def masked_sum(values: np.ndarray, mask: np.ndarray) -> float:
    if not np.any(mask):
        return 0.0
    return float(np.sum(values[mask]))


def masked_mean(values: np.ndarray, mask: np.ndarray) -> float | None:
    if not np.any(mask):
        return None
    return float(np.mean(values[mask]))


def write_failure(out_path: Path | None, out_dir: Path | None, phase: str, message: str, evidence: dict[str, Any]) -> None:
    target = out_path or ((out_dir / "manifest.json") if out_dir is not None else None)
    if target is None:
        return
    H.write_json(target, {
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
        render_manifest_path = Path(args.render_manifest)
        render_manifest = H.read_json(render_manifest_path)
        truth_path = image_path_from_role(render_manifest, args.truth_role)
        low_path = image_path_from_role(render_manifest, args.low_role)
        pred_path = image_path_from_role(render_manifest, args.predicted_role)
        cleanup_path = cleanup_path_from_args(args)

        phase = "image-read"
        truth, truth_rgba = rgb_float(truth_path)
        low, low_rgba = rgb_float(low_path)
        pred, pred_rgba = rgb_float(pred_path)
        cleanup, cleanup_rgba = rgb_float(cleanup_path)
        if truth.shape != low.shape or truth.shape != pred.shape or truth.shape != cleanup.shape:
            raise SoftAlphaFailure("image-read", "Input images do not share the same shape.", {
                "truthShape": list(truth.shape),
                "lowShape": list(low.shape),
                "predictedShape": list(pred.shape),
                "cleanupShape": list(cleanup.shape),
            })

        phase = "mask-derive"
        low_norm = rgb_norm(low)
        pred_norm = rgb_norm(pred)
        protected_body = (low_norm > float(args.body_norm_threshold)) | (pred_norm > float(args.body_norm_threshold))
        diagnostic_column = dilate_mask(protected_body, int(args.column_dilation_radius))
        soft, edit_alpha, cosine = compose_soft_alpha(pred, cleanup, protected_body, diagnostic_column, args)

        phase = "write-images"
        out_dir.mkdir(parents=True, exist_ok=True)
        protected_body_path = out_dir / "protectedBodyMap.png"
        diagnostic_column_path = out_dir / "diagnosticColumnMap.png"
        edit_alpha_path = out_dir / "editAlphaMap.png"
        soft_path = out_dir / "softProtectedAlpha.png"
        body_cosine_path = out_dir / "bodyCosineMap.png"
        H.write_png_rgba(protected_body_path, gray_map(protected_body.astype(np.float32)))
        H.write_png_rgba(diagnostic_column_path, gray_map(diagnostic_column.astype(np.float32)))
        H.write_png_rgba(edit_alpha_path, gray_map(edit_alpha))
        H.write_png_rgba(soft_path, H.rgba_from_rgb_float(soft))
        H.write_png_rgba(body_cosine_path, gray_map(np.clip((cosine + 1.0) * 0.5, 0.0, 1.0)))
        sheet = contact_sheet([
            (args.truth_role, "truth", truth_rgba),
            (args.low_role, "low", low_rgba),
            (args.predicted_role, "pred", pred_rgba),
            ("cleanup", "clean", cleanup_rgba),
            ("softProtectedAlpha", "soft", H.rgba_from_rgb_float(soft)),
            ("editAlphaMap", "editA", gray_map(edit_alpha)),
            ("protectedBodyMap", "body", gray_map(protected_body.astype(np.float32))),
            ("diagnosticColumnMap", "column", gray_map(diagnostic_column.astype(np.float32))),
        ], out_dir / "contactSheet.png")

        phase = "manifest-write"
        pixel_count = int(truth.shape[0] * truth.shape[1])
        protected_count = int(np.count_nonzero(protected_body))
        column_count = int(np.count_nonzero(diagnostic_column))
        outside_count = int(pixel_count - column_count)
        soft_norm = rgb_norm(soft)
        cleanup_norm = rgb_norm(cleanup)
        soft_protected_metrics = {
            "maskIdentity": MASK_IDENTITY,
            "thresholds": {
                "bodyNormThreshold": float(args.body_norm_threshold),
                "columnDilationRadius": int(args.column_dilation_radius),
                "bodyEditAlpha": float(args.body_edit_alpha),
                "columnEditAlpha": float(args.column_edit_alpha),
                "outsideEditAlpha": float(args.outside_edit_alpha),
                "directionCosineFloor": float(args.direction_cosine_floor),
                "directionFallbackAlpha": float(args.direction_fallback_alpha),
            },
            "pixelCount": pixel_count,
            "protectedBodyPixelCount": protected_count,
            "protectedBodyPixelRate": float(protected_count / pixel_count),
            "diagnosticColumnPixelCount": column_count,
            "diagnosticColumnPixelRate": float(column_count / pixel_count),
            "outsideColumnPixelCount": outside_count,
            "outsideColumnPixelRate": float(outside_count / pixel_count),
            "meanEditAlpha": float(np.mean(edit_alpha)),
            "bodyMeanEditAlpha": masked_mean(edit_alpha, protected_body),
            "columnOnlyMeanEditAlpha": masked_mean(edit_alpha, diagnostic_column & ~protected_body),
            "outsideColumnMeanEditAlpha": masked_mean(edit_alpha, ~diagnostic_column),
            "divergentBodyPixelCount": int(np.count_nonzero(protected_body & (cosine < float(args.direction_cosine_floor)))),
            "predictedBodyPredictedNormMass": masked_sum(pred_norm, protected_body),
            "predictedBodySoftNormMass": masked_sum(soft_norm, protected_body),
            "predictedBodyCleanupNormMass": masked_sum(cleanup_norm, protected_body),
            "predictedBodySoftNormRetentionRate": (
                masked_sum(soft_norm, protected_body) / masked_sum(pred_norm, protected_body)
                if masked_sum(pred_norm, protected_body) > 0 else None
            ),
            "predictedBodySoftVsPredictedCosineMean": masked_mean(
                np.sum(pred * soft, axis=2) / np.maximum(pred_norm * soft_norm, 1.0e-6),
                protected_body,
            ),
        }
        render_comparison_metrics = {
            args.low_role: image_metrics(low, truth),
            args.predicted_role: image_metrics(pred, truth),
            "cleanup": image_metrics(cleanup, truth),
            "softProtectedAlpha": image_metrics(soft, truth),
        }
        outputs = {
            "softProtectedAlpha": {"path": str(soft_path), "sha256": H.sha256_file(soft_path)},
            "editAlphaMap": {"path": str(edit_alpha_path), "sha256": H.sha256_file(edit_alpha_path)},
            "protectedBodyMap": {"path": str(protected_body_path), "sha256": H.sha256_file(protected_body_path)},
            "diagnosticColumnMap": {"path": str(diagnostic_column_path), "sha256": H.sha256_file(diagnostic_column_path)},
            "bodyCosineMap": {"path": str(body_cosine_path), "sha256": H.sha256_file(body_cosine_path)},
            "contactSheet": sheet,
        }
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "ok",
            "createdAt": utc_now(),
            "failurePhase": None,
            "renderManifest": str(render_manifest_path),
            "renderManifestSha256": H.sha256_file(render_manifest_path),
            "truthRole": args.truth_role,
            "lowRole": args.low_role,
            "predictedRole": args.predicted_role,
            "cleanupImage": str(cleanup_path),
            "cleanupImageSha256": H.sha256_file(cleanup_path),
            "sourceImages": {
                args.truth_role: {"path": str(truth_path), "sha256": H.sha256_file(truth_path)},
                args.low_role: {"path": str(low_path), "sha256": H.sha256_file(low_path)},
                args.predicted_role: {"path": str(pred_path), "sha256": H.sha256_file(pred_path)},
            },
            "softProtectedMetrics": soft_protected_metrics,
            "renderComparisonMetrics": render_comparison_metrics,
            "outputs": outputs,
        }
        H.write_json(out_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(out_path),
            "contactSheet": sheet["path"],
            "softProtectedAlpha": str(soft_path),
            "bodyMeanEditAlpha": soft_protected_metrics["bodyMeanEditAlpha"],
            "columnOnlyMeanEditAlpha": soft_protected_metrics["columnOnlyMeanEditAlpha"],
            "outsideColumnMeanEditAlpha": soft_protected_metrics["outsideColumnMeanEditAlpha"],
        }, indent=2))
        return 0
    except SoftAlphaFailure as exc:
        write_failure(out_path, out_dir, exc.phase, str(exc), exc.evidence)
        print(json.dumps({"ok": False, "failurePhase": exc.phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        write_failure(out_path, out_dir, phase, str(exc), {"exceptionType": type(exc).__name__})
        print(json.dumps({"ok": False, "failurePhase": phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
