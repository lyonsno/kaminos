#!/usr/bin/env python3
"""Score rendered prediction residuals as useful lift or false pollution."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.render-rgb-pollution-lift-diagnostic.v0"
IDENTITY = "render-space-pollution-vs-lift-v0"
MAP_IDENTITY = "render-rgb-pollution-lift-maps-v0"
METRIC_IDENTITY = "render-rgb-pollution-lift-metrics-v0"


class DiagnosticFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_alpha_helpers() -> Any:
    helper_path = Path(__file__).with_name("volume-render-rgb-alpha-cleanup.py")
    if not helper_path.exists():
        raise DiagnosticFailure("helper-load", "RGB alpha cleanup helper script is missing.", {"path": str(helper_path)})
    spec = importlib.util.spec_from_file_location("kaminos_rgb_alpha_cleanup", helper_path)
    if spec is None or spec.loader is None:
        raise DiagnosticFailure("helper-load", "Could not load RGB alpha cleanup helper module.", {"path": str(helper_path)})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


H = load_alpha_helpers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-manifest", required=True, help="Render manifest with truthHigh/lowUpsampled/predicted role PNGs.")
    parser.add_argument("--predicted-role", default="predictedAll", help="Predicted render role to score.")
    parser.add_argument("--cleanup-image", help="Optional cleaned RGB PNG to score against predicted residuals.")
    parser.add_argument("--cleanup-manifest", help="Optional RGB alpha cleanup manifest; uses outputs.rgbAlphaCleaned.path.")
    parser.add_argument("--cleanup-role", default="rgbAlphaCleaned", help="Cleanup manifest output role to read.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--improvement-margin", type=float, default=0.025, help="L2 RGB error margin for useful/worse classification.")
    parser.add_argument("--residual-threshold", type=float, default=0.035, help="Minimum predicted-vs-low residual magnitude to classify.")
    parser.add_argument("--clean-low-threshold", type=float, default=0.08, help="Low-vs-truth error threshold for clean-region pollution.")
    parser.add_argument("--retention-min", type=float, default=0.35, help="Minimum cleaned residual retention on useful-lift pixels.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


def role_output(render_manifest: dict[str, Any], role: str) -> dict[str, Any]:
    for output in render_manifest.get("outputs", []):
        if output.get("role") == role:
            return output
    raise DiagnosticFailure("manifest-read", "Render manifest missing required role.", {"role": role})


def image_path_from_role(render_manifest: dict[str, Any], role: str) -> Path:
    output = role_output(render_manifest, role)
    path = output.get("path")
    if not path:
        raise DiagnosticFailure("manifest-read", "Render manifest role missing path.", {"role": role})
    return Path(path)


def cleanup_path_from_args(args: argparse.Namespace) -> Path | None:
    if args.cleanup_image:
        return Path(args.cleanup_image)
    if not args.cleanup_manifest:
        return None
    manifest_path = Path(args.cleanup_manifest)
    manifest = H.read_json(manifest_path)
    outputs = manifest.get("outputs", {})
    role_output_payload = outputs.get(args.cleanup_role)
    if not isinstance(role_output_payload, dict) or not role_output_payload.get("path"):
        raise DiagnosticFailure("manifest-read", "Cleanup manifest missing requested output role path.", {
            "cleanupManifest": str(manifest_path),
            "cleanupRole": args.cleanup_role,
        })
    return Path(role_output_payload["path"])


def rgb_float(path: Path) -> tuple[np.ndarray, np.ndarray]:
    rgba = H.read_png_rgba(path)
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0
    return rgb, rgba


def l2_rgb(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.sqrt(np.sum(np.square(a - b), axis=2))


def scalar_map(values: np.ndarray, mask: np.ndarray, scale: float) -> np.ndarray:
    out = np.zeros_like(values, dtype=np.float32)
    if np.any(mask):
        out[mask] = np.clip(values[mask] / max(scale, 1.0e-6), 0.0, 1.0)
    return out


def color_mask(mask: np.ndarray, intensity: np.ndarray, color: tuple[float, float, float]) -> np.ndarray:
    rgb = np.zeros((*mask.shape, 3), dtype=np.float32)
    for channel, value in enumerate(color):
        rgb[:, :, channel] = np.where(mask, intensity * value, 0.0)
    return H.rgba_from_rgb_float(rgb)


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


def masked_sum(values: np.ndarray, mask: np.ndarray) -> float:
    if not np.any(mask):
        return 0.0
    return float(np.sum(values[mask]))


def count(mask: np.ndarray) -> int:
    return int(np.count_nonzero(mask))


def safe_rate(numerator: float, denominator: float) -> float | None:
    if denominator <= 0:
        return None
    return float(numerator / denominator)


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
        truth_path = image_path_from_role(render_manifest, "truthHigh")
        low_path = image_path_from_role(render_manifest, "lowUpsampled")
        pred_path = image_path_from_role(render_manifest, args.predicted_role)
        cleanup_path = cleanup_path_from_args(args)

        phase = "image-read"
        truth, truth_rgba = rgb_float(truth_path)
        low, low_rgba = rgb_float(low_path)
        pred, pred_rgba = rgb_float(pred_path)
        cleanup = cleanup_rgba = None
        if cleanup_path is not None:
            cleanup, cleanup_rgba = rgb_float(cleanup_path)
        if truth.shape != low.shape or truth.shape != pred.shape or (cleanup is not None and truth.shape != cleanup.shape):
            raise DiagnosticFailure("image-read", "Input images do not share the same shape.", {
                "truthShape": list(truth.shape),
                "lowShape": list(low.shape),
                "predictedShape": list(pred.shape),
                "cleanupShape": list(cleanup.shape) if cleanup is not None else None,
            })

        phase = "score"
        low_err = l2_rgb(low, truth)
        pred_err = l2_rgb(pred, truth)
        pred_delta = l2_rgb(pred, low)
        improvement = low_err - pred_err
        pollution = pred_err - low_err
        useful_lift = (improvement > args.improvement_margin) & (pred_delta > args.residual_threshold)
        false_pollution = (pollution > args.improvement_margin) & (pred_delta > args.residual_threshold)
        clean_region_pollution = false_pollution & (low_err <= args.clean_low_threshold)

        cleanup_metrics: dict[str, Any] = {"cleanupPresent": cleanup is not None}
        removed_pollution = np.zeros_like(false_pollution, dtype=bool)
        retained_lift = np.zeros_like(useful_lift, dtype=bool)
        low_collapse = np.zeros_like(useful_lift, dtype=bool)
        cleanup_err = cleanup_delta = None
        if cleanup is not None:
            cleanup_err = l2_rgb(cleanup, truth)
            cleanup_delta = l2_rgb(cleanup, low)
            residual_retention = cleanup_delta / np.maximum(pred_delta, 1.0e-6)
            removed_pollution = false_pollution & ((pred_err - cleanup_err) > args.improvement_margin)
            retained_lift = useful_lift & ((low_err - cleanup_err) > args.improvement_margin) & (residual_retention >= args.retention_min)
            low_collapse = useful_lift & ((cleanup_err - pred_err) > args.improvement_margin)
            removed_mass = masked_sum(pred_err - cleanup_err, false_pollution & (cleanup_err < pred_err))
            pollution_mass = masked_sum(pollution, false_pollution)
            retained_mass = masked_sum(low_err - cleanup_err, retained_lift)
            lift_mass = masked_sum(improvement, useful_lift)
            cleanup_metrics = {
                "cleanupPresent": True,
                "cleanupPath": str(cleanup_path),
                "cleanupSha256": H.sha256_file(cleanup_path),
                "removedPollutionPixelCount": count(removed_pollution),
                "removedPollutionPixelRateWithinFalsePollution": safe_rate(count(removed_pollution), count(false_pollution)),
                "removedPollutionMass": removed_mass,
                "removedPollutionMassRate": safe_rate(removed_mass, pollution_mass),
                "retainedLiftPixelCount": count(retained_lift),
                "retainedLiftPixelRateWithinUsefulLift": safe_rate(count(retained_lift), count(useful_lift)),
                "retainedLiftMass": retained_mass,
                "retainedLiftMassRate": safe_rate(retained_mass, lift_mass),
                "lowCollapsePixelCount": count(low_collapse),
                "lowCollapsePixelRateWithinUsefulLift": safe_rate(count(low_collapse), count(useful_lift)),
            }

        phase = "write-images"
        out_dir.mkdir(parents=True, exist_ok=True)
        useful_intensity = scalar_map(improvement, useful_lift, args.improvement_margin * 8.0)
        pollution_intensity = scalar_map(pollution, false_pollution, args.improvement_margin * 8.0)
        clean_pollution_intensity = scalar_map(pollution, clean_region_pollution, args.improvement_margin * 8.0)
        removed_intensity = scalar_map(pred_err - cleanup_err, removed_pollution, args.improvement_margin * 8.0) if cleanup_err is not None else np.zeros_like(low_err)
        retained_intensity = scalar_map(low_err - cleanup_err, retained_lift, args.improvement_margin * 8.0) if cleanup_err is not None else np.zeros_like(low_err)
        collapse_intensity = scalar_map(cleanup_err - pred_err, low_collapse, args.improvement_margin * 8.0) if cleanup_err is not None else np.zeros_like(low_err)

        useful_path = out_dir / "usefulLiftMap.png"
        pollution_path = out_dir / "falsePollutionMap.png"
        clean_pollution_path = out_dir / "cleanRegionPollutionMap.png"
        retained_path = out_dir / "retainedLiftMap.png"
        removed_path = out_dir / "removedPollutionMap.png"
        collapse_path = out_dir / "lowCollapseMap.png"
        sheet_path = out_dir / "contactSheet.png"

        useful_rgba = color_mask(useful_lift, useful_intensity, (0.1, 1.0, 0.25))
        pollution_rgba = color_mask(false_pollution, pollution_intensity, (1.0, 0.1, 0.05))
        clean_pollution_rgba = color_mask(clean_region_pollution, clean_pollution_intensity, (1.0, 0.45, 0.0))
        retained_rgba = color_mask(retained_lift, retained_intensity, (0.0, 0.9, 1.0))
        removed_rgba = color_mask(removed_pollution, removed_intensity, (0.4, 0.4, 1.0))
        collapse_rgba = color_mask(low_collapse, collapse_intensity, (1.0, 0.0, 1.0))

        H.write_png_rgba(useful_path, useful_rgba)
        H.write_png_rgba(pollution_path, pollution_rgba)
        H.write_png_rgba(clean_pollution_path, clean_pollution_rgba)
        H.write_png_rgba(retained_path, retained_rgba)
        H.write_png_rgba(removed_path, removed_rgba)
        H.write_png_rgba(collapse_path, collapse_rgba)

        frames = [
            ("truthHigh", "truth", truth_rgba),
            ("lowUpsampled", "low", low_rgba),
            (args.predicted_role, "pred", pred_rgba),
        ]
        if cleanup_rgba is not None:
            frames.append(("cleanup", "clean", cleanup_rgba))
        frames.extend([
            ("usefulLiftMap", "lift", useful_rgba),
            ("falsePollutionMap", "pollute", pollution_rgba),
            ("removedPollutionMap", "removed", removed_rgba),
            ("retainedLiftMap", "retained", retained_rgba),
            ("lowCollapseMap", "collapse", collapse_rgba),
        ])
        sheet = contact_sheet(frames, sheet_path)

        phase = "manifest-write"
        lift_mass = masked_sum(improvement, useful_lift)
        pollution_mass = masked_sum(pollution, false_pollution)
        clean_pollution_mass = masked_sum(pollution, clean_region_pollution)
        pixel_count = int(truth.shape[0] * truth.shape[1])
        pollution_lift_metrics = {
            "identity": METRIC_IDENTITY,
            "pixelCount": pixel_count,
            "thresholds": {
                "improvementMargin": args.improvement_margin,
                "residualThreshold": args.residual_threshold,
                "cleanLowThreshold": args.clean_low_threshold,
                "retentionMin": args.retention_min,
            },
            "usefulLiftPixelCount": count(useful_lift),
            "usefulLiftPixelRate": safe_rate(count(useful_lift), pixel_count),
            "usefulLiftMass": lift_mass,
            "falsePollutionPixelCount": count(false_pollution),
            "falsePollutionPixelRate": safe_rate(count(false_pollution), pixel_count),
            "falsePollutionMass": pollution_mass,
            "cleanRegionPollutionPixelCount": count(clean_region_pollution),
            "cleanRegionPollutionPixelRate": safe_rate(count(clean_region_pollution), pixel_count),
            "cleanRegionPollutionMass": clean_pollution_mass,
            "pollutionToLiftMassRatio": safe_rate(pollution_mass, lift_mass),
            "cleanup": cleanup_metrics,
        }

        outputs = {
            "usefulLiftMap": {"path": str(useful_path), "sha256": H.sha256_file(useful_path)},
            "falsePollutionMap": {"path": str(pollution_path), "sha256": H.sha256_file(pollution_path)},
            "cleanRegionPollutionMap": {"path": str(clean_pollution_path), "sha256": H.sha256_file(clean_pollution_path)},
            "retainedLiftMap": {"path": str(retained_path), "sha256": H.sha256_file(retained_path)},
            "removedPollutionMap": {"path": str(removed_path), "sha256": H.sha256_file(removed_path)},
            "lowCollapseMap": {"path": str(collapse_path), "sha256": H.sha256_file(collapse_path)},
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
            "predictedRole": args.predicted_role,
            "sourceImages": {
                "truthHigh": {"path": str(truth_path), "sha256": H.sha256_file(truth_path)},
                "lowUpsampled": {"path": str(low_path), "sha256": H.sha256_file(low_path)},
                args.predicted_role: {"path": str(pred_path), "sha256": H.sha256_file(pred_path)},
            },
            "cleanup": cleanup_metrics,
            "mapIdentity": MAP_IDENTITY,
            "pollutionLiftMetrics": pollution_lift_metrics,
            "outputs": outputs,
        }
        H.write_json(out_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(out_path),
            "contactSheet": str(sheet_path),
            "usefulLiftPixels": pollution_lift_metrics["usefulLiftPixelCount"],
            "falsePollutionPixels": pollution_lift_metrics["falsePollutionPixelCount"],
            "removedPollutionRate": cleanup_metrics.get("removedPollutionPixelRateWithinFalsePollution"),
            "retainedLiftRate": cleanup_metrics.get("retainedLiftPixelRateWithinUsefulLift"),
        }, indent=2))
        return 0
    except DiagnosticFailure as exc:
        write_failure(out_path, out_dir, exc.phase, str(exc), exc.evidence)
        print(json.dumps({"ok": False, "failurePhase": exc.phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        write_failure(out_path, out_dir, phase, str(exc), {"exceptionType": type(exc).__name__})
        print(json.dumps({"ok": False, "failurePhase": phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
