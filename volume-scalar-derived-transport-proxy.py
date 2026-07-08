#!/usr/bin/env python3
"""Derive a velocity-like transport proxy from temporal scalar carrier changes."""

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


SCHEMA = "kaminos.volume.scalar-derived-transport-proxy.v0"
IDENTITY = "scalar-derived-transport-transposition-proxy-v0"
SOLVE_IDENTITY = "multi-carrier-normal-flow-least-squares-v0"
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
FLUID_CHANNELS = [
    "velocityX",
    "velocityY",
    "velocityZ",
    "densityCarrier",
    "smokeDensity",
    "heat",
    "fuel",
    "detail",
    "flame",
    "ember",
    "visibleFireCarrier",
    "combustionFront",
    "microdetail",
    "interfaceShred",
    "fireLick",
    "emberFleck",
]
FRONT_CHANNELS = ["frontTopology"]
ALL_CHANNELS = [*FLUID_CHANNELS, *FRONT_CHANNELS]

_LABEL_HELPER_PATH = Path(__file__).with_name("volume-full-grid-diagnostic-rgb-context-ablation.py")
_LABEL_SPEC = importlib.util.spec_from_file_location("volume_full_grid_diagnostic_rgb_context_ablation", _LABEL_HELPER_PATH)
if _LABEL_SPEC is None or _LABEL_SPEC.loader is None:
    raise RuntimeError(f"Unable to load label helper {_LABEL_HELPER_PATH}")
_LABEL = importlib.util.module_from_spec(_LABEL_SPEC)
_LABEL_SPEC.loader.exec_module(_LABEL)


class TransportProxyFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, help="Temporal velocity-closure motion manifest with low/high frame export manifests.")
    parser.add_argument("--out-dir", required=True, help="Output directory for manifest and contact sheet.")
    parser.add_argument("--frame-t0", type=int, default=1200, help="Start frame time in milliseconds.")
    parser.add_argument("--frame-t1", type=int, default=1400, help="End frame time in milliseconds.")
    parser.add_argument("--slice-y", type=int, help="High-grid Y slice. Defaults to highGrid//2.")
    parser.add_argument("--carrier-channel-list", default=",".join(DEFAULT_CARRIERS), help="Comma-separated scalar carrier channel list.")
    parser.add_argument("--normal-regularization", type=float, default=1.0e-3, help="Regularization for the per-pixel normal-flow least-squares solve.")
    parser.add_argument("--support-quantile", type=float, default=0.80, help="Quantile used to derive report-only scalar support masks.")
    parser.add_argument("--support-scale", type=float, default=0.25, help="Scale applied to the scalar support quantile.")
    parser.add_argument("--predicted-t0-application-manifest", help="Optional predicted-high application manifest for frame t0.")
    parser.add_argument("--predicted-t1-application-manifest", help="Optional predicted-high application manifest for frame t1.")
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
    if isinstance(error, TransportProxyFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(path, payload)


def parse_carriers(raw: str) -> list[str]:
    carriers = [part.strip() for part in raw.split(",") if part.strip()]
    unknown = [name for name in carriers if name not in ALL_CHANNELS]
    if unknown:
        raise TransportProxyFailure("args", "Unknown carrier channel.", {"unknown": unknown, "available": ALL_CHANNELS})
    if not carriers:
        raise TransportProxyFailure("args", "No carrier channels selected.")
    return carriers


def descriptor_from_export(manifest: dict[str, Any], kind: str) -> dict[str, Any]:
    if "sidecars" in manifest and kind in manifest["sidecars"]:
        return manifest["sidecars"][kind]
    if kind in manifest:
        return manifest[kind]
    raise TransportProxyFailure("manifest-read", f"Manifest missing {kind} sidecar descriptor.", {"keys": sorted(manifest.keys())})


def verify_descriptor(descriptor: dict[str, Any]) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    if not path.exists():
        raise TransportProxyFailure("sidecar-read", f"Missing sidecar {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if expected_bytes and expected_bytes != actual_bytes:
        raise TransportProxyFailure("sidecar-read", f"Sidecar byte mismatch {path}", {
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
        })
    return path


def load_export(manifest_path: Path) -> dict[str, Any]:
    manifest = read_json(manifest_path)
    grid = int(manifest.get("grid") or manifest.get("highGrid") or 0)
    if grid <= 0:
        raise TransportProxyFailure("manifest-read", "Unable to resolve export grid.", {"manifest": str(manifest_path)})
    fluid_desc = descriptor_from_export(manifest, "fluid")
    front_desc = descriptor_from_export(manifest, "front")
    fluid_path = verify_descriptor(fluid_desc)
    front_path = verify_descriptor(front_desc)
    cells = grid ** 3
    fluid = np.memmap(fluid_path, dtype="<f4", mode="r", shape=(cells, len(FLUID_CHANNELS)))
    front = np.memmap(front_path, dtype="<f4", mode="r", shape=(cells,))
    return {
        "path": str(manifest_path),
        "manifest": manifest,
        "grid": grid,
        "fluid": fluid,
        "front": front,
        "fluidDescriptor": fluid_desc,
        "frontDescriptor": front_desc,
        "fluidPath": fluid_path,
        "frontPath": front_path,
    }


def load_predicted_application(manifest_path: Path, high_grid: int) -> dict[str, Any]:
    manifest = read_json(manifest_path)
    role = manifest.get("roles", {}).get("predictedHigh")
    if not role:
        raise TransportProxyFailure("predicted-application", "Predicted application manifest is missing roles.predictedHigh.", {"manifest": str(manifest_path)})
    fluid_desc = role["fluid"]
    front_desc = role["front"]
    fluid_path = verify_descriptor(fluid_desc)
    front_path = verify_descriptor(front_desc)
    cells = high_grid ** 3
    return {
        "path": str(manifest_path),
        "manifest": manifest,
        "grid": high_grid,
        "fluid": np.memmap(fluid_path, dtype="<f4", mode="r", shape=(cells, len(FLUID_CHANNELS))),
        "front": np.memmap(front_path, dtype="<f4", mode="r", shape=(cells,)),
        "fluidDescriptor": fluid_desc,
        "frontDescriptor": front_desc,
        "fluidPath": fluid_path,
        "frontPath": front_path,
    }


def high_slice_indexes(grid: int, slice_y: int) -> np.ndarray:
    x = np.arange(grid, dtype=np.int64).reshape(1, grid)
    z = np.arange(grid, dtype=np.int64).reshape(grid, 1)
    return (x + np.int64(slice_y) * grid + z * grid * grid).reshape(-1)


def low_indexes_for_high_slice(high_grid: int, low_grid: int, slice_y: int) -> np.ndarray:
    x = np.arange(high_grid, dtype=np.int64).reshape(1, high_grid)
    z = np.arange(high_grid, dtype=np.int64).reshape(high_grid, 1)
    ratio = high_grid / low_grid
    lx = np.minimum(low_grid - 1, np.floor(x / ratio).astype(np.int64))
    ly = min(low_grid - 1, int(math.floor(slice_y / ratio)))
    lz = np.minimum(low_grid - 1, np.floor(z / ratio).astype(np.int64))
    return (lx + np.int64(ly) * low_grid + lz * low_grid * low_grid).reshape(-1)


def channel_values(frame: dict[str, Any], indexes: np.ndarray, carriers: list[str]) -> np.ndarray:
    cols = []
    for name in carriers:
        if name in FLUID_CHANNELS:
            cols.append(np.asarray(frame["fluid"][indexes, FLUID_CHANNELS.index(name)], dtype=np.float32))
        else:
            cols.append(np.asarray(frame["front"][indexes], dtype=np.float32))
    return np.stack(cols, axis=1).astype(np.float32, copy=False)


def normalized_carrier_images(frame0: dict[str, Any], frame1: dict[str, Any], indexes: np.ndarray, carriers: list[str], grid: int) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    c0 = channel_values(frame0, indexes, carriers)
    c1 = channel_values(frame1, indexes, carriers)
    scale = np.quantile(np.abs(np.concatenate([c0, c1], axis=0)).astype(np.float64), 0.95, axis=0).astype(np.float32)
    scale = np.where(scale < np.float32(1.0e-6), np.float32(1.0), scale)
    c0n = np.clip(c0 / scale.reshape(1, -1), 0.0, 8.0).reshape(grid, grid, len(carriers))
    c1n = np.clip(c1 / scale.reshape(1, -1), 0.0, 8.0).reshape(grid, grid, len(carriers))
    return c0n, c1n, {
        "identity": "carrier-p95-normalization-v0",
        "carrierChannelList": carriers,
        "p95ScaleByCarrier": {name: float(value) for name, value in zip(carriers, scale.tolist())},
    }


def scalar_transport_proxy(c0: np.ndarray, c1: np.ndarray, dt_seconds: float, regularization: float) -> tuple[np.ndarray, np.ndarray, dict[str, Any]]:
    gx = np.zeros_like(c0, dtype=np.float32)
    gz = np.zeros_like(c0, dtype=np.float32)
    gx[:, 1:-1, :] = (c0[:, 2:, :] - c0[:, :-2, :]) * np.float32(0.5)
    gx[:, 0, :] = c0[:, 1, :] - c0[:, 0, :]
    gx[:, -1, :] = c0[:, -1, :] - c0[:, -2, :]
    gz[1:-1, :, :] = (c0[2:, :, :] - c0[:-2, :, :]) * np.float32(0.5)
    gz[0, :, :] = c0[1, :, :] - c0[0, :, :]
    gz[-1, :, :] = c0[-1, :, :] - c0[-2, :, :]
    ct = (c1 - c0) / np.float32(max(dt_seconds, 1.0e-6))

    a = np.sum(gx * gx, axis=2) + np.float32(regularization)
    b = np.sum(gx * gz, axis=2)
    d = np.sum(gz * gz, axis=2) + np.float32(regularization)
    rhs_x = -np.sum(gx * ct, axis=2)
    rhs_z = -np.sum(gz * ct, axis=2)
    det = np.maximum(a * d - b * b, np.float32(1.0e-8))
    vx = (rhs_x * d - b * rhs_z) / det
    vz = (a * rhs_z - b * rhs_x) / det
    support_energy = np.sqrt(np.sum(c0 * c0 + c1 * c1, axis=2))
    return vx.astype(np.float32), vz.astype(np.float32), {
        "identity": SOLVE_IDENTITY,
        "normalRegularization": float(regularization),
        "dtSeconds": float(dt_seconds),
        "meanGradientEnergy": float(np.mean(np.sqrt(np.sum(gx * gx + gz * gz, axis=2)))),
        "meanTemporalDeltaEnergy": float(np.mean(np.sqrt(np.sum(ct * ct, axis=2)))),
        "meanSupportEnergy": float(np.mean(support_energy)),
    }


def velocity_slice(frame: dict[str, Any], indexes: np.ndarray, grid: int) -> tuple[np.ndarray, np.ndarray]:
    vx = np.asarray(frame["fluid"][indexes, 0], dtype=np.float32).reshape(grid, grid)
    vz = np.asarray(frame["fluid"][indexes, 2], dtype=np.float32).reshape(grid, grid)
    return vx, vz


def flow_debug_rgb(vx: np.ndarray, vz: np.ndarray) -> np.ndarray:
    dvx_dx = np.zeros_like(vx, dtype=np.float32)
    dvz_dz = np.zeros_like(vz, dtype=np.float32)
    dvx_dz = np.zeros_like(vx, dtype=np.float32)
    dvz_dx = np.zeros_like(vz, dtype=np.float32)
    dvx_dx[:, 1:-1] = (vx[:, 2:] - vx[:, :-2]) * np.float32(0.5)
    dvx_dx[:, 0] = vx[:, 1] - vx[:, 0]
    dvx_dx[:, -1] = vx[:, -1] - vx[:, -2]
    dvz_dx[:, 1:-1] = (vz[:, 2:] - vz[:, :-2]) * np.float32(0.5)
    dvz_dx[:, 0] = vz[:, 1] - vz[:, 0]
    dvz_dx[:, -1] = vz[:, -1] - vz[:, -2]
    dvx_dz[1:-1, :] = (vx[2:, :] - vx[:-2, :]) * np.float32(0.5)
    dvx_dz[0, :] = vx[1, :] - vx[0, :]
    dvx_dz[-1, :] = vx[-1, :] - vx[-2, :]
    dvz_dz[1:-1, :] = (vz[2:, :] - vz[:-2, :]) * np.float32(0.5)
    dvz_dz[0, :] = vz[1, :] - vz[0, :]
    dvz_dz[-1, :] = vz[-1, :] - vz[-2, :]
    divergence = np.abs(dvx_dx + dvz_dz)
    curl_y = np.abs(dvx_dz - dvz_dx)
    alpha = _LABEL.smoothstep(0.015, 0.12, curl_y + divergence)
    mix = _LABEL.smoothstep(0.010, 0.085, divergence)[:, :, None]
    cyan = np.array([0.08, 0.72, 0.95], dtype=np.float32).reshape(1, 1, 3)
    red = np.array([1.0, 0.18, 0.08], dtype=np.float32).reshape(1, 1, 3)
    color = cyan * (1.0 - mix) + red * mix
    color *= (np.float32(0.35) + _LABEL.smoothstep(0.012, 0.18, curl_y))[:, :, None]
    return np.clip(color * alpha[:, :, None], 0.0, 1.0).astype(np.float32)


def support_mask_from_carriers(c0: np.ndarray, c1: np.ndarray, quantile: float, scale: float) -> tuple[np.ndarray, float]:
    energy = np.sqrt(np.sum(c0 * c0 + c1 * c1, axis=2))
    threshold = max(1.0e-6, float(np.quantile(energy.astype(np.float64), max(0.0, min(1.0, quantile)))) * float(scale))
    return energy > threshold, threshold


def compare_vector(role_vx: np.ndarray, role_vz: np.ndarray, truth_vx: np.ndarray, truth_vz: np.ndarray, mask: np.ndarray) -> dict[str, Any]:
    px = role_vx[mask].astype(np.float64)
    pz = role_vz[mask].astype(np.float64)
    tx = truth_vx[mask].astype(np.float64)
    tz = truth_vz[mask].astype(np.float64)
    denom = float(np.sum(px * px + pz * pz))
    fit_gain = 0.0 if denom <= 1.0e-12 else float(np.sum(px * tx + pz * tz) / denom)
    gx = px * fit_gain
    gz = pz * fit_gain
    err_x = gx - tx
    err_z = gz - tz
    err_norm = np.sqrt(err_x * err_x + err_z * err_z)
    truth_norm = np.sqrt(tx * tx + tz * tz)
    pred_norm = np.sqrt(gx * gx + gz * gz)
    cosine = (gx * tx + gz * tz) / np.maximum(pred_norm * truth_norm, 1.0e-12)
    return {
        "fitGain": fit_gain,
        "supportPixelCount": int(np.count_nonzero(mask)),
        "vectorRmse": float(math.sqrt(float(np.mean(err_norm * err_norm)))) if err_norm.size else None,
        "vectorMae": float(np.mean(err_norm)) if err_norm.size else None,
        "meanVectorCosine": float(np.mean(cosine)) if cosine.size else None,
        "meanTruthVectorNorm": float(np.mean(truth_norm)) if truth_norm.size else None,
        "meanProxyVectorNormAfterGain": float(np.mean(pred_norm)) if pred_norm.size else None,
    }


def debug_correlation(role_rgb: np.ndarray, truth_rgb: np.ndarray, mask: np.ndarray) -> float | None:
    if not np.count_nonzero(mask):
        return None
    a = role_rgb[mask].reshape(-1).astype(np.float64)
    b = truth_rgb[mask].reshape(-1).astype(np.float64)
    if float(np.std(a)) <= 1.0e-12 or float(np.std(b)) <= 1.0e-12:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def debugDisplayGain(role_vx: np.ndarray, role_vz: np.ndarray, truth_vx: np.ndarray, truth_vz: np.ndarray, mask: np.ndarray, fit_gain: float) -> float:
    role_norm = np.sqrt(role_vx[mask].astype(np.float64) ** 2 + role_vz[mask].astype(np.float64) ** 2)
    truth_norm = np.sqrt(truth_vx[mask].astype(np.float64) ** 2 + truth_vz[mask].astype(np.float64) ** 2)
    role_p95 = float(np.quantile(role_norm, 0.95)) if role_norm.size else 0.0
    truth_p95 = float(np.quantile(truth_norm, 0.95)) if truth_norm.size else 0.0
    sign = -1.0 if fit_gain < 0.0 else 1.0
    if role_p95 <= 1.0e-12:
        return 0.0
    return float(sign * truth_p95 / role_p95)


def image_from_rgb(rgb: np.ndarray) -> np.ndarray:
    return np.asarray(np.round(np.clip(rgb, 0.0, 1.0)[::-1, :, :] * 255.0), dtype=np.uint8)


def write_contact_sheet(out_dir: Path, rows: list[tuple[str, np.ndarray]]) -> dict[str, Any]:
    row_h, width, _ = rows[0][1].shape
    label_h = 28
    gap = 6
    sheet_h = label_h + len(rows) * row_h + max(0, len(rows) - 1) * gap
    sheet = np.zeros((sheet_h, width, 3), dtype=np.uint8)
    labels = [_LABEL.draw_label(sheet, "scalar transport proxy", 8, 8, scale=2)]
    y = label_h
    for label, rgb in rows:
        sheet[y:y + row_h, :, :] = image_from_rgb(rgb)
        labels.append(_LABEL.draw_label(sheet, label, 8, y + 8, scale=2))
        y += row_h + gap
    path = out_dir / "scalar-derived-transport-proxy-contact.png"
    _LABEL.write_png_rgb(path, sheet)
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "visibleRasterLabels": {
            "identity": "burned-contact-sheet-labels-v0",
            "labels": labels,
        },
    }


def sidecar_receipt(frame: dict[str, Any]) -> dict[str, Any]:
    return {
        "manifest": frame["path"],
        "grid": int(frame["grid"]),
        "routeIdentity": frame["manifest"].get("routeIdentity"),
        "effectiveRoute": frame["manifest"].get("effectiveRoute"),
        "backend": frame["manifest"].get("backend"),
        "fluid": {
            "path": str(frame["fluidPath"]),
            "sha256": frame["fluidDescriptor"].get("sha256"),
            "byteLength": frame["fluidDescriptor"].get("byteLength"),
        },
        "front": {
            "path": str(frame["frontPath"]),
            "sha256": frame["frontDescriptor"].get("sha256"),
            "byteLength": frame["frontDescriptor"].get("byteLength"),
        },
    }


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = out_dir / "manifest.json"
    evidence: dict[str, Any] = {"args": vars(args)}
    try:
        motion_path = Path(args.motion_manifest).resolve()
        motion = read_json(motion_path)
        if motion.get("schema") != "kaminos.temporal-velocity-closure-motion.v0":
            raise TransportProxyFailure("manifest-read", "Motion manifest schema mismatch.", {"schema": motion.get("schema")})
        t0 = str(int(args.frame_t0))
        t1 = str(int(args.frame_t1))
        high_paths = motion.get("highManifests", {})
        low_paths = motion.get("lowManifests", {})
        if t0 not in high_paths or t1 not in high_paths or t0 not in low_paths or t1 not in low_paths:
            raise TransportProxyFailure("manifest-read", "Requested frame pair missing from motion manifest.", {
                "framePairIdentity": f"{t0}->{t1}",
                "availableHigh": sorted(high_paths.keys()),
                "availableLow": sorted(low_paths.keys()),
            })
        high0 = load_export(Path(high_paths[t0]))
        high1 = load_export(Path(high_paths[t1]))
        low0 = load_export(Path(low_paths[t0]))
        low1 = load_export(Path(low_paths[t1]))
        high_grid = int(high0["grid"])
        low_grid = int(low0["grid"])
        if high1["grid"] != high_grid or low1["grid"] != low_grid:
            raise TransportProxyFailure("manifest-read", "Frame pair grid mismatch.", {
                "high0": high_grid,
                "high1": high1["grid"],
                "low0": low_grid,
                "low1": low1["grid"],
            })
        slice_y = high_grid // 2 if args.slice_y is None else max(0, min(high_grid - 1, int(args.slice_y)))
        carriers = parse_carriers(args.carrier_channel_list)
        dt_seconds = (int(args.frame_t1) - int(args.frame_t0)) / 1000.0
        if dt_seconds <= 0:
            raise TransportProxyFailure("args", "frame-t1 must be greater than frame-t0.", {"frameT0": args.frame_t0, "frameT1": args.frame_t1})
        evidence.update({"framePairIdentity": f"{t0}->{t1}", "highGrid": high_grid, "lowGrid": low_grid, "sliceY": slice_y})

        high_indexes = high_slice_indexes(high_grid, slice_y)
        low_indexes = low_indexes_for_high_slice(high_grid, low_grid, slice_y)
        truth_vx, truth_vz = velocity_slice(high0, high_indexes, high_grid)
        low_vx, low_vz = velocity_slice(low0, low_indexes, high_grid)
        truth_debug = flow_debug_rgb(truth_vx, truth_vz)
        low_debug = flow_debug_rgb(low_vx, low_vz)

        roles: dict[str, Any] = {}
        c0_high, c1_high, high_norm = normalized_carrier_images(high0, high1, high_indexes, carriers, high_grid)
        mask, support_threshold = support_mask_from_carriers(c0_high, c1_high, float(args.support_quantile), float(args.support_scale))
        tvx, tvz, truth_solve = scalar_transport_proxy(c0_high, c1_high, dt_seconds, float(args.normal_regularization))
        truth_scalar_metrics = compare_vector(tvx, tvz, truth_vx, truth_vz, mask)
        truth_scalar_display_gain = debugDisplayGain(tvx, tvz, truth_vx, truth_vz, mask, truth_scalar_metrics["fitGain"])
        truth_scalar_debug = flow_debug_rgb(tvx * truth_scalar_display_gain, tvz * truth_scalar_display_gain)
        roles["truthHighScalarTransport"] = {
            "status": "captured",
            "transportSolve": truth_solve,
            "carrierNormalization": high_norm,
            "metrics": truth_scalar_metrics,
            "debugDisplayGain": truth_scalar_display_gain,
            "debugRgbCorrelation": debug_correlation(truth_scalar_debug, truth_debug, mask),
        }

        c0_low, c1_low, low_norm = normalized_carrier_images(low0, low1, low_indexes, carriers, high_grid)
        lvx, lvz, low_solve = scalar_transport_proxy(c0_low, c1_low, dt_seconds, float(args.normal_regularization))
        low_scalar_metrics = compare_vector(lvx, lvz, truth_vx, truth_vz, mask)
        low_scalar_display_gain = debugDisplayGain(lvx, lvz, truth_vx, truth_vz, mask, low_scalar_metrics["fitGain"])
        low_scalar_debug = flow_debug_rgb(lvx * low_scalar_display_gain, lvz * low_scalar_display_gain)
        roles["lowUpsampledScalarTransport"] = {
            "status": "captured",
            "transportSolve": low_solve,
            "carrierNormalization": low_norm,
            "metrics": low_scalar_metrics,
            "debugDisplayGain": low_scalar_display_gain,
            "debugRgbCorrelation": debug_correlation(low_scalar_debug, truth_debug, mask),
        }

        low_velocity_metrics = compare_vector(low_vx, low_vz, truth_vx, truth_vz, mask)
        roles["lowVelocityDebug"] = {
            "status": "captured",
            "metrics": low_velocity_metrics,
            "debugRgbCorrelation": debug_correlation(low_debug, truth_debug, mask),
        }
        roles["truthVelocityDebug"] = {
            "status": "reference",
            "metrics": compare_vector(truth_vx, truth_vz, truth_vx, truth_vz, mask),
            "debugRgbCorrelation": 1.0,
        }

        predicted_role = {"status": "notProvided", "reason": "Pass --predicted-t0-application-manifest and --predicted-t1-application-manifest to evaluate predictedHighScalarTransport."}
        predicted_debug = None
        if args.predicted_t0_application_manifest or args.predicted_t1_application_manifest:
            if not (args.predicted_t0_application_manifest and args.predicted_t1_application_manifest):
                raise TransportProxyFailure("args", "Both predicted frame application manifests are required for predictedHighScalarTransport.")
            pred0 = load_predicted_application(Path(args.predicted_t0_application_manifest).resolve(), high_grid)
            pred1 = load_predicted_application(Path(args.predicted_t1_application_manifest).resolve(), high_grid)
            c0_pred, c1_pred, pred_norm = normalized_carrier_images(pred0, pred1, high_indexes, carriers, high_grid)
            pvx, pvz, pred_solve = scalar_transport_proxy(c0_pred, c1_pred, dt_seconds, float(args.normal_regularization))
            pred_metrics = compare_vector(pvx, pvz, truth_vx, truth_vz, mask)
            pred_display_gain = debugDisplayGain(pvx, pvz, truth_vx, truth_vz, mask, pred_metrics["fitGain"])
            predicted_debug = flow_debug_rgb(pvx * pred_display_gain, pvz * pred_display_gain)
            predicted_role = {
                "status": "captured",
                "sourceManifests": {
                    "t0": str(Path(args.predicted_t0_application_manifest).resolve()),
                    "t1": str(Path(args.predicted_t1_application_manifest).resolve()),
                },
                "transportSolve": pred_solve,
                "carrierNormalization": pred_norm,
                "metrics": pred_metrics,
                "debugDisplayGain": pred_display_gain,
                "debugRgbCorrelation": debug_correlation(predicted_debug, truth_debug, mask),
            }
        roles["predictedHighScalarTransport"] = predicted_role

        contact_rows = [
            ("truthVelDbg", truth_debug),
            ("lowVelDbg", low_debug),
            ("truthScalTr", truth_scalar_debug),
            ("lowScalTr", low_scalar_debug),
        ]
        if predicted_debug is not None:
            contact_rows.append(("predScalTr", predicted_debug))
        contact = write_contact_sheet(out_dir, contact_rows)

        manifest = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": IDENTITY,
            "authority": "offline-slice-local-scalar-temporal-normal-flow-proxy-not-simulator-velocity-proof",
            "motionManifest": str(motion_path),
            "motionManifestSha256": sha256_file(motion_path),
            "framePairIdentity": f"{t0}->{t1}",
            "frameTimesMs": [int(args.frame_t0), int(args.frame_t1)],
            "sliceY": int(slice_y),
            "highGrid": high_grid,
            "lowGrid": low_grid,
            "routeIdentity": high0["manifest"].get("routeIdentity"),
            "effectiveRoute": high0["manifest"].get("effectiveRoute"),
            "carrierChannelList": carriers,
            "transportProxy": {
                "identity": SOLVE_IDENTITY,
                "equation": "for selected scalar carriers C, solve min_v sum_k (grad_x C_k * vx + grad_z C_k * vz + dC_k/dt)^2 + lambda ||v||^2 per slice pixel",
                "sliceAxes": {"x": "image horizontal", "z": "image vertical", "y": "fixed slice"},
                "normalRegularization": float(args.normal_regularization),
                "unitNote": "Proxy velocity units are carrier-change/pixel/time; metrics fit a scalar gain to truth high x/z velocity and record fitGain.",
                "supportMask": {
                    "identity": "truth-high-scalar-transport-support-mask-v0",
                    "supportQuantile": float(args.support_quantile),
                    "supportScale": float(args.support_scale),
                    "supportThreshold": float(support_threshold),
                    "supportPixelCount": int(np.count_nonzero(mask)),
                    "supportFraction": float(np.count_nonzero(mask) / mask.size),
                },
            },
            "roles": roles,
            "sourceFrames": {
                "highT0": sidecar_receipt(high0),
                "highT1": sidecar_receipt(high1),
                "lowT0": sidecar_receipt(low0),
                "lowT1": sidecar_receipt(low1),
            },
            "contactSheet": contact,
            "visibleRasterLabels": contact["visibleRasterLabels"],
            "limitations": [
                "This is a slice-local normal-flow proxy from scalar carrier changes, not a full 3D optical-flow solve.",
                "Truth high scalar transport is an oracle bridge test; predictedHighScalarTransport requires predicted frame application manifests.",
                "The fitted gain makes direction/structure comparable but does not prove simulator velocity units are recovered.",
            ],
        }
        write_json(manifest_path, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_path),
            "contactSheet": contact["path"],
            "framePairIdentity": manifest["framePairIdentity"],
            "summary": {
                key: {
                    "status": value.get("status"),
                    "meanVectorCosine": value.get("metrics", {}).get("meanVectorCosine"),
                    "vectorRmse": value.get("metrics", {}).get("vectorRmse"),
                    "debugRgbCorrelation": value.get("debugRgbCorrelation"),
                    "fitGain": value.get("metrics", {}).get("fitGain"),
                }
                for key, value in roles.items()
            },
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(manifest_path, "unknown", error, evidence)
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
