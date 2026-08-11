#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED_SOURCE = "de991bc18b4b3a689de25dcde24665058960b7b4877079c7e3c28c58a5047d2d"


def main() -> None:
    failure = ROOT / "mps-geometry-output" / "dense-render-az120-el12.failure.json"
    assert not failure.exists()
    manifest = json.loads(
        (ROOT / "mps-geometry-output" / "dense-render-az120-el12.json").read_text()
    )
    assert manifest["status"] == "completed"
    assert manifest["source"]["sha256"] == EXPECTED_SOURCE
    assert manifest["geometry"]["polygonCount"] == 27134294
    route = manifest["effectiveRoute"]
    assert route["engine"] == "CYCLES"
    assert route["cyclesDevice"] == "CPU"
    assert route["samples"] == 8
    assert route["azimuthDegrees"] == 120.0
    assert route["elevationDegrees"] == 12.0
    output = ROOT / "mps-geometry-output" / "dense-render-az120-el12.png"
    assert output.stat().st_size > 4096
    assert hashlib.sha256(output.read_bytes()).hexdigest() == manifest["output"]["sha256"]


if __name__ == "__main__":
    main()
