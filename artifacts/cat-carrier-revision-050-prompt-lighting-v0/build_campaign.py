#!/usr/bin/env python3
"""Materialize the frozen prompt, lighting, and stone FLUX assay manifest."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PRIOR_ROOT = ROOT.parent / "cat-carrier-revision-050-camera-authority-v0"
SOURCE = PRIOR_ROOT / "source/revision-050-matched/plate.png"
SOURCE_RELATIVE = "../cat-carrier-revision-050-camera-authority-v0/source/revision-050-matched/plate.png"
PRIOR_LEDGER = PRIOR_ROOT / "result-ledger.json"
PROMPTS = ROOT / "prompts"
ROUTE = {
    "jobType": "mflux_flux2_edit_promptfile",
    "runner": "/Users/noahlyons/dev/mlx-openai-server/.venv/bin/mflux-generate-flux2-edit",
    "model": "flux2-klein-9b",
    "quantize": 4,
    "width": 512,
    "height": 512,
    "steps": 8,
    "guidance": 1.0,
    "mlxCacheLimitGb": 48,
}
GENERIC = [
    "Creature.",
    "This shape as a creature.",
    "Complete this creature.",
    "This shape covered in skin.",
    "Elaborate this shape into a finished creature.",
    "Elaborate this shape into a richly detailed creature.",
]
DRAGON_BASE = "Elaborate this armature into a finished creature with scaly hide, ridged spine, and horned head."
LIGHTING = [
    "Even diffuse studio lighting.",
    "Raking side lighting.",
    "Soft rim light with frontal fill.",
]
STONE = "This creature built from thick overlapping weathered stone slabs."


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def prompt_record(identifier: str, text: str) -> dict:
    path = PROMPTS / f"{identifier}.txt"
    payload = (text + "\n").encode("utf-8")
    path.write_bytes(payload)
    return {
        "id": identifier,
        "text": text,
        "file": path.relative_to(ROOT).as_posix(),
        "bytesSha256": sha256_bytes(payload),
        "bytesUtf8": payload.decode("utf-8"),
    }


def external_control(prior_ledger: dict, cell_id: str) -> dict:
    record = prior_ledger["cells"][cell_id]
    output = PRIOR_ROOT / record["output"]
    if sha256(output) != record["outputSha256"]:
        raise ValueError(f"external control output drifted: {cell_id}")
    return {
        "id": cell_id,
        "kind": "external-control",
        "campaignRoot": "../cat-carrier-revision-050-camera-authority-v0",
        "campaignLedger": "../cat-carrier-revision-050-camera-authority-v0/result-ledger.json",
        "campaignLedgerSha256": sha256(PRIOR_LEDGER),
        "sourcePath": SOURCE_RELATIVE,
        "sourceSha256": sha256(SOURCE),
        "prompt": record["prompt"],
        "promptSha256": record["promptSha256"],
        "seed": record["seed"],
        "jobId": record["jobId"],
        "effectiveRoute": record["effectiveRoute"],
        "output": f"../cat-carrier-revision-050-camera-authority-v0/{record['output']}",
        "outputSha256": record["outputSha256"],
        "failureState": "none",
    }


def main() -> None:
    if not SOURCE.is_file():
        raise FileNotFoundError(SOURCE)
    if not PRIOR_LEDGER.is_file():
        raise FileNotFoundError(PRIOR_LEDGER)
    PROMPTS.mkdir(parents=True, exist_ok=True)
    prior_ledger = json.loads(PRIOR_LEDGER.read_text())

    prompt_records = []
    cells = []
    for index, text in enumerate(GENERIC, start=1):
        prompt = prompt_record(f"generic-{index:02d}", text)
        prompt_records.append(prompt)
        for seed in (80301, 80302):
            cells.append({
                "id": f"generic-{index:02d}-seed{seed}",
                "group": "generic-ladder",
                "promptId": prompt["id"],
                "seed": seed,
                "outputDir": f"runs/generic-{index:02d}-seed{seed}",
            })

    for index, clause in enumerate(LIGHTING, start=1):
        prompt = prompt_record(f"dragon-lighting-{index:02d}", f"{DRAGON_BASE} {clause}")
        prompt_records.append(prompt)
        cells.append({
            "id": f"dragon-lighting-{index:02d}-seed80301",
            "group": "dragon-lighting",
            "basePhrase": DRAGON_BASE,
            "lightingClause": clause,
            "promptId": prompt["id"],
            "seed": 80301,
            "outputDir": f"runs/dragon-lighting-{index:02d}-seed80301",
        })

    stone_prompt = prompt_record("stone-thick-overlapping-slabs", STONE)
    prompt_records.append(stone_prompt)
    cells.append({
        "id": "stone-thick-overlapping-slabs-seed80301",
        "group": "stone-diagnostic",
        "promptId": stone_prompt["id"],
        "seed": 80301,
        "outputDir": "runs/stone-thick-overlapping-slabs-seed80301",
    })
    if len(cells) != 16 or len({cell["id"] for cell in cells}) != 16:
        raise ValueError("frozen matrix is not an exact 16-cell unique campaign")

    campaign = {
        "schema": "kaminos.cat-carrier-revision-050-prompt-lighting.v0",
        "source": {
            "path": SOURCE_RELATIVE,
            "sha256": sha256(SOURCE),
            "originCampaign": "../cat-carrier-revision-050-camera-authority-v0",
            "originSourceId": "revision-050-matched",
        },
        "fluxRoute": ROUTE,
        "promptRecords": prompt_records,
        "cells": cells,
        "externalControls": [
            external_control(prior_ledger, "revision-050-matched-dragon-seed80301"),
            external_control(prior_ledger, "revision-050-matched-golem-seed80301"),
        ],
        "claimCeiling": "Exact source, prompt bytes, seed, requested and effective FLUX route, settings, terminal receipt, and visibly inspectable output differences only; no selection, basin interpretation, lighting-validity judgment, TRELLIS promotion, general prompt law, arbitrary-carrier claim, or production claim.",
    }
    (ROOT / "campaign.json").write_text(json.dumps(campaign, indent=2) + "\n")
    print(json.dumps({"campaign": str(ROOT / "campaign.json"), "cells": len(cells), "controls": 2}, indent=2))


if __name__ == "__main__":
    main()
