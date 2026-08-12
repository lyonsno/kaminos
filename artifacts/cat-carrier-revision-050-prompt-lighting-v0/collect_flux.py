#!/usr/bin/env python3
"""Collect only terminal Greenroom evidence and write a complete result ledger."""

import hashlib
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path

from evidence_contract import sha256, validate_output, validate_status


ROOT = Path(__file__).resolve().parent
CAMPAIGN = ROOT / "campaign.json"
SUBMISSIONS = ROOT / "submissions.json"
LEDGER = ROOT / "result-ledger.json"
STATE = ROOT / "collection-state.json"
FAILURE = ROOT / "terminal-failure-report.json"
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path("/Users/noahlyons/.local/state/gpu-greenroom")
TERMINAL = {"done", "failed", "cancelled"}


def write_json(path: Path, payload: object) -> None:
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)


def greenroom_status(job_id: str) -> dict:
    completed = subprocess.run([str(GREENROOM), "status", job_id], check=True, capture_output=True, text=True)
    return json.loads(completed.stdout)


def canonical_job_dir(job_id: str) -> Path:
    for bucket in ("done", "failed", "cancelled", "running", "pending"):
        candidate = QUEUE / bucket / job_id
        if candidate.is_dir():
            return candidate
    raise FileNotFoundError(f"canonical Greenroom job directory missing for {job_id}")


def copy_receipt(job_id: str, cell_id: str) -> tuple[dict[str, str], list[str]]:
    errors = []
    copied = {}
    try:
        canonical = canonical_job_dir(job_id)
    except FileNotFoundError as error:
        return copied, [str(error)]
    destination = ROOT / "receipts" / cell_id
    destination.mkdir(parents=True, exist_ok=True)
    for name in ("request.json", "status.json", "receipt.json", "stdout.log", "stderr.log"):
        source = canonical / name
        if not source.is_file():
            errors.append(f"canonical evidence is missing: {source}")
            continue
        target = destination / name
        shutil.copy2(source, target)
        copied[name] = target.relative_to(ROOT).as_posix()
    return copied, errors


def expected_for(campaign: dict, submission: dict) -> dict:
    route = campaign["fluxRoute"]
    request = submission["request"]
    return {
        "jobType": route["jobType"], "source": request["source"], "promptFile": request["promptFile"],
        "output": str(Path(request["outputDir"]) / "output.png"), "params": request["params"],
    }


def external_controls(campaign: dict) -> tuple[list[dict], list[dict]]:
    controls = []
    failures = []
    for control in campaign["externalControls"]:
        ledger_path = ROOT / control["campaignLedger"]
        output = ROOT / control["output"]
        errors = []
        if not ledger_path.is_file() or sha256(ledger_path) != control["campaignLedgerSha256"]:
            errors.append("external control ledger drifted or is missing")
        if not output.is_file() or sha256(output) != control["outputSha256"]:
            errors.append("external control output drifted or is missing")
        record = dict(control)
        record["status"] = "external-control"
        record["failureState"] = "; ".join(errors) if errors else "none"
        controls.append(record)
        if errors:
            failures.append({"id": control["id"], "errors": errors})
    return controls, failures


def main() -> int:
    campaign = json.loads(CAMPAIGN.read_text())
    submissions = json.loads(SUBMISSIONS.read_text())
    expected_ids = {cell["id"] for cell in campaign["cells"]}
    if set(submissions.get("cells", {})) != expected_ids:
        raise RuntimeError("submission ledger does not cover the frozen 16-cell campaign")
    statuses = {cell_id: greenroom_status(entry["jobId"]) for cell_id, entry in submissions["cells"].items()}
    incomplete = {cell_id: status.get("status") for cell_id, status in statuses.items() if status.get("status") not in TERMINAL}
    if incomplete:
        LEDGER.unlink(missing_ok=True)
        write_json(STATE, {
            "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.collection-state.v0",
            "phase": "awaiting-terminal-greenroom-jobs",
            "lastTrustworthyEvidence": statuses,
            "incomplete": incomplete,
        })
        print(json.dumps({"terminal": len(statuses) - len(incomplete), "total": len(statuses), "incomplete": incomplete}, indent=2))
        return 2

    prompts = {prompt["id"]: prompt for prompt in campaign["promptRecords"]}
    generated = []
    failures = []
    source_path = (ROOT / campaign["source"]["path"]).resolve()
    source_hash = sha256(source_path) if source_path.is_file() else None
    for cell in campaign["cells"]:
        submission = submissions["cells"][cell["id"]]
        status = statuses[cell["id"]]
        prompt = prompts[cell["promptId"]]
        output = Path(submission["request"]["outputDir"]) / "output.png"
        receipt, errors = copy_receipt(submission["jobId"], cell["id"])
        if source_hash != campaign["source"]["sha256"]:
            errors.append("source plate drifted or is missing")
        if sha256(Path(submission["request"]["promptFile"])) != prompt["bytesSha256"]:
            errors.append("prompt file bytes drifted or are missing")
        if status.get("status") == "done":
            errors.extend(validate_status(status, expected_for(campaign, submission)))
            errors.extend(validate_output(output, (campaign["fluxRoute"]["width"], campaign["fluxRoute"]["height"]), status.get("started_at")))
        else:
            errors.append(f"terminal Greenroom status is {status.get('status')}")
        record = {
            "id": cell["id"], "group": cell["group"], "status": status.get("status"), "jobId": submission["jobId"],
            "source": campaign["source"]["path"], "sourceSha256": campaign["source"]["sha256"],
            "prompt": prompt["text"], "promptFile": prompt["file"], "promptBytesSha256": prompt["bytesSha256"],
            "seed": cell["seed"], "requestedRoute": submission["request"], "effectiveRoute": status.get("effective_route"),
            "effectiveParams": status.get("params"), "output": output.relative_to(ROOT).as_posix(),
            "outputSha256": sha256(output) if output.is_file() else None,
            "receipt": receipt, "failureState": "; ".join(errors) if errors else "none",
        }
        generated.append(record)
        if errors:
            failures.append({"id": cell["id"], "jobId": submission["jobId"], "errors": errors, "status": status})
    controls, control_failures = external_controls(campaign)
    failures.extend(control_failures)
    ledger = {
        "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.results.v0",
        "campaign": "campaign.json", "campaignSha256": sha256(CAMPAIGN),
        "submissions": "submissions.json", "submissionsSha256": sha256(SUBMISSIONS),
        "collectedAt": time.time(), "cells": generated, "externalControls": controls,
    }
    write_json(LEDGER, ledger)
    if failures:
        write_json(FAILURE, {
            "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.terminal-failure.v0",
            "phase": "terminal-evidence-validation", "lastTrustworthyEvidence": statuses,
            "ledger": "result-ledger.json", "failures": failures,
        })
        write_json(STATE, {"schema": "kaminos.cat-carrier-revision-050-prompt-lighting.collection-state.v0", "phase": "terminal-failure", "failureReport": FAILURE.name})
        print(f"terminal evidence failed for {len(failures)} record(s); wrote {FAILURE}", file=sys.stderr)
        return 1
    STATE.unlink(missing_ok=True)
    FAILURE.unlink(missing_ok=True)
    print(json.dumps({"status": "collected", "cells": len(generated), "controls": len(controls), "ledger": str(LEDGER)}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
