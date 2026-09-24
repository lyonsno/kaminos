#!/usr/bin/env python3
"""Remap learned layer coefficients onto an exact live-union native-cell order."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

import numpy as np


AUTHORITY = "exact-native-cell-identity-overlay-remap-v0"
OVERLAY_SCHEMA = "kaminos.volume.layer-coefficient-prediction-overlay.v0"
RUNTIME_SCHEMA = "kaminos.volume.layer-coefficient-live-union-overlay.v1"
SELECTOR_AUTHORITY = "explicit-source-field-operator-v0"
SELECTOR_RECIPE_SHA256 = "541836e6c45ef014ab0b8be23ebd8dce9898900a7639a0c4e21f38336daef8f9"
COMPOSITION_IDENTITY = "separate-ridge-nonridge-shared-total-extinction-v0"
LOOKUP_ENCODING = "row-plus-one-zero-missing-v0"
COEFFICIENT_ORDER = [
    "ridge.emission.r", "ridge.emission.g", "ridge.emission.b", "ridge.extinction",
    "nonRidge.emission.r", "nonRidge.emission.g", "nonRidge.emission.b", "nonRidge.extinction",
]
COEFFICIENT_DTYPE = "float32-le"
COEFFICIENT_SEMANTIC_ROLE = "learned-post-admission-layer-emission-extinction-prediction"
EXACT_TRAINING_SCHEMA = "kaminos.volume.layer-coefficient-training-manifest.v0"
EXACT_TRAINING_AUTHORITY = "analytical-ridge-or-nonridge-admission-plus-exact-local-coefficients-v0"
EXACT_COEFFICIENT_AUTHORITY = "exact-local-layer-emission-extinction-v0"
SOURCE_HASH_KEYS = {
    "fluidSha256",
    "frontSha256",
    "boundarySidecarSha256",
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


def canonical_identity(value: dict[str, Any]) -> str:
    payload = dict(value)
    payload.pop("identity", None)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def prediction_overlay_identity(value: dict[str, Any]) -> str:
    payload = dict(value)
    payload.pop("identity", None)
    payload.pop("elapsedSeconds", None)
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def packaging_failure_evidence(overlay_report_path: Path, source_index_path: Path) -> dict[str, Any]:
    evidence: dict[str, Any] = {
        "overlayReportExists": overlay_report_path.is_file(),
        "sourceNativeCellIndicesExists": source_index_path.is_file(),
        "overlayReportSha256": sha256_file(overlay_report_path) if overlay_report_path.is_file() else None,
        "sourceNativeCellIndicesSha256": sha256_file(source_index_path) if source_index_path.is_file() else None,
        "claimedOverlayIdentity": None,
    }
    if overlay_report_path.is_file():
        try:
            candidate = json.loads(overlay_report_path.read_text(encoding="utf-8"))
            evidence["claimedOverlayIdentity"] = candidate.get("identity")
        except Exception:
            pass
    return evidence


def native_cell_permutation(source_ids: np.ndarray, destination_ids: np.ndarray) -> np.ndarray:
    source = np.asarray(source_ids)
    destination = np.asarray(destination_ids)
    require(source.ndim == 1, "source native-cell ids must be one-dimensional")
    require(destination.ndim == 1, "destination native-cell ids must be one-dimensional")
    require(np.issubdtype(source.dtype, np.integer), "source native-cell ids must be integers")
    require(np.issubdtype(destination.dtype, np.integer), "destination native-cell ids must be integers")
    source_order = np.argsort(source, kind="stable")
    destination_order = np.argsort(destination, kind="stable")
    sorted_source = source[source_order]
    sorted_destination = destination[destination_order]
    require(
        sorted_source.size < 2 or not np.any(sorted_source[1:] == sorted_source[:-1]),
        "duplicate-source-native-cell-id",
    )
    require(
        sorted_destination.size < 2 or not np.any(sorted_destination[1:] == sorted_destination[:-1]),
        "duplicate-destination-native-cell-id",
    )
    missing = np.setdiff1d(sorted_source, sorted_destination, assume_unique=True)
    extra = np.setdiff1d(sorted_destination, sorted_source, assume_unique=True)
    require(missing.size == 0, f"missing-destination-native-cell-id:{missing.size}:{missing[:8].tolist()}")
    require(extra.size == 0, f"extra-destination-native-cell-id:{extra.size}:{extra[:8].tolist()}")
    require(source.size == destination.size, "native-cell population sizes differ despite equal sets")
    permutation = np.empty(destination.size, dtype=np.int64)
    permutation[destination_order] = source_order
    return permutation


def remap_coefficients(
    source_ids: np.ndarray,
    destination_ids: np.ndarray,
    coefficients: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    values = np.asarray(coefficients)
    require(values.ndim == 2 and values.shape[1] == 8, "coefficient tensor must have shape [rows,8]")
    require(values.shape[0] == np.asarray(source_ids).size, "coefficient row count differs from source native-cell ids")
    require(np.all(np.isfinite(values)), "nonfinite-coefficient")
    require(float(np.min(values)) >= 0.0, "negative-coefficient")
    permutation = native_cell_permutation(source_ids, destination_ids)
    return np.asarray(values[permutation], dtype=np.float32), permutation


def build_dense_lookup(native_cell_ids: np.ndarray, grid_cell_count: int) -> np.ndarray:
    ids = np.asarray(native_cell_ids)
    require(ids.ndim == 1 and np.issubdtype(ids.dtype, np.integer), "native-cell ids must be a one-dimensional integer tensor")
    require(isinstance(grid_cell_count, int) and grid_cell_count > 0, "grid cell count must be positive")
    if ids.size:
        require(int(np.min(ids)) >= 0 and int(np.max(ids)) < grid_cell_count, "native-cell-id-out-of-range")
    sorted_ids = np.sort(ids, kind="stable")
    require(sorted_ids.size < 2 or not np.any(sorted_ids[1:] == sorted_ids[:-1]), "duplicate-source-native-cell-id")
    require(ids.size < np.iinfo(np.uint32).max, "native-cell row count exceeds row-plus-one lookup encoding")
    lookup = np.zeros(grid_cell_count, dtype="<u4")
    lookup[ids.astype(np.int64)] = np.arange(1, ids.size + 1, dtype=np.uint32)
    return lookup


def artifact_receipt(path: Path, shape: list[int], dtype: str, semantic_role: str) -> dict[str, Any]:
    return {
        "path": str(path),
        "relativePath": path.name,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
        "dtype": dtype,
        "shape": shape,
        "semanticRole": semantic_role,
    }


def package_runtime_overlay(overlay_report_path: Path, source_index_path: Path, output_dir: Path, grid: int) -> dict[str, Any]:
    report = json.loads(overlay_report_path.read_text(encoding="utf-8"))
    require(report.get("schema") == OVERLAY_SCHEMA, "prediction overlay schema drifted")
    require(report.get("status") == "complete" and report.get("failurePhase") is None, "prediction overlay is incomplete")
    require(report.get("authority") == "learned-post-admission-coefficient-prediction-v0", "prediction overlay authority drifted")
    require(report.get("identity") == prediction_overlay_identity(report), "prediction overlay identity differs")
    state = report.get("state") or {}
    coefficient = report.get("coefficientArtifact") or {}
    execution = report.get("execution") or {}
    row_count = state.get("rowCount")
    source_hashes = state.get("sourceHashes")
    require(isinstance(row_count, int) and row_count > 0, "prediction overlay row count is invalid")
    require(isinstance(source_hashes, dict) and set(source_hashes) == SOURCE_HASH_KEYS, "prediction overlay source hashes differ")
    require(
        all(isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value) for value in source_hashes.values()),
        "prediction overlay source hashes differ",
    )
    require(coefficient.get("shape") == [row_count, 8], "prediction coefficient shape drifted")
    require(coefficient.get("dtype") == COEFFICIENT_DTYPE, "prediction coefficient dtype differs")
    require(coefficient.get("semanticRole") == COEFFICIENT_SEMANTIC_ROLE, "prediction coefficient semantic role differs")
    require(coefficient.get("bytes") == row_count * 8 * 4, "prediction coefficient declared byte count differs")
    require(execution.get("sampleCap") is None, "prediction overlay applied a hidden sampleCap")
    require(execution.get("droppedRowCount") == 0, "prediction overlay dropped admitted rows")
    coefficient_path = Path(coefficient.get("path", "")).expanduser().resolve()
    require(coefficient_path.is_file() and coefficient_path.stat().st_size == row_count * 8 * 4, "prediction coefficient artifact is missing or partial")
    require(sha256_file(coefficient_path) == coefficient.get("sha256"), "prediction coefficient artifact sha256 differs")
    require(source_index_path.is_file() and source_index_path.stat().st_size == row_count * 4, "source native-cell index artifact is missing or partial")
    require(sha256_file(source_index_path) == state.get("admissionIndexSha256"), "source native-cell index sha256 differs")
    require(isinstance(grid, int) and grid > 0, "grid must be positive")
    grid_cell_count = grid ** 3
    source_ids = np.memmap(source_index_path, dtype="<u4", mode="r", shape=(row_count,))
    lookup = build_dense_lookup(source_ids, grid_cell_count)
    output_dir.mkdir(parents=True, exist_ok=True)
    coefficient_output = output_dir / "coefficients.f32"
    index_output = output_dir / "native-cell-indices.u32"
    lookup_output = output_dir / "native-cell-row-plus-one.u32"
    for source_path, destination_path in ((coefficient_path, coefficient_output), (source_index_path, index_output)):
        temporary = destination_path.with_name(f".{destination_path.name}.partial")
        shutil.copyfile(source_path, temporary)
        os.replace(temporary, destination_path)
    lookup_temporary = lookup_output.with_name(f".{lookup_output.name}.partial")
    lookup.tofile(lookup_temporary)
    os.replace(lookup_temporary, lookup_output)
    overlay_sha256 = sha256_file(overlay_report_path)
    runtime = {
        "schema": RUNTIME_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": AUTHORITY,
        "selector": {
            "authority": SELECTOR_AUTHORITY,
            "recipeSha256": SELECTOR_RECIPE_SHA256,
            "compositionIdentity": COMPOSITION_IDENTITY,
        },
        "source": {
            "overlayIdentity": report.get("identity"),
            "overlayReportPath": str(overlay_report_path),
            "overlayReportSha256": overlay_sha256,
            "model": report.get("model"),
            "state": state,
        },
        "routing": {
            "grid": grid,
            "gridCellCount": grid_cell_count,
            "admittedRowCount": row_count,
            "lookupEncoding": LOOKUP_ENCODING,
            "missingRowValue": 0,
            "coefficientRowOffset": -1,
            "coefficientOrder": COEFFICIENT_ORDER,
        },
        "artifacts": {
            "coefficients": artifact_receipt(coefficient_output, [row_count, 8], "float32-le", "compact-live-union-layer-coefficients"),
            "nativeCellIndices": artifact_receipt(index_output, [row_count], "uint32-le", "checksum-bound-admitted-native-cell-identities"),
            "denseLookup": artifact_receipt(lookup_output, [grid_cell_count], "uint32-le", "native-cell-to-compact-coefficient-row-plus-one"),
        },
        "execution": {
            "sampleCap": execution.get("sampleCap"),
            "droppedRowCount": execution.get("droppedRowCount"),
            "unmappedAdmittedRowCount": 0,
        },
    }
    runtime["identity"] = canonical_identity(runtime)
    atomic_json(output_dir / "runtime-overlay.json", runtime)
    return runtime


def validate_exact_artifact(artifact: dict[str, Any], *, row_count: int, columns: int | None, role: str) -> Path:
    shape = [row_count] if columns is None else [row_count, columns]
    item_bytes = 4 if columns is None else columns * 4
    dtype = "uint32-le" if columns is None else "float32-le"
    require(artifact.get("shape") == shape, f"exact {'native-cell index' if columns is None else 'coefficient'} shape drifted")
    require(artifact.get("dtype") == dtype, f"exact {'native-cell index' if columns is None else 'coefficient'} dtype drifted")
    require(artifact.get("semanticRole") == role, f"exact {'native-cell index' if columns is None else 'coefficient'} semantic role drifted")
    require(artifact.get("bytes") == row_count * item_bytes, f"exact {'native-cell index' if columns is None else 'coefficient'} byte count drifted")
    path = Path(artifact.get("path", "")).expanduser().resolve()
    require(path.is_file() and path.stat().st_size == artifact.get("bytes"), f"exact {'native-cell index' if columns is None else 'coefficient'} artifact is missing or partial")
    require(sha256_file(path) == artifact.get("sha256"), f"exact {'native-cell index' if columns is None else 'coefficient'} sha256 differs")
    return path


def package_exact_runtime_overlay(training_manifest_path: Path, state_id: str, output_dir: Path, grid: int) -> dict[str, Any]:
    manifest = json.loads(training_manifest_path.read_text(encoding="utf-8"))
    require(manifest.get("schema") == EXACT_TRAINING_SCHEMA, "exact training manifest schema drifted")
    require(manifest.get("status") == "complete" and manifest.get("failurePhase") is None, "exact training manifest is incomplete")
    require(manifest.get("authority") == EXACT_TRAINING_AUTHORITY, "exact training manifest authority drifted")
    states = [state for state in manifest.get("states", []) if state.get("id") == state_id]
    require(len(states) == 1, f"exact state selection differs:{state_id}:{len(states)}")
    state = states[0]
    rows = state.get("rows") or {}
    replay = state.get("replay") or {}
    row_count = rows.get("count")
    require(isinstance(row_count, int) and row_count > 0, "exact row count is invalid")
    require(isinstance(grid, int) and grid > 0, "grid must be positive")
    require(replay.get("grid") == grid, f"exact replay grid differs:{replay.get('grid')}:{grid}")
    coefficient = rows.get("coefficients") or {}
    native_cell = rows.get("nativeCellIndices") or {}
    coefficient_path = validate_exact_artifact(
        coefficient,
        row_count=row_count,
        columns=8,
        role="exact-local-layer-emission-extinction",
    )
    index_path = validate_exact_artifact(
        native_cell,
        row_count=row_count,
        columns=None,
        role="analytical-admission-native-cell-indices",
    )
    source_hashes = (rows.get("kernelDescriptors") or {}).get("sourceHashes")
    require(isinstance(source_hashes, dict) and set(source_hashes) == SOURCE_HASH_KEYS, "exact source hashes differ")
    require(
        all(isinstance(value, str) and len(value) == 64 and all(character in "0123456789abcdef" for character in value) for value in source_hashes.values()),
        "exact source hashes differ",
    )
    coefficients = np.memmap(coefficient_path, dtype="<f4", mode="r", shape=(row_count, 8))
    require(np.all(np.isfinite(coefficients)), "exact coefficient artifact contains nonfinite values")
    require(float(np.min(coefficients)) >= 0.0, "exact coefficient artifact contains negative values")
    source_ids = np.memmap(index_path, dtype="<u4", mode="r", shape=(row_count,))
    grid_cell_count = grid ** 3
    lookup = build_dense_lookup(source_ids, grid_cell_count)
    output_dir.mkdir(parents=True, exist_ok=True)
    coefficient_output = output_dir / "coefficients.f32"
    index_output = output_dir / "native-cell-indices.u32"
    lookup_output = output_dir / "native-cell-row-plus-one.u32"
    for source_path, destination_path in ((coefficient_path, coefficient_output), (index_path, index_output)):
        temporary = destination_path.with_name(f".{destination_path.name}.partial")
        shutil.copyfile(source_path, temporary)
        os.replace(temporary, destination_path)
    lookup_temporary = lookup_output.with_name(f".{lookup_output.name}.partial")
    lookup.tofile(lookup_temporary)
    os.replace(lookup_temporary, lookup_output)
    runtime_state = {
        "id": state_id,
        "rowCount": row_count,
        "admissionIndexSha256": native_cell.get("sha256"),
        "sourceHashes": source_hashes,
        "effectiveRoute": replay.get("effectiveRoute"),
        "prototypeIdentity": replay.get("prototypeIdentity"),
        "backend": replay.get("backend"),
    }
    runtime = {
        "schema": RUNTIME_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": AUTHORITY,
        "selector": {
            "authority": SELECTOR_AUTHORITY,
            "recipeSha256": SELECTOR_RECIPE_SHA256,
            "compositionIdentity": COMPOSITION_IDENTITY,
        },
        "source": {
            "overlayIdentity": f"exact-local-layer-emission-extinction:{state_id}",
            "coefficientAuthority": EXACT_COEFFICIENT_AUTHORITY,
            "trainingManifestPath": str(training_manifest_path),
            "trainingManifestSha256": sha256_file(training_manifest_path),
            "model": None,
            "state": runtime_state,
        },
        "routing": {
            "grid": grid,
            "gridCellCount": grid_cell_count,
            "admittedRowCount": row_count,
            "lookupEncoding": LOOKUP_ENCODING,
            "missingRowValue": 0,
            "coefficientRowOffset": -1,
            "coefficientOrder": COEFFICIENT_ORDER,
        },
        "artifacts": {
            "coefficients": artifact_receipt(coefficient_output, [row_count, 8], "float32-le", "compact-live-union-layer-coefficients"),
            "nativeCellIndices": artifact_receipt(index_output, [row_count], "uint32-le", "checksum-bound-admitted-native-cell-identities"),
            "denseLookup": artifact_receipt(lookup_output, [grid_cell_count], "uint32-le", "native-cell-to-compact-coefficient-row-plus-one"),
        },
        "execution": {
            "sampleCap": None,
            "droppedRowCount": 0,
            "unmappedAdmittedRowCount": 0,
        },
    }
    runtime["identity"] = canonical_identity(runtime)
    atomic_json(output_dir / "runtime-overlay.json", runtime)
    return runtime


def run_self_test() -> dict[str, Any]:
    source = np.asarray([10, 20, 30, 40], dtype=np.uint32)
    destination = np.asarray([30, 10, 40, 20], dtype=np.uint32)
    coefficients = np.arange(32, dtype=np.float32).reshape(4, 8)
    remapped, permutation = remap_coefficients(source, destination, coefficients)
    require(permutation.tolist() == [2, 0, 3, 1], "exact permutation self-test failed")
    require(np.array_equal(remapped, coefficients[permutation]), "coefficient remap self-test failed")
    rejected: list[str] = []
    cases = [
        ("duplicate-source-native-cell-id", np.asarray([10, 20, 20, 40], dtype=np.uint32), destination, coefficients),
        ("duplicate-destination-native-cell-id", source, np.asarray([30, 10, 30, 20], dtype=np.uint32), coefficients),
        ("missing-destination-native-cell-id", source, np.asarray([10, 20, 30], dtype=np.uint32), coefficients),
        ("extra-destination-native-cell-id", np.asarray([10, 20, 30], dtype=np.uint32), source, coefficients[:3]),
    ]
    for name, case_source, case_destination, case_coefficients in cases:
        try:
            remap_coefficients(case_source, case_destination, case_coefficients)
        except ValueError as error:
            require(str(error).startswith(name), f"{name} produced the wrong failure: {error}")
            rejected.append(name)
    nonfinite = coefficients.copy()
    nonfinite[0, 0] = np.nan
    negative = coefficients.copy()
    negative[0, 0] = -1.0
    for name, candidate in (("nonfinite-coefficient", nonfinite), ("negative-coefficient", negative)):
        try:
            remap_coefficients(source, destination, candidate)
        except ValueError as error:
            require(str(error) == name, f"{name} produced the wrong failure: {error}")
            rejected.append(name)
    lookup = build_dense_lookup(source, 64)
    try:
        build_dense_lookup(np.asarray([64], dtype=np.uint32), 64)
    except ValueError as error:
        require(str(error) == "native-cell-id-out-of-range", f"out-of-range lookup produced the wrong failure: {error}")
        rejected.append("native-cell-id-out-of-range")
    return {
        "identity": "layer-coefficient-live-union-remap-self-test-v0",
        "status": "passed",
        "authority": AUTHORITY,
        "sourceRowCount": int(source.size),
        "destinationRowCount": int(destination.size),
        "droppedRowCount": 0,
        "sampleCap": None,
        "permutation": permutation.tolist(),
        "lookupEncoding": LOOKUP_ENCODING,
        "gridCellCount": int(lookup.size),
        "admittedRowCount": int(source.size),
        "lookupAtSourceIds": lookup[source].tolist(),
        "rejectedMismatch": rejected,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--overlay-report")
    parser.add_argument("--exact-training-manifest")
    parser.add_argument("--state-id")
    parser.add_argument("--source-native-cell-indices")
    parser.add_argument("--output-dir")
    parser.add_argument("--grid", type=int)
    args = parser.parse_args()
    if args.self_test:
        print(json.dumps(run_self_test(), sort_keys=True))
        return 0
    if bool(args.overlay_report) == bool(args.exact_training_manifest):
        parser.error("exactly one of --overlay-report or --exact-training-manifest is required")
    if args.output_dir is None or args.grid is None:
        parser.error("--output-dir and --grid are required")
    output_dir = Path(args.output_dir).expanduser().resolve()
    if args.exact_training_manifest:
        if not args.state_id:
            parser.error("--state-id is required with --exact-training-manifest")
        training_manifest_path = Path(args.exact_training_manifest).expanduser().resolve()
        try:
            runtime = package_exact_runtime_overlay(
                training_manifest_path,
                args.state_id,
                output_dir,
                args.grid,
            )
        except Exception as error:
            failure = {
                "schema": RUNTIME_SCHEMA,
                "status": "failed",
                "failurePhase": "package-exact-runtime-overlay",
                "authority": AUTHORITY,
                "reason": str(error),
                "requested": {
                    "trainingManifestPath": str(training_manifest_path),
                    "stateId": args.state_id,
                    "outputDir": str(output_dir),
                    "grid": args.grid,
                },
                "lastTrustworthyEvidence": {
                    "trainingManifestExists": training_manifest_path.is_file(),
                    "trainingManifestSha256": sha256_file(training_manifest_path) if training_manifest_path.is_file() else None,
                },
            }
            atomic_json(output_dir / "runtime-overlay.json", failure)
            raise
        print(json.dumps(runtime, sort_keys=True))
        return 0
    if args.source_native_cell_indices is None:
        parser.error("--source-native-cell-indices is required with --overlay-report")
    overlay_report_path = Path(args.overlay_report).expanduser().resolve()
    source_index_path = Path(args.source_native_cell_indices).expanduser().resolve()
    try:
        runtime = package_runtime_overlay(
            overlay_report_path,
            source_index_path,
            output_dir,
            args.grid,
        )
    except Exception as error:
        failure = {
            "schema": RUNTIME_SCHEMA,
            "status": "failed",
            "failurePhase": "package-runtime-overlay",
            "authority": AUTHORITY,
            "reason": str(error),
            "requested": {
                "overlayReportPath": str(overlay_report_path),
                "sourceNativeCellIndicesPath": str(source_index_path),
                "outputDir": str(output_dir),
                "grid": args.grid,
            },
            "lastTrustworthyEvidence": packaging_failure_evidence(overlay_report_path, source_index_path),
        }
        atomic_json(output_dir / "runtime-overlay.json", failure)
        raise
    print(json.dumps(runtime, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
