#!/usr/bin/env python3
"""Compile a source-plate assay spec into a manifest and visual plate."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from source_plate_assay import (
    SourcePlateAssayError,
    build_experiment_manifest,
    write_experiment_manifest,
    write_experiment_plate,
)


REPORT_SCHEMA = "kaminos.source-plate-assay-build-report.v0"


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Caller-owned assay spec JSON")
    parser.add_argument("--manifest", required=True, help="Caller-owned output manifest path")
    parser.add_argument("--plate", required=True, help="Caller-owned output experiment-plate HTML path")
    parser.add_argument("--report", required=True, help="Caller-owned durable terminal report path")
    parser.add_argument("--external-images", action="store_true", help="Link verified image paths instead of embedding bytes")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    requested_input = args.input
    requested_manifest = args.manifest
    requested_plate = args.plate
    requested_report = args.report
    input_path = Path(requested_input).resolve()
    manifest_path = Path(requested_manifest).resolve()
    plate_path = Path(requested_plate).resolve()
    report_path = Path(requested_report).resolve()
    input_sha256 = None
    failure_phase = "input-read"
    try:
        input_bytes = input_path.read_bytes()
        input_sha256 = _sha256(input_bytes)
        failure_phase = "input-parse"
        spec = json.loads(input_bytes)
        failure_phase = "manifest-build"
        manifest = build_experiment_manifest(spec)
        failure_phase = "manifest-write"
        write_experiment_manifest(manifest_path, manifest)
        failure_phase = "plate-write"
        write_experiment_plate(plate_path, manifest, embed_images=not args.external_images)
        _write_json(report_path, {
            "schema": REPORT_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "requestedInputPath": requested_input,
            "effectiveInputPath": str(input_path),
            "inputSha256": input_sha256,
            "requestedManifestPath": requested_manifest,
            "effectiveManifestPath": str(manifest_path),
            "requestedPlatePath": requested_plate,
            "effectivePlatePath": str(plate_path),
            "requestedReportPath": requested_report,
            "effectiveReportPath": str(report_path),
            "manifestSha256": manifest["manifestSha256"],
            "lastTrustworthyEvidence": {"inputSha256": input_sha256, "manifestSha256": manifest["manifestSha256"]},
            "error": None,
        })
        return 0
    except Exception as error:  # the terminal report is the final safety boundary
        if isinstance(error, SourcePlateAssayError):
            failure_phase = error.phase
        _write_json(report_path, {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "requestedInputPath": requested_input,
            "effectiveInputPath": str(input_path),
            "requestedManifestPath": requested_manifest,
            "effectiveManifestPath": str(manifest_path),
            "requestedPlatePath": requested_plate,
            "effectivePlatePath": str(plate_path),
            "requestedReportPath": requested_report,
            "effectiveReportPath": str(report_path),
            "manifestSha256": None,
            "lastTrustworthyEvidence": {"inputSha256": input_sha256},
            "error": str(error),
        })
        print(f"Source-plate assay build failed during {failure_phase}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
