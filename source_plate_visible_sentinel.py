"""Deterministic native-square visible-authority sentinel production.

The synthetic source is intentionally simple and pixel-falsifiable.  Descriptor
roles are useful upstream metadata, but only the separately recorded visible
ledger may adjudicate projection retention.
"""

from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import html
import json
import math
import struct
import zlib
from pathlib import Path
from typing import Any


SENTINEL_ID = "asymmetric-projection-truth-a"
MANIFEST_SCHEMA = "kaminos.visible-source-sentinel.v0"
LEDGER_SCHEMA = "kaminos.visible-source-evidence-ledger.v0"
DESCRIPTOR_SCHEMA = "kaminos.visible-source-sentinel-descriptor.v0"
SENTINEL_OUTPUT_NAMES = (
    "clay",
    "depth",
    "normal",
    "silhouette",
    "protected-contour",
    "landmark-overlay",
)
OUTPUT_FILENAMES = {name: f"{name}.png" for name in SENTINEL_OUTPUT_NAMES}
SUPPORT_ORDER = ("rear-outer", "rear-inner", "front-inner", "front-outer")
LANDMARKS = {
    "posterior-extreme": (48, 258),
    "dorsal-offset-tip": (322, 102),
    "head-marker-tip": (422, 126),
    "muzzle-tip": (483, 246),
    "rear-outer-contact": (88, 452),
    "rear-inner-contact": (174, 424),
    "front-inner-contact": (328, 435),
    "front-outer-contact": (414, 466),
}
PRODUCER_ROUTE = {
    "requested": "python-stdlib-analytic-raster-v0",
    "effective": "python-stdlib-analytic-raster-v0",
    "renderer": "deterministic-cpu-raster",
    "device": "cpu",
    "fallbackUsed": False,
}


class VisibleSentinelError(ValueError):
    """Contract failure with a stable evidence phase."""

    def __init__(self, message: str, *, phase: str):
        super().__init__(message)
        self.phase = phase


def _fail(message: str, phase: str) -> None:
    raise VisibleSentinelError(message, phase=phase)


def _canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _sha256_path(path: Path) -> str:
    return _sha256_bytes(path.read_bytes())


def _valid_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value.lower())
    )


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
    )


def _encode_rgb_png(width: int, height: int, pixels: bytes | bytearray) -> bytes:
    expected = width * height * 3
    if len(pixels) != expected:
        _fail(
            f"RGB payload has {len(pixels)} bytes, expected {expected}",
            "png-encoding",
        )
    stride = width * 3
    scanlines = bytearray()
    for row in range(height):
        scanlines.append(0)
        start = row * stride
        scanlines.extend(pixels[start : start + stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"IDAT", zlib.compress(bytes(scanlines), level=9))
        + _png_chunk(b"IEND", b"")
    )


def read_png_dimensions(path: Path | str) -> tuple[int, int]:
    payload = Path(path).read_bytes()
    if len(payload) < 24 or payload[:8] != b"\x89PNG\r\n\x1a\n" or payload[12:16] != b"IHDR":
        _fail(f"{path} is not a valid PNG header", "output-freshness")
    return struct.unpack(">II", payload[16:24])


def _ellipse_depth(
    x: float,
    y: float,
    cx: float,
    cy: float,
    rx: float,
    ry: float,
    base: float,
    amplitude: float,
) -> float:
    distance = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2
    if distance > 1.0:
        return 0.0
    return base + amplitude * math.sqrt(max(0.0, 1.0 - distance))


def _capsule_depth(
    x: float,
    y: float,
    ax: float,
    ay: float,
    bx: float,
    by: float,
    radius: float,
    base: float,
    amplitude: float,
) -> float:
    dx = bx - ax
    dy = by - ay
    length_squared = dx * dx + dy * dy
    if length_squared == 0:
        t = 0.0
    else:
        t = max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / length_squared))
    px = ax + t * dx
    py = ay + t * dy
    distance = math.hypot(x - px, y - py) / radius
    if distance > 1.0:
        return 0.0
    return base + amplitude * math.sqrt(max(0.0, 1.0 - distance * distance))


def _triangle_depth(
    x: float,
    y: float,
    points: tuple[tuple[float, float], tuple[float, float], tuple[float, float]],
    depth: float,
) -> float:
    (x1, y1), (x2, y2), (x3, y3) = points
    denominator = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3)
    if denominator == 0:
        return 0.0
    a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / denominator
    b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / denominator
    c = 1.0 - a - b
    return depth if a >= 0.0 and b >= 0.0 and c >= 0.0 else 0.0


def _geometry_depth(size: int) -> tuple[list[float], bytearray, bytearray]:
    depth = [0.0] * (size * size)
    marker_mask = bytearray(size * size)
    support_mask = bytearray(size * size)
    marker_triangle = ((0.785, 0.385), (0.824, 0.246), (0.862, 0.397))
    dorsal_triangle = ((0.565, 0.365), (0.629, 0.199), (0.674, 0.375))
    supports = (
        (0.190, 0.585, 0.172, 0.875, 0.040, 0.38, 0.19),
        (0.342, 0.585, 0.340, 0.820, 0.034, 0.42, 0.19),
        (0.640, 0.580, 0.642, 0.842, 0.034, 0.46, 0.19),
        (0.790, 0.570, 0.808, 0.905, 0.041, 0.50, 0.19),
    )
    for py in range(size):
        y = (py + 0.5) / size
        for px in range(size):
            x = (px + 0.5) / size
            values = (
                _ellipse_depth(x, y, 0.475, 0.505, 0.295, 0.160, 0.47, 0.39),
                _ellipse_depth(x, y, 0.270, 0.520, 0.190, 0.178, 0.43, 0.37),
                _ellipse_depth(x, y, 0.690, 0.500, 0.145, 0.142, 0.51, 0.35),
                _ellipse_depth(x, y, 0.805, 0.465, 0.115, 0.105, 0.56, 0.31),
                _ellipse_depth(x, y, 0.905, 0.480, 0.082, 0.058, 0.60, 0.25),
                _triangle_depth(x, y, dorsal_triangle, 0.66),
                _triangle_depth(x, y, marker_triangle, 0.91),
            )
            support_values = tuple(_capsule_depth(x, y, *support) for support in supports)
            value = max((*values, *support_values))
            index = py * size + px
            depth[index] = value
            if values[-1] > 0.0:
                marker_mask[index] = 1
            if max(support_values) > 0.0:
                support_mask[index] = 1
    return depth, marker_mask, support_mask


def _normal_field(depth: list[float], size: int) -> list[tuple[float, float, float]]:
    normals: list[tuple[float, float, float]] = [(0.0, 0.0, 1.0)] * (size * size)
    strength = 9.0
    for y in range(size):
        ym = max(0, y - 1)
        yp = min(size - 1, y + 1)
        for x in range(size):
            index = y * size + x
            if depth[index] <= 0.0:
                continue
            xm = max(0, x - 1)
            xp = min(size - 1, x + 1)
            gx = (depth[y * size + xp] - depth[y * size + xm]) * strength
            gy = (depth[yp * size + x] - depth[ym * size + x]) * strength
            nx, ny, nz = -gx, -gy, 1.0
            length = math.sqrt(nx * nx + ny * ny + nz * nz)
            normals[index] = (nx / length, ny / length, nz / length)
    return normals


def _set_rgb(pixels: bytearray, size: int, x: int, y: int, color: tuple[int, int, int]) -> None:
    if not (0 <= x < size and 0 <= y < size):
        return
    index = (y * size + x) * 3
    pixels[index : index + 3] = bytes(color)


def _draw_line(
    pixels: bytearray,
    size: int,
    start: tuple[int, int],
    end: tuple[int, int],
    color: tuple[int, int, int],
    width: int = 1,
) -> None:
    x1, y1 = start
    x2, y2 = end
    dx = abs(x2 - x1)
    dy = -abs(y2 - y1)
    sx = 1 if x1 < x2 else -1
    sy = 1 if y1 < y2 else -1
    error = dx + dy
    while True:
        for oy in range(-(width // 2), width // 2 + 1):
            for ox in range(-(width // 2), width // 2 + 1):
                _set_rgb(pixels, size, x1 + ox, y1 + oy, color)
        if x1 == x2 and y1 == y2:
            break
        twice = 2 * error
        if twice >= dy:
            error += dy
            x1 += sx
        if twice <= dx:
            error += dx
            y1 += sy


def _draw_landmark(
    pixels: bytearray,
    size: int,
    point: tuple[int, int],
    color: tuple[int, int, int],
) -> None:
    x, y = point
    _draw_line(pixels, size, (x - 7, y), (x + 7, y), color, 3)
    _draw_line(pixels, size, (x, y - 7), (x, y + 7), color, 3)
    for angle in range(0, 360, 6):
        radians = math.radians(angle)
        _set_rgb(
            pixels,
            size,
            x + round(math.cos(radians) * 10),
            y + round(math.sin(radians) * 10),
            color,
        )


def _render_channels(size: int) -> dict[str, bytes]:
    depth, marker_mask, support_mask = _geometry_depth(size)
    normals = _normal_field(depth, size)
    background = (242, 241, 237)
    clay = bytearray(background * (size * size))
    depth_pixels = bytearray(background * (size * size))
    normal_pixels = bytearray(background * (size * size))
    silhouette = bytearray((255, 255, 255) * (size * size))
    protected = bytearray((0, 0, 0) * (size * size))
    light = (-0.35, -0.45, 0.82)
    light_length = math.sqrt(sum(value * value for value in light))
    light = tuple(value / light_length for value in light)
    for index, value in enumerate(depth):
        if value <= 0.0:
            continue
        nx, ny, nz = normals[index]
        diffuse = max(0.0, nx * light[0] + ny * light[1] + nz * light[2])
        shade = 0.56 + 0.34 * diffuse + 0.10 * min(1.0, value)
        base = (192, 188, 180)
        if support_mask[index]:
            base = (176, 174, 168)
        if marker_mask[index]:
            base = (216, 143, 42)
        clay[index * 3 : index * 3 + 3] = bytes(
            max(0, min(255, round(channel * shade))) for channel in base
        )
        gray = max(20, min(245, round(25 + value * 230)))
        depth_pixels[index * 3 : index * 3 + 3] = bytes((gray, gray, gray))
        normal_pixels[index * 3 : index * 3 + 3] = bytes(
            (
                round((nx * 0.5 + 0.5) * 255),
                round((ny * 0.5 + 0.5) * 255),
                round((nz * 0.5 + 0.5) * 255),
            )
        )
        silhouette[index * 3 : index * 3 + 3] = b"\x18\x18\x18"
        protected[index * 3 : index * 3 + 3] = b"\xff\xff\xff"

    overlay = bytearray(clay)
    palette = ((221, 43, 58), (16, 128, 191), (126, 44, 168), (15, 145, 96))
    for index, point in enumerate(LANDMARKS.values()):
        _draw_landmark(overlay, size, point, palette[index % len(palette)])

    return {
        "clay": _encode_rgb_png(size, size, clay),
        "depth": _encode_rgb_png(size, size, depth_pixels),
        "normal": _encode_rgb_png(size, size, normal_pixels),
        "silhouette": _encode_rgb_png(size, size, silhouette),
        "protected-contour": _encode_rgb_png(size, size, protected),
        "landmark-overlay": _encode_rgb_png(size, size, overlay),
    }


def _landmark_record(size: int, point: tuple[int, int]) -> dict[str, Any]:
    x, y = point
    return {
        "pixel": [x, y],
        "normalized": [round(x / size, 8), round(y / size, 8)],
        "coordinateConvention": "top-left-origin-pixel-center",
    }


def _visible_evidence_ledger(size: int) -> dict[str, Any]:
    return {
        "schema": LEDGER_SCHEMA,
        "sentinelId": SENTINEL_ID,
        "status": "predeclared",
        "orientation": {
            "headSide": "image-right",
            "markerSide": "image-right",
            "projectionClass": "orthographic",
        },
        "supportOrder": list(SUPPORT_ORDER),
        "landmarks": {
            name: _landmark_record(size, point) for name, point in LANDMARKS.items()
        },
        "visibleClaims": [
            {
                "id": "head-marker-side",
                "kind": "categorical-landmark",
                "sourceValue": "image-right",
                "evidenceSource": "pixel-measurement",
                "measurementArtifact": OUTPUT_FILENAMES["landmark-overlay"],
                "predeclared": True,
            },
            {
                "id": "support-order",
                "kind": "categorical-order",
                "sourceValue": list(SUPPORT_ORDER),
                "evidenceSource": "pixel-measurement",
                "measurementArtifact": OUTPUT_FILENAMES["silhouette"],
                "predeclared": True,
            },
            {
                "id": "protected-contour",
                "kind": "binary-mask",
                "sourceValue": OUTPUT_FILENAMES["protected-contour"],
                "evidenceSource": "pixel-measurement",
                "measurementArtifact": OUTPUT_FILENAMES["protected-contour"],
                "predeclared": True,
            },
        ],
        "descriptorOnlyClaims": [
            {
                "id": "primitive-role-head",
                "value": "right-cranial-mass",
                "mayAdjudicateVisibleProjection": False,
            },
            {
                "id": "primitive-role-posterior",
                "value": "left-posterior-mass",
                "mayAdjudicateVisibleProjection": False,
            },
        ],
        "thresholds": {
            "categoricalPolicy": "exact",
            "maxLandmarkDriftFrameDiagonal": 0.05,
            "minProtectedContourIoU": 0.80,
            "predeclared": True,
            "allowedCompletionRegion": "outside-unobserved-contour-lawful",
        },
    }


def validate_visible_evidence_ledger(ledger: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(ledger, dict) or ledger.get("schema") != LEDGER_SCHEMA:
        _fail("unsupported visible evidence ledger schema", "visible-evidence-schema")
    claims = ledger.get("visibleClaims")
    if not isinstance(claims, list) or not claims:
        _fail("visible evidence ledger has no visible claims", "visible-evidence-authority")
    for claim in claims:
        if not isinstance(claim, dict):
            _fail("visible evidence claim must be an object", "visible-evidence-authority")
        if claim.get("evidenceSource") != "pixel-measurement":
            _fail(
                f"visible claim {claim.get('id', '<unknown>')} uses descriptor-only or non-pixel authority",
                "visible-evidence-authority",
            )
        if not claim.get("predeclared") or not isinstance(claim.get("measurementArtifact"), str):
            _fail("visible claims must be predeclared and measured", "visible-evidence-authority")
    descriptor_claims = ledger.get("descriptorOnlyClaims")
    if not isinstance(descriptor_claims, list) or any(
        not isinstance(claim, dict) or claim.get("mayAdjudicateVisibleProjection") is not False
        for claim in descriptor_claims
    ):
        _fail("descriptor-only claims must be explicitly non-adjudicative", "visible-evidence-authority")
    orientation = ledger.get("orientation")
    if orientation != {
        "headSide": "image-right",
        "markerSide": "image-right",
        "projectionClass": "orthographic",
    }:
        _fail("orientation categorical invariants changed", "visible-evidence-invariants")
    if ledger.get("supportOrder") != list(SUPPORT_ORDER):
        _fail("support order categorical invariant changed", "visible-evidence-invariants")
    landmarks = ledger.get("landmarks")
    if not isinstance(landmarks, dict) or set(landmarks) != set(LANDMARKS):
        _fail("landmark inventory is incomplete", "visible-evidence-invariants")
    marker = landmarks["head-marker-tip"].get("normalized")
    dorsal = landmarks["dorsal-offset-tip"].get("normalized")
    if not isinstance(marker, list) or len(marker) != 2 or marker[0] <= 0.5:
        _fail("head marker is not visibly image-right", "visible-evidence-invariants")
    if not isinstance(dorsal, list) or len(dorsal) != 2 or abs(dorsal[0] - 0.5) <= 0.04:
        _fail("dorsal landmark is not visibly offset", "visible-evidence-invariants")
    thresholds = ledger.get("thresholds")
    expected_thresholds = {
        "categoricalPolicy": "exact",
        "maxLandmarkDriftFrameDiagonal": 0.05,
        "minProtectedContourIoU": 0.80,
        "predeclared": True,
        "allowedCompletionRegion": "outside-unobserved-contour-lawful",
    }
    if thresholds != expected_thresholds:
        _fail("visible evidence thresholds changed", "visible-evidence-thresholds")
    return {"ok": True, "claimCount": len(claims), "landmarkCount": len(landmarks)}


def _descriptor(size: int) -> dict[str, Any]:
    geometry = {
        "bodyMasses": ["posterior", "trunk", "shoulder", "head", "muzzle"],
        "supportOrder": list(SUPPORT_ORDER),
        "marker": "right-cranial-geometric-fin",
        "dorsalOffset": "right-of-center",
    }
    return {
        "schema": DESCRIPTOR_SCHEMA,
        "id": SENTINEL_ID,
        "sourceType": "deterministic-analytic-raster",
        "sourceMutation": {"operatorBlendLoaded": False, "operatorBlendMutated": False},
        "dimensions": [size, size],
        "projection": {
            "mode": "orthographic",
            "view": "right-facing-profile-three-quarter-calibration",
            "cameraTransform": "analytic-identity",
        },
        "geometrySpec": geometry,
        "geometrySpecSha256": _sha256_bytes(_canonical_bytes(geometry)),
        "visibleEvidenceLedger": "visible-evidence-ledger.json",
        "authorityBoundary": {
            "descriptorRolesMayAdjudicateVisibleProjection": False,
            "pixelLedgerIsVisibleProjectionAuthority": True,
        },
    }


def _preprocessing(size: int) -> dict[str, Any]:
    record = {
        "requestedPolicy": "native-square",
        "effectivePolicy": "native-square",
        "sourceDimensions": [size, size],
        "encodedDimensions": [size, size],
        "scale": [1.0, 1.0],
        "pad": [0, 0, 0, 0],
        "crop": None,
    }
    record["transformSha256"] = _sha256_bytes(_canonical_bytes(record))
    return record


def _consumer_plan(output_records: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {
        "consumer": "morphology-generator-assay",
        "allocationAuthority": "generator-program-owner",
        "cells": [
            {
                "id": "depth-only",
                "references": [
                    {
                        "slot": 0,
                        "role": "target-projection",
                        "carrierKind": "depth",
                        "path": output_records["depth"]["path"],
                        "sha256": output_records["depth"]["sha256"],
                    }
                ],
            },
            {
                "id": "depth-plus-clay-appearance",
                "references": [
                    {
                        "slot": 0,
                        "role": "target-projection",
                        "carrierKind": "depth",
                        "path": output_records["depth"]["path"],
                        "sha256": output_records["depth"]["sha256"],
                    },
                    {
                        "slot": 1,
                        "role": "appearance",
                        "carrierKind": "clay",
                        "path": output_records["clay"]["path"],
                        "sha256": output_records["clay"]["sha256"],
                    },
                ],
            },
        ],
        "claimCeiling": (
            "Carrier-role comparison on one pixel-falsifiable native-square sentinel; "
            "no general carrier ranking, reconstructed-volume, or organic-transfer claim."
        ),
    }


def _manifest_sha256(manifest: dict[str, Any]) -> str:
    payload = copy.deepcopy(manifest)
    payload.pop("manifestSha256", None)
    return _sha256_bytes(_canonical_bytes(payload))


def validate_visible_sentinel_manifest(manifest_path: Path | str) -> dict[str, Any]:
    path = Path(manifest_path)
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        _fail(f"manifest is unreadable: {exc}", "manifest-schema")
    if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
        _fail("unsupported visible sentinel manifest schema", "manifest-schema")
    if manifest.get("status") != "complete" or manifest.get("sentinelId") != SENTINEL_ID:
        _fail("visible sentinel manifest is not terminal and identified", "manifest-schema")
    if manifest.get("producerRoute") != PRODUCER_ROUTE:
        _fail(
            "requested/effective producer route changed or used fallback",
            "producer-route",
        )
    preprocessing = manifest.get("preprocessing")
    expected_preprocessing = _preprocessing(512)
    if preprocessing != expected_preprocessing:
        _fail("native-square preprocessing identity is not exact", "preprocessing-identity")
    outputs = manifest.get("outputs")
    if not isinstance(outputs, dict) or set(outputs) != set(SENTINEL_OUTPUT_NAMES):
        _fail("sentinel output inventory is incomplete", "output-freshness")
    output_hashes: set[str] = set()
    for name in SENTINEL_OUTPUT_NAMES:
        record = outputs[name]
        if not isinstance(record, dict) or record.get("dimensions") != [512, 512]:
            _fail(f"{name} output dimensions are not native-square", "output-freshness")
        output_path = path.parent / str(record.get("path", ""))
        if not output_path.is_file():
            _fail(f"{name} output is missing", "output-freshness")
        measured = _sha256_path(output_path)
        if measured != record.get("sha256"):
            _fail(
                f"{name} output SHA-256 mismatch: expected {record.get('sha256')}, measured {measured}",
                "output-freshness",
            )
        if read_png_dimensions(output_path) != (512, 512):
            _fail(f"{name} PNG dimensions are not 512x512", "output-freshness")
        if output_path.stat().st_size != record.get("byteLength"):
            _fail(f"{name} byte length mismatch", "output-freshness")
        output_hashes.add(measured)
    if len(output_hashes) != len(SENTINEL_OUTPUT_NAMES):
        _fail("sentinel outputs contain duplicated carrier bytes", "output-freshness")
    for label, key in (("descriptor", "descriptor"), ("visible ledger", "visibleEvidenceLedger")):
        record = manifest.get(key)
        if not isinstance(record, dict) or not _valid_sha256(record.get("sha256")):
            _fail(f"{label} identity is missing", "source-freshness")
        record_path = path.parent / str(record.get("path", ""))
        if not record_path.is_file() or _sha256_path(record_path) != record["sha256"]:
            _fail(f"{label} SHA-256 mismatch", "source-freshness")
    ledger = json.loads((path.parent / manifest["visibleEvidenceLedger"]["path"]).read_text())
    validate_visible_evidence_ledger(ledger)
    if manifest.get("manifestSha256") != _manifest_sha256(manifest):
        _fail("manifest SHA-256 does not bind the bundle", "manifest-identity")
    plan = manifest.get("consumerExercise")
    if not isinstance(plan, dict) or [cell.get("id") for cell in plan.get("cells", [])] != [
        "depth-only",
        "depth-plus-clay-appearance",
    ]:
        _fail("consumer exercise topology is incomplete", "consumer-contract")
    return {
        "ok": True,
        "sentinelId": SENTINEL_ID,
        "manifestSha256": manifest["manifestSha256"],
        "outputCount": len(outputs),
    }


def _inspection_html(manifest: dict[str, Any], ledger: dict[str, Any]) -> str:
    cards = []
    for name in SENTINEL_OUTPUT_NAMES:
        record = manifest["outputs"][name]
        payload = Path(record["absolutePathForBuild"]).read_bytes()
        cards.append(
            "<figure><img alt='{}' src='data:image/png;base64,{}'>"
            "<figcaption><strong>{}</strong><br>{}<br>{}</figcaption></figure>".format(
                html.escape(name),
                base64.b64encode(payload).decode("ascii"),
                html.escape(name),
                html.escape(record["path"]),
                html.escape(record["sha256"][:16]),
            )
        )
    public_manifest = copy.deepcopy(manifest)
    for record in public_manifest["outputs"].values():
        record.pop("absolutePathForBuild", None)
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Native-square asymmetric sentinel A</title>
<style>
body{{margin:0;background:#15171b;color:#ece9df;font:15px/1.45 system-ui,sans-serif}}main{{max-width:1500px;margin:auto;padding:28px}}
h1,h2{{letter-spacing:.02em}}.summary{{color:#bbb6aa}}.grid{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}}
figure{{margin:0;background:#22252b;border:1px solid #3a3e47;border-radius:10px;overflow:hidden}}img{{display:block;width:100%;background:#eee}}
figcaption{{padding:11px;color:#c9c4b8;word-break:break-all}}pre{{white-space:pre-wrap;background:#202329;border:1px solid #3a3e47;padding:16px;border-radius:8px}}
@media(max-width:900px){{.grid{{grid-template-columns:1fr 1fr}}}}@media(max-width:600px){{.grid{{grid-template-columns:1fr}}}}
</style></head><body><main>
<h1>Native-square asymmetric sentinel A</h1>
<p class="summary">Pixel-visible projection truth is authoritative. Descriptor-only anatomical roles are displayed separately and cannot adjudicate the output.</p>
<section class="grid">{cards}</section>
<h2>Predeclared visible evidence</h2><pre>{ledger}</pre>
<h2>Manifest and consumer exercise</h2><pre>{manifest}</pre>
</main></body></html>""".format(
        cards="".join(cards),
        ledger=html.escape(json.dumps(ledger, indent=2, sort_keys=True)),
        manifest=html.escape(json.dumps(public_manifest, indent=2, sort_keys=True)),
    )


def build_visible_sentinel_bundle(
    output_dir: Path | str,
    *,
    size: int = 512,
    fail_after: str | None = None,
) -> dict[str, Any]:
    """Build sentinel A and write a terminal report on success or failure."""

    root = Path(output_dir)
    root.mkdir(parents=True, exist_ok=True)
    report_path = root / "build-report.json"
    completed: list[str] = []
    output_sha256: dict[str, str] = {}
    phase = "render-source"
    try:
        if size != 512:
            _fail("sentinel A dimensions are fixed at 512x512", "preprocessing-identity")
        channels = _render_channels(size)
        for name in SENTINEL_OUTPUT_NAMES:
            phase = f"write-{name}"
            if fail_after and completed and completed[-1] == fail_after:
                _fail(f"forced failure before {name}", phase)
            path = root / OUTPUT_FILENAMES[name]
            path.write_bytes(channels[name])
            completed.append(name)
            output_sha256[name] = _sha256_path(path)

        phase = "write-visible-ledger"
        ledger = _visible_evidence_ledger(size)
        validate_visible_evidence_ledger(ledger)
        ledger_path = root / "visible-evidence-ledger.json"
        _write_json(ledger_path, ledger)

        phase = "write-descriptor"
        descriptor = _descriptor(size)
        descriptor_path = root / "descriptor.json"
        _write_json(descriptor_path, descriptor)

        outputs = {
            name: {
                "path": OUTPUT_FILENAMES[name],
                "sha256": output_sha256[name],
                "byteLength": (root / OUTPUT_FILENAMES[name]).stat().st_size,
                "dimensions": [size, size],
                "mediaType": "image/png",
                "fresh": True,
                "complete": True,
                "cached": False,
                "absolutePathForBuild": str((root / OUTPUT_FILENAMES[name]).resolve()),
            }
            for name in SENTINEL_OUTPUT_NAMES
        }
        phase = "write-manifest"
        manifest = {
            "schema": MANIFEST_SCHEMA,
            "status": "complete",
            "sentinelId": SENTINEL_ID,
            "descriptor": {
                "path": descriptor_path.name,
                "sha256": _sha256_path(descriptor_path),
            },
            "visibleEvidenceLedger": {
                "path": ledger_path.name,
                "sha256": _sha256_path(ledger_path),
            },
            "preprocessing": _preprocessing(size),
            "producerRoute": copy.deepcopy(PRODUCER_ROUTE),
            "outputs": outputs,
            "consumerExercise": _consumer_plan(outputs),
            "failure": None,
        }
        public_manifest = copy.deepcopy(manifest)
        for record in public_manifest["outputs"].values():
            record.pop("absolutePathForBuild", None)
        public_manifest["manifestSha256"] = _manifest_sha256(public_manifest)
        manifest_path = root / "manifest.json"
        _write_json(manifest_path, public_manifest)

        phase = "write-inspection"
        inspection_path = root / "index.html"
        inspection_path.write_text(_inspection_html(manifest, ledger), encoding="utf-8")

        phase = "validate-bundle"
        receipt = validate_visible_sentinel_manifest(manifest_path)
        report = {
            "schema": "kaminos.visible-source-sentinel-build-report.v0",
            "status": "complete",
            "failurePhase": None,
            "error": None,
            "sentinelId": SENTINEL_ID,
            "manifestPath": manifest_path.name,
            "manifestSha256": receipt["manifestSha256"],
            "inspectionPath": inspection_path.name,
            "lastTrustworthyEvidence": {
                "producerRoute": copy.deepcopy(PRODUCER_ROUTE),
                "completedOutputs": completed,
                "outputSha256": output_sha256,
            },
        }
        _write_json(report_path, report)
        return public_manifest
    except Exception as exc:
        stable = exc if isinstance(exc, VisibleSentinelError) else VisibleSentinelError(
            str(exc), phase=phase
        )
        report = {
            "schema": "kaminos.visible-source-sentinel-build-report.v0",
            "status": "failed",
            "failurePhase": stable.phase,
            "error": str(stable),
            "sentinelId": SENTINEL_ID,
            "manifestPath": None,
            "manifestSha256": None,
            "inspectionPath": None,
            "lastTrustworthyEvidence": {
                "producerRoute": copy.deepcopy(PRODUCER_ROUTE),
                "completedOutputs": completed,
                "outputSha256": output_sha256,
            },
        }
        _write_json(report_path, report)
        raise stable


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", required=True, type=Path)
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    manifest = build_visible_sentinel_bundle(args.output_dir)
    print(json.dumps({
        "status": manifest["status"],
        "sentinelId": manifest["sentinelId"],
        "manifestSha256": manifest["manifestSha256"],
        "outputDir": str(args.output_dir.resolve()),
    }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
