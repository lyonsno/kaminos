from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
from typing import Any


SCHEMA = "kaminos.source-plate-geometry-audit.v0"
PROMPTMATRIX_SCHEMA = "kaminos.promptmatrix_manifest.v1"
CAPTURE_SCHEMA = "kaminos.source-plate-viewport-capture.v0"


def image_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as handle:
        header = handle.read(24)
        if header.startswith(b"\x89PNG\r\n\x1a\n"):
            return struct.unpack(">II", header[16:24])
        if header[:2] != b"\xff\xd8":
            raise ValueError("unsupported image format")
        handle.seek(2)
        while True:
            marker_start = handle.read(1)
            if not marker_start:
                break
            if marker_start != b"\xff":
                continue
            marker = handle.read(1)
            while marker == b"\xff":
                marker = handle.read(1)
            if marker in (b"\xd8", b"\xd9"):
                continue
            length_bytes = handle.read(2)
            if len(length_bytes) != 2:
                break
            length = struct.unpack(">H", length_bytes)[0]
            if marker and marker[0] in {
                0xC0,
                0xC1,
                0xC2,
                0xC3,
                0xC5,
                0xC6,
                0xC7,
                0xC9,
                0xCA,
                0xCB,
                0xCD,
                0xCE,
                0xCF,
            }:
                frame = handle.read(length - 2)
                height, width = struct.unpack(">HH", frame[1:5])
                return width, height
            handle.seek(length - 2, 1)
    raise ValueError("image dimensions are not readable")


def conditioning_geometry(
    source_width: int,
    source_height: int,
    target_width: int,
    target_height: int,
) -> dict[str, Any]:
    scale_x = target_width / source_width
    scale_y = target_height / source_height
    anisotropy = scale_x / scale_y
    return {
        "sourceWidth": source_width,
        "sourceHeight": source_height,
        "targetWidth": target_width,
        "targetHeight": target_height,
        "sourceAspectRatio": source_width / source_height,
        "targetAspectRatio": target_width / target_height,
        "scaleX": scale_x,
        "scaleY": scale_y,
        "anisotropyRatio": anisotropy,
        "geometryPreserved": math.isclose(anisotropy, 1.0, rel_tol=1e-12, abs_tol=1e-12),
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _capture_sidecar(
    source: Path,
    *,
    actual_sha256: str,
    width: int,
    height: int,
) -> dict[str, Any]:
    sidecar_path = source.with_suffix(".json")
    if not sidecar_path.is_file():
        return {"status": "missing"}
    try:
        sidecar = json.loads(sidecar_path.read_text())
    except (OSError, json.JSONDecodeError) as error:
        return {"status": "unreadable", "error": str(error)}
    if sidecar.get("schema") != CAPTURE_SCHEMA or sidecar.get("status") != "completed":
        return {"status": "invalid-schema-or-state", "path": str(sidecar_path.resolve())}
    output = sidecar.get("output", {})
    if output.get("sha256") != actual_sha256:
        return {"status": "hash-mismatch", "path": str(sidecar_path.resolve())}
    try:
        output_path = Path(output["path"]).expanduser().resolve()
    except (KeyError, TypeError):
        return {"status": "missing-output-path", "path": str(sidecar_path.resolve())}
    if output_path != source.resolve():
        return {"status": "path-mismatch", "path": str(sidecar_path.resolve())}
    if output.get("width") != width or output.get("height") != height:
        return {"status": "dimension-mismatch", "path": str(sidecar_path.resolve())}
    return {
        "status": "bound",
        "path": str(sidecar_path.resolve()),
        "schema": sidecar["schema"],
        "viewPerspective": sidecar.get("effective", {}).get("viewPerspective"),
        "viewMatrixRecorded": "viewMatrix" in sidecar.get("effective", {}),
    }


def _target_dimensions(manifest: dict[str, Any]) -> tuple[int, int] | None:
    settings = manifest.get("route", {}).get("settings", {})
    try:
        width = int(settings["width"])
        height = int(settings["height"])
    except (KeyError, TypeError, ValueError):
        return None
    if width <= 0 or height <= 0:
        return None
    return width, height


def audit_manifest(path: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    target = _target_dimensions(manifest)
    cells = []
    for index, cell in enumerate(manifest.get("cells", [])):
        source_value = cell.get("source_path")
        source = Path(source_value).expanduser() if source_value else None
        record: dict[str, Any] = {
            "index": index,
            "sourcePath": str(source.resolve()) if source else None,
            "sourceSha256": cell.get("source_sha256"),
            "status": "pending",
        }
        if source is None or not source.is_file():
            record["status"] = "missing-source"
            cells.append(record)
            continue
        try:
            width, height = image_dimensions(source)
        except (OSError, ValueError) as error:
            record["status"] = "unreadable-source"
            record["error"] = str(error)
            cells.append(record)
            continue
        record["status"] = "inspected"
        actual_sha256 = sha256_file(source)
        record["actualSourceSha256"] = actual_sha256
        record["sourceWidth"] = width
        record["sourceHeight"] = height
        record["sourceAspectRatio"] = width / height
        record["captureEvidence"] = _capture_sidecar(
            source,
            actual_sha256=actual_sha256,
            width=width,
            height=height,
        )
        if target is not None:
            record["geometry"] = conditioning_geometry(width, height, *target)
        claimed_sha256 = record["sourceSha256"]
        if claimed_sha256 and claimed_sha256 != actual_sha256:
            record["status"] = "source-hash-mismatch"
        cells.append(record)

    unresolved = [cell for cell in cells if cell["status"] != "inspected"]
    inspected = [cell for cell in cells if cell["status"] == "inspected"]
    identities = {cell["actualSourceSha256"] for cell in inspected}
    aspects = {round(cell["sourceAspectRatio"], 12) for cell in inspected}

    if unresolved:
        if any(cell["status"] == "source-hash-mismatch" for cell in unresolved):
            comparison_class = "unresolved-source-hash-mismatch"
        else:
            comparison_class = "unresolved-missing-source"
    elif target is None:
        comparison_class = "unresolved-target-raster"
    elif len(cells) < 2:
        comparison_class = "insufficient-comparison"
    elif len(identities) <= 1:
        comparison_class = "same-source-controlled"
    elif len(aspects) == 1:
        comparison_class = "matched-source-geometry"
    else:
        comparison_class = "differential-source-geometry-confounded"

    geometry_records = [cell.get("geometry") for cell in inspected]
    if target is None or not geometry_records:
        absolute_geometry = "unresolved"
    elif all(record["geometryPreserved"] for record in geometry_records):
        absolute_geometry = "aspect-preserved"
    else:
        absolute_geometry = "anisotropically-resampled"

    if comparison_class == "same-source-controlled":
        prompt_seed_claim = "survives-this-confound"
        source_claim = "not-tested-by-same-source-matrix"
    elif comparison_class == "matched-source-geometry":
        prompt_seed_claim = "not-the-primary-comparison"
        source_claim = "survives-differential-aspect-confound"
    elif comparison_class == "differential-source-geometry-confounded":
        prompt_seed_claim = "not-the-primary-comparison"
        source_claim = "not-admissible"
    else:
        prompt_seed_claim = "unresolved"
        source_claim = "unresolved"

    absolute_claim = "supported" if absolute_geometry == "aspect-preserved" else "lowered"
    capture_statuses = [cell["captureEvidence"]["status"] for cell in inspected]
    if capture_statuses and all(status == "bound" for status in capture_statuses):
        capture_evidence = "bound-source-plate"
    elif any(status != "missing" for status in capture_statuses):
        capture_evidence = "invalid-capture-evidence"
    else:
        capture_evidence = "legacy-unbound"
    return {
        "manifest": str(path.resolve()),
        "cellCount": len(cells),
        "targetRaster": {"width": target[0], "height": target[1]} if target else None,
        "absoluteConditioningGeometry": absolute_geometry,
        "sourceComparisonClass": comparison_class,
        "captureEvidenceClass": capture_evidence,
        "claimCeiling": {
            "promptOrSeedComparison": prompt_seed_claim,
            "sourceMorphologyComparison": source_claim,
            "absoluteSourceGeometry": absolute_claim,
        },
        "cells": cells,
    }


def discover_manifests(root: Path) -> list[tuple[Path, dict[str, Any]]]:
    manifests = []
    candidates = [root] if root.is_file() else sorted(root.rglob("*.json"))
    for path in candidates:
        try:
            document = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(document, dict) and document.get("schema") == PROMPTMATRIX_SCHEMA:
            manifests.append((path, document))
    return manifests


def build_report(root: Path) -> dict[str, Any]:
    if not root.exists():
        raise FileNotFoundError(f"audit root does not exist: {root}")
    matrices = [audit_manifest(path, manifest) for path, manifest in discover_manifests(root)]
    comparison_counts = Counter(item["sourceComparisonClass"] for item in matrices)
    geometry_counts = Counter(item["absoluteConditioningGeometry"] for item in matrices)
    return {
        "schema": SCHEMA,
        "root": str(root.resolve()),
        "summary": {
            "matrixCount": len(matrices),
            "comparisonClasses": dict(sorted(comparison_counts.items())),
            "absoluteConditioningGeometry": dict(sorted(geometry_counts.items())),
            "matricesWithMissingSources": comparison_counts["unresolved-missing-source"],
            "differentialSourceGeometryConfounds": comparison_counts[
                "differential-source-geometry-confounded"
            ],
        },
        "matrices": matrices,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Audit prompt-matrix source rasters for hidden anisotropic conditioning"
    )
    parser.add_argument("root", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    root = args.root.expanduser()
    if not root.exists():
        parser.error(f"audit root does not exist: {root}")
    report = build_report(root)
    rendered = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered)
    sys.stdout.write(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
