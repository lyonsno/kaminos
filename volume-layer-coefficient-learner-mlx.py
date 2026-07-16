#!/usr/bin/env python3
"""Validate the lawful post-admission layer-coefficient training contract.

This airlock intentionally performs no MLX training. It blocks model spend until
analytical Ridge-or-Non-Ridge admission and exact local coefficient tensors exist.
"""

from __future__ import annotations

import argparse
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
DESCRIPTOR_SCHEMA = "kaminos.flow-kernel-local-descriptor.v0"
DESCRIPTOR_ROLE = "camera-independent-flow-kernel-descriptors"
DESCRIPTOR_VALIDITY_ROLE = "conservative-kernel-descriptor-validity-majorant"
DESCRIPTOR_VALIDITY_ORDER = ["kernel.validity", "kernel.majorant"]
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
STATIC_KERNEL_DESCRIPTOR_CHANNELS = {
    "kernel.mass",
    "kernel.meanOffset.x",
    "kernel.meanOffset.y",
    "kernel.meanOffset.z",
    "kernel.secondCentralMoment.xx",
    "kernel.secondCentralMoment.xy",
    "kernel.secondCentralMoment.xz",
    "kernel.secondCentralMoment.yy",
    "kernel.secondCentralMoment.yz",
    "kernel.secondCentralMoment.zz",
    "kernel.frontNormal.x",
    "kernel.frontNormal.y",
    "kernel.frontNormal.z",
    "kernel.flowTangent.x",
    "kernel.flowTangent.y",
    "kernel.flowTangent.z",
    "kernel.flowCoherence",
    "kernel.curlMagnitude",
    "kernel.divergence",
    "kernel.validity",
    "kernel.majorant",
}


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


def require_sha_identity(value: Any, label: str) -> str:
    require(
        isinstance(value, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", value) is not None,
        f"{label} must be sha256-bound",
    )
    return value


def descriptor_channel_allowed(channel: str, feature_order: list[str]) -> bool:
    if channel in STATIC_KERNEL_DESCRIPTOR_CHANNELS:
        return True
    for field in feature_order:
        prefix = f"kernel.reconstructed.{field}."
        if channel.startswith(prefix) and channel[len(prefix):] in {"value", "gradient.x", "gradient.y", "gradient.z"}:
            return True
    return False


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
    feature_view: dict[str, Any],
    feature_order: list[str],
    source_corpus: dict[str, Any],
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
    require(isinstance(producer, dict) and producer.get("schema") == DESCRIPTOR_SCHEMA, f"kernel descriptor producer schema must equal {DESCRIPTOR_SCHEMA}")
    for key, label in [
        ("socketIdentity", "kernel descriptor socket identity"),
        ("sourceFieldIdentity", "kernel descriptor source field identity"),
        ("requestedKernelControlIdentity", "requested kernel control identity"),
        ("effectiveKernelControlIdentity", "effective kernel control identity"),
    ]:
        require_sha_identity(producer.get(key), label)
    require(producer["requestedKernelControlIdentity"] == producer["effectiveKernelControlIdentity"], "requested and effective kernel control identities differ")
    require(isinstance(producer.get("requestedRoute"), str) and producer["requestedRoute"], "kernel descriptor requested route is missing")
    require(isinstance(producer.get("effectiveRoute"), str) and producer["effectiveRoute"], "kernel descriptor effective route is missing")
    require(producer.get("prototypeIdentity") == "kaminos-volume-prototype-v0", "kernel descriptor prototype identity is invalid")
    require(isinstance(producer.get("backend"), str) and producer["backend"].startswith("WebGPU:"), "kernel descriptor backend must preserve WebGPU identity")
    require(producer["backend"] == source_corpus["backend"], "kernel descriptor backend differs from the coefficient source corpus")
    require(producer.get("grid") == source_corpus["grid"], "kernel descriptor grid differs from the coefficient source corpus")
    require(producer.get("fallbackReason") is None, f"kernel descriptor route contains fallback evidence: {producer.get('fallbackReason')}")
    requested_controls = producer.get("requestedControls")
    effective_controls = producer.get("effectiveControls")
    require(isinstance(requested_controls, dict) and isinstance(effective_controls, dict), "requested and effective kernel controls are missing")
    require(set(requested_controls) == {"strength", "worldRadius", "flowCoherence"}, "requested kernel controls must contain strength, worldRadius, and flowCoherence")
    require(set(effective_controls) == set(requested_controls), "effective kernel controls do not match the requested control schema")
    require(all(isinstance(item, (int, float)) and math.isfinite(item) for item in requested_controls.values()), "requested kernel controls must be finite")
    require(requested_controls["strength"] >= 0, "requested kernel strength must be nonnegative")
    require(requested_controls["worldRadius"] > 0, "requested kernel world radius must be positive")
    require(0 <= requested_controls["flowCoherence"] <= 1, "requested kernel flow coherence must lie within [0, 1]")
    require(effective_controls == requested_controls, "requested and effective kernel controls differ")
    require(producer.get("cameraIndependent") is True, "kernel descriptor producer must be camera-independent")
    require(producer.get("literalKernelTapsIncluded") is False, "literal kernel taps must not enter the descriptor learner")
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
    require(all(descriptor_channel_allowed(channel, feature_order) for channel in descriptor_order), "kernel descriptor order contains a channel outside the allowed camera-independent causal socket")
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
        "producer": producer,
        "baseline": baseline,
        "treatment": {**treatment, "order": descriptor_order, "channelCount": len(descriptor_order)},
        "analyticalGeometryArm": geometry,
    }


def validate_descriptor_artifact_receipt(
    artifact: Any,
    producer: dict[str, Any],
    expected_order: list[str],
    label: str,
) -> None:
    require(isinstance(artifact, dict), f"{label} artifact receipt is missing")
    require(
        artifact.get("socketIdentity") == producer["socketIdentity"],
        f"{label} descriptor socket identity differs from its artifact receipt",
    )
    require(
        artifact.get("sourceFieldIdentity") == producer["sourceFieldIdentity"],
        f"{label} descriptor source field identity differs from its artifact receipt",
    )
    require(
        artifact.get("kernelControlIdentity") == producer["effectiveKernelControlIdentity"],
        f"{label} descriptor kernel control identity differs from its artifact receipt",
    )
    require_exact_order(artifact.get("descriptorOrder"), expected_order, f"{label} descriptor artifact")


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
    descriptor_comparison = validate_descriptor_comparison(manifest.get("descriptorComparison"), feature_view, feature_order, source_corpus)
    descriptor_order = descriptor_comparison["treatment"]["order"]

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
            [count, len(descriptor_order)],
            DESCRIPTOR_ROLE,
            last_trustworthy,
        )
        validate_descriptor_artifact_receipt(
            rows.get("kernelDescriptors"),
            descriptor_comparison["producer"],
            descriptor_order,
            label,
        )
        descriptor_validity = validate_float_artifact(
            manifest_path,
            rows.get("kernelDescriptorValidity"),
            f"{label} kernel descriptor validity",
            [count, len(DESCRIPTOR_VALIDITY_ORDER)],
            DESCRIPTOR_VALIDITY_ROLE,
            last_trustworthy,
        )
        validate_descriptor_artifact_receipt(
            rows.get("kernelDescriptorValidity"),
            descriptor_comparison["producer"],
            DESCRIPTOR_VALIDITY_ORDER,
            f"{label} validity",
        )
        require(len(features) == count * len(feature_order), f"{label} feature payload is partial")
        require(len(descriptors) == count * len(descriptor_order), f"{label} kernel descriptor payload is partial")
        for row in range(count):
            validity = descriptor_validity[row * 2]
            majorant = descriptor_validity[row * 2 + 1]
            require(0.0 <= validity <= 1.0, f"{label} row {row} descriptor validity must lie within [0, 1]")
            require(majorant >= 0.0, f"{label} row {row} descriptor majorant must be nonnegative")
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--report", required=True, type=Path)
    parser.add_argument("--probe-only", action="store_true")
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
    try:
        input_bytes = input_path.read_bytes()
        require(input_bytes, "training manifest is blank")
        input_sha = sha256_bytes(input_bytes)
        last_trustworthy["inputManifestSha256"] = input_sha
        manifest = json.loads(input_bytes)
        phase = "validate-training-authority"
        require(args.probe_only, "training is held; invoke --probe-only until exact authored support and coefficient truth lands")
        require(args.revalidation_delay_ms >= 0, "revalidation delay must be nonnegative")
        validated = validate_manifest(manifest, input_path, last_trustworthy)
        phase = "completion-revalidation"
        if args.revalidation_marker is not None:
            atomic_json(
                args.revalidation_marker.expanduser().resolve(),
                {
                    "schema": "kaminos.volume.layer-coefficient-revalidation-marker.v0",
                    "status": "initial-validation-complete",
                    "manifestSha256": input_sha,
                    "trainingStarted": False,
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
        report = {
            "schema": RESULT_SCHEMA,
            "status": "contract-valid",
            "failurePhase": None,
            "trainingStarted": False,
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
            "trainingStarted": False,
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
