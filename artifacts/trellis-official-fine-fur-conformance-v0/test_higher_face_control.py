#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def main() -> None:
    fixture = json.loads((ROOT / "fixture.json").read_text())
    cheap = fixture["cells"]["exactCheapRoute"]
    conditional = dict(fixture["cells"]["conditionalHigherFaceRoute"])
    run_only_if = conditional.pop("runOnlyIf")
    assert run_only_if == "exactCheapRoute visibly collapses or merges the source cloak clumps"
    assert conditional == {**cheap, "targetFaces": 1000000}

    cheap_result = json.loads((ROOT / "result.json").read_text())
    assert cheap_result["visualDisposition"] == "organized-fine-clumps-degrade-on-cheap-route"

    result = json.loads((ROOT / "higher-face-result.json").read_text())
    assert result["effectiveRoute"] == conditional
    output = ROOT / result["output"]["path"]
    assert output.stat().st_size > 4096
    assert hashlib.sha256(output.read_bytes()).hexdigest() == result["output"]["sha256"]
    assert 0 < result["geometry"]["simplifiedFaces"] <= conditional["targetFaces"]
    assert result["visualDisposition"] in {
        "organized-fine-clumps-improve-at-one-million-faces",
        "organized-fine-clumps-do-not-improve-at-one-million-faces",
    }
    assert len(result["orbit"]) == 6
    for entry in result["orbit"]:
        image = ROOT / entry["path"]
        assert image.stat().st_size > 4096
        assert hashlib.sha256(image.read_bytes()).hexdigest() == entry["sha256"]


if __name__ == "__main__":
    main()
