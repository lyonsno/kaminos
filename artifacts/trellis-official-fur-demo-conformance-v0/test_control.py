#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED_SOURCE_SHA256 = "fbd98cf5da79c56f8efc6cf86804391e71bdad2e935d21a7262472653a0674dc"


def main() -> None:
    fixture = json.loads((ROOT / "fixture.json").read_text())
    source = ROOT / fixture["source"]["copiedPath"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED_SOURCE_SHA256
    assert fixture["source"]["canonicalPath"].endswith(
        "5c80e5e03a3b60b6f03eaf555ba1dafc0e4230c472d7e8c8e2c5ca0a0dfcef10.webp"
    )
    exact = fixture["cells"]["exactCheapRoute"]
    assert exact == {
        "jobType": "trellis2mlx_fast",
        "resolution": 512,
        "steps": 6,
        "cascade": False,
        "targetFaces": 200000,
        "textureSize": 1024,
        "simplifyFirst": True,
        "seed": 80301,
    }
    assert fixture["decisionRule"]["ifExactIsClean"] == "stop; source ambiguity explains the cat-fur failure"
    assert fixture["decisionRule"]["ifExactIsDegraded"] == "run one higher-quality rung on this same source"

    result = json.loads((ROOT / "result.json").read_text())
    output = ROOT / result["output"]["path"]
    assert output.stat().st_size > 4096
    assert hashlib.sha256(output.read_bytes()).hexdigest() == result["output"]["sha256"]
    assert result["effectiveRoute"]["resolution"] == exact["resolution"]
    assert result["effectiveRoute"]["steps"] == exact["steps"]
    assert result["effectiveRoute"]["targetFaces"] == exact["targetFaces"]
    assert result["effectiveRoute"]["textureSize"] == exact["textureSize"]
    assert result["geometry"]["extractedFaces"] == 3266734
    assert result["geometry"]["simplifiedFaces"] == 199999
    assert result["visualDisposition"] == "coherent-broad-tufts-survive-cheap-route"
    assert len(result["orbit"]) == 6
    for entry in result["orbit"]:
        image = ROOT / entry["path"]
        assert image.stat().st_size > 4096
        assert hashlib.sha256(image.read_bytes()).hexdigest() == entry["sha256"]


if __name__ == "__main__":
    main()
