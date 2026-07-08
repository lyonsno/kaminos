#!/usr/bin/env python3
"""Train a tiny render-space alpha cleanup model from aligned full-grid render PNGs."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.render-rgb-alpha-cleanup.v0"
IDENTITY = "render-space-alpha-trust-cleanup-v0"
ORACLE_ALPHA_IDENTITY = "oracle-alpha-projection-from-truth-v0"
FEATURE_IDENTITY = "local-neighborhood-rgb-alpha-features-v0"
MODEL_IDENTITY = "ridge-local-rgb-alpha-v0"
LIMITATION = "same-render-frame-rgb-alpha-diagnostic-not-generative-upscaling"

LABEL_FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
    "6": ["01111", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "11110"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
}


class CleanupFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--render-manifest", required=True, help="Full-grid render-still manifest with truth/low/predicted role PNGs.")
    parser.add_argument("--predicted-role", default="predictedAll", help="Predicted render role to clean.")
    parser.add_argument("--out-dir", required=True, help="Output directory.")
    parser.add_argument("--out", help="Output manifest path. Defaults to <out-dir>/manifest.json.")
    parser.add_argument("--neighborhood-radius", type=int, default=1, help="Local RGB neighborhood radius.")
    parser.add_argument("--train-samples", type=int, default=30000, help="Random pixels used to fit alpha model.")
    parser.add_argument("--test-samples", type=int, default=30000, help="Random pixels used to report alpha/RGB metrics.")
    parser.add_argument("--ridge", type=float, default=1.0e-3, help="Ridge regularization.")
    parser.add_argument("--seed", type=int, default=7307, help="Deterministic sample seed.")
    return parser.parse_args()


def utc_now() -> str:
    return np.datetime64("now", "s").astype(str) + "Z"


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


def png_chunk(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)


def paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa = abs(p - a)
    pb = abs(p - b)
    pc = abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def read_png_rgba(path: Path) -> np.ndarray:
    data = path.read_bytes()
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise CleanupFailure("image-read", "PNG signature mismatch.", {"path": str(path)})
    offset = 8
    width = height = None
    color_type = None
    bit_depth = None
    idat = bytearray()
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        offset += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filter_method, interlace = struct.unpack(">IIBBBBB", payload)
            if bit_depth != 8 or color_type not in (2, 6) or compression != 0 or filter_method != 0 or interlace != 0:
                raise CleanupFailure("image-read", "Unsupported PNG encoding.", {
                    "path": str(path),
                    "bitDepth": bit_depth,
                    "colorType": color_type,
                    "interlace": interlace,
                })
        elif kind == b"IDAT":
            idat.extend(payload)
        elif kind == b"IEND":
            break
    if width is None or height is None or color_type is None:
        raise CleanupFailure("image-read", "PNG missing IHDR.", {"path": str(path)})
    channels = 4 if color_type == 6 else 3
    bpp = channels
    raw = zlib.decompress(bytes(idat))
    stride = width * channels
    rows = np.zeros((height, stride), dtype=np.uint8)
    pos = 0
    prev = np.zeros(stride, dtype=np.uint8)
    for y in range(height):
        filter_type = raw[pos]
        pos += 1
        row = np.frombuffer(raw[pos:pos + stride], dtype=np.uint8).copy()
        pos += stride
        recon = row.copy()
        for x in range(stride):
            left = int(recon[x - bpp]) if x >= bpp else 0
            up = int(prev[x])
            up_left = int(prev[x - bpp]) if x >= bpp else 0
            if filter_type == 1:
                recon[x] = (int(row[x]) + left) & 0xFF
            elif filter_type == 2:
                recon[x] = (int(row[x]) + up) & 0xFF
            elif filter_type == 3:
                recon[x] = (int(row[x]) + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                recon[x] = (int(row[x]) + paeth(left, up, up_left)) & 0xFF
            elif filter_type != 0:
                raise CleanupFailure("image-read", "Unsupported PNG row filter.", {"path": str(path), "filter": int(filter_type)})
        rows[y] = recon
        prev = recon
    rgba = rows.reshape(height, width, channels)
    if channels == 3:
        alpha = np.full((height, width, 1), 255, dtype=np.uint8)
        rgba = np.concatenate([rgba, alpha], axis=2)
    return rgba


def write_png_rgba(path: Path, rgba: np.ndarray) -> None:
    if rgba.dtype != np.uint8 or rgba.ndim != 3 or rgba.shape[2] != 4:
        raise CleanupFailure("image-write", "PNG output must be uint8 RGBA.", {"shape": list(rgba.shape), "dtype": str(rgba.dtype)})
    height, width, _ = rgba.shape
    rows = b"".join(b"\x00" + rgba[y].tobytes() for y in range(height))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"".join([
        b"\x89PNG\r\n\x1a\n",
        png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)),
        png_chunk(b"IDAT", zlib.compress(rows, level=6)),
        png_chunk(b"IEND", b""),
    ]))


def rgba_from_rgb_float(rgb: np.ndarray) -> np.ndarray:
    clipped = np.clip(rgb, 0.0, 1.0)
    alpha = np.ones((*clipped.shape[:2], 1), dtype=np.float32)
    return np.asarray(np.round(np.concatenate([clipped, alpha], axis=2) * 255.0), dtype=np.uint8)


def rgba_from_gray(values: np.ndarray) -> np.ndarray:
    gray = np.asarray(np.round(np.clip(values, 0.0, 1.0) * 255.0), dtype=np.uint8)
    return np.stack([gray, gray, gray, np.full_like(gray, 255)], axis=2)


def role_output(render_manifest: dict[str, Any], role: str) -> dict[str, Any]:
    for output in render_manifest.get("outputs", []):
        if output.get("role") == role:
            return output
    raise CleanupFailure("manifest-read", "Render manifest missing required role.", {"role": role})


def draw_rect(rgba: np.ndarray, x: int, y: int, w: int, h: int, color: tuple[int, int, int, int]) -> None:
    height, width, _ = rgba.shape
    x0 = max(0, int(x))
    y0 = max(0, int(y))
    x1 = min(width, x0 + max(0, int(w)))
    y1 = min(height, y0 + max(0, int(h)))
    if x1 > x0 and y1 > y0:
        rgba[y0:y1, x0:x1, :] = np.asarray(color, dtype=np.uint8)


def draw_label(rgba: np.ndarray, text: str, x: int, y: int, scale: int = 2) -> dict[str, Any]:
    cursor = int(x)
    text_upper = str(text).upper()
    for char in text_upper:
        if char == " ":
            cursor += 4 * scale
            continue
        glyph = LABEL_FONT.get(char, LABEL_FONT["-"])
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit != "1":
                    continue
                draw_rect(rgba, cursor + gx * scale + 1, y + gy * scale + 1, scale, scale, (0, 0, 0, 255))
                draw_rect(rgba, cursor + gx * scale, y + gy * scale, scale, scale, (232, 244, 244, 255))
        cursor += 6 * scale
    return {"text": text, "x": int(x), "y": int(y), "scale": int(scale)}


def contact_sheet(frames: list[tuple[str, str, np.ndarray]], out_path: Path) -> dict[str, Any]:
    frame_h, frame_w, _ = frames[0][2].shape
    label_h = 24
    sheet = np.zeros((frame_h + label_h, frame_w * len(frames), 4), dtype=np.uint8)
    sheet[:, :, 3] = 255
    labels = []
    for index, (role, display_label, rgba) in enumerate(frames):
        x = index * frame_w
        sheet[label_h:label_h + frame_h, x:x + frame_w, :] = rgba
        label = draw_label(sheet, display_label, x + 8, 6, 2)
        label["role"] = role
        label["displayLabel"] = display_label
        labels.append(label)
    write_png_rgba(out_path, sheet)
    return {
        "path": str(out_path),
        "sha256": sha256_file(out_path),
        "columnOrder": [role for role, _, _ in frames],
        "visibleRasterLabels": {
            "identity": "visible-raster-role-labels-v0",
            "columnLabels": labels,
        },
    }


def image_metrics(candidate: np.ndarray, truth: np.ndarray, truth_signal_threshold: float = 0.08) -> dict[str, Any]:
    error = candidate - truth
    mse = float(np.mean(np.square(error)))
    mask = np.max(truth, axis=2) > truth_signal_threshold
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(math.sqrt(mse)),
        "maskedMae": float(np.mean(np.abs(error[mask]))) if np.any(mask) else None,
        "truthSignalMaskThreshold": truth_signal_threshold,
        "truthSignalPixelCount": int(np.count_nonzero(mask)),
    }


def oracle_alpha(low: np.ndarray, pred: np.ndarray, truth: np.ndarray) -> np.ndarray:
    delta = pred - low
    target = truth - low
    denom = np.sum(delta * delta, axis=2)
    numer = np.sum(target * delta, axis=2)
    alpha = np.zeros_like(denom, dtype=np.float32)
    valid = denom > 1.0e-8
    alpha[valid] = numer[valid] / denom[valid]
    return np.clip(alpha, 0.0, 1.0).astype(np.float32)


def feature_matrix(low: np.ndarray, pred: np.ndarray, indexes: np.ndarray, radius: int) -> np.ndarray:
    height, width, _ = low.shape
    y = indexes // width
    x = indexes % width
    source = np.concatenate([low, pred, pred - low], axis=2)
    padded = np.pad(source, ((radius, radius), (radius, radius), (0, 0)), mode="edge")
    features = []
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            features.append(padded[y + radius + dy, x + radius + dx, :])
    coords = np.stack([
        x.astype(np.float32) / max(1, width - 1),
        y.astype(np.float32) / max(1, height - 1),
    ], axis=1)
    features.append(coords)
    return np.concatenate(features, axis=1).astype(np.float32)


def fit_ridge_alpha(features: np.ndarray, target: np.ndarray, ridge: float) -> np.ndarray:
    x = np.concatenate([features, np.ones((features.shape[0], 1), dtype=np.float32)], axis=1).astype(np.float64)
    y = target.astype(np.float64)
    xtx = x.T @ x
    reg = np.eye(xtx.shape[0], dtype=np.float64) * float(ridge)
    reg[-1, -1] = 0.0
    xty = x.T @ y
    return np.linalg.solve(xtx + reg, xty).astype(np.float32)


def predict_alpha(features: np.ndarray, weights: np.ndarray) -> np.ndarray:
    x = np.concatenate([features, np.ones((features.shape[0], 1), dtype=np.float32)], axis=1)
    return np.clip(x @ weights, 0.0, 1.0).astype(np.float32)


def write_failure(path: Path, phase: str, message: str, evidence: dict[str, Any]) -> None:
    write_json(path, {
        "schema": SCHEMA,
        "identity": IDENTITY,
        "status": "failed",
        "createdAt": utc_now(),
        "failurePhase": phase,
        "error": message,
        "lastTrustworthyEvidence": evidence,
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    manifest_out = Path(args.out).resolve() if args.out else out_dir / "manifest.json"
    phase = "args"
    evidence: dict[str, Any] = {}
    try:
        phase = "manifest-read"
        render_manifest_path = Path(args.render_manifest).resolve()
        render_manifest = read_json(render_manifest_path)
        truth_output = role_output(render_manifest, "truthHigh")
        low_output = role_output(render_manifest, "lowUpsampled")
        pred_output = role_output(render_manifest, args.predicted_role)
        evidence = {
            "renderManifest": str(render_manifest_path),
            "predictedRole": args.predicted_role,
        }
        phase = "image-read"
        truth_path = Path(truth_output["path"]).resolve()
        low_path = Path(low_output["path"]).resolve()
        pred_path = Path(pred_output["path"]).resolve()
        truth_rgba = read_png_rgba(truth_path)
        low_rgba = read_png_rgba(low_path)
        pred_rgba = read_png_rgba(pred_path)
        if truth_rgba.shape != low_rgba.shape or truth_rgba.shape != pred_rgba.shape:
            raise CleanupFailure("shape-validate", "Input PNG shapes do not match.", {
                "truthShape": list(truth_rgba.shape),
                "lowShape": list(low_rgba.shape),
                "predShape": list(pred_rgba.shape),
            })
        truth = truth_rgba[:, :, :3].astype(np.float32) / 255.0
        low = low_rgba[:, :, :3].astype(np.float32) / 255.0
        pred = pred_rgba[:, :, :3].astype(np.float32) / 255.0
        height, width, _ = truth.shape
        pixel_count = height * width

        phase = "oracle-alpha"
        oracle = oracle_alpha(low, pred, truth)
        oracle_blend = low + oracle[:, :, None] * (pred - low)

        phase = "model-fit"
        rng = np.random.default_rng(int(args.seed))
        all_indexes = np.arange(pixel_count, dtype=np.int64)
        train_count = min(pixel_count, max(1, int(args.train_samples)))
        test_count = min(pixel_count, max(1, int(args.test_samples)))
        train_indexes = rng.choice(all_indexes, size=train_count, replace=False)
        test_indexes = rng.choice(all_indexes, size=test_count, replace=False)
        radius = max(0, int(args.neighborhood_radius))
        train_features = feature_matrix(low, pred, train_indexes, radius)
        weights = fit_ridge_alpha(train_features, oracle.reshape(-1)[train_indexes], float(args.ridge))
        test_features = feature_matrix(low, pred, test_indexes, radius)
        test_alpha = predict_alpha(test_features, weights)
        test_oracle = oracle.reshape(-1)[test_indexes]

        phase = "model-apply"
        predicted_flat = np.zeros(pixel_count, dtype=np.float32)
        chunk = 65536
        for start in range(0, pixel_count, chunk):
            end = min(pixel_count, start + chunk)
            indexes = all_indexes[start:end]
            predicted_flat[start:end] = predict_alpha(feature_matrix(low, pred, indexes, radius), weights)
        predicted_alpha = predicted_flat.reshape(height, width)
        cleaned = low + predicted_alpha[:, :, None] * (pred - low)

        phase = "write-images"
        out_dir.mkdir(parents=True, exist_ok=True)
        oracle_alpha_path = out_dir / "oracleAlphaMap.png"
        predicted_alpha_path = out_dir / "predictedAlphaMap.png"
        oracle_blend_path = out_dir / "oracleAlphaBlend.png"
        cleaned_path = out_dir / "rgbAlphaCleaned.png"
        write_png_rgba(oracle_alpha_path, rgba_from_gray(oracle))
        write_png_rgba(predicted_alpha_path, rgba_from_gray(predicted_alpha))
        write_png_rgba(oracle_blend_path, rgba_from_rgb_float(oracle_blend))
        write_png_rgba(cleaned_path, rgba_from_rgb_float(cleaned))
        sheet = contact_sheet([
            ("truthHigh", "truth", truth_rgba),
            ("lowUpsampled", "low", low_rgba),
            (args.predicted_role, "pred", pred_rgba),
            ("oracleAlphaBlend", "oracleBlend", rgba_from_rgb_float(oracle_blend)),
            ("rgbAlphaCleaned", "rgbClean", rgba_from_rgb_float(cleaned)),
            ("predictedAlphaMap", "alphaMap", rgba_from_gray(predicted_alpha)),
        ], out_dir / "contactSheet.png")

        alpha_error = test_alpha - test_oracle
        alpha_mse = float(np.mean(np.square(alpha_error)))
        render_metrics = {
            "lowUpsampled": image_metrics(low, truth),
            args.predicted_role: image_metrics(pred, truth),
            "oracleAlphaBlend": image_metrics(oracle_blend, truth),
            "rgbAlphaCleaned": image_metrics(cleaned, truth),
        }
        phase = "write-report"
        manifest = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "createdAt": utc_now(),
            "failurePhase": None,
            "renderManifest": str(render_manifest_path),
            "renderManifestSha256": sha256_file(render_manifest_path),
            "predictedRole": args.predicted_role,
            "limitation": LIMITATION,
            "oracleAlpha": {
                "identity": ORACLE_ALPHA_IDENTITY,
                "formula": "clip(dot(truthHigh-lowUpsampled, predicted-lowUpsampled) / dot(predicted-lowUpsampled, predicted-lowUpsampled), 0, 1)",
                "sourceTruthRole": "truthHigh",
                "sourceLowRole": "lowUpsampled",
                "sourcePredictedRole": args.predicted_role,
                "alphaMean": float(np.mean(oracle)),
                "alphaP95": float(np.quantile(oracle, 0.95)),
                "alphaZeroFraction": float(np.mean(oracle <= 1.0e-6)),
                "alphaOneFraction": float(np.mean(oracle >= 1.0 - 1.0e-6)),
            },
            "model": {
                "identity": MODEL_IDENTITY,
                "featureIdentity": FEATURE_IDENTITY,
                "neighborhoodRadius": radius,
                "trainSamples": int(train_count),
                "testSamples": int(test_count),
                "ridge": float(args.ridge),
                "seed": int(args.seed),
                "featureCount": int(train_features.shape[1]),
                "weightCount": int(weights.shape[0]),
            },
            "alphaMetrics": {
                "alphaRmse": float(math.sqrt(alpha_mse)),
                "alphaMae": float(np.mean(np.abs(alpha_error))),
                "predictedAlphaMean": float(np.mean(predicted_alpha)),
                "predictedAlphaP95": float(np.quantile(predicted_alpha, 0.95)),
            },
            "renderComparisonMetrics": render_metrics,
            "sourceImages": {
                "truthHigh": {"path": str(truth_path), "sha256": sha256_file(truth_path)},
                "lowUpsampled": {"path": str(low_path), "sha256": sha256_file(low_path)},
                args.predicted_role: {"path": str(pred_path), "sha256": sha256_file(pred_path)},
            },
            "outputs": {
                "oracleAlphaMap": {"path": str(oracle_alpha_path), "sha256": sha256_file(oracle_alpha_path)},
                "predictedAlphaMap": {"path": str(predicted_alpha_path), "sha256": sha256_file(predicted_alpha_path)},
                "oracleAlphaBlend": {"path": str(oracle_blend_path), "sha256": sha256_file(oracle_blend_path)},
                "rgbAlphaCleaned": {"path": str(cleaned_path), "sha256": sha256_file(cleaned_path)},
                "contactSheet": sheet,
            },
        }
        write_json(manifest_out, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_out),
            "contactSheet": sheet["path"],
            "rgbAlphaCleaned": str(cleaned_path),
            "alphaRmse": manifest["alphaMetrics"]["alphaRmse"],
        }, indent=2))
        return 0
    except CleanupFailure as error:
        write_failure(manifest_out, error.phase, str(error), error.evidence or evidence)
        print(f"{error.phase}: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # noqa: BLE001
        write_failure(manifest_out, phase, str(error), evidence)
        raise


if __name__ == "__main__":
    raise SystemExit(main())
