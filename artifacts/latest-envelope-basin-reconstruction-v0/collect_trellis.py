#!/usr/bin/env python3
"""Collect canonical Greenroom evidence once every TRELLIS cell is terminal."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

from evidence_contract import write_failure_report


ROOT = Path(__file__).resolve().parent
SUBMISSIONS = ROOT / "trellis-submissions.json"
LEDGER = ROOT / "trellis-ledger.json"
FAILURE_REPORT = ROOT / "trellis-failure-report.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")
TERMINAL = {"done", "failed", "cancelled"}


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def status(job_id: str) -> dict:
    completed = subprocess.run(
        [str(GREENROOM), "status", job_id],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(completed.stdout)


def canonical_job_dir(job_id: str, state: str) -> Path:
    candidates = [QUEUE / state / job_id]
    candidates.extend(QUEUE / bucket / job_id for bucket in ("done", "failed", "cancelled"))
    for candidate in candidates:
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"canonical Greenroom job directory missing for {job_id} ({state})")


def main() -> int:
    submissions = json.loads(SUBMISSIONS.read_text())
    statuses = {
        cell_id: status(entry["jobId"])
        for cell_id, entry in submissions["cells"].items()
    }
    incomplete = {
        cell_id: record["status"]
        for cell_id, record in statuses.items()
        if record["status"] not in TERMINAL
    }
    if incomplete:
        print(json.dumps({"terminal": len(statuses) - len(incomplete), "total": len(statuses), "incomplete": incomplete}, indent=2))
        return 2

    failures = {
        cell_id: record
        for cell_id, record in statuses.items()
        if record["status"] != "done" or record.get("exit_code") != 0
    }
    if failures:
        write_failure_report(
            FAILURE_REPORT,
            schema="kaminos.latest-envelope-basin-reconstruction.trellis-failure.v0",
            phase="greenroom-terminal-status",
            statuses=statuses,
            failures=failures,
        )
        print(f"TRELLIS campaign has {len(failures)} failed terminal cell(s); wrote {FAILURE_REPORT}", file=sys.stderr)
        return 1

    ledger = {
        "schema": "kaminos.latest-envelope-basin-reconstruction.trellis-ledger.v0",
        "submissions": "trellis-submissions.json",
        "cells": {},
    }
    output_failures = {}
    for cell_id, submission in submissions["cells"].items():
        record = statuses[cell_id]
        output = ROOT / submission["outputDir"] / "output.glb"
        if not output.is_file() or output.stat().st_size <= 4096:
            output_failures[cell_id] = {"reason": "missing-or-blank-primary-output", "path": str(output)}
            continue
        try:
            canonical = canonical_job_dir(record["job_id"], record["status"])
        except FileNotFoundError as error:
            output_failures[cell_id] = {"reason": "missing-canonical-job-directory", "detail": str(error)}
            continue
        receipt_dir = ROOT / "receipts-trellis" / cell_id
        receipt_dir.mkdir(parents=True, exist_ok=True)
        evidence_missing = []
        for name in ("receipt.json", "status.json", "request.json", "stdout.log", "stderr.log"):
            source = canonical / name
            if not source.is_file():
                evidence_missing.append(str(source))
                continue
            shutil.copy2(source, receipt_dir / name)
        if evidence_missing:
            output_failures[cell_id] = {"reason": "missing-canonical-evidence", "paths": evidence_missing}
            continue
        ledger["cells"][cell_id] = {
            "jobId": record["job_id"],
            "status": record["status"],
            "jobType": record["job_type"],
            "params": record["params"],
            "effectiveRoute": record["effective_route"],
            "input": submission["input"],
            "output": str(output.relative_to(ROOT)),
            "receipt": str((receipt_dir / "receipt.json").relative_to(ROOT)),
            "statusEvidence": str((receipt_dir / "status.json").relative_to(ROOT)),
            "trellisRole": submission["trellisRole"],
        }
    if output_failures:
        write_failure_report(
            FAILURE_REPORT,
            schema="kaminos.latest-envelope-basin-reconstruction.trellis-failure.v0",
            phase="primary-output-and-evidence-validation",
            statuses=statuses,
            failures=output_failures,
        )
        print(f"TRELLIS evidence validation failed for {len(output_failures)} cell(s); wrote {FAILURE_REPORT}", file=sys.stderr)
        return 1
    write_json(LEDGER, ledger)
    FAILURE_REPORT.unlink(missing_ok=True)
    print(f"collected {len(ledger['cells'])} complete TRELLIS cells into {LEDGER}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
