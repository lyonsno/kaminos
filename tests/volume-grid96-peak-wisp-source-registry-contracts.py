#!/usr/bin/env python3
"""Contracts for the zero-copy Grid96 peak/wisp source registry."""

from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "volume-grid96-peak-wisp-source-registry.py"

DESCRIPTOR_ORDER = (
    "position.world.x", "position.world.y", "position.world.z", "position.nativeCellIndex",
    "kernel.normalizedMass", "kernel.firstMoment.x", "kernel.firstMoment.y", "kernel.firstMoment.z",
    "kernel.covariance.xx", "kernel.covariance.xy", "kernel.covariance.xz", "kernel.covariance.yy",
    "kernel.covariance.yz", "kernel.covariance.zz", "kernel.radiusWorld", "kernel.coherence",
    "structure.normal.x", "structure.normal.y", "structure.normal.z", "structure.normalValid",
    "flow.tangent.x", "flow.tangent.y", "flow.tangent.z", "flow.coherence",
    "flow.curl.x", "flow.curl.y", "flow.curl.z", "flow.curlMagnitude", "flow.divergence",
    "flow.curlActivity", "validity.strengthZeroIdentity", "validity.conservativeMajorant",
    "majorant.density", "majorant.fire", "majorant.extinction", "majorant.importance",
    *(f"value.{field}.{channel}" for field in ("sidecar", "material", "fire", "micro") for channel in "xyzw"),
    *(f"gradient.{field}.{channel}.{axis}" for field in ("sidecar", "material", "fire", "micro") for axis in "xyz" for channel in "xyzw"),
)
COEFFICIENT_ORDER = (
    "ridge.emission.r", "ridge.emission.g", "ridge.emission.b", "ridge.extinction",
    "nonRidge.emission.r", "nonRidge.emission.g", "nonRidge.emission.b", "nonRidge.extinction",
)
TRANSVERSE_ORDER = (
    "center.x", "center.y", "center.z", "tangent.x", "tangent.y", "tangent.z",
    "normal.x", "normal.y", "normal.z", "binormal.x", "binormal.y", "binormal.z",
    "radiusWorld", "flowCoherence", "tangentPlaneConditioning", "orthogonalityResidual",
    "ridgeOpticalWeight", "nonRidgeOpticalWeight", "opticalWeight", "basis.valid",
    "structure.normalDeclaredValid",
)
MATERIAL_ORDER = (
    "center.x", "center.y", "center.z", "tangent.x", "tangent.y", "tangent.z",
    "normal.x", "normal.y", "normal.z", "binormal.x", "binormal.y", "binormal.z",
    "gradientMagnitude", "tangentPlaneConditioning", "nonRidgeOpticalWeight", "basis.valid",
    "cohort.missingStructureNormal",
)
CONTINUITY_ORDER = (
    "cohort.code", "nonRidgeOpticalWeight", "sameCohortFaceNeighborCount",
    "tangentAbsDot.mean", "tangentAbsDot.minimum", "tangentAbsDot.maximum",
    "normalAbsDot.mean", "normalAbsDot.minimum", "normalAbsDot.maximum",
    "binormalAbsDot.mean", "binormalAbsDot.minimum", "binormalAbsDot.maximum",
    "continuity.valid",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_payload(path: Path, byte_count: int, marker: int) -> dict[str, object]:
    path.write_bytes(bytes((marker + index) % 251 for index in range(byte_count)))
    return {"path": str(path), "bytes": byte_count, "sha256": sha256(path)}


def write_json(path: Path, value: dict[str, object]) -> str:
    path.write_text(json.dumps(value, sort_keys=True))
    return sha256(path)


def recursively_has_key(value: object, forbidden: set[str]) -> bool:
    if isinstance(value, dict):
        return any(key.lower() in forbidden or recursively_has_key(child, forbidden) for key, child in value.items())
    if isinstance(value, list):
        return any(recursively_has_key(child, forbidden) for child in value)
    return False


with tempfile.TemporaryDirectory(prefix="kaminos-grid96-peak-wisp-registry-") as temp:
    fixture = Path(temp)
    row_count = 3
    common_native = write_payload(fixture / "native.u32", row_count * 4, 1)
    native_sha = common_native["sha256"]
    source_hashes = {
        "fluidSha256": "a" * 64,
        "frontSha256": "b" * 64,
        "boundarySidecarSha256": "c" * 64,
        "majorantSha256": "d" * 64,
    }
    route = {
        "requested": "http://127.0.0.1:19096/?volume_resolution=96",
        "effective": "native-3d-compute-fluid-raymarch-v0",
        "backend": "WebGPU:apple",
        "fallbackReason": None,
    }
    descriptor_artifact = write_payload(fixture / "descriptor.f32", row_count * 100 * 4, 2)
    descriptor_artifact.update({
        "dtype": "float32-le", "shape": [row_count, 100],
        "semanticRole": "camera-independent-flow-kernel-descriptors",
        "descriptorOrder": list(DESCRIPTOR_ORDER), "sourceHashes": source_hashes,
        "sourceManifestSha256": "e" * 64,
    })
    descriptor = {
        "schema": "kaminos.volume.grid96-native-component.v0", "status": "complete",
        "identity": "flow-kernel-local-descriptor-socket-v0", "role": "descriptors",
        "grid": 96, "rowCount": row_count, "strideFloats": 100,
        "nativeCellIndexSha256": native_sha, "sameStateCaptureId": "fixture-grid96-state120",
        "simStepCount": 120, "sourceManifestSha256": "f" * 64,
        "requestedControlIdentity": "sha256:" + "1" * 64,
        "effectiveControlIdentity": "sha256:" + "1" * 64,
        "route": route, "descriptorOrder": list(DESCRIPTOR_ORDER), "artifact": descriptor_artifact,
    }
    descriptor_path = fixture / "descriptor-manifest.json"
    descriptor_manifest_sha = write_json(descriptor_path, descriptor)

    coefficient_artifact = write_payload(fixture / "coefficient.f32", row_count * 8 * 4, 3)
    coefficient_artifact.update({
        "dtype": "float32-le", "shape": [row_count, 8],
        "semanticRole": "exact-local-layer-emission-extinction",
        "nativeCellIndexSha256": native_sha,
    })
    coefficient = {
        "schema": "kaminos.volume.grid96-native-component.v0", "status": "complete",
        "identity": "exact-local-layer-emission-extinction-v0", "role": "coefficients",
        "grid": 96, "rowCount": row_count, "nativeCellIndexSha256": native_sha,
        "sameStateCaptureId": "fixture-grid96-state120", "simStepCount": 120,
        "sourceManifestSha256": "f" * 64,
        "requestedControlIdentity": "sha256:" + "1" * 64,
        "effectiveControlIdentity": "sha256:" + "1" * 64,
        "route": route, "channels": list(COEFFICIENT_ORDER), "nonnegative": True,
        "partitionIdentity": "separate-nonnegative-ridge-and-nonridge-local-coefficients-v0",
        "coefficientBoundary": "per-sample-pre-tone-map-emission-extinction-v0",
        "artifact": coefficient_artifact,
    }
    coefficient_path = fixture / "coefficient-manifest.json"
    coefficient_manifest_sha = write_json(coefficient_path, coefficient)

    exact_receipt = write_payload(fixture / "exact-source-receipt.json", 64, 9)

    source = {
        "grid": 96, "rowCount": row_count, "sameStateCaptureId": "fixture-grid96-state120",
        "simStepCount": 120, "nativeCellIndexSha256": native_sha,
        "descriptorManifestSha256": descriptor_manifest_sha,
        "coefficientManifestSha256": coefficient_manifest_sha,
        "componentSourceManifestSha256": "f" * 64,
        "descriptorSourceManifestSha256": "e" * 64,
        "descriptorArtifactSha256": descriptor_artifact["sha256"],
        "coefficientArtifactSha256": coefficient_artifact["sha256"],
        "sourceHashes": source_hashes, "route": route,
    }

    def basis_manifest(kind: str, order: tuple[str, ...], marker: int) -> tuple[Path, dict[str, object], str]:
        width = len(order)
        basis_artifact = write_payload(fixture / f"{kind}.f32", row_count * width * 4, marker)
        basis_artifact.update({"dtype": "float32-le", "shape": [row_count, width], "semanticRole": f"{kind}-basis"})
        reason_artifact = write_payload(fixture / f"{kind}-reasons.u8", row_count, marker + 1)
        reason_artifact.update({"dtype": "uint8", "shape": [row_count], "semanticRole": f"{kind}-reasons"})
        manifest_source = deepcopy(source)
        basis: dict[str, object]
        if kind == "transverse":
            schema = "kaminos.volume.grid96-transverse-basis-socket.v0"
            basis = {
                "identity": "declared-normal-flow-tangent-orthonormal-frame-v0",
                "fallbackPolicy": "none-invalid-rows-remain-invalid-v0",
                "reasonIdentity": "grid96-transverse-basis-reason-codes-v0",
                "order": list(order),
            }
        else:
            schema = "kaminos.volume.grid96-nonridge-material-basis-socket.v0"
            manifest_source["exactSourceReceiptPath"] = exact_receipt["path"]
            manifest_source["exactSourceReceiptSha256"] = exact_receipt["sha256"]
            basis = {
                "identity": "material-density-gradient-flow-tangent-plane-v0",
                "normalSource": "gradient.material.x",
                "cohort": "structure-normal-undeclared-positive-nonridge-v0",
                "fallbackPolicy": "none-separate-cohort-only-v0",
                "reasonIdentity": "grid96-nonridge-material-basis-reasons-v0",
                "order": list(order),
            }
        manifest = {
            "schema": schema, "status": "complete", "identity": "sha256:" + str(marker) * 64,
            "source": manifest_source, "basis": basis,
            "artifacts": {
                "basis": basis_artifact,
                "nativeCellIndex": {**common_native, "dtype": "uint32-le", "shape": [row_count], "semanticRole": "caller-ordered-native-cell-index"},
                "reasonCodes": reason_artifact,
            },
            "execution": {"rowCount": row_count, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False},
        }
        path = fixture / f"{kind}-manifest.json"
        return path, manifest, write_json(path, manifest)

    transverse_path, transverse, transverse_sha = basis_manifest("transverse", TRANSVERSE_ORDER, 4)
    material_path, material, material_sha = basis_manifest("material", MATERIAL_ORDER, 5)

    continuity_artifact = write_payload(fixture / "continuity.f32", row_count * len(CONTINUITY_ORDER) * 4, 6)
    continuity_artifact.update({"dtype": "float32-le", "shape": [row_count, len(CONTINUITY_ORDER)], "semanticRole": "all-parent-source-cohort-continuity"})
    edges_artifact = write_payload(fixture / "edges.u32", 2 * 3 * 4, 7)
    edges_artifact.update({"dtype": "uint32-le", "shape": [2, 3], "semanticRole": "same-cohort-native-face-neighbor-edges-row-row-axis"})
    continuity = {
        "schema": "kaminos.volume.grid96-cohort-continuity-socket.v0", "status": "complete",
        "identity": "sha256:" + "6" * 64,
        "source": {
            **source, "exactSourceReceiptSha256": exact_receipt["sha256"],
            "transverseManifestPath": str(transverse_path), "transverseManifestSha256": transverse_sha,
            "transverseManifestIdentity": transverse["identity"],
            "materialManifestPath": str(material_path), "materialManifestSha256": material_sha,
            "materialManifestIdentity": material["identity"],
        },
        "continuityOrder": list(CONTINUITY_ORDER),
        "artifacts": {
            "parentContinuity": continuity_artifact, "edges": edges_artifact,
            "nativeCellIndex": {**common_native, "dtype": "uint32-le", "shape": [row_count], "semanticRole": "caller-ordered-native-cell-index"},
        },
        "execution": {"rowCount": row_count, "edgeCount": 2, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False},
    }
    continuity_path = fixture / "continuity-manifest.json"
    continuity_sha = write_json(continuity_path, continuity)

    output = fixture / "output"
    fixture_loader = (
        "import importlib.util,sys;"
        f"s=importlib.util.spec_from_file_location('grid96_registry',{str(SCRIPT)!r});"
        "m=importlib.util.module_from_spec(s);s.loader.exec_module(m);"
        "m.EXACT_PARENT_COUNT=3;raise SystemExit(m.main())"
    )
    command = [
        sys.executable, "-c", fixture_loader,
        "--descriptor-manifest", str(descriptor_path), "--descriptor-manifest-sha256", descriptor_manifest_sha,
        "--coefficient-manifest", str(coefficient_path), "--coefficient-manifest-sha256", coefficient_manifest_sha,
        "--transverse-manifest", str(transverse_path), "--transverse-manifest-sha256", transverse_sha,
        "--material-manifest", str(material_path), "--material-manifest-sha256", material_sha,
        "--continuity-manifest", str(continuity_path), "--continuity-manifest-sha256", continuity_sha,
        "--output-dir", str(output),
    ]

    completed = subprocess.run(command, capture_output=True, text=True, check=False)
    assert completed.returncode == 0, completed.stderr
    registry_path = output / "grid96-peak-wisp-source-registry.json"
    report_path = output / "report.json"
    registry = json.loads(registry_path.read_text())
    report = json.loads(report_path.read_text())
    assert report["status"] == "complete" and report["failurePhase"] is None
    assert registry["schema"] == "kaminos.volume.grid96-peak-wisp-source-registry.v0"
    assert registry["status"] == "complete" and registry["rowCount"] == row_count
    assert registry["nativeCellIndexSha256"] == native_sha
    assert registry["sameStateCaptureId"] == "fixture-grid96-state120"
    assert set(registry["featureFamilies"]) == {"descriptors", "coefficients", "transverseBasis", "materialBasis", "cohortContinuity"}
    assert registry["featureFamilies"]["descriptors"]["order"] == list(DESCRIPTOR_ORDER)
    assert registry["featureFamilies"]["coefficients"]["order"] == list(COEFFICIENT_ORDER)
    assert registry["featureFamilies"]["transverseBasis"]["order"] == list(TRANSVERSE_ORDER)
    assert registry["featureFamilies"]["materialBasis"]["order"] == list(MATERIAL_ORDER)
    assert registry["featureFamilies"]["cohortContinuity"]["order"] == list(CONTINUITY_ORDER)
    assert registry["execution"] == {"rowCount": row_count, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "copiedPayloadBytes": 0}
    assert sorted(path.name for path in output.iterdir()) == ["grid96-peak-wisp-source-registry.json", "report.json"]
    assert all(Path(family["artifact"]["path"]).parent == fixture for family in registry["featureFamilies"].values())
    assert not recursively_has_key(registry, {"label", "labels", "target", "targets", "threshold", "thresholds", "normalization", "sampling"})

    # The normal CLI has no row-count override: a tiny coherent fixture cannot become source truth.
    production_output = fixture / "production-count-output"
    production_command = [sys.executable, str(SCRIPT), *command[3:]]
    production_command[production_command.index("--output-dir") + 1] = str(production_output)
    production = subprocess.run(production_command, capture_output=True, text=True, check=False)
    assert production.returncode != 0
    production_report = json.loads((production_output / "report.json").read_text())
    assert production_report["status"] == "failed" and "370194" in production_report["error"]

    def run_mutation(name: str, manifest_path: Path, manifest: dict[str, object], mutate) -> dict[str, object]:
        forged = deepcopy(manifest)
        mutate(forged)
        forged_path = fixture / f"{name}.json"
        forged_sha = write_json(forged_path, forged)
        forged_output = fixture / f"{name}-output"
        forged_output.mkdir()
        (forged_output / "grid96-peak-wisp-source-registry.json").write_text('{"status":"complete"}')
        (forged_output / "stale.bin").write_bytes(b"stale")
        forged_command = list(command)
        option = {
            descriptor_path: "--descriptor-manifest",
            coefficient_path: "--coefficient-manifest",
            transverse_path: "--transverse-manifest",
            material_path: "--material-manifest",
            continuity_path: "--continuity-manifest",
        }[manifest_path]
        forged_command[forged_command.index(option) + 1] = str(forged_path)
        forged_command[forged_command.index(option + "-sha256") + 1] = forged_sha
        forged_command[forged_command.index("--output-dir") + 1] = str(forged_output)
        failed = subprocess.run(forged_command, capture_output=True, text=True, check=False)
        assert failed.returncode != 0, name
        failed_report_path = forged_output / "report.json"
        assert failed_report_path.is_file(), f"{name}: {failed.stderr}"
        failed_report = json.loads(failed_report_path.read_text())
        assert failed_report["status"] == "failed" and failed_report["failurePhase"] == "source-validation", name
        assert not (forged_output / "grid96-peak-wisp-source-registry.json").exists(), name
        assert (forged_output / "stale.bin").read_bytes() == b"stale", name
        return failed_report

    run_mutation("payload-drift", descriptor_path, descriptor, lambda value: value["artifact"].__setitem__("sha256", "9" * 64))
    run_mutation("native-drift", coefficient_path, coefficient, lambda value: value.__setitem__("nativeCellIndexSha256", "8" * 64))
    run_mutation("order-drift", transverse_path, transverse, lambda value: value["basis"]["order"].reverse())
    run_mutation("state-drift", material_path, material, lambda value: value["source"].__setitem__("sameStateCaptureId", "other-state"))
    run_mutation("cap-installed", continuity_path, continuity, lambda value: value["execution"].__setitem__("sampleCap", 2))
    run_mutation("fallback-route", descriptor_path, descriptor, lambda value: value["route"].__setitem__("fallbackReason", "cpu-fallback"))
    run_mutation("wrong-effective-route", descriptor_path, descriptor, lambda value: value["route"].__setitem__("effective", "mock-grid96-route"))
    run_mutation("wrong-backend", descriptor_path, descriptor, lambda value: value["route"].__setitem__("backend", "python-cpu-v0"))
    run_mutation("source-row-count-drift", material_path, material, lambda value: value["source"].__setitem__("rowCount", 2))
    run_mutation("complete-with-failure", transverse_path, transverse, lambda value: value.__setitem__("failurePhase", "partial-write"))
    run_mutation("target-smuggled", continuity_path, continuity, lambda value: value.__setitem__("targetLabels", str(fixture / "labels.f32")))

print("volume grid96 peak/wisp source registry contracts passed")
