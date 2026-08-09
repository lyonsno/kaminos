#!/usr/bin/env python3
"""Freeze completed Greenroom receipts and render the compact FLUX screen."""

import hashlib
import html
import json
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CAMPAIGN = json.loads((ROOT / "campaign.json").read_text())
LEDGER = json.loads((ROOT / "submission-ledger.json").read_text())
GREENROOM = Path("/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom")
QUEUE = Path.home() / ".local/state/gpu-greenroom"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    prompts = {prompt["id"]: prompt for prompt in CAMPAIGN["prompts"]}
    cells_by_id = {(cell["promptId"], cell["seed"]): cell for cell in CAMPAIGN["fluxCells"]}
    receipts_dir = ROOT / "receipts"
    receipts_dir.mkdir(exist_ok=True)
    results = []

    for job in LEDGER["jobs"]:
        status = subprocess.run(
            [str(GREENROOM), "status", job["jobId"]],
            check=True,
            text=True,
            capture_output=True,
        )
        receipt = json.loads(status.stdout)
        if receipt["status"] != "done":
            raise RuntimeError(f"{job['jobId']} is {receipt['status']}, not done")
        frozen_receipt = receipts_dir / f"{job['jobId']}.json"
        queue_receipt = QUEUE / "done" / job["jobId"] / "receipt.json"
        shutil.copyfile(queue_receipt, frozen_receipt)
        cell = cells_by_id[(job["promptId"], job["seed"])]
        output = ROOT / cell["outputDir"] / "output.png"
        results.append(
            {
                "promptId": job["promptId"],
                "prompt": prompts[job["promptId"]]["text"],
                "seed": job["seed"],
                "jobId": job["jobId"],
                "outputPath": str(output.relative_to(ROOT)),
                "outputSha256": sha256(output),
                "receiptPath": str(frozen_receipt.relative_to(ROOT)),
            }
        )

    results.sort(key=lambda row: (row["promptId"], row["seed"]))
    payload = {
        "campaign": CAMPAIGN["campaign"],
        "source": CAMPAIGN["source"],
        "cells": results,
    }
    (ROOT / "flux-results.json").write_text(json.dumps(payload, indent=2) + "\n")
    source = CAMPAIGN["source"]
    route = CAMPAIGN["fluxRoute"]
    cards = []
    for row in results:
        cards.append(
            f'''<article><h2>{html.escape(row["promptId"])} · seed {row["seed"]}</h2>
            <p class="prompt">{html.escape(row["prompt"])}</p>
            <img src="{html.escape(row["outputPath"])}" alt="{html.escape(row["promptId"])} seed {row["seed"]}">
            <p class="audit">Job {row["jobId"]} · {row["outputSha256"][:12]}</p></article>'''
        )
    sheet = f'''<!doctype html><html><head><meta charset="utf-8"><title>{CAMPAIGN["campaign"]}</title>
    <style>body{{margin:0;background:#151817;color:#eef1ed;font:15px system-ui}}main{{max-width:1500px;margin:auto;padding:28px}}h1{{font-size:28px}}.summary{{color:#b9c2bc}}.grid{{display:grid;grid-template-columns:260px repeat(3,minmax(280px,1fr));gap:14px;align-items:start}}article{{border:1px solid #39423d;background:#1c211f;padding:12px;border-radius:6px}}article.source{{position:sticky;top:12px}}h2{{font-size:16px;margin:0 0 8px}}img{{display:block;width:100%;background:#0e1110}}.prompt{{min-height:40px;font-weight:650}}.audit{{font:12px ui-monospace;color:#8f9993;overflow-wrap:anywhere}}</style></head>
    <body><main><h1>Current mannequin elaboration screen</h1>
    <p class="summary">FLUX.2 Klein 9B q4 · 512×512 · Steps 8 · Guidance 1.0 · matched seeds 80301 / 80413</p>
    <div class="grid"><article class="source"><h2>Authenticated source</h2><img src="{html.escape(source["path"])}" alt="authenticated source envelope"><p class="audit">{source["sha256"]}<br>{source["triangleCount"]} triangles</p></article>{''.join(cards)}</div>
    </main></body></html>'''
    (ROOT / "flux-screen.html").write_text(sheet)


if __name__ == "__main__":
    main()
