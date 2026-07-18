#!/usr/bin/env python3
import hashlib
import json
import os
import struct
import subprocess
import sys
import tempfile
import time
import zlib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "lirm-silhouette-imagegen-basin-assay.py"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_png(path: Path, width: int = 512, height: int = 512, blank: bool = False) -> None:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)

    rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            if blank:
                row.extend((128, 128, 128))
            else:
                row.extend(((x * 13 + y * 3) % 256, (y * 11 + x) % 256, (x + y * 7) % 256))
        rows.append(bytes(row))
    payload = b"\x89PNG\r\n\x1a\n"
    payload += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    payload += chunk(b"IDAT", zlib.compress(b"".join(rows), 6))
    payload += chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def make_case(root: Path) -> tuple[Path, Path, Path, Path]:
    source = root / "source" / "shape-a"
    for name in ("clay.png", "depth.png", "normal.png"):
        write_png(source / name)
    prompt = root / "assay" / "prompts" / "lineage-seed.txt"
    prompt.parent.mkdir(parents=True)
    prompt.write_text("Grow one coherent organism from this scaffold.\n")
    output_dir = root / "runtime" / "cells" / "shape-a-lineage-seed-clay-normal-seed7"
    output = output_dir / "output.png"
    write_png(output)
    authority = root / "greenroom"
    return source, prompt, output_dir, authority


def write_plan(root: Path, source: Path, prompt: Path, output_dir: Path, authority: Path) -> Path:
    plan = {
        "schema": "kaminos.lirm-silhouette-imagegen-basin-assay-plan.v1",
        "greenroomAuthority": str(authority),
        "expectedRunner": "/opt/mflux-generate-flux2-edit",
        "settings": {
            "model": "flux2-klein-9b",
            "quantize": 4,
            "width": 512,
            "height": 512,
            "steps": 8,
            "guidance": 1.0,
            "mlxCacheLimitGb": 48,
        },
        "cells": [{
            "cellId": "shape-a-lineage-seed-clay-normal-seed7",
            "shape": "shape-a",
            "stance": "lineage-seed",
            "referenceSet": "clay-normal",
            "seed": 7,
            "jobId": "abc123",
            "jobType": "mflux_flux2_edit_promptfile_2ref",
            "inputs": [
                {"role": "clay", "path": str(source / "clay.png"), "sha256": sha256(source / "clay.png")},
                {"role": "normal", "path": str(source / "normal.png"), "sha256": sha256(source / "normal.png")},
            ],
            "prompt": {"path": str(prompt), "sha256": sha256(prompt)},
            "outputDir": str(output_dir),
            "outputPath": str(output_dir / "output.png"),
        }],
    }
    plan_path = root / "assay" / "plan.json"
    plan_path.write_text(json.dumps(plan, indent=2) + "\n")
    return plan_path


def write_greenroom_job(
    plan_path: Path,
    *,
    cell_index: int = 0,
    route_runner: str = "/opt/mflux-generate-flux2-edit",
    status: str = "done",
) -> None:
    plan = json.loads(plan_path.read_text())
    cell = plan["cells"][cell_index]
    authority = Path(plan["greenroomAuthority"])
    job_dir = authority / status / cell["jobId"]
    job_dir.mkdir(parents=True)
    request = {
        "job_type": cell["jobType"],
        "input_path": cell["inputs"][0]["path"],
        "output_dir": cell["outputDir"],
        "params": {
            "reference_path_2": cell["inputs"][1]["path"],
            "prompt_file": cell["prompt"]["path"],
            "model": "flux2-klein-9b",
            "quantize": "4",
            "width": "512",
            "height": "512",
            "steps": "8",
            "guidance": "1.0",
            "seed": "7",
            "mlx_cache_limit_gb": "48",
        },
        "job_id": cell["jobId"],
        "submitted_at": time.time() - 1,
    }
    route = (
        f"{route_runner} --image-paths {cell['inputs'][0]['path']} {cell['inputs'][1]['path']} "
        f"--prompt-file {cell['prompt']['path']} --output {cell['outputPath']} "
        "--metadata --model flux2-klein-9b --quantize 4 --height 512 --width 512 "
        "--steps 8 --guidance 1.0 --seed 7 --mlx-cache-limit-gb 48"
    )
    receipt = {
        "job_id": cell["jobId"],
        "job_type": cell["jobType"],
        "status": status,
        "input_path": cell["inputs"][0]["path"],
        "output_dir": cell["outputDir"],
        "effective_route": route,
        "started_at": time.time() - 1,
        "finished_at": time.time(),
        "exit_code": 0 if status == "done" else 1,
        "failure_phase": None if status == "done" else "inference",
        "error_message": None if status == "done" else "synthetic failure",
        "warnings": None,
    }
    (job_dir / "request.json").write_text(json.dumps(request, indent=2) + "\n")
    (job_dir / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")


def collect(plan_path: Path, report_path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(SCRIPT), "collect", "--plan", str(plan_path), "--report", str(report_path)],
        text=True,
        capture_output=True,
        check=False,
    )


assert SCRIPT.exists(), "receipt-bearing basin assay runner must exist"

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    write_greenroom_job(plan_path)
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode == 0, result.stderr
    report = json.loads(report_path.read_text())
    assert report["schema"] == "kaminos.lirm-silhouette-imagegen-basin-assay-report.v1"
    assert report["allVerified"] is True
    assert report["verifiedCellCount"] == 1
    assert report["cells"][0]["output"]["sha256"] == sha256(output_dir / "output.png")
    assert report["cells"][0]["effectiveRouteIdentity"]["runner"] == "/opt/mflux-generate-flux2-edit"

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    write_greenroom_job(plan_path, route_runner="/wrong/fallback-runner")
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode != 0
    report = json.loads(report_path.read_text())
    assert report["allVerified"] is False
    assert "effective_route_mismatch" in report["cells"][0]["failureCodes"]

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    write_greenroom_job(plan_path)
    request_path = authority / "done" / "abc123" / "request.json"
    request = json.loads(request_path.read_text())
    request["params"].pop("reference_path_2")
    request_path.write_text(json.dumps(request, indent=2) + "\n")
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode != 0
    assert "reference_mismatch" in json.loads(report_path.read_text())["cells"][0]["failureCodes"]

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    write_png(output_dir / "output.png", blank=True)
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    write_greenroom_job(plan_path)
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode != 0
    assert "output_visual_invalid" in json.loads(report_path.read_text())["cells"][0]["failureCodes"]

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    write_greenroom_job(plan_path)
    old = time.time() - 100
    os.utime(output_dir / "output.png", (old, old))
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode != 0
    assert "output_stale" in json.loads(report_path.read_text())["cells"][0]["failureCodes"]

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    (output_dir / "output.png").unlink()
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    write_greenroom_job(plan_path, status="failed")
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode != 0
    report = json.loads(report_path.read_text())
    assert report["cells"][0]["failurePhase"] == "inference"
    assert report["cells"][0]["lastTrustworthyEvidence"] == "greenroom_failure_receipt"

with tempfile.TemporaryDirectory() as temp:
    root = Path(temp)
    source, prompt, output_dir, authority = make_case(root)
    plan_path = write_plan(root, source, prompt, output_dir, authority)
    plan = json.loads(plan_path.read_text())
    duplicate = dict(plan["cells"][0])
    duplicate["cellId"] = "shape-a-lineage-seed-clay-normal-seed8"
    duplicate["jobId"] = "def456"
    duplicate["seed"] = 8
    duplicate_dir = root / "runtime" / "cells" / duplicate["cellId"]
    duplicate["outputDir"] = str(duplicate_dir)
    duplicate["outputPath"] = str(duplicate_dir / "output.png")
    duplicate_dir.mkdir(parents=True)
    (duplicate_dir / "output.png").write_bytes((output_dir / "output.png").read_bytes())
    plan["cells"].append(duplicate)
    plan_path.write_text(json.dumps(plan, indent=2) + "\n")
    write_greenroom_job(plan_path, cell_index=0)
    write_greenroom_job(plan_path, cell_index=1)
    report_path = root / "assay" / "report.json"
    result = collect(plan_path, report_path)
    assert result.returncode != 0
    report = json.loads(report_path.read_text())
    assert report["verifiedCellCount"] == 0
    assert all(cell["verified"] is False for cell in report["cells"])
    assert all("duplicate_output" in cell["failureCodes"] for cell in report["cells"])

print("lirm silhouette imagegen basin assay contracts passed")
