from __future__ import annotations

import json
import hashlib
from pathlib import Path
import struct
import subprocess
import sys
from tempfile import TemporaryDirectory
import zlib


ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / "source_plate_geometry_audit.py"


def _png_bytes(width: int, height: int) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    row = bytes([0]) + bytes((25, 50, 75)) * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


def _write_manifest(path: Path, cells: list[dict]) -> None:
    path.write_text(
        json.dumps(
            {
                "schema": "kaminos.promptmatrix_manifest.v1",
                "route": {"settings": {"width": "512", "height": "512"}},
                "cells": cells,
            }
        )
    )


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_audit_separates_absolute_resampling_from_pairwise_comparison_control():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        square = root / "square.png"
        wide = root / "wide.png"
        square.write_bytes(_png_bytes(100, 100))
        wide.write_bytes(_png_bytes(200, 100))

        same_source = root / "same-source.json"
        differential = root / "differential.json"
        _write_manifest(
            same_source,
            [
                {"source_path": str(wide), "source_sha256": _sha256(wide), "prompt": "one"},
                {"source_path": str(wide), "source_sha256": _sha256(wide), "prompt": "two"},
            ],
        )
        _write_manifest(
            differential,
            [
                {"source_path": str(square), "source_sha256": _sha256(square)},
                {"source_path": str(wide), "source_sha256": _sha256(wide)},
            ],
        )

        completed = subprocess.run(
            [sys.executable, str(CLI), str(root)],
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)
        by_name = {Path(item["manifest"]).name: item for item in report["matrices"]}

        same = by_name["same-source.json"]
        assert same["absoluteConditioningGeometry"] == "anisotropically-resampled"
        assert same["sourceComparisonClass"] == "same-source-controlled"
        assert same["claimCeiling"]["promptOrSeedComparison"] == "survives-this-confound"
        assert same["claimCeiling"]["absoluteSourceGeometry"] == "lowered"

        changed = by_name["differential.json"]
        assert changed["sourceComparisonClass"] == "differential-source-geometry-confounded"
        assert changed["claimCeiling"]["sourceMorphologyComparison"] == "not-admissible"
        assert changed["cells"][0]["geometry"]["geometryPreserved"] is True
        assert changed["cells"][1]["geometry"]["geometryPreserved"] is False


def test_missing_source_fails_loud_in_report_without_aborting_other_matrices():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        manifest = root / "missing.json"
        _write_manifest(manifest, [{"source_path": str(root / "absent.png")}])

        completed = subprocess.run(
            [sys.executable, str(CLI), str(root)],
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)

        assert report["summary"]["matricesWithMissingSources"] == 1
        assert report["matrices"][0]["sourceComparisonClass"] == "unresolved-missing-source"
        assert report["matrices"][0]["cells"][0]["status"] == "missing-source"


def test_unrelated_json_arrays_do_not_abort_manifest_discovery():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / "unrelated.json").write_text(json.dumps([{"schema": "not-a-manifest"}]))
        manifest = root / "matrix.json"
        _write_manifest(manifest, [{"source_path": str(root / "absent.png")}])

        completed = subprocess.run(
            [sys.executable, str(CLI), str(root)],
            check=True,
            capture_output=True,
            text=True,
        )
        report = json.loads(completed.stdout)

        assert report["summary"]["matrixCount"] == 1
        assert Path(report["matrices"][0]["manifest"]).name == "matrix.json"


def test_measured_source_identity_overrides_forged_manifest_hashes():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        square = root / "square.png"
        wide = root / "wide.png"
        square.write_bytes(_png_bytes(100, 100))
        wide.write_bytes(_png_bytes(200, 100))
        _write_manifest(
            root / "forged.json",
            [
                {"source_path": str(square), "source_sha256": "same-forged-hash"},
                {"source_path": str(wide), "source_sha256": "same-forged-hash"},
            ],
        )

        completed = subprocess.run(
            [sys.executable, str(CLI), str(root)],
            check=True,
            capture_output=True,
            text=True,
        )
        matrix = json.loads(completed.stdout)["matrices"][0]

        assert matrix["sourceComparisonClass"] == "unresolved-source-hash-mismatch"
        assert matrix["claimCeiling"]["sourceMorphologyComparison"] == "unresolved"
        assert matrix["cells"][0]["actualSourceSha256"] == _sha256(square)
        assert matrix["cells"][1]["actualSourceSha256"] == _sha256(wide)
        assert all(cell["status"] == "source-hash-mismatch" for cell in matrix["cells"])


def test_completed_capture_sidecar_must_bind_the_actual_image():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "plate.png"
        source.write_bytes(_png_bytes(100, 100))
        source.with_suffix(".json").write_text(
            json.dumps(
                {
                    "schema": "kaminos.source-plate-viewport-capture.v0",
                    "status": "completed",
                    "effective": {"viewPerspective": "PERSP", "viewMatrix": [[1.0]]},
                    "output": {
                        "path": str(source),
                        "sha256": "stale-or-forged",
                        "width": 100,
                        "height": 100,
                    },
                }
            )
        )
        _write_manifest(
            root / "matrix.json",
            [
                {"source_path": str(source), "source_sha256": _sha256(source)},
                {"source_path": str(source), "source_sha256": _sha256(source)},
            ],
        )

        completed = subprocess.run(
            [sys.executable, str(CLI), str(root)],
            check=True,
            capture_output=True,
            text=True,
        )
        matrix = json.loads(completed.stdout)["matrices"][0]

        assert matrix["captureEvidenceClass"] == "invalid-capture-evidence"
        assert matrix["cells"][0]["captureEvidence"]["status"] == "hash-mismatch"


def test_single_cell_matrix_is_not_reported_as_a_controlled_comparison():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        root = Path(tmp)
        source = root / "plate.png"
        source.write_bytes(_png_bytes(100, 100))
        _write_manifest(
            root / "single.json",
            [{"source_path": str(source), "source_sha256": _sha256(source)}],
        )

        completed = subprocess.run(
            [sys.executable, str(CLI), str(root)],
            check=True,
            capture_output=True,
            text=True,
        )
        matrix = json.loads(completed.stdout)["matrices"][0]

        assert matrix["sourceComparisonClass"] == "insufficient-comparison"
        assert matrix["claimCeiling"]["promptOrSeedComparison"] == "unresolved"


def test_nonexistent_audit_root_fails_loud():
    assert CLI.is_file(), "source plate geometry audit is missing"
    with TemporaryDirectory() as tmp:
        absent = Path(tmp) / "does-not-exist"
        completed = subprocess.run(
            [sys.executable, str(CLI), str(absent)],
            check=False,
            capture_output=True,
            text=True,
        )

        assert completed.returncode != 0
        assert "does not exist" in completed.stderr
