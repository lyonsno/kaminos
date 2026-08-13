#!/usr/bin/env python3
"""Admit the exact second-pass FLUX result when its Greenroom job terminates."""

import json
import tempfile
from pathlib import Path

from roundtrip_contract import admit_flux_result, validate_second_pass


ROOT = Path(__file__).resolve().parent
SUBMISSION = ROOT / "second-pass-submission.json"
RESULT = ROOT / "second-pass-result.json"


def atomic_json(path: Path, payload: dict) -> None:
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False) as handle:
        json.dump(payload, handle, indent=2)
        handle.write("\n")
        temporary = Path(handle.name)
    temporary.replace(path)


def main() -> int:
    validated = validate_second_pass(ROOT)
    cell = validated["cell"]
    submission = json.loads(SUBMISSION.read_text())
    if submission.get("cellId") != cell["id"]:
        raise RuntimeError("submission belongs to another second-pass cell")
    try:
        evidence = admit_flux_result(
            queue_root=Path(submission["queueRoot"]),
            job_id=submission["jobId"],
            expected_input=(ROOT / cell["input"]).resolve(),
            output_dir=(ROOT / cell["outputDir"]).resolve(),
            expected_prompt_file=(ROOT / cell["promptFile"]).resolve(),
            expected_seed=cell["seed"],
        )
    except RuntimeError as exc:
        if "not terminal" in str(exc):
            return 2
        raise
    record = {
        "schema": "kaminos.polygonal-cat-roundtrip.second-pass-result.v0",
        "cellId": cell["id"],
        "evidence": evidence,
        "claimCeiling": json.loads((ROOT / "second-pass.json").read_text())["claimCeiling"],
    }
    atomic_json(RESULT, record)
    print(json.dumps(record, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
