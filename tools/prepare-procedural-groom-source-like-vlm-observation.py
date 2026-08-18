#!/usr/bin/env python3
"""Project the bound source-like presentation into the unchanged VLM input schema."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_source_like_observation(source_path: Path, output_path: Path) -> dict:
    source_path = source_path.resolve()
    output_path = output_path.resolve()
    source = json.loads(source_path.read_text())
    if source.get("schema") != "kaminos.procedural-groom-source-like-observation.v0":
        raise ValueError("unexpected source-like observation schema")
    if source.get("visualAdmission") is not False or source.get("scientificAdmission") is not False:
        raise ValueError("source-like observation cannot self-admit")
    output_dir = output_path.parent
    output_dir.mkdir(parents=True, exist_ok=True)
    source_relative = source_path.relative_to(output_dir).as_posix()
    views = []
    for view in source["views"]:
        source_image = source_path.parent / view["sourceLike"]["path"]
        views.append({
            "id": view["id"],
            "path": source_image.relative_to(output_dir).as_posix(),
            "sha256": view["sourceLike"]["sha256"],
            "byteLength": view["sourceLike"]["byteLength"],
            "requestedPose": {
                "position": view["cameraPosition"],
                "target": view["cameraTarget"],
            },
            "membershipColorsVisible": False,
            "labelsVisible": False,
            "gizmoVisible": False,
        })
    projected = {
        "schema": "kaminos.procedural-groom-observation.v0",
        "observationId": source["observationId"],
        "sourceObservationId": source["observationId"],
        "fixtureId": source["fixtureId"],
        "digest": sha256(source_path),
        "digestBasis": "sha256 of generated/observation.json",
        "truthExposure": "withheld",
        "requestedRoute": "kaminos:groom-source-like-observation.v0",
        "effectiveRoute": "kaminos:groom-source-like-observation.v0",
        "sourceWitness": {
            "path": source_relative,
            "sha256": sha256(source_path),
            "byteLength": source_path.stat().st_size,
        },
        "views": views,
        "visualAdmission": False,
        "scientificAdmission": False,
    }
    output_path.write_text(json.dumps(projected, indent=2) + "\n")
    return projected


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-like", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source_path = args.source_like.resolve()
    output_path = args.output.resolve()
    project_source_like_observation(source_path, output_path)
    print(json.dumps({"state": "source_like_vlm_observation_written", "output": str(output_path)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
