#!/usr/bin/env python3
"""Plan, submit, and verify a receipt-bearing Flux2 morphology-basin assay."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shlex
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path
from typing import Any


PLAN_SCHEMA = "kaminos.lirm-silhouette-imagegen-basin-assay-plan.v1"
REPORT_SCHEMA = "kaminos.lirm-silhouette-imagegen-basin-assay-report.v1"
DEFAULT_EXPECTED_RUNNER = "/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit"
REFERENCE_ROLES = {
    "clay-normal": ("clay", "normal"),
    "clay-depth-normal": ("clay", "depth", "normal"),
}
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    temp.write_text(json.dumps(payload, indent=2, sort_keys=False) + "\n")
    temp.replace(path)


def resolve_within(root: Path, candidate: Path, field: str) -> Path:
    root = root.resolve()
    candidate = candidate.resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError(f"{field} escapes source root: {candidate}")
    return candidate


def parse_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def parse_stances(values: list[str]) -> dict[str, Path]:
    stances: dict[str, Path] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"stance must be NAME=PATH, got {value!r}")
        name, raw_path = value.split("=", 1)
        path = Path(raw_path).resolve()
        if not name or not path.is_file():
            raise ValueError(f"invalid stance {value!r}")
        stances[name] = path
    if not stances:
        raise ValueError("at least one --stance NAME=PATH is required")
    return stances


def png_visual_stats(path: Path) -> dict[str, Any]:
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("output is not a PNG")
    offset = len(PNG_SIGNATURE)
    chunks: list[bytes] = []
    width = height = bit_depth = color_type = interlace = None
    while offset + 12 <= len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        if len(payload) != length:
            raise ValueError("truncated PNG chunk")
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", payload)
        elif kind == b"IDAT":
            chunks.append(payload)
        elif kind == b"IEND":
            break
        offset += 12 + length
    if None in (width, height, bit_depth, color_type, interlace):
        raise ValueError("PNG missing IHDR")
    if bit_depth != 8 or color_type not in (2, 6) or interlace != 0:
        raise ValueError(f"unsupported PNG layout bit_depth={bit_depth} color_type={color_type} interlace={interlace}")
    channels = 3 if color_type == 2 else 4
    stride = width * channels
    raw = zlib.decompress(b"".join(chunks))
    if len(raw) != height * (stride + 1):
        raise ValueError("PNG decompressed byte count mismatch")

    rows: list[bytearray] = []
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        cursor += 1
        encoded = raw[cursor:cursor + stride]
        cursor += stride
        previous = rows[-1] if rows else bytearray(stride)
        decoded = bytearray(stride)
        for index, value in enumerate(encoded):
            left = decoded[index - channels] if index >= channels else 0
            up = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                base = left + up - upper_left
                distances = (abs(base - left), abs(base - up), abs(base - upper_left))
                predictor = (left, up, upper_left)[distances.index(min(distances))]
            else:
                raise ValueError(f"unsupported PNG filter {filter_type}")
            decoded[index] = (value + predictor) & 0xFF
        rows.append(decoded)

    sample_step = max(1, (width * height) // 16384)
    samples: set[tuple[int, int, int]] = set()
    rgb_min = [255, 255, 255]
    rgb_max = [0, 0, 0]
    pixel_index = 0
    for row in rows:
        for offset in range(0, stride, channels):
            if pixel_index % sample_step == 0:
                rgb = tuple(row[offset:offset + 3])
                samples.add(rgb)
                for channel, value in enumerate(rgb):
                    rgb_min[channel] = min(rgb_min[channel], value)
                    rgb_max[channel] = max(rgb_max[channel], value)
            pixel_index += 1
    dynamic_range = max(rgb_max[channel] - rgb_min[channel] for channel in range(3))
    return {
        "width": width,
        "height": height,
        "colorType": color_type,
        "sampledUniqueRgb": len(samples),
        "sampledDynamicRange": dynamic_range,
        "nonblank": len(samples) >= 16 and dynamic_range >= 16,
    }


def create_plan(args: argparse.Namespace) -> dict[str, Any]:
    source_root = Path(args.source_dir).resolve()
    output_root = Path(args.out_dir).resolve()
    runtime_root = Path(args.runtime_root).resolve()
    stances = parse_stances(args.stance)
    generations = parse_csv(args.generation_ids)
    reference_sets = parse_csv(args.reference_sets)
    seeds = [int(value) for value in parse_csv(args.seeds)]
    if not generations or not seeds:
        raise ValueError("generation ids and seeds must be nonempty")
    unknown = set(reference_sets) - set(REFERENCE_ROLES)
    if unknown:
        raise ValueError(f"unsupported reference sets: {sorted(unknown)}")

    settings = {
        "model": args.model,
        "quantize": args.quantize,
        "width": args.width,
        "height": args.height,
        "steps": args.steps,
        "guidance": args.guidance,
        "mlxCacheLimitGb": args.mlx_cache_limit_gb,
    }
    cells = []
    for generation in generations:
        generation_root = resolve_within(source_root, source_root / generation, "generation")
        for stance, prompt_path in stances.items():
            for reference_set in reference_sets:
                roles = REFERENCE_ROLES[reference_set]
                inputs = []
                for role in roles:
                    source_path = resolve_within(source_root, generation_root / f"{role}.png", f"{role} input")
                    if not source_path.is_file():
                        raise ValueError(f"missing {role} input: {source_path}")
                    inputs.append({"role": role, "path": str(source_path), "sha256": sha256_path(source_path)})
                for seed in seeds:
                    cell_id = f"{generation}-{stance}-{reference_set}-seed{seed}"
                    output_dir = runtime_root / "cells" / cell_id
                    cells.append({
                        "cellId": cell_id,
                        "shape": generation,
                        "stance": stance,
                        "referenceSet": reference_set,
                        "seed": seed,
                        "jobId": None,
                        "jobType": "mflux_flux2_edit_promptfile_3ref" if len(roles) == 3 else "mflux_flux2_edit_promptfile_2ref",
                        "inputs": inputs,
                        "prompt": {"path": str(prompt_path), "sha256": sha256_path(prompt_path)},
                        "outputDir": str(output_dir),
                        "outputPath": str(output_dir / "output.png"),
                    })
    plan = {
        "schema": PLAN_SCHEMA,
        "createdAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sourceRoot": str(source_root),
        "artifactRoot": str(output_root),
        "runtimeRoot": str(runtime_root),
        "greenroomAuthority": str(Path(args.greenroom_authority).expanduser().resolve()),
        "requestedRoutes": sorted({cell["jobType"] for cell in cells}),
        "expectedRunner": args.expected_runner,
        "settings": settings,
        "cellCount": len(cells),
        "cells": cells,
    }
    atomic_write_json(output_root / "plan.json", plan)
    return plan


def submission_report(plan: dict[str, Any]) -> dict[str, Any]:
    submitted = [cell for cell in plan["cells"] if cell.get("jobId")]
    failures = [cell for cell in plan["cells"] if cell.get("submissionFailure")]
    return {
        "schema": "kaminos.lirm-silhouette-imagegen-basin-assay-submission-report.v1",
        "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "plannedCellCount": len(plan["cells"]),
        "submittedCellCount": len(submitted),
        "submissionFailureCount": len(failures),
        "complete": len(submitted) == len(plan["cells"]) and not failures,
        "cells": [{
            "cellId": cell["cellId"],
            "jobId": cell.get("jobId"),
            "submissionFailure": cell.get("submissionFailure"),
            "lastTrustworthyEvidence": "greenroom_submission_receipt" if cell.get("jobId") else "assay_plan",
        } for cell in plan["cells"]],
    }


def submit_plan(args: argparse.Namespace) -> int:
    plan_path = Path(args.plan).resolve()
    plan = json.loads(plan_path.read_text())
    if plan.get("schema") != PLAN_SCHEMA:
        raise ValueError("unsupported plan schema")
    report_path = Path(args.report).resolve() if args.report else plan_path.with_name("submission-report.json")
    settings = plan["settings"]
    for cell in plan["cells"]:
        if cell.get("jobId"):
            continue
        params = {
            "prompt_file": cell["prompt"]["path"],
            "model": settings["model"],
            "quantize": settings["quantize"],
            "width": settings["width"],
            "height": settings["height"],
            "steps": settings["steps"],
            "guidance": settings["guidance"],
            "seed": cell["seed"],
            "mlx_cache_limit_gb": settings["mlxCacheLimitGb"],
        }
        for index, input_item in enumerate(cell["inputs"][1:], start=2):
            params[f"reference_path_{index}"] = input_item["path"]
        command = [args.greenroom_cli, "submit", cell["jobType"], cell["inputs"][0]["path"], cell["outputDir"], "-p"]
        command.extend(f"{key}={value}" for key, value in params.items())
        result = subprocess.run(command, text=True, capture_output=True, check=False)
        match = re.search(r"Submitted job ([a-f0-9]+)", result.stdout)
        if result.returncode == 0 and match:
            cell["jobId"] = match.group(1)
            cell.pop("submissionFailure", None)
        else:
            cell["submissionFailure"] = {
                "phase": "greenroom_submit",
                "returnCode": result.returncode,
                "stdout": result.stdout,
                "stderr": result.stderr,
            }
        atomic_write_json(plan_path, plan)
        atomic_write_json(report_path, submission_report(plan))
        if cell.get("submissionFailure"):
            return 1
    return 0


def locate_job(authority: Path, job_id: str) -> tuple[str | None, Path | None]:
    for status in ("done", "failed", "running", "pending", "cancelled"):
        path = authority / status / job_id
        if path.is_dir():
            return status, path
    return None, None


def expected_params(plan: dict[str, Any], cell: dict[str, Any]) -> dict[str, str]:
    settings = plan["settings"]
    params = {
        "prompt_file": cell["prompt"]["path"],
        "model": str(settings["model"]),
        "quantize": str(settings["quantize"]),
        "width": str(settings["width"]),
        "height": str(settings["height"]),
        "steps": str(settings["steps"]),
        "guidance": str(settings["guidance"]),
        "seed": str(cell["seed"]),
        "mlx_cache_limit_gb": str(settings["mlxCacheLimitGb"]),
    }
    for index, item in enumerate(cell["inputs"][1:], start=2):
        params[f"reference_path_{index}"] = item["path"]
    return params


def verify_completed_cell(plan: dict[str, Any], cell: dict[str, Any]) -> dict[str, Any]:
    failures: list[str] = []
    authority = Path(plan["greenroomAuthority"])
    job_id = cell.get("jobId")
    result: dict[str, Any] = {
        "cellId": cell["cellId"],
        "jobId": job_id,
        "shape": cell["shape"],
        "stance": cell["stance"],
        "referenceSet": cell["referenceSet"],
        "seed": cell["seed"],
        "verified": False,
        "failureCodes": failures,
        "failurePhase": None,
        "lastTrustworthyEvidence": "assay_plan",
    }
    if not job_id:
        failures.append("job_not_submitted")
        return result
    status, job_dir = locate_job(authority, job_id)
    result["observedGreenroomStatus"] = status
    if job_dir is None:
        failures.append("job_missing")
        return result
    result["lastTrustworthyEvidence"] = "greenroom_job_directory"
    if status in ("running", "pending"):
        failures.append("job_incomplete")
        return result
    request_path = job_dir / "request.json"
    receipt_path = job_dir / "receipt.json"
    if not request_path.is_file() or not receipt_path.is_file():
        failures.append("route_evidence_missing")
        return result
    request = json.loads(request_path.read_text())
    receipt = json.loads(receipt_path.read_text())
    result.update({
        "requestPath": str(request_path),
        "requestSha256": sha256_path(request_path),
        "receiptPath": str(receipt_path),
        "receiptSha256": sha256_path(receipt_path),
        "failurePhase": receipt.get("failure_phase"),
        "lastTrustworthyEvidence": "greenroom_failure_receipt" if status == "failed" else "greenroom_completion_receipt",
    })
    if status != "done" or receipt.get("status") != "done" or receipt.get("exit_code") != 0:
        failures.append("job_failed")
        result["errorMessage"] = receipt.get("error_message")
        return result

    if request.get("job_id") != job_id or receipt.get("job_id") != job_id:
        failures.append("job_identity_mismatch")
    if request.get("job_type") != cell["jobType"] or receipt.get("job_type") != cell["jobType"]:
        failures.append("job_type_mismatch")
    if request.get("input_path") != cell["inputs"][0]["path"] or receipt.get("input_path") != cell["inputs"][0]["path"]:
        failures.append("primary_input_mismatch")
    if request.get("output_dir") != cell["outputDir"] or receipt.get("output_dir") != cell["outputDir"]:
        failures.append("output_route_mismatch")

    expected = expected_params(plan, cell)
    observed = {key: str(value) for key, value in request.get("params", {}).items()}
    reference_keys = {key for key in expected if key.startswith("reference_path_")}
    if any(observed.get(key) != expected[key] for key in reference_keys) or any(
        key.startswith("reference_path_") and key not in reference_keys for key in observed
    ):
        failures.append("reference_mismatch")
    for key, value in expected.items():
        if key not in reference_keys and observed.get(key) != value:
            failures.append("requested_config_mismatch")
            break

    for item in cell["inputs"]:
        path = Path(item["path"])
        if not path.is_file() or sha256_path(path) != item["sha256"]:
            failures.append("source_input_changed")
            break
    prompt_path = Path(cell["prompt"]["path"])
    if not prompt_path.is_file() or sha256_path(prompt_path) != cell["prompt"]["sha256"]:
        failures.append("prompt_changed")

    effective_route = receipt.get("effective_route") or ""
    try:
        route_tokens = shlex.split(effective_route)
    except ValueError:
        route_tokens = []
    runner = route_tokens[0] if route_tokens else None
    result["effectiveRouteIdentity"] = {"runner": runner, "route": effective_route}
    if runner != plan["expectedRunner"]:
        failures.append("effective_route_mismatch")
    expected_image_paths = [item["path"] for item in cell["inputs"]]
    try:
        image_flag = route_tokens.index("--image-paths")
        prompt_flag = route_tokens.index("--prompt-file")
        route_image_paths = route_tokens[image_flag + 1:prompt_flag]
    except ValueError:
        route_image_paths = []
    if route_image_paths != expected_image_paths:
        failures.append("effective_reference_mismatch")
    required_route_pairs = {
        "--prompt-file": cell["prompt"]["path"],
        "--output": cell["outputPath"],
        "--model": str(plan["settings"]["model"]),
        "--quantize": str(plan["settings"]["quantize"]),
        "--width": str(plan["settings"]["width"]),
        "--height": str(plan["settings"]["height"]),
        "--steps": str(plan["settings"]["steps"]),
        "--guidance": str(plan["settings"]["guidance"]),
        "--seed": str(cell["seed"]),
        "--mlx-cache-limit-gb": str(plan["settings"]["mlxCacheLimitGb"]),
    }
    for flag, value in required_route_pairs.items():
        try:
            if route_tokens[route_tokens.index(flag) + 1] != value:
                failures.append("effective_config_mismatch")
                break
        except (ValueError, IndexError):
            failures.append("effective_config_mismatch")
            break

    output_path = Path(cell["outputPath"])
    if not output_path.is_file():
        failures.append("output_missing")
        return result
    submitted_at = float(request.get("submitted_at") or 0)
    if output_path.stat().st_mtime + 1e-6 < submitted_at:
        failures.append("output_stale")
    try:
        visual = png_visual_stats(output_path)
        if visual["width"] != plan["settings"]["width"] or visual["height"] != plan["settings"]["height"] or not visual["nonblank"]:
            failures.append("output_visual_invalid")
    except (OSError, ValueError, zlib.error) as error:
        visual = {"nonblank": False, "error": str(error)}
        failures.append("output_visual_invalid")
    result["output"] = {
        "path": str(output_path),
        "sha256": sha256_path(output_path),
        "bytes": output_path.stat().st_size,
        "visual": visual,
    }
    result["verified"] = not failures
    if result["verified"]:
        result["lastTrustworthyEvidence"] = "verified_generated_output"
    return result


def collect_plan(args: argparse.Namespace) -> int:
    plan_path = Path(args.plan).resolve()
    report_path = Path(args.report).resolve()
    plan = json.loads(plan_path.read_text())
    if plan.get("schema") != PLAN_SCHEMA:
        raise ValueError("unsupported plan schema")
    cells = [verify_completed_cell(plan, cell) for cell in plan["cells"]]
    seen_hashes: dict[str, str] = {}
    for cell in cells:
        output_hash = cell.get("output", {}).get("sha256")
        if not output_hash:
            continue
        if output_hash in seen_hashes:
            cell["failureCodes"].append("duplicate_output")
            cell["verified"] = False
        else:
            seen_hashes[output_hash] = cell["cellId"]
    verified = sum(bool(cell["verified"]) for cell in cells)
    report = {
        "schema": REPORT_SCHEMA,
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "planPath": str(plan_path),
        "planSha256": sha256_path(plan_path),
        "plannedCellCount": len(cells),
        "verifiedCellCount": verified,
        "allVerified": verified == len(cells),
        "cells": cells,
    }
    atomic_write_json(report_path, report)
    return 0 if report["allVerified"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    plan = subparsers.add_parser("plan", help="write an immutable-input matrix plan")
    plan.add_argument("--source-dir", required=True)
    plan.add_argument("--out-dir", required=True)
    plan.add_argument("--runtime-root", required=True)
    plan.add_argument("--greenroom-authority", default="~/.local/state/gpu-greenroom")
    plan.add_argument("--expected-runner", default=DEFAULT_EXPECTED_RUNNER)
    plan.add_argument("--generation-ids", required=True)
    plan.add_argument("--stance", action="append", default=[], help="NAME=PATH; repeat for each prompt stance")
    plan.add_argument("--reference-sets", default="clay-normal,clay-depth-normal")
    plan.add_argument("--seeds", required=True)
    plan.add_argument("--model", default="flux2-klein-9b")
    plan.add_argument("--quantize", type=int, default=4)
    plan.add_argument("--width", type=int, default=512)
    plan.add_argument("--height", type=int, default=512)
    plan.add_argument("--steps", type=int, default=8)
    plan.add_argument("--guidance", type=float, default=1.0)
    plan.add_argument("--mlx-cache-limit-gb", type=int, default=48)

    submit = subparsers.add_parser("submit", help="idempotently submit unassigned plan cells")
    submit.add_argument("--plan", required=True)
    submit.add_argument("--greenroom-cli", default=str(Path("~/dev/gpu-greenroom/.venv/bin/gpu-greenroom").expanduser()))
    submit.add_argument("--report")

    collect = subparsers.add_parser("collect", help="verify Greenroom route and generated-output evidence")
    collect.add_argument("--plan", required=True)
    collect.add_argument("--report", required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "plan":
            plan = create_plan(args)
            print(f"Wrote {plan['cellCount']}-cell plan to {Path(args.out_dir).resolve() / 'plan.json'}")
            return 0
        if args.command == "submit":
            return submit_plan(args)
        return collect_plan(args)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
