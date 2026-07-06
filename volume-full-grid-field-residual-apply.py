#!/usr/bin/env python3
"""Apply a first full-grid residual model to complete Kaminos field sidecars."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Any

import numpy as np


SCHEMA = "kaminos.volume.full-grid-field-residual-application.v0"
MODEL_IDENTITY = "full-grid-local-ridge-residual-v0"
APPLICATION_AUTHORITY = "fitOnSamePairVisualDiagnostic"
FIELD_AUTHORITY = "complete-webgpu-fluid-front-buffer-readback-sidecars"
FLUID_CHANNELS = [
    "velocityX",
    "velocityY",
    "velocityZ",
    "densityCarrier",
    "smokeDensity",
    "heat",
    "fuel",
    "detail",
    "flame",
    "ember",
    "visibleFireCarrier",
    "combustionFront",
    "microdetail",
    "interfaceShred",
    "fireLick",
    "emberFleck",
]
FRONT_CHANNELS = ["frontTopology"]


class ApplyFailure(RuntimeError):
    def __init__(self, phase: str, message: str, evidence: dict[str, Any] | None = None):
        super().__init__(message)
        self.phase = phase
        self.evidence = evidence or {}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pair-manifest", required=True, help="Full-grid field pair manifest.")
    parser.add_argument("--out-dir", required=True, help="Output directory for complete predicted sidecars.")
    parser.add_argument("--train-samples", type=int, default=220_000, help="Random same-pair samples for ridge fit.")
    parser.add_argument("--ridge", type=float, default=1e-3, help="Ridge regularization strength.")
    parser.add_argument("--seed", type=int, default=1337, help="Deterministic training sample seed.")
    parser.add_argument("--chunk-z", type=int, default=4, help="High-grid z slices per application chunk.")
    return parser.parse_args()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_sidecar_path(descriptor: dict[str, Any]) -> Path:
    path = Path(str(descriptor.get("path") or ""))
    if not path:
        raise ApplyFailure("manifest-read", "Sidecar descriptor is missing path.", {"descriptor": descriptor})
    return path


def verify_sidecar(descriptor: dict[str, Any]) -> Path:
    path = resolve_sidecar_path(descriptor)
    if not path.exists():
        raise ApplyFailure("sidecar-read", f"Missing sidecar {path}", {"descriptor": descriptor})
    expected_bytes = int(descriptor.get("byteLength") or 0)
    actual_bytes = path.stat().st_size
    if actual_bytes != expected_bytes:
        raise ApplyFailure("sidecar-read", f"Sidecar byte length mismatch for {path}", {
            "expectedBytes": expected_bytes,
            "actualBytes": actual_bytes,
        })
    expected_sha = descriptor.get("sha256")
    actual_sha = sha256_file(path)
    if expected_sha and expected_sha != actual_sha:
        raise ApplyFailure("sidecar-read", f"Sidecar checksum mismatch for {path}", {
            "expectedSha256": expected_sha,
            "actualSha256": actual_sha,
        })
    return path


def sidecar_descriptor(path: Path, shape: list[int], channel_order: list[str]) -> dict[str, Any]:
    return {
        "path": str(path),
        "sha256": sha256_file(path),
        "dtype": "float32",
        "byteOrder": "little-endian",
        "floatCount": int(math.prod(shape)),
        "byteLength": path.stat().st_size,
        "shape": shape,
        "channelOrder": channel_order,
    }


def feature_count() -> int:
    low_channels = len(FLUID_CHANNELS) + len(FRONT_CHANNELS)
    return low_channels * 2 + 5 + 18 + 128


def normalized_position_features(x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    nx = x.astype(np.float32) / max(1, grid - 1) * 2 - 1
    ny = y.astype(np.float32) / max(1, grid - 1) * 2 - 1
    nz = z.astype(np.float32) / max(1, grid - 1) * 2 - 1
    radial = np.sqrt(nx * nx + nz * nz)
    return np.stack([nx, ny, nz, radial, ny * radial], axis=1)


def spatial_basis_features(x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    nx = x.astype(np.float32) / max(1, grid - 1) * 2 - 1
    ny = y.astype(np.float32) / max(1, grid - 1) * 2 - 1
    nz = z.astype(np.float32) / max(1, grid - 1) * 2 - 1
    fourier = []
    for frequency in (1.0, 2.0, 4.0):
        for axis in (nx, ny, nz):
            phase = np.pi * frequency * axis
            fourier.append(np.sin(phase))
            fourier.append(np.cos(phase))
    centers_x = np.linspace(-0.75, 0.75, 4, dtype=np.float32)
    centers_y = np.linspace(-0.95, 0.85, 8, dtype=np.float32)
    centers_z = np.linspace(-0.75, 0.75, 4, dtype=np.float32)
    sigma2 = np.float32(0.30 * 0.30)
    rbf = []
    for cy in centers_y:
        for cz in centers_z:
            for cx in centers_x:
                dist2 = (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) + (nz - cz) * (nz - cz)
                rbf.append(np.exp(-dist2 / (2 * sigma2)))
    return np.stack([*fourier, *rbf], axis=1).astype(np.float32, copy=False)


def build_features(low_values: np.ndarray, x: np.ndarray, y: np.ndarray, z: np.ndarray, grid: int) -> np.ndarray:
    low = low_values.astype(np.float32, copy=False)
    return np.concatenate([
        low,
        low * low,
        normalized_position_features(x, y, z, grid),
        spatial_basis_features(x, y, z, grid),
    ], axis=1).astype(np.float32, copy=False)


def low_values_for_high_cells(
    low_fluid_flat: np.ndarray,
    low_front_flat: np.ndarray,
    high_cell_indexes: np.ndarray,
    low_grid: int,
    high_grid: int,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x = high_cell_indexes % high_grid
    y = (high_cell_indexes // high_grid) % high_grid
    z = high_cell_indexes // (high_grid * high_grid)
    ratio = high_grid / low_grid
    lx = np.minimum(low_grid - 1, np.floor(x / ratio).astype(np.int64))
    ly = np.minimum(low_grid - 1, np.floor(y / ratio).astype(np.int64))
    lz = np.minimum(low_grid - 1, np.floor(z / ratio).astype(np.int64))
    low_indexes = lx + ly * low_grid + lz * low_grid * low_grid
    low_values = np.concatenate([low_fluid_flat[low_indexes], low_front_flat[low_indexes, None]], axis=1)
    return low_values, x.astype(np.int64), y.astype(np.int64), z.astype(np.int64)


def fit_ridge(features: np.ndarray, residual: np.ndarray, ridge: float) -> np.ndarray:
    ones = np.ones((features.shape[0], 1), dtype=np.float32)
    design = np.concatenate([features, ones], axis=1).astype(np.float64)
    target = residual.astype(np.float64)
    normal = design.T @ design
    regularizer = np.eye(normal.shape[0], dtype=np.float64) * float(ridge)
    regularizer[-1, -1] = 0.0
    rhs = design.T @ target
    return np.linalg.solve(normal + regularizer, rhs)


def predict_residual(features: np.ndarray, weights: np.ndarray) -> np.ndarray:
    ones = np.ones((features.shape[0], 1), dtype=np.float32)
    design = np.concatenate([features, ones], axis=1).astype(np.float64)
    return (design @ weights).astype(np.float32)


def write_failure(out_path: Path, phase: str, error: Exception, evidence: dict[str, Any] | None = None) -> None:
    payload = {
        "schema": SCHEMA,
        "status": "failed",
        "failurePhase": phase,
        "error": str(error),
        "lastTrustworthyEvidence": evidence or {},
    }
    if isinstance(error, ApplyFailure):
        payload["failurePhase"] = error.phase
        payload["lastTrustworthyEvidence"] = error.evidence
    write_json(out_path, payload)


def main() -> int:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    manifest_out = out_dir / "manifest.json"
    phase = "args"
    evidence: dict[str, Any] = {}
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        phase = "manifest-read"
        pair_path = Path(args.pair_manifest).resolve()
        pair = read_json(pair_path)
        if pair.get("schema") != "kaminos.volume.full-grid-field-pair.v0":
            raise ApplyFailure("manifest-read", f"Pair schema mismatch: {pair.get('schema')}")
        low_grid = int(pair["lowGrid"])
        high_grid = int(pair["highGrid"])
        if high_grid % low_grid != 0:
            raise ApplyFailure("manifest-read", "Only integer low/high grid ratios are supported.", {
                "lowGrid": low_grid,
                "highGrid": high_grid,
            })
        low_fluid_desc = pair["low"]["fluid"]
        low_front_desc = pair["low"]["front"]
        high_fluid_desc = pair["high"]["fluid"]
        high_front_desc = pair["high"]["front"]
        evidence = {
            "pairManifest": str(pair_path),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "gridScaleRatio": pair.get("gridScaleRatio"),
        }

        phase = "sidecar-read"
        low_fluid_path = verify_sidecar(low_fluid_desc)
        low_front_path = verify_sidecar(low_front_desc)
        high_fluid_path = verify_sidecar(high_fluid_desc)
        high_front_path = verify_sidecar(high_front_desc)
        low_cells = low_grid ** 3
        high_cells = high_grid ** 3
        low_fluid = np.memmap(low_fluid_path, dtype="<f4", mode="r", shape=(low_cells, len(FLUID_CHANNELS)))
        low_front = np.memmap(low_front_path, dtype="<f4", mode="r", shape=(low_cells,))
        high_fluid = np.memmap(high_fluid_path, dtype="<f4", mode="r", shape=(high_cells, len(FLUID_CHANNELS)))
        high_front = np.memmap(high_front_path, dtype="<f4", mode="r", shape=(high_cells,))

        phase = "train-sample"
        rng = np.random.default_rng(int(args.seed))
        train_count = min(max(1, int(args.train_samples)), high_cells)
        train_indexes = rng.choice(high_cells, size=train_count, replace=False)
        low_train, x_train, y_train, z_train = low_values_for_high_cells(
            low_fluid, low_front, train_indexes, low_grid, high_grid
        )
        features = build_features(low_train, x_train, y_train, z_train, high_grid)
        high_train = np.concatenate([high_fluid[train_indexes], high_front[train_indexes, None]], axis=1)
        residual = high_train.astype(np.float32) - low_train.astype(np.float32)

        phase = "model-fit"
        weights = fit_ridge(features, residual, float(args.ridge))

        phase = "sidecar-write"
        low_up_fluid_path = out_dir / "lowUpsampled-fluid.f32"
        low_up_front_path = out_dir / "lowUpsampled-front.f32"
        predicted_fluid_path = out_dir / "predictedHigh-fluid.f32"
        predicted_front_path = out_dir / "predictedHigh-front.f32"
        for path in [low_up_fluid_path, low_up_front_path, predicted_fluid_path, predicted_front_path]:
            path.write_bytes(b"")

        chunk_z = max(1, min(high_grid, int(args.chunk_z)))
        chunk_summaries = []
        for z0 in range(0, high_grid, chunk_z):
            z1 = min(high_grid, z0 + chunk_z)
            indexes = np.arange(z0 * high_grid * high_grid, z1 * high_grid * high_grid, dtype=np.int64)
            low_chunk, x, y, z = low_values_for_high_cells(low_fluid, low_front, indexes, low_grid, high_grid)
            chunk_features = build_features(low_chunk, x, y, z, high_grid)
            predicted = low_chunk + predict_residual(chunk_features, weights)
            predicted = predicted.astype("<f4", copy=False)
            low_chunk = low_chunk.astype("<f4", copy=False)
            with low_up_fluid_path.open("ab") as handle:
                low_chunk[:, :len(FLUID_CHANNELS)].tofile(handle)
            with low_up_front_path.open("ab") as handle:
                low_chunk[:, len(FLUID_CHANNELS)].tofile(handle)
            with predicted_fluid_path.open("ab") as handle:
                predicted[:, :len(FLUID_CHANNELS)].tofile(handle)
            with predicted_front_path.open("ab") as handle:
                predicted[:, len(FLUID_CHANNELS)].tofile(handle)
            chunk_summaries.append({
                "zStart": z0,
                "zEnd": z1,
                "cellCount": int(indexes.shape[0]),
            })

        expected_fluid_bytes = high_cells * len(FLUID_CHANNELS) * 4
        expected_front_bytes = high_cells * 4
        for role, fluid_path, front_path in [
            ("lowUpsampled", low_up_fluid_path, low_up_front_path),
            ("predictedHigh", predicted_fluid_path, predicted_front_path),
        ]:
            if fluid_path.stat().st_size != expected_fluid_bytes or front_path.stat().st_size != expected_front_bytes:
                raise ApplyFailure("sidecar-write", f"{role} sidecar byte length mismatch.", {
                    "role": role,
                    "fluidBytes": fluid_path.stat().st_size,
                    "frontBytes": front_path.stat().st_size,
                    "expectedFluidBytes": expected_fluid_bytes,
                    "expectedFrontBytes": expected_front_bytes,
                })

        phase = "manifest-write"
        high_shape_fluid = [high_grid, high_grid, high_grid, len(FLUID_CHANNELS)]
        high_shape_front = [high_grid, high_grid, high_grid, 1]
        manifest = {
            "schema": SCHEMA,
            "status": "captured",
            "failurePhase": None,
            "identity": "full-grid-residual-application-sidecars-v0",
            "applicationAuthority": APPLICATION_AUTHORITY,
            "fieldAuthority": FIELD_AUTHORITY,
            "completeFieldCoverage": True,
            "fitOnSamePairVisualDiagnostic": True,
            "pairManifest": str(pair_path),
            "pairManifestSha256": sha256_file(pair_path),
            "routeIdentity": pair.get("routeIdentity"),
            "effectiveRoute": pair.get("effectiveRoute"),
            "prototypeIdentity": pair.get("prototypeIdentity"),
            "backend": pair.get("backend"),
            "deterministicReplay": pair.get("deterministicReplay"),
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "gridScaleRatio": pair.get("gridScaleRatio"),
            "model": {
                "identity": MODEL_IDENTITY,
                "ridge": float(args.ridge),
                "seed": int(args.seed),
                "trainSampleCount": int(train_count),
                "featureCount": int(feature_count()),
                "spatialBasis": "fourier-xyz-plus-4x8x4-rbf-v0",
                "inputChannels": [*FLUID_CHANNELS, *FRONT_CHANNELS],
                "targetChannels": [*FLUID_CHANNELS, *FRONT_CHANNELS],
                "limitation": "Same-pair fitted full-grid visual diagnostic; not held-out proof and not final nonlinear architecture.",
            },
            "roles": {
                "lowUpsampled": {
                    "role": "lowUpsampled",
                    "fluid": sidecar_descriptor(low_up_fluid_path, high_shape_fluid, FLUID_CHANNELS),
                    "front": sidecar_descriptor(low_up_front_path, high_shape_front, FRONT_CHANNELS),
                },
                "predictedHigh": {
                    "role": "predictedHigh",
                    "fluid": sidecar_descriptor(predicted_fluid_path, high_shape_fluid, FLUID_CHANNELS),
                    "front": sidecar_descriptor(predicted_front_path, high_shape_front, FRONT_CHANNELS),
                },
                "truthHigh": {
                    "role": "truthHigh",
                    "fluid": high_fluid_desc,
                    "front": high_front_desc,
                },
            },
            "applicationChunks": {
                "chunkZ": chunk_z,
                "chunks": chunk_summaries,
            },
            "limitations": [
                "Same-pair fitted full-grid visual diagnostic, not held-out learning proof.",
                "Low/high source pair is separate deterministic replay, not literal cross-grid state transfer.",
                "Predicted sidecars are complete fields; render inspection still needs temporal checks before product claims.",
            ],
        }
        write_json(manifest_out, manifest)
        print(json.dumps({
            "ok": True,
            "manifest": str(manifest_out),
            "model": MODEL_IDENTITY,
            "lowGrid": low_grid,
            "highGrid": high_grid,
            "roles": list(manifest["roles"].keys()),
        }, indent=2))
        return 0
    except Exception as error:
        write_failure(manifest_out, phase, error, evidence)
        print(f"full-grid residual application failed at {phase}: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
