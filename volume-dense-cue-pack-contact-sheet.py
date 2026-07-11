#!/usr/bin/env python3
"""Write labeled visual contact sheets for dense learned sidecar cue packs."""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import math
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.dense-cue-pack-contact-sheet.v0"
IDENTITY = "dense-learned-sidecar-cue-contact-sheet-v0"
AUTHORITY = "offline-field-cue-visual-inspection-not-renderer-witness-not-product-claim"
SIDECAR_IDENTITY = "baked-boundary-sidecar-v1"
CHANNEL_ORDER = ["support", "coverage", "ridge", "footprint", "proximity", "normalX", "normalY", "normalZ"]
CONTACT_CHANNELS = ["support", "coverage", "ridge", "proximity"]
CLASSIFIER_CHANNELS = [
    "supportClassifierProbability",
    "coverageClassifierProbability",
    "ridgeClassifierProbability",
    "proximityClassifierProbability",
]


class ContactSheetFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def resolve_descriptor_path(desc: dict[str, Any], base_dir: Path) -> Path:
    raw = str(desc.get("path") or "")
    path = Path(raw)
    return path if path.is_absolute() else (base_dir / path).resolve()


def verify_descriptor(desc: dict[str, Any], base_dir: Path, role: str) -> Path:
    path = resolve_descriptor_path(desc, base_dir)
    if not path.exists():
        raise ContactSheetFailure("sidecar-read", f"{role} sidecar missing.", {"path": str(path)})
    expected_bytes = int(desc.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if expected_bytes and expected_bytes != actual_bytes:
        raise ContactSheetFailure("sidecar-validate", f"{role} byte length mismatch.", {
            "path": str(path),
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
        })
    expected_sha = desc.get("sha256")
    if expected_sha:
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            raise ContactSheetFailure("sidecar-validate", f"{role} checksum mismatch.", {
                "path": str(path),
                "expectedSha256": expected_sha,
                "actualSha256": actual_sha,
            })
    return path


def load_array(desc: dict[str, Any], base_dir: Path, role: str) -> np.memmap:
    path = verify_descriptor(desc, base_dir, role)
    shape = tuple(int(v) for v in desc.get("shape") or [])
    if not shape:
        raise ContactSheetFailure("descriptor-validate", f"{role} descriptor is missing shape.", {"descriptor": desc})
    dtype = np.dtype(str(desc.get("dtype") or "<f4"))
    return np.memmap(path, dtype=dtype, mode="r", shape=shape)


def load_split_boundary_sidecar(manifest_path: Path, role: str) -> tuple[np.memmap, np.memmap, dict[str, Any], dict[str, Any]]:
    manifest = read_json(manifest_path)
    boundary = manifest.get("boundarySidecar") or {}
    if boundary.get("identity") != SIDECAR_IDENTITY:
        raise ContactSheetFailure("manifest-validate", f"{role} sidecar identity mismatch.", {
            "path": str(manifest_path),
            "identity": boundary.get("identity"),
        })
    sidecars = boundary.get("sidecars") or {}
    side_desc = sidecars.get("boundary")
    meta_desc = sidecars.get("meta")
    if not side_desc or not meta_desc:
        raise ContactSheetFailure("manifest-validate", f"{role} split boundary/meta descriptors missing.", {"path": str(manifest_path)})
    side = load_array(side_desc, manifest_path.parent, f"{role}.boundary")
    meta = load_array(meta_desc, manifest_path.parent, f"{role}.meta")
    return side, meta, manifest, boundary


def high_values(side: np.ndarray, meta: np.ndarray) -> np.ndarray:
    side_arr = np.asarray(side)
    meta_arr = np.asarray(meta)
    if side_arr.ndim == 4:
        side_arr = side_arr.reshape((side_arr.shape[0] ** 3, int(side_arr.shape[-1])))
    if meta_arr.ndim == 4:
        meta_arr = meta_arr.reshape((meta_arr.shape[0] ** 3, int(meta_arr.shape[-1])))
    if side_arr.ndim != 2 or meta_arr.ndim != 2 or side_arr.shape[0] != meta_arr.shape[0]:
        raise ContactSheetFailure("shape-validate", "Truth boundary/meta sidecars must be compatible flat or grid-shaped arrays.", {
            "boundaryShape": list(np.asarray(side).shape),
            "metaShape": list(np.asarray(meta).shape),
        })
    return np.concatenate([side_arr, meta_arr], axis=1)


def low_to_high_nearest(low: np.ndarray, high_grid: int) -> np.ndarray:
    if low.ndim == 4:
        low_grid = int(low.shape[0])
        low_flat = np.asarray(low).reshape((low_grid ** 3, int(low.shape[-1])))
    elif low.ndim == 2:
        low_grid = int(round(low.shape[0] ** (1.0 / 3.0)))
        if low_grid ** 3 != low.shape[0]:
            raise ContactSheetFailure("shape-validate", "Low sidecar cell count is not a cubic grid.", {"cellCount": int(low.shape[0])})
        low_flat = np.asarray(low)
    else:
        raise ContactSheetFailure("shape-validate", "Low sidecar array must be flat or grid-shaped.", {"shape": list(low.shape)})
    z, y, x = np.indices((high_grid, high_grid, high_grid), dtype=np.float32)
    scale = float(low_grid) / float(high_grid)
    lx = np.clip(np.floor((x + 0.5) * scale), 0, low_grid - 1).astype(np.int64)
    ly = np.clip(np.floor((y + 0.5) * scale), 0, low_grid - 1).astype(np.int64)
    lz = np.clip(np.floor((z + 0.5) * scale), 0, low_grid - 1).astype(np.int64)
    low_indexes = lx + ly * low_grid + lz * low_grid * low_grid
    return low_flat[low_indexes.reshape(-1)].reshape((high_grid, high_grid, high_grid, low_flat.shape[1]))


def normalize_plane(plane: np.ndarray, clip_percentile: float = 99.2) -> np.ndarray:
    arr = np.asarray(plane, dtype=np.float32)
    arr = np.nan_to_num(arr, nan=0.0, posinf=0.0, neginf=0.0)
    lo = min(0.0, float(np.percentile(arr, 1.0)))
    hi = float(np.percentile(arr, clip_percentile))
    if not math.isfinite(hi) or hi <= lo:
        hi = float(np.max(arr))
    if not math.isfinite(hi) or hi <= lo:
        return np.zeros(arr.shape, dtype=np.uint8)
    return np.clip((arr - lo) / (hi - lo), 0.0, 1.0)


def colorize(norm: np.ndarray, palette: str) -> np.ndarray:
    n = np.asarray(norm, dtype=np.float32)
    if palette == "error":
        r = np.clip(n * 2.0, 0.0, 1.0)
        g = np.clip((n - 0.25) * 1.8, 0.0, 1.0)
        b = np.clip((n - 0.72) * 3.0, 0.0, 1.0)
    elif palette == "prob":
        r = np.clip((n - 0.35) * 1.8, 0.0, 1.0)
        g = np.clip(n * 1.15, 0.0, 1.0)
        b = np.clip(0.35 + n * 0.65, 0.0, 1.0)
    else:
        r = np.clip(n * 1.5, 0.0, 1.0)
        g = np.clip(n * 0.95 + np.sqrt(np.maximum(n, 0.0)) * 0.35, 0.0, 1.0)
        b = np.clip(n * 0.45, 0.0, 1.0)
    rgba = np.stack([r, g, b, np.ones_like(n)], axis=-1)
    return (rgba * 255).astype(np.uint8)


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return len(data).to_bytes(4, "big") + kind + data + zlib.crc32(kind + data).to_bytes(4, "big")


def write_rgba_png(path: Path, rgba: np.ndarray) -> None:
    height, width, channels = rgba.shape
    if channels != 4:
        raise ContactSheetFailure("png-write", "Expected RGBA image.", {"shape": list(rgba.shape)})
    raw_rows = []
    for y in range(height):
        raw_rows.append(b"\x00" + bytes(rgba[y].reshape(width * 4)))
    ihdr = (
        width.to_bytes(4, "big")
        + height.to_bytes(4, "big")
        + bytes([8, 6, 0, 0, 0])
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + png_chunk(b"IHDR", ihdr)
        + png_chunk(b"IDAT", zlib.compress(b"".join(raw_rows), level=6))
        + png_chunk(b"IEND", b"")
    )


def choose_slice_index(truth: np.ndarray, high_grid: int) -> int:
    ridge = np.asarray(truth[:, CHANNEL_ORDER.index("ridge")]).reshape((high_grid, high_grid, high_grid))
    proximity = np.asarray(truth[:, CHANNEL_ORDER.index("proximity")]).reshape((high_grid, high_grid, high_grid))
    energy = np.sum(np.abs(ridge), axis=(1, 2)) + 0.35 * np.sum(np.abs(proximity), axis=(1, 2))
    return int(np.argmax(energy))


def make_panel(volume: np.ndarray, channel_index: int, slice_index: int, projection: bool, palette: str, high_grid: int) -> np.ndarray:
    data = np.asarray(volume[..., channel_index], dtype=np.float32)
    if projection:
        plane = np.max(np.abs(data), axis=0)
    else:
        plane = data.reshape((high_grid, high_grid, high_grid))[slice_index, :, :]
    return colorize(normalize_plane(np.abs(plane), 99.4), palette)


def write_html_viewer(path: Path, report: dict[str, Any]) -> None:
    sections = []
    for image in report["images"]:
        rel = html.escape(Path(image["path"]).name)
        sections.append(
            f"<section><h2>{html.escape(image['title'])}</h2>"
            f"<p>{html.escape(image['caption'])}</p>"
            f"<img src=\"{rel}\" alt=\"{html.escape(image['title'])}\"></section>"
        )
    doc = f"""<!doctype html>
<meta charset="utf-8">
<title>Kaminos dense learned cue contact sheet</title>
<style>
body {{ margin: 24px; background: #08090a; color: #e8ecef; font: 14px/1.45 system-ui, sans-serif; }}
h1 {{ font-size: 22px; margin: 0 0 8px; }}
h2 {{ font-size: 16px; margin: 22px 0 6px; }}
p {{ color: #b8c1c8; max-width: 1100px; }}
code {{ color: #d6f3ff; }}
img {{ max-width: 100%; border: 1px solid #30353a; background: #000; }}
.meta {{ white-space: pre-wrap; border: 1px solid #30353a; padding: 12px; background: #111417; }}
</style>
<h1>Kaminos Dense Learned Cue Contact Sheet</h1>
<p><strong>Columns:</strong> truthHigh, lowInputUpsampled, scalarMlpCue, classifierProbabilityCues, absoluteScalarError, absoluteLowError. <strong>Rows:</strong> support, coverage, ridge, proximity. This is an offline field-cue inspection sheet, not a renderer witness.</p>
<p><code>{html.escape(report['denseCuePackManifest'])}</code></p>
{''.join(sections)}
<h2>Manifest</h2>
<pre class="meta">{html.escape(json.dumps(report, indent=2))}</pre>
"""
    path.write_text(doc)


def assemble_contact_sheet(images: list[list[np.ndarray]], gap: int = 8) -> np.ndarray:
    rows = len(images)
    cols = len(images[0])
    h, w, _ = images[0][0].shape
    out = np.zeros((rows * h + (rows - 1) * gap, cols * w + (cols - 1) * gap, 4), dtype=np.uint8)
    out[..., 3] = 255
    for r, row in enumerate(images):
        for c, img in enumerate(row):
            y = r * (h + gap)
            x = c * (w + gap)
            out[y:y + h, x:x + w] = img
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dense-cue-pack-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--out", default="")
    parser.add_argument("--slice-index", default="auto")
    parser.add_argument("--projection-axis", default="z-max", choices=["z-max"])
    args = parser.parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_path = Path(args.out).resolve() if args.out else out_dir / "manifest.json"
    phase = "start"
    evidence: dict[str, Any] = {}
    try:
        phase = "manifest-read"
        dense_manifest_path = Path(args.dense_cue_pack_manifest).resolve()
        dense = read_json(dense_manifest_path)
        if dense.get("schema") != "kaminos.volume.learned-sparse-cue-pack.v0" or dense.get("status") != "captured":
            raise ContactSheetFailure("manifest-validate", "Dense cue pack schema/status mismatch.", {
                "schema": dense.get("schema"),
                "status": dense.get("status"),
            })
        corpus_path = Path(str((dense.get("source") or {}).get("corpusManifest") or "")).resolve()
        corpus = read_json(corpus_path)
        truth_manifest = Path(str((((corpus.get("truthHighTarget") or {}).get("boundarySidecar") or {}).get("manifest") or ""))).resolve()
        truth_side, truth_meta, truth_source, truth_boundary = load_split_boundary_sidecar(truth_manifest, "truthHigh")
        low_desc = (((corpus.get("downsampledHighInput") or {}).get("sidecars") or {}).get("boundary"))
        if not low_desc:
            raise ContactSheetFailure("manifest-validate", "Corpus missing downsampled-high boundary input.", {"corpusManifest": str(corpus_path)})
        low = load_array(low_desc, corpus_path.parent, "lowInput")
        arrays = dense.get("arrays") or {}
        scalar = load_array(arrays.get("scalarMlpCue") or {}, dense_manifest_path.parent, "scalarMlpCue")
        classifier = load_array(arrays.get("classifierProbabilityCues") or {}, dense_manifest_path.parent, "classifierProbabilityCues")
        high_grid = int((dense.get("grid") or {}).get("highGrid") or truth_source.get("grid") or 0)
        low_grid = int((dense.get("grid") or {}).get("lowGrid") or low_desc["shape"][0])
        if high_grid <= 0 or low_grid <= 0:
            raise ContactSheetFailure("shape-validate", "Dense cue pack grid metadata missing.", {"grid": dense.get("grid")})
        truth = high_values(truth_side, truth_meta)
        truth_grid = truth.reshape((high_grid, high_grid, high_grid, len(CHANNEL_ORDER)))
        low_high = low_to_high_nearest(np.asarray(low), high_grid)
        scalar_grid = np.asarray(scalar).reshape((high_grid, high_grid, high_grid, len(CONTACT_CHANNELS)))
        classifier_grid = np.asarray(classifier).reshape((high_grid, high_grid, high_grid, len(CLASSIFIER_CHANNELS)))
        slice_index = choose_slice_index(truth, high_grid) if args.slice_index == "auto" else int(args.slice_index)
        evidence.update({
            "denseCuePackManifest": str(dense_manifest_path),
            "corpusManifest": str(corpus_path),
            "truthManifest": str(truth_manifest),
            "highGrid": high_grid,
            "lowGrid": low_grid,
            "sliceIndex": slice_index,
        })

        out_dir.mkdir(parents=True, exist_ok=True)
        images: list[dict[str, Any]] = []
        for projection in (False, True):
            rows = []
            for channel in CONTACT_CHANNELS:
                truth_index = CHANNEL_ORDER.index(channel)
                scalar_index = CONTACT_CHANNELS.index(channel)
                classifier_index = CLASSIFIER_CHANNELS.index(f"{channel}ClassifierProbability")
                truth_field = truth_grid
                low_field = low_high
                scalar_field = scalar_grid
                classifier_field = classifier_grid
                scalar_error = np.abs(scalar_grid[..., scalar_index] - truth_grid[..., truth_index])[..., None]
                low_error = np.abs(low_high[..., truth_index] - truth_grid[..., truth_index])[..., None]
                rows.append([
                    make_panel(truth_field, truth_index, slice_index, projection, "field", high_grid),
                    make_panel(low_field, truth_index, slice_index, projection, "field", high_grid),
                    make_panel(scalar_field, scalar_index, slice_index, projection, "field", high_grid),
                    make_panel(classifier_field, classifier_index, slice_index, projection, "prob", high_grid),
                    make_panel(scalar_error, 0, slice_index, projection, "error", high_grid),
                    make_panel(low_error, 0, slice_index, projection, "error", high_grid),
                ])
            sheet = assemble_contact_sheet(rows)
            kind = "projection" if projection else f"slice-z{slice_index:03d}"
            image_path = out_dir / f"dense-cue-contact-{kind}.png"
            write_rgba_png(image_path, sheet)
            images.append({
                "title": f"{kind} dense cue contact sheet",
                "path": str(image_path),
                "sha256": sha256_file(image_path),
                "byteLength": image_path.stat().st_size,
                "caption": "Rows are support, coverage, ridge, proximity. Columns are truthHigh, lowInputUpsampled, scalarMlpCue, classifierProbabilityCues, absoluteScalarError, absoluteLowError.",
            })
        report = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "captured",
            "failurePhase": None,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "denseCuePackManifest": str(dense_manifest_path),
            "corpusManifest": str(corpus_path),
            "truthHigh": {
                "manifest": str(truth_manifest),
                "sidecarIdentity": truth_boundary.get("identity"),
                "sidecarAuthority": truth_boundary.get("authority"),
            },
            "lowInputUpsampled": {
                "source": "downsampled-high boundary sidecar input nearest-mapped into high-grid space",
                "lowGrid": low_grid,
                "highGrid": high_grid,
                "coordinateMapping": (dense.get("grid") or {}).get("coordinateMapping"),
            },
            "scalarMlpCue": arrays.get("scalarMlpCue"),
            "classifierProbabilityCues": arrays.get("classifierProbabilityCues"),
            "absoluteScalarError": "abs(scalarMlpCue - truthHigh) by selected channel",
            "absoluteLowError": "abs(lowInputUpsampled - truthHigh) by selected channel",
            "visual": {
                "channelRows": CONTACT_CHANNELS,
                "columns": ["truthHigh", "lowInputUpsampled", "scalarMlpCue", "classifierProbabilityCues", "absoluteScalarError", "absoluteLowError"],
                "sliceIndex": slice_index,
                "projectionAxis": args.projection_axis,
            },
            "images": images,
            "nonGoals": [
                "not a browser/WebGPU renderer witness",
                "not a native-low deployment proof",
                "not product-facing visual closure",
            ],
        }
        viewer_path = out_dir / "index.html"
        report["htmlViewer"] = str(viewer_path)
        report["htmlViewerSha256"] = None
        phase = "html-write"
        write_html_viewer(viewer_path, report)
        report["htmlViewerSha256"] = sha256_file(viewer_path)
        phase = "manifest-write"
        write_json(out_path, report)
        print(json.dumps({"ok": True, "manifest": str(out_path), "html": str(viewer_path), "images": [image["path"] for image in images]}, indent=2))
        return 0
    except ContactSheetFailure as err:
        failure = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failure",
            "failurePhase": err.phase,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "message": str(err),
            "evidence": {**evidence, **err.evidence},
        }
        write_json(out_path, failure)
        print(json.dumps(failure, indent=2), file=sys.stderr)
        return 2
    except Exception as err:
        failure = {
            "schema": SCHEMA,
            "identity": IDENTITY,
            "status": "failure",
            "failurePhase": phase,
            "capturedAt": now_iso(),
            "authority": AUTHORITY,
            "message": str(err),
            "evidence": evidence,
        }
        write_json(out_path, failure)
        print(json.dumps(failure, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
