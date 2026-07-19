#!/usr/bin/env python3
"""Contracts for the Grid96 missing-Non-Ridge material-density basis assay."""

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
SCRIPT = ROOT / "volume-grid96-nonridge-material-basis-characterizer.py"
assert SCRIPT.exists(), "Grid96 Non-Ridge material-basis characterizer implementation is missing"

spec = importlib.util.spec_from_file_location("kaminos_grid96_nonridge_material_basis", SCRIPT)
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
        "value.sidecar.x", "value.sidecar.y", "value.sidecar.z", "value.sidecar.w",
        "value.material.x", "value.fire.x",
        "gradient.material.x.x", "gradient.material.x.y", "gradient.material.x.z",
    ]
    return required + [f"fixture.filler.{index}" for index in range(100 - len(required))]


def make_fixture(root: Path) -> tuple[Path, Path, Path, np.ndarray]:
    ids = np.asarray((7, 19, 31, 43, 59, 61, 73), dtype=np.uint32)
    order = descriptor_order()
    lookup = {name: index for index, name in enumerate(order)}
    descriptors = np.zeros((ids.size, len(order)), dtype="<f4")
    descriptors[:, 0:3] = np.asarray(tuple((float(index), 0.0, 0.0) for index in range(ids.size)))
    descriptors[:, lookup["position.nativeCellIndex"]] = ids.astype(np.float32)
    descriptors[:, lookup["kernel.normalizedMass"]] = 1.0
    descriptors[:, lookup["kernel.radiusWorld"]] = 0.02
    descriptors[:, lookup["kernel.coherence"]] = 0.8
    descriptors[:, [lookup["structure.normal.x"], lookup["structure.normal.y"], lookup["structure.normal.z"]]] = (
        (0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0),
        (0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
    )
    descriptors[:, lookup["structure.normalValid"]] = (1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    descriptors[:, [lookup["flow.tangent.x"], lookup["flow.tangent.y"], lookup["flow.tangent.z"]]] = (
        (1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 0.0, 0.0),
    )
    descriptors[:, lookup["flow.coherence"]] = 0.7
    descriptors[:, [lookup["gradient.material.x.x"], lookup["gradient.material.x.y"], lookup["gradient.material.x.z"]]] = (
        (0.0, 0.0, 1.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0),
        (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 0.0, 0.0), (0.0, 1.0, 0.0),
    )
    descriptors[:, lookup["value.sidecar.x"]] = (0.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0)
    descriptors[:, lookup["value.sidecar.y"]] = (0.6, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0)
    descriptors[:, lookup["value.sidecar.z"]] = (0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
    descriptors[:, lookup["value.sidecar.w"]] = 0.16
    descriptors[:, lookup["value.material.x"]] = (0.4, 0.3, 0.2, 0.2, 0.2, 0.2, 0.2)
    descriptors[:, lookup["value.fire.x"]] = (0.2, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7)

    coefficients = np.asarray(
        (
            (1.0, 0.5, 0.25, 0.1, 0.4, 0.2, 0.1, 0.05),
            (0.0, 0.0, 0.0, 0.0, 1.0, 0.5, 0.2, 0.1),
            (0.0, 0.0, 0.0, 0.0, 0.8, 0.4, 0.1, 0.1),
            (0.0, 0.0, 0.0, 0.0, 0.7, 0.3, 0.1, 0.1),
            (0.0, 0.0, 0.0, 0.0, 0.6, 0.2, 0.1, 0.1),
            (0.0, 0.0, 0.0, 0.0, 0.5, 0.2, 0.1, 0.1),
            (0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0),
        ), dtype="<f4",
    )
    descriptor_path = root / "descriptors.f32"
    coefficient_path = root / "coefficients.f32"
    descriptor_path.write_bytes(descriptors.tobytes())
    coefficient_path.write_bytes(coefficients.tobytes())
    source_hashes = {
        "fluidSha256": "1" * 64, "frontSha256": "2" * 64,
        "boundarySidecarSha256": "3" * 64, "majorantSha256": "4" * 64,
    }
    component_source = "5" * 64
    descriptor_source = "7" * 64
    control_identity = "sha256:" + "6" * 64
    route = {"effective": "native-3d-compute-fluid-raymarch-v0", "backend": "WebGPU:apple", "fallbackReason": None}
    common = {
        "schema": "kaminos.volume.grid96-native-component.v0", "status": "complete", "failurePhase": None,
        "grid": 96, "sameStateCaptureId": "fixture-grid96-state120", "simStepCount": 120,
        "requestedControlIdentity": control_identity, "effectiveControlIdentity": control_identity,
        "sourceManifestSha256": component_source, "route": route,
        "nativeCellIndexSha256": native_sha(ids), "rowCount": int(ids.size),
    }
    descriptor_manifest = common | {
        "role": "descriptors", "identity": "flow-kernel-local-descriptor-socket-v0",
        "kernelIdentity": "flow-tangent-positive-symmetric-trilinear-v0", "strideFloats": len(order),
        "descriptorOrder": order,
        "artifact": {"path": str(descriptor_path), "bytes": descriptor_path.stat().st_size,
                     "sha256": sha256(descriptor_path), "dtype": "float32-le", "shape": [int(ids.size), len(order)],
                     "strideFloats": len(order), "descriptorOrder": order, "sourceHashes": source_hashes,
                     "sourceManifestSha256": descriptor_source},
    }
    coefficient_manifest = common | {
        "role": "coefficients", "identity": "exact-local-layer-emission-extinction-v0",
        "channels": list(MODULE.BASE.COEFFICIENT_ORDER),
        "artifact": {"path": str(coefficient_path), "bytes": coefficient_path.stat().st_size,
                     "sha256": sha256(coefficient_path), "dtype": "float32-le", "shape": [int(ids.size), 8],
                     "nativeCellIndexSha256": native_sha(ids)},
    }
    dm = root / "descriptor-manifest.json"
    cm = root / "coefficient-manifest.json"
    dm.write_text(json.dumps(descriptor_manifest))
    cm.write_text(json.dumps(coefficient_manifest))
    exact_source_receipt = {
        "schema": "kaminos.volume.grid96-exact-component-pair-receipt.v0",
        "descriptorManifestSha256": sha256(dm),
        "coefficientManifestSha256": sha256(cm),
        "descriptorArtifactSha256": sha256(descriptor_path),
        "coefficientArtifactSha256": sha256(coefficient_path),
        "nativeCellIndexSha256": native_sha(ids),
        "sameStateCaptureId": common["sameStateCaptureId"],
        "requestedControlIdentity": common["requestedControlIdentity"],
        "effectiveControlIdentity": common["effectiveControlIdentity"],
        "componentSourceManifestSha256": component_source,
        "descriptorSourceManifestSha256": descriptor_source,
    }
    receipt_path = root / "exact-source-receipt.json"
    receipt_path.write_text(json.dumps(exact_source_receipt))
    return dm, cm, receipt_path, ids


with tempfile.TemporaryDirectory(prefix="kaminos-grid96-nonridge-material-basis-") as temp:
    root = Path(temp)
    descriptor_manifest, coefficient_manifest, exact_source_receipt, ids = make_fixture(root)
    output_a = root / "output-a"
    def command_for(output_dir: Path) -> tuple[str, ...]:
        return (
            sys.executable, str(SCRIPT), "--descriptor-manifest", str(descriptor_manifest),
            "--coefficient-manifest", str(coefficient_manifest), "--output-dir", str(output_dir),
            "--exact-source-receipt", str(exact_source_receipt),
            "--conditioning-epsilon", "1e-6",
        )

    command = command_for(output_a)
    completed = subprocess.run(command, check=False, capture_output=True, text=True)
    assert completed.returncode == 0, completed.stderr
    report = json.loads((output_a / "report.json").read_text())
    manifest = json.loads((output_a / "grid96-nonridge-material-basis-manifest.json").read_text())
    assert report["status"] == "complete" and report["failurePhase"] is None
    assert report["source"]["componentSourceManifestSha256"] == "5" * 64
    assert report["source"]["descriptorSourceManifestSha256"] == "7" * 64
    assert report["source"]["exactSourceReceiptSha256"] == sha256(exact_source_receipt)
    assert report["execution"] == {"rowCount": 7, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False}
    assert report["coverage"]["basisValidRowCount"] == 2
    assert report["coverage"]["reasonCounts"] == {
        "valid": 2, "declaredStructureNormal": 1, "zeroNonRidgeWeight": 1,
        "gradientZero": 1, "tangentZero": 1, "parallel": 1,
    }
    assert report["coverage"]["missingNonRidgeMassRecoveryFraction"] > 0.0
    assert report["overlapAgreement"]["rowCount"] == 1
    assert report["claimBoundary"]["fallbackInstalled"] is False
    assert report["claimBoundary"]["composedWithStructureBasis"] is False
    assert manifest["basis"]["normalSource"] == "gradient.material.x"
    assert manifest["basis"]["cohort"] == "structure-normal-undeclared-positive-nonridge-v0"
    assert manifest["artifacts"]["nativeCellIndex"]["sha256"] == native_sha(ids)

    basis = np.fromfile(manifest["artifacts"]["basis"]["path"], dtype="<f4").reshape(7, len(MODULE.BASIS_ORDER))
    validity_index = MODULE.BASIS_ORDER.index("basis.valid")
    assert basis[:, validity_index].tolist() == [0.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0]
    assert np.all(np.isfinite(basis))

    output_b = root / "output-b"
    replay = subprocess.run(command_for(output_b), check=False, capture_output=True, text=True)
    assert replay.returncode == 0, replay.stderr
    replay_manifest = json.loads((output_b / "grid96-nonridge-material-basis-manifest.json").read_text())
    for name in ("basis", "reasonCodes", "nativeCellIndex"):
        assert replay_manifest["artifacts"][name]["sha256"] == manifest["artifacts"][name]["sha256"]

    original_descriptor = json.loads(descriptor_manifest.read_text())
    original_coefficient = json.loads(coefficient_manifest.read_text())
    alternate_control = "sha256:" + "8" * 64
    for source_path, payload, target_name in (
        (descriptor_manifest, original_descriptor, "alternate-descriptor-manifest.json"),
        (coefficient_manifest, original_coefficient, "alternate-coefficient-manifest.json"),
    ):
        alternate = json.loads(json.dumps(payload))
        alternate["sameStateCaptureId"] = "alternate-grid96-state120"
        alternate["requestedControlIdentity"] = alternate_control
        alternate["effectiveControlIdentity"] = alternate_control
        (root / target_name).write_text(json.dumps(alternate))
    alternate_output = root / "alternate-source-output"
    alternate = subprocess.run(
        (sys.executable, str(SCRIPT),
         "--descriptor-manifest", str(root / "alternate-descriptor-manifest.json"),
         "--coefficient-manifest", str(root / "alternate-coefficient-manifest.json"),
         "--exact-source-receipt", str(exact_source_receipt),
         "--output-dir", str(alternate_output)),
        check=False, capture_output=True, text=True,
    )
    assert alternate.returncode != 0
    alternate_failed = json.loads((alternate_output / "report.json").read_text())
    assert alternate_failed["status"] == "failed" and alternate_failed["failurePhase"] == "source-validation"
    assert "descriptor manifest SHA-256 does not match exact-source receipt" in alternate_failed["error"]["message"]
    assert not (alternate_output / "grid96-nonridge-material-basis-manifest.json").exists()

    changed_coefficients = np.fromfile(root / "coefficients.f32", dtype="<f4")
    changed_coefficients[0] += 0.125
    changed_coefficient_path = root / "changed-coefficients.f32"
    changed_coefficients.tofile(changed_coefficient_path)
    changed_coefficient_manifest = json.loads(json.dumps(original_coefficient))
    changed_coefficient_manifest["artifact"]["path"] = str(changed_coefficient_path)
    changed_coefficient_manifest["artifact"]["bytes"] = changed_coefficient_path.stat().st_size
    changed_coefficient_manifest["artifact"]["sha256"] = sha256(changed_coefficient_path)
    changed_coefficient_manifest_path = root / "changed-coefficient-manifest.json"
    changed_coefficient_manifest_path.write_text(json.dumps(changed_coefficient_manifest))
    changed_output = root / "changed-coefficient-output"
    changed = subprocess.run(
        (sys.executable, str(SCRIPT),
         "--descriptor-manifest", str(descriptor_manifest),
         "--coefficient-manifest", str(changed_coefficient_manifest_path),
         "--exact-source-receipt", str(exact_source_receipt),
         "--output-dir", str(changed_output)),
        check=False, capture_output=True, text=True,
    )
    assert changed.returncode != 0
    changed_failed = json.loads((changed_output / "report.json").read_text())
    assert changed_failed["status"] == "failed" and changed_failed["failurePhase"] == "source-validation"
    assert "coefficient manifest SHA-256 does not match exact-source receipt" in changed_failed["error"]["message"]
    assert not (changed_output / "grid96-nonridge-material-basis-manifest.json").exists()

    descriptor_artifact = root / "descriptors.f32"
    descriptor_artifact.write_bytes(descriptor_artifact.read_bytes() + b"forged")
    forged_output = root / "forged-output"
    forged = subprocess.run(
        (sys.executable, str(SCRIPT), "--descriptor-manifest", str(descriptor_manifest),
         "--coefficient-manifest", str(coefficient_manifest),
         "--exact-source-receipt", str(exact_source_receipt), "--output-dir", str(forged_output)),
        check=False, capture_output=True, text=True,
    )
    assert forged.returncode != 0
    failed = json.loads((forged_output / "report.json").read_text())
    assert failed["status"] == "failed" and failed["failurePhase"] == "source-validation"
    assert "descriptor artifact byte length drifted" in failed["error"]["message"]
    assert not (forged_output / "grid96-nonridge-material-basis-manifest.json").exists()

print("volume-grid96 Non-Ridge material-basis characterizer contracts passed")
