#!/usr/bin/env python3
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
EXPECTED_SOURCE_SHA256 = "933c10aeebb2920b08cb34a08ab1878817b64eb9e30efdcc3d76731069fc0849"
EXPECTED_ROUTE = {
    "jobType": "trellis_mac_fine_fur_mps_geometry_0810",
    "requestedBackend": "mps",
    "requestedDevice": "mps:0",
    "cpuFallbackPermitted": True,
    "modelId": "microsoft/TRELLIS.2-4B",
    "modelRevision": None,
    "pipelineType": "512",
    "steps": 6,
    "retainedMeshAttributes": ["vertices", "faces"],
    "textureStageObservation": "not-instrumented",
    "targetFaces": 500000,
    "seed": 80301,
    "torchVersion": "2.12.1",
    "env": {
        "ATTN_BACKEND": "sdpa",
        "PYTORCH_ENABLE_MPS_FALLBACK": "1",
        "SPARSE_ATTN_BACKEND": "sdpa",
        "SPARSE_CONV_BACKEND": "flex_gemm",
    },
}


def main() -> None:
    result = json.loads((ROOT / "mps-result.json").read_text())
    assert result["status"] == "partial"
    assert result["failurePhase"] == "geometry-simplification-target"
    assert result["sourceSha256"] == EXPECTED_SOURCE_SHA256
    source = ROOT / "source" / "official-dwarf-fur-cloak.webp"
    assert hashlib.sha256(source.read_bytes()).hexdigest() == EXPECTED_SOURCE_SHA256
    assert result["effectiveRoute"] == EXPECTED_ROUTE
    assert result["trellis"]["commit"] == "d58628f4f5b9c3de8274cb110074154f4b31cef2"
    assert result["trellis"]["dirty"] is True
    runner = ROOT / result["runner"]["path"]
    assert hashlib.sha256(runner.read_bytes()).hexdigest() == result["runner"]["correctedSha256"]
    assert result["greenroom"]["jobId"]
    assert result["greenroom"]["effectiveJobType"] == EXPECTED_ROUTE["jobType"]
    assert result["greenroom"]["transportStatus"] == "done"
    assert result["greenroom"]["semanticStatus"] == "partial"

    geometry = result["geometry"]
    assert geometry["rawVertices"] > 0
    assert geometry["rawFaces"] > geometry["finalFaces"]
    assert geometry["finalFaces"] > EXPECTED_ROUTE["targetFaces"]
    assert geometry["targetSatisfied"] is False

    assert result["output"]["bytes"] > 4096
    assert result["output"]["sha256"] == "de991bc18b4b3a689de25dcde24665058960b7b4877079c7e3c28c58a5047d2d"
    assert result["output"]["retention"] == "local-worktree-only-large-artifact"
    assert result["output"]["durableReplay"] is False
    assert result["output"]["durableVisualEvidence"] is True
    raw_glb = ROOT / result["output"]["path"]
    if raw_glb.exists():
        assert raw_glb.stat().st_size == result["output"]["bytes"]
        assert hashlib.sha256(raw_glb.read_bytes()).hexdigest() == result["output"]["sha256"]

    assert len(result["orbit"]) == 4
    for entry in result["orbit"]:
        image = ROOT / entry["path"]
        assert image.stat().st_size > 4096
        assert hashlib.sha256(image.read_bytes()).hexdigest() == entry["sha256"]

    assert result["visualDisposition"] in {
        "fine-clump-organization-materially-healthier-than-mlx",
        "fine-clump-organization-not-materially-healthier-than-mlx",
    }


if __name__ == "__main__":
    main()
