"""Submit a validated projection sentinel and preserve queue identities."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any, Callable


JOBS_SCHEMA = "kaminos.source-plate-projection-sentinel-jobs.v0"
REPORT_SCHEMA = "kaminos.source-plate-projection-sentinel-submission-report.v0"


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def _job_id(stdout: str) -> str:
    stripped = stdout.strip()
    if stripped.startswith("{"):
        decoded = json.loads(stripped)
        value = decoded.get("job_id")
        if isinstance(value, str) and value:
            return value
    match = re.search(r"^Submitted job ([a-f0-9-]+)", stripped)
    if match:
        return match.group(1)
    raise ValueError(f"unrecognized Greenroom submission response: {stripped!r}")


def _args(greenroom_cli: str, submission: dict[str, Any]) -> list[str]:
    inputs = submission["inputPaths"]
    args = [
        greenroom_cli,
        "submit",
        submission["jobType"],
        inputs[0],
        submission["outputDir"],
        "--cwd",
        submission["effectiveCwd"],
        "--params",
    ]
    if len(inputs) == 2:
        args.append(f"reference_path_2={inputs[1]}")
    args.extend(f"{key}={value}" for key, value in submission["params"].items())
    return args


def submit_projection_sentinel(
    submissions: list[dict[str, Any]],
    *,
    jobs_path: Path,
    report_path: Path,
    greenroom_cli: str,
    runner: Callable[..., Any],
) -> dict[str, Any]:
    """Submit cells and write a durable terminal submission report."""

    if not submissions:
        raise ValueError("at least one projection sentinel submission is required")
    plan_sha256 = submissions[0]["planSha256"]
    if any(row.get("planSha256") != plan_sha256 for row in submissions):
        raise ValueError("submission rows disagree on plan identity")
    if jobs_path.exists():
        jobs = json.loads(jobs_path.read_text(encoding="utf-8"))
        if jobs.get("schema") != JOBS_SCHEMA or jobs.get("planSha256") != plan_sha256:
            raise ValueError("existing jobs ledger belongs to another plan")
    else:
        jobs = {"schema": JOBS_SCHEMA, "planSha256": plan_sha256, "jobs": []}
    by_cell = {row["cellId"]: row for row in jobs["jobs"]}
    active_cell = None
    try:
        for submission in submissions:
            active_cell = submission["cellId"]
            if active_cell in by_cell:
                continue
            Path(submission["outputDir"]).mkdir(parents=True, exist_ok=True)
            args = _args(greenroom_cli, submission)
            completed = runner(args, capture_output=True, text=True)
            if completed.returncode != 0:
                raise RuntimeError(
                    f"Greenroom rejected {active_cell} with exit {completed.returncode}: "
                    f"{completed.stderr.strip()}"
                )
            row = {
                "cellId": active_cell,
                "jobId": _job_id(completed.stdout),
                "requestedRoute": submission["requestedRoute"],
                "jobType": submission["jobType"],
                "inputPaths": submission["inputPaths"],
                "outputDir": submission["outputDir"],
                "effectiveCwd": submission["effectiveCwd"],
                "params": submission["params"],
            }
            jobs["jobs"].append(row)
            by_cell[active_cell] = row
            _write_json(jobs_path, jobs)
        report = {
            "schema": REPORT_SCHEMA,
            "status": "queued",
            "failurePhase": None,
            "planSha256": plan_sha256,
            "queuedCellCount": len(jobs["jobs"]),
            "jobsPath": str(jobs_path.resolve()),
            "jobs": jobs["jobs"],
            "lastTrustworthyEvidence": {
                "planSha256": plan_sha256,
                "queuedCells": [row["cellId"] for row in jobs["jobs"]],
            },
        }
    except Exception as exc:
        report = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": "greenroom-submission",
            "message": str(exc),
            "activeCell": active_cell,
            "planSha256": plan_sha256,
            "queuedCellCount": len(jobs["jobs"]),
            "jobsPath": str(jobs_path.resolve()),
            "lastTrustworthyEvidence": {
                "planSha256": plan_sha256,
                "queuedCells": [row["cellId"] for row in jobs["jobs"]],
                "queuedJobIds": [row["jobId"] for row in jobs["jobs"]],
            },
        }
    _write_json(report_path, report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--submissions", required=True, type=Path)
    parser.add_argument("--jobs", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--greenroom", required=True)
    args = parser.parse_args()
    try:
        payload_bytes = args.submissions.read_bytes()
        payload = json.loads(payload_bytes)
        rows = payload.get("submissions")
        if payload.get("schema") != "kaminos.source-plate-projection-sentinel-submissions.v0" or not isinstance(rows, list):
            raise ValueError("unsupported or malformed submission ledger")
        report = submit_projection_sentinel(
            rows,
            jobs_path=args.jobs,
            report_path=args.report,
            greenroom_cli=args.greenroom,
            runner=subprocess.run,
        )
    except Exception as exc:
        report = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": "submission-ledger-read",
            "message": str(exc),
            "lastTrustworthyEvidence": {
                "submissionsPath": str(args.submissions.resolve()),
                "submissionsSha256": (
                    hashlib.sha256(payload_bytes).hexdigest()
                    if "payload_bytes" in locals()
                    else None
                ),
            },
        }
        _write_json(args.report, report)
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "queued" else 1


if __name__ == "__main__":
    raise SystemExit(main())
