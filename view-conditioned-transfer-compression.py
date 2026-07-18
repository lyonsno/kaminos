#!/usr/bin/env python3
"""Reference machinery for camera-conditioned optical-transfer compression."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
import traceback
from pathlib import Path
from typing import Any, Iterable

import numpy as np


INPUT_SCHEMA = "kaminos.view-conditioned-transfer-input.v0"
REPORT_SCHEMA = "kaminos.view-conditioned-transfer-compression-report.v0"
TRANSFER_IDENTITY = "ordered-ridge-nonridge-shared-transmittance-v0"
DEPTH_ORDER = "near-to-far"
RADIANCE_BOUNDARY = "premultiplied-per-depth-slice-v0"
TRANSMITTANCE_BOUNDARY = "exp-negative-extinction-v0"
REDUCTION_IDENTITY = "contiguous-depth-compose-plus-constant-screen-tile-v0"


class Transfer:
    def __init__(self, radiance: np.ndarray, transmittance: np.ndarray):
        self.radiance = np.asarray(radiance)
        self.transmittance = np.asarray(transmittance)


class TransferInput:
    def __init__(
        self,
        depths: np.ndarray,
        ridge_radiance: np.ndarray,
        nonridge_radiance: np.ndarray,
        extinction: np.ndarray,
        manifest: dict[str, Any],
        manifest_path: Path,
        manifest_sha256: str,
        arrays_path: Path,
        arrays_sha256: str,
    ):
        self.depths = depths
        self.ridge_radiance = ridge_radiance
        self.nonridge_radiance = nonridge_radiance
        self.extinction = extinction
        self.manifest = manifest
        self.manifest_path = manifest_path
        self.manifest_sha256 = manifest_sha256
        self.arrays_path = arrays_path
        self.arrays_sha256 = arrays_sha256

    @property
    def shape(self) -> tuple[int, int, int]:
        return tuple(int(value) for value in self.extinction.shape)


class TransferReduction:
    def __init__(
        self,
        groups: list[Transfer],
        depths: np.ndarray,
        source_height: int,
        source_width: int,
        source_depth_slice_count: int,
        tile_size: int,
        identity: str = REDUCTION_IDENTITY,
    ):
        self.groups = groups
        self.depths = np.asarray(depths, dtype=np.float32)
        self.source_height = source_height
        self.source_width = source_width
        self.source_depth_slice_count = source_depth_slice_count
        self.tile_size = tile_size
        self.identity = identity

    @property
    def element_count(self) -> int:
        if not self.groups:
            return 0
        tile_height, tile_width = self.groups[0].transmittance.shape
        return len(self.groups) * int(tile_height) * int(tile_width)

    @property
    def active_element_count(self) -> int:
        return int(sum(
            np.count_nonzero(
                np.any(np.abs(group.radiance) > 1e-12, axis=-1)
                | (group.transmittance < 1.0 - 1e-12)
            )
            for group in self.groups
        ))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def identity_transfer(spatial_shape: tuple[int, ...], channels: int) -> Transfer:
    require(channels > 0, "transfer channels must be positive")
    return Transfer(
        np.zeros((*spatial_shape, channels), dtype=np.float64),
        np.ones(spatial_shape, dtype=np.float64),
    )


def validate_transfer(transfer: Transfer, label: str) -> None:
    require(transfer.radiance.ndim >= 1, f"{label} radiance must have a channel axis")
    require(
        transfer.radiance.shape[:-1] == transfer.transmittance.shape,
        f"{label} radiance/transmittance shape mismatch",
    )
    require(np.all(np.isfinite(transfer.radiance)), f"{label} radiance is not finite")
    require(np.all(np.isfinite(transfer.transmittance)), f"{label} transmittance is not finite")
    require(np.all(transfer.transmittance >= 0.0), f"{label} transmittance is negative")
    require(np.all(transfer.transmittance <= 1.0), f"{label} transmittance exceeds one")


def compose_transfer(front: Transfer, back: Transfer) -> Transfer:
    validate_transfer(front, "front transfer")
    validate_transfer(back, "back transfer")
    require(front.radiance.shape == back.radiance.shape, "transfer radiance shapes differ")
    require(front.transmittance.shape == back.transmittance.shape, "transfer transmittance shapes differ")
    radiance = front.radiance + front.transmittance[..., None] * back.radiance
    transmittance = front.transmittance * back.transmittance
    return Transfer(radiance, transmittance)


def compose_transfer_sequence(transfers: Iterable[Transfer]) -> Transfer:
    rows = list(transfers)
    require(bool(rows), "transfer sequence must not be empty")
    validate_transfer(rows[0], "transfer 0")
    result = identity_transfer(rows[0].transmittance.shape, rows[0].radiance.shape[-1])
    for index, transfer in enumerate(rows):
        validate_transfer(transfer, f"transfer {index}")
        result = compose_transfer(result, transfer)
    return result


def transfer_slices(radiance: np.ndarray, extinction: np.ndarray) -> list[Transfer]:
    radiance = np.asarray(radiance)
    extinction = np.asarray(extinction)
    require(radiance.ndim == 4, "slice radiance must have shape [depth,height,width,channels]")
    require(extinction.shape == radiance.shape[:-1], "slice extinction shape mismatch")
    require(np.all(np.isfinite(radiance)), "slice radiance is not finite")
    require(np.all(np.isfinite(extinction)), "slice extinction is not finite")
    require(np.all(radiance >= 0.0), "slice radiance is negative")
    require(np.all(extinction >= 0.0), "slice extinction is negative")
    transmittance = np.exp(-extinction.astype(np.float64, copy=False))
    return [Transfer(radiance[index].astype(np.float64), transmittance[index]) for index in range(radiance.shape[0])]


def group_depth_slices(slices: list[Transfer], group_count: int) -> list[Transfer]:
    require(bool(slices), "depth slices must not be empty")
    require(isinstance(group_count, int) and group_count > 0, "depth group count must be positive")
    require(group_count <= len(slices), "depth group count exceeds source slice count")
    groups: list[Transfer] = []
    for indices in np.array_split(np.arange(len(slices)), group_count):
        require(indices.size > 0, "depth grouping produced an empty group")
        groups.append(compose_transfer_sequence([slices[int(index)] for index in indices]))
    return groups


def tile_average(values: np.ndarray, tile_size: int) -> np.ndarray:
    require(isinstance(tile_size, int) and tile_size > 0, "tile size must be positive")
    height, width = values.shape[:2]
    rows = math.ceil(height / tile_size)
    columns = math.ceil(width / tile_size)
    result = np.empty((rows, columns, *values.shape[2:]), dtype=np.float64)
    for tile_y in range(rows):
        for tile_x in range(columns):
            block = values[
                tile_y * tile_size : min((tile_y + 1) * tile_size, height),
                tile_x * tile_size : min((tile_x + 1) * tile_size, width),
            ]
            result[tile_y, tile_x] = np.mean(block, axis=(0, 1), dtype=np.float64)
    return result


def expand_tiles(values: np.ndarray, tile_size: int, height: int, width: int) -> np.ndarray:
    expanded = np.repeat(np.repeat(values, tile_size, axis=0), tile_size, axis=1)
    return expanded[:height, :width]


def reduce_transfer_field(source: TransferInput, depth_groups: int, tile_size: int) -> TransferReduction:
    radiance = np.concatenate([source.ridge_radiance, source.nonridge_radiance], axis=-1)
    slices = transfer_slices(radiance, source.extinction)
    exact_groups = group_depth_slices(slices, depth_groups)
    depth_partitions = np.array_split(source.depths, depth_groups)
    group_depths = np.asarray([np.mean(partition) for partition in depth_partitions], dtype=np.float32)
    tiled_groups = [
        Transfer(
            tile_average(group.radiance, tile_size),
            tile_average(group.transmittance, tile_size),
        )
        for group in exact_groups
    ]
    _, height, width = source.shape
    return TransferReduction(
        tiled_groups,
        depths=group_depths,
        source_height=height,
        source_width=width,
        source_depth_slice_count=len(slices),
        tile_size=tile_size,
    )


def prune_transfer_field(source: TransferInput, element_budget: int) -> TransferReduction:
    require(isinstance(element_budget, int) and element_budget > 0, "pruning element budget must be positive")
    radiance = np.concatenate([source.ridge_radiance, source.nonridge_radiance], axis=-1)
    slices = transfer_slices(radiance, source.extinction)
    stacked_radiance = np.stack([item.radiance for item in slices])
    stacked_transmittance = np.stack([item.transmittance for item in slices])
    scores = np.sum(stacked_radiance, axis=-1) + (1.0 - stacked_transmittance)
    flat_scores = scores.reshape(-1)
    active_indices = np.flatnonzero(flat_scores > 1e-12)
    require(element_budget <= active_indices.size, "pruning budget exceeds active source elements")
    active_scores = flat_scores[active_indices]
    threshold = float(np.partition(active_scores, active_scores.size - element_budget)[active_scores.size - element_budget])
    selected = active_indices[active_scores > threshold]
    remaining = element_budget - selected.size
    if remaining:
        tied = active_indices[active_scores == threshold]
        selected = np.concatenate([selected, tied[:remaining]])
    require(selected.size == element_budget, "pruning did not preserve the exact requested budget")
    keep = np.zeros(flat_scores.shape, dtype=np.bool_)
    keep[selected] = True
    keep = keep.reshape(scores.shape)
    pruned_radiance = np.where(keep[..., None], stacked_radiance, 0.0)
    pruned_transmittance = np.where(keep, stacked_transmittance, 1.0)
    groups = [Transfer(pruned_radiance[index], pruned_transmittance[index]) for index in range(len(slices))]
    _, height, width = source.shape
    return TransferReduction(
        groups,
        depths=source.depths,
        source_height=height,
        source_width=width,
        source_depth_slice_count=len(slices),
        tile_size=1,
        identity="equal-active-element-local-optical-score-pruning-v0",
    )


def total_rgb(transfer: Transfer) -> np.ndarray:
    require(transfer.radiance.shape[-1] == 6, "transfer must preserve three Ridge and three Non-Ridge channels")
    return transfer.radiance[..., :3] + transfer.radiance[..., 3:6]


def render_transfer_field(source: TransferInput) -> np.ndarray:
    radiance = np.concatenate([source.ridge_radiance, source.nonridge_radiance], axis=-1)
    return total_rgb(compose_transfer_sequence(transfer_slices(radiance, source.extinction)))


def render_reduced_transfer(reduction: TransferReduction) -> np.ndarray:
    expanded = [
        Transfer(
            expand_tiles(group.radiance, reduction.tile_size, reduction.source_height, reduction.source_width),
            expand_tiles(group.transmittance, reduction.tile_size, reduction.source_height, reduction.source_width),
        )
        for group in reduction.groups
    ]
    return total_rgb(compose_transfer_sequence(expanded))


def expanded_reduction_groups(reduction: TransferReduction) -> list[Transfer]:
    return [
        Transfer(
            expand_tiles(group.radiance, reduction.tile_size, reduction.source_height, reduction.source_width),
            expand_tiles(group.transmittance, reduction.tile_size, reduction.source_height, reduction.source_width),
        )
        for group in reduction.groups
    ]


def render_transfer_field_with_occluder(
    source: TransferInput,
    occluder_depth: np.ndarray,
    occluder_rgb: np.ndarray,
) -> np.ndarray:
    radiance = np.concatenate([source.ridge_radiance, source.nonridge_radiance], axis=-1)
    role_color = np.concatenate([np.asarray(occluder_rgb), np.zeros(3, dtype=np.float32)])
    result = render_with_opaque_occluder(
        transfer_slices(radiance, source.extinction), source.depths, occluder_depth, role_color,
    )
    return result[..., :3] + result[..., 3:6]


def render_reduced_transfer_with_occluder(
    reduction: TransferReduction,
    occluder_depth: np.ndarray,
    occluder_rgb: np.ndarray,
) -> np.ndarray:
    role_color = np.concatenate([np.asarray(occluder_rgb), np.zeros(3, dtype=np.float32)])
    result = render_with_opaque_occluder(
        expanded_reduction_groups(reduction), reduction.depths, occluder_depth, role_color,
    )
    return result[..., :3] + result[..., 3:6]


def render_with_opaque_occluder(
    slices: list[Transfer],
    depths: np.ndarray,
    occluder_depth: np.ndarray,
    occluder_radiance: np.ndarray,
) -> np.ndarray:
    require(bool(slices), "occluder render needs depth slices")
    depths = np.asarray(depths)
    occluder_depth = np.asarray(occluder_depth)
    occluder_radiance = np.asarray(occluder_radiance)
    require(depths.shape == (len(slices),), "depth vector shape mismatch")
    require(np.all(np.diff(depths) > 0.0), "depths must be strictly near-to-far")
    require(occluder_depth.shape == slices[0].transmittance.shape, "occluder depth shape mismatch")
    require(occluder_radiance.shape == (slices[0].radiance.shape[-1],), "occluder channel shape mismatch")
    result = identity_transfer(occluder_depth.shape, slices[0].radiance.shape[-1])
    for depth, transfer in zip(depths, slices):
        mask = depth < occluder_depth
        result.radiance = np.where(
            mask[..., None],
            result.radiance + result.transmittance[..., None] * transfer.radiance,
            result.radiance,
        )
        result.transmittance = np.where(mask, result.transmittance * transfer.transmittance, result.transmittance)
    return result.radiance + result.transmittance[..., None] * occluder_radiance


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"{label} JSON could not be read: {exc}") from exc
    require(isinstance(value, dict), f"{label} must be a JSON object")
    return value


def load_transfer_input(manifest_path: Path | str) -> TransferInput:
    manifest_path = Path(manifest_path).resolve()
    require(manifest_path.is_file(), f"input manifest is missing: {manifest_path}")
    manifest = load_json(manifest_path, "input manifest")
    require(manifest.get("schema") == INPUT_SCHEMA, f"input schema must be {INPUT_SCHEMA}")
    require(manifest.get("status") == "complete", "input manifest is not complete")
    source = manifest.get("source") or {}
    for key in ("identity", "stateIdentity", "cameraIdentity"):
        require(isinstance(source.get(key), str) and source[key], f"source {key} is missing")
    route = manifest.get("route") or {}
    for key in ("requested", "effective", "backend"):
        require(isinstance(route.get(key), str) and route[key], f"route {key} is missing")
    require(route.get("requested") == route.get("effective"), "requested/effective route mismatch")
    require(route.get("fallbackUsed") is False, "route fallback is forbidden")
    require(route.get("fallbackIdentity") is None, "route fallback identity must be null")
    transfer = manifest.get("transfer") or {}
    require(transfer.get("identity") == TRANSFER_IDENTITY, "transfer identity drifted")
    require(transfer.get("depthOrder") == DEPTH_ORDER, "transfer depth order drifted")
    require(transfer.get("radianceBoundary") == RADIANCE_BOUNDARY, "radiance boundary drifted")
    require(transfer.get("transmittanceBoundary") == TRANSMITTANCE_BOUNDARY, "transmittance boundary drifted")
    shape = transfer.get("shape")
    require(
        isinstance(shape, list) and len(shape) == 3 and all(isinstance(value, int) and value > 0 for value in shape),
        "transfer shape must contain positive depth, height, and width",
    )
    descriptor = (manifest.get("artifacts") or {}).get("arrays") or {}
    relative_path = descriptor.get("path")
    require(isinstance(relative_path, str) and relative_path, "arrays artifact path is missing")
    arrays_path = Path(relative_path)
    if not arrays_path.is_absolute():
        arrays_path = (manifest_path.parent / arrays_path).resolve()
    require(arrays_path.is_file(), f"arrays artifact is missing: {arrays_path}")
    require(descriptor.get("bytes") == arrays_path.stat().st_size, "arrays artifact byte length drifted")
    arrays_sha256 = sha256_file(arrays_path)
    require(descriptor.get("sha256") == arrays_sha256, "arrays artifact sha256 drifted")
    try:
        with np.load(arrays_path, allow_pickle=False) as arrays:
            required = {"depths", "ridge_radiance", "nonridge_radiance", "extinction"}
            require(required.issubset(arrays.files), "arrays artifact is partial")
            depths = np.asarray(arrays["depths"], dtype=np.float32)
            ridge = np.asarray(arrays["ridge_radiance"], dtype=np.float32)
            nonridge = np.asarray(arrays["nonridge_radiance"], dtype=np.float32)
            extinction = np.asarray(arrays["extinction"], dtype=np.float32)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"arrays artifact could not be read: {exc}") from exc
    expected_shape = tuple(shape)
    require(depths.shape == (expected_shape[0],), "depth array shape drifted")
    require(ridge.shape == (*expected_shape, 3), "Ridge radiance shape drifted")
    require(nonridge.shape == (*expected_shape, 3), "Non-Ridge radiance shape drifted")
    require(extinction.shape == expected_shape, "extinction shape drifted")
    require(np.all(np.diff(depths) > 0.0), "depths must be strictly near-to-far")
    require(np.all(np.isfinite(depths)), "depths are not finite")
    require(np.all(np.isfinite(ridge)) and np.all(ridge >= 0.0), "Ridge radiance is invalid")
    require(np.all(np.isfinite(nonridge)) and np.all(nonridge >= 0.0), "Non-Ridge radiance is invalid")
    require(np.all(np.isfinite(extinction)) and np.all(extinction >= 0.0), "extinction is invalid")
    return TransferInput(
        depths,
        ridge,
        nonridge,
        extinction,
        manifest,
        manifest_path,
        sha256_file(manifest_path),
        arrays_path,
        arrays_sha256,
    )


def image_metrics(candidate: np.ndarray, reference: np.ndarray) -> dict[str, float]:
    delta = candidate.astype(np.float64) - reference.astype(np.float64)
    return {
        "mae": float(np.mean(np.abs(delta))),
        "mse": float(np.mean(np.square(delta))),
        "maxAbsError": float(np.max(np.abs(delta), initial=0.0)),
    }


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--depth-groups", required=True, type=int)
    parser.add_argument("--tile-size", required=True, type=int)
    return parser.parse_args()


def run_cli(args: argparse.Namespace) -> dict[str, Any]:
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "report.json"
    treatment_path = out_dir / "treatment.npz"
    if treatment_path.exists():
        treatment_path.unlink()
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "status": "running",
        "failurePhase": "input-validation",
        "requested": {
            "inputManifest": str(Path(args.input_manifest).resolve()),
            "depthGroups": args.depth_groups,
            "tileSize": args.tile_size,
        },
        "effective": None,
        "source": None,
        "artifacts": {"treatment": None},
    }
    write_json(report_path, report)
    try:
        require(args.depth_groups > 0, "depth group count must be positive")
        require(args.tile_size > 0, "tile size must be positive")
        source = load_transfer_input(args.input_manifest)
        report["source"] = {
            "identity": source.manifest["source"],
            "manifestPath": str(source.manifest_path),
            "manifestSha256": source.manifest_sha256,
            "arraysPath": str(source.arrays_path),
            "arraysSha256": source.arrays_sha256,
            "route": source.manifest["route"],
        }
        report["failurePhase"] = "reduction"
        reduction = reduce_transfer_field(source, args.depth_groups, args.tile_size)
        reference = render_transfer_field(source)
        treatment = render_reduced_transfer(reduction)
        group_radiance = np.stack([group.radiance for group in reduction.groups]).astype(np.float32)
        group_transmittance = np.stack([group.transmittance for group in reduction.groups]).astype(np.float32)
        np.savez(
            treatment_path,
            depths=reduction.depths,
            radiance=group_radiance,
            transmittance=group_transmittance,
        )
        report["failurePhase"] = "output-validation"
        require(treatment_path.is_file() and treatment_path.stat().st_size > 0, "primary treatment output is missing or blank")
        report["effective"] = {
            "identity": reduction.identity,
            "depthGroups": args.depth_groups,
            "tileSize": args.tile_size,
            "sourceDepthSlices": source.shape[0],
            "sourceHeight": source.shape[1],
            "sourceWidth": source.shape[2],
            "elementCount": reduction.element_count,
            "activeElementCount": reduction.active_element_count,
            "fallbackUsed": False,
            "ignoredParameters": None,
        }
        report["metrics"] = image_metrics(treatment, reference)
        report["artifacts"]["treatment"] = {
            "path": str(treatment_path),
            "bytes": treatment_path.stat().st_size,
            "sha256": sha256_file(treatment_path),
        }
        report["status"] = "complete"
        report["failurePhase"] = None
        write_json(report_path, report)
        return report
    except Exception as exc:
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()
        report["artifacts"]["treatment"] = None
        if treatment_path.exists():
            treatment_path.unlink()
        write_json(report_path, report)
        raise


def main() -> int:
    args = parse_args()
    try:
        run_cli(args)
    except Exception as exc:
        print(f"view-conditioned transfer compression failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
