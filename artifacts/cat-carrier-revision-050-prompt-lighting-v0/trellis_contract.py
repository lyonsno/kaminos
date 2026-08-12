#!/usr/bin/env python3
"""Pure validation helpers for the prompt-lighting Trellis continuation."""

import hashlib
import shlex
from pathlib import Path


def route_errors(effective_route: str, expected: dict) -> list[str]:
    argv = shlex.split(effective_route)
    errors = []
    if sum(Path(token).name == "generate.py" for token in argv) != 1:
        errors.append("effective route does not name generate.py exactly once")
    required = {
        "--image": expected["input"],
        "--output": expected["output"],
        "--seed": str(expected["seed"]),
        "--steps": str(expected["steps"]),
        "--target-faces": str(expected["targetFaces"]),
        "--texture-size": str(expected["textureSize"]),
    }
    for option, value in required.items():
        positions = [index for index, token in enumerate(argv) if token == option]
        if (
            len(positions) != 1
            or positions[0] + 1 >= len(argv)
            or argv[positions[0] + 1] != value
        ):
            errors.append(f"effective route does not bind {option}={value}")
    return errors


def primary_output_errors(path, expected_sha256: str | None = None) -> list[str]:
    path = Path(path)
    if not path.is_file():
        return ["primary output is missing"]
    if path.stat().st_size <= 4096:
        return ["primary output is suspiciously small"]
    if expected_sha256 is not None:
        observed = hashlib.sha256(path.read_bytes()).hexdigest()
        if observed != expected_sha256:
            return ["primary output hash drifted"]
    return []


def validate_result_coverage(
    selection: dict, ledger: dict, selection_sha256: str
) -> list[str]:
    if ledger.get("selectionSha256") != selection_sha256:
        raise RuntimeError("Trellis result ledger does not bind the current selection")
    cell_ids = [row["cellId"] for row in selection.get("candidates", [])]
    if len(cell_ids) != len(set(cell_ids)):
        raise RuntimeError("Trellis selection contains duplicate cells")
    if set(ledger.get("cells", {})) != set(cell_ids):
        raise RuntimeError("Trellis result ledger does not exactly cover the selection")
    return cell_ids


def validated_orbit_outputs(manifest: dict) -> list[Path]:
    if manifest.get("status") != "completed":
        raise RuntimeError("orbit manifest is not completed")
    outputs = manifest.get("outputs") or []
    if len(outputs) != 6:
        raise RuntimeError("orbit manifest must contain exactly six frames")
    paths = []
    for row in outputs:
        path = Path(row.get("path", ""))
        if not path.is_file():
            raise RuntimeError(f"orbit frame is missing: {path}")
        observed = hashlib.sha256(path.read_bytes()).hexdigest()
        if observed != row.get("sha256"):
            raise RuntimeError(f"orbit frame hash mismatch: {path}")
        paths.append(path)
    return paths
