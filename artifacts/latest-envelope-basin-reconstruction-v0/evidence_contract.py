#!/usr/bin/env python3
"""Shared durable failure-report contract for the campaign harness."""

import json
from pathlib import Path


def write_failure_report(
    path: Path,
    *,
    schema: str,
    phase: str,
    statuses: dict,
    failures: dict,
) -> None:
    payload = {
        "schema": schema,
        "failurePhase": phase,
        "lastTrustworthyEvidence": statuses,
        "failures": failures,
    }
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n")
    temporary.replace(path)
