#!/usr/bin/env python3
"""Seal a truth-withheld VLM inventory before SAM or truth comparison."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any


OBSERVATION_SCHEMA = "kaminos.procedural-groom-observation.v0"
REPORT_SCHEMA = "kaminos.procedural-groom-vlm-inventory-report.v0"
SEAL_SCHEMA = "kaminos.procedural-groom-raw-proposal-seal.v0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_proposal_seal(
    *,
    observation: dict[str, Any],
    inventory: dict[str, Any],
    report: dict[str, Any],
    observation_file_sha256: str,
    inventory_sha256: str,
    report_sha256: str,
    recovery_report: dict[str, Any] | None = None,
    recovery_report_sha256: str | None = None,
) -> dict[str, Any]:
    if observation.get("schema") != OBSERVATION_SCHEMA or observation.get("truthExposure") != "withheld":
        raise ValueError("proposal sealing requires a truth-withheld procedural groom observation")
    if report.get("schema") != REPORT_SCHEMA:
        raise ValueError("generation report schema mismatch")
    if report.get("observationDigest") != observation.get("digest"):
        raise ValueError("generation report observation identity does not match the observation")

    if recovery_report is None:
        if (
            report.get("state") != "raw_inventory_captured"
            or report.get("phase") != "complete"
            or report.get("lastTrustworthyEvidence") != "parsed-raw-inventory"
        ):
            raise ValueError("generation report is not terminal parsed inventory evidence")
        trusted_report = report
        parse_recovery_sha = None
    else:
        if (
            report.get("state") != "failed"
            or report.get("phase") != "json-parse"
            or report.get("lastTrustworthyEvidence") != "terminal-raw-vlm-output"
            or recovery_report.get("state") != "raw_inventory_recovered"
            or recovery_report.get("phase") != "complete"
            or recovery_report.get("lastTrustworthyEvidence") != "parsed-frozen-raw-inventory"
            or recovery_report.get("sourceReportSha256") != report_sha256
        ):
            raise ValueError("recovery reports do not prove one terminal frozen raw inventory")
        if recovery_report_sha256 is None:
            raise ValueError("recovery report digest is required")
        trusted_report = recovery_report
        parse_recovery_sha = recovery_report_sha256

    if trusted_report.get("observationDigest") != observation.get("digest"):
        raise ValueError("parsed inventory observation identity does not match the observation")
    if trusted_report.get("inventorySha256") != inventory_sha256:
        raise ValueError("inventory digest does not match terminal parsed inventory evidence")

    views = observation.get("views")
    if not isinstance(views, list) or not views:
        raise ValueError("observation must contain views")
    systems = inventory.get("systems")
    if not isinstance(systems, list) or not systems:
        raise ValueError("inventory must contain non-empty systems")
    system_ids: list[str] = []
    for system in systems:
        system_id = system.get("id")
        if not isinstance(system_id, str) or not system_id.strip() or system_id in system_ids:
            raise ValueError("inventory system ids must be non-empty and unique")
        if not isinstance(system.get("segmenter_phrase"), str) or not system["segmenter_phrase"].strip():
            raise ValueError(f"{system_id}: segmenter phrase is missing")
        boxes = system.get("bounding_boxes")
        if not isinstance(boxes, list) or len(boxes) != len(views):
            raise ValueError(f"{system_id}: inventory must provide one box per view")
        for view_index, box in enumerate(boxes):
            if not isinstance(box, dict):
                raise ValueError(f"{system_id} view {view_index}: box must be an object")
            coordinates = []
            for field in ("x_min", "y_min", "x_max", "y_max"):
                value = box.get(field)
                if not isinstance(value, (int, float)) or not math.isfinite(value) or not 0.0 <= float(value) <= 1.0:
                    raise ValueError(f"{system_id} view {view_index}: box coordinates must be normalized to [0,1]")
                coordinates.append(float(value))
            x_min, y_min, x_max, y_max = coordinates
            if x_max <= x_min or y_max <= y_min:
                raise ValueError(f"{system_id} view {view_index}: box must have positive area")
        system_ids.append(system_id)

    effective_model = report.get("effectiveModel")
    effective_backend = report.get("effectiveBackend")
    effective_device = report.get("effectiveDevice")
    if not all(isinstance(value, str) and value for value in (effective_model, effective_backend, effective_device)):
        raise ValueError("generation report lacks effective model/backend/device identity")

    return {
        "schema": SEAL_SCHEMA,
        "proposalId": f"{observation['observationId']}-raw-vlm-proposal",
        "sealed": True,
        "truthExposure": "withheld",
        "observationId": observation["observationId"],
        "observationDigest": observation["digest"],
        "observationFileSha256": observation_file_sha256,
        "promptSha256": trusted_report["promptSha256"],
        "requestedRoute": report["requestedRoute"],
        "effectiveRoute": report["requestedRoute"],
        "effectiveBackend": effective_backend,
        "effectiveDevice": effective_device,
        "rawStdoutSha256": trusted_report["rawStdoutSha256"],
        "rawStderrSha256": report["rawStderrSha256"],
        "generationReportSha256": report_sha256,
        "parseRecoveryReportSha256": parse_recovery_sha,
        "inventorySha256": inventory_sha256,
        "inventorySystems": system_ids,
        "normalizationStatus": "not_started",
        "visualAdmission": False,
        "scientificAdmission": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--observation", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--recovery-report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    observation_path = args.observation.resolve()
    inventory_path = args.inventory.resolve()
    report_path = args.report.resolve()
    recovery_path = args.recovery_report.resolve() if args.recovery_report else None
    for label, path in (("observation", observation_path), ("inventory", inventory_path), ("report", report_path)):
        if not path.is_file() or path.stat().st_size <= 0:
            raise ValueError(f"{label} is missing or blank")
    if recovery_path is not None and (not recovery_path.is_file() or recovery_path.stat().st_size <= 0):
        raise ValueError("recovery report is missing or blank")

    report = json.loads(report_path.read_text())
    raw_stdout_path = report_path.parent / "raw-stdout.txt"
    raw_stderr_path = report_path.parent / "raw-stderr.txt"
    if not raw_stdout_path.is_file() or sha256(raw_stdout_path) != report.get("rawStdoutSha256"):
        raise ValueError("raw stdout is missing or does not match the generation report")
    if not raw_stderr_path.is_file() or sha256(raw_stderr_path) != report.get("rawStderrSha256"):
        raise ValueError("raw stderr is missing or does not match the generation report")

    recovery_report = json.loads(recovery_path.read_text()) if recovery_path else None
    seal = build_proposal_seal(
        observation=json.loads(observation_path.read_text()),
        inventory=json.loads(inventory_path.read_text()),
        report=report,
        observation_file_sha256=sha256(observation_path),
        inventory_sha256=sha256(inventory_path),
        report_sha256=sha256(report_path),
        recovery_report=recovery_report,
        recovery_report_sha256=sha256(recovery_path) if recovery_path else None,
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(seal, indent=2) + "\n")
    print(json.dumps({"state": "proposal_sealed", "systems": len(seal["inventorySystems"]), "output": str(args.output)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
