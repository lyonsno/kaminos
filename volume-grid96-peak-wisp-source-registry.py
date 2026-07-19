#!/usr/bin/env python3
"""Bind exact Grid96 parent features into a zero-copy peak/wisp source registry."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
import traceback
from pathlib import Path
from typing import Any


REGISTRY_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-registry.v0"
REPORT_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-registry-report.v0"
COMPONENT_SCHEMA = "kaminos.volume.grid96-native-component.v0"
TRANSVERSE_SCHEMA = "kaminos.volume.grid96-transverse-basis-socket.v0"
MATERIAL_SCHEMA = "kaminos.volume.grid96-nonridge-material-basis-socket.v0"
CONTINUITY_SCHEMA = "kaminos.volume.grid96-cohort-continuity-socket.v0"
SOURCE_HASH_FIELDS = ("fluidSha256", "frontSha256", "boundarySidecarSha256", "majorantSha256")
EXACT_PARENT_COUNT = 370194
PRIMARY_OUTPUT_NAMES = ("grid96-peak-wisp-source-registry.json", "report.json")

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


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value)


def is_sha_identity(value: Any) -> bool:
    return isinstance(value, str) and value.startswith("sha256:") and is_sha256(value[7:])


def artifact_path(manifest_path: Path, receipt: dict[str, Any]) -> Path:
    path = Path(receipt.get("path", ""))
    return path if path.is_absolute() else (manifest_path.parent / path).resolve()


def validate_artifact(
    manifest_path: Path,
    receipt: Any,
    *,
    shape: list[int],
    dtype: str,
    label: str,
) -> dict[str, Any]:
    require(isinstance(receipt, dict), f"{label} artifact receipt is missing")
    require(receipt.get("shape") == shape, f"{label} artifact shape drifted")
    require(receipt.get("dtype") == dtype, f"{label} artifact dtype drifted")
    require(isinstance(receipt.get("semanticRole"), str) and receipt["semanticRole"], f"{label} semantic role is missing")
    path = artifact_path(manifest_path, receipt)
    require(path.is_file(), f"{label} artifact is missing: {path}")
    require(path.stat().st_size == receipt.get("bytes"), f"{label} artifact byte length drifted")
    require(is_sha256(receipt.get("sha256")), f"{label} artifact SHA-256 is invalid")
    require(sha256_file(path) == receipt["sha256"], f"{label} artifact SHA-256 drifted")
    return {
        "path": str(path), "bytes": receipt["bytes"], "sha256": receipt["sha256"],
        "dtype": dtype, "shape": shape, "semanticRole": receipt["semanticRole"],
    }


def load_manifest(path: Path, expected_sha: str, schema: str, label: str) -> dict[str, Any]:
    require(path.is_file(), f"{label} manifest is missing: {path}")
    require(is_sha256(expected_sha), f"expected {label} manifest SHA-256 is invalid")
    require(sha256_file(path) == expected_sha, f"{label} manifest SHA-256 drifted")
    manifest = json.loads(path.read_text())
    require(manifest.get("schema") == schema, f"{label} schema drifted")
    require(manifest.get("status") == "complete", f"{label} socket is not complete")
    require(manifest.get("failurePhase") is None, f"{label} socket carries a failure phase")
    reject_attribution_smuggling(manifest)
    return manifest


def reject_attribution_smuggling(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            lower = key.lower()
            if lower != "targetimageused" and ("label" in lower or lower in {"target", "targets", "threshold", "thresholds", "normalization", "sampling"}):
                raise ValueError(f"source socket smuggled attribution policy via {key}")
            reject_attribution_smuggling(child)
    elif isinstance(value, list):
        for child in value:
            reject_attribution_smuggling(child)


def validate_route(route: Any, label: str) -> dict[str, Any]:
    require(isinstance(route, dict), f"{label} route receipt is missing")
    require(isinstance(route.get("requested"), str) and route["requested"], f"{label} requested route is missing")
    require(isinstance(route.get("effective"), str) and route["effective"], f"{label} effective route is missing")
    require(isinstance(route.get("backend"), str) and route["backend"], f"{label} backend is missing")
    require(route.get("effective") == "native-3d-compute-fluid-raymarch-v0", f"{label} effective route is not the native Grid96 route")
    require(route.get("backend") == "WebGPU:apple", f"{label} backend is not the exact WebGPU backend")
    require(route.get("fallbackReason") is None, f"{label} used a fallback route")
    return {key: route.get(key) for key in ("requested", "effective", "backend", "fallbackReason")}


def validate_execution(manifest: dict[str, Any], label: str, row_count: int) -> None:
    execution = manifest.get("execution")
    require(isinstance(execution, dict), f"{label} execution receipt is missing")
    require(execution.get("rowCount") == row_count, f"{label} row count drifted")
    require(execution.get("sampleCap") is None, f"{label} installed a sample cap")
    require(execution.get("droppedRowCount") == 0, f"{label} dropped source rows")
    require(execution.get("fallbackRowCount") == 0, f"{label} used fallback rows")
    require(execution.get("targetImageUsed") is False, f"{label} used a target image")


def source_signature(source: dict[str, Any], include_row_count: bool = True) -> dict[str, Any]:
    signature = {
        "grid": source.get("grid"),
        "sameStateCaptureId": source.get("sameStateCaptureId"),
        "simStepCount": source.get("simStepCount"),
        "nativeCellIndexSha256": source.get("nativeCellIndexSha256"),
        "componentSourceManifestSha256": source.get("componentSourceManifestSha256"),
        "descriptorSourceManifestSha256": source.get("descriptorSourceManifestSha256"),
        "descriptorArtifactSha256": source.get("descriptorArtifactSha256"),
        "coefficientArtifactSha256": source.get("coefficientArtifactSha256"),
        "sourceHashes": source.get("sourceHashes"),
    }
    if include_row_count:
        signature["rowCount"] = source.get("rowCount")
    return signature


def validate_derived_source(
    source: Any,
    expected: dict[str, Any],
    descriptor_sha: str,
    coefficient_sha: str,
    route: dict[str, Any] | None,
    label: str,
    include_row_count: bool = True,
) -> None:
    require(isinstance(source, dict), f"{label} source receipt is missing")
    expected_signature = dict(expected)
    if not include_row_count:
        expected_signature.pop("rowCount")
    require(source_signature(source, include_row_count=include_row_count) == expected_signature, f"{label} exact source identity drifted")
    require(source.get("descriptorManifestSha256") == descriptor_sha, f"{label} descriptor manifest binding drifted")
    require(source.get("coefficientManifestSha256") == coefficient_sha, f"{label} coefficient manifest binding drifted")
    if route is not None:
        require(validate_route(source.get("route"), f"{label} source") == route, f"{label} route identity drifted")


def manifest_ref(path: Path, sha256: str, manifest: dict[str, Any]) -> dict[str, Any]:
    return {"path": str(path.resolve()), "sha256": sha256, "schema": manifest["schema"], "identity": manifest["identity"]}


def prepare_output(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in PRIMARY_OUTPUT_NAMES:
        path = output_dir / name
        if path.is_file() or path.is_symlink():
            path.unlink()
        elif path.exists():
            raise ValueError(f"primary output path is not a file: {path}")


def build_registry(args: argparse.Namespace) -> tuple[dict[str, Any], dict[str, Any]]:
    descriptor_path = Path(args.descriptor_manifest).resolve()
    coefficient_path = Path(args.coefficient_manifest).resolve()
    transverse_path = Path(args.transverse_manifest).resolve()
    material_path = Path(args.material_manifest).resolve()
    continuity_path = Path(args.continuity_manifest).resolve()

    descriptor = load_manifest(descriptor_path, args.descriptor_manifest_sha256, COMPONENT_SCHEMA, "descriptor")
    coefficient = load_manifest(coefficient_path, args.coefficient_manifest_sha256, COMPONENT_SCHEMA, "coefficient")
    require(descriptor.get("identity") == "flow-kernel-local-descriptor-socket-v0" and descriptor.get("role") == "descriptors", "descriptor role identity drifted")
    require(coefficient.get("identity") == "exact-local-layer-emission-extinction-v0" and coefficient.get("role") == "coefficients", "coefficient role identity drifted")
    row_count = descriptor.get("rowCount")
    require(row_count == EXACT_PARENT_COUNT, f"descriptor row count must retain all {EXACT_PARENT_COUNT} exact parents")
    for label, manifest in (("descriptor", descriptor), ("coefficient", coefficient)):
        require(manifest.get("grid") == 96, f"{label} is not native Grid96")
        require(manifest.get("rowCount") == row_count, f"{label} row count drifted")
        require(isinstance(manifest.get("sameStateCaptureId"), str) and manifest["sameStateCaptureId"], f"{label} state identity is missing")
        require(isinstance(manifest.get("simStepCount"), int) and not isinstance(manifest["simStepCount"], bool) and manifest["simStepCount"] > 0, f"{label} sim step is invalid")
        require(is_sha256(manifest.get("nativeCellIndexSha256")), f"{label} native parent identity is invalid")
        require(is_sha256(manifest.get("sourceManifestSha256")), f"{label} component source identity is invalid")
        require(is_sha_identity(manifest.get("requestedControlIdentity")) and manifest.get("requestedControlIdentity") == manifest.get("effectiveControlIdentity"), f"{label} control identity drifted")
    for field in ("grid", "rowCount", "nativeCellIndexSha256", "sameStateCaptureId", "simStepCount", "sourceManifestSha256", "requestedControlIdentity", "effectiveControlIdentity"):
        require(descriptor.get(field) == coefficient.get(field), f"component {field} drifted")
    route = validate_route(descriptor.get("route"), "descriptor")
    require(validate_route(coefficient.get("route"), "coefficient") == route, "component route identity drifted")

    require(descriptor.get("strideFloats") == len(DESCRIPTOR_ORDER), "descriptor stride drifted")
    require(descriptor.get("descriptorOrder") == list(DESCRIPTOR_ORDER), "descriptor semantic order drifted")
    descriptor_receipt = descriptor.get("artifact")
    require(isinstance(descriptor_receipt, dict) and descriptor_receipt.get("descriptorOrder") == list(DESCRIPTOR_ORDER), "descriptor artifact semantic order drifted")
    descriptor_artifact = validate_artifact(descriptor_path, descriptor_receipt, shape=[row_count, len(DESCRIPTOR_ORDER)], dtype="float32-le", label="descriptor")
    require(descriptor_artifact["semanticRole"] == "camera-independent-flow-kernel-descriptors", "descriptor artifact semantic role drifted")
    source_hashes = descriptor_receipt.get("sourceHashes")
    require(isinstance(source_hashes, dict) and set(source_hashes) == set(SOURCE_HASH_FIELDS), "descriptor source payload keys drifted")
    require(all(is_sha256(source_hashes.get(field)) for field in SOURCE_HASH_FIELDS), "descriptor source payload identity is invalid")
    require(is_sha256(descriptor_receipt.get("sourceManifestSha256")), "descriptor lower source identity is invalid")

    require(coefficient.get("channels") == list(COEFFICIENT_ORDER), "coefficient semantic order drifted")
    require(coefficient.get("nonnegative") is True, "coefficient nonnegative contract drifted")
    require(coefficient.get("partitionIdentity") == "separate-nonnegative-ridge-and-nonridge-local-coefficients-v0", "coefficient partition identity drifted")
    require(coefficient.get("coefficientBoundary") == "per-sample-pre-tone-map-emission-extinction-v0", "coefficient boundary drifted")
    coefficient_receipt = coefficient.get("artifact")
    coefficient_artifact = validate_artifact(coefficient_path, coefficient_receipt, shape=[row_count, len(COEFFICIENT_ORDER)], dtype="float32-le", label="coefficient")
    require(coefficient_artifact["semanticRole"] == "exact-local-layer-emission-extinction", "coefficient artifact semantic role drifted")
    require(coefficient_receipt.get("nativeCellIndexSha256") == descriptor["nativeCellIndexSha256"], "coefficient artifact native parent identity drifted")

    expected_source = {
        "grid": 96, "rowCount": row_count, "sameStateCaptureId": descriptor["sameStateCaptureId"],
        "simStepCount": descriptor["simStepCount"], "nativeCellIndexSha256": descriptor["nativeCellIndexSha256"],
        "componentSourceManifestSha256": descriptor["sourceManifestSha256"],
        "descriptorSourceManifestSha256": descriptor_receipt["sourceManifestSha256"],
        "descriptorArtifactSha256": descriptor_artifact["sha256"],
        "coefficientArtifactSha256": coefficient_artifact["sha256"], "sourceHashes": source_hashes,
    }

    transverse = load_manifest(transverse_path, args.transverse_manifest_sha256, TRANSVERSE_SCHEMA, "transverse")
    material = load_manifest(material_path, args.material_manifest_sha256, MATERIAL_SCHEMA, "material")
    continuity = load_manifest(continuity_path, args.continuity_manifest_sha256, CONTINUITY_SCHEMA, "continuity")
    for label, manifest, order in (
        ("transverse", transverse, TRANSVERSE_ORDER), ("material", material, MATERIAL_ORDER),
    ):
        validate_derived_source(manifest.get("source"), expected_source, args.descriptor_manifest_sha256, args.coefficient_manifest_sha256, route, label)
        validate_execution(manifest, label, row_count)
        require(is_sha_identity(manifest.get("identity")), f"{label} manifest identity is invalid")
        basis = manifest.get("basis")
        require(isinstance(basis, dict) and basis.get("order") == list(order), f"{label} basis semantic order drifted")
    transverse_basis = transverse["basis"]
    require(transverse_basis.get("identity") == "declared-normal-flow-tangent-orthonormal-frame-v0", "transverse basis identity drifted")
    require(transverse_basis.get("fallbackPolicy") == "none-invalid-rows-remain-invalid-v0", "transverse fallback policy drifted")
    require(transverse_basis.get("reasonIdentity") == "grid96-transverse-basis-reason-codes-v0", "transverse reason identity drifted")
    material_basis = material["basis"]
    require(material_basis.get("identity") == "material-density-gradient-flow-tangent-plane-v0", "material basis identity drifted")
    require(material_basis.get("normalSource") == "gradient.material.x", "material normal source drifted")
    require(material_basis.get("cohort") == "structure-normal-undeclared-positive-nonridge-v0", "material cohort drifted")
    require(material_basis.get("fallbackPolicy") == "none-separate-cohort-only-v0", "material fallback policy drifted")
    require(material_basis.get("reasonIdentity") == "grid96-nonridge-material-basis-reasons-v0", "material reason identity drifted")
    require(is_sha256(material["source"].get("exactSourceReceiptSha256")), "material exact source receipt identity is invalid")
    exact_receipt_path = Path(material["source"].get("exactSourceReceiptPath", ""))
    if not exact_receipt_path.is_absolute():
        exact_receipt_path = (material_path.parent / exact_receipt_path).resolve()
    require(exact_receipt_path.is_file(), "material exact source receipt is missing")
    require(sha256_file(exact_receipt_path) == material["source"]["exactSourceReceiptSha256"], "material exact source receipt SHA-256 drifted")

    def basis_artifacts(manifest_path: Path, manifest: dict[str, Any], order: tuple[str, ...], label: str) -> tuple[dict[str, Any], dict[str, Any], dict[str, Any]]:
        artifacts = manifest.get("artifacts")
        require(isinstance(artifacts, dict), f"{label} artifacts are missing")
        basis = validate_artifact(manifest_path, artifacts.get("basis"), shape=[row_count, len(order)], dtype="float32-le", label=f"{label} basis")
        reason = validate_artifact(manifest_path, artifacts.get("reasonCodes"), shape=[row_count], dtype="uint8", label=f"{label} reasons")
        native = validate_artifact(manifest_path, artifacts.get("nativeCellIndex"), shape=[row_count], dtype="uint32-le", label=f"{label} native parents")
        require(native["sha256"] == descriptor["nativeCellIndexSha256"], f"{label} native parent payload drifted")
        return basis, reason, native

    transverse_artifact, transverse_reason, transverse_native = basis_artifacts(transverse_path, transverse, TRANSVERSE_ORDER, "transverse")
    material_artifact, material_reason, material_native = basis_artifacts(material_path, material, MATERIAL_ORDER, "material")
    require(transverse_native["sha256"] == material_native["sha256"], "basis native parent lists drifted")

    validate_derived_source(
        continuity.get("source"), expected_source, args.descriptor_manifest_sha256,
        args.coefficient_manifest_sha256, None, "continuity", include_row_count=False,
    )
    validate_execution(continuity, "continuity", row_count)
    require(is_sha_identity(continuity.get("identity")), "continuity manifest identity is invalid")
    require(continuity.get("continuityOrder") == list(CONTINUITY_ORDER), "continuity semantic order drifted")
    continuity_source = continuity["source"]
    require(
        Path(continuity_source.get("transverseManifestPath", "")).resolve() == transverse_path,
        f"continuity transverse path binding drifted: {continuity_source.get('transverseManifestPath')!r} != {str(transverse_path)!r}",
    )
    require(continuity_source.get("transverseManifestSha256") == args.transverse_manifest_sha256, "continuity transverse SHA binding drifted")
    require(continuity_source.get("transverseManifestIdentity") == transverse["identity"], "continuity transverse identity binding drifted")
    require(
        Path(continuity_source.get("materialManifestPath", "")).resolve() == material_path,
        f"continuity material path binding drifted: {continuity_source.get('materialManifestPath')!r} != {str(material_path)!r}",
    )
    require(continuity_source.get("materialManifestSha256") == args.material_manifest_sha256, "continuity material SHA binding drifted")
    require(continuity_source.get("materialManifestIdentity") == material["identity"], "continuity material identity binding drifted")
    require(continuity_source.get("exactSourceReceiptSha256") == material["source"]["exactSourceReceiptSha256"], "continuity exact source receipt binding drifted")
    continuity_artifacts = continuity.get("artifacts")
    require(isinstance(continuity_artifacts, dict), "continuity artifacts are missing")
    continuity_artifact = validate_artifact(continuity_path, continuity_artifacts.get("parentContinuity"), shape=[row_count, len(CONTINUITY_ORDER)], dtype="float32-le", label="continuity parents")
    edge_count = continuity.get("execution", {}).get("edgeCount")
    require(isinstance(edge_count, int) and not isinstance(edge_count, bool) and edge_count >= 0, "continuity edge count is invalid")
    continuity_edges = validate_artifact(continuity_path, continuity_artifacts.get("edges"), shape=[edge_count, 3], dtype="uint32-le", label="continuity edges")
    continuity_native = validate_artifact(continuity_path, continuity_artifacts.get("nativeCellIndex"), shape=[row_count], dtype="uint32-le", label="continuity native parents")
    require(continuity_native["sha256"] == transverse_native["sha256"], "continuity native parent list drifted")

    registry_identity_payload = {
        "grid": 96, "rowCount": row_count, "sameStateCaptureId": descriptor["sameStateCaptureId"],
        "simStepCount": descriptor["simStepCount"], "nativeCellIndexSha256": descriptor["nativeCellIndexSha256"],
        "manifestSha256": {
            "descriptors": args.descriptor_manifest_sha256,
            "coefficients": args.coefficient_manifest_sha256,
            "transverseBasis": args.transverse_manifest_sha256,
            "materialBasis": args.material_manifest_sha256,
            "cohortContinuity": args.continuity_manifest_sha256,
        },
    }
    registry_identity = "sha256:" + hashlib.sha256(
        json.dumps(registry_identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    registry: dict[str, Any] = {
        "schema": REGISTRY_SCHEMA,
        "status": "complete",
        "identity": registry_identity,
        "rowCount": row_count,
        "grid": 96,
        "sameStateCaptureId": descriptor["sameStateCaptureId"],
        "simStepCount": descriptor["simStepCount"],
        "nativeCellIndexSha256": descriptor["nativeCellIndexSha256"],
        "route": route,
        "sourceHashes": source_hashes,
        "componentSourceManifestSha256": descriptor["sourceManifestSha256"],
        "nativeCellIndex": transverse_native,
        "featureFamilies": {
            "descriptors": {"manifest": manifest_ref(descriptor_path, args.descriptor_manifest_sha256, descriptor), "order": list(DESCRIPTOR_ORDER), "artifact": descriptor_artifact},
            "coefficients": {"manifest": manifest_ref(coefficient_path, args.coefficient_manifest_sha256, coefficient), "order": list(COEFFICIENT_ORDER), "artifact": coefficient_artifact},
            "transverseBasis": {"manifest": manifest_ref(transverse_path, args.transverse_manifest_sha256, transverse), "order": list(TRANSVERSE_ORDER), "artifact": transverse_artifact, "reasonCodes": transverse_reason},
            "materialBasis": {"manifest": manifest_ref(material_path, args.material_manifest_sha256, material), "order": list(MATERIAL_ORDER), "artifact": material_artifact, "reasonCodes": material_reason},
            "cohortContinuity": {"manifest": manifest_ref(continuity_path, args.continuity_manifest_sha256, continuity), "order": list(CONTINUITY_ORDER), "artifact": continuity_artifact, "edges": continuity_edges},
        },
        "execution": {"rowCount": row_count, "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "copiedPayloadBytes": 0},
        "claimBoundary": {
            "sourceRegistryOnly": True, "attributionAttached": False, "featureSelectionPerformed": False,
            "learnerStarted": False, "placementChosen": False, "depositionAdjudicated": False,
            "rendererClaimMade": False, "productClaimMade": False,
        },
    }
    report = {
        "schema": REPORT_SCHEMA, "status": "complete", "failurePhase": None,
        "registry": {"path": "grid96-peak-wisp-source-registry.json"},
        "execution": registry["execution"], "source": {
            "grid": 96, "rowCount": row_count, "sameStateCaptureId": descriptor["sameStateCaptureId"],
            "nativeCellIndexSha256": descriptor["nativeCellIndexSha256"], "route": route,
        },
    }
    return registry, report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("descriptor", "coefficient", "transverse", "material", "continuity"):
        parser.add_argument(f"--{name}-manifest", required=True)
        parser.add_argument(f"--{name}-manifest-sha256", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    prepare_output(output_dir)
    started = time.time()
    try:
        registry, report = build_registry(args)
        registry_path = output_dir / "grid96-peak-wisp-source-registry.json"
        registry_path.write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
        report["registry"].update({"path": str(registry_path), "bytes": registry_path.stat().st_size, "sha256": sha256_file(registry_path)})
        report["elapsedSeconds"] = time.time() - started
        (output_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"status": "complete", "registry": str(registry_path), "sha256": report["registry"]["sha256"]}, sort_keys=True))
        return 0
    except Exception as error:  # The durable report is part of the evidence contract.
        registry_path = output_dir / PRIMARY_OUTPUT_NAMES[0]
        if registry_path.is_file() or registry_path.is_symlink():
            registry_path.unlink()
        failure = {
            "schema": REPORT_SCHEMA, "status": "failed", "failurePhase": "source-validation",
            "error": str(error), "errorType": type(error).__name__,
            "elapsedSeconds": time.time() - started, "traceback": traceback.format_exc(),
            "inputs": {
                name: {"path": getattr(args, f"{name}_manifest"), "expectedSha256": getattr(args, f"{name}_manifest_sha256")}
                for name in ("descriptor", "coefficient", "transverse", "material", "continuity")
            },
        }
        (output_dir / "report.json").write_text(json.dumps(failure, indent=2, sort_keys=True) + "\n")
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
