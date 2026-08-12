#!/usr/bin/env python3
"""Freeze the already-generated broad-basin outputs as visual precedent."""

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT.parent
MATRIX = {
    "dragon": {
        80301: "gen-el-armature-dragon",
        80302: "gen-el-armature-dragon-s80302",
        80413: "gen-el-armature-dragon-s80413",
    },
    "golem": {
        80301: "gen-el-armature-golem",
        80302: "gen-el-armature-golem-s80302",
        80413: "gen-el-armature-golem-s80413",
    },
    "phantom": {
        80301: "gen-el-armature-phantom",
        80302: "gen-el-armature-phantom-s80302",
        80413: "gen-el-armature-phantom-s80413",
    },
    "maquette": {
        80301: "gen-fr-maquette",
        80302: "gen-fr-maquette-s80302",
        80413: "gen-fr-maquette-s80413",
    },
    "skin": {80301: "gen-env-skin"},
    "fur": {80301: "gen-env-fur"},
    "cat": {80301: "gen-sp-cat"},
    "unknown-creature": {80301: "gen-sp-creature"},
}


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> None:
    cells = {}
    for family, seeds in MATRIX.items():
        for seed, directory in seeds.items():
            root = ARTIFACTS / "authored-envelope-v0" / directory
            output = root / "output.png"
            metadata = root / "metadata.json"
            if not output.is_file():
                raise FileNotFoundError(output)
            recorded = json.loads(metadata.read_text()) if metadata.is_file() else None
            cell_id = f"{family}-seed{seed}"
            cells[cell_id] = {
                "family": family,
                "seed": seed,
                "output": (Path("..") / output.relative_to(ARTIFACTS)).as_posix(),
                "outputSha256": digest(output),
                "metadata": (Path("..") / metadata.relative_to(ARTIFACTS)).as_posix() if metadata.is_file() else None,
                "recordedJobType": recorded.get("job_type") if recorded else None,
                "recordedJobId": recorded.get("job_id") if recorded else None,
                "recordedParams": recorded.get("params") if recorded else None,
            }
    payload = {
        "schema": "kaminos.cat-carrier-cross-basin-authority.precedent.v0",
        "role": "fertile-basin-precedent-not-causal-control",
        "source": "../authored-envelope-v0/plate3/plate.png",
        "sourceSha256": "50bac29be1534e847a02013c8bd054cfd433d7d0335c536423f6a5e5cab36ed8",
        "routeEvidence": "Copied historical metadata authenticates source path, prompt file, seed, job type, and job id where present. It does not preserve a canonical Greenroom receipt or independently authenticate all effective model defaults; the sheet must not imply otherwise.",
        "cells": cells,
    }
    destination = ROOT / "historical-precedent.json"
    destination.write_text(json.dumps(payload, indent=2) + "\n")
    print(json.dumps({"precedent": str(destination), "cells": len(cells)}, indent=2))


if __name__ == "__main__":
    main()
