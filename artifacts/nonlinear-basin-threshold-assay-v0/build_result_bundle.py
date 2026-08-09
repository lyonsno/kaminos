#!/usr/bin/env python3
"""Publish the density-pass route ledger and operator comparison sheet."""

from __future__ import annotations

import hashlib
import html
import json
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
LEDGER = ROOT / "density-pass-ledger.json"
SHEET = ROOT / "density-pass-results.html"
RECEIPTS = ROOT / "receipts"

SUCCESS_JOBS = {
    "r100": "1d00bb515202",
    "r075": "2fe821d07bbf",
    "r050": "35a69d6d9df7",
    "r030": "18fabe78b3d0",
    "r015": "9bcf635d1bb0",
}
FAILED_JOBS = [
    "71af4464cbe9",
    "654f796c8212",
    "c509062d03f3",
    "2c0dcc27b410",
    "c2956ab06cb6",
]
RUN_DIRS = {
    "r100": "r100-seed80301",
    "r075": "r075-seed80301",
    "r050": "r050-seed80301",
    "r030": "r030-seed80301",
    "r015": "r015-seed80301",
}
INTERPRETATIONS = {
    "r100": "Positive control. Happy fur-bearing quadruped; authored mass, stance, neck, head, feet, and tail organization survive.",
    "r075": "No meaningful basin change. The generated organism is nearly identical to the positive control.",
    "r050": "Same organism basin and macro-organization. Only slight distal rear-support variation is visible.",
    "r030": "Still the same basin at 615 triangles. Local variation increases, but the authored macro-structure remains legible.",
    "r015": "First clear local breakdown. Cranial and distal support specificity collapse, although the global quadruped body plan survives.",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def status(job_id: str) -> dict:
    result = subprocess.run(
        [str(GREENROOM), "status", job_id],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def preserve_receipt(receipt: dict) -> tuple[str, str]:
    RECEIPTS.mkdir(exist_ok=True)
    path = RECEIPTS / f"{receipt['job_id']}.json"
    path.write_text(json.dumps(receipt, indent=2) + "\n")
    return relative(path), sha256(path)


def ssim(reference: Path, candidate: Path) -> float:
    result = subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-i",
            str(reference),
            "-i",
            str(candidate),
            "-lavfi",
            "ssim",
            "-f",
            "null",
            "-",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    match = re.search(r"All:([0-9.]+)", result.stderr)
    if not match:
        raise RuntimeError(f"ffmpeg did not report SSIM for {candidate}")
    return float(match.group(1))


def relative(path: Path) -> str:
    return path.resolve().relative_to(ROOT).as_posix()


def build_ledger() -> dict:
    campaign = json.loads((ROOT / "campaign.json").read_text())
    prompt_path = ROOT / campaign["prompt"]["path"]
    reference = ROOT / "runs" / RUN_DIRS["r100"] / "output.png"
    cells = []

    for spec in campaign["densityAxis"]["cells"]:
        cell_id = spec["id"]
        receipt = status(SUCCESS_JOBS[cell_id])
        source = ROOT / spec["source"]
        output = ROOT / "runs" / RUN_DIRS[cell_id] / "output.png"
        if receipt["status"] != "done" or receipt["exit_code"] != 0:
            raise RuntimeError(f"successful cell {cell_id} is not successful: {receipt}")
        effective_input = Path(receipt["input_path"])
        if not effective_input.as_posix().endswith(spec["source"]):
            raise RuntimeError(f"effective source identity mismatch for {cell_id}")
        if spec["sha256"] != sha256(source):
            raise RuntimeError(f"authenticated source hash mismatch for {cell_id}")
        raw_receipt, raw_receipt_sha256 = preserve_receipt(receipt)
        cells.append(
            {
                "id": cell_id,
                "triangleCount": spec["triangleCount"],
                "role": spec["role"],
                "source": relative(source),
                "sourceSha256": sha256(source),
                "effectiveInputPath": receipt["input_path"],
                "output": relative(output),
                "outputSha256": sha256(output),
                "prompt": campaign["prompt"]["text"],
                "promptSha256": sha256(prompt_path),
                "jobId": receipt["job_id"],
                "rawReceipt": raw_receipt,
                "rawReceiptSha256": raw_receipt_sha256,
                "status": receipt["status"],
                "exitCode": receipt["exit_code"],
                "effectiveRoute": receipt["effective_route"],
                "params": receipt["params"],
                "durationSeconds": round(receipt["finished_at"] - receipt["started_at"], 3),
                "ssimAgainstR100": 1.0 if cell_id == "r100" else ssim(reference, output),
                "visualAdmission": "happy-safe",
                "interpretation": INTERPRETATIONS[cell_id],
            }
        )

    failures = []
    for job_id in FAILED_JOBS:
        receipt = status(job_id)
        raw_receipt, raw_receipt_sha256 = preserve_receipt(receipt)
        failures.append(
            {
                "jobId": job_id,
                "rawReceipt": raw_receipt,
                "rawReceiptSha256": raw_receipt_sha256,
                "status": receipt["status"],
                "exitCode": receipt["exit_code"],
                "failurePhase": receipt["failure_phase"],
                "errorMessage": receipt["error_message"],
                "effectiveRoute": receipt["effective_route"],
                "evidenceAuthority": "none; failed before image generation",
            }
        )

    return {
        "schema": "kaminos.nonlinear_basin_threshold_density_result.v0",
        "campaignQuestion": campaign["campaignQuestion"],
        "result": "The same fur-bearing organism basin survives from 2,070 through 615 triangles; first clear local anatomical collapse appears at 307 triangles.",
        "route": campaign["route"],
        "prompt": campaign["prompt"],
        "seed": campaign["seed"],
        "visualAdmission": "All five outputs were inspected and classified happy-safe.",
        "metricAuthority": "SSIM supports image continuity but does not substitute for visual morphology inspection.",
        "claimCeiling": campaign["interpretation"]["claimCeiling"],
        "cells": cells,
        "failedSubmissions": failures,
    }


def build_sheet(ledger: dict) -> str:
    rows = []
    for cell in ledger["cells"]:
        rows.append(
            f"""
            <section class="result-row" id="{html.escape(cell['id'])}">
              <div class="source-pane">
                <div class="eyebrow">SOURCE · {html.escape(cell['id'])}</div>
                <img src="{html.escape(cell['source'])}" alt="{html.escape(cell['id'])} authored envelope source">
                <div class="facts">{cell['triangleCount']:,} triangles · {html.escape(cell['role'])}</div>
                <code>{html.escape(cell['source'])}</code>
              </div>
              <div class="arrow" aria-hidden="true">→</div>
              <div class="output-pane">
                <div class="eyebrow">FLUX OUTPUT · HAPPY / SAFE</div>
                <img src="{html.escape(cell['output'])}" alt="{html.escape(cell['id'])} FLUX output">
                <p>{html.escape(cell['interpretation'])}</p>
                <div class="facts">SSIM vs r100: {cell['ssimAgainstR100']:.6f} · job {html.escape(cell['jobId'])}</div>
                <code>{html.escape(cell['output'])}</code>
              </div>
            </section>
            """
        )

    route = ledger["route"]
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authored envelope density pass</title>
  <style>
    :root {{ color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #111412; color: #edf0e9; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; background: #111412; }}
    main {{ width: min(1520px, calc(100% - 48px)); margin: 0 auto; padding: 42px 0 64px; }}
    h1 {{ margin: 0 0 12px; font-size: 34px; letter-spacing: 0; }}
    h2 {{ margin: 0 0 12px; font-size: 22px; letter-spacing: 0; }}
    p {{ color: #c4cabf; line-height: 1.55; }}
    .lede {{ max-width: 1050px; font-size: 18px; }}
    .conclusion {{ margin: 26px 0; padding: 20px 22px; border-left: 5px solid #55c787; background: #19221c; }}
    .conclusion strong {{ display: block; color: #76dfa0; font-size: 19px; margin-bottom: 5px; }}
    .settings {{ display: grid; grid-template-columns: minmax(260px, 1fr) 2fr; gap: 24px; padding: 20px 0 30px; border-bottom: 1px solid #394039; }}
    .prompt {{ font-size: 23px; color: #fff1be; }}
    .facts, code {{ color: #919b91; font-size: 13px; }}
    code {{ display: block; margin-top: 8px; overflow-wrap: anywhere; }}
    .result-row {{ display: grid; grid-template-columns: minmax(0, 1fr) 42px minmax(0, 1fr); gap: 22px; align-items: center; padding: 34px 0; border-bottom: 1px solid #303730; }}
    .source-pane, .output-pane {{ min-width: 0; }}
    .eyebrow {{ color: #e8bc55; font-weight: 750; font-size: 13px; margin-bottom: 10px; }}
    img {{ display: block; width: 100%; aspect-ratio: 1 / 1; object-fit: contain; background: #202420; border: 1px solid #353b35; }}
    .arrow {{ color: #55c787; font-size: 34px; text-align: center; }}
    .limit {{ margin-top: 32px; padding: 20px 22px; background: #211d17; border-left: 5px solid #dda552; }}
    .failures {{ margin-top: 34px; color: #aab1aa; }}
    @media (max-width: 760px) {{
      main {{ width: min(100% - 24px, 1520px); padding-top: 24px; }}
      .settings, .result-row {{ grid-template-columns: 1fr; }}
      .arrow {{ transform: rotate(90deg); }}
    }}
  </style>
</head>
<body>
<main>
  <h1>Authored envelope density pass</h1>
  <p class="lede">{html.escape(ledger['campaignQuestion'])}</p>
  <div class="conclusion"><strong>Density is not the limiting variable across the useful range.</strong>{html.escape(ledger['result'])}</div>
  <section class="settings">
    <div><h2>Prompt</h2><div class="prompt">“{html.escape(ledger['prompt']['text'])}”</div><p>No exclusion clause.</p></div>
    <div><h2>Frozen route</h2><p>FLUX.2 Klein 9B · seed {ledger['seed']} · {route['width']}×{route['height']} · {route['steps']} steps · guidance {route['guidance']} · quantization {route['quantize']}. Every row changes only the authenticated source plate.</p></div>
  </section>
  {''.join(rows)}
  <aside class="limit"><strong>Causal limit.</strong> The 615- and 307-triangle cells increasingly conflate polygon reduction with loss of authored structural organization. This pass therefore does not establish a universal polygon threshold. It establishes that ordinary decimation is surprisingly cheap through 615 triangles on this route, and motivates a separate same-density structural-quality assay.</aside>
  <p class="failures">Audit note: five malformed launch attempts passed the source directory rather than an image and failed before inference. They remain recorded in <code>density-pass-ledger.json</code> with zero visual authority.</p>
</main>
</body>
</html>
"""


def main() -> None:
    ledger = build_ledger()
    LEDGER.write_text(json.dumps(ledger, indent=2) + "\n")
    sheet = build_sheet(ledger)
    SHEET.write_text("\n".join(line.rstrip() for line in sheet.splitlines()) + "\n")
    print(f"wrote {LEDGER}")
    print(f"wrote {SHEET}")


if __name__ == "__main__":
    main()
