#!/usr/bin/env python3
"""Compare sealed SAM masks with authored truth without semantic hand-mapping."""

from __future__ import annotations

import argparse
import binascii
import hashlib
import json
import struct
import zlib
from pathlib import Path


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
TRUTH_REGIONS = (
    "short-coat",
    "puffy-coat",
    "ruff",
    "mystacial-pad-left",
    "mystacial-pad-right",
)
_BINARY_MASK_CACHE: dict[tuple[str, int], tuple[int, int, frozenset[int]]] = {}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def public_evidence_path(path: Path, repo_root: Path) -> str:
    resolved = path.resolve()
    try:
        return resolved.relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return f"<external>/{resolved.name}"


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    return (
        struct.pack(">I", len(payload))
        + kind
        + payload
        + struct.pack(">I", binascii.crc32(kind + payload) & 0xFFFFFFFF)
    )


def write_grayscale_png(path: Path, width: int, height: int, pixels: bytes | bytearray) -> None:
    if len(pixels) != width * height:
        raise ValueError("pixel count does not match dimensions")
    raw = b"".join(
        b"\x00" + bytes(pixels[row * width : (row + 1) * width])
        for row in range(height)
    )
    data = (
        PNG_SIGNATURE
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, level=9))
        + _png_chunk(b"IEND", b"")
    )
    path.write_bytes(data)


def _paeth(a: int, b: int, c: int) -> int:
    estimate = a + b - c
    distances = (abs(estimate - a), abs(estimate - b), abs(estimate - c))
    return (a, b, c)[distances.index(min(distances))]


def read_png_luma(path: Path) -> tuple[int, int, bytearray]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"not a PNG: {path}")
    cursor = len(PNG_SIGNATURE)
    payloads = []
    width = height = bit_depth = color_type = None
    while cursor < len(data):
        length = struct.unpack_from(">I", data, cursor)[0]
        kind = data[cursor + 4 : cursor + 8]
        payload = data[cursor + 8 : cursor + 8 + length]
        cursor += 12 + length
        if kind == b"IHDR":
            width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", payload
            )
            if bit_depth != 8 or compression or filtering or interlace:
                raise ValueError(f"unsupported PNG encoding in {path}")
        elif kind == b"IDAT":
            payloads.append(payload)
        elif kind == b"IEND":
            break
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if not width or not height or channels is None:
        raise ValueError(f"unsupported or missing PNG header in {path}")
    packed = zlib.decompress(b"".join(payloads))
    stride = width * channels
    expected = height * (stride + 1)
    if len(packed) != expected:
        raise ValueError(f"unexpected PNG data length in {path}")
    decoded = bytearray(height * stride)
    for y in range(height):
        source = y * (stride + 1)
        filter_type = packed[source]
        row = packed[source + 1 : source + 1 + stride]
        prior_offset = (y - 1) * stride
        target_offset = y * stride
        for x, value in enumerate(row):
            left = decoded[target_offset + x - channels] if x >= channels else 0
            up = decoded[prior_offset + x] if y else 0
            upper_left = decoded[prior_offset + x - channels] if y and x >= channels else 0
            if filter_type == 0:
                reconstructed = value
            elif filter_type == 1:
                reconstructed = (value + left) & 0xFF
            elif filter_type == 2:
                reconstructed = (value + up) & 0xFF
            elif filter_type == 3:
                reconstructed = (value + ((left + up) // 2)) & 0xFF
            elif filter_type == 4:
                reconstructed = (value + _paeth(left, up, upper_left)) & 0xFF
            else:
                raise ValueError(f"unsupported PNG filter {filter_type} in {path}")
            decoded[target_offset + x] = reconstructed
    luma = bytearray(width * height)
    for pixel_index in range(width * height):
        offset = pixel_index * channels
        if color_type in (0, 4):
            luma[pixel_index] = decoded[offset]
        else:
            red, green, blue = decoded[offset : offset + 3]
            luma[pixel_index] = round(0.2126 * red + 0.7152 * green + 0.0722 * blue)
    return width, height, luma


def mask_metrics(predicted_path: Path, truth_path: Path, threshold: int = 127) -> dict:
    pred_width, pred_height, predicted_bits = binary_mask(Path(predicted_path), threshold)
    truth_width, truth_height, truth_bits = binary_mask(Path(truth_path), threshold)
    if (pred_width, pred_height) != (truth_width, truth_height):
        raise ValueError(
            f"mask dimensions differ: predicted={pred_width}x{pred_height}, "
            f"truth={truth_width}x{truth_height}"
        )
    predicted_count = len(predicted_bits)
    truth_count = len(truth_bits)
    if truth_count == 0:
        raise ValueError(f"truth mask is blank: {truth_path}")
    intersection = len(predicted_bits & truth_bits)
    union = len(predicted_bits | truth_bits)
    return {
        "width": pred_width,
        "height": pred_height,
        "predictedPixels": predicted_count,
        "truthPixels": truth_count,
        "intersectionPixels": intersection,
        "unionPixels": union,
        "iou": intersection / union if union else 0.0,
        "precision": intersection / predicted_count if predicted_count else 0.0,
        "recall": intersection / truth_count,
    }


def binary_mask(path: Path, threshold: int) -> tuple[int, int, frozenset[int]]:
    resolved = str(path.resolve())
    key = (resolved, threshold)
    cached = _BINARY_MASK_CACHE.get(key)
    if cached is not None:
        return cached
    width, height, luma = read_png_luma(path)
    result = (width, height, frozenset(index for index, value in enumerate(luma) if value > threshold))
    _BINARY_MASK_CACHE[key] = result
    return result


def select_best_truth_match(candidates: dict[str, dict]) -> str:
    if not candidates:
        raise ValueError("no truth candidates")
    return max(candidates, key=lambda key: (candidates[key]["iou"], key))


def compare(sam_report_path: Path, truth_root: Path, output_path: Path) -> dict:
    repo_root = Path.cwd().resolve()
    sam_report_path = sam_report_path.resolve()
    truth_root = truth_root.resolve()
    sam_report = json.loads(sam_report_path.read_text())
    if sam_report.get("state") != "segmentation_captured" or sam_report.get("phase") != "complete":
        raise ValueError("SAM report is not terminal segmentation evidence")
    rows = []
    for record in sam_report.get("masks", []):
        view_id = record["viewId"]
        prediction_path = sam_report_path.parent / record["mask"]["path"]
        if sha256(prediction_path) != record["mask"]["sha256"]:
            raise ValueError(f"SAM mask digest mismatch: {prediction_path}")
        candidates = {}
        for region_id in TRUTH_REGIONS:
            truth_path = truth_root / view_id / f"{region_id}.png"
            metrics = mask_metrics(prediction_path, truth_path)
            metrics["truthMask"] = public_evidence_path(truth_path, repo_root)
            metrics["truthMaskSha256"] = sha256(truth_path)
            candidates[region_id] = metrics
        best = select_best_truth_match(candidates)
        rows.append(
            {
                "viewId": view_id,
                "proposalSystemId": record["proposalSystemId"],
                "segmenterPhrase": record["segmenterPhrase"],
                "state": record["state"],
                "detectionCount": record["detectionCount"],
                "predictionMask": public_evidence_path(prediction_path, repo_root),
                "predictionMaskSha256": sha256(prediction_path),
                "overlay": public_evidence_path(sam_report_path.parent / record["overlay"]["path"], repo_root),
                "bestTruthMatch": best,
                "bestMetrics": candidates[best],
                "allTruthMetrics": candidates,
            }
        )
    report = {
        "schema": "kaminos.procedural-groom-mask-comparison.v0",
        "samReport": public_evidence_path(sam_report_path, repo_root),
        "samReportSha256": sha256(sam_report_path),
        "matchingPolicy": "per-view maximum IoU across authored regions; no semantic hand-map",
        "thresholdPolicy": "strict luminance > 127 for SAM and authored truth",
        "rows": rows,
        "visualAdmission": False,
        "scientificAdmission": False,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(report, indent=2) + "\n")
    return report


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sam-report", type=Path, required=True)
    parser.add_argument("--truth-root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    report = compare(args.sam_report, args.truth_root, args.output)
    print(json.dumps({"state": "comparison_captured", "rows": len(report["rows"]), "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
