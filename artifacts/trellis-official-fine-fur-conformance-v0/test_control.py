#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED_SOURCE_SHA256 = "933c10aeebb2920b08cb34a08ab1878817b64eb9e30efdcc3d76731069fc0849"
EXPECTED_CHEAP_ROUTE = {
    "jobType": "trellis2mlx_fast",
    "resolution": 512,
    "steps": 6,
    "cascade": False,
    "targetFaces": 200000,
    "textureSize": 1024,
    "simplifyFirst": True,
    "seed": 80301,
}


def main() -> None:
    fixture = json.loads((ROOT / "fixture.json").read_text())
    source = ROOT / fixture["source"]["copiedPath"]
    assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED_SOURCE_SHA256
    assert fixture["source"]["dimensions"] == [932, 932]
    assert fixture["source"]["canonicalPath"].endswith(
        "50b70c5f88a5961d2c786158655d2fce5c3b214b2717956500a66a4e5b5fbe37.webp"
    )
    assert fixture["cells"]["exactCheapRoute"] == EXPECTED_CHEAP_ROUTE
    assert fixture["cells"]["conditionalHigherFaceRoute"]["targetFaces"] == 1000000
    assert "runOnlyIf" in fixture["cells"]["conditionalHigherFaceRoute"]

    result = json.loads((ROOT / "result.json").read_text())
    assert result["effectiveRoute"] == EXPECTED_CHEAP_ROUTE
    output = ROOT / result["output"]["path"]
    assert output.stat().st_size > 4096
    assert hashlib.sha256(output.read_bytes()).hexdigest() == result["output"]["sha256"]
    assert result["geometry"]["extractedVertices"] > 0
    assert result["geometry"]["extractedFaces"] > 0
    # The target is a simplification ceiling; cleanup may lawfully remove more faces.
    assert 0 < result["geometry"]["simplifiedFaces"] <= EXPECTED_CHEAP_ROUTE["targetFaces"]
    assert result["visualDisposition"] in {
        "organized-fine-clumps-survive-cheap-route",
        "organized-fine-clumps-degrade-on-cheap-route",
    }
    assert len(result["orbit"]) == 6
    for entry in result["orbit"]:
        image = ROOT / entry["path"]
        assert image.stat().st_size > 4096
        assert hashlib.sha256(image.read_bytes()).hexdigest() == entry["sha256"]


if __name__ == "__main__":
    main()
