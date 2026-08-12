"""Render registered truth/candidate cross-sections without image dependencies."""

from __future__ import annotations

import argparse
import json
import os
import struct
import tempfile
import zlib
from pathlib import Path

import numpy as np

from export_hidden_carrier_surfaces import _source_topology
from hidden_carrier_fixture import SOURCE_SHA256, _sha256, load_glb_surface
from rendered_observation_volume import (
    build_recovery_bundle,
    recover_volume_candidates,
    render_orthographic_views,
)


SCHEMA = "kaminos.rendered-observation-hidden-carrier-diagnostic.v0"
ROUTE = "registered-volume-cross-section-png-v0"
BACKEND = "python-numpy-cpu"
PNG_NAME = "registered-volume-cross-sections.png"
REPORT_NAME = "diagnostic-report.json"


class DiagnosticFailure(RuntimeError):
    pass


def _write_json(path, payload):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=path.parent, prefix=f".{path.name}.", delete=False
    )
    temporary = Path(handle.name)
    try:
        with handle:
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _png_chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))


def _write_png(path, image):
    image = np.asarray(image, dtype=np.uint8)
    if image.ndim != 3 or image.shape[2] != 3:
        raise DiagnosticFailure("PNG image must have RGB shape")
    height, width, _ = image.shape
    raw = b"".join(b"\0" + image[row].tobytes() for row in range(height))
    payload = (
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + _png_chunk(b"IDAT", zlib.compress(raw, level=9))
        + _png_chunk(b"IEND", b"")
    )
    Path(path).write_bytes(payload)


def _registered_panel(truth, candidate, *, border):
    truth = np.asarray(truth, dtype=bool)
    candidate = np.asarray(candidate, dtype=bool)
    panel = np.full((*truth.shape, 3), (16, 19, 24), dtype=np.uint8)
    panel[truth & ~candidate] = (53, 208, 226)
    panel[candidate & ~truth] = (244, 82, 113)
    panel[truth & candidate] = (244, 244, 232)
    panel = np.flipud(panel)
    scale = max(1, 240 // max(panel.shape[:2]))
    panel = np.repeat(np.repeat(panel, scale, axis=0), scale, axis=1)
    canvas = np.full((256, 256, 3), (8, 10, 14), dtype=np.uint8)
    height, width = panel.shape[:2]
    top = (256 - height) // 2
    left = (256 - width) // 2
    canvas[top : top + height, left : left + width] = panel
    canvas[:4, :, :] = border
    canvas[-4:, :, :] = border
    canvas[:, :4, :] = border
    canvas[:, -4:, :] = border
    return canvas


def render_diagnostic(*, repo_root, source_path, assay_dir, output_dir, expected_report_sha256):
    repo_root = Path(repo_root).resolve()
    source_path = Path(source_path).resolve()
    assay_dir = Path(assay_dir).resolve()
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    png_path = output_dir / PNG_NAME
    report_path = output_dir / REPORT_NAME
    png_path.unlink(missing_ok=True)
    report_path.unlink(missing_ok=True)
    try:
        source_report_path = assay_dir / "report.json"
        if _sha256(source_report_path) != expected_report_sha256:
            raise DiagnosticFailure("assay report digest mismatch")
        source_report = json.loads(source_report_path.read_text())
        if source_report.get("status") != "captured" or not source_report.get("terminal"):
            raise DiagnosticFailure("assay report is not terminal captured evidence")
        if _sha256(source_path) != SOURCE_SHA256:
            raise DiagnosticFailure("authenticated source digest mismatch")
        recovery_info = source_report["artifacts"]["recoveredVolumes"]
        recovery_path = assay_dir / recovery_info["path"]
        if _sha256(recovery_path) != recovery_info["sha256"]:
            raise DiagnosticFailure("recovery artifact digest mismatch")
        with np.load(recovery_path, allow_pickle=False) as archive:
            bounds = np.asarray(archive["bounds"], dtype=np.float64)
            outer = np.asarray(archive["outerOccupancy"], dtype=bool)
            uniform = np.asarray(archive["uniformOccupancy"], dtype=bool)
            spatial = np.asarray(archive["spatialOccupancy"], dtype=bool)
        if outer.shape != uniform.shape or outer.shape != spatial.shape or outer.ndim != 3:
            raise DiagnosticFailure("recovery occupancy shapes differ")

        surface = load_glb_surface(source_path)
        triangles = _source_topology(source_path, expected_vertex_count=len(surface["positions"]))
        truth_rendered = render_orthographic_views(
            surface["positions"],
            triangles,
            raster_size=source_report["effectiveConfig"]["rasterSize"],
            bounds=bounds,
        )
        truth_bundle = build_recovery_bundle(
            truth_rendered,
            grid_size=source_report["effectiveConfig"]["gridSize"],
            uniform_depth=0.0,
            spatial_prior={"baseDepth": 0.0, "amplitude": 0.0},
        )
        truth = recover_volume_candidates(truth_bundle)["outerOccupancy"]
        if truth.shape != outer.shape:
            raise DiagnosticFailure("held-out truth and recovery volumes differ in shape")

        x_counts = np.count_nonzero(truth, axis=(1, 2))
        x_index = int(np.argmax(x_counts))
        z_index = int(round(0.65 * (truth.shape[2] - 1)))
        candidates = (
            (outer, (238, 180, 65)),
            (uniform, (172, 112, 255)),
            (spatial, (255, 126, 68)),
        )
        top = [
            _registered_panel(truth[x_index, :, :], candidate[x_index, :, :], border=color)
            for candidate, color in candidates
        ]
        bottom = [
            _registered_panel(truth[:, :, z_index], candidate[:, :, z_index], border=color)
            for candidate, color in candidates
        ]
        gutter = np.full((256, 8, 3), (36, 40, 48), dtype=np.uint8)
        top_row = np.concatenate((top[0], gutter, top[1], gutter, top[2]), axis=1)
        bottom_row = np.concatenate((bottom[0], gutter, bottom[1], gutter, bottom[2]), axis=1)
        divider = np.full((12, top_row.shape[1], 3), (36, 40, 48), dtype=np.uint8)
        image = np.concatenate((top_row, divider, bottom_row), axis=0)
        _write_png(png_path, image)
        receipt = {
            "schema": SCHEMA,
            "status": "captured",
            "terminal": True,
            "route": {"requested": ROUTE, "effective": ROUTE, "backend": BACKEND},
            "inputs": {
                "sourceSha256": SOURCE_SHA256,
                "assayReportSha256": expected_report_sha256,
                "recoverySha256": recovery_info["sha256"],
            },
            "registration": {
                "gridShape": list(truth.shape),
                "sharedBounds": bounds.tolist(),
                "topRow": {"plane": "X", "index": x_index, "selection": "truth-max-area"},
                "bottomRow": {"plane": "Z", "index": z_index, "selection": "normalized-AP-0.65"},
                "columns": ["outer-observation-volume", "uniform-recovery", "spatial-recovery"],
                "colors": {
                    "truthOnly": "cyan",
                    "candidateOnly": "red",
                    "overlap": "off-white",
                    "columnBorder": ["gold", "violet", "orange"],
                },
            },
            "artifact": {
                "path": PNG_NAME,
                "sha256": _sha256(png_path),
                "byteLength": png_path.stat().st_size,
                "pixelSize": [int(image.shape[1]), int(image.shape[0])],
            },
            "safetyCharacterization": (
                "Abstract registered binary-volume cross-sections of an authored cat fixture; "
                "no generator output or hostile biological imagery."
            ),
            "operatorVisualAdmission": "not-requested",
            "claimCeiling": (
                "Registered same-grid cross-section evidence for held-out truth versus outer, uniform, "
                "and provisional spatial volume candidates; not a coherent surface or production mesh."
            ),
        }
        _write_json(report_path, receipt)
        return receipt
    except Exception as error:
        png_path.unlink(missing_ok=True)
        receipt = {
            "schema": SCHEMA,
            "status": "failed",
            "terminal": True,
            "failurePhase": "registered-volume-diagnostic",
            "reason": str(error),
            "route": {"requested": ROUTE, "effective": None, "backend": BACKEND},
            "lastTrustworthyEvidence": {},
        }
        _write_json(report_path, receipt)
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument("--repo-root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--assay-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--expected-report-sha256", required=True)
    args = parser.parse_args(argv)
    receipt = render_diagnostic(
        repo_root=args.repo_root,
        source_path=args.source,
        assay_dir=args.assay_dir,
        output_dir=args.output_dir,
        expected_report_sha256=args.expected_report_sha256,
    )
    print(json.dumps(receipt, indent=2, sort_keys=True))
    return 0 if receipt["status"] == "captured" else 1


if __name__ == "__main__":
    raise SystemExit(main())
