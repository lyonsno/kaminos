#!/usr/bin/env python3
"""Build compact field-derived input plane packs for Pyro RGB reconstruction.

This is an offline handoff artifact for the carrier-to-RGB decoder lane. It does
not train the decoder, drive the receiver, or claim frame-locked RGB truth.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import shutil
import struct
import sys
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.rgb-carrier-input-complement.v0"
PLANE_PACK_IDENTITY = "rgb-carrier-input-complement-plane-pack-v0"
PROJECTION_IDENTITY = "field-lattice-max-z-projection-summary-v0"
AUTHORITY = "offline-field-derived-decoder-input-complement-not-frame-locked-rgb-truth"

DEFAULT_SUPPORT_CANDIDATES = [
    "fusedAntiActivityFrazzleMax050",
    "fusedAntiActivityFrazzleMax070",
    "fusedAntiSoftActivityFrazzleGate035",
    "antiNonsensePredictedLearnedCue",
]

DEFAULT_FIRE_CHANNELS = [
    "heat",
    "flame",
    "visibleFireCarrier",
    "fireLick",
    "microdetail",
    "interfaceShred",
    "combustionFront",
    "emberFleck",
    "frontTopology",
]


class ComplementFailure(Exception):
    def __init__(self, failure_phase: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.failure_phase = failure_phase
        self.details = details or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, help="Output directory for manifest, packs, and previews.")
    parser.add_argument("--cue-manifest", help="Field-derived scalar cue comparator manifest with candidateCuePayloads.")
    parser.add_argument("--application-manifest", help="Full-grid residual application manifest with low/predicted sidecars.")
    parser.add_argument("--decoder-dataset-manifest", help="Pyro RGB reconstruction dataset manifest to inherit pair-authority and route identity.")
    parser.add_argument("--decoder-manifest", help="Pyro RGB reconstruction decoder manifest to inherit current failure surface.")
    parser.add_argument("--support-candidate", action="append", default=[], help="Cue candidate name to include in supportCuePack.")
    parser.add_argument("--fire-channel", action="append", default=[], help="Field channel to use in fireDetailResidualPack summaries.")
    parser.add_argument("--plane-size", type=int, default=64, help="Square 2D plane size for decoder-side first tests.")
    parser.add_argument("--source-note", default="", help="Optional human note about this handoff artifact.")
    return parser.parse_args()


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def read_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError as err:
        raise ComplementFailure("manifest-read", f"Missing manifest {path}", {"path": str(path)}) from err
    except json.JSONDecodeError as err:
        raise ComplementFailure("manifest-read", f"Invalid JSON manifest {path}", {"error": str(err)}) from err


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_descriptor(desc: dict[str, Any], base_dir: Path) -> Path:
    raw_path = desc.get("path")
    if not raw_path:
        raise ComplementFailure("source-verify", "Payload descriptor is missing path.", {"descriptor": desc})
    path = Path(raw_path)
    if not path.is_absolute():
        path = base_dir / path
    if not path.exists():
        raise ComplementFailure("source-verify", f"Payload path does not exist: {path}", {"descriptor": desc})
    expected_bytes = desc.get("byteLength")
    actual_bytes = path.stat().st_size
    if expected_bytes is not None and int(expected_bytes) != actual_bytes:
        raise ComplementFailure("source-verify", "Payload byte length mismatch.", {
            "path": str(path),
            "expectedByteLength": int(expected_bytes),
            "actualByteLength": actual_bytes,
        })
    expected_sha = desc.get("sha256")
    if expected_sha:
        actual_sha = sha256_file(path)
        if actual_sha != expected_sha:
            raise ComplementFailure("source-verify", "Payload checksum mismatch.", {
                "path": str(path),
                "expectedSha256": expected_sha,
                "actualSha256": actual_sha,
            })
    return path


def normalize_plane(plane: np.ndarray) -> tuple[np.ndarray, dict[str, Any]]:
    arr = np.asarray(plane, dtype=np.float32)
    finite = np.isfinite(arr)
    if not finite.all():
        arr = np.where(finite, arr, 0.0).astype(np.float32)
    p01 = float(np.quantile(arr, 0.01))
    p99 = float(np.quantile(arr, 0.99))
    mn = float(arr.min()) if arr.size else 0.0
    mx = float(arr.max()) if arr.size else 0.0
    if not math.isfinite(p99 - p01) or abs(p99 - p01) < 1e-8:
        out = np.zeros_like(arr, dtype=np.float32)
    else:
        out = np.clip((arr - p01) / (p99 - p01), 0.0, 1.0).astype(np.float32)
    return out, {
        "identity": "plane-quantile-01-99-normalization-v0",
        "min": mn,
        "max": mx,
        "p01": p01,
        "p99": p99,
        "mean": float(arr.mean()) if arr.size else 0.0,
    }


def resize_square_mean(plane: np.ndarray, size: int) -> np.ndarray:
    arr = np.asarray(plane, dtype=np.float32)
    if arr.ndim != 2:
        raise ComplementFailure("plane-resize", "Plane must be 2D.", {"shape": list(arr.shape)})
    h, w = arr.shape
    if h == size and w == size:
        return arr
    if h % size == 0 and w % size == 0:
        fy = h // size
        fx = w // size
        return arr.reshape(size, fy, size, fx).mean(axis=(1, 3)).astype(np.float32)
    y_idx = np.clip(np.round((np.arange(size) + 0.5) * h / size - 0.5).astype(np.int64), 0, h - 1)
    x_idx = np.clip(np.round((np.arange(size) + 0.5) * w / size - 0.5).astype(np.int64), 0, w - 1)
    return arr[np.ix_(y_idx, x_idx)].astype(np.float32)


def cube_to_plane(cube: np.ndarray, size: int) -> tuple[np.ndarray, dict[str, Any]]:
    arr = np.asarray(cube, dtype=np.float32)
    if arr.ndim != 3:
        raise ComplementFailure("plane-project", "Cue/source cube must be 3D.", {"shape": list(arr.shape)})
    projected = np.nanmax(arr, axis=2).astype(np.float32)
    resized = resize_square_mean(projected, size)
    norm, norm_meta = normalize_plane(resized)
    return norm, {
        "projectionIdentity": PROJECTION_IDENTITY,
        "sourceShape": list(arr.shape),
        "projectedShape": list(projected.shape),
        "decoderShape": [size, size],
        "normalization": norm_meta,
        "limitation": "2D max-over-z field-lattice summary; not camera-frame raymarch evidence and not frame-locked RGB truth.",
    }


def field_channel_plane(role: dict[str, Any], channel: str, size: int) -> tuple[np.ndarray, dict[str, Any]]:
    source = role.get("front") if channel == "frontTopology" else role.get("fluid")
    if not source:
        raise ComplementFailure("field-source", f"Role has no source for channel {channel}.", {"roleKeys": sorted(role.keys())})
    channel_order = source.get("channelOrder") or []
    if channel not in channel_order:
        raise ComplementFailure("field-source", f"Channel {channel} not present in source.", {"available": channel_order})
    path = verify_descriptor(source, Path("."))
    shape = source.get("shape")
    if not shape or len(shape) != 4:
        raise ComplementFailure("field-source", "Field sidecar source shape must be 4D.", {"source": source})
    arr = np.memmap(path, dtype="<f4", mode="r", shape=tuple(int(x) for x in shape))
    idx = channel_order.index(channel)
    plane, meta = cube_to_plane(arr[..., idx], size)
    meta.update({
        "sourcePath": str(path),
        "sourceSha256": source.get("sha256"),
        "sourceRoleChannel": channel,
        "sourceRoleShape": shape,
    })
    return plane, meta


def write_png_rgb(path: Path, rgb: np.ndarray) -> None:
    img = np.asarray(rgb, dtype=np.uint8)
    if img.ndim != 3 or img.shape[2] != 3:
        raise ComplementFailure("preview-write", "PNG payload must be uint8 RGB.", {"shape": list(img.shape)})
    h, w, _ = img.shape
    raw = b"".join(b"\x00" + img[y].tobytes() for y in range(h))

    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    data = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def write_plane(path: Path, plane: np.ndarray) -> dict[str, Any]:
    arr = np.asarray(plane, dtype="<f4")
    path.parent.mkdir(parents=True, exist_ok=True)
    arr.tofile(path)
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "shape": list(arr.shape),
        "floatCount": int(arr.size),
        "byteLength": int(path.stat().st_size),
    }


def heat_rgb(plane: np.ndarray) -> np.ndarray:
    p = np.clip(np.asarray(plane, dtype=np.float32), 0.0, 1.0)
    r = np.clip(p * 2.4, 0.0, 1.0)
    g = np.clip((p - 0.25) * 1.8, 0.0, 1.0)
    b = np.clip((p - 0.72) * 3.5, 0.0, 1.0)
    return (np.stack([r, g, b], axis=2) * 255.0 + 0.5).astype(np.uint8)


def write_pack(out_dir: Path, pack_name: str, planes: list[dict[str, Any]], expected_failure: str, falsification: str) -> dict[str, Any]:
    if not planes:
        raise ComplementFailure("pack-write", f"{pack_name} has no planes.", {"pack": pack_name})
    stack = np.stack([p["array"] for p in planes], axis=2).astype("<f4")
    pack_dir = out_dir / "plane-packs" / pack_name
    pack_path = pack_dir / f"{pack_name}.plane-pack.f32"
    pack_dir.mkdir(parents=True, exist_ok=True)
    stack.tofile(pack_path)

    previews = []
    for p in planes:
        preview_path = pack_dir / f"{p['name']}.png"
        write_png_rgb(preview_path, heat_rgb(p["array"]))
        previews.append({
            "name": p["name"],
            "path": str(preview_path),
            "sha256": sha256_file(preview_path),
            "previewAuthority": "heatmap-plane-preview-not-rgb-render",
        })
        p.pop("array", None)

    return {
        "identity": PLANE_PACK_IDENTITY,
        "packName": pack_name,
        "decoderLoadShape": [int(stack.shape[0]), int(stack.shape[1]), int(stack.shape[2])],
        "stackedPayload": {
            "path": str(pack_path),
            "sha256": sha256_file(pack_path),
            "dtype": "float32",
            "byteOrder": "little-endian",
            "shape": list(stack.shape),
            "floatCount": int(stack.size),
            "byteLength": int(pack_path.stat().st_size),
        },
        "planes": planes,
        "previews": previews,
        "expectedVisualFailureAttacked": expected_failure,
        "visualFalsificationCriteria": falsification,
        "loadingNote": "Append these planes beside lowCarrierInput features after resizing/cropping to the decoder sample lattice; do not treat projection axes as camera truth.",
    }


def source_digest(path: str | None) -> dict[str, Any] | None:
    if not path:
        return None
    p = Path(path)
    if not p.exists():
        return {"path": str(p), "status": "missing"}
    return {"path": str(p), "sha256": sha256_file(p)}


def support_pack(cue_manifest_path: Path | None, out_dir: Path, names: list[str], size: int) -> dict[str, Any] | None:
    if cue_manifest_path is None:
        return None
    manifest = read_json(cue_manifest_path)
    payloads = manifest.get("candidateCuePayloads") or manifest.get("cuePayloads") or {}
    planes = []
    for name in names:
        desc = payloads.get(name)
        if not desc:
            continue
        src_path = verify_descriptor(desc, cue_manifest_path.parent)
        shape = desc.get("shape")
        if not shape or len(shape) != 3 or len(set(int(x) for x in shape)) != 1:
            raise ComplementFailure("supportCuePack", "Support cue payload must be a cubic scalar f32 field.", {"name": name, "shape": shape})
        cube = np.memmap(src_path, dtype="<f4", mode="r", shape=tuple(int(x) for x in shape))
        plane, projection_meta = cube_to_plane(cube, size)
        copied = out_dir / "sources" / "supportCuePack" / f"{name}.source.f32"
        copied.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src_path, copied)
        planes.append({
            "name": name,
            "array": plane,
            "sourceKind": "candidateCuePayloads",
            "sourceManifest": str(cue_manifest_path),
            "sourcePayload": {
                "path": str(copied),
                "sha256": sha256_file(copied),
                "sourceSha256": desc.get("sha256"),
                "shape": shape,
                "authority": desc.get("authority") or manifest.get("authority"),
            },
            "projection": projection_meta,
            "roleHint": "support/trust plane for suppressing background haze and carrier-grid pollution.",
        })
    if not planes:
        return None
    return write_pack(
        out_dir,
        "supportCuePack",
        planes,
        "Background haze, grid ghosts, and over-broad decoder trust outside the fire/smoke body.",
        "Falsified if appended support planes reduce body brightness/detail, keep the same background grid ghosts, or only gate by the lowCarrierInput silhouette.",
    )


def fire_detail_pack(application_manifest_path: Path | None, out_dir: Path, channels: list[str], size: int) -> dict[str, Any] | None:
    if application_manifest_path is None:
        return None
    manifest = read_json(application_manifest_path)
    roles = manifest.get("roles") or {}
    low = roles.get("lowUpsampled")
    pred = roles.get("predictedHigh")
    if not low or not pred:
        raise ComplementFailure("fireDetailResidualPack", "Application manifest must contain lowUpsampled and predictedHigh roles.", {"roles": sorted(roles.keys())})

    predicted_planes: list[np.ndarray] = []
    residual_planes: list[np.ndarray] = []
    channel_meta = []
    for channel in channels:
        pred_plane, pred_meta = field_channel_plane(pred, channel, size)
        low_plane, _ = field_channel_plane(low, channel, size)
        residual = np.abs(pred_plane - low_plane).astype(np.float32)
        residual_norm, residual_norm_meta = normalize_plane(residual)
        predicted_planes.append(pred_plane)
        residual_planes.append(residual_norm)
        channel_meta.append({
            "channel": channel,
            "predictedProjection": pred_meta,
            "residualNormalization": residual_norm_meta,
        })

    predicted_max = np.max(np.stack(predicted_planes, axis=0), axis=0).astype(np.float32)
    residual_max = np.max(np.stack(residual_planes, axis=0), axis=0).astype(np.float32)
    core_names = {"heat", "flame", "visibleFireCarrier", "ember"}
    breakup_names = {"fireLick", "microdetail", "interfaceShred", "combustionFront", "frontTopology", "emberFleck"}
    core_planes = [p for p, c in zip(predicted_planes, channels, strict=False) if c in core_names]
    breakup_planes = [p for p, c in zip(predicted_planes, channels, strict=False) if c in breakup_names]
    core = np.max(np.stack(core_planes, axis=0), axis=0).astype(np.float32) if core_planes else predicted_max
    breakup = np.max(np.stack(breakup_planes, axis=0), axis=0).astype(np.float32) if breakup_planes else predicted_max

    planes = [
        {
            "name": "fireCoreAuthority",
            "array": core,
            "sourceKind": "predictedHigh field projection",
            "sourceManifest": str(application_manifest_path),
            "roleHint": "Where the RGB decoder should preserve or brighten compact lower fire body.",
        },
        {
            "name": "interfaceBreakupAuthority",
            "array": breakup,
            "sourceKind": "predictedHigh field projection",
            "sourceManifest": str(application_manifest_path),
            "roleHint": "Where the RGB decoder should recover high-frequency lick/interface detail without broad haze.",
        },
        {
            "name": "predictedVsLowResidualMagnitude",
            "array": residual_max,
            "sourceKind": "abs(predictedHigh - lowUpsampled) projection over selected channels",
            "sourceManifest": str(application_manifest_path),
            "roleHint": "Where the field model says low grid lacks structure; useful as a trust/attention cue, not as physical truth.",
        },
    ]
    pack = write_pack(
        out_dir,
        "fireDetailResidualPack",
        planes,
        "Missing compact bright fire core, weak flame-body contrast, and loss of interface/breakup detail.",
        "Falsified if the decoder remains a recolored debug carrier, increases vertical/grid texture, or smears the compact core into a broad amber column.",
    )
    pack["sourceChannels"] = channel_meta
    pack["applicationAuthority"] = manifest.get("applicationAuthority")
    pack["fieldAuthority"] = manifest.get("fieldAuthority")
    pack["sourcePairAuthority"] = manifest.get("applicationAuthority")
    return pack


def geometry_context_pack(out_dir: Path, size: int) -> dict[str, Any]:
    y = np.linspace(0.0, 1.0, size, dtype=np.float32)
    x = np.linspace(-1.0, 1.0, size, dtype=np.float32)
    xx, yy = np.meshgrid(x, y)
    radius = np.sqrt(xx * xx + (yy - 0.08) * (yy - 0.08)).astype(np.float32)
    radius, radius_meta = normalize_plane(radius)
    height = np.tile(y[:, None], (1, size)).astype(np.float32)
    center_weight = np.exp(-(xx * xx) / 0.20).astype(np.float32) * np.clip(1.0 - np.abs(yy - 0.38), 0.0, 1.0).astype(np.float32)
    center_weight, center_meta = normalize_plane(center_weight)
    planes = [
        {
            "name": "height01",
            "array": height,
            "sourceKind": "decoder-lattice-source-relative-coordinate",
            "normalization": {"identity": "unit-height-from-top-to-bottom-v0"},
            "roleHint": "Lets the decoder distinguish lower compact fire body from upper smoke without relearning pure coordinates.",
        },
        {
            "name": "sourceRelativeRadius",
            "array": radius,
            "sourceKind": "decoder-lattice-source-relative-coordinate",
            "normalization": radius_meta,
            "roleHint": "Cheap radial context for fire core versus plume shell decisions.",
        },
        {
            "name": "centralPlumePrior",
            "array": center_weight,
            "sourceKind": "decoder-lattice-source-relative-coordinate",
            "normalization": center_meta,
            "roleHint": "Weak control prior for compact body preservation; should not overpower field-derived support.",
        },
    ]
    pack = write_pack(
        out_dir,
        "geometryContextPack",
        planes,
        "Cross-resolution phase drift and height-dependent color/body mistakes.",
        "Falsified if these planes only improve metrics by washing outputs toward a generic vertical plume or reduce route-specific detail.",
    )
    pack["sourcePairAuthority"] = "procedural-decoder-lattice-context-not-field-truth"
    return pack


def write_index(out_dir: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for pack in manifest.get("candidateInputPacks", []):
        imgs = []
        for preview in pack.get("previews", []):
            rel = Path(preview["path"]).relative_to(out_dir)
            imgs.append(
                "<figure>"
                f"<img src='{html.escape(str(rel))}' alt='{html.escape(preview['name'])}'>"
                f"<figcaption>{html.escape(pack['packName'])}/{html.escape(preview['name'])}</figcaption>"
                "</figure>"
            )
        rows.append(
            "<section>"
            f"<h2>{html.escape(pack['packName'])}</h2>"
            f"<p><b>Load shape:</b> {html.escape(str(pack['decoderLoadShape']))}</p>"
            f"<p><b>Attacks:</b> {html.escape(pack['expectedVisualFailureAttacked'])}</p>"
            f"<p><b>Falsify:</b> {html.escape(pack['visualFalsificationCriteria'])}</p>"
            "<div class='grid'>" + "\n".join(imgs) + "</div>"
            "</section>"
        )
    body = f"""<!doctype html>
<meta charset="utf-8">
<title>RGB Carrier Input Complement</title>
<style>
body {{ margin: 20px; font-family: system-ui, sans-serif; color: #e8e8e8; background: #111; }}
code {{ color: #ffd27a; }}
section {{ border-top: 1px solid #333; padding-top: 16px; margin-top: 16px; }}
.grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }}
figure {{ margin: 0; background: #181818; border: 1px solid #333; padding: 8px; }}
img {{ width: 100%; image-rendering: pixelated; background: #000; }}
figcaption {{ font-size: 12px; color: #bbb; margin-top: 6px; overflow-wrap: anywhere; }}
</style>
<h1>RGB Carrier Input Complement</h1>
<p><b>Schema:</b> <code>{html.escape(manifest['schema'])}</code></p>
<p><b>Authority:</b> {html.escape(manifest['authority'])}</p>
<p><b>Boundary:</b> {html.escape(manifest['limitation'])}</p>
{''.join(rows)}
"""
    path = out_dir / "index.html"
    path.write_text(body)
    return {"path": str(path), "sha256": sha256_file(path), "identity": "rgb-carrier-input-complement-html-index-v0"}


def build_manifest(args: argparse.Namespace, out_dir: Path) -> dict[str, Any]:
    if args.plane_size <= 0:
        raise ComplementFailure("argument-parse", "Plane size must be positive.", {"planeSize": args.plane_size})
    cue_manifest = Path(args.cue_manifest) if args.cue_manifest else None
    application_manifest = Path(args.application_manifest) if args.application_manifest else None
    decoder_dataset_manifest = Path(args.decoder_dataset_manifest) if args.decoder_dataset_manifest else None
    decoder_manifest = Path(args.decoder_manifest) if args.decoder_manifest else None

    support_names = args.support_candidate or DEFAULT_SUPPORT_CANDIDATES
    fire_channels = args.fire_channel or DEFAULT_FIRE_CHANNELS
    packs = []
    support = support_pack(cue_manifest, out_dir, support_names, args.plane_size)
    if support:
        packs.append(support)
    fire = fire_detail_pack(application_manifest, out_dir, fire_channels, args.plane_size)
    if fire:
        packs.append(fire)
    packs.append(geometry_context_pack(out_dir, args.plane_size))

    if not packs:
        raise ComplementFailure("pack-write", "No candidate input packs were produced.", {})

    dataset = read_json(decoder_dataset_manifest) if decoder_dataset_manifest else None
    decoder = read_json(decoder_manifest) if decoder_manifest else None
    pair_authority = None
    source_route_identity = None
    if dataset:
        pair_authority = dataset.get("pairAuthority") or (dataset.get("dataset") or {}).get("pairAuthority")
        source_route_identity = dataset.get("routes") or (dataset.get("dataset") or {}).get("routes")
    if decoder:
        pair_authority = decoder.get("pairAuthority") or pair_authority
        source_route_identity = decoder.get("sourceRouteIdentity") or source_route_identity

    recommendations = [
        {
            "rank": 1,
            "packName": "supportCuePack",
            "recommendation": "Append fused Activity/Frazzle support planes first; they directly target background haze and grid ghosts while preserving body authority.",
            "decisionCriterion": "Keep if deterministic 64->64 reduces background/grid error without reducing compact fire-body brightness; reject if it behaves like a hard silhouette gate.",
        },
        {
            "rank": 2,
            "packName": "fireDetailResidualPack",
            "recommendation": "Test the reduced fire/detail/front residual pack next or alongside support; it is the candidate most likely to recover compact bright core and breakup detail.",
            "decisionCriterion": "Keep if bright core and interface detail improve without adding vertical texture; reject if it smears the body into a broad amber column.",
        },
    ]

    manifest = {
        "schema": SCHEMA,
        "identity": "rgb-carrier-input-complement-artifact-v0",
        "status": "captured",
        "createdAt": now_iso(),
        "failurePhase": None,
        "authority": AUTHORITY,
        "limitation": "Candidate planes are offline field/projection summaries for decoder experiments. They are not receiver actuation, not a decoder result, not frame-locked RGB truth, and not camera-raymarched physical evidence.",
        "sourcePairAuthority": pair_authority or "not-provided",
        "sourceRouteIdentity": source_route_identity,
        "sourceManifests": {
            "cueManifest": source_digest(args.cue_manifest),
            "applicationManifest": source_digest(args.application_manifest),
            "decoderDatasetManifest": source_digest(args.decoder_dataset_manifest),
            "decoderManifest": source_digest(args.decoder_manifest),
        },
        "planeSize": args.plane_size,
        "candidateInputPacks": packs,
        "firstRecommendations": recommendations,
        "nonGoals": [
            "Does not duplicate the receiver sweep.",
            "Does not fork or train the RGB decoder.",
            "Does not claim sequential captures are exact frame-locked supervision.",
            "Does not promote debug-flow carrier imagery to physical truth.",
        ],
        "sourceNote": args.source_note,
    }
    manifest["htmlIndex"] = write_index(out_dir, manifest)
    return manifest


def write_failure(out_dir: Path, err: ComplementFailure) -> None:
    write_json(out_dir / "manifest.json", {
        "schema": SCHEMA,
        "identity": "rgb-carrier-input-complement-artifact-v0",
        "status": "failed",
        "failurePhase": err.failure_phase,
        "authority": AUTHORITY,
        "error": str(err),
        "details": err.details,
        "createdAt": now_iso(),
    })


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        manifest = build_manifest(args, out_dir)
        write_json(out_dir / "manifest.json", manifest)
    except ComplementFailure as err:
        write_failure(out_dir, err)
        print(f"failed at {err.failure_phase}: {err}", file=sys.stderr)
        return 1
    print(out_dir / "manifest.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
