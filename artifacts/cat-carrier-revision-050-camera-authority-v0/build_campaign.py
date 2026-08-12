#!/usr/bin/env python3
"""Build the frozen revision-050 morphology and camera authority campaign."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PRIOR_ROOT = Path("../cat-carrier-cross-basin-authority-v0")
BLEND = Path("/Users/noahlyons/dev/operator-scratch/blender-scenes/cat-bauplan-050.blend")
BLEND_SHA256 = "9f0409d99321ec4d74d237ba6cff1f425b402aeae653db43e699f53150b11fbe"
SEEDS = [80301, 80302, 80413]
FAMILIES = ["dragon", "golem", "maquette", "cat"]
SOURCE_IDS = [
    "revision-050-matched",
    "revision-050-oblique-negative-35",
    "revision-050-oblique-positive-35",
]
ROUTE = {
    "jobType": "mflux_flux2_edit_promptfile",
    "model": "flux2-klein-9b",
    "quantize": 4,
    "width": 512,
    "height": 512,
    "steps": 8,
    "guidance": 1.0,
    "mlxCacheLimitGb": 48,
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_record(source_id: str) -> dict:
    plate = ROOT / "source" / source_id / "plate.png"
    manifest = ROOT / "source" / source_id / "render-manifest.json"
    return {
        "id": source_id,
        "requestedBlend": str(BLEND),
        "effectiveBlend": str(BLEND),
        "blendSha256": BLEND_SHA256,
        "object": "Cube.056",
        "plate": plate.relative_to(ROOT).as_posix(),
        "plateSha256": sha256(plate),
        "renderManifest": manifest.relative_to(ROOT).as_posix(),
    }


def main() -> None:
    if sha256(BLEND) != BLEND_SHA256:
        raise ValueError("revision-050 blend drifted after source-plate authentication")

    prompt_families = []
    for family in FAMILIES:
        prompt_file = ROOT / "prompts" / f"{family}.txt"
        prompt_families.append(
            {
                "id": family,
                "prompt": prompt_file.read_text().strip(),
                "promptFile": prompt_file.relative_to(ROOT).as_posix(),
                "promptFileSha256": sha256(prompt_file),
            }
        )

    cells = []
    for family in FAMILIES:
        for seed in SEEDS:
            cell_id = f"revision-050-matched-{family}-seed{seed}"
            cells.append(
                {
                    "id": cell_id,
                    "sourceId": "revision-050-matched",
                    "family": family,
                    "promptFile": f"prompts/{family}.txt",
                    "seed": seed,
                    "outputDir": f"runs/{cell_id}",
                }
            )
    for source_id in SOURCE_IDS[1:]:
        for family in FAMILIES:
            cell_id = f"{source_id}-{family}-seed80301"
            cells.append(
                {
                    "id": cell_id,
                    "sourceId": source_id,
                    "family": family,
                    "promptFile": f"prompts/{family}.txt",
                    "seed": 80301,
                    "outputDir": f"runs/{cell_id}",
                }
            )

    prior_ledger_path = (ROOT / PRIOR_ROOT / "result-ledger.json").resolve()
    prior_ledger = json.loads(prior_ledger_path.read_text())
    comparison_controls = []
    for family in FAMILIES:
        for seed in SEEDS:
            cell_id = f"revision-048-{family}-seed{seed}"
            prior = prior_ledger["cells"][cell_id]
            comparison_controls.append(
                {
                    "campaignRoot": PRIOR_ROOT.as_posix(),
                    "campaignLedgerSha256": sha256(prior_ledger_path),
                    "cellId": cell_id,
                    "sourceId": "revision-048",
                    "family": family,
                    "seed": seed,
                    "output": prior["output"],
                    "outputSha256": prior["outputSha256"],
                }
            )

    payload = {
        "schema": "kaminos.cat-carrier-revision-050-camera-authority.v0",
        "campaignQuestion": "Does revision-050's more species-specific authored structure change FLUX elaboration under matched conditioning, and how much of that structure survives two modest oblique views?",
        "sources": {source_id: source_record(source_id) for source_id in SOURCE_IDS},
        "promptFamilies": prompt_families,
        "seeds": SEEDS,
        "fluxRoute": ROUTE,
        "cells": cells,
        "comparisonControls": comparison_controls,
        "trellisPromotion": "After complete FLUX visual inspection, reconstruct structurally informative successes across basins and views; attractiveness alone is insufficient.",
        "claimCeiling": "Exact frozen plates, prompt text, seeds, effective route, and visibly inspected outputs only; no arbitrary-view, arbitrary-carrier, anatomical-fidelity, production, or general TRELLIS claim.",
    }
    (ROOT / "campaign.json").write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"campaign": str(ROOT / "campaign.json"), "cells": len(cells)}, indent=2))


if __name__ == "__main__":
    main()
