#!/usr/bin/env python3
"""Export authenticated dense and reduced transfers for an isolated WebGPU benchmark."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parent
OCCLUDER_WITNESS_PATH = ROOT / "view-conditioned-transfer-occluder-witness.py"
SCHEMA = "kaminos.view-conditioned-transfer-gpu-input.v0"
REPORT_NAME = "gpu-input-report.json"
MANIFEST_NAME = "gpu-input-manifest.json"


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"could not load {name}: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


occluder = load_module(OCCLUDER_WITNESS_PATH, "view_conditioned_transfer_gpu_export_occluder")
base = occluder.base
reducer = occluder.reducer


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def rgba(values: np.ndarray, alpha: float = 0.0) -> np.ndarray:
    require(values.shape[-1] == 3, "RGB input must have three channels")
    result = np.empty((*values.shape[:-1], 4), dtype=np.float32)
    result[..., :3] = values.astype(np.float32, copy=False)
    result[..., 3] = alpha
    return result


def descriptor(path: Path, shape: tuple[int, ...], role: str) -> dict[str, Any]:
    return {
        "path": path.name,
        "role": role,
        "dtype": "float32-little-endian",
        "shape": list(shape),
        "bytes": path.stat().st_size,
        "sha256": reducer.sha256_file(path),
    }


def write_array(out_dir: Path, name: str, values: np.ndarray, role: str) -> dict[str, Any]:
    path = out_dir / name
    contiguous = np.ascontiguousarray(values, dtype="<f4")
    contiguous.tofile(path)
    require(path.is_file() and path.stat().st_size == contiguous.size * 4, f"binary output is partial: {name}")
    return descriptor(path, contiguous.shape, role)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--input-manifest", required=True)
    parser.add_argument("--treatment-report", required=True)
    parser.add_argument("--treatment-label", required=True)
    parser.add_argument("--out-dir", required=True)
    return parser.parse_args(argv)


def run(args: argparse.Namespace) -> dict[str, Any]:
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / REPORT_NAME
    manifest_path = out_dir / MANIFEST_NAME
    binary_names = {
        "dense-ridge-rgba.f32",
        "dense-nonridge-rgba.f32",
        "dense-transmittance.f32",
        "dense-depths.f32",
        "reduced-ridge-rgba.f32",
        "reduced-nonridge-rgba.f32",
        "reduced-transmittance.f32",
        "reduced-depths.f32",
        "occluder-depth.f32",
        "dense-expected-rgba.f32",
        "reduced-expected-rgba.f32",
    }
    for name in binary_names | {MANIFEST_NAME}:
        path = out_dir / name
        if path.exists():
            path.unlink()
    report: dict[str, Any] = {
        "schema": SCHEMA,
        "status": "running",
        "failurePhase": "input-validation",
        "requested": {
            "inputManifest": str(Path(args.input_manifest).resolve()),
            "treatmentReport": str(Path(args.treatment_report).resolve()),
            "treatmentLabel": args.treatment_label,
            "outDir": str(out_dir),
        },
        "effective": None,
        "repo": base.git_generator_identity(),
        "source": None,
        "treatment": None,
        "geometry": None,
        "artifacts": {},
    }
    write_json(report_path, report)
    try:
        source = reducer.load_transfer_input(args.input_manifest)
        reference = reducer.render_transfer_field(source)
        # load_treatment authentication is delegated to the reviewed wrapper below.
        reduced_unoccluded, metadata, reduction = occluder.load_authenticated_reduction(
            args.treatment_label,
            Path(args.treatment_report).resolve(),
            source,
            reference,
        )
        require(metadata["label"] == args.treatment_label, "effective treatment label drifted")
        report["failurePhase"] = "geometry-construction"
        depth_map, geometry = occluder.build_occluder_geometry(source, [reduction])
        occluder_rgb = np.zeros(3, dtype=np.float32)
        dense_expected = reducer.render_transfer_field_with_occluder(source, depth_map, occluder_rgb)
        reduced_expected = reducer.render_reduced_transfer_with_occluder(reduction, depth_map, occluder_rgb)
        require(np.max(np.abs(reduced_unoccluded - reducer.render_reduced_transfer(reduction))) <= 1e-7, "reloaded reduction drifted")

        report["failurePhase"] = "binary-export"
        artifacts: dict[str, Any] = {}
        artifacts["denseRidge"] = write_array(out_dir, "dense-ridge-rgba.f32", rgba(source.ridge_radiance), "dense-ridge-rgba-storage")
        artifacts["denseNonridge"] = write_array(out_dir, "dense-nonridge-rgba.f32", rgba(source.nonridge_radiance), "dense-nonridge-rgba-storage")
        artifacts["denseTransmittance"] = write_array(
            out_dir,
            "dense-transmittance.f32",
            np.exp(-source.extinction.astype(np.float64)).astype(np.float32),
            "dense-per-slice-transmittance-storage",
        )
        artifacts["denseDepths"] = write_array(out_dir, "dense-depths.f32", source.depths, "dense-near-to-far-depths")
        reduced_radiance = np.stack([group.radiance for group in reduction.groups]).astype(np.float32)
        reduced_transmittance = np.stack([group.transmittance for group in reduction.groups]).astype(np.float32)
        artifacts["reducedRidge"] = write_array(out_dir, "reduced-ridge-rgba.f32", rgba(reduced_radiance[..., :3]), "reduced-ridge-rgba-storage")
        artifacts["reducedNonridge"] = write_array(out_dir, "reduced-nonridge-rgba.f32", rgba(reduced_radiance[..., 3:6]), "reduced-nonridge-rgba-storage")
        artifacts["reducedTransmittance"] = write_array(out_dir, "reduced-transmittance.f32", reduced_transmittance, "reduced-group-transmittance-storage")
        artifacts["reducedDepths"] = write_array(out_dir, "reduced-depths.f32", reduction.depths, "reduced-representative-depths")
        artifacts["occluderDepth"] = write_array(out_dir, "occluder-depth.f32", depth_map, "per-pixel-opaque-scene-depth")
        artifacts["denseExpected"] = write_array(out_dir, "dense-expected-rgba.f32", rgba(dense_expected, alpha=1.0), "cpu-dense-occluded-reference")
        artifacts["reducedExpected"] = write_array(out_dir, "reduced-expected-rgba.f32", rgba(reduced_expected, alpha=1.0), "cpu-reduced-occluded-reference")

        report["failurePhase"] = "output-validation"
        report["source"] = {
            "manifestPath": str(source.manifest_path),
            "manifestSha256": source.manifest_sha256,
            "arraysPath": str(source.arrays_path),
            "arraysSha256": source.arrays_sha256,
            "identity": source.manifest["source"],
            "route": source.manifest["route"],
            "shape": list(source.shape),
        }
        report["treatment"] = metadata
        report["geometry"] = geometry
        report["artifacts"] = artifacts
        report["effective"] = {
            "identity": "authenticated-dense-vs-reduced-webgpu-input-v0",
            "denseCompositor": "dense-96-bin-compositor-v0",
            "reducedCompositor": "reduced-depth-tile-compositor-v0",
            "denseShape": list(source.shape),
            "reducedShape": [len(reduction.groups), reduction.groups[0].transmittance.shape[0], reduction.groups[0].transmittance.shape[1]],
            "tileSize": reduction.tile_size,
            "outputShape": [source.shape[1], source.shape[2]],
            "backend": "numpy-cpu-export-v0",
            "fallbackUsed": False,
            "ignoredParameters": None,
            "caps": None,
        }
        report["status"] = "complete"
        report["failurePhase"] = None
        write_json(manifest_path, report)
        report["manifest"] = descriptor(manifest_path, (), "webgpu-input-manifest")
        write_json(report_path, report)
        return report
    except Exception as exc:
        for name in binary_names | {MANIFEST_NAME}:
            path = out_dir / name
            if path.exists():
                path.unlink()
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()
        report["artifacts"] = {}
        write_json(report_path, report)
        raise


def main() -> int:
    args = parse_args()
    try:
        run(args)
    except Exception as exc:
        print(f"view-conditioned transfer GPU export failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
