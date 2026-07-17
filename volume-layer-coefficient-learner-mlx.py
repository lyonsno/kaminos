#!/usr/bin/env python3
"""Validate and train the lawful post-admission layer-coefficient comparison."""

from __future__ import annotations

import argparse
import gc
import hashlib
import json
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


MANIFEST_SCHEMA = "kaminos.volume.layer-coefficient-training-manifest.v0"
RESULT_SCHEMA = "kaminos.volume.layer-coefficient-contract-report.v0"
FAILURE_SCHEMA = "kaminos.volume.layer-coefficient-contract-failure.v0"
TRAINING_RESULT_SCHEMA = "kaminos.volume.layer-coefficient-training-result.v0"
TRAINING_AUTHORITY = "analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0"
ADMISSION_AUTHORITY = "analytical-not-learned-membership-v0"
COEFFICIENT_BOUNDARY = "per-sample-pre-tone-map-emission-extinction-v0"
OUTPUT_TRANSFORM = "softplus-nonnegative-output-v0"
FOOTPRINT_IDENTITY = "support-gradient-oriented-tangent-plane-diagonal-covariance-v0"
FOOTPRINT_AUTHORITY = "analytical-view-independent-post-admission-footprint-v0"
TRANSPORT_IDENTITY = "one-shared-total-transmittance-v0"
ORDER_POLICY = "global-order-one-stream-v0"
CONTRIBUTION_POLICY = "separate-premultiplied-layer-contributions-under-shared-transmittance-v0"
SPLIT_IDENTITY = "whole-simulator-state-holdout-v0"
DESCRIPTOR_COMPARISON_IDENTITY = "matched-capacity-post-admission-kernel-descriptor-ablation-v0"
DESCRIPTOR_AUTHORITY = "camera-independent-flow-kernel-descriptors-v0"
DESCRIPTOR_SOCKET_IDENTITY = "flow-kernel-local-descriptor-socket-v0"
DESCRIPTOR_STRIDE_FLOATS = 100
DESCRIPTOR_ADMISSION_AUTHORITY = "external-native-cell-index-list-v0"
DESCRIPTOR_KERNEL_IDENTITY = "flow-tangent-positive-symmetric-trilinear-v0"
DESCRIPTOR_ROLE = "camera-independent-flow-kernel-descriptors"
DESCRIPTOR_INDEX_ROLE = "analytical-admission-native-cell-indices"
BASELINE_ARM_IDENTITY = "current-features-plus-analytical-world-covariance-v0"
TREATMENT_ARM_IDENTITY = "current-features-plus-smallest-causal-kernel-descriptor-subset-v0"
ANALYTICAL_GEOMETRY_IDENTITY = "kernel-moment-analytical-geometry-v0"
SOURCE_CORPUS_SCHEMA = "kaminos-boundary-splat-appearance-coefficient-corpus-v1"
SOURCE_CORPUS_AUTHORITY = "live-simulator-frozen-state-multi-camera-positive-full-flame-coefficients-with-signed-comparator-v1"
ADMISSION_ORDER = ["admission.ridge", "admission.nonRidge"]
COEFFICIENT_ORDER = [
    "ridge.emission.r",
    "ridge.emission.g",
    "ridge.emission.b",
    "ridge.extinction",
    "nonRidge.emission.r",
    "nonRidge.emission.g",
    "nonRidge.emission.b",
    "nonRidge.extinction",
]
DESCRIPTOR_SOURCE_HASH_KEYS = {
    "fluidSha256",
    "frontSha256",
    "boundarySidecarSha256",
    "majorantSha256",
}
BASELINE_ARCHITECTURE_IDENTITY = "baseline-24x248x8-8192-v0"
TREATMENT_ARCHITECTURE_IDENTITY = "treatment-gated24-plus-31x204x8-8192-v0"
TRAINABLE_PARAMETER_COUNT = 8192
DEFAULT_DESCRIPTOR_CHANNELS = [
    "flow.coherence",
    "flow.curlMagnitude",
    "flow.divergence",
    "flow.curlActivity",
    "validity.conservativeMajorant",
    "majorant.fire",
    "majorant.extinction",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary_path = Path(handle.name)
    os.replace(temporary_path, path)


def resolve_artifact_path(manifest_path: Path, value: Any) -> Path:
    require(isinstance(value, str) and value, "artifact path must be nonblank")
    path = Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (manifest_path.parent / path).resolve()


def validate_artifact(
    manifest_path: Path,
    artifact: Any,
    label: str,
    last_trustworthy: dict[str, Any],
) -> tuple[Path, bytes]:
    require(isinstance(artifact, dict), f"{label} artifact is missing")
    path = resolve_artifact_path(manifest_path, artifact.get("path"))
    require(path.is_file(), f"{label} artifact is missing at {path}")
    data = path.read_bytes()
    require(data, f"{label} artifact is blank")
    require(artifact.get("bytes") == len(data), f"{label} artifact byte count does not match")
    digest = sha256_bytes(data)
    require(artifact.get("sha256") == digest, f"{label} artifact sha256 does not match")
    last_trustworthy["validatedArtifactCount"] = last_trustworthy.get("validatedArtifactCount", 0) + 1
    return path, data


def require_exact_order(value: Any, expected: list[str], label: str) -> None:
    require(isinstance(value, list), f"{label} order is missing")
    require(value == expected, f"{label} order must equal {expected}")


def require_nonblank_unique_order(value: Any, label: str) -> list[str]:
    require(isinstance(value, list) and value, f"{label} order must be nonblank")
    require(all(isinstance(name, str) and name for name in value), f"{label} order contains a blank channel")
    require(len(set(value)) == len(value), f"{label} order contains duplicate channels")
    return value


def require_sha256(value: Any, label: str) -> str:
    require(
        isinstance(value, str) and re.fullmatch(r"[a-f0-9]{64}", value) is not None,
        f"{label} must be a lowercase sha256 digest",
    )
    return value


def validate_source_hashes(value: Any, label: str) -> dict[str, str]:
    require(isinstance(value, dict), f"{label} source hashes are missing")
    require(set(value) == DESCRIPTOR_SOURCE_HASH_KEYS, f"{label} source hashes must bind {sorted(DESCRIPTOR_SOURCE_HASH_KEYS)}")
    return {key: require_sha256(value[key], f"{label} {key}") for key in sorted(DESCRIPTOR_SOURCE_HASH_KEYS)}


def validate_kernel_controls(value: Any, label: str) -> dict[str, float]:
    require(isinstance(value, dict), f"{label} kernel controls are missing")
    require(set(value) == {"strength", "radiusWorld", "coherence"}, f"{label} kernel controls must contain strength, radiusWorld, and coherence")
    require(all(isinstance(item, (int, float)) and math.isfinite(item) for item in value.values()), f"{label} kernel controls must be finite")
    require(value["strength"] >= 0, f"{label} kernel strength must be nonnegative")
    require(value["radiusWorld"] > 0, f"{label} kernel radiusWorld must be positive")
    require(0 <= value["coherence"] <= 1, f"{label} kernel coherence must lie within [0, 1]")
    return {key: float(value[key]) for key in ("strength", "radiusWorld", "coherence")}


def validate_descriptor_socket_module(
    manifest_path: Path,
    artifact: Any,
    last_trustworthy: dict[str, Any],
) -> dict[str, Any]:
    path, data = validate_artifact(manifest_path, artifact, "kernel descriptor socket module", last_trustworthy)
    canonical_path = Path(__file__).with_name("flow-kernel-descriptor-socket.mjs").resolve()
    require(canonical_path.is_file(), f"canonical kernel descriptor socket module is missing at {canonical_path}")
    canonical_data = canonical_path.read_bytes()
    require(
        sha256_bytes(data) == sha256_bytes(canonical_data),
        "canonical kernel descriptor socket bytes differ from the supplied module",
    )
    validator_source = """
import { pathToFileURL } from 'node:url';
const module = await import(pathToFileURL(process.argv[1]).href);
process.stdout.write(JSON.stringify({
  identity: module.FLOW_KERNEL_DESCRIPTOR_SOCKET_IDENTITY,
  strideFloats: module.FLOW_KERNEL_DESCRIPTOR_STRIDE_FLOATS,
  descriptorOrder: module.FLOW_KERNEL_DESCRIPTOR_ORDER,
}));
"""
    result = subprocess.run(
        ["node", "--input-type=module", "--eval", validator_source, str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    require(result.returncode == 0, f"kernel descriptor socket module validation failed: {result.stderr.strip() or result.stdout.strip()}")
    receipt = json.loads(result.stdout)
    require(receipt.get("identity") == DESCRIPTOR_SOCKET_IDENTITY, f"kernel descriptor socket identity must equal {DESCRIPTOR_SOCKET_IDENTITY}")
    require(receipt.get("strideFloats") == DESCRIPTOR_STRIDE_FLOATS, f"kernel descriptor stride must equal {DESCRIPTOR_STRIDE_FLOATS}")
    descriptor_order = require_nonblank_unique_order(receipt.get("descriptorOrder"), "kernel descriptor socket")
    require(len(descriptor_order) == DESCRIPTOR_STRIDE_FLOATS, "kernel descriptor socket order does not match its stride")
    return {
        "identity": receipt["identity"],
        "strideFloats": receipt["strideFloats"],
        "descriptorOrder": descriptor_order,
        "moduleSha256": sha256_bytes(data),
    }


def validate_float_artifact(
    manifest_path: Path,
    artifact: Any,
    label: str,
    expected_shape: list[int],
    expected_role: str,
    last_trustworthy: dict[str, Any],
) -> list[float]:
    _, data = validate_artifact(manifest_path, artifact, label, last_trustworthy)
    require(artifact.get("dtype") == "float32-le", f"{label} dtype must be float32-le")
    require(artifact.get("shape") == expected_shape, f"{label} shape must equal {expected_shape}")
    require(artifact.get("semanticRole") == expected_role, f"{label} semantic role must equal {expected_role}")
    require(len(data) == math.prod(expected_shape) * 4, f"{label} bytes do not match shape")
    values = list(struct.unpack(f"<{math.prod(expected_shape)}f", data))
    require(all(math.isfinite(value) for value in values), f"{label} contains non-finite values")
    return values


def validate_uint32_artifact(
    manifest_path: Path,
    artifact: Any,
    label: str,
    expected_shape: list[int],
    expected_role: str,
    last_trustworthy: dict[str, Any],
) -> list[int]:
    _, data = validate_artifact(manifest_path, artifact, label, last_trustworthy)
    require(artifact.get("dtype") == "uint32-le", f"{label} dtype must be uint32-le")
    require(artifact.get("shape") == expected_shape, f"{label} shape must equal {expected_shape}")
    require(artifact.get("semanticRole") == expected_role, f"{label} semantic role must equal {expected_role}")
    require(len(data) == math.prod(expected_shape) * 4, f"{label} bytes do not match shape")
    return list(struct.unpack(f"<{math.prod(expected_shape)}I", data))


def validate_full_field_artifact(
    manifest_path: Path,
    artifact: Any,
    label: str,
    expected_shape: list[int],
    expected_channels: list[str],
    last_trustworthy: dict[str, Any],
) -> bytes:
    require(isinstance(artifact, dict), f"{label} artifact is missing")
    path = resolve_artifact_path(manifest_path, artifact.get("path"))
    require(path.is_file(), f"{label} artifact is missing at {path}")
    data = path.read_bytes()
    require(data, f"{label} artifact is blank")
    require(artifact.get("dtype") == "float32", f"{label} dtype must be float32")
    require(artifact.get("byteOrder") == "little-endian", f"{label} byte order must be little-endian")
    require(artifact.get("shape") == expected_shape, f"{label} shape must equal {expected_shape}")
    require(artifact.get("channelOrder") == expected_channels, f"{label} channel order must equal {expected_channels}")
    expected_float_count = math.prod(expected_shape)
    require(artifact.get("floatCount") == expected_float_count, f"{label} float count does not match shape")
    require(artifact.get("byteLength") == expected_float_count * 4, f"{label} declared byte length does not match shape")
    require(len(data) == artifact["byteLength"], f"{label} artifact byte length does not match")
    require(artifact.get("sha256") == sha256_bytes(data), f"{label} artifact sha256 does not match")
    last_trustworthy["validatedArtifactCount"] = last_trustworthy.get("validatedArtifactCount", 0) + 1
    return data


def validate_source_field_manifest(
    training_manifest_path: Path,
    artifact: Any,
    label: str,
    route: dict[str, Any],
    source_corpus: dict[str, Any],
    last_trustworthy: dict[str, Any],
) -> dict[str, Any]:
    source_manifest_path, data = validate_artifact(
        training_manifest_path,
        artifact,
        f"{label} source field manifest",
        last_trustworthy,
    )
    try:
        value = json.loads(data)
    except json.JSONDecodeError as error:
        raise ValueError(f"{label} source field manifest is invalid JSON: {error}") from error
    require(isinstance(value, dict), f"{label} source field manifest must be an object")
    require(value.get("schema") == "kaminos.volume.full-grid-field-export.v0", f"{label} source field manifest schema is invalid")
    require(value.get("identity") == "full-grid-fluid-front-boundary-sidecars-v0", f"{label} source field manifest identity is invalid")
    require(value.get("status") == "captured", f"{label} source field manifest is not captured")
    require(value.get("failurePhase") is None, f"{label} source field manifest contains failure evidence")
    require(value.get("completeFieldCoverage") is True, f"{label} source field manifest has partial field coverage")
    require(value.get("routeIdentity") == "native-3d-compute-fluid-raymarch-v0", f"{label} source field route identity is invalid")
    require(value.get("effectiveRoute") == route["effective"], f"{label} source field effective route differs from the training route")
    require(value.get("prototypeIdentity") == route["prototypeIdentity"], f"{label} source field prototype differs from the training route")
    require(value.get("backend") == route["backend"], f"{label} source field backend differs from the training route")
    require(value.get("backend") == source_corpus["backend"], f"{label} source field backend differs from the coefficient source corpus")
    require(value.get("grid") == source_corpus["grid"], f"{label} source field grid differs from the coefficient source corpus")
    grid = value["grid"]
    require(value.get("cellCount") == grid ** 3, f"{label} source field cell count differs from its grid")
    majorant_grid = value.get("majorantGrid")
    require(isinstance(majorant_grid, int) and majorant_grid > 0, f"{label} source field majorant grid is invalid")
    fluid_channels = [
        "velocityX", "velocityY", "velocityZ", "densityCarrier", "smokeDensity", "heat", "fuel", "detail",
        "flame", "ember", "visibleFireCarrier", "combustionFront", "microdetail", "interfaceShred", "fireLick", "emberFleck",
    ]
    require(value.get("fluidComponents") == len(fluid_channels), f"{label} source field fluid component count is invalid")
    require(value.get("fluidChannelOrder") == fluid_channels, f"{label} source field fluid channel order is invalid")
    require(value.get("frontChannelOrder") == ["frontTopology"], f"{label} source field front channel order is invalid")
    sidecars = value.get("sidecars")
    boundary_sidecar = value.get("boundarySidecar")
    require(isinstance(sidecars, dict), f"{label} source field sidecars are missing")
    require(isinstance(boundary_sidecar, dict) and isinstance(boundary_sidecar.get("sidecars"), dict), f"{label} boundary sidecar source is missing")
    fluid_data = validate_full_field_artifact(source_manifest_path, sidecars.get("fluid"), f"{label} source fluid", [grid, grid, grid, 16], fluid_channels, last_trustworthy)
    front_data = validate_full_field_artifact(source_manifest_path, sidecars.get("front"), f"{label} source front", [grid, grid, grid, 1], ["frontTopology"], last_trustworthy)
    boundary_data = validate_full_field_artifact(
        source_manifest_path,
        boundary_sidecar["sidecars"].get("boundary"),
        f"{label} source boundary sidecar",
        [grid, grid, grid, 4],
        ["support", "coverage", "ridge", "footprint"],
        last_trustworthy,
    )
    majorant_data = validate_full_field_artifact(
        source_manifest_path,
        sidecars.get("majorant"),
        f"{label} source majorant",
        [majorant_grid, majorant_grid, majorant_grid, 4],
        ["density", "fire", "extinction", "importance"],
        last_trustworthy,
    )
    return {
        "sha256": sha256_bytes(data),
        "sourceHashes": {
            "fluidSha256": sha256_bytes(fluid_data),
            "frontSha256": sha256_bytes(front_data),
            "boundarySidecarSha256": sha256_bytes(boundary_data),
            "majorantSha256": sha256_bytes(majorant_data),
        },
    }


def validate_source_corpus(
    manifest_path: Path,
    source: Any,
    last_trustworthy: dict[str, Any],
) -> dict[str, Any]:
    require(isinstance(source, dict), "source appearance corpus receipt is missing")
    require(source.get("schema") == SOURCE_CORPUS_SCHEMA, f"source appearance corpus schema must equal {SOURCE_CORPUS_SCHEMA}")
    require(source.get("authority") == SOURCE_CORPUS_AUTHORITY, f"source appearance corpus authority must equal {SOURCE_CORPUS_AUTHORITY}")
    path, data = validate_artifact(manifest_path, source, "source appearance corpus", last_trustworthy)
    expected_grid = source.get("expectedGrid")
    expected_ray_steps = source.get("expectedRaySteps")
    expected_render_scale = source.get("expectedRenderScale")
    require(isinstance(expected_grid, int) and expected_grid > 0, "source appearance corpus expected grid must be positive")
    require(isinstance(expected_ray_steps, int) and expected_ray_steps > 0, "source appearance corpus expected ray steps must be positive")
    require(isinstance(expected_render_scale, (int, float)) and 0 < expected_render_scale <= 1, "source appearance corpus expected render scale must lie within (0, 1]")
    validator_path = Path(__file__).with_name("boundary-splat-appearance-corpus.mjs").resolve()
    require(validator_path.is_file(), f"source appearance corpus validator is missing at {validator_path}")
    validator_source = """
import { pathToFileURL } from 'node:url';
const [modulePath, corpusPath, expectedGrid, expectedRaySteps, expectedRenderScale] = process.argv.slice(1);
try {
  const module = await import(pathToFileURL(modulePath).href);
  const value = await module.validateBoundarySplatAppearanceCorpus(corpusPath, {
    expectedGrid: Number(expectedGrid),
    expectedRaySteps: Number(expectedRaySteps),
    expectedRenderScale: Number(expectedRenderScale),
    requireWebGpuBackend: true,
  });
  process.stdout.write(JSON.stringify({
    corpusIdentity: value.corpusIdentity,
    cohortIdentity: value.cohortIdentity,
    sameStateCaptureId: value.sameStateCaptureId,
    grid: value.grid,
    backend: value.backend,
    candidateSha256: value.candidateSha256,
    candidateCount: value.candidateCount,
    cameraCount: value.cameraCount,
    trainCameraCount: value.trainCameraCount,
    heldoutCameraCount: value.heldoutCameraCount,
    positiveTargetAuthority: value.positiveTargetAuthority,
  }));
} catch (error) {
  process.stderr.write(String(error?.stack || error));
  process.exitCode = 2;
}
"""
    result = subprocess.run(
        [
            "node",
            "--input-type=module",
            "--eval",
            validator_source,
            str(validator_path),
            str(path),
            str(expected_grid),
            str(expected_ray_steps),
            str(expected_render_scale),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    require(result.returncode == 0, f"source appearance corpus validation failed: {result.stderr.strip() or result.stdout.strip()}")
    validated = json.loads(result.stdout)
    digest = sha256_bytes(data)
    require(validated.get("corpusIdentity") == f"sha256:{digest}", "source appearance corpus validator identity does not match receipt bytes")
    last_trustworthy["sourceAppearanceCorpusValidated"] = True
    last_trustworthy["sourceAppearanceCameraCount"] = validated["cameraCount"]
    return {
        "path": str(path),
        "sha256": digest,
        "schema": SOURCE_CORPUS_SCHEMA,
        "authority": SOURCE_CORPUS_AUTHORITY,
        "expectedGrid": expected_grid,
        "expectedRaySteps": expected_ray_steps,
        "expectedRenderScale": expected_render_scale,
        **validated,
    }


def validate_descriptor_comparison(
    value: Any,
    manifest_path: Path,
    feature_view: dict[str, Any],
    source_corpus: dict[str, Any],
    last_trustworthy: dict[str, Any],
) -> dict[str, Any]:
    require(isinstance(value, dict), "matched-capacity kernel descriptor comparison is missing")
    require(value.get("identity") == DESCRIPTOR_COMPARISON_IDENTITY, f"descriptor comparison identity must equal {DESCRIPTOR_COMPARISON_IDENTITY}")
    require(value.get("selectionPolicy") == "forward-causal-ablation-smallest-held-gain-subset-v0", "descriptor selection must retain the smallest held-gain causal subset")
    capacity = value.get("capacityMatch")
    require(isinstance(capacity, dict) and capacity.get("identity") == "equal-trainable-parameter-count-v0", "descriptor comparison must declare matched trainable capacity")
    baseline_parameters = capacity.get("baselineTrainableParameters")
    treatment_parameters = capacity.get("treatmentTrainableParameters")
    require(isinstance(baseline_parameters, int) and baseline_parameters > 0, "baseline trainable parameter count must be positive")
    require(treatment_parameters == baseline_parameters, "matched-capacity descriptor arms must have equal trainable parameter counts")

    producer = value.get("producer")
    require(isinstance(producer, dict), "kernel descriptor producer receipt is missing")
    socket = validate_descriptor_socket_module(manifest_path, producer.get("socketModule"), last_trustworthy)
    require(producer.get("identity") == socket["identity"], "kernel descriptor producer identity differs from the checksum-bound socket module")
    require(producer.get("strideFloats") == socket["strideFloats"], "kernel descriptor producer stride differs from the checksum-bound socket module")
    require_exact_order(producer.get("descriptorOrder"), socket["descriptorOrder"], "kernel descriptor producer")
    require(producer.get("kernelIdentity") == DESCRIPTOR_KERNEL_IDENTITY, f"kernel descriptor identity must equal {DESCRIPTOR_KERNEL_IDENTITY}")
    require(
        producer.get("candidateAdmissionAuthority") == DESCRIPTOR_ADMISSION_AUTHORITY,
        f"kernel descriptor candidate admission authority must equal external native-cell index authority {DESCRIPTOR_ADMISSION_AUTHORITY}",
    )
    require(isinstance(producer.get("requestedRoute"), str) and producer["requestedRoute"], "kernel descriptor requested route is missing")
    require(isinstance(producer.get("effectiveRoute"), str) and producer["effectiveRoute"], "kernel descriptor effective route is missing")
    require(producer.get("prototypeIdentity") == "kaminos-volume-prototype-v0", "kernel descriptor prototype identity is invalid")
    require(isinstance(producer.get("backend"), str) and producer["backend"].startswith("WebGPU:"), "kernel descriptor backend must preserve WebGPU identity")
    require(producer["backend"] == source_corpus["backend"], "kernel descriptor backend differs from the coefficient source corpus")
    require(producer.get("grid") == source_corpus["grid"], "kernel descriptor grid differs from the coefficient source corpus")
    require(producer.get("fallbackReason") is None, f"kernel descriptor route contains fallback evidence: {producer.get('fallbackReason')}")
    requested_controls = validate_kernel_controls(producer.get("requestedControls"), "requested")
    effective_controls = validate_kernel_controls(producer.get("effectiveControls"), "effective")
    require(effective_controls == requested_controls, "requested and effective kernel controls differ")
    require(producer.get("cameraIndependent") is True, "kernel descriptor producer must be camera-independent")
    require(producer.get("literalTapsExposed") is False, "literal kernel taps must not enter the descriptor learner")
    require(producer.get("strengthZeroIdentity") == "raw-source-field-identity-v0", "kernel descriptor socket must preserve exact strength-zero identity")
    require(producer.get("validityPolicy") == "conservative-support-validity-majorant-v0", "kernel descriptor validity policy must reject partial, stale, or fallback descriptors")

    baseline = value.get("baseline")
    require(isinstance(baseline, dict) and baseline.get("identity") == BASELINE_ARM_IDENTITY, f"descriptor baseline identity must equal {BASELINE_ARM_IDENTITY}")
    require(baseline.get("featureViewIdentity") == feature_view["identity"], "descriptor baseline feature identity differs from the current post-admission feature view")
    require(baseline.get("footprintIdentity") == FOOTPRINT_IDENTITY, "descriptor baseline must preserve analytical world covariance")

    treatment = value.get("treatment")
    require(isinstance(treatment, dict) and treatment.get("identity") == TREATMENT_ARM_IDENTITY, f"descriptor treatment identity must equal {TREATMENT_ARM_IDENTITY}")
    require(treatment.get("descriptorAuthority") == DESCRIPTOR_AUTHORITY, f"descriptor treatment authority must equal {DESCRIPTOR_AUTHORITY}")
    descriptor_order = require_nonblank_unique_order(treatment.get("order"), "kernel descriptor treatment")
    require(all("tap" not in channel.lower() for channel in descriptor_order), "literal kernel tap channels are prohibited")
    require(all(channel in socket["descriptorOrder"] for channel in descriptor_order), "kernel descriptor order contains a channel outside the checksum-bound camera-independent socket")
    lawful_prefixes = (
        "kernel.firstMoment.",
        "kernel.covariance.",
        "flow.",
        "validity.",
        "majorant.",
        "value.",
        "gradient.",
    )
    prohibited_channels = [
        channel
        for channel in descriptor_order
        if channel != "kernel.normalizedMass" and not channel.startswith(lawful_prefixes)
    ]
    require(not prohibited_channels, f"kernel descriptor treatment contains prohibited channels: {prohibited_channels}")
    require(treatment.get("supportPredicted") is False, "support must not be predicted by the post-admission descriptor arm")
    require(treatment.get("footprintPredicted") is False, "footprint must not be predicted by the coefficient learner")
    require(treatment.get("cameraConditioned") is False, "camera conditioning is prohibited in the kernel descriptor arm")
    require(treatment.get("beautyConditioned") is False, "beauty conditioning is prohibited in the kernel descriptor arm")

    geometry = value.get("analyticalGeometryArm")
    require(isinstance(geometry, dict) and geometry.get("identity") == ANALYTICAL_GEOMETRY_IDENTITY, f"analytical geometry identity must equal {ANALYTICAL_GEOMETRY_IDENTITY}")
    require(geometry.get("status") == "gated-on-held-descriptor-signal", "kernel-moment geometry must remain gated on held descriptor signal")
    require(geometry.get("learnedGeometry") is False, "analytical kernel-moment geometry must not become learned geometry")
    require(geometry.get("promotionGate") == "arm-two-held-post-admission-gain-v0", "kernel-moment geometry promotion gate is invalid")
    return {
        "identity": DESCRIPTOR_COMPARISON_IDENTITY,
        "selectionPolicy": value["selectionPolicy"],
        "capacityMatch": capacity,
        "producer": {
            **producer,
            "socketModule": {**producer["socketModule"], "validatedSha256": socket["moduleSha256"]},
            "requestedControls": requested_controls,
            "effectiveControls": effective_controls,
        },
        "baseline": baseline,
        "treatment": {**treatment, "order": descriptor_order, "channelCount": len(descriptor_order)},
        "analyticalGeometryArm": geometry,
    }


def validate_descriptor_artifact_receipt(
    artifact: Any,
    producer: dict[str, Any],
    admission: dict[str, Any],
    admission_artifact: dict[str, Any],
    index_artifact: dict[str, Any],
    source_manifest: dict[str, Any],
    row_count: int,
    label: str,
) -> None:
    require(isinstance(artifact, dict), f"{label} artifact receipt is missing")
    require(artifact.get("socketIdentity") == producer["identity"], f"{label} descriptor socket identity differs from its artifact receipt")
    require(artifact.get("strideFloats") == producer["strideFloats"], f"{label} descriptor stride differs from its artifact receipt")
    require_exact_order(artifact.get("descriptorOrder"), producer["descriptorOrder"], f"{label} descriptor artifact")
    require(artifact.get("kernelIdentity") == producer["kernelIdentity"], f"{label} descriptor kernel identity differs from its artifact receipt")
    requested_controls = validate_kernel_controls(artifact.get("requestedControls"), f"{label} requested")
    effective_controls = validate_kernel_controls(artifact.get("effectiveControls"), f"{label} effective")
    require(requested_controls == producer["requestedControls"], f"{label} requested kernel controls differ from the producer")
    require(effective_controls == producer["effectiveControls"], f"{label} effective kernel controls differ from the producer")
    source_hashes = validate_source_hashes(artifact.get("sourceHashes"), label)
    for key, expected in source_manifest["sourceHashes"].items():
        require(source_hashes[key] == expected, f"{label} descriptor source hash {key} differs from the source field manifest")
    require(artifact.get("sourceManifestSha256") == source_manifest["sha256"], f"{label} descriptor source manifest sha256 differs from the source field manifest")
    require(artifact.get("candidateAdmissionAuthority") == DESCRIPTOR_ADMISSION_AUTHORITY, f"{label} descriptor admission authority must equal external native-cell index authority {DESCRIPTOR_ADMISSION_AUTHORITY}")
    index_authority = artifact.get("admissionIndexAuthority")
    require(isinstance(index_authority, dict), f"{label} descriptor admission index authority is missing")
    require(index_authority.get("identity") == DESCRIPTOR_ADMISSION_AUTHORITY, f"{label} descriptor admission index identity differs from external native-cell index authority")
    require(index_authority.get("indexSha256") == index_artifact.get("sha256"), f"{label} descriptor admission index sha256 differs from the native-cell index artifact")
    require(index_authority.get("count") == row_count, f"{label} descriptor admission index count differs from the row count")
    require(index_authority.get("byteLength") == index_artifact.get("bytes"), f"{label} descriptor admission index byte length differs from the native-cell index artifact")
    require(index_authority.get("duplicatePolicy") == "forbidden", f"{label} descriptor admission index duplicate policy must be forbidden")
    require(index_authority.get("orderIdentity") == "caller-ordered", f"{label} descriptor admission index order must be caller-ordered")
    require(artifact.get("admissionIdentity") == admission["identity"], f"{label} descriptor admission identity differs from the manifest")
    require(artifact.get("admissionArtifactSha256") == admission_artifact.get("sha256"), f"{label} descriptor admission artifact sha256 differs from the admitted row index")


def validate_manifest(
    manifest: Any,
    manifest_path: Path,
    last_trustworthy: dict[str, Any],
) -> dict[str, Any]:
    require(isinstance(manifest, dict), "training manifest must be an object")
    require(manifest.get("schema") == MANIFEST_SCHEMA, f"training manifest schema must equal {MANIFEST_SCHEMA}")
    require(manifest.get("status") == "complete", "training manifest status must be complete")
    require(manifest.get("authority") == TRAINING_AUTHORITY, f"training authority must equal {TRAINING_AUTHORITY}")
    identity = manifest.get("identity")
    require(isinstance(identity, str) and identity.startswith("sha256:") and len(identity) == 71, "training manifest identity must be sha256-bound")

    source_corpus = validate_source_corpus(manifest_path, manifest.get("sourceAppearanceCorpus"), last_trustworthy)

    route = manifest.get("route")
    require(isinstance(route, dict), "effective route receipt is missing")
    require(isinstance(route.get("requested"), str) and route["requested"], "requested route is missing")
    require(isinstance(route.get("effective"), str) and route["effective"], "effective route is missing")
    require(route.get("prototypeIdentity") == "kaminos-volume-prototype-v0", "effective route prototype identity is invalid")
    require(isinstance(route.get("backend"), str) and route["backend"].startswith("WebGPU:"), "effective backend must preserve WebGPU identity")
    require(route.get("fallbackReason") is None, f"effective route contains fallback evidence: {route.get('fallbackReason')}")

    cohort = manifest.get("cohort")
    require(isinstance(cohort, dict) and isinstance(cohort.get("identity"), str) and cohort["identity"], "cohort identity is missing")
    require(isinstance(cohort.get("retainedStateCount"), int) and cohort["retainedStateCount"] > 1, "cohort must retain multiple simulator states")
    require(isinstance(cohort.get("retainedRowCount"), int) and cohort["retainedRowCount"] > 0, "cohort retained row count must be positive")
    require(cohort.get("droppedRowCount") == 0, "cohort must preserve zero dropped rows")
    require(cohort.get("sampleCap") is None, "cohort sample cap must remain null")

    feature_view = manifest.get("featureView")
    require(isinstance(feature_view, dict) and isinstance(feature_view.get("identity"), str) and feature_view["identity"], "feature view identity is missing")
    feature_order = require_nonblank_unique_order(feature_view.get("order"), "feature view")
    descriptor_comparison = validate_descriptor_comparison(
        manifest.get("descriptorComparison"),
        manifest_path,
        feature_view,
        source_corpus,
        last_trustworthy,
    )
    descriptor_producer = descriptor_comparison["producer"]
    descriptor_order = descriptor_producer["descriptorOrder"]
    descriptor_indices = {name: index for index, name in enumerate(descriptor_order)}

    admission = manifest.get("admission")
    require(isinstance(admission, dict) and isinstance(admission.get("identity"), str) and admission["identity"], "analytical admission identity is missing")
    require(admission.get("authority") == ADMISSION_AUTHORITY, f"admission must carry analytical membership authority {ADMISSION_AUTHORITY}")
    require_exact_order(admission.get("order"), ADMISSION_ORDER, "admission")
    require(admission.get("rowPolicy") == "only-analytically-admitted-candidates-v0", "admission row policy must exclude unadmitted candidates")

    coefficient_targets = manifest.get("coefficientTargets")
    require(isinstance(coefficient_targets, dict), "coefficient target contract is missing")
    require(coefficient_targets.get("identity") == "separate-nonnegative-ridge-and-nonridge-local-coefficients-v0", "coefficient target identity is invalid")
    require(coefficient_targets.get("coefficientBoundary") == COEFFICIENT_BOUNDARY, f"coefficient boundary must equal {COEFFICIENT_BOUNDARY}")
    require_exact_order(coefficient_targets.get("order"), COEFFICIENT_ORDER, "coefficient target")
    require(coefficient_targets.get("outputTransform") == OUTPUT_TRANSFORM, f"coefficient output transform must equal {OUTPUT_TRANSFORM}")

    footprint = manifest.get("footprint")
    require(isinstance(footprint, dict), "post-admission footprint contract is missing")
    require(footprint.get("identity") == FOOTPRINT_IDENTITY, f"footprint identity must equal {FOOTPRINT_IDENTITY}")
    require(footprint.get("authority") == FOOTPRINT_AUTHORITY, f"footprint authority must equal {FOOTPRINT_AUTHORITY}")
    require(footprint.get("learnedByCoefficientModel") is False, "coefficient model must not silently learn or replace analytical covariance")

    transport = manifest.get("transportEvaluation")
    require(isinstance(transport, dict), "shared-transmittance evaluation contract is missing")
    require(transport.get("identity") == TRANSPORT_IDENTITY, f"transport identity must equal {TRANSPORT_IDENTITY}")
    require(transport.get("orderPolicy") == ORDER_POLICY, f"transport order policy must equal {ORDER_POLICY}")
    require(transport.get("contributionPolicy") == CONTRIBUTION_POLICY, f"transport contribution policy must equal {CONTRIBUTION_POLICY}")
    require(transport.get("independentlyRenderedToneMappedImageAdditivity") is False, "independent tone-mapped image additivity is not shared-transmittance evidence")

    splits = manifest.get("splits")
    require(isinstance(splits, dict) and splits.get("identity") == SPLIT_IDENTITY, f"split identity must equal {SPLIT_IDENTITY}")
    train_ids = splits.get("train", {}).get("stateIds")
    held_ids = splits.get("heldOut", {}).get("stateIds")
    require(isinstance(train_ids, list) and train_ids, "whole-state split must contain train states")
    require(isinstance(held_ids, list) and held_ids, "whole-state split must contain held states")
    require(not set(train_ids).intersection(held_ids), "train and held simulator state ids must be disjoint")

    states = manifest.get("states")
    require(isinstance(states, list) and len(states) == cohort["retainedStateCount"], "state rows do not match retained state count")
    state_ids: list[str] = []
    retained_rows = 0
    for index, state in enumerate(states):
        label = f"state {index}"
        require(isinstance(state, dict) and isinstance(state.get("id"), str) and state["id"], f"{label} identity is missing")
        state_id = state["id"]
        require(state_id not in state_ids, f"{label} identity is duplicated")
        state_ids.append(state_id)
        expected_split = "train" if state_id in train_ids else "heldOut" if state_id in held_ids else None
        require(expected_split is not None, f"{label} is absent from whole-state split lists")
        require(state.get("splitRole") == expected_split, f"{label} split role does not match whole-state split lists")
        require(isinstance(state.get("sameStateCaptureId"), str) and state["sameStateCaptureId"], f"{label} same-state capture identity is missing")
        requested_control_identity = state.get("requestedControlIdentity")
        control_identity = state.get("effectiveControlIdentity")
        require(isinstance(requested_control_identity, str) and requested_control_identity.startswith("sha256:") and len(requested_control_identity) == 71, f"{label} requested control identity must be sha256-bound")
        require(isinstance(control_identity, str) and control_identity.startswith("sha256:") and len(control_identity) == 71, f"{label} effective control identity must be sha256-bound")
        require(requested_control_identity == control_identity, f"{label} requested and effective control identities differ")
        rows = state.get("rows")
        require(isinstance(rows, dict), f"{label} row artifacts are missing")
        count = rows.get("count")
        require(isinstance(count, int) and count > 0, f"{label} row count must be positive")
        retained_rows += count
        source_manifest = validate_source_field_manifest(
            manifest_path,
            state.get("sourceFieldManifest"),
            label,
            route,
            source_corpus,
            last_trustworthy,
        )
        features = validate_float_artifact(
            manifest_path,
            rows.get("features"),
            f"{label} feature",
            [count, len(feature_order)],
            "post-admission-local-features",
            last_trustworthy,
        )
        admissions = validate_float_artifact(
            manifest_path,
            rows.get("admission"),
            f"{label} admission",
            [count, len(ADMISSION_ORDER)],
            "analytical-ridge-or-nonridge-admission",
            last_trustworthy,
        )
        native_cell_indices = validate_uint32_artifact(
            manifest_path,
            rows.get("nativeCellIndices"),
            f"{label} native-cell index",
            [count],
            DESCRIPTOR_INDEX_ROLE,
            last_trustworthy,
        )
        require(len(set(native_cell_indices)) == count, f"{label} contains a duplicate native-cell index")
        grid_cell_count = source_corpus["grid"] ** 3
        require(all(index < grid_cell_count for index in native_cell_indices), f"{label} contains an out-of-bounds native-cell index")
        coefficients = validate_float_artifact(
            manifest_path,
            rows.get("coefficients"),
            f"{label} coefficient",
            [count, len(COEFFICIENT_ORDER)],
            "exact-local-layer-emission-extinction",
            last_trustworthy,
        )
        descriptors = validate_float_artifact(
            manifest_path,
            rows.get("kernelDescriptors"),
            f"{label} kernel descriptor",
            [count, descriptor_producer["strideFloats"]],
            DESCRIPTOR_ROLE,
            last_trustworthy,
        )
        validate_descriptor_artifact_receipt(
            rows.get("kernelDescriptors"),
            descriptor_producer,
            admission,
            rows.get("admission"),
            rows.get("nativeCellIndices"),
            source_manifest,
            count,
            label,
        )
        require(len(features) == count * len(feature_order), f"{label} feature payload is partial")
        require(len(descriptors) == count * descriptor_producer["strideFloats"], f"{label} kernel descriptor payload is partial")
        expected_strength_zero = 1.0 if descriptor_producer["effectiveControls"]["strength"] == 0 else 0.0
        for row in range(count):
            offset = row * descriptor_producer["strideFloats"]
            normalized_mass = descriptors[offset + descriptor_indices["kernel.normalizedMass"]]
            strength_zero = descriptors[offset + descriptor_indices["validity.strengthZeroIdentity"]]
            embedded_native_cell_index = descriptors[offset + descriptor_indices["position.nativeCellIndex"]]
            validity = descriptors[offset + descriptor_indices["validity.conservativeMajorant"]]
            require(abs(normalized_mass - 1.0) <= 1e-5, f"{label} row {row} descriptor normalized mass must equal one")
            require(
                embedded_native_cell_index == native_cell_indices[row],
                f"{label} descriptor row {row} native-cell index differs from caller-ordered admission index",
            )
            require(abs(strength_zero - expected_strength_zero) <= 1e-5, f"{label} row {row} descriptor strength-zero identity disagrees with effective controls")
            if expected_strength_zero == 1.0:
                zero_geometry_channels = (
                    "kernel.covariance.xx",
                    "kernel.covariance.xy",
                    "kernel.covariance.xz",
                    "kernel.covariance.yy",
                    "kernel.covariance.yz",
                    "kernel.covariance.zz",
                    "kernel.radiusWorld",
                )
                require(
                    all(abs(descriptors[offset + descriptor_indices[channel]]) <= 1e-7 for channel in zero_geometry_channels),
                    f"{label} row {row} strength-zero moments and radius must be zero",
                )
            require(0.0 <= validity <= 1.0, f"{label} row {row} descriptor validity must lie within [0, 1]")
            for channel in ("majorant.density", "majorant.fire", "majorant.extinction", "majorant.importance"):
                require(descriptors[offset + descriptor_indices[channel]] >= 0.0, f"{label} row {row} descriptor {channel} must be nonnegative")
        require(all(0.0 <= value <= 1.0 for value in admissions), f"{label} analytical admission values must lie within [0, 1]")
        require(all(value >= 0.0 for value in coefficients), f"{label} layer coefficients must be nonnegative")
        for row in range(count):
            ridge_admission = admissions[row * 2]
            nonridge_admission = admissions[row * 2 + 1]
            require(max(ridge_admission, nonridge_admission) > 0.0, f"{label} row {row} is outside all analytical admission")
            ridge_targets = coefficients[row * 8:row * 8 + 4]
            nonridge_targets = coefficients[row * 8 + 4:row * 8 + 8]
            require(ridge_admission > 0.0 or max(ridge_targets) <= 1e-7, f"{label} row {row} has Ridge coefficients outside Ridge admission")
            require(nonridge_admission > 0.0 or max(nonridge_targets) <= 1e-7, f"{label} row {row} has Non-Ridge coefficients outside Non-Ridge admission")

    require(set(state_ids) == set(train_ids).union(held_ids), "whole-state split ids do not exactly cover retained states")
    require(retained_rows == cohort["retainedRowCount"], "state row counts do not match retained cohort rows")
    return {
        "identity": identity,
        "sourceAppearanceCorpus": source_corpus,
        "route": route,
        "cohort": cohort,
        "featureView": {"identity": feature_view["identity"], "order": feature_order, "channelCount": len(feature_order)},
        "descriptorComparison": descriptor_comparison,
        "admission": admission,
        "coefficientTargets": coefficient_targets,
        "footprint": footprint,
        "transportEvaluation": transport,
        "splits": {"identity": SPLIT_IDENTITY, "train": {"stateIds": train_ids}, "heldOut": {"stateIds": held_ids}},
    }


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def training_states(
    manifest: dict[str, Any],
    manifest_path: Path,
    validated: dict[str, Any],
) -> list[dict[str, Any]]:
    import numpy as np

    feature_count = validated["featureView"]["channelCount"]
    descriptor_stride = validated["descriptorComparison"]["producer"]["strideFloats"]
    states = []
    for state in manifest["states"]:
        rows = state["rows"]
        count = rows["count"]
        states.append(
            {
                "id": state["id"],
                "splitRole": state["splitRole"],
                "count": count,
                "features": np.memmap(
                    resolve_artifact_path(manifest_path, rows["features"]["path"]),
                    dtype="<f4",
                    mode="r",
                    shape=(count, feature_count),
                ),
                "descriptors": np.memmap(
                    resolve_artifact_path(manifest_path, rows["kernelDescriptors"]["path"]),
                    dtype="<f4",
                    mode="r",
                    shape=(count, descriptor_stride),
                ),
                "targets": np.memmap(
                    resolve_artifact_path(manifest_path, rows["coefficients"]["path"]),
                    dtype="<f4",
                    mode="r",
                    shape=(count, len(COEFFICIENT_ORDER)),
                ),
            }
        )
    return states


def selected_descriptor_indices(validated: dict[str, Any]) -> list[int]:
    treatment_order = validated["descriptorComparison"]["treatment"]["order"]
    require(treatment_order == DEFAULT_DESCRIPTOR_CHANNELS, f"treatment descriptor order must equal {DEFAULT_DESCRIPTOR_CHANNELS}")
    producer_order = validated["descriptorComparison"]["producer"]["descriptorOrder"]
    producer_indices = {name: index for index, name in enumerate(producer_order)}
    return [producer_indices[name] for name in treatment_order]


def iter_state_batches(
    states: list[dict[str, Any]],
    split_role: str,
    batch_size: int,
    descriptor_indices: list[int] | None,
    block_order: list[tuple[int, int]] | None = None,
) -> Any:
    import numpy as np

    selected_states = [state for state in states if state["splitRole"] == split_role]
    blocks = [
        (state_index, start)
        for state_index, state in enumerate(selected_states)
        for start in range(0, state["count"], batch_size)
    ]
    if block_order is not None:
        require(set(block_order) == set(blocks) and len(block_order) == len(blocks), "training block order does not cover the split exactly once")
        blocks = block_order
    for state_index, start in blocks:
        state = selected_states[state_index]
        stop = min(start + batch_size, state["count"])
        base_features = np.asarray(state["features"][start:stop], dtype=np.float32)
        if descriptor_indices is None:
            features = base_features
        else:
            descriptor_features = np.asarray(state["descriptors"][start:stop, descriptor_indices], dtype=np.float32)
            features = np.concatenate((base_features, descriptor_features), axis=1)
        targets = np.asarray(state["targets"][start:stop], dtype=np.float32)
        yield features, targets


def training_block_order(
    states: list[dict[str, Any]],
    batch_size: int,
    seed: int,
    epoch: int,
) -> list[tuple[int, int]]:
    import numpy as np

    train_states = [state for state in states if state["splitRole"] == "train"]
    blocks = [
        (state_index, start)
        for state_index, state in enumerate(train_states)
        for start in range(0, state["count"], batch_size)
    ]
    permutation = np.random.default_rng(seed + epoch).permutation(len(blocks))
    return [blocks[int(index)] for index in permutation]


def streaming_normalization(
    states: list[dict[str, Any]],
    batch_size: int,
    descriptor_indices: list[int] | None,
) -> dict[str, Any]:
    import numpy as np

    input_count = states[0]["features"].shape[1] + (0 if descriptor_indices is None else len(descriptor_indices))
    feature_sum = np.zeros(input_count, dtype=np.float64)
    feature_square_sum = np.zeros(input_count, dtype=np.float64)
    target_square_sum = np.zeros(len(COEFFICIENT_ORDER), dtype=np.float64)
    row_count = 0
    for features, targets in iter_state_batches(states, "train", batch_size, descriptor_indices):
        feature_sum += np.sum(features, axis=0, dtype=np.float64)
        feature_square_sum += np.sum(np.square(features, dtype=np.float64), axis=0, dtype=np.float64)
        target_square_sum += np.sum(np.square(targets, dtype=np.float64), axis=0, dtype=np.float64)
        row_count += features.shape[0]
    require(row_count > 0, "training split contains no rows")
    feature_mean = feature_sum / row_count
    feature_variance = np.maximum(feature_square_sum / row_count - np.square(feature_mean), 1e-12)
    feature_std = np.sqrt(feature_variance)
    target_scale = np.maximum(np.sqrt(target_square_sum / row_count), 1e-6)
    require(input_count == feature_mean.shape[0], "normalization input count changed")
    return {
        "featureMean": feature_mean.astype(np.float32),
        "featureStd": feature_std.astype(np.float32),
        "targetScale": target_scale.astype(np.float32),
        "rowCount": row_count,
    }


def count_trainable_parameters(model: Any) -> int:
    import numpy as np
    from mlx.utils import tree_flatten

    return sum(int(np.asarray(value).size) for _, value in tree_flatten(model.parameters()))


def train_arm(
    arm: str,
    states: list[dict[str, Any]],
    descriptor_indices: list[int],
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
    output_path: Path,
) -> tuple[Any, dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    import mlx.core as mx
    import mlx.nn as nn
    import mlx.optimizers as optim
    from mlx.utils import tree_flatten

    feature_count = states[0]["features"].shape[1]
    active_descriptor_indices = None if arm == "baseline" else descriptor_indices
    print(json.dumps({"phase": "arm-start", "arm": arm}), flush=True)
    normalization = streaming_normalization(states, batch_size, active_descriptor_indices)

    class BaselineModel(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.input_layer = nn.Linear(feature_count, 248)
            self.output_layer = nn.Linear(248, len(COEFFICIENT_ORDER))

        def __call__(self, values: Any) -> Any:
            logits = self.output_layer(nn.silu(self.input_layer(values)))
            return mx.logaddexp(logits, mx.zeros_like(logits))

    class TreatmentModel(nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.shared_feature_gate = mx.zeros((feature_count,))
            self.input_layer = nn.Linear(feature_count + len(descriptor_indices), 204)
            self.output_layer = nn.Linear(204, len(COEFFICIENT_ORDER))

        def __call__(self, values: Any) -> Any:
            shared = values[:, :feature_count]
            descriptors = values[:, feature_count:]
            gated_shared = shared * (1.0 + 0.25 * mx.tanh(self.shared_feature_gate))
            combined = mx.concatenate((gated_shared, descriptors), axis=1)
            logits = self.output_layer(nn.silu(self.input_layer(combined)))
            return mx.logaddexp(logits, mx.zeros_like(logits))

    require(arm in {"baseline", "treatment"}, f"unknown training arm {arm}")
    mx.random.seed(seed)
    model = BaselineModel() if arm == "baseline" else TreatmentModel()
    mx.eval(model.parameters())
    parameter_count = count_trainable_parameters(model)
    require(parameter_count == TRAINABLE_PARAMETER_COUNT, f"{arm} trainable parameter count {parameter_count} differs from {TRAINABLE_PARAMETER_COUNT}")
    optimizer = optim.AdamW(learning_rate=learning_rate, weight_decay=1e-5)
    feature_mean = mx.array(normalization["featureMean"])
    feature_std = mx.array(normalization["featureStd"])
    target_scale = mx.array(normalization["targetScale"])

    def loss_fn(active_model: Any, raw_features: Any, raw_targets: Any) -> Any:
        normalized_features = (raw_features - feature_mean) / feature_std
        normalized_targets = raw_targets / target_scale
        predictions = active_model(normalized_features)
        return mx.mean(mx.square(predictions - normalized_targets))

    loss_and_grad = nn.value_and_grad(model, loss_fn)
    trace: list[dict[str, Any]] = []
    rows_seen = 0
    batches_seen = 0
    for epoch in range(epochs):
        epoch_loss = 0.0
        epoch_rows = 0
        epoch_batches = 0
        order = training_block_order(states, batch_size, seed, epoch)
        for features, targets in iter_state_batches(states, "train", batch_size, active_descriptor_indices, order):
            loss, gradients = loss_and_grad(model, mx.array(features), mx.array(targets))
            optimizer.update(model, gradients)
            mx.eval(model.parameters(), optimizer.state, loss)
            epoch_loss += float(loss.item())
            epoch_rows += features.shape[0]
            epoch_batches += 1
        require(epoch_rows == normalization["rowCount"], f"{arm} epoch did not consume every retained training row")
        rows_seen += epoch_rows
        batches_seen += epoch_batches
        trace.append(
            {
                "epoch": epoch + 1,
                "meanBatchLoss": epoch_loss / max(epoch_batches, 1),
                "rows": epoch_rows,
                "batches": epoch_batches,
            }
        )
        print(json.dumps({"phase": "epoch-complete", "arm": arm, **trace[-1]}), flush=True)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    mx.save_safetensors(str(output_path), dict(tree_flatten(model.parameters())))
    model_artifact = {
        "path": str(output_path),
        "bytes": output_path.stat().st_size,
        "sha256": sha256_file(output_path),
        "format": "mlx-safetensors-v0",
    }
    normalization_receipt = {
        "identity": "train-state-streaming-zscore-plus-target-rms-v0",
        "featureMean": normalization["featureMean"].tolist(),
        "featureStd": normalization["featureStd"].tolist(),
        "targetScale": normalization["targetScale"].tolist(),
        "rowCount": normalization["rowCount"],
        "epochs": epochs,
        "rowsSeen": rows_seen,
        "batchesSeen": batches_seen,
    }
    architecture = {
        "identity": BASELINE_ARCHITECTURE_IDENTITY if arm == "baseline" else TREATMENT_ARCHITECTURE_IDENTITY,
        "trainableParameters": parameter_count,
        "outputTransform": OUTPUT_TRANSFORM,
        "sharedFeatureCount": feature_count,
        "descriptorFeatureCount": 0 if arm == "baseline" else len(descriptor_indices),
        "sharedFeatureGate": "none" if arm == "baseline" else "24-trainable-useful-multiplicative-gates-v0",
    }
    return model, normalization, trace, {"architecture": architecture, "normalization": normalization_receipt, "modelArtifact": model_artifact}


def evaluate_arm(
    model: Any,
    normalization: dict[str, Any],
    states: list[dict[str, Any]],
    split_role: str,
    batch_size: int,
    descriptor_indices: list[int] | None,
) -> dict[str, Any]:
    import mlx.core as mx
    import numpy as np

    squared = np.zeros(len(COEFFICIENT_ORDER), dtype=np.float64)
    absolute = np.zeros(len(COEFFICIENT_ORDER), dtype=np.float64)
    target_sum = np.zeros(len(COEFFICIENT_ORDER), dtype=np.float64)
    prediction_sum = np.zeros(len(COEFFICIENT_ORDER), dtype=np.float64)
    normalized_squared_sum = 0.0
    normalized_absolute_sum = 0.0
    row_count = 0
    for features, targets in iter_state_batches(states, split_role, batch_size, descriptor_indices):
        normalized_features = (features - normalization["featureMean"]) / normalization["featureStd"]
        normalized_predictions = np.asarray(model(mx.array(normalized_features)), dtype=np.float32)
        predictions = normalized_predictions * normalization["targetScale"]
        difference = predictions - targets
        normalized_difference = difference / normalization["targetScale"]
        squared += np.sum(np.square(difference, dtype=np.float64), axis=0)
        absolute += np.sum(np.abs(difference), axis=0, dtype=np.float64)
        target_sum += np.sum(targets, axis=0, dtype=np.float64)
        prediction_sum += np.sum(predictions, axis=0, dtype=np.float64)
        normalized_squared_sum += float(np.sum(np.square(normalized_difference, dtype=np.float64)))
        normalized_absolute_sum += float(np.sum(np.abs(normalized_difference), dtype=np.float64))
        row_count += features.shape[0]
    require(row_count > 0, f"{split_role} evaluation contains no rows")
    channel_count = len(COEFFICIENT_ORDER)
    channel_metrics = []
    for index, name in enumerate(COEFFICIENT_ORDER):
        channel_metrics.append(
            {
                "name": name,
                "mse": float(squared[index] / row_count),
                "mae": float(absolute[index] / row_count),
                "targetSum": float(target_sum[index]),
                "predictionSum": float(prediction_sum[index]),
                "energyRecoveryFraction": float(prediction_sum[index] / target_sum[index]) if target_sum[index] > 1e-12 else None,
            }
        )
    return {
        "rowCount": row_count,
        "normalizedMse": normalized_squared_sum / (row_count * channel_count),
        "normalizedMae": normalized_absolute_sum / (row_count * channel_count),
        "channels": channel_metrics,
    }


def train_comparison(
    manifest: dict[str, Any],
    manifest_path: Path,
    validated: dict[str, Any],
    output_dir: Path,
    epochs: int,
    batch_size: int,
    learning_rate: float,
    seed: int,
) -> dict[str, Any]:
    import mlx.core as mx

    print(json.dumps({"phase": "training-route", "backend": "mlx", "device": str(mx.default_device())}), flush=True)
    states = training_states(manifest, manifest_path, validated)
    descriptor_indices = selected_descriptor_indices(validated)
    arms: dict[str, Any] = {}
    for arm in ("baseline", "treatment"):
        model, normalization, trace, receipt = train_arm(
            arm,
            states,
            descriptor_indices,
            epochs,
            batch_size,
            learning_rate,
            seed,
            output_dir / f"{arm}-model.safetensors",
        )
        active_descriptor_indices = None if arm == "baseline" else descriptor_indices
        arms[arm] = {
            **receipt,
            "trace": trace,
            "train": evaluate_arm(model, normalization, states, "train", batch_size, active_descriptor_indices),
            "heldState": evaluate_arm(model, normalization, states, "heldOut", batch_size, active_descriptor_indices),
        }
    baseline_mse = arms["baseline"]["heldState"]["normalizedMse"]
    treatment_mse = arms["treatment"]["heldState"]["normalizedMse"]
    require(math.isfinite(baseline_mse) and math.isfinite(treatment_mse), "held-state normalized MSE is non-finite")
    return {
        "backend": "mlx",
        "device": str(mx.default_device()),
        "splitIdentity": SPLIT_IDENTITY,
        "descriptorComparisonIdentity": DESCRIPTOR_COMPARISON_IDENTITY,
        "descriptorChannels": validated["descriptorComparison"]["treatment"]["order"],
        "settings": {
            "epochs": epochs,
            "batchSize": batch_size,
            "learningRate": learning_rate,
            "seed": seed,
            "weightDecay": 1e-5,
            "rowPolicy": "every-retained-row-every-epoch-no-sampling-cap-v0",
            "blockOrder": "same-seed-same-contiguous-block-permutation-per-arm-v0",
        },
        "arms": arms,
        "comparison": {
            "heldNormalizedMseDelta": baseline_mse - treatment_mse,
            "heldNormalizedMseDeltaSign": "positive-means-treatment-better",
            "heldNormalizedMseRelativeChange": (treatment_mse - baseline_mse) / baseline_mse if baseline_mse > 0 else None,
            "heldNormalizedMseRelativeChangeSign": "negative-means-treatment-better",
        },
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--train", action="store_true")
    parser.add_argument("--out-dir", type=Path)
    parser.add_argument("--epochs", type=int, default=6)
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--learning-rate", type=float, default=0.002)
    parser.add_argument("--seed", type=int, default=7162026)
    parser.add_argument("--revalidation-marker", type=Path)
    parser.add_argument("--revalidation-delay-ms", type=float, default=0.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started_at = time.time()
    input_path = args.input.expanduser().resolve()
    report_path = args.report.expanduser().resolve()
    phase = "input-manifest-read"
    last_trustworthy: dict[str, Any] = {"validatedArtifactCount": 0}
    training_started = False
    try:
        input_bytes = input_path.read_bytes()
        require(input_bytes, "training manifest is blank")
        input_sha = sha256_bytes(input_bytes)
        last_trustworthy["inputManifestSha256"] = input_sha
        manifest = json.loads(input_bytes)
        phase = "validate-training-authority"
        require(args.probe_only != args.train, "select exactly one of --probe-only or --train")
        require(args.revalidation_delay_ms >= 0, "revalidation delay must be nonnegative")
        require(args.epochs > 0, "epochs must be positive")
        require(args.batch_size > 0, "batch size must be positive")
        require(math.isfinite(args.learning_rate) and args.learning_rate > 0, "learning rate must be finite and positive")
        if args.train:
            require(args.out_dir is not None, "--out-dir is required with --train")
        validated = validate_manifest(manifest, input_path, last_trustworthy)
        if args.train:
            phase = "mlx-training"
            training_started = True
            gc.collect()
            output_dir = args.out_dir.expanduser().resolve()
            training_result = train_comparison(
                manifest,
                input_path,
                validated,
                output_dir,
                args.epochs,
                args.batch_size,
                args.learning_rate,
                args.seed,
            )
        phase = "completion-revalidation"
        if args.revalidation_marker is not None:
            atomic_json(
                args.revalidation_marker.expanduser().resolve(),
                {
                    "schema": "kaminos.volume.layer-coefficient-revalidation-marker.v0",
                    "status": "initial-validation-complete",
                    "manifestSha256": input_sha,
                    "trainingStarted": training_started,
                },
            )
        if args.revalidation_delay_ms > 0:
            time.sleep(args.revalidation_delay_ms / 1000.0)
        completion_input_bytes = input_path.read_bytes()
        require(sha256_bytes(completion_input_bytes) == input_sha, "training manifest changed after validation")
        completion_evidence: dict[str, Any] = {"validatedArtifactCount": 0}
        completion_validated = validate_manifest(json.loads(completion_input_bytes), input_path, completion_evidence)
        require(completion_validated == validated, "training evidence identities changed during completion revalidation")
        require(completion_evidence.get("sourceAppearanceCorpusValidated") is True, "source appearance corpus was not revalidated at completion")
        phase = "report-finalization"
        if args.train:
            report = {
                "schema": TRAINING_RESULT_SCHEMA,
                "status": "trained",
                "failurePhase": None,
                "trainingStarted": True,
                "source": {"manifestPath": str(input_path), "manifestSha256": input_sha, "manifestIdentity": validated["identity"]},
                "sourceAppearanceCorpus": validated["sourceAppearanceCorpus"],
                "route": validated["route"],
                "cohort": validated["cohort"],
                "featureView": validated["featureView"],
                "admission": validated["admission"],
                "coefficientTargets": validated["coefficientTargets"],
                "footprint": validated["footprint"],
                "transportEvaluation": validated["transportEvaluation"],
                "splits": validated["splits"],
                "completionRevalidation": {
                    "validatedArtifactCount": completion_evidence["validatedArtifactCount"],
                    "sourceAppearanceCorpusRevalidated": completion_evidence["sourceAppearanceCorpusValidated"],
                    "sourceAppearanceCameraCount": completion_evidence["sourceAppearanceCameraCount"],
                },
                "lastTrustworthyEvidence": last_trustworthy,
                "startedAt": started_at,
                "finishedAt": time.time(),
                **training_result,
            }
            report["elapsedSeconds"] = report["finishedAt"] - started_at
            atomic_json(report_path, report)
            print(json.dumps({"status": report["status"], "report": str(report_path), "comparison": report["comparison"]}))
            return 0
        report = {
            "schema": RESULT_SCHEMA,
            "status": "contract-valid",
            "failurePhase": None,
            "trainingStarted": training_started,
            "backend": "not-loaded-probe-only",
            "source": {"manifestPath": str(input_path), "manifestSha256": input_sha, "manifestIdentity": validated["identity"]},
            "sourceAppearanceCorpus": validated["sourceAppearanceCorpus"],
            "route": validated["route"],
            "cohort": validated["cohort"],
            "featureView": validated["featureView"],
            "descriptorComparison": validated["descriptorComparison"],
            "admission": validated["admission"],
            "coefficientTargets": validated["coefficientTargets"],
            "footprint": validated["footprint"],
            "transportEvaluation": validated["transportEvaluation"],
            "splits": validated["splits"],
            "assays": {
                "trainState": {"identity": "same-state-training-fit-v0", "generalizationAuthority": False},
                "heldState": {"identity": SPLIT_IDENTITY, "generalizationAuthority": "held-simulator-state-only"},
                "heldCamera": {"identity": "frozen-state-camera-holdout-v0", "generalizationAuthority": "pending-renderer-evaluation"},
            },
            "architecture": {
                "identity": "separate-layer-coefficient-heads-v0",
                "outputTransform": OUTPUT_TRANSFORM,
                "membershipPredicted": False,
                "footprintPredicted": False,
            },
            "completionRevalidation": {
                "validatedArtifactCount": completion_evidence["validatedArtifactCount"],
                "sourceAppearanceCorpusRevalidated": completion_evidence["sourceAppearanceCorpusValidated"],
                "sourceAppearanceCameraCount": completion_evidence["sourceAppearanceCameraCount"],
            },
            "lastTrustworthyEvidence": last_trustworthy,
            "startedAt": started_at,
            "finishedAt": time.time(),
        }
        report["elapsedSeconds"] = report["finishedAt"] - started_at
        atomic_json(report_path, report)
        print(json.dumps({"status": report["status"], "report": str(report_path), "rows": validated["cohort"]["retainedRowCount"]}))
        return 0
    except Exception as error:
        failure = {
            "schema": FAILURE_SCHEMA,
            "status": "blocked",
            "failurePhase": phase,
            "reason": str(error),
            "trainingStarted": training_started,
            "lastTrustworthyEvidence": last_trustworthy,
            "startedAt": started_at,
            "finishedAt": time.time(),
        }
        failure["elapsedSeconds"] = failure["finishedAt"] - started_at
        atomic_json(report_path, failure)
        print(json.dumps({"status": failure["status"], "report": str(report_path), "failurePhase": phase, "reason": str(error)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
