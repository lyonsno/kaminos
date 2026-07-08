#!/usr/bin/env python3
"""Apply RGB cleanup only outside a generously protected fire body."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.render-rgb-conservative-firewall.v0"
IDENTITY = "render-space-conservative-firewall-v0"
MASK_IDENTITY = "protected-fire-mask-from-low-pred-energy-v0"


class FirewallFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def load_alpha_helpers() -> Any:
    helper_path = Path(__file__).with_name("volume-render-rgb-alpha-cleanup.py")
    if not helper_path.exists():
        raise FirewallFailure("helper-load", "RGB alpha cleanup helper script is missing.", {"path": str(helper_path)})
    spec = importlib.util.spec_from_file_location("kaminos_rgb_alpha_cleanup", helper_path)
    if spec is None or spec.loader is None:
        raise FirewallFailure("helper-load", "Could not load RGB alpha cleanup helper module.", {"path": str(helper_path)})
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


H = load_alpha_helpers()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-manifest", required=True, help="Render manifest with truthHigh/lowUpsampled/predicted role PNGs.")
    parser.add_argument("--truth-role", default="truthHigh", help="Truth render role to use for diagnostics.")
    parser.add_argument("--low-role", default="lowUpsampled", help="Low/baseline render role used for protected-mask derivation.")
    parser.add_argument("--predicted-role", default="predictedAll", help="Predicted render role to protect inside fire body.")
    parser.add_argument("--cleanup-image", help="Optional cleaned RGB PNG to apply outside protected fire body.")
    parser.add_argument("--cleanup-manifest", help="Optional RGB alpha cleanup manifest; uses outputs.rgbAlphaCleaned.path.")
    parser.add_argument("--cleanup-role", default="rgbAlphaCleaned", help="Cleanup manifest output role to read.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--low-fire-threshold", type=float, default=0.10, help="Low render energy threshold for trusted fire/smoke body.")
    parser.add_argument("--pred-core-threshold", type=float, default=0.22, help="Predicted render energy threshold for hot core protection.")
    parser.add_argument("--dilation-radius", type=int, default=10, help="Pixel radius used to dilate the protected fire body.")
    parser.add_argument("--edit-feather-radius", type=int, default=2, help="Optional pixel feather radius across the protected/editable boundary.")
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
    raise FirewallFailure("manifest-read", "Render manifest missing required role.", {"role": role})


def image_path_from_role(render_manifest: dict[str, Any], role: str) -> Path:
    output = role_output(render_manifest, role)
    path = output.get("path")
    if not path:
        raise FirewallFailure("manifest-read", "Render manifest role missing path.", {"role": role})
    return Path(path)


def cleanup_path_from_args(args: argparse.Namespace) -> Path:
    if args.cleanup_image:
        return Path(args.cleanup_image)
    if not args.cleanup_manifest:
        raise FirewallFailure("manifest-read", "Conservative firewall requires --cleanup-image or --cleanup-manifest.", {})
    manifest_path = Path(args.cleanup_manifest)
    manifest = H.read_json(manifest_path)
    outputs = manifest.get("outputs", {})
    role_output_payload = outputs.get(args.cleanup_role)
    if not isinstance(role_output_payload, dict) or not role_output_payload.get("path"):
        raise FirewallFailure("manifest-read", "Cleanup manifest missing requested output role path.", {
            "cleanupManifest": str(manifest_path),
            "cleanupRole": args.cleanup_role,
        })
    return Path(role_output_payload["path"])


def rgb_float(path: Path) -> tuple[np.ndarray, np.ndarray]:
    rgba = H.read_png_rgba(path)
    rgb = rgba[:, :, :3].astype(np.float32) / 255.0
    return rgb, rgba


def luma(rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * rgb[:, :, 0]) + (0.7152 * rgb[:, :, 1]) + (0.0722 * rgb[:, :, 2])


def fire_energy(rgb: np.ndarray) -> np.ndarray:
    luma_energy = luma(rgb)
    red_bias = rgb[:, :, 0] * 0.85 + rgb[:, :, 1] * 0.25
    max_channel = np.max(rgb, axis=2)
    return np.maximum.reduce([luma_energy, red_bias, max_channel * 0.75])


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


def erode_mask(mask: np.ndarray, radius: int) -> np.ndarray:
    radius = max(0, int(radius))
    if radius == 0:
        return mask.copy()
    return ~dilate_mask(~mask, radius)


def compose_firewall(pred: np.ndarray, cleanup: np.ndarray, protected: np.ndarray, feather_radius: int) -> tuple[np.ndarray, np.ndarray]:
    editable = ~protected
    if feather_radius <= 0:
        alpha = editable.astype(np.float32)
    else:
        hard_edit = erode_mask(editable, feather_radius)
        boundary = editable & ~hard_edit
        alpha = hard_edit.astype(np.float32)
        if np.any(boundary):
            # Conservative feather: only half-strength at the border so plume edges stay pred-biased.
            alpha[boundary] = 0.5
    result = pred * (1.0 - alpha[:, :, None]) + cleanup * alpha[:, :, None]
    return result, alpha


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
            raise FirewallFailure("image-read", "Input images do not share the same shape.", {
                "truthShape": list(truth.shape),
                "lowShape": list(low.shape),
                "predictedShape": list(pred.shape),
                "cleanupShape": list(cleanup.shape),
            })

        phase = "mask-derive"
        low_energy = fire_energy(low)
        pred_energy = fire_energy(pred)
        seed_mask = (low_energy >= args.low_fire_threshold) | (pred_energy >= args.pred_core_threshold)
        protected_mask = dilate_mask(seed_mask, args.dilation_radius)
        firewall, edit_alpha = compose_firewall(pred, cleanup, protected_mask, args.edit_feather_radius)
        editable_mask = edit_alpha > 0.0
        full_edit_mask = edit_alpha >= 0.999
        feather_mask = (edit_alpha > 0.0) & (edit_alpha < 0.999)

        phase = "write-images"
        out_dir.mkdir(parents=True, exist_ok=True)
        protected_path = out_dir / "protectedFireMask.png"
        editable_path = out_dir / "editableRegionMap.png"
        firewall_path = out_dir / "conservativeFirewall.png"
        edit_alpha_path = out_dir / "editAlphaMap.png"
        protected_energy_path = out_dir / "protectedEnergyMap.png"
        H.write_png_rgba(protected_path, gray_map(protected_mask.astype(np.float32)))
        H.write_png_rgba(editable_path, gray_map(edit_alpha))
        H.write_png_rgba(firewall_path, H.rgba_from_rgb_float(firewall))
        H.write_png_rgba(edit_alpha_path, gray_map(edit_alpha))
        H.write_png_rgba(protected_energy_path, gray_map(np.clip(np.maximum(low_energy, pred_energy), 0.0, 1.0)))
        sheet = contact_sheet([
            (args.truth_role, "truth", truth_rgba),
            (args.low_role, "low", low_rgba),
            (args.predicted_role, "pred", pred_rgba),
            ("cleanup", "clean", cleanup_rgba),
            ("conservativeFirewall", "firewall", H.rgba_from_rgb_float(firewall)),
            ("protectedFireMask", "protect", gray_map(protected_mask.astype(np.float32))),
            ("editableRegionMap", "editable", gray_map(edit_alpha)),
        ], out_dir / "contactSheet.png")

        phase = "manifest-write"
        pixel_count = int(truth.shape[0] * truth.shape[1])
        cleanup_delta = np.sqrt(np.sum(np.square(cleanup - pred), axis=2))
        firewall_delta = np.sqrt(np.sum(np.square(firewall - pred), axis=2))
        protected_delta = float(np.sum(firewall_delta[protected_mask]))
        editable_delta = float(np.sum(firewall_delta[editable_mask])) if np.any(editable_mask) else 0.0
        cleanup_available_delta = float(np.sum(cleanup_delta[editable_mask])) if np.any(editable_mask) else 0.0
        firewall_metrics = {
            "maskIdentity": MASK_IDENTITY,
            "thresholds": {
                "lowFireThreshold": args.low_fire_threshold,
                "predCoreThreshold": args.pred_core_threshold,
                "dilationRadius": args.dilation_radius,
                "editFeatherRadius": args.edit_feather_radius,
            },
            "pixelCount": pixel_count,
            "seedPixelCount": int(np.count_nonzero(seed_mask)),
            "protectedPixelCount": int(np.count_nonzero(protected_mask)),
            "protectedPixelRate": float(np.count_nonzero(protected_mask) / pixel_count),
            "editablePixelCount": int(np.count_nonzero(editable_mask)),
            "editablePixelRate": float(np.count_nonzero(editable_mask) / pixel_count),
            "fullEditPixelCount": int(np.count_nonzero(full_edit_mask)),
            "featherPixelCount": int(np.count_nonzero(feather_mask)),
            "protectedPredictionChangeMass": protected_delta,
            "editablePredictionChangeMass": editable_delta,
            "editableCleanupApplicationMassRate": (editable_delta / cleanup_available_delta) if cleanup_available_delta > 0.0 else None,
        }
        render_comparison_metrics = {
            args.low_role: image_metrics(low, truth),
            args.predicted_role: image_metrics(pred, truth),
            "cleanup": image_metrics(cleanup, truth),
            "conservativeFirewall": image_metrics(firewall, truth),
        }
        outputs = {
            "protectedFireMask": {"path": str(protected_path), "sha256": H.sha256_file(protected_path)},
            "editableRegionMap": {"path": str(editable_path), "sha256": H.sha256_file(editable_path)},
            "editAlphaMap": {"path": str(edit_alpha_path), "sha256": H.sha256_file(edit_alpha_path)},
            "protectedEnergyMap": {"path": str(protected_energy_path), "sha256": H.sha256_file(protected_energy_path)},
            "conservativeFirewall": {"path": str(firewall_path), "sha256": H.sha256_file(firewall_path)},
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
            "truthRole": args.truth_role,
            "lowRole": args.low_role,
            "cleanupImage": str(cleanup_path),
            "cleanupImageSha256": H.sha256_file(cleanup_path),
            "sourceImages": {
                args.truth_role: {"path": str(truth_path), "sha256": H.sha256_file(truth_path)},
                args.low_role: {"path": str(low_path), "sha256": H.sha256_file(low_path)},
                args.predicted_role: {"path": str(pred_path), "sha256": H.sha256_file(pred_path)},
            },
            "firewallMetrics": firewall_metrics,
            "renderComparisonMetrics": render_comparison_metrics,
            "outputs": outputs,
        }
        H.write_json(out_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(out_path),
            "contactSheet": sheet["path"],
            "conservativeFirewall": str(firewall_path),
            "protectedPixelRate": firewall_metrics["protectedPixelRate"],
            "editablePixelRate": firewall_metrics["editablePixelRate"],
            "protectedPredictionChangeMass": protected_delta,
        }, indent=2))
        return 0
    except FirewallFailure as exc:
        write_failure(out_path, out_dir, exc.phase, str(exc), exc.evidence)
        print(json.dumps({"ok": False, "failurePhase": exc.phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1
    except Exception as exc:
        write_failure(out_path, out_dir, phase, str(exc), {"exceptionType": type(exc).__name__})
        print(json.dumps({"ok": False, "failurePhase": phase, "error": str(exc), "manifest": str(out_path)}, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
