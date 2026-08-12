#!/usr/bin/env python3
"""Build the frozen cross-basin source-authority matrix."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
SEEDS = [80301, 80302, 80413]
FAMILIES = [
    ("dragon", "material-plus-anatomical-embellishment"),
    ("golem", "rigid-segmented-surface"),
    ("phantom", "translucent-nonrigid-surface"),
    ("maquette", "neutral-completion"),
    ("skin", "continuous-skin"),
    ("fur", "continuous-fur"),
    ("cat", "species-explicit"),
    ("unknown-creature", "species-open"),
]
CONTROL_FAMILIES = {"dragon", "golem", "maquette"}
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


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source(source_id: str, blend: str, blend_sha256: str) -> dict:
    plate = ROOT / "source" / source_id / "plate.png"
    manifest = ROOT / "source" / source_id / "render-manifest.json"
    return {
        "id": source_id,
        "requestedBlend": blend,
        "effectiveBlend": blend,
        "blendSha256": blend_sha256,
        "object": "Cube.056",
        "plate": plate.relative_to(ROOT).as_posix(),
        "plateSha256": digest(plate),
        "renderManifest": manifest.relative_to(ROOT).as_posix(),
    }


def main() -> None:
    prompt_families = []
    for family_id, surface_class in FAMILIES:
        prompt_file = ROOT / "prompts" / f"{family_id}.txt"
        prompt_families.append(
            {
                "id": family_id,
                "prompt": prompt_file.read_text().strip(),
                "promptFile": prompt_file.relative_to(ROOT).as_posix(),
                "surfaceClass": surface_class,
            }
        )

    cells = []
    for source_id, family_filter in (
        ("revision-048", {family_id for family_id, _ in FAMILIES}),
        ("revision-029", CONTROL_FAMILIES),
    ):
        for family_id, _ in FAMILIES:
            if family_id not in family_filter:
                continue
            for seed in SEEDS:
                cell_id = f"{source_id}-{family_id}-seed{seed}"
                cells.append(
                    {
                        "id": cell_id,
                        "sourceId": source_id,
                        "family": family_id,
                        "promptFile": f"prompts/{family_id}.txt",
                        "seed": seed,
                        "outputDir": f"runs/{cell_id}",
                    }
                )

    payload = {
        "schema": "kaminos.cat-carrier-cross-basin-authority.v0",
        "campaignQuestion": "Does revision-048's stronger feline organization preserve authored structure across useful completion basins, and does it improve source authority over revision-029 under matched prompts and seeds?",
        "sources": {
            "revision-029": source(
                "revision-029",
                "/Users/noahlyons/dev/operator-scratch/blender-scenes/cat-bauplan-029.blend",
                "0df08915c9319ec37bf0de02bd6bd59b028bcb77d7870ca91a2663afe40e8360",
            ),
            "revision-048": source(
                "revision-048",
                "/Users/noahlyons/dev/operator-scratch/blender-scenes/cat-bauplan-048.blend",
                "8605e613e21d6e9cb102e187f3f2a3d2ca5c55fd9835df1e38926c829ce953e2",
            ),
        },
        "historicalPrecedent": {
            "role": "fertile-basin-precedent-not-causal-control",
            "source": "../authored-envelope-v0/plate3/plate.png",
            "sourcePlateSha256": "50bac29be1534e847a02013c8bd054cfd433d7d0335c536423f6a5e5cab36ed8",
            "sourceGeometry": "/Users/noahlyons/dev/operator-scratch/meshes/authored_cat_envelope.glb",
            "sourceGeometrySha256": "cf5a6ba393d40c29171d97b0e8b506d450623f3d37c079e3874371d70f296a4e",
            "outputsRoot": "../authored-envelope-v0",
        },
        "seeds": SEEDS,
        "promptFamilies": prompt_families,
        "fluxRoute": ROUTE,
        "cells": cells,
        "trellisPromotion": "After visual inspection, promote at most one structurally faithful winner from each genuinely distinct surface basin; do not reconstruct every attractive image.",
        "claimCeiling": "Exact source revisions, frozen plates, prompt text, seeds, and effective Flux route only. This campaign cannot establish arbitrary-carrier control, general model semantics, anatomical fidelity, production suitability, riggability, or TRELLIS behavior.",
    }
    destination = ROOT / "campaign.json"
    destination.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"campaign": str(destination), "cells": len(cells)}, indent=2))


if __name__ == "__main__":
    main()
