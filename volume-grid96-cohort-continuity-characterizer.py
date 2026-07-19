#!/usr/bin/env python3
"""Characterize source-frame continuity for exact Grid96 orientation cohorts."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import time
import traceback
from pathlib import Path
from typing import Any

import numpy as np


CONTINUITY_ORDER = (
    "cohort.code", "nonRidgeOpticalWeight", "sameCohortFaceNeighborCount",
    "tangentAbsDot.mean", "tangentAbsDot.minimum", "tangentAbsDot.maximum",
    "normalAbsDot.mean", "normalAbsDot.minimum", "normalAbsDot.maximum",
    "binormalAbsDot.mean", "binormalAbsDot.minimum", "binormalAbsDot.maximum",
    "continuity.valid",
)
AXIS_ORDER = (
    "tangent.x", "tangent.y", "tangent.z",
    "normal.x", "normal.y", "normal.z",
    "binormal.x", "binormal.y", "binormal.z",
)
REPORT_SCHEMA = "kaminos.volume.grid96-cohort-continuity-characterization.v0"
MANIFEST_SCHEMA = "kaminos.volume.grid96-cohort-continuity-socket.v0"
TRANSVERSE_SCHEMA = "kaminos.volume.grid96-transverse-basis-socket.v0"
MATERIAL_SCHEMA = "kaminos.volume.grid96-nonridge-material-basis-socket.v0"
TRANSVERSE_BASIS_CONTRACT = {
    "identity": "declared-normal-flow-tangent-orthonormal-frame-v0",
    "fallbackPolicy": "none-invalid-rows-remain-invalid-v0",
    "reasonIdentity": "grid96-transverse-basis-reason-codes-v0",
    "reasonCodes": {"valid": 0, "normalUndeclared": 1, "normalZero": 2, "tangentZero": 3, "parallel": 4},
}
MATERIAL_BASIS_CONTRACT = {
    "identity": "material-density-gradient-flow-tangent-plane-v0",
    "normalSource": "gradient.material.x",
    "cohort": "structure-normal-undeclared-positive-nonridge-v0",
    "fallbackPolicy": "none-separate-cohort-only-v0",
    "reasonIdentity": "grid96-nonridge-material-basis-reasons-v0",
    "reasonCodes": {"valid": 0, "declaredStructureNormal": 1, "zeroNonRidgeWeight": 2, "gradientZero": 3, "tangentZero": 4, "parallel": 5},
}
SOURCE_SHA_FIELDS = (
    "nativeCellIndexSha256", "descriptorManifestSha256", "coefficientManifestSha256",
    "componentSourceManifestSha256", "descriptorSourceManifestSha256",
    "descriptorArtifactSha256", "coefficientArtifactSha256",
)
SOURCE_PAYLOAD_HASH_FIELDS = (
    "fluidSha256", "frontSha256", "boundarySidecarSha256", "majorantSha256",
)
CLAIM_BOUNDARY = {
    "targetImageUsed": False, "supportRedefined": False, "fallbackInstalled": False,
    "crossCohortComposition": False, "widthsChosen": False, "childCountChosen": False,
    "capInstalled": False, "notDepositionVerdict": True, "notRendererVerdict": True,
    "notRuntimeEstimate": True, "notLearnerCampaign": True,
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def is_sha256(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_path(manifest_path: Path, receipt: dict[str, Any]) -> Path:
    path = Path(receipt["path"])
    return path if path.is_absolute() else (manifest_path.parent / path).resolve()


def load_socket(path: Path, expected_sha: str, schema: str) -> tuple[dict[str, Any], np.ndarray, np.ndarray]:
    require(path.is_file(), f"socket manifest is missing: {path}")
    require(len(expected_sha) == 64 and all(c in "0123456789abcdef" for c in expected_sha), "expected socket SHA-256 is invalid")
    require(sha256_file(path) == expected_sha, f"{schema} manifest SHA-256 drifted")
    manifest = json.loads(path.read_text())
    require(manifest.get("schema") == schema, "socket schema drifted")
    require(manifest.get("status") == "complete", "socket is not complete")
    basis_contract = TRANSVERSE_BASIS_CONTRACT if schema == TRANSVERSE_SCHEMA else MATERIAL_BASIS_CONTRACT
    basis = manifest.get("basis")
    require(isinstance(basis, dict), "socket basis contract is missing")
    for field, expected in basis_contract.items():
        require(basis.get(field) == expected, f"socket basis {field} drifted")
    source = manifest.get("source")
    require(isinstance(source, dict) and source.get("grid") == 96, "socket source is not native Grid96")
    for field in SOURCE_SHA_FIELDS:
        require(is_sha256(source.get(field)), f"socket source {field} is missing or invalid")
    source_hashes = source.get("sourceHashes")
    require(isinstance(source_hashes, dict), "socket sourceHashes are missing")
    require(set(source_hashes) == set(SOURCE_PAYLOAD_HASH_FIELDS), "socket sourceHashes keys drifted")
    for field in SOURCE_PAYLOAD_HASH_FIELDS:
        require(is_sha256(source_hashes.get(field)), f"socket sourceHashes.{field} is missing or invalid")
    sim_step_count = source.get("simStepCount")
    require(isinstance(sim_step_count, int) and not isinstance(sim_step_count, bool) and sim_step_count > 0, "socket simStepCount is missing or invalid")
    if schema == MATERIAL_SCHEMA:
        require(is_sha256(source.get("exactSourceReceiptSha256")), "material socket exactSourceReceiptSha256 is missing or invalid")
    execution = manifest.get("execution")
    require(isinstance(execution, dict), "socket execution receipt is missing")
    require(execution.get("sampleCap") is None and execution.get("droppedRowCount") == 0 and execution.get("fallbackRowCount") == 0, "socket used cap, drop, or fallback")
    require(execution.get("targetImageUsed") is False, "socket used a target image")
    row_count = execution.get("rowCount")
    require(isinstance(row_count, int) and row_count > 0, "socket row count is invalid")
    artifacts = manifest.get("artifacts")
    require(isinstance(artifacts, dict), "socket artifacts are missing")
    basis_receipt = artifacts.get("basis")
    native_receipt = artifacts.get("nativeCellIndex")
    require(isinstance(basis_receipt, dict) and isinstance(native_receipt, dict), "socket basis/native receipt is missing")
    order = basis.get("order")
    require(isinstance(order, list), "socket basis order is missing")
    require(basis_receipt.get("shape") == [row_count, len(order)] and basis_receipt.get("dtype") == "float32-le", "socket basis shape or dtype drifted")
    require(native_receipt.get("shape") == [row_count] and native_receipt.get("dtype") == "uint32-le", "socket native-id shape or dtype drifted")
    basis_path = artifact_path(path, basis_receipt)
    native_path = artifact_path(path, native_receipt)
    for label, artifact_file, receipt in (("basis", basis_path, basis_receipt), ("native-id", native_path, native_receipt)):
        require(artifact_file.is_file(), f"socket {label} artifact is missing")
        require(artifact_file.stat().st_size == receipt.get("bytes"), f"socket {label} artifact byte length drifted")
        require(sha256_file(artifact_file) == receipt.get("sha256"), f"socket {label} artifact SHA-256 drifted")
    basis = np.fromfile(basis_path, dtype="<f4").reshape(row_count, len(order))
    native_ids = np.fromfile(native_path, dtype="<u4")
    require(np.all(np.isfinite(basis)), "socket basis contains nonfinite values")
    require(np.unique(native_ids).size == row_count and np.all(native_ids < 96**3), "socket native ids are invalid")
    require(sha256_file(native_path) == source.get("nativeCellIndexSha256"), "socket native-id source binding drifted")
    return manifest, basis, native_ids


def weighted_summary(values: np.ndarray, weights: np.ndarray) -> dict[str, Any] | None:
    eligible = np.isfinite(values) & np.isfinite(weights) & (weights > 0.0)
    if not np.any(eligible):
        return None
    v = np.asarray(values[eligible], dtype=np.float64)
    w = np.asarray(weights[eligible], dtype=np.float64)
    order = np.argsort(v, kind="stable")
    v, w = v[order], w[order]
    cumulative = np.cumsum(w)
    total = float(cumulative[-1])
    quantiles = {}
    for name, q in (("p00", 0.0), ("p10", 0.1), ("p50", 0.5), ("p90", 0.9), ("p100", 1.0)):
        index = min(int(np.searchsorted(cumulative, q * total, side="left")), v.size - 1)
        quantiles[name] = float(v[index])
    return {"count": int(v.size), "totalWeight": total, "mean": float(np.average(v, weights=w)), "quantiles": quantiles}


def artifact_receipt(path: Path, dtype: str, shape: list[int], role: str) -> dict[str, Any]:
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha256_file(path), "dtype": dtype, "shape": shape, "semanticRole": role}


def face_neighbor_edges(native_ids: np.ndarray, cohort_codes: np.ndarray, grid: int = 96) -> np.ndarray:
    """Return deterministic same-cohort face edges as [rowA,rowB,axis]."""
    ids = np.asarray(native_ids, dtype=np.uint32)
    cohorts = np.asarray(cohort_codes, dtype=np.uint8)
    if ids.ndim != 1 or cohorts.shape != ids.shape:
        raise ValueError("native ids and cohort codes must be aligned 1D arrays")
    if not isinstance(grid, int) or grid <= 1:
        raise ValueError("grid must be an integer greater than one")
    if np.any(ids >= grid**3) or np.unique(ids).size != ids.size:
        raise ValueError("native ids must be unique and inside the grid")
    if np.any(cohorts > 2):
        raise ValueError("cohort codes must be zero, one, or two")

    row_for_cell = np.full(grid**3, -1, dtype=np.int64)
    row_for_cell[ids] = np.arange(ids.size, dtype=np.int64)
    edges: list[tuple[int, int, int]] = []
    plane = grid * grid
    for row, cell_value in enumerate(ids):
        cohort = int(cohorts[row])
        if cohort == 0:
            continue
        cell = int(cell_value)
        z, plane_index = divmod(cell, plane)
        y, x = divmod(plane_index, grid)
        for axis, inside, neighbor_cell in (
            (0, x + 1 < grid, cell + 1),
            (1, y + 1 < grid, cell + grid),
            (2, z + 1 < grid, cell + plane),
        ):
            if not inside:
                continue
            neighbor_row = int(row_for_cell[neighbor_cell])
            if neighbor_row >= 0 and int(cohorts[neighbor_row]) == cohort:
                edges.append((row, neighbor_row, axis))
    if not edges:
        return np.empty((0, 3), dtype="<u4")
    return np.asarray(edges, dtype="<u4")


def parent_continuity(
    native_ids: np.ndarray,
    cohort_codes: np.ndarray,
    optical_weights: np.ndarray,
    tangents: np.ndarray,
    normals: np.ndarray,
    binormals: np.ndarray,
    grid: int = 96,
) -> tuple[np.ndarray, np.ndarray]:
    """Return parent-aligned continuity descriptors and deterministic edges."""
    ids = np.asarray(native_ids, dtype=np.uint32)
    cohorts = np.asarray(cohort_codes, dtype=np.uint8)
    weights = np.asarray(optical_weights, dtype=np.float64)
    axes = tuple(np.asarray(values, dtype=np.float64) for values in (tangents, normals, binormals))
    if weights.shape != ids.shape or cohorts.shape != ids.shape:
        raise ValueError("parent scalar inputs are row-misaligned")
    if any(values.shape != (ids.size, 3) for values in axes):
        raise ValueError("parent axes must have shape [rows,3]")
    if not np.all(np.isfinite(weights)) or np.any(weights < 0.0):
        raise ValueError("optical weights must be finite and nonnegative")
    valid = cohorts > 0
    if np.any((weights > 0.0) & ~valid):
        raise ValueError("positive optical weight lacks a valid cohort")
    for values in axes:
        if not np.all(np.isfinite(values)):
            raise ValueError("parent axes contain nonfinite values")
        lengths = np.linalg.norm(values[valid], axis=1)
        if np.any(np.abs(lengths - 1.0) > 2e-5):
            raise ValueError("valid parent axes must be normalized")

    edges = face_neighbor_edges(ids, cohorts, grid=grid)
    degree = np.zeros(ids.size, dtype=np.uint32)
    sums = [np.zeros(ids.size, dtype=np.float64) for _ in axes]
    minima = [np.ones(ids.size, dtype=np.float64) for _ in axes]
    maxima = [np.zeros(ids.size, dtype=np.float64) for _ in axes]
    for row_a_value, row_b_value, _axis in edges:
        row_a = int(row_a_value)
        row_b = int(row_b_value)
        degree[row_a] += 1
        degree[row_b] += 1
        for values, total, minimum, maximum in zip(axes, sums, minima, maxima, strict=True):
            agreement = float(np.clip(abs(np.dot(values[row_a], values[row_b])), 0.0, 1.0))
            total[row_a] += agreement
            total[row_b] += agreement
            minimum[row_a] = min(minimum[row_a], agreement)
            minimum[row_b] = min(minimum[row_b], agreement)
            maximum[row_a] = max(maximum[row_a], agreement)
            maximum[row_b] = max(maximum[row_b], agreement)

    connected = degree > 0
    metrics: list[np.ndarray] = []
    for total, minimum, maximum in zip(sums, minima, maxima, strict=True):
        mean = np.divide(total, degree, out=np.zeros_like(total), where=connected)
        minimum[~connected] = 0.0
        metrics.extend((mean, minimum, maximum))
    continuity = np.column_stack((
        cohorts.astype(np.float64), weights, degree.astype(np.float64),
        *metrics, connected.astype(np.float64),
    )).astype("<f4")
    if continuity.shape != (ids.size, len(CONTINUITY_ORDER)) or not np.all(np.isfinite(continuity)):
        raise ValueError("continuity descriptor artifact is invalid")
    return continuity, edges


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--transverse-manifest", type=Path, required=True)
    parser.add_argument("--transverse-manifest-sha256", required=True)
    parser.add_argument("--material-manifest", type=Path, required=True)
    parser.add_argument("--material-manifest-sha256", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output = args.output_dir.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / "report.json"
    manifest_path = output / "grid96-cohort-continuity-manifest.json"
    continuity_path = output / "grid96-cohort-continuity.f32"
    edge_path = output / "grid96-cohort-continuity-edges.u32"
    native_path = output / "grid96-cohort-continuity-native-cell-index.u32"
    primary = (manifest_path, continuity_path, edge_path, native_path)
    for path in primary:
        path.unlink(missing_ok=True)
    started = time.time()
    failure_phase = "source-validation"
    try:
        transverse_path = args.transverse_manifest.resolve()
        material_path = args.material_manifest.resolve()
        transverse_manifest, transverse, transverse_ids = load_socket(transverse_path, args.transverse_manifest_sha256, TRANSVERSE_SCHEMA)
        material_manifest, material, material_ids = load_socket(material_path, args.material_manifest_sha256, MATERIAL_SCHEMA)
        require(np.array_equal(transverse_ids, material_ids), "socket native-id row order mismatch")
        source_fields = (
            "grid", "sameStateCaptureId", "nativeCellIndexSha256", "descriptorManifestSha256",
            "coefficientManifestSha256", "componentSourceManifestSha256", "descriptorSourceManifestSha256",
            "descriptorArtifactSha256", "coefficientArtifactSha256", "sourceHashes", "simStepCount",
        )
        for field in source_fields:
            require(transverse_manifest["source"].get(field) == material_manifest["source"].get(field), f"socket source {field} mismatch")
        transverse_lookup = {name: index for index, name in enumerate(transverse_manifest["basis"]["order"])}
        material_lookup = {name: index for index, name in enumerate(material_manifest["basis"]["order"])}
        for lookup in (transverse_lookup, material_lookup):
            for name in (*AXIS_ORDER, "nonRidgeOpticalWeight", "basis.valid"):
                require(name in lookup, f"socket basis order is missing {name}")
        transverse_weight = transverse[:, transverse_lookup["nonRidgeOpticalWeight"]].astype(np.float64)
        material_weight = material[:, material_lookup["nonRidgeOpticalWeight"]].astype(np.float64)
        require(np.array_equal(transverse_weight, material_weight), "socket Non-Ridge optical weights mismatch")
        structure_valid = transverse[:, transverse_lookup["basis.valid"]] > 0.5
        material_valid = material[:, material_lookup["basis.valid"]] > 0.5
        positive = transverse_weight > 0.0
        require(not np.any(structure_valid & material_valid), "orientation cohorts overlap")
        require(np.all((structure_valid | material_valid)[positive]), "positive Non-Ridge mass lacks an orientation cohort")
        cohorts = np.zeros(transverse_ids.size, dtype=np.uint8)
        cohorts[structure_valid & positive] = 1
        cohorts[material_valid & positive] = 2
        axes = []
        for prefix in ("tangent", "normal", "binormal"):
            values = np.zeros((transverse_ids.size, 3), dtype=np.float64)
            tcols = [transverse_lookup[f"{prefix}.{axis}"] for axis in "xyz"]
            mcols = [material_lookup[f"{prefix}.{axis}"] for axis in "xyz"]
            values[cohorts == 1] = transverse[cohorts == 1][:, tcols]
            values[cohorts == 2] = material[cohorts == 2][:, mcols]
            axes.append(values)

        failure_phase = "continuity-analysis"
        continuity, edges = parent_continuity(transverse_ids, cohorts, transverse_weight, *axes, grid=96)
        lookup = {name: index for index, name in enumerate(CONTINUITY_ORDER)}
        cohort_summaries = {}
        for name, code in (("declaredStructure", 1), ("missingNonRidgeMaterial", 2)):
            selected = cohorts == code
            weights = transverse_weight * selected
            connected = continuity[:, lookup["continuity.valid"]] > 0.5
            total_mass = float(np.sum(weights, dtype=np.float64))
            isolated_mass = float(np.sum(weights[~connected], dtype=np.float64))
            cohort_summaries[name] = {
                "code": code, "rowCount": int(np.count_nonzero(selected)), "opticalMass": total_mass,
                "connectedRowCount": int(np.count_nonzero(selected & connected)),
                "isolatedRowCount": int(np.count_nonzero(selected & ~connected)),
                "isolatedOpticalMass": isolated_mass,
                "isolatedOpticalMassFraction": isolated_mass / total_mass if total_mass > 0.0 else None,
                "neighborDegree": weighted_summary(continuity[:, lookup["sameCohortFaceNeighborCount"]], weights),
                "tangentAbsDotMean": weighted_summary(continuity[:, lookup["tangentAbsDot.mean"]], weights * connected),
                "normalAbsDotMean": weighted_summary(continuity[:, lookup["normalAbsDot.mean"]], weights * connected),
                "binormalAbsDotMean": weighted_summary(continuity[:, lookup["binormalAbsDot.mean"]], weights * connected),
            }

        failure_phase = "artifact-write"
        continuity.tofile(continuity_path)
        edges.astype("<u4").tofile(edge_path)
        transverse_ids.astype("<u4").tofile(native_path)
        artifacts = {
            "parentContinuity": artifact_receipt(continuity_path, "float32-le", [int(transverse_ids.size), len(CONTINUITY_ORDER)], "all-parent-source-cohort-continuity"),
            "edges": artifact_receipt(edge_path, "uint32-le", [int(edges.shape[0]), 3], "same-cohort-native-face-neighbor-edges-row-row-axis"),
            "nativeCellIndex": artifact_receipt(native_path, "uint32-le", [int(transverse_ids.size)], "caller-ordered-native-cell-index"),
        }
        source = {
            "transverseManifestPath": str(transverse_path), "transverseManifestSha256": args.transverse_manifest_sha256,
            "transverseManifestIdentity": transverse_manifest.get("identity"),
            "materialManifestPath": str(material_path), "materialManifestSha256": args.material_manifest_sha256,
            "materialManifestIdentity": material_manifest.get("identity"),
            **{field: transverse_manifest["source"].get(field) for field in source_fields},
            "exactSourceReceiptSha256": material_manifest["source"].get("exactSourceReceiptSha256"),
        }
        execution = {"rowCount": int(transverse_ids.size), "edgeCount": int(edges.shape[0]), "sampleCap": None, "droppedRowCount": 0, "fallbackRowCount": 0, "targetImageUsed": False}
        payload = {"schema": MANIFEST_SCHEMA, "status": "complete", "source": source, "continuityOrder": list(CONTINUITY_ORDER), "cohorts": cohort_summaries, "artifacts": artifacts, "execution": execution, "claimBoundary": CLAIM_BOUNDARY}
        payload["identity"] = "sha256:" + hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        manifest_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        report = {**payload, "schema": REPORT_SCHEMA, "status": "complete", "failurePhase": None, "startedAtUnix": started, "finishedAtUnix": time.time(), "manifest": {"path": str(manifest_path), "sha256": sha256_file(manifest_path), "identity": payload["identity"]}}
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n")
        print(json.dumps({"ok": True, "report": str(report_path), "edgeCount": int(edges.shape[0])}))
        return 0
    except Exception as exc:
        for path in primary:
            path.unlink(missing_ok=True)
        failed = {"schema": REPORT_SCHEMA, "status": "failed", "failurePhase": failure_phase, "startedAtUnix": started, "finishedAtUnix": time.time(), "requested": {"transverseManifest": str(args.transverse_manifest), "transverseManifestSha256": args.transverse_manifest_sha256, "materialManifest": str(args.material_manifest), "materialManifestSha256": args.material_manifest_sha256, "outputDir": str(args.output_dir)}, "error": {"type": type(exc).__name__, "message": str(exc), "traceback": traceback.format_exc()}, "claimBoundary": CLAIM_BOUNDARY}
        report_path.write_text(json.dumps(failed, indent=2, sort_keys=True) + "\n")
        print(f"Grid96 cohort continuity failed at {failure_phase}: {exc}", file=__import__("sys").stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
