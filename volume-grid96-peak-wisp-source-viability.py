#!/usr/bin/env python3
"""Audit the exact Grid96 peak/wisp source registry without copying its payloads."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


VIABILITY_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-viability.v0"
REPORT_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-viability-report.v0"
REGISTRY_SCHEMA = "kaminos.volume.grid96-peak-wisp-source-registry.v0"
EXACT_PARENT_COUNT = 370194
GRID = 96
PRIMARY_OUTPUT_NAMES = ("grid96-peak-wisp-source-viability.json", "report.json")
CHUNK_ROWS = 65536

_registry_spec = importlib.util.spec_from_file_location(
    "grid96_peak_wisp_registry_contract",
    Path(__file__).with_name("volume-grid96-peak-wisp-source-registry.py"),
)
if _registry_spec is None or _registry_spec.loader is None:
    raise RuntimeError("could not load the Grid96 source registry contract")
_registry_contract = importlib.util.module_from_spec(_registry_spec)
_registry_spec.loader.exec_module(_registry_contract)

FAMILY_ORDERS = {
    "descriptors": tuple(_registry_contract.DESCRIPTOR_ORDER),
    "coefficients": tuple(_registry_contract.COEFFICIENT_ORDER),
    "transverseBasis": tuple(_registry_contract.TRANSVERSE_ORDER),
    "materialBasis": tuple(_registry_contract.MATERIAL_ORDER),
    "cohortContinuity": tuple(_registry_contract.CONTINUITY_ORDER),
}
CLAIM_BOUNDARY = {
    "sourceViabilityOnly": True,
    "attributionAttached": False,
    "featureSelectionPerformed": False,
    "normalizationChosen": False,
    "samplingPolicyChosen": False,
    "learnerStarted": False,
    "placementChosen": False,
    "depositionAdjudicated": False,
    "rendererClaimMade": False,
    "productClaimMade": False,
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def artifact_path(registry_path: Path, receipt: dict[str, Any]) -> Path:
    path = Path(receipt.get("path", ""))
    return path if path.is_absolute() else (registry_path.parent / path).resolve()


def prepare_output(output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    for name in PRIMARY_OUTPUT_NAMES:
        path = output_dir / name
        if path.is_file() or path.is_symlink():
            path.unlink()
        elif path.exists():
            raise ValueError(f"owned output path is not a file: {path}")


def prepare_failure_report(output_dir: Path) -> Path:
    """Make only the failure report writable; never repeat failed primary cleanup."""
    output_dir.mkdir(parents=True, exist_ok=True)
    viability_path = output_dir / PRIMARY_OUTPUT_NAMES[0]
    if viability_path.is_file() or viability_path.is_symlink():
        viability_path.unlink()
    report_path = output_dir / "report.json"
    if report_path.is_file() or report_path.is_symlink():
        report_path.unlink()
    elif report_path.exists():
        raise ValueError(f"failure report path is not writable as a file: {report_path}")
    return report_path


def validate_route(route: Any) -> dict[str, Any]:
    require(isinstance(route, dict), "registry route receipt is missing")
    require(isinstance(route.get("requested"), str) and route["requested"], "requested route is missing")
    require(route.get("effective") == "native-3d-compute-fluid-raymarch-v0", "effective route is not exact native Grid96")
    require(route.get("backend") == "WebGPU:apple", "backend is not the exact WebGPU backend")
    require(route.get("fallbackReason") is None, "registry used a fallback route")
    return {key: route.get(key) for key in ("requested", "effective", "backend", "fallbackReason")}


def validate_execution(registry: dict[str, Any], row_count: int) -> dict[str, Any]:
    execution = registry.get("execution")
    require(isinstance(execution, dict), "registry execution receipt is missing")
    expected = {
        "rowCount": row_count,
        "sampleCap": None,
        "droppedRowCount": 0,
        "fallbackRowCount": 0,
        "copiedPayloadBytes": 0,
    }
    require({key: execution.get(key) for key in expected} == expected, "registry execution is capped, partial, copied, or fallback-backed")
    return expected


def validate_receipt(
    registry_path: Path,
    receipt: Any,
    *,
    dtype: str,
    shape: list[int],
    label: str,
) -> tuple[dict[str, Any], Path]:
    require(isinstance(receipt, dict), f"{label} receipt is missing")
    require(receipt.get("dtype") == dtype, f"{label} dtype drifted")
    require(receipt.get("shape") == shape, f"{label} shape drifted")
    require(isinstance(receipt.get("semanticRole"), str) and receipt["semanticRole"], f"{label} semantic role is missing")
    path = artifact_path(registry_path, receipt)
    require(path.is_file(), f"{label} payload is missing: {path}")
    require(path.stat().st_size == receipt.get("bytes"), f"{label} byte count drifted")
    require(is_sha256(receipt.get("sha256")), f"{label} SHA-256 is invalid")
    require(sha256_file(path) == receipt["sha256"], f"{label} SHA-256 drifted")
    return {
        "path": str(path),
        "bytes": receipt["bytes"],
        "sha256": receipt["sha256"],
        "dtype": dtype,
        "shape": shape,
        "semanticRole": receipt["semanticRole"],
    }, path


def validate_registry(path: Path, expected_sha: str) -> tuple[dict[str, Any], dict[str, Any]]:
    require(path.is_file(), f"registry is missing: {path}")
    require(is_sha256(expected_sha), "expected registry SHA-256 is invalid")
    actual_sha = sha256_file(path)
    require(actual_sha == expected_sha, "registry SHA-256 drifted")
    registry = json.loads(path.read_text())
    require(registry.get("schema") == REGISTRY_SCHEMA, "registry schema drifted")
    require(registry.get("status") == "complete", "registry is not complete")
    require(registry.get("failurePhase") is None, "registry carries a failure phase")
    require(registry.get("grid") == GRID, "registry is not native Grid96")
    require(registry.get("rowCount") == EXACT_PARENT_COUNT, f"registry must retain all {EXACT_PARENT_COUNT} exact parents")
    require(isinstance(registry.get("identity"), str) and registry["identity"].startswith("sha256:") and is_sha256(registry["identity"][7:]), "registry identity is invalid")
    require(isinstance(registry.get("sameStateCaptureId"), str) and registry["sameStateCaptureId"], "state identity is missing")
    require(isinstance(registry.get("simStepCount"), int) and registry["simStepCount"] > 0, "sim step is invalid")
    require(is_sha256(registry.get("nativeCellIndexSha256")), "native parent identity is invalid")
    require(is_sha256(registry.get("componentSourceManifestSha256")), "component source identity is invalid")
    source_hashes = registry.get("sourceHashes")
    require(
        isinstance(source_hashes, dict)
        and set(source_hashes) == set(_registry_contract.SOURCE_HASH_FIELDS)
        and all(is_sha256(source_hashes.get(field)) for field in _registry_contract.SOURCE_HASH_FIELDS),
        "registry source payload identity drifted",
    )
    route = validate_route(registry.get("route"))
    execution = validate_execution(registry, EXACT_PARENT_COUNT)
    claim = registry.get("claimBoundary")
    require(isinstance(claim, dict), "registry claim boundary is missing")
    for key in ("attributionAttached", "featureSelectionPerformed", "learnerStarted", "placementChosen", "depositionAdjudicated", "rendererClaimMade", "productClaimMade"):
        require(claim.get(key) is False, f"registry crossed the source-only boundary via {key}")
    require(claim.get("sourceRegistryOnly") is True, "registry is not source-only")
    return registry, {"sha256": actual_sha, "route": route, "execution": execution}


def memmap_receipt(path: Path, dtype: str, shape: list[int]) -> np.memmap:
    numpy_dtype = {"float32-le": "<f4", "uint32-le": "<u4", "uint8": "u1"}[dtype]
    return np.memmap(path, dtype=numpy_dtype, mode="r", shape=tuple(shape))


def column_statistics(values: np.memmap, order: tuple[str, ...], label: str) -> list[dict[str, Any]]:
    row_count, column_count = values.shape
    minima = np.full(column_count, np.inf, dtype=np.float64)
    maxima = np.full(column_count, -np.inf, dtype=np.float64)
    sums = np.zeros(column_count, dtype=np.float64)
    sum_squares = np.zeros(column_count, dtype=np.float64)
    zero_counts = np.zeros(column_count, dtype=np.int64)
    nonfinite_counts = np.zeros(column_count, dtype=np.int64)
    for start in range(0, row_count, CHUNK_ROWS):
        chunk = np.asarray(values[start : start + CHUNK_ROWS], dtype=np.float64)
        finite = np.isfinite(chunk)
        nonfinite_counts += np.count_nonzero(~finite, axis=0)
        if not np.all(finite):
            columns = [order[index] for index in np.flatnonzero(np.any(~finite, axis=0))]
            raise ValueError(f"{label} contains nonfinite values in {columns}")
        minima = np.minimum(minima, np.min(chunk, axis=0))
        maxima = np.maximum(maxima, np.max(chunk, axis=0))
        sums += np.sum(chunk, axis=0, dtype=np.float64)
        sum_squares += np.sum(chunk * chunk, axis=0, dtype=np.float64)
        zero_counts += np.count_nonzero(chunk == 0.0, axis=0)
    means = sums / row_count
    variances = np.maximum(0.0, sum_squares / row_count - means * means)
    return [
        {
            "index": index,
            "name": order[index],
            "finiteCount": int(row_count - nonfinite_counts[index]),
            "nonfiniteCount": int(nonfinite_counts[index]),
            "minimum": float(minima[index]),
            "maximum": float(maxima[index]),
            "mean": float(means[index]),
            "standardDeviation": float(math.sqrt(variances[index])),
            "zeroFraction": float(zero_counts[index] / row_count),
            "constant": bool(minima[index] == maxima[index]),
        }
        for index in range(column_count)
    ]


def require_float_integer_column(values: np.memmap, column: int, minimum: int, maximum: int, label: str) -> None:
    for start in range(0, values.shape[0], CHUNK_ROWS):
        chunk = np.asarray(values[start : start + CHUNK_ROWS, column], dtype=np.float64)
        require(np.all(np.isfinite(chunk)), f"{label} contains nonfinite values")
        require(np.all(chunk == np.floor(chunk)), f"{label} contains non-integral values")
        require(np.all((chunk >= minimum) & (chunk <= maximum)), f"{label} is outside [{minimum}, {maximum}]")


def require_exact_columns(left: np.memmap, left_columns: slice | int, right: np.memmap, right_columns: slice | int, label: str) -> None:
    for start in range(0, left.shape[0], CHUNK_ROWS):
        stop = start + CHUNK_ROWS
        lhs_rows = left[start:stop]
        right_rows = right[start:stop]
        lhs = np.asarray(lhs_rows if left.ndim == 1 else lhs_rows[:, left_columns])
        rhs = np.asarray(right_rows if right.ndim == 1 else right_rows[:, right_columns])
        require(np.array_equal(lhs, rhs), f"{label} row alignment drifted")


def reason_distribution(values: np.memmap, maximum: int, label: str) -> dict[str, int]:
    counts = np.bincount(np.asarray(values), minlength=maximum + 1)
    require(len(counts) <= maximum + 1, f"{label} contains an unknown reason code")
    return {str(index): int(count) for index, count in enumerate(counts) if count}


def characterize(
    registry_path: Path,
    expected_sha: str,
    validated_registry: tuple[dict[str, Any], dict[str, Any]] | None = None,
) -> dict[str, Any]:
    registry, validated = validated_registry or validate_registry(registry_path, expected_sha)
    row_count = EXACT_PARENT_COUNT
    families = registry.get("featureFamilies")
    require(isinstance(families, dict) and set(families) == set(FAMILY_ORDERS), "feature family registry drifted")

    native_receipt, native_path = validate_receipt(
        registry_path,
        registry.get("nativeCellIndex"),
        dtype="uint32-le",
        shape=[row_count],
        label="native cell index",
    )
    require(native_receipt["sha256"] == registry.get("nativeCellIndexSha256"), "native cell index identity drifted")
    native = memmap_receipt(native_path, "uint32-le", [row_count])
    native_array = np.asarray(native)
    require(np.all(native_array < GRID**3), "native cell index is outside Grid96")
    require(np.unique(native_array).size == row_count, "native cell index contains duplicate parents")

    arrays: dict[str, np.memmap] = {}
    family_results: dict[str, Any] = {}
    receipts: dict[str, Any] = {"nativeCellIndex": native_receipt}
    reason_receipts: dict[str, tuple[dict[str, Any], np.memmap]] = {}
    edge_receipt: dict[str, Any] | None = None
    edges: np.memmap | None = None
    for family_name, order in FAMILY_ORDERS.items():
        family = families[family_name]
        require(isinstance(family, dict), f"{family_name} registry entry is missing")
        require(family.get("order") == list(order), f"{family_name} semantic order drifted")
        receipt, path = validate_receipt(
            registry_path,
            family.get("artifact"),
            dtype="float32-le",
            shape=[row_count, len(order)],
            label=family_name,
        )
        arrays[family_name] = memmap_receipt(path, "float32-le", [row_count, len(order)])
        receipts[family_name] = receipt
        family_results[family_name] = {"artifact": receipt, "order": list(order), "columns": column_statistics(arrays[family_name], order, family_name)}
        if family_name in ("transverseBasis", "materialBasis"):
            reason_receipt, reason_path = validate_receipt(
                registry_path,
                family.get("reasonCodes"),
                dtype="uint8",
                shape=[row_count],
                label=f"{family_name} reason codes",
            )
            reason_receipts[family_name] = (reason_receipt, memmap_receipt(reason_path, "uint8", [row_count]))
        elif family_name == "cohortContinuity":
            edge_shape = family.get("edges", {}).get("shape") if isinstance(family.get("edges"), dict) else None
            require(isinstance(edge_shape, list) and len(edge_shape) == 2 and edge_shape[1] == 3 and isinstance(edge_shape[0], int) and edge_shape[0] > 0, "continuity edge shape drifted")
            edge_receipt, edge_path = validate_receipt(
                registry_path,
                family.get("edges"),
                dtype="uint32-le",
                shape=edge_shape,
                label="cohort continuity edges",
            )
            edges = memmap_receipt(edge_path, "uint32-le", edge_shape)
        else:
            require(family.get("reasonCodes") is None, f"{family_name} unexpectedly carries reason codes")

    descriptor = arrays["descriptors"]
    require_exact_columns(descriptor, 3, native, slice(None), "descriptor native cell index")
    require_exact_columns(arrays["transverseBasis"], slice(0, 3), descriptor, slice(0, 3), "transverse centers")
    require_exact_columns(arrays["materialBasis"], slice(0, 3), descriptor, slice(0, 3), "material centers")
    require(np.all(np.asarray(arrays["coefficients"]) >= 0.0), "coefficients violate their nonnegative contract")

    continuity = arrays["cohortContinuity"]
    require_float_integer_column(continuity, 0, 0, 2, "continuity cohort code")
    require_float_integer_column(continuity, 2, 0, 6, "continuity face-neighbor count")
    require_float_integer_column(continuity, 12, 0, 1, "continuity validity")
    assert edges is not None and edge_receipt is not None
    for start in range(0, edges.shape[0], CHUNK_ROWS):
        chunk = np.asarray(edges[start : start + CHUNK_ROWS])
        require(np.all(chunk[:, :2] < row_count), "continuity edge references an unknown parent row")
        require(np.all(chunk[:, 2] < 3), "continuity edge axis is invalid")

    reason_distributions = {
        "transverseBasis": reason_distribution(reason_receipts["transverseBasis"][1], 4, "transverse reason codes"),
        "materialBasis": reason_distribution(reason_receipts["materialBasis"][1], 5, "material reason codes"),
    }
    for family_name, (receipt, _) in reason_receipts.items():
        family_results[family_name]["reasonCodes"] = receipt
    family_results["cohortContinuity"]["edges"] = edge_receipt

    payload: dict[str, Any] = {
        "schema": VIABILITY_SCHEMA,
        "status": "complete",
        "grid": GRID,
        "rowCount": row_count,
        "registry": {"path": str(registry_path), "sha256": validated["sha256"], "identity": registry.get("identity")},
        "registrySha256": validated["sha256"],
        "sameStateCaptureId": registry["sameStateCaptureId"],
        "simStepCount": registry["simStepCount"],
        "route": validated["route"],
        "sourceHashes": registry.get("sourceHashes"),
        "rowAlignment": {
            "descriptorNativeCellIndexExact": True,
            "transverseCentersExact": True,
            "materialCentersExact": True,
        },
        "families": family_results,
        "reasonCodeDistributions": reason_distributions,
        "execution": validated["execution"],
        "claimBoundary": CLAIM_BOUNDARY,
    }
    payload["identity"] = "sha256:" + canonical_sha256(payload)
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", required=True)
    parser.add_argument("--registry-sha256", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    started = time.time()
    output_dir = Path(args.output_dir).resolve()
    failure_phase = "registry-validation"
    last_trustworthy: dict[str, Any] = {
        "registry": str(Path(args.registry).resolve()),
        "expectedRegistrySha256": args.registry_sha256,
    }
    try:
        registry_path = Path(args.registry).resolve()
        if registry_path.is_file():
            last_trustworthy["actualRegistrySha256"] = sha256_file(registry_path)
        prepare_output(output_dir)
        validated_registry = validate_registry(registry_path, args.registry_sha256)
        last_trustworthy["registryValidated"] = True
        failure_phase = "source-characterization"
        viability = characterize(registry_path, args.registry_sha256, validated_registry)
        viability_path = output_dir / PRIMARY_OUTPUT_NAMES[0]
        viability_path.write_text(json.dumps(viability, indent=2, sort_keys=True, allow_nan=False) + "\n")
        report = {
            "schema": REPORT_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "startedAtUnix": started,
            "finishedAtUnix": time.time(),
            "requested": last_trustworthy,
            "viability": {
                "path": str(viability_path),
                "sha256": sha256_file(viability_path),
                "identity": viability["identity"],
            },
            "claimBoundary": CLAIM_BOUNDARY,
        }
        (output_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n")
        print(json.dumps(report, indent=2, sort_keys=True))
        return 0
    except Exception as exc:
        try:
            report_path = prepare_failure_report(output_dir)
            failed = {
                "schema": REPORT_SCHEMA,
                "status": "failed",
                "failurePhase": failure_phase,
                "startedAtUnix": started,
                "finishedAtUnix": time.time(),
                "requested": last_trustworthy,
                "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()},
                "claimBoundary": CLAIM_BOUNDARY,
            }
            report_path.write_text(json.dumps(failed, indent=2, sort_keys=True, allow_nan=False) + "\n")
        except Exception:
            traceback.print_exc()
        print(f"grid96 source viability failed during {failure_phase}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
