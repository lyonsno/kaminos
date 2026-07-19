#!/usr/bin/env python3
"""Screen exact Grid96 simulator features against held-camera peak relevance.

This is a frozen-state projection-relevance assay. It asks whether intrinsic,
camera-independent state can nominate peak-capable parents. It does not infer
visibility, change the renderer, or establish causal or production authority.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import traceback
from pathlib import Path
from typing import Any

import numpy as np


REPORT_SCHEMA = "kaminos.volume.grid96-peak-state-feature-screening-report.v0"
EXPECTED_REGISTRY_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-registry.v0"
EXPECTED_ATTRIBUTION_SCHEMA = "kaminos.volume.grid96-parent-peak-wisp-attribution-socket.v0"
EXPECTED_ROUTE = "native-3d-compute-fluid-raymarch-v0"
EXPECTED_BACKEND = "WebGPU:apple"
EXPECTED_ROW_COUNT = 370194
EXPECTED_GRID = 96
EXPECTED_STEP = 120
EXPECTED_STATE_FEATURE_ORDER = (
    "sidecar.support", "sidecar.coverage", "sidecar.ridge", "sidecar.footprint",
    "material.density", "material.heat", "material.fuel", "material.detail",
    "fire.energy", "fire.temperature", "fire.emission", "fire.detail",
    "micro.x", "micro.y", "micro.z", "micro.w",
    "front.topology", "velocity.x", "velocity.y", "velocity.z",
    "support.reaction", "support.interface", "flow.curlMagnitude", "flow.divergence",
)
EXPECTED_COEFFICIENT_ORDER = (
    "ridge.emission.r", "ridge.emission.g", "ridge.emission.b", "ridge.extinction",
    "nonRidge.emission.r", "nonRidge.emission.g", "nonRidge.emission.b", "nonRidge.extinction",
)
EXPECTED_REDUCED_ORDER = (
    "localOpticalWeight",
    "projectedCameraCount",
    "peakImportance.calibration",
    "peakImportance.heldMean",
    "peakImportance.heldMaximum",
    "peakImportance.heldSupportCount",
    "wispImportance.calibration",
    "wispImportance.heldMean",
    "wispImportance.heldMaximum",
    "wispImportance.heldSupportCount",
    "peakResidualOverlap.heldMean",
    "wispResidualOverlap.heldMean",
    "viewportKernelMass.heldMean",
    "preBinTransmittance.heldMean",
)
LABEL_NAMES = (
    "peakImportance.heldMean",
    "peakResidualOverlap.heldMean",
    "preBinTransmittance.heldMean",
    "wispImportance.heldMean",
)
CLAIM_BOUNDARY = {
    "singleState": True,
    "projectionRelevanceOnly": True,
    "featureSearchPerformed": True,
    "stateFeatureOrderAuthenticated": False,
    "stateFeatureMatrixScored": False,
    "concentrationClassAvailable": False,
    "leaveOneOutCausalityClaimed": False,
    "causalSelectorClaim": False,
    "adjacentStateAuthority": False,
    "supportChanged": False,
    "coefficientsChanged": False,
    "placementChanged": False,
    "footprintChanged": False,
    "targetChanged": False,
    "learnerStarted": False,
    "rendererClaim": False,
    "productionClaim": False,
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path, role: str) -> dict[str, Any]:
    require(path.is_file(), f"{role} is missing: {path}")
    try:
        value = json.loads(path.read_text())
    except Exception as error:
        raise ValueError(f"{role} is not valid JSON: {error}") from error
    require(isinstance(value, dict), f"{role} must be a JSON object")
    return value


def validate_artifact_descriptor(descriptor: dict[str, Any], role: str) -> Path:
    require(isinstance(descriptor, dict), f"{role} descriptor is missing")
    path = Path(str(descriptor.get("path", ""))).resolve()
    require(path.is_file(), f"{role} artifact is missing: {path}")
    shape = descriptor.get("shape")
    require(isinstance(shape, list) and shape and all(type(value) is int and value > 0 for value in shape), f"{role} shape is invalid")
    dtype_name = descriptor.get("dtype")
    dtype_by_name = {"float32-le": np.dtype("<f4"), "uint32-le": np.dtype("<u4")}
    require(dtype_name in dtype_by_name, f"{role} dtype is unsupported")
    expected_bytes = int(np.prod(shape, dtype=np.int64)) * dtype_by_name[dtype_name].itemsize
    require(descriptor.get("bytes") == expected_bytes, f"{role} descriptor byte count drifted")
    require(path.stat().st_size == expected_bytes, f"{role} artifact is partial")
    expected_sha256 = descriptor.get("sha256")
    require(isinstance(expected_sha256, str) and len(expected_sha256) == 64, f"{role} sha256 is invalid")
    require(sha256_file(path) == expected_sha256, f"{role} sha256 drifted")
    return path


def validate_effective_route(route: dict[str, Any]) -> None:
    require(isinstance(route, dict), "effective route receipt is missing")
    require(route.get("effective") == EXPECTED_ROUTE, "effective route is not the exact native volume route")
    require(route.get("backend") == EXPECTED_BACKEND, "backend is not the authenticated WebGPU backend")
    require(route.get("fallbackReason") is None, "fallback route contaminated the source evidence")


def validate_execution_receipt(
    execution: dict[str, Any],
    role: str,
    *,
    require_uncached: bool = False,
) -> None:
    require(isinstance(execution, dict), f"{role} execution receipt is missing")
    require(execution.get("rowCount") == EXPECTED_ROW_COUNT, f"{role} execution row count drifted")
    require(execution.get("sampleCap") is None, f"{role} applied a hidden sample cap")
    require(execution.get("droppedRowCount") == 0, f"{role} dropped rows")
    require(execution.get("fallbackRowCount") == 0, f"{role} contains fallback rows")
    if require_uncached:
        require(execution.get("cachedCameraCount") == 0, f"{role} contains cached camera evidence")


def validate_coefficient_order(value: Any) -> tuple[str, ...]:
    order = tuple(value) if isinstance(value, (list, tuple)) else ()
    require(order == EXPECTED_COEFFICIENT_ORDER, "source coefficient order drifted")
    return order


def stable_ranked_indices(
    native_ids: np.ndarray,
    scores: np.ndarray,
    count: int,
    direction: str,
) -> np.ndarray:
    ids = np.asarray(native_ids, dtype=np.uint32)
    values = np.asarray(scores, dtype=np.float64)
    require(ids.ndim == 1 and values.ndim == 1, "screening identities and scores must be one-dimensional")
    require(ids.size == values.size, "screening score rows drifted")
    require(np.unique(ids).size == ids.size, "screening native identities contain duplicates")
    require(np.all(np.isfinite(values)), "screening scores must be finite")
    require(type(count) is int and 0 < count <= ids.size, "screening count is outside the source population")
    require(direction in {"high", "low"}, "screening direction must be high or low")
    primary = -values if direction == "high" else values
    order = np.lexsort((ids.astype(np.uint64), primary))
    return np.asarray(order[:count], dtype=np.int64)


def selected_native_id_sha256(native_ids: np.ndarray) -> str:
    ordered = np.sort(np.asarray(native_ids, dtype="<u4"))
    return hashlib.sha256(ordered.tobytes()).hexdigest()


def mass_capture_receipt(
    native_ids: np.ndarray,
    scores: np.ndarray,
    labels: np.ndarray,
    fraction: float,
    direction: str,
) -> dict[str, Any]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    values = np.asarray(scores, dtype=np.float64)
    mass = np.asarray(labels, dtype=np.float64)
    require(ids.ndim == values.ndim == mass.ndim == 1, "mass capture inputs must be one-dimensional")
    require(ids.size == values.size, "screening score rows drifted")
    require(ids.size == mass.size, "screening label rows drifted")
    require(np.all(np.isfinite(values)), "screening scores must be finite")
    require(np.all(np.isfinite(mass)) and np.all(mass >= 0.0), "screening labels must be finite and nonnegative")
    require(math.isfinite(fraction) and 0.0 < fraction <= 1.0, "screening fraction must be in (0,1]")
    total_mass = float(np.sum(mass, dtype=np.float64))
    require(total_mass > 0.0, "screening label mass is blank")
    count = min(ids.size, max(1, int(math.ceil(ids.size * fraction))))
    selected = stable_ranked_indices(ids, values, count, direction)
    captured_mass = float(np.sum(mass[selected], dtype=np.float64))
    effective_fraction = count / ids.size
    captured_fraction = captured_mass / total_mass
    boundary_score = float(values[selected[-1]])
    boundary_ties = values == boundary_score
    boundary_tie_population = int(np.count_nonzero(boundary_ties))
    boundary_tie_selected_count = int(np.count_nonzero(boundary_ties[selected]))
    return {
        "direction": direction,
        "requestedFraction": float(fraction),
        "effectiveFraction": effective_fraction,
        "selectedCount": count,
        "sourceCount": int(ids.size),
        "capturedMass": captured_mass,
        "totalMass": total_mass,
        "capturedMassFraction": captured_fraction,
        "liftOverUniform": captured_fraction / effective_fraction,
        "selectedScoreMinimum": float(np.min(values[selected])),
        "selectedScoreMaximum": float(np.max(values[selected])),
        "selectedScoreDistinctCount": int(np.unique(values[selected]).size),
        "boundaryScore": boundary_score,
        "boundaryTiePopulation": boundary_tie_population,
        "boundaryTieSelectedCount": boundary_tie_selected_count,
        "selectionBoundaryFullyResolved": boundary_tie_population == boundary_tie_selected_count,
        "selectedNativeCellIndexSha256": selected_native_id_sha256(ids[selected]),
    }


def smoothstep(low: float, high: float, values: np.ndarray) -> np.ndarray:
    t = np.clip((np.asarray(values, dtype=np.float32) - low) / (high - low), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def validate_source_contract(
    source_registry_path: Path,
    attribution_manifest_path: Path,
    attribution_reduced_path: Path,
) -> dict[str, Any]:
    registry = load_json(source_registry_path, "source registry")
    require(registry.get("schema") == EXPECTED_REGISTRY_SCHEMA, "source registry schema drifted")
    require(registry.get("status") == "complete", "source registry is not complete")
    require(registry.get("rowCount") == EXPECTED_ROW_COUNT, "source registry row count drifted")
    require(registry.get("grid") == EXPECTED_GRID and registry.get("simStepCount") == EXPECTED_STEP, "source registry state identity drifted")
    validate_effective_route(registry.get("route") or {})
    validate_execution_receipt(registry.get("execution") or {}, "source registry")

    native_descriptor = registry.get("nativeCellIndex") or {}
    native_path = validate_artifact_descriptor(native_descriptor, "source native-cell identities")
    require(native_descriptor.get("shape") == [EXPECTED_ROW_COUNT], "source native-cell shape drifted")
    require(native_descriptor.get("sha256") == registry.get("nativeCellIndexSha256"), "source native-cell hash authority drifted")

    families = registry.get("featureFamilies") or {}
    descriptor_family = families.get("descriptors") or {}
    coefficient_family = families.get("coefficients") or {}
    descriptor_path = validate_artifact_descriptor(descriptor_family.get("artifact") or {}, "source descriptors")
    coefficient_path = validate_artifact_descriptor(coefficient_family.get("artifact") or {}, "source coefficients")
    descriptor_order = descriptor_family.get("order")
    coefficient_order = coefficient_family.get("order")
    require(isinstance(descriptor_order, list) and len(descriptor_order) == 100, "source descriptor order drifted")
    coefficient_order = validate_coefficient_order(coefficient_order)

    attribution = load_json(attribution_manifest_path, "attribution manifest")
    require(attribution.get("schema") == EXPECTED_ATTRIBUTION_SCHEMA, "attribution manifest schema drifted")
    require(attribution.get("status") == "complete", "attribution manifest is not complete")
    validate_execution_receipt(attribution.get("execution") or {}, "attribution", require_uncached=True)
    attr_boundary = attribution.get("claimBoundary") or {}
    require(attr_boundary.get("projectionRelevanceOnly") is True, "attribution hid its projection-only authority")
    require(attr_boundary.get("featureSelectionPerformed") is False, "attribution source already selected features")
    attr_source = attribution.get("source") or {}
    attr_registry = attr_source.get("registry") or {}
    require(Path(str(attr_registry.get("path", ""))).resolve() == source_registry_path.resolve(), "attribution source registry path drifted")
    require(attr_registry.get("sha256") == sha256_file(source_registry_path), "attribution source registry hash drifted")
    require(attr_registry.get("identity") == registry.get("identity"), "attribution source registry identity drifted")
    require(attr_source.get("sameStateCaptureId") == registry.get("sameStateCaptureId"), "attribution same-state identity drifted")
    require(attr_source.get("sourceHashes") == registry.get("sourceHashes"), "attribution exact source hashes drifted")

    reduced_descriptor = ((attribution.get("artifacts") or {}).get("reduced") or {})
    reduced_path = validate_artifact_descriptor(reduced_descriptor, "reduced attribution")
    require(reduced_path == attribution_reduced_path.resolve(), "caller attribution-reduced path differs from the authenticated artifact")
    require(reduced_descriptor.get("shape") == [EXPECTED_ROW_COUNT, len(EXPECTED_REDUCED_ORDER)], "reduced attribution shape drifted")
    reduced_order = tuple((attribution.get("attribution") or {}).get("reducedOrder") or ())
    require(reduced_order == EXPECTED_REDUCED_ORDER, "reduced attribution order drifted")
    attr_native_descriptor = ((attribution.get("artifacts") or {}).get("nativeCellIndex") or {})
    attr_native_path = validate_artifact_descriptor(attr_native_descriptor, "attribution native-cell identities")
    require(attr_native_descriptor.get("sha256") == native_descriptor.get("sha256"), "attribution/source native-cell hash drifted")

    training_descriptor = attr_source.get("trainingManifest") or {}
    training_path = Path(str(training_descriptor.get("path", ""))).resolve()
    require(training_path.is_file(), "training manifest is missing")
    require(sha256_file(training_path) == training_descriptor.get("sha256"), "training manifest sha256 drifted")
    training = load_json(training_path, "training manifest")
    require(training.get("status") == "complete", "training manifest is not complete")
    states = training.get("states") or []
    matches = [state for state in states if (state or {}).get("sameStateCaptureId") == registry.get("sameStateCaptureId")]
    require(len(matches) == 1, "training manifest does not contain exactly one matching source state")
    state = matches[0]
    require((state.get("rows") or {}).get("count") == EXPECTED_ROW_COUNT, "training state row count drifted")
    replay = state.get("replay") or {}
    require(replay.get("grid") == EXPECTED_GRID and replay.get("completedSteps") == EXPECTED_STEP, "training state replay identity drifted")
    require(replay.get("fluidSha256") == (registry.get("sourceHashes") or {}).get("fluidSha256"), "training/source fluid hash drifted")
    require(replay.get("frontSha256") == (registry.get("sourceHashes") or {}).get("frontSha256"), "training/source front hash drifted")
    rows = state.get("rows") or {}
    feature_path = validate_artifact_descriptor(rows.get("features") or {}, "state features")
    training_descriptor_path = validate_artifact_descriptor(rows.get("kernelDescriptors") or {}, "training descriptors")
    training_coefficient_path = validate_artifact_descriptor(rows.get("coefficients") or {}, "training coefficients")
    training_native_path = validate_artifact_descriptor(rows.get("nativeCellIndices") or {}, "training native-cell identities")
    require((rows.get("features") or {}).get("shape") == [EXPECTED_ROW_COUNT, len(EXPECTED_STATE_FEATURE_ORDER)], "state feature shape drifted")
    require(training_descriptor_path == descriptor_path and training_coefficient_path == coefficient_path, "registry/training feature payload paths drifted")
    require((rows.get("kernelDescriptors") or {}).get("sha256") == (descriptor_family.get("artifact") or {}).get("sha256"), "registry/training descriptor hash drifted")
    require((rows.get("coefficients") or {}).get("sha256") == (coefficient_family.get("artifact") or {}).get("sha256"), "registry/training coefficient hash drifted")

    native_ids = np.memmap(native_path, dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    attr_native_ids = np.memmap(attr_native_path, dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    training_native_ids = np.memmap(training_native_path, dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
    require(np.array_equal(native_ids, attr_native_ids), "attribution native-cell row order drifted")
    require(np.array_equal(native_ids, training_native_ids), "training native-cell row order drifted")
    require(np.unique(native_ids).size == EXPECTED_ROW_COUNT, "source native-cell identities contain duplicates")

    return {
        "registry": registry,
        "attribution": attribution,
        "training": training,
        "paths": {
            "nativeIds": native_path,
            "features": feature_path,
            "descriptors": descriptor_path,
            "coefficients": coefficient_path,
            "reduced": reduced_path,
        },
        "orders": {
            "unscoredStateFeatureOrderAssumption": list(EXPECTED_STATE_FEATURE_ORDER),
            "descriptors": descriptor_order,
            "coefficients": list(coefficient_order),
            "reduced": list(EXPECTED_REDUCED_ORDER),
        },
    }


def build_signals(
    features: np.ndarray,
    descriptors: np.ndarray,
    coefficients: np.ndarray,
    descriptor_order: list[str],
) -> tuple[dict[str, np.ndarray], dict[str, np.ndarray]]:
    require(features.shape == (EXPECTED_ROW_COUNT, len(EXPECTED_STATE_FEATURE_ORDER)), "state feature matrix shape drifted")
    require(descriptors.shape == (EXPECTED_ROW_COUNT, len(descriptor_order)), "descriptor matrix shape drifted")
    require(coefficients.shape == (EXPECTED_ROW_COUNT, 8), "coefficient matrix shape drifted")
    require(np.all(np.isfinite(features)), "state feature matrix contains nonfinite values")
    require(np.all(np.isfinite(descriptors)), "descriptor matrix contains nonfinite values")
    require(np.all(np.isfinite(coefficients)) and np.all(coefficients >= 0.0), "coefficient matrix is invalid")

    state_signals: dict[str, np.ndarray] = {}
    descriptor_index = {name: index for index, name in enumerate(descriptor_order)}
    scalar_descriptors = (
        "kernel.normalizedMass", "kernel.radiusWorld", "kernel.coherence",
        "flow.coherence", "flow.curlMagnitude", "flow.divergence", "flow.curlActivity",
        "majorant.density", "majorant.fire", "majorant.extinction", "majorant.importance",
    )
    for name in scalar_descriptors:
        require(name in descriptor_index, f"required descriptor is missing: {name}")
        state_signals[f"descriptor.{name}"] = np.asarray(descriptors[:, descriptor_index[name]], dtype=np.float32)
    for family in ("sidecar", "material", "fire", "micro"):
        for channel in ("x", "y", "z", "w"):
            value_name = f"value.{family}.{channel}"
            require(value_name in descriptor_index, f"required descriptor is missing: {value_name}")
            state_signals[f"descriptor.{value_name}"] = np.asarray(descriptors[:, descriptor_index[value_name]], dtype=np.float32)
            gradient_names = [f"gradient.{family}.{channel}.{axis}" for axis in ("x", "y", "z")]
            require(all(name in descriptor_index for name in gradient_names), f"required gradient descriptor is missing: {family}.{channel}")
            gradient = np.stack([descriptors[:, descriptor_index[name]] for name in gradient_names], axis=1)
            state_signals[f"descriptor.gradientMagnitude.{family}.{channel}"] = np.linalg.norm(gradient, axis=1).astype(np.float32)

    luma = np.asarray((0.2126, 0.7152, 0.0722), dtype=np.float32)
    ridge_emission = np.asarray(coefficients[:, 0:3] @ luma, dtype=np.float32)
    nonridge_emission = np.asarray(coefficients[:, 4:7] @ luma, dtype=np.float32)
    total_emission = ridge_emission + nonridge_emission
    total_extinction = np.asarray(coefficients[:, 3] + coefficients[:, 7], dtype=np.float32)
    oracle_signals = {
        "oracle.ridgeEmissionLuma": ridge_emission,
        "oracle.nonRidgeEmissionLuma": nonridge_emission,
        "oracle.totalEmissionLuma": total_emission,
        "oracle.ridgeExtinction": np.asarray(coefficients[:, 3], dtype=np.float32),
        "oracle.nonRidgeExtinction": np.asarray(coefficients[:, 7], dtype=np.float32),
        "oracle.totalExtinction": total_extinction,
        "oracle.emissionOverOnePlusExtinction": (total_emission / (1.0 + total_extinction)).astype(np.float32),
    }
    return state_signals, oracle_signals


def screen_signals(
    native_ids: np.ndarray,
    signals: dict[str, np.ndarray],
    labels: dict[str, np.ndarray],
    fractions: tuple[float, ...],
    family: str,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for signal_name, signal in signals.items():
        for direction in ("high", "low"):
            for label_name, label in labels.items():
                for fraction in fractions:
                    rows.append({
                        "signalFamily": family,
                        "signal": signal_name,
                        "label": label_name,
                        **mass_capture_receipt(native_ids, signal, label, fraction, direction),
                    })
    return rows


def parse_fractions(value: str) -> tuple[float, ...]:
    try:
        fractions = tuple(float(item.strip()) for item in value.split(",") if item.strip())
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"fractions must be comma-separated numbers: {error}") from error
    if not fractions or any(not math.isfinite(item) or item <= 0.0 or item > 1.0 for item in fractions):
        raise argparse.ArgumentTypeError("fractions must be in (0,1]")
    if len(set(fractions)) != len(fractions):
        raise argparse.ArgumentTypeError("fractions must be unique")
    return fractions


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-registry", type=Path, required=True)
    parser.add_argument("--attribution-manifest", type=Path, required=True)
    parser.add_argument("--attribution-reduced", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--fractions", type=parse_fractions, default=(0.01, 0.05))
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    report_path = args.report.resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    phase = "source-registry-validation"
    requested = {
        "sourceRegistry": str(args.source_registry.resolve()),
        "attributionManifest": str(args.attribution_manifest.resolve()),
        "attributionReduced": str(args.attribution_reduced.resolve()),
        "report": str(report_path),
        "fractions": list(args.fractions),
    }
    try:
        contract = validate_source_contract(
            args.source_registry.resolve(),
            args.attribution_manifest.resolve(),
            args.attribution_reduced.resolve(),
        )
        phase = "artifact-load"
        paths = contract["paths"]
        native_ids = np.memmap(paths["nativeIds"], dtype="<u4", mode="r", shape=(EXPECTED_ROW_COUNT,))
        features = np.memmap(paths["features"], dtype="<f4", mode="r", shape=(EXPECTED_ROW_COUNT, len(EXPECTED_STATE_FEATURE_ORDER)))
        descriptors = np.memmap(paths["descriptors"], dtype="<f4", mode="r", shape=(EXPECTED_ROW_COUNT, 100))
        coefficients = np.memmap(paths["coefficients"], dtype="<f4", mode="r", shape=(EXPECTED_ROW_COUNT, 8))
        reduced = np.memmap(paths["reduced"], dtype="<f4", mode="r", shape=(EXPECTED_ROW_COUNT, len(EXPECTED_REDUCED_ORDER)))
        require(np.all(np.isfinite(reduced)) and np.all(reduced >= 0.0), "reduced attribution is invalid")
        reduced_index = {name: index for index, name in enumerate(EXPECTED_REDUCED_ORDER)}
        labels = {name: np.asarray(reduced[:, reduced_index[name]], dtype=np.float32) for name in LABEL_NAMES}
        require(all(float(np.sum(label, dtype=np.float64)) > 0.0 for label in labels.values()), "one or more screening labels are blank")

        phase = "signal-construction"
        state_signals, oracle_signals = build_signals(
            features,
            descriptors,
            coefficients,
            contract["orders"]["descriptors"],
        )
        oracle_signals["oracle.localOpticalWeight"] = np.asarray(reduced[:, reduced_index["localOpticalWeight"]], dtype=np.float32)

        phase = "feature-screening"
        rows = screen_signals(native_ids, state_signals, labels, args.fractions, "state-only")
        rows.extend(screen_signals(native_ids, oracle_signals, labels, args.fractions, "coefficient-derived-oracle-control"))
        require(rows, "feature screening produced no rows")
        best_raw: dict[str, dict[str, dict[str, Any]]] = {}
        best_discriminating: dict[str, dict[str, dict[str, Any] | None]] = {}
        for family in ("state-only", "coefficient-derived-oracle-control"):
            best_raw[family] = {}
            best_discriminating[family] = {}
            for label_name in LABEL_NAMES:
                candidates = [
                    row for row in rows
                    if row["signalFamily"] == family
                    and row["label"] == label_name
                    and abs(row["requestedFraction"] - 0.05) <= 1e-12
                ]
                winner = max(candidates, key=lambda row: (row["capturedMassFraction"], row["liftOverUniform"], row["signal"], row["direction"]))
                discriminating = [row for row in candidates if row["selectionBoundaryFullyResolved"]]
                best_raw[family][label_name] = winner
                best_discriminating[family][label_name] = (
                    max(discriminating, key=lambda row: (row["capturedMassFraction"], row["liftOverUniform"], row["signal"], row["direction"]))
                    if discriminating
                    else None
                )

        phase = "report-publication"
        registry = contract["registry"]
        attribution = contract["attribution"]
        report = {
            "schema": REPORT_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "requested": requested,
            "effective": {
                "route": registry["route"],
                "sameStateCaptureId": registry["sameStateCaptureId"],
                "grid": registry["grid"],
                "simStepCount": registry["simStepCount"],
                "rowCount": registry["rowCount"],
                "fractions": list(args.fractions),
                "ranking": "score-primary-native-cell-index-tie-break-v0",
                "budgetRounding": "ceil-source-population-times-requested-fraction-v0",
            },
            "source": {
                "registry": {
                    "path": str(args.source_registry.resolve()),
                    "sha256": sha256_file(args.source_registry.resolve()),
                    "identity": registry["identity"],
                },
                "attributionManifest": {
                    "path": str(args.attribution_manifest.resolve()),
                    "sha256": sha256_file(args.attribution_manifest.resolve()),
                    "identity": attribution["identity"],
                },
                "attributionReduced": {
                    "path": str(paths["reduced"]),
                    "sha256": sha256_file(paths["reduced"]),
                },
                "nativeCellIndexSha256": registry["nativeCellIndexSha256"],
                "sourceHashes": registry["sourceHashes"],
            },
            "orders": contract["orders"],
            "signalCounts": {
                "stateOnly": len(state_signals),
                "coefficientDerivedOracleControls": len(oracle_signals),
                "screeningRows": len(rows),
            },
            "bestRawAtFivePercent": best_raw,
            "bestBudgetDiscriminatingAtFivePercent": best_discriminating,
            "screening": rows,
            "interpretationContract": {
                "peakImportance": "target-positive-overlap-times-pre-bin-transmittance-times-local-optical-weight",
                "peakResidualOverlap": "target-positive-geometric-footprint-overlap-without-local-optical-weight",
                "preBinTransmittance": "camera-dependent-column-visibility-control-not-a-local-target",
                "wispImportance": "target-gradient-underfit-times-pre-bin-transmittance-times-local-optical-weight",
                "positiveStateOnlyPeakOverlapMeaning": "intrinsic simulator state nominates peak-capable geometry",
                "positiveVisibilityMeaning": "not expected; would require separate scrutiny for camera leakage",
            },
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({
            "status": "complete",
            "report": str(report_path),
            "bestRawAtFivePercent": best_raw,
            "bestBudgetDiscriminatingAtFivePercent": best_discriminating,
        }, indent=2))
        return 0
    except Exception as error:
        failed = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": phase,
            "requested": requested,
            "error": {
                "type": type(error).__name__,
                "message": str(error),
                "traceback": traceback.format_exc(),
            },
            "lastTrustworthyEvidence": {
                "effectiveRouteRequired": EXPECTED_ROUTE,
                "effectiveBackendRequired": EXPECTED_BACKEND,
                "expectedGrid": EXPECTED_GRID,
                "expectedStep": EXPECTED_STEP,
                "expectedRowCount": EXPECTED_ROW_COUNT,
            },
            "claimBoundary": CLAIM_BOUNDARY,
        }
        report_path.write_text(json.dumps(failed, indent=2, sort_keys=True) + "\n")
        print(f"Grid96 peak-state screening failed at {phase}: {error}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
