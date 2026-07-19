#!/usr/bin/env python3
"""Contracts for the source-bound Grid96 covariance regime characterizer."""

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
SCRIPT = ROOT / "volume-grid96-covariance-regime-characterizer.py"
assert SCRIPT.exists(), "Grid96 covariance regime characterizer implementation is missing"

spec = importlib.util.spec_from_file_location("kaminos_grid96_covariance_regimes", SCRIPT)
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
        "position.world.x",
        "position.world.y",
        "position.world.z",
        "position.nativeCellIndex",
        "kernel.normalizedMass",
        "kernel.firstMoment.x",
        "kernel.firstMoment.y",
        "kernel.firstMoment.z",
        "kernel.covariance.xx",
        "kernel.covariance.xy",
        "kernel.covariance.xz",
        "kernel.covariance.yy",
        "kernel.covariance.yz",
        "kernel.covariance.zz",
        "kernel.radiusWorld",
        "kernel.coherence",
        "structure.normal.x",
        "structure.normal.y",
        "structure.normal.z",
        "structure.normalValid",
        "flow.tangent.x",
        "flow.tangent.y",
        "flow.tangent.z",
        "flow.coherence",
        "flow.curl.x",
        "flow.curl.y",
        "flow.curl.z",
        "flow.curlMagnitude",
    ]
    return required + [f"fixture.filler.{index}" for index in range(100 - len(required))]


def make_fixture(root: Path) -> tuple[Path, Path, np.ndarray]:
    ids = np.asarray((7, 19, 31, 43), dtype=np.uint32)
    order = descriptor_order()
    descriptors = np.zeros((ids.size, len(order)), dtype="<f4")
    descriptors[:, 0:3] = np.asarray(
        ((0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (2.0, 0.0, 0.0), (3.0, 0.0, 0.0)), dtype=np.float32
    )
    descriptors[:, 3] = ids.astype(np.float32)
    descriptors[:, 4] = 1.0
    descriptors[:, 14] = 0.02
    descriptors[:, 15] = np.asarray((0.0, 0.9, 0.7, 0.3), dtype=np.float32)
    descriptors[:, 16:19] = np.asarray((0.0, 0.0, 1.0), dtype=np.float32)
    descriptors[:, 19] = 1.0
    descriptors[:, 20:23] = np.asarray((1.0, 0.0, 0.0), dtype=np.float32)
    descriptors[:, 23] = np.asarray((0.0, 1.0, 0.8, 0.4), dtype=np.float32)
    descriptors[:, 27] = np.asarray((0.0, 2.0, 4.0, 6.0), dtype=np.float32)

    covariances = (
        np.diag((0.0, 0.0, 0.0)),
        np.diag((1.0, 0.0, 0.0)),
        np.diag((1.0, 0.5, 0.01)),
        np.diag((1.0, 0.5, 0.3)),
    )
    covariance_indices = (8, 9, 10, 11, 12, 13)
    for row, covariance in enumerate(covariances):
        descriptors[row, list(covariance_indices)] = (
            covariance[0, 0],
            covariance[0, 1],
            covariance[0, 2],
            covariance[1, 1],
            covariance[1, 2],
            covariance[2, 2],
        )

    coefficients = np.asarray(
        (
            (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
            (1.0, 0.5, 0.25, 0.1, 0.0, 0.0, 0.0, 0.0),
            (0.0, 0.0, 0.0, 0.0, 0.4, 0.3, 0.2, 0.1),
            (0.5, 0.4, 0.3, 0.2, 0.2, 0.1, 0.05, 0.1),
        ),
        dtype="<f4",
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
    control_identity = "sha256:" + "6" * 64
    route = {"effective": "native-3d-compute-fluid-raymarch-v0", "backend": "WebGPU:apple", "fallbackReason": None}

    descriptor_manifest = {
        "schema": "kaminos.volume.grid96-native-component.v0",
        "status": "complete",
        "failurePhase": None,
        "grid": 96,
        "sameStateCaptureId": "fixture-grid96-state120",
        "simStepCount": 120,
        "requestedControlIdentity": control_identity,
        "effectiveControlIdentity": control_identity,
        "sourceManifestSha256": source_manifest_sha,
        "route": route,
        "role": "descriptors",
        "identity": "flow-kernel-local-descriptor-socket-v0",
        "kernelIdentity": "flow-tangent-positive-symmetric-trilinear-v0",
        "nativeCellIndexSha256": native_sha(ids),
        "rowCount": int(ids.size),
        "strideFloats": len(order),
        "descriptorOrder": order,
        "artifact": {
            "path": str(descriptor_path),
            "bytes": descriptor_path.stat().st_size,
            "sha256": sha256(descriptor_path),
            "dtype": "float32-le",
            "shape": [int(ids.size), len(order)],
            "strideFloats": len(order),
            "descriptorOrder": order,
            "sourceHashes": source_hashes,
            "sourceManifestSha256": source_manifest_sha,
        },
    }
    coefficient_manifest = {
        "schema": "kaminos.volume.grid96-native-component.v0",
        "status": "complete",
        "failurePhase": None,
        "grid": 96,
        "sameStateCaptureId": "fixture-grid96-state120",
        "simStepCount": 120,
        "requestedControlIdentity": control_identity,
        "effectiveControlIdentity": control_identity,
        "sourceManifestSha256": source_manifest_sha,
        "route": route,
        "role": "coefficients",
        "identity": "exact-local-layer-emission-extinction-v0",
        "channels": [
            "ridge.emission.r",
            "ridge.emission.g",
            "ridge.emission.b",
            "ridge.extinction",
            "nonRidge.emission.r",
            "nonRidge.emission.g",
            "nonRidge.emission.b",
            "nonRidge.extinction",
        ],
        "nativeCellIndexSha256": native_sha(ids),
        "rowCount": int(ids.size),
        "artifact": {
            "path": str(coefficient_path),
            "bytes": coefficient_path.stat().st_size,
            "sha256": sha256(coefficient_path),
            "dtype": "float32-le",
            "shape": [int(ids.size), 8],
            "nativeCellIndexSha256": native_sha(ids),
        },
    }
    descriptor_manifest_path = root / "descriptor-manifest.json"
    coefficient_manifest_path = root / "coefficient-manifest.json"
    descriptor_manifest_path.write_text(json.dumps(descriptor_manifest))
    coefficient_manifest_path.write_text(json.dumps(coefficient_manifest))
    return descriptor_manifest_path, coefficient_manifest_path, ids


matrices = MODULE.assemble_covariance(
    np.asarray(
        (
            (1.0, 0.0, 0.0, 0.5, 0.0, 0.25),
            (2.0, 0.1, 0.2, 1.0, 0.3, 0.5),
        ),
        dtype=np.float32,
    )
)
assert matrices.shape == (2, 3, 3)
assert np.allclose(matrices, np.swapaxes(matrices, 1, 2))

ids = np.asarray((9, 2, 7, 4), dtype=np.uint32)
values = np.asarray((0.5, 0.1, 0.9, 0.5), dtype=np.float64)
weights = np.asarray((1.0, 2.0, 3.0, 4.0), dtype=np.float64)
quantiles = (0.1, 0.5, 0.9)
first = MODULE.weighted_quantiles(values, weights, ids, quantiles)
permutation = np.asarray((2, 0, 3, 1))
second = MODULE.weighted_quantiles(values[permutation], weights[permutation], ids[permutation], quantiles)
assert np.allclose(first, second), "weighted quantiles must be stable under row permutation"

floating_mass = np.random.default_rng(2).random(1000)
floating_concentration = MODULE.optical_concentration(floating_mass, np.arange(1000, dtype=np.uint32))
assert floating_concentration["massFractionByTopRowFraction"]["p100"]["massFraction"] <= 1.0, (
    "reported cumulative mass fractions must remain inside [0,1] despite summation drift"
)

with tempfile.TemporaryDirectory(prefix="kaminos-grid96-covariance-contract-") as temp:
    root = Path(temp)
    descriptor_manifest, coefficient_manifest, fixture_ids = make_fixture(root)
    output = root / "output"
    completed = subprocess.run(
        (
            sys.executable,
            str(SCRIPT),
            "--descriptor-manifest",
            str(descriptor_manifest),
            "--coefficient-manifest",
            str(coefficient_manifest),
            "--output-dir",
            str(output),
            "--rank-threshold",
            "0.15",
        ),
        check=False,
        capture_output=True,
        text=True,
    )
    assert completed.returncode == 0, completed.stderr
    report = json.loads((output / "report.json").read_text())
    assert report["status"] == "complete"
    assert report["failurePhase"] is None
    assert report["execution"]["sampleCap"] is None
    assert report["execution"]["droppedRowCount"] == 0
    assert report["source"]["rowCount"] == fixture_ids.size
    assert report["source"]["nativeCellIndexSha256"] == native_sha(fixture_ids)
    assert report["covariance"]["materiallyNonPsdRowCount"] == 0
    assert report["regimes"]["counts"] == {"degenerate": 1, "rank1": 1, "sheet": 1, "volumetric": 1}
    assert report["alignment"]["principalVsFlowTangent"]["mean"] > 0.99
    assert report["alignment"]["minorVsValidNormalValidRowCount"] == 2, (
        "rank-one null-space eigenvectors must not masquerade as a defined minor axis"
    )
    assert report["alignment"]["minorVsValidNormal"]["mean"] > 0.99
    assert report["opticalWeight"]["positiveRowCount"] == 3
    assert report["opticalWeight"]["layers"]["ridge"]["positiveRowCount"] == 2
    assert report["opticalWeight"]["layers"]["nonRidge"]["positiveRowCount"] == 2
    assert report["opticalWeight"]["concentration"]["combined"]["rowsForMassFraction"]["p90"]["rowCount"] <= 3
    assert report["claimBoundary"] == {
        "targetImageUsed": False,
        "supportRedefined": False,
        "coefficientsChanged": False,
        "notRendererVerdict": True,
        "notRuntimeEstimate": True,
        "notLearnerCampaign": True,
    }

    regime_manifest = json.loads((output / "grid96-covariance-regime-manifest.json").read_text())
    assert regime_manifest["rowCount"] == fixture_ids.size
    assert regime_manifest["rowOrderIdentity"] == "caller-ordered-native-cell-index-v0"
    assert regime_manifest["descriptorArtifactSha256"] == json.loads(descriptor_manifest.read_text())["artifact"]["sha256"]
    assert regime_manifest["candidateOrder"] == [
        "center.x",
        "center.y",
        "center.z",
        "covariance.xx",
        "covariance.xy",
        "covariance.xz",
        "covariance.yy",
        "covariance.yz",
        "covariance.zz",
        "eigenvalue.major",
        "eigenvalue.middle",
        "eigenvalue.minor",
        "radiusWorld",
        "kernelCoherence",
        "ridgeOpticalWeight",
        "nonRidgeOpticalWeight",
        "opticalWeight",
        "regimeConfidence",
    ]
    candidates = np.fromfile(regime_manifest["candidateArtifact"]["path"], dtype="<f4").reshape(fixture_ids.size, 18)
    regimes = np.fromfile(regime_manifest["regimeArtifact"]["path"], dtype=np.uint8)
    emitted_ids = np.fromfile(regime_manifest["nativeCellIndexArtifact"]["path"], dtype="<u4")
    assert np.array_equal(emitted_ids, fixture_ids)
    assert np.array_equal(regimes, np.asarray((0, 1, 2, 3), dtype=np.uint8))
    assert np.all(np.isfinite(candidates))
    assert np.all(candidates[:, 9:12] >= 0.0), "emitted eigenvalues must be PSD-clamped"
    assert np.all(candidates[:, 14:17] >= 0.0), "layer and combined optical weights must remain nonnegative"
    assert np.allclose(candidates[:, 16], candidates[:, 14] + candidates[:, 15])

    forged = json.loads(descriptor_manifest.read_text())
    forged["artifact"]["sha256"] = "f" * 64
    descriptor_manifest.write_text(json.dumps(forged))
    failed_output = root / "failed-output"
    failed = subprocess.run(
        (
            sys.executable,
            str(SCRIPT),
            "--descriptor-manifest",
            str(descriptor_manifest),
            "--coefficient-manifest",
            str(coefficient_manifest),
            "--output-dir",
            str(failed_output),
        ),
        check=False,
        capture_output=True,
        text=True,
    )
    assert failed.returncode != 0
    failed_report = json.loads((failed_output / "report.json").read_text())
    assert failed_report["status"] == "failed"
    assert failed_report["failurePhase"] == "source-validation"
    assert "descriptor artifact SHA-256" in failed_report["error"]["message"]

print("volume-grid96 covariance regime characterizer contracts passed")
