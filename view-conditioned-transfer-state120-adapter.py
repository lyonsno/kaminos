#!/usr/bin/env python3
"""Export one authenticated coefficient-oracle camera as a transfer field."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np


ROOT = Path(__file__).resolve().parent
ORACLE_PATH = ROOT / "volume-layer-coefficient-render-oracle.py"
INPUT_SCHEMA = "kaminos.view-conditioned-transfer-input.v0"
ADAPTER_REPORT_SCHEMA = "kaminos.view-conditioned-transfer-adapter-report.v0"
TRANSFER_IDENTITY = "ordered-ridge-nonridge-shared-transmittance-v0"
ADAPTER_ROUTE = "state120-coefficient-plane-export-v0"


class ArgumentParseFailure(ValueError):
    pass


class AdapterArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ArgumentParseFailure(message)


def load_oracle():
    require(ORACLE_PATH.is_file(), f"coefficient oracle is missing: {ORACLE_PATH}")
    spec = importlib.util.spec_from_file_location("volume_layer_coefficient_render_oracle", ORACLE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(chunk_size)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def remove_primary_outputs(out_dir: Path) -> None:
    for name in ("input-manifest.json", "transfer-field.npz"):
        path = out_dir / name
        if path.exists():
            path.unlink()


def validate_route(route: dict[str, Any]) -> None:
    for key in ("requested", "effective", "backend"):
        require(isinstance(route.get(key), str) and route[key], f"route {key} is missing")
    require(route["requested"] == route["effective"], "requested/effective route mismatch")
    require(route.get("fallbackUsed") is False, "adapter route fallback is forbidden")
    require(route.get("fallbackIdentity") is None, "adapter fallback identity must be null")


def planes_to_transfer_arrays(
    planes: np.ndarray,
    near_depth: float,
    far_depth: float,
    path_scale: float,
) -> dict[str, np.ndarray]:
    planes = np.asarray(planes)
    require(planes.ndim == 4 and planes.shape[-1] == 8, "coefficient planes must have shape [depth,height,width,8]")
    require(np.all(np.isfinite(planes)) and np.all(planes >= 0.0), "coefficient planes are invalid")
    require(math.isfinite(near_depth), "near depth must be finite")
    require(math.isfinite(far_depth) and far_depth > near_depth, "far depth must be finite and greater than near depth")
    require(math.isfinite(path_scale) and path_scale > 0.0, "path scale must be finite and positive")
    edges = np.linspace(near_depth, far_depth, planes.shape[0] + 1, dtype=np.float64)
    depths = ((edges[:-1] + edges[1:]) * 0.5).astype(np.float32)
    return {
        "depths": depths,
        "ridge_radiance": (planes[..., 0:3] * path_scale).astype(np.float32),
        "nonridge_radiance": (planes[..., 4:7] * path_scale).astype(np.float32),
        "extinction": ((planes[..., 3] + planes[..., 7]) * path_scale).astype(np.float32),
    }


def write_transfer_product(
    out_dir: Path,
    planes: np.ndarray,
    near_depth: float,
    far_depth: float,
    path_scale: float,
    source: dict[str, Any],
    route: dict[str, Any],
) -> Path:
    out_dir = Path(out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    validate_route(route)
    for key in ("identity", "stateIdentity", "cameraIdentity"):
        require(isinstance(source.get(key), str) and source[key], f"source {key} is missing")
    arrays = planes_to_transfer_arrays(planes, near_depth, far_depth, path_scale)
    arrays_path = out_dir / "transfer-field.npz"
    manifest_path = out_dir / "input-manifest.json"
    if arrays_path.exists():
        arrays_path.unlink()
    if manifest_path.exists():
        manifest_path.unlink()
    np.savez(arrays_path, **arrays)
    require(arrays_path.is_file() and arrays_path.stat().st_size > 0, "transfer arrays output is missing or blank")
    depth, height, width = arrays["extinction"].shape
    manifest = {
        "schema": INPUT_SCHEMA,
        "status": "complete",
        "source": source,
        "route": route,
        "transfer": {
            "identity": TRANSFER_IDENTITY,
            "depthOrder": "near-to-far",
            "radianceBoundary": "premultiplied-per-depth-slice-v0",
            "transmittanceBoundary": "exp-negative-extinction-v0",
            "shape": [int(depth), int(height), int(width)],
            "pathScale": float(path_scale),
            "nearDepth": float(near_depth),
            "farDepth": float(far_depth),
            "ridgeNonRidgeRolesPreserved": True,
        },
        "artifacts": {
            "arrays": {
                "path": arrays_path.name,
                "bytes": arrays_path.stat().st_size,
                "sha256": sha256_file(arrays_path),
            }
        },
    }
    write_json(manifest_path, manifest)
    return manifest_path


def resolve_ellipse_controls(oracle: Any) -> dict[str, Any]:
    args = argparse.Namespace(
        footprint_mode="ellipse",
        skirt_mix=None,
        skirt_minor_scale=None,
        skirt_ridge_rejection=None,
        compound_halo_mass=None,
        split_attribution_cameras=None,
        split_score_threshold=None,
        split_min_camera_support=None,
        split_offset_world=None,
    )
    return oracle.resolve_footprint_controls(args)


def export_state_camera(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    oracle = load_oracle()
    manifest_path = Path(args.manifest).resolve()
    capture_path = Path(args.capture_report).resolve()
    report["failurePhase"] = "source-manifest-validation"
    manifest = oracle.load_json(manifest_path, "training manifest")
    state, paths, descriptor_receipt = oracle.validate_manifest(
        manifest, manifest_path, args.state_step, True,
    )
    required = {"features", "admission", "coefficients", "kernelDescriptors", "nativeCellIndices"}
    require(required.issubset(paths), f"adapter requires row artifacts: {sorted(required - set(paths))}")
    state_step = int((state.get("replay") or {}).get("completedSteps"))
    report["failurePhase"] = "capture-validation"
    capture_report = oracle.load_json(capture_path, "capture report")
    cameras = oracle.validate_capture_report(capture_report, state_step)
    camera = cameras[args.camera_index]
    descriptor_hashes = descriptor_receipt.get("sourceHashes") or {}
    capture_config = capture_report.get("captureConfig") or {}
    require(
        descriptor_hashes.get("fluidSha256") == capture_config.get("expectedAnchorFluidSha256"),
        "coefficient descriptor fluid hash does not match the frozen orbit anchor",
    )
    require(
        descriptor_hashes.get("frontSha256") == capture_config.get("expectedAnchorFrontSha256"),
        "coefficient descriptor front hash does not match the frozen orbit anchor",
    )
    report["failurePhase"] = "row-artifact-load"
    count = int(state["rows"]["count"])
    features = np.memmap(paths["features"], dtype="<f4", mode="r", shape=(count, 24))
    coefficients = np.memmap(paths["coefficients"], dtype="<f4", mode="r", shape=(count, 8))
    descriptors = np.memmap(paths["kernelDescriptors"], dtype="<f4", mode="r", shape=(count, 100))
    indices = np.memmap(paths["nativeCellIndices"], dtype="<u4", mode="r", shape=(count,))
    require(np.array_equal(np.rint(descriptors[:, 3]).astype(np.uint32), indices), "descriptor/native-index row order drifted")
    require(np.all(np.isfinite(coefficients)) and np.all(coefficients >= 0.0), "coefficients are invalid")
    report["failurePhase"] = "camera-raster"
    controls = resolve_ellipse_controls(oracle)
    planes, raster_receipt = oracle.rasterize_coefficients(
        descriptors[:, 0:3],
        descriptors[:, 20:23],
        features,
        coefficients,
        camera,
        args.depth_bins,
        "ellipse",
        controls,
    )
    source = {
        "identity": "state120-exact-expanded-union-coefficient-planes-v0",
        "stateIdentity": state.get("id") or f"coefficient-state-{state_step}",
        "cameraIdentity": camera.get("cameraPoseHash"),
        "sourceManifestPath": str(manifest_path),
        "sourceManifestSha256": sha256_file(manifest_path),
        "captureReportPath": str(capture_path),
        "captureReportSha256": sha256_file(capture_path),
        "sourceManifestRecordedSha256": descriptor_receipt.get("sourceManifestSha256"),
        "nativeCellIndexSha256": descriptor_receipt.get("indexSha256"),
        "descriptorSha256": descriptor_receipt.get("descriptorSha256"),
        "fluidSha256": descriptor_hashes.get("fluidSha256"),
        "frontSha256": descriptor_hashes.get("frontSha256"),
        "rowCount": count,
        "sampleCap": None,
        "droppedRowCount": 0,
        "stateStep": state_step,
        "cameraIndex": args.camera_index,
        "cameraAngle": camera.get("cameraAngle"),
        "sameStateCaptureId": (capture_report.get("frozenState") or {}).get("sameStateCaptureId"),
        "sourceRendererRoute": camera.get("effectiveRoute"),
        "sourceBackend": camera.get("backend"),
    }
    route = {
        "requested": ADAPTER_ROUTE,
        "effective": ADAPTER_ROUTE,
        "backend": "numpy-cpu-v0",
        "fallbackUsed": False,
        "fallbackIdentity": None,
    }
    report["failurePhase"] = "product-write"
    product_manifest = write_transfer_product(
        Path(args.out_dir),
        planes,
        raster_receipt["nearDepth"],
        raster_receipt["farDepth"],
        args.path_scale,
        source,
        route,
    )
    report["source"] = source
    report["effective"] = {
        "adapterRoute": ADAPTER_ROUTE,
        "backend": "numpy-cpu-v0",
        "fallbackUsed": False,
        "ignoredParameters": None,
        "footprintMode": oracle.footprint_identity("ellipse"),
        "depthBins": args.depth_bins,
        "pathScale": args.path_scale,
        "raster": raster_receipt,
    }
    report["artifacts"] = {
        "inputManifest": {
            "path": str(product_manifest),
            "bytes": product_manifest.stat().st_size,
            "sha256": sha256_file(product_manifest),
        },
        "arrays": json.loads(product_manifest.read_text())["artifacts"]["arrays"],
    }
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = AdapterArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--capture-report", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--state-step", type=int, default=120)
    parser.add_argument("--camera-index", type=int, default=10, choices=range(21))
    parser.add_argument("--depth-bins", type=int, default=96)
    parser.add_argument("--path-scale", type=float, required=True)
    return parser.parse_args(argv)


def resolve_out_dir_argument(argv: list[str]) -> Path | None:
    value: str | None = None
    for index, token in enumerate(argv):
        if token == "--out-dir" and index + 1 < len(argv):
            value = argv[index + 1]
        elif token.startswith("--out-dir="):
            value = token.split("=", 1)[1]
    return Path(value).resolve() if value else None


def write_argument_failure(out_dir: Path, argv: list[str], error: Exception) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    remove_primary_outputs(out_dir)
    write_json(out_dir / "adapter-report.json", {
        "schema": ADAPTER_REPORT_SCHEMA,
        "status": "failed",
        "failurePhase": "argument-validation",
        "error": f"{type(error).__name__}: {error}",
        "requested": {
            "argv": argv,
            "outDir": str(out_dir),
            "sourceHashVerification": "required-complete",
            "sampleCap": None,
        },
        "effective": None,
        "source": None,
        "artifacts": None,
    })


def run_cli(args: argparse.Namespace) -> dict[str, Any]:
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    remove_primary_outputs(out_dir)
    report_path = out_dir / "adapter-report.json"
    report: dict[str, Any] = {
        "schema": ADAPTER_REPORT_SCHEMA,
        "status": "running",
        "failurePhase": "argument-validation",
        "requested": {
            "manifest": str(Path(args.manifest).resolve()),
            "captureReport": str(Path(args.capture_report).resolve()),
            "stateStep": args.state_step,
            "cameraIndex": args.camera_index,
            "depthBins": args.depth_bins,
            "pathScale": args.path_scale,
            "sourceHashVerification": "required-complete",
            "sampleCap": None,
        },
        "effective": None,
        "source": None,
        "artifacts": None,
    }
    write_json(report_path, report)
    try:
        require(args.depth_bins > 0, "depth bins must be positive")
        require(math.isfinite(args.path_scale) and args.path_scale > 0.0, "path scale must be finite and positive")
        report = export_state_camera(args, report)
        report["status"] = "complete"
        report["failurePhase"] = None
        write_json(report_path, report)
        return report
    except Exception as exc:
        remove_primary_outputs(out_dir)
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()
        write_json(report_path, report)
        raise


def main() -> int:
    argv = sys.argv[1:]
    try:
        args = parse_args(argv)
    except ArgumentParseFailure as exc:
        out_dir = resolve_out_dir_argument(argv)
        if out_dir is not None:
            try:
                write_argument_failure(out_dir, argv, exc)
            except Exception as report_exc:
                print(f"state-120 transfer adapter argument-report failure: {report_exc}", file=sys.stderr)
        print(f"state-120 transfer adapter argument failure: {exc}", file=sys.stderr)
        return 2
    try:
        run_cli(args)
    except Exception as exc:
        print(f"state-120 transfer adapter failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
