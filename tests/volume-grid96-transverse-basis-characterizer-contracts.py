#!/usr/bin/env python3
"""Contracts for the source-bound Grid96 transverse-basis characterizer."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-transverse-basis-characterizer.py"
assert SCRIPT.exists(), "Grid96 transverse-basis characterizer implementation is missing"

spec = importlib.util.spec_from_file_location("kaminos_grid96_transverse_basis", SCRIPT)
assert spec is not None and spec.loader is not None
MODULE = importlib.util.module_from_spec(spec)
spec.loader.exec_module(MODULE)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def native_sha(ids: np.ndarray) -> str:
    return hashlib.sha256(np.asarray(ids, dtype="<u4").tobytes()).hexdigest()


def descriptor_order() -> list[str]:
    required = [
        "position.world.x", "position.world.y", "position.world.z", "position.nativeCellIndex",
        "kernel.normalizedMass", "kernel.firstMoment.x", "kernel.firstMoment.y", "kernel.firstMoment.z",
        "kernel.covariance.xx", "kernel.covariance.xy", "kernel.covariance.xz", "kernel.covariance.yy",
        "kernel.covariance.yz", "kernel.covariance.zz", "kernel.radiusWorld", "kernel.coherence",
        "structure.normal.x", "structure.normal.y", "structure.normal.z", "structure.normalValid",
        "flow.tangent.x", "flow.tangent.y", "flow.tangent.z", "flow.coherence",
    ]
    return required + [f"fixture.filler.{index}" for index in range(100 - len(required))]


def make_fixture(root: Path) -> tuple[Path, Path, np.ndarray]:
    ids = np.asarray((7, 19, 31, 43), dtype=np.uint32)
    order = descriptor_order()
    lookup = {name: index for index, name in enumerate(order)}
    descriptors = np.zeros((ids.size, len(order)), dtype="<f4")
    descriptors[:, 0:3] = np.asarray(
        ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0), (3.0, 0.0, 0.0)), dtype=np.float32
    )
    descriptors[:, lookup["position.nativeCellIndex"]] = ids.astype(np.float32)
    descriptors[:, lookup["kernel.normalizedMass"]] = 1.0
    descriptors[:, lookup["kernel.radiusWorld"]] = 0.02
    descriptors[:, lookup["kernel.coherence"]] = (0.9, 0.8, 0.7, 0.6)
    descriptors[:, [lookup["structure.normal.x"], lookup["structure.normal.y"], lookup["structure.normal.z"]]] = (
        (0.0, 0.0, 1.0),
        (0.0, 0.0, 1.0),
        (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0),
    )
    descriptors[:, lookup["structure.normalValid"]] = (1.0, 1.0, 0.0, 1.0)
    descriptors[:, [lookup["flow.tangent.x"], lookup["flow.tangent.y"], lookup["flow.tangent.z"]]] = (
        (1.0, 0.0, 0.0),
        (0.0, 0.0, 1.0),
        (1.0, 0.0, 0.0),
        (1.0, 1.0, 0.0),
    )
    descriptors[:, lookup["flow.coherence"]] = (0.9, 0.8, 0.7, 0.6)

    coefficients = np.asarray(
        (
            (1.0, 0.5, 0.25, 0.1, 0.0, 0.0, 0.0, 0.0),
            (0.5, 0.25, 0.1, 0.05, 0.0, 0.0, 0.0, 0.0),
            (0.0, 0.0, 0.0, 0.0, 0.5, 0.25, 0.1, 0.05),
            (0.0, 0.0, 0.0, 0.0, 1.0, 0.5, 0.25, 0.1),
        ), dtype="<f4",
    )
    descriptor_path = root / "descriptors.f32"
    coefficient_path = root / "coefficients.f32"
    descriptor_path.write_bytes(descriptors.tobytes())
    coefficient_path.write_bytes(coefficients.tobytes())
    source_hashes = {
        "fluidSha256": "1" * 64,
        "frontSha256": "2" * 64,
        "boundarySidecarSha256": "3" * 64,
        "majorantSha256": "4" * 64,
    }
    source_manifest_sha = "5" * 64
    descriptor_source_manifest_sha = "7" * 64
    control_identity = "sha256:" + "6" * 64
    route = {
        "effective": "native-3d-compute-fluid-raymarch-v0",
        "backend": "WebGPU:apple",
        "fallbackReason": None,
    }
    descriptor_manifest = {
        "schema": "kaminos.volume.grid96-native-component.v0",
        "status": "complete", "failurePhase": None, "grid": 96,
        "sameStateCaptureId": "fixture-grid96-state120", "simStepCount": 120,
        "requestedControlIdentity": control_identity, "effectiveControlIdentity": control_identity,
        "sourceManifestSha256": source_manifest_sha, "route": route,
        "role": "descriptors", "identity": "flow-kernel-local-descriptor-socket-v0",
        "kernelIdentity": "flow-tangent-positive-symmetric-trilinear-v0",
        "nativeCellIndexSha256": native_sha(ids), "rowCount": int(ids.size),
        "strideFloats": len(order), "descriptorOrder": order,
        "artifact": {
            "path": str(descriptor_path), "bytes": descriptor_path.stat().st_size,
            "sha256": sha256(descriptor_path), "dtype": "float32-le",
            "shape": [int(ids.size), len(order)], "strideFloats": len(order),
            "descriptorOrder": order, "sourceHashes": source_hashes,
            "sourceManifestSha256": descriptor_source_manifest_sha,
        },
    }
    coefficient_manifest = {
        "schema": "kaminos.volume.grid96-native-component.v0",
        "status": "complete", "failurePhase": None, "grid": 96,
        "sameStateCaptureId": "fixture-grid96-state120", "simStepCount": 120,
        "requestedControlIdentity": control_identity, "effectiveControlIdentity": control_identity,
        "sourceManifestSha256": source_manifest_sha, "route": route,
        "role": "coefficients", "identity": "exact-local-layer-emission-extinction-v0",
        "channels": list(MODULE.BASE.COEFFICIENT_ORDER),
        "nativeCellIndexSha256": native_sha(ids), "rowCount": int(ids.size),
        "artifact": {
            "path": str(coefficient_path), "bytes": coefficient_path.stat().st_size,
            "sha256": sha256(coefficient_path), "dtype": "float32-le",
            "shape": [int(ids.size), 8], "nativeCellIndexSha256": native_sha(ids),
        },
    }
    descriptor_manifest_path = root / "descriptor-manifest.json"
    coefficient_manifest_path = root / "coefficient-manifest.json"
    descriptor_manifest_path.write_text(json.dumps(descriptor_manifest))
    coefficient_manifest_path.write_text(json.dumps(coefficient_manifest))
    return descriptor_manifest_path, coefficient_manifest_path, ids


normals = np.asarray(((0, 0, 1), (0, 0, 1), (0, 1, 0), (0, 0, 1)), dtype=np.float64)
declared = np.asarray((True, True, False, True))
tangents = np.asarray(((1, 0, 0), (0, 0, 1), (1, 0, 0), (1, 1, 0)), dtype=np.float64)
frame = MODULE.derive_transverse_basis(normals, declared, tangents, conditioning_epsilon=1e-6)
assert frame["basisValid"].tolist() == [True, False, False, True]
assert frame["reasonCode"].tolist() == [0, 4, 1, 0]
assert not frame["fallbackUsed"].any(), "transverse basis silently used fallback"
valid = frame["basisValid"]
assert np.allclose(np.sum(frame["tangent"][valid] * frame["normal"][valid], axis=1), 0.0, atol=1e-12)
assert np.allclose(np.sum(frame["tangent"][valid] * frame["binormal"][valid], axis=1), 0.0, atol=1e-12)
assert np.allclose(np.sum(frame["normal"][valid] * frame["binormal"][valid], axis=1), 0.0, atol=1e-12)
assert np.allclose(np.linalg.norm(frame["tangent"][valid], axis=1), 1.0, atol=1e-12)
assert np.allclose(np.linalg.norm(frame["normal"][valid], axis=1), 1.0, atol=1e-12)
assert np.allclose(np.linalg.norm(frame["binormal"][valid], axis=1), 1.0, atol=1e-12)

with tempfile.TemporaryDirectory(prefix="kaminos-grid96-transverse-basis-") as temp:
    root = Path(temp)
    descriptor_manifest, coefficient_manifest, ids = make_fixture(root)
    output_a = root / "output-a"
    command = (
        sys.executable, str(SCRIPT),
        "--descriptor-manifest", str(descriptor_manifest),
        "--coefficient-manifest", str(coefficient_manifest),
        "--output-dir", str(output_a),
        "--conditioning-epsilon", "1e-6",
    )
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    report = json.loads((output_a / "report.json").read_text())
    manifest = json.loads((output_a / "grid96-transverse-basis-manifest.json").read_text())
    assert report["status"] == "complete" and report["failurePhase"] is None
    assert report["source"]["componentSourceManifestSha256"] == "5" * 64
    assert report["source"]["descriptorSourceManifestSha256"] == "7" * 64
    assert "sourceManifestSha256" not in report["source"]
    assert manifest["source"]["componentSourceManifestSha256"] == "5" * 64
    assert manifest["source"]["descriptorSourceManifestSha256"] == "7" * 64
    assert "sourceManifestSha256" not in manifest["source"]
    assert report["execution"] == {
        "rowCount": 4, "sampleCap": None, "droppedRowCount": 0,
        "fallbackRowCount": 0, "targetImageUsed": False,
    }
    assert report["coverage"]["basisValidRowCount"] == 2
    assert report["coverage"]["reasonCounts"] == {
        "valid": 2, "normalUndeclared": 1, "normalZero": 0, "tangentZero": 0, "parallel": 1,
    }
    assert 0.0 < report["coverage"]["opticalMassFraction"]["ridge"] < 1.0
    assert 0.0 < report["coverage"]["opticalMassFraction"]["nonRidge"] < 1.0
    assert report["claimBoundary"]["widthsChosen"] is False
    assert report["claimBoundary"]["fallbackInstalled"] is False
    assert manifest["basis"]["fallbackPolicy"] == "none-invalid-rows-remain-invalid-v0"
    assert manifest["artifacts"]["basis"]["shape"] == [4, len(MODULE.BASIS_ORDER)]
    assert manifest["artifacts"]["reasonCodes"]["shape"] == [4]
    assert manifest["artifacts"]["nativeCellIndex"]["sha256"] == native_sha(ids)

    basis_path = Path(manifest["artifacts"]["basis"]["path"])
    basis = np.fromfile(basis_path, dtype="<f4").reshape(4, len(MODULE.BASIS_ORDER))
    validity_index = MODULE.BASIS_ORDER.index("basis.valid")
    assert basis[:, validity_index].tolist() == [1.0, 0.0, 0.0, 1.0]
    assert np.all(np.isfinite(basis))

    output_b = root / "output-b"
    replay_command = (
        sys.executable, str(SCRIPT),
        "--descriptor-manifest", str(descriptor_manifest),
        "--coefficient-manifest", str(coefficient_manifest),
        "--output-dir", str(output_b),
        "--conditioning-epsilon", "1e-6",
    )
    replay = subprocess.run(replay_command, check=False, capture_output=True, text=True)
    assert replay.returncode == 0, replay.stderr
    replay_manifest = json.loads((output_b / "grid96-transverse-basis-manifest.json").read_text())
    for name in ("basis", "reasonCodes", "nativeCellIndex"):
        assert replay_manifest["artifacts"][name]["sha256"] == manifest["artifacts"][name]["sha256"]

    forged_output = root / "forged-output"
    descriptor_artifact = root / "descriptors.f32"
    descriptor_artifact.write_bytes(descriptor_artifact.read_bytes() + b"forged")
    forged = subprocess.run(
        (
            sys.executable, str(SCRIPT),
            "--descriptor-manifest", str(descriptor_manifest),
            "--coefficient-manifest", str(coefficient_manifest),
            "--output-dir", str(forged_output),
        ), check=False, capture_output=True, text=True,
    )
    assert forged.returncode != 0
    failed = json.loads((forged_output / "report.json").read_text())
    assert failed["status"] == "failed"
    assert failed["failurePhase"] == "source-validation"
    assert not (forged_output / "grid96-transverse-basis-manifest.json").exists()

print("volume-grid96 transverse basis characterizer contracts passed")
