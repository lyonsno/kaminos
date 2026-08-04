"""Terminal evidence contract and visual plate for the projection sentinel."""

from __future__ import annotations

import base64
import copy
import hashlib
import html
import json
from pathlib import Path
import re
import struct
from typing import Any, Mapping
import zlib

from source_plate_projection_sentinel import (
    CARRIER_TOPOLOGIES,
    validate_projection_sentinel_plan,
)


RESULT_SCHEMA = "kaminos.source-plate-projection-sentinel-result.v0"
PUBLIC_RESULT_SCHEMA = "kaminos.source-plate-projection-sentinel-public-result.v0"


class ProjectionSentinelResultError(ValueError):
    """A terminal evidence failure that must not look like a complete result."""


def _fail(message: str) -> None:
    raise ProjectionSentinelResultError(message)


def _sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _canonical_sha256(value: Any) -> str:
    payload = json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")
    return _sha256_bytes(payload)


def result_sha256(result: dict[str, Any]) -> str:
    payload = copy.deepcopy(result)
    payload.pop("resultSha256", None)
    return _canonical_sha256(payload)


def public_result_sha256(result: dict[str, Any]) -> str:
    payload = copy.deepcopy(result)
    payload.pop("publicResultSha256", None)
    return _canonical_sha256(payload)


def _portable_artifact_path(path_value: str) -> str:
    normalized = path_value.replace("\\", "/")
    marker = "artifacts/"
    marker_index = normalized.find(marker)
    if marker_index < 0:
        return f"artifacts/runtime-path-redacted/{Path(normalized).name}"
    return normalized[marker_index:]


def _verified_file(path: Path, expected_sha256: str | None = None) -> bytes:
    if not path.is_file():
        _fail(f"required evidence file is missing: {path}")
    payload = path.read_bytes()
    if expected_sha256 is not None and _sha256_bytes(payload) != expected_sha256:
        _fail(f"evidence SHA-256 mismatch: {path}")
    return payload


def _option_value(argv: list[str], option: str) -> str:
    try:
        index = argv.index(option)
    except ValueError:
        _fail(f"effective route omits {option}")
    if index + 1 >= len(argv) or argv[index + 1].startswith("--"):
        _fail(f"effective route lacks a value for {option}")
    return argv[index + 1]


def _effective_image_paths(argv: list[str]) -> list[str]:
    try:
        start = argv.index("--image-paths") + 1
    except ValueError:
        _fail("effective route omits --image-paths")
    end = start
    while end < len(argv) and not argv[end].startswith("--"):
        end += 1
    if end == start:
        _fail("effective route has no conditioning image paths")
    return argv[start:end]


def _validate_png_output(path: Path) -> bytes:
    if not path.is_file():
        _fail(f"output is missing: {path}")
    payload = path.read_bytes()
    if len(payload) < 64:
        _fail(f"output PNG is partial or implausibly small: {path}")
    if payload[:8] != b"\x89PNG\r\n\x1a\n":
        _fail(f"output is not a PNG: {path}")
    offset = 8
    chunk_index = 0
    saw_ihdr = False
    saw_idat = False
    saw_iend = False
    while offset < len(payload):
        if offset + 12 > len(payload):
            _fail(f"output PNG has a truncated chunk header: {path}")
        length = struct.unpack(">I", payload[offset : offset + 4])[0]
        chunk_type = payload[offset + 4 : offset + 8]
        chunk_end = offset + 12 + length
        if chunk_end > len(payload):
            _fail(f"output PNG has a truncated {chunk_type!r} chunk: {path}")
        chunk_data = payload[offset + 8 : offset + 8 + length]
        recorded_crc = struct.unpack(">I", payload[offset + 8 + length : chunk_end])[0]
        measured_crc = zlib.crc32(chunk_type + chunk_data) & 0xFFFFFFFF
        if recorded_crc != measured_crc:
            _fail(f"output PNG has a corrupt {chunk_type!r} chunk: {path}")
        if chunk_index == 0:
            if chunk_type != b"IHDR" or length != 13:
                _fail(f"output PNG does not begin with a valid IHDR chunk: {path}")
            width, height = struct.unpack(">II", chunk_data[:8])
            if width <= 0 or height <= 0:
                _fail(f"output PNG has invalid dimensions: {path}")
            saw_ihdr = True
        elif chunk_type == b"IHDR":
            _fail(f"output PNG contains a duplicate IHDR chunk: {path}")
        if chunk_type == b"IDAT":
            saw_idat = True
        if chunk_type == b"IEND":
            if length != 0 or chunk_end != len(payload):
                _fail(f"output PNG has malformed or trailing IEND data: {path}")
            saw_iend = True
            break
        offset = chunk_end
        chunk_index += 1
    if not saw_ihdr or not saw_idat or not saw_iend:
        _fail(f"output PNG is incomplete: {path}")
    return payload


_HOST_COORDINATE = re.compile(
    r"(?:file://)?/(?:Users|home|private|var/folders|Volumes|mnt|tmp)/|[A-Za-z]:[\\/]"
)


def _contains_host_coordinate(value: Any) -> bool:
    if isinstance(value, str):
        return _HOST_COORDINATE.search(value) is not None
    if isinstance(value, dict):
        return any(_contains_host_coordinate(key) or _contains_host_coordinate(item) for key, item in value.items())
    if isinstance(value, (list, tuple)):
        return any(_contains_host_coordinate(item) for item in value)
    return False


def _validated_jobs(plan: dict[str, Any], jobs: dict[str, Any]) -> dict[str, dict[str, Any]]:
    if jobs.get("schema") != "kaminos.source-plate-projection-sentinel-jobs.v0":
        _fail("unsupported projection sentinel jobs ledger")
    if jobs.get("planSha256") != plan["planSha256"]:
        _fail("jobs ledger belongs to another projection sentinel plan")
    rows = jobs.get("jobs")
    if not isinstance(rows, list):
        _fail("jobs ledger lacks job rows")
    by_cell = {
        row.get("cellId"): row
        for row in rows
        if isinstance(row, dict) and isinstance(row.get("cellId"), str)
    }
    if set(by_cell) != set(CARRIER_TOPOLOGIES) or len(by_cell) != len(rows):
        _fail("jobs ledger is missing, duplicating, or adding carrier cells")
    return by_cell


def build_projection_sentinel_result(
    plan: dict[str, Any],
    *,
    jobs: dict[str, Any],
    receipt_paths: Mapping[str, Path | str],
    visual_findings: Mapping[str, dict[str, Any]],
) -> dict[str, Any]:
    """Bind terminal route receipts, outputs, and human visual inspection."""

    validate_projection_sentinel_plan(plan)
    by_job = _validated_jobs(plan, jobs)
    if set(receipt_paths) != set(CARRIER_TOPOLOGIES):
        _fail("terminal receipt inventory must cover exactly four carrier cells")
    if set(visual_findings) != set(CARRIER_TOPOLOGIES):
        _fail("visual finding inventory must cover exactly four carrier cells")

    fixed = plan["fixedGenerator"]
    expected_options = {
        "--prompt-file": fixed["promptPath"],
        "--model": str(fixed["model"]),
        "--quantize": str(fixed["quantize"]),
        "--width": str(fixed["width"]),
        "--height": str(fixed["height"]),
        "--steps": str(fixed["steps"]),
        "--guidance": f"{fixed['guidance']:.1f}",
        "--seed": str(fixed["seed"]),
        "--mlx-cache-limit-gb": "48",
    }
    cells = []
    for cell in plan["cells"]:
        cell_id = cell["id"]
        job = by_job[cell_id]
        expected_job_type = cell["requestedRoute"].removeprefix("gpu-greenroom/")
        if job.get("requestedRoute") != cell["requestedRoute"]:
            _fail(f"cell {cell_id} requested route drifted before submission")
        if job.get("jobType") != expected_job_type:
            _fail(f"cell {cell_id} submitted job type does not match requested route")
        expected_input_paths = [
            plan["source"]["images"][role]["path"]
            for role in cell["carrierRoles"]
        ]
        if job.get("inputPaths") != expected_input_paths:
            _fail(f"cell {cell_id} jobs ledger disagrees with plan-derived conditioning inputs")

        receipt_path = Path(receipt_paths[cell_id]).resolve()
        receipt_bytes = _verified_file(receipt_path)
        try:
            receipt = json.loads(receipt_bytes)
        except json.JSONDecodeError as exc:
            _fail(f"cell {cell_id} receipt is not valid JSON: {exc}")
        if receipt.get("job_id") != job.get("jobId"):
            _fail(f"cell {cell_id} receipt belongs to another job")
        if receipt.get("status") != "done" or receipt.get("exit_code") != 0:
            _fail(f"cell {cell_id} is not a successful terminal job")
        if receipt.get("failure_phase") is not None or receipt.get("error_message") is not None:
            _fail(f"cell {cell_id} receipt contains terminal failure state")
        if receipt.get("job_type") != expected_job_type:
            _fail(f"cell {cell_id} effective job type indicates fallback or route drift")
        argv = receipt.get("effective_argv")
        if not isinstance(argv, list) or not all(isinstance(value, str) for value in argv):
            _fail(f"cell {cell_id} lacks effective argv")
        if not argv or Path(argv[0]).name != "mflux-generate-flux2-edit":
            _fail(f"cell {cell_id} effective renderer is unsupported or fallback")
        if _effective_image_paths(argv) != expected_input_paths:
            _fail(f"cell {cell_id} effective conditioning inputs drifted")
        for option, expected in expected_options.items():
            if _option_value(argv, option) != expected:
                _fail(f"cell {cell_id} effective setting {option} drifted")
        output_path = (Path(job["outputDir"]) / "output.png").resolve()
        if _option_value(argv, "--output") != str(output_path):
            _fail(f"cell {cell_id} effective output path drifted")
        output_bytes = _validate_png_output(output_path)

        finding = visual_findings[cell_id]
        if finding.get("status") != "inspected":
            _fail(f"cell {cell_id} lacks completed human visual inspection")
        if not isinstance(finding.get("projectionVerdict"), str) or not finding["projectionVerdict"].strip():
            _fail(f"cell {cell_id} lacks a projection verdict")
        if not isinstance(finding.get("description"), str) or not finding["description"].strip():
            _fail(f"cell {cell_id} lacks a visual description")

        input_records = [
            {
                "role": role,
                "path": plan["source"]["images"][role]["path"],
                "sha256": plan["source"]["images"][role]["sha256"],
            }
            for role in cell["carrierRoles"]
        ]
        cells.append({
            "id": cell_id,
            "carrierRoles": copy.deepcopy(cell["carrierRoles"]),
            "conditioningInputs": input_records,
            "requestedRoute": cell["requestedRoute"],
            "effectiveJobType": receipt["job_type"],
            "effectiveRenderer": argv[0],
            "effectiveArgv": argv,
            "effectiveCwd": receipt.get("effective_cwd"),
            "jobId": receipt["job_id"],
            "receipt": {
                "path": str(receipt_path),
                "sha256": _sha256_bytes(receipt_bytes),
                "warnings": receipt.get("warnings", []),
                "worker": copy.deepcopy(receipt.get("worker")),
            },
            "output": {
                "path": str(output_path),
                "sha256": _sha256_bytes(output_bytes),
                "byteLength": len(output_bytes),
                "mediaType": "image/png",
                "status": "complete",
                "cached": False,
            },
            "visualInspection": copy.deepcopy(finding),
        })

    prompt_bytes = _verified_file(Path(fixed["promptPath"]), fixed["promptSha256"])
    result = {
        "schema": RESULT_SCHEMA,
        "status": "complete",
        "planSha256": plan["planSha256"],
        "comparisonClass": {
            "matched": [
                "source geometry", "source camera", "prompt", "model revision",
                "seed", "steps", "guidance", "dimensions", "quantization",
            ],
            "varied": ["conditioning carrier topology"],
            "knownCoupling": (
                "depth-plus-normal uses two reference images while the other cells use one; "
                "carrier information and reference cardinality are therefore coupled in that cell"
            ),
        },
        "source": copy.deepcopy(plan["source"]),
        "fullPrompt": prompt_bytes.decode("utf-8").rstrip("\n"),
        "fullPromptSha256": fixed["promptSha256"],
        "fixedGenerator": copy.deepcopy(fixed),
        "cells": cells,
    }
    result["resultSha256"] = result_sha256(result)
    return result


def build_public_projection_sentinel_result(result: dict[str, Any]) -> dict[str, Any]:
    """Project a private runtime result into a public, byte-bound receipt.

    Host paths remain in the private source-signed evidence package. The public
    projection retains content hashes, job ids, route identity, settings,
    portable artifact paths, and visual findings without leaking worktree or
    operator-machine coordinates.
    """

    if result.get("schema") != RESULT_SCHEMA or result.get("status") != "complete":
        _fail("only complete private results can produce a public projection")
    if result.get("resultSha256") != result_sha256(result):
        _fail("private projection sentinel result identity does not match its payload")

    source = result["source"]
    public = {
        "schema": PUBLIC_RESULT_SCHEMA,
        "status": "complete",
        "privateResultSha256": result["resultSha256"],
        "planSha256": result["planSha256"],
        "comparisonClass": copy.deepcopy(result["comparisonClass"]),
        "source": {
            "commit": source["commit"],
            "descriptor": {
                "path": _portable_artifact_path(source["descriptorPath"]),
                "sha256": source["descriptorSha256"],
            },
            "projection": copy.deepcopy(source["projection"]),
            "images": {
                role: {
                    "path": _portable_artifact_path(record["path"]),
                    "sha256": record["sha256"],
                }
                for role, record in source["images"].items()
            },
        },
        "prompt": {
            "fullText": result["fullPrompt"],
            "sha256": result["fullPromptSha256"],
            "path": _portable_artifact_path(result["fixedGenerator"]["promptPath"]),
        },
        "fixedGenerator": {
            key: copy.deepcopy(value)
            for key, value in result["fixedGenerator"].items()
            if key != "promptPath"
        },
        "cells": [],
        "privateRuntimeEvidence": (
            "Exact host paths, effective argv, copied Greenroom receipts, and "
            "failure-boundary state live in the private source-signed coordination return."
        ),
    }
    for cell in result["cells"]:
        public["cells"].append({
            "id": cell["id"],
            "carrierRoles": copy.deepcopy(cell["carrierRoles"]),
            "conditioningInputs": [
                {
                    "role": record["role"],
                    "path": _portable_artifact_path(record["path"]),
                    "sha256": record["sha256"],
                }
                for record in cell["conditioningInputs"]
            ],
            "requestedRoute": cell["requestedRoute"],
            "effectiveRoute": {
                "jobType": cell["effectiveJobType"],
                "renderer": Path(cell["effectiveRenderer"]).name,
                "conditioningInputs": [
                    _portable_artifact_path(record["path"])
                    for record in cell["conditioningInputs"]
                ],
                "output": _portable_artifact_path(cell["output"]["path"]),
            },
            "jobId": cell["jobId"],
            "receiptSha256": cell["receipt"]["sha256"],
            "receiptWarnings": copy.deepcopy(cell["receipt"]["warnings"]),
            "worker": {
                key: copy.deepcopy(value)
                for key, value in (cell["receipt"].get("worker") or {}).items()
                if key in {"commit", "git_dirty", "capabilities"}
            },
            "output": {
                **copy.deepcopy(cell["output"]),
                "path": _portable_artifact_path(cell["output"]["path"]),
            },
            "visualInspection": copy.deepcopy(cell["visualInspection"]),
        })
    public["publicResultSha256"] = public_result_sha256(public)
    if _contains_host_coordinate(public):
        _fail("public result contains a host coordinate")
    return public


def write_public_projection_sentinel_result(path: Path | str, result: dict[str, Any]) -> Path:
    """Write a public-safe result projection to a caller-owned path."""

    if result.get("schema") != PUBLIC_RESULT_SCHEMA:
        _fail("unsupported public projection sentinel result schema")
    if result.get("publicResultSha256") != public_result_sha256(result):
        _fail("public projection sentinel result identity does not match its payload")
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    return destination


def _data_uri(path: str, sha256: str) -> str:
    payload = _verified_file(Path(path), sha256)
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


def build_projection_sentinel_result_html(result: dict[str, Any]) -> str:
    """Render one self-contained side-by-side result plate."""

    if result.get("schema") != RESULT_SCHEMA or result.get("status") != "complete":
        _fail("only complete projection sentinel results can render as authoritative")
    if result.get("resultSha256") != result_sha256(result):
        _fail("projection sentinel result identity does not match its payload")
    cards = []
    for cell in result["cells"]:
        inputs = "".join(
            f'<figure><img src="{_data_uri(record["path"], record["sha256"])}" '
            f'alt="{html.escape(record["role"])} conditioning input"><figcaption>'
            f'{html.escape(record["role"])} input</figcaption></figure>'
            for record in cell["conditioningInputs"]
        )
        output = cell["output"]
        cards.append(f"""
<article class="cell">
  <h2>{html.escape(cell['id'])}</h2>
  <div class="images"><div class="inputs">{inputs}</div><figure class="output"><img src="{_data_uri(output['path'], output['sha256'])}" alt="{html.escape(cell['id'])} output"><figcaption>generated output</figcaption></figure></div>
  <p class="verdict">{html.escape(cell['visualInspection']['projectionVerdict'])}</p>
  <p>{html.escape(cell['visualInspection']['description'])}</p>
  <p class="micro"><b>job</b> {html.escape(cell['jobId'])} · <b>route</b> {html.escape(cell['requestedRoute'])}<br><b>output SHA</b> <code>{output['sha256']}</code></p>
</article>""")
    settings = result["fixedGenerator"]
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FLUX.2 projection carrier sentinel</title>
<style>
:root {{ color-scheme:dark; font-family:ui-sans-serif,system-ui,sans-serif; background:#0e1012; color:#edf0f2; }}
body {{ margin:0; padding:26px; }} main {{ max-width:1800px; margin:auto; }}
header {{ display:grid; grid-template-columns:1.2fr 1fr; gap:24px; border-bottom:1px solid #4a5056; padding-bottom:18px; }}
h1,h2 {{ margin:.15em 0; }} .identity,.micro,code {{ color:#aeb7c0; overflow-wrap:anywhere; font-size:12px; }}
.prompt {{ white-space:pre-wrap; background:#171a1e; border-left:4px solid #e7aa56; padding:14px; line-height:1.45; }}
.grid {{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; margin-top:20px; }}
.cell {{ background:#171a1e; border:1px solid #454b51; border-radius:12px; padding:15px; }}
.images {{ display:grid; grid-template-columns:minmax(130px,.65fr) minmax(260px,1.35fr); gap:12px; align-items:center; }}
.inputs {{ display:grid; gap:8px; }} figure {{ margin:0; }} img {{ display:block; width:100%; max-height:460px; object-fit:contain; background:#111; }}
figcaption {{ color:#aeb7c0; font-size:12px; padding-top:5px; }} .verdict {{ color:#f1bc70; font-weight:750; text-transform:uppercase; letter-spacing:.08em; }}
.settings {{ margin-top:18px; color:#c7ced5; }}
</style></head><body><main data-result-sha256="{result['resultSha256']}">
<header><section><h1>Projection carrier sentinel</h1><p class="identity">result <code>{result['resultSha256']}</code><br>plan <code>{result['planSha256']}</code></p><p>Orthographic, front-three-quarter source at yaw {result['source']['projection']['cameraYawRadians']} rad. The two-reference cell couples carrier information with reference cardinality.</p></section><section><h2>Exact prompt</h2><div class="prompt">{html.escape(result['fullPrompt'])}</div></section></header>
<section class="grid">{''.join(cards)}</section>
<p class="settings"><b>Fixed generator:</b> {html.escape(settings['model'])} @ {html.escape(settings['modelRevision'])} · seed {settings['seed']} · {settings['steps']} steps · guidance {settings['guidance']} · q{settings['quantize']} · {settings['width']}×{settings['height']}</p>
</main></body></html>"""


def write_projection_sentinel_result(path: Path | str, result: dict[str, Any]) -> Path:
    """Write an identity-checked result manifest to a caller-owned path."""

    if result.get("schema") != RESULT_SCHEMA or result.get("status") != "complete":
        _fail("only complete projection sentinel results can be written")
    if result.get("resultSha256") != result_sha256(result):
        _fail("projection sentinel result identity does not match its payload")
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    return destination


def write_projection_sentinel_result_html(path: Path | str, result: dict[str, Any]) -> Path:
    """Write the self-contained visual result plate to a caller-owned path."""

    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(build_projection_sentinel_result_html(result))
    return destination
