#!/usr/bin/env python3
"""Build an adjacent non-interpretive source/prompt/settings/output evidence sheet."""

import hashlib
import html
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "prompt-lighting-sheet.html"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def rel(path: Path) -> str:
    return Path(os.path.relpath(path.resolve(), ROOT.resolve())).as_posix()


def image_or_failure(path: Path, label: str, failure: str) -> str:
    if failure != "none" or not path.is_file():
        return f'<div class="missing"><b>{esc(label)}</b><span>Failure state: {esc(failure)}</span></div>'
    return f'<img src="{esc(rel(path))}" alt="{esc(label)}">'


def source_image(path: Path, label: str) -> str:
    if not path.is_file():
        return f'<div class="missing"><b>Source</b><span>Failure state: source is missing</span></div>'
    return f'<img src="{esc(rel(path))}" alt="{esc(label)} source plate">'


def requested_route(record: dict) -> str:
    requested = record["requestedRoute"]
    params = requested["params"]
    return (
        f"{requested['source']} | {params['model']} | q{params['quantize']} | "
        f"{params['width']}x{params['height']} | {params['steps']} steps | guidance {params['guidance']} | "
        f"MLX cache {params['mlx_cache_limit_gb']} GiB"
    )


def generated_cell(record: dict) -> str:
    output = ROOT / record["output"]
    source = ROOT / record["source"]
    cell_id = esc(record["id"])
    fields = [
        ("Source", record["source"]), ("Source hash", record["sourceSha256"]),
        ("Prompt", record["prompt"]), ("Prompt file", record["promptFile"]),
        ("Prompt bytes hash", record["promptBytesSha256"]), ("Seed", record["seed"]),
        ("Requested route", requested_route(record)), ("Effective route", record["effectiveRoute"]),
        ("Settings", json.dumps(record["effectiveParams"], sort_keys=True)), ("Job ID", record["jobId"]),
        ("Output", record["output"]), ("Output hash", record["outputSha256"]),
        ("Failure state", record["failureState"]),
    ]
    metadata = "".join(f"<dt>{esc(key)}</dt><dd>{esc(value)}</dd>" for key, value in fields)
    return f'<article class="cell" data-cell-id="{cell_id}"><h3>{cell_id} <small>{esc(record["group"])}</small></h3><div class="media"><figure><figcaption>Source</figcaption>{source_image(source, record["id"])}</figure><figure><figcaption>Output</figcaption>{image_or_failure(output, record["id"], record["failureState"])}</figure></div><dl>{metadata}</dl></article>'


def control_cell(record: dict) -> str:
    output = ROOT / record["output"]
    source = ROOT / record["sourcePath"]
    cell_id = esc(record["id"])
    fields = [
        ("Source", record["sourcePath"]), ("Source hash", record["sourceSha256"]), ("Prompt", record["prompt"]),
        ("Prompt hash", record["promptSha256"]), ("Seed", record["seed"]), ("Effective route", record["effectiveRoute"]),
        ("Job ID", record["jobId"]), ("Output", record["output"]), ("Output hash", record["outputSha256"]),
        ("Control ledger", record["campaignLedger"]), ("Control ledger hash", record["campaignLedgerSha256"]),
        ("Failure state", record["failureState"]),
    ]
    metadata = "".join(f"<dt>{esc(key)}</dt><dd>{esc(value)}</dd>" for key, value in fields)
    return f'<article class="cell control" data-control-id="{cell_id}"><h3>{cell_id} <small>external control</small></h3><div class="media"><figure><figcaption>Source</figcaption>{source_image(source, record["id"])}</figure><figure><figcaption>Output</figcaption>{image_or_failure(output, record["id"], record["failureState"])}</figure></div><dl>{metadata}</dl></article>'


def main() -> None:
    campaign = json.loads((ROOT / "campaign.json").read_text())
    ledger_path = ROOT / "result-ledger.json"
    ledger = json.loads(ledger_path.read_text())
    if ledger["campaignSha256"] != sha256(ROOT / "campaign.json"):
        raise RuntimeError("result ledger does not bind the frozen campaign")
    if len(ledger.get("cells", [])) != 16 or {cell["id"] for cell in ledger["cells"]} != {cell["id"] for cell in campaign["cells"]}:
        raise RuntimeError("result ledger does not cover every requested cell")
    if len(ledger.get("externalControls", [])) != 2:
        raise RuntimeError("result ledger does not include both immutable external controls")
    groups = (("Generic prompt ladder", "generic-ladder"), ("Dragon lighting", "dragon-lighting"), ("Stone diagnostic", "stone-diagnostic"))
    controls = {control["id"]: control for control in ledger["externalControls"]}
    sections = []
    for heading, group in groups:
        cells = [generated_cell(cell) for cell in ledger["cells"] if cell["group"] == group]
        if group == "dragon-lighting":
            cells.insert(0, control_cell(controls["revision-050-matched-dragon-seed80301"]))
        if group == "stone-diagnostic":
            cells.insert(0, control_cell(controls["revision-050-matched-golem-seed80301"]))
        sections.append(f"<section><h2>{esc(heading)}</h2><div class=\"grid\">{''.join(cells)}</div></section>")
    document = f"""<!doctype html><meta charset=\"utf-8\"><title>Revision-050 Prompt, Lighting, and Stone FLUX Evidence</title>
<style>
*{{box-sizing:border-box}}body{{margin:0;background:#f2f4f1;color:#17211e;font:14px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace}}main{{max-width:1880px;margin:auto;padding:28px}}h1{{margin:0 0 6px;font:700 27px/1.2 system-ui,sans-serif}}h2{{margin:34px 0 12px;font:700 20px/1.2 system-ui,sans-serif}}p{{max-width:130ch;margin:0 0 10px}}.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(390px,1fr));gap:14px}}.cell{{background:#fff;border:1px solid #c8d0ca;padding:12px;overflow-wrap:anywhere}}.control{{border-top:5px solid #536f64}}h3{{margin:0 0 10px;font-size:14px}}small{{color:#536f64;font-weight:400}}.media{{display:grid;grid-template-columns:1fr 1fr;gap:8px}}figure{{margin:0}}figcaption{{font-weight:700;margin:0 0 4px}}img{{display:block;width:100%;height:auto;aspect-ratio:1;object-fit:contain;background:#e6eae6;border:1px solid #d5ddd6}}.missing{{display:grid;place-items:center;min-height:260px;padding:20px;border:2px solid #9c3434;color:#7e2323;background:#fff5f5;text-align:center}}dl{{margin:12px 0 0;display:grid;grid-template-columns:136px minmax(0,1fr);gap:5px 9px}}dt{{font-weight:700}}dd{{margin:0;white-space:pre-wrap}}.claim{{border-left:4px solid #536f64;padding-left:12px}}@media(max-width:520px){{main{{padding:14px}}.grid{{grid-template-columns:1fr}}.media{{grid-template-columns:1fr}}dl{{grid-template-columns:1fr;gap:1px}}dd{{margin-bottom:8px}}}}
</style><main><h1>Revision-050 prompt, lighting, and stone FLUX evidence</h1><p>Six generic prompts across seeds 80301 and 80302; three dragon lighting clauses at seed 80301; one stone-slab diagnostic at seed 80301; and two immutable external controls shown beside their matching groups.</p><p class=\"claim\"><b>Claim ceiling:</b> {esc(campaign['claimCeiling'])}</p>{''.join(sections)}</main>"""
    OUT.write_text(document)
    print(json.dumps({"sheet": str(OUT), "cells": 16, "controls": 2}, indent=2))


if __name__ == "__main__":
    main()
