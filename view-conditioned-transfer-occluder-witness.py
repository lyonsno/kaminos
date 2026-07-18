#!/usr/bin/env python3
"""Render authenticated transfer reductions through adversarial scene-depth geometry."""

from __future__ import annotations

import argparse
import importlib.util
import json
import shlex
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
BASE_WITNESS_PATH = ROOT / "view-conditioned-transfer-witness.py"
REPORT_SCHEMA = "kaminos.view-conditioned-transfer-occluder-witness.v0"
GEOMETRY_IDENTITY = "interleaved-intragroup-plates-v0"
DEPTH_SELECTION_POLICY = "alternating-quarter-span-v0"
SHEET_NAME = "annotated-occluder-sheet.png"
OUTPUT_OPTIONS = {"--input-manifest", "--geometry", "--occluder-rgb", "--out-dir", "--treatment"}


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"could not load {name}: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


base = load_module(BASE_WITNESS_PATH, "view_conditioned_transfer_base_for_occluder")
reducer = base.reducer
oracle = base.oracle


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def cleanup_outputs(out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in out_dir.glob("*.png"):
        if path.is_file() or path.is_symlink():
            path.unlink()
    readme_path = out_dir / "README.md"
    if readme_path.exists():
        readme_path.unlink()


def exact_option_value(argv: list[str], option: str) -> str | None:
    values: list[str] = []
    for index, token in enumerate(argv):
        if token == option and index + 1 < len(argv):
            values.append(argv[index + 1])
        elif token.startswith(option + "="):
            values.append(token.split("=", 1)[1])
    return values[0] if len(values) == 1 and values[0] else None


def reject_abbreviated_options(argv: list[str]) -> None:
    unknown = []
    for token in argv:
        if not token.startswith("--"):
            continue
        name = token.split("=", 1)[0]
        if name not in OUTPUT_OPTIONS:
            unknown.append(name)
    require(not unknown, "unrecognized arguments: " + " ".join(unknown))


def parse_rgb(value: str) -> np.ndarray:
    try:
        parts = [float(item) for item in value.split(",")]
    except ValueError as exc:
        raise ValueError("occluder RGB must contain three comma-separated finite numbers") from exc
    require(len(parts) == 3, "occluder RGB must contain exactly three channels")
    rgb = np.asarray(parts, dtype=np.float32)
    require(np.all(np.isfinite(rgb)), "occluder RGB is not finite")
    require(np.all(rgb >= 0.0), "occluder RGB is negative")
    return rgb


def load_authenticated_reduction(
    label: str,
    report_path: Path,
    source,
    reference_linear: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any], Any]:
    rendered, metadata = base.load_treatment(label, report_path, source, reference_linear)
    treatment_path = Path(metadata["treatmentPath"])
    with np.load(treatment_path, allow_pickle=False) as arrays:
        depths = np.asarray(arrays["depths"], dtype=np.float32)
        radiance = np.asarray(arrays["radiance"], dtype=np.float32)
        transmittance = np.asarray(arrays["transmittance"], dtype=np.float32)
    depth_groups = metadata["depthGroups"]
    spans = np.asarray(metadata["occlusionAuthority"]["sourceDepthCenterSpans"], dtype=np.float32)
    reduction = reducer.TransferReduction(
        [reducer.Transfer(radiance[index], transmittance[index]) for index in range(depth_groups)],
        depths=depths,
        depth_spans=spans,
        source_height=source.shape[1],
        source_width=source.shape[2],
        source_depth_slice_count=source.shape[0],
        tile_size=metadata["tileSize"],
        identity=metadata["occlusionAuthority"].get("identity", ""),
    )
    return rendered, metadata, reduction


def plate_masks(height: int, width: int) -> list[np.ndarray]:
    yy, xx = np.mgrid[:height, :width]
    x = (xx + 0.5) / width
    y = (yy + 0.5) / height
    half_width = max(1.25 / width, 0.035)
    centers = (0.31, 0.50, 0.69)
    slopes = (0.10, 0.0, -0.10)
    masks = []
    for center, slope in zip(centers, slopes):
        axis = center + slope * (y - 0.5)
        masks.append((np.abs(x - axis) <= half_width) & (y >= 0.08) & (y <= 0.92))
    return masks


def build_occluder_geometry(source, reductions: list[Any]) -> tuple[np.ndarray, dict[str, Any]]:
    require(bool(reductions), "occluder geometry needs at least one treatment")
    spans = reductions[0].depth_spans
    require(len(spans) >= 3, "occluder geometry needs at least three depth groups")
    require(np.all(spans[:, 1] > spans[:, 0]), "occluder geometry needs non-degenerate group spans")
    for reduction in reductions[1:]:
        require(
            reduction.depth_spans.shape == spans.shape and np.allclose(reduction.depth_spans, spans, atol=1e-7),
            "occluder treatments must share one authenticated depth partition",
        )
    group_indices = np.rint(np.linspace(0, len(spans) - 1, 3)).astype(int)
    require(len(set(group_indices.tolist())) == 3, "occluder depth group selection collapsed")
    fractions = (0.25, 0.75, 0.25)
    height, width = source.shape[1:]
    depth_map = np.full((height, width), np.inf, dtype=np.float32)
    masks = plate_masks(height, width)
    plates = []
    for plate_index, (mask, group_index, fraction) in enumerate(zip(masks, group_indices, fractions)):
        low, high = (float(value) for value in spans[group_index])
        depth = low + fraction * (high - low)
        require(low < depth < high, "occluder plate depth is not inside its group")
        depth_map[mask] = depth
        plates.append({
            "plateIndex": plate_index,
            "groupIndex": int(group_index),
            "sourceDepthCenterSpan": [low, high],
            "spanFraction": fraction,
            "depth": depth,
            "pixelCount": int(np.count_nonzero(mask)),
        })
    finite = np.isfinite(depth_map)
    source_active = (
        np.any(np.sum(source.ridge_radiance + source.nonridge_radiance, axis=0) > 1e-12, axis=-1)
        | (np.sum(source.extinction, axis=0) > 1e-12)
    )
    intersection_count = int(np.count_nonzero(finite & source_active))
    require(np.count_nonzero(finite) > 0, "occluder geometry is blank")
    require(intersection_count > 0, "occluder geometry misses all active transfer support")
    return depth_map, {
        "identity": GEOMETRY_IDENTITY,
        "depthSelectionPolicy": DEPTH_SELECTION_POLICY,
        "plateCount": len(plates),
        "plates": plates,
        "finitePixelCount": int(np.count_nonzero(finite)),
        "sourceActiveIntersectionPixelCount": intersection_count,
        "backgroundDepth": "positive-infinity-no-opaque-geometry",
    }


def interior_occluder_mask(depth_map: np.ndarray, spans: np.ndarray) -> np.ndarray:
    result = np.zeros(depth_map.shape, dtype=np.bool_)
    for low, high in spans:
        result |= (depth_map > float(low)) & (depth_map < float(high))
    return result


def masked_metrics(candidate: np.ndarray, reference: np.ndarray, mask: np.ndarray) -> dict[str, float]:
    require(mask.shape == candidate.shape[:2], "metric mask shape drifted")
    require(np.count_nonzero(mask) > 0, "metric mask is empty")
    return reducer.image_metrics(candidate[mask], reference[mask])


def occlusion_specific_pixels(
    candidate_occluded: np.ndarray,
    exact_occluded: np.ndarray,
    candidate_unoccluded: np.ndarray,
    exact_unoccluded: np.ndarray,
) -> np.ndarray:
    occluded_error = candidate_occluded.astype(np.int16) - exact_occluded.astype(np.int16)
    baseline_error = candidate_unoccluded.astype(np.int16) - exact_unoccluded.astype(np.int16)
    return np.clip(np.abs(occluded_error - baseline_error) * 4, 0, 255).astype(np.uint8)


def depth_map_pixels(depth_map: np.ndarray, source_depths: np.ndarray) -> np.ndarray:
    image = np.full((*depth_map.shape, 3), 10, dtype=np.uint8)
    finite = np.isfinite(depth_map)
    near = float(source_depths[0])
    far = float(source_depths[-1])
    normalized = np.zeros(depth_map.shape, dtype=np.float64)
    normalized[finite] = np.clip((depth_map[finite] - near) / (far - near), 0.0, 1.0)
    t = normalized[finite]
    image[finite, 0] = np.rint(255.0 * t).astype(np.uint8)
    image[finite, 1] = np.rint(255.0 * (1.0 - np.abs(2.0 * t - 1.0))).astype(np.uint8)
    image[finite, 2] = np.rint(255.0 * (1.0 - t)).astype(np.uint8)
    return image


def build_sheet(
    unoccluded: np.ndarray,
    exact_occluded: np.ndarray,
    depth_visual: np.ndarray,
    treatments: list[dict[str, Any]],
    geometry: dict[str, Any],
) -> Image.Image:
    image_height, image_width = unoccluded.shape[:2]
    panel_width = max(image_width + 20, 334)
    title_height = 92
    rows: list[list[Image.Image]] = [[
        base.make_panel(
            Image.fromarray(unoccluded, mode="RGB"),
            "UNINTERRUPTED 96-BIN CONTROL",
            ["exact adapted transfer", "matte-black background"],
            (94, 205, 146),
            panel_width,
        ),
        base.make_panel(
            Image.fromarray(exact_occluded, mode="RGB"),
            "EXACT 96-BIN + OCCLUDER",
            ["METRIC REFERENCE", "source slices interrupted at exact depth"],
            (91, 160, 232),
            panel_width,
        ),
        base.make_panel(
            Image.fromarray(depth_visual, mode="RGB"),
            "OCCLUDER DEPTH MAP",
            ["three matte-black plates", "blue near | red far | black empty"],
            (153, 111, 214),
            panel_width,
        ),
    ]]
    for item in treatments:
        metrics = item["metadata"]["occludedLinearMetrics"]
        isolated = item["metadata"]["occlusionSpecificLinearMetrics"]
        specific_ratio = item["metadata"]["occlusionSpecificToUnoccludedMaeRatio"]
        specific_ratio_label = "n/a" if specific_ratio is None else f"{specific_ratio:.3f}x base"
        rows.append([
            base.make_panel(
                Image.fromarray(item["occludedPixels"], mode="RGB"),
                f"{item['metadata']['label'].upper()} + OCCLUDER",
                [
                    f"{item['metadata']['depthGroups']} groups | tile {item['metadata']['tileSize']}px",
                    f"linear MAE {metrics['mae']:.5f}",
                ],
                (236, 169, 82),
                panel_width,
            ),
            base.make_panel(
                Image.fromarray(item["residualPixels"], mode="RGB"),
                f"{item['metadata']['label'].upper()} OCCLUDED RESIDUAL",
                ["vs exact 96-bin occluded", "4x absolute tone-mapped RGB"],
                (217, 105, 149),
                panel_width,
            ),
            base.make_panel(
                Image.fromarray(item["specificResidualPixels"], mode="RGB"),
                f"{item['metadata']['label'].upper()} DEPTH-ONLY PENALTY",
                [
                    "occluded error minus base compression error",
                    f"isolated MAE {isolated['mae']:.5f} | {specific_ratio_label}",
                ],
                (234, 112, 88),
                panel_width,
            ),
        ])
    panel_height = rows[0][0].height
    sheet = Image.new("RGB", (panel_width * 3, title_height + panel_height * len(rows)), (10, 12, 15))
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 12), "SCENE-DEPTH OCCLUSION FALSIFIER", font=base.font(27, bold=True), fill=(250, 251, 252))
    plate_depths = ", ".join(f"{item['depth']:.3f}" for item in geometry["plates"])
    subtitle = (
        f"Three opaque test plates at depths {plate_depths} | exact 96-bin reference | "
        "treatment residual | isolated depth-group penalty"
    )
    draw.text((16, 50), subtitle, font=base.font(14), fill=(177, 184, 194))
    y = title_height
    for row in rows:
        x = 0
        for panel in row:
            sheet.paste(panel, (x, y))
            x += panel.width
        y += panel_height
    return sheet


def write_readme(out_dir: Path, report: dict[str, Any]) -> None:
    treatment_lines = "\n".join(
        f"- `{item['occludedImage']}`, `{item['occludedResidualImage']}`, and `{item['occlusionSpecificResidualImage']}`: "
        f"{item['label']} composed through the same three opaque depths, its total residual, and the residual after subtracting its unoccluded compression error."
        for item in report["treatments"]
    )
    text = f"""# View-Conditioned Transfer Scene-Depth Occlusion Falsifier

Question: Do the compressed transfer groups preserve useful appearance when opaque scene geometry interrupts a camera ray inside a composed depth span?

Inspect `annotated-occluder-sheet.png` directly. Native images are the primary evidence.

Roles:
- `unoccluded-reference.png`: exact adapted 96-bin black-background control.
- `exact-occluded-reference.png`: exact adapted 96-bin transfer interrupted by the three matte-black plates; metric reference.
- `occluder-depth-map.png`: the exact per-pixel scene-depth fixture; blue is near, red is far, black has no geometry.
{treatment_lines}

Geometry: `{report['effective']['geometry']}` with depth policy `{report['geometry']['depthSelectionPolicy']}`. Every finite plate depth lies strictly inside an authenticated compressed depth span. This is deliberately adversarial to representative-depth grouping.

Route:
- generator worktree: `{report['repo']['worktree']}`
- generator commit: `{report['repo']['generatorCommit']}`
- command: `{report['command']}`
- source manifest: `{report['source']['manifestPath']}` (`{report['source']['manifestSha256']}`)
- transfer arrays: `{report['source']['arraysPath']}` (`{report['source']['arraysSha256']}`)
- source route/backend: `{report['source']['route']['effective']}` / `{report['source']['route']['backend']}`
- witness backend: `numpy-cpu-v0`; fallback: false

Does not prove: analytical-raymarch parity, arbitrary mesh raster/depth integration, adjacent-camera validity, dynamic rebuild cost, temporal stability, GPU render cost, or production economics.
"""
    (out_dir / "README.md").write_text(text)


def run(args: argparse.Namespace, command: str) -> dict[str, Any]:
    out_dir = Path(args.out_dir).resolve()
    cleanup_outputs(out_dir)
    receipt_path = out_dir / "receipt.json"
    treatments_requested = [base.parse_treatment(value) for value in args.treatment]
    require(bool(treatments_requested), "at least one treatment is required")
    require(len({label for label, _ in treatments_requested}) == len(treatments_requested), "treatment labels must be unique")
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "status": "running",
        "failurePhase": "input-validation",
        "command": command,
        "repo": base.git_generator_identity(),
        "requested": {
            "inputManifest": str(Path(args.input_manifest).resolve()),
            "geometry": args.geometry,
            "occluderRgb": args.occluder_rgb,
            "treatments": [{"label": label, "reportPath": str(path)} for label, path in treatments_requested],
        },
        "effective": None,
        "roles": {
            "unoccludedReference": "exact-96-bin-black-background-control",
            "exactOccludedReference": "exact-96-bin-scene-depth-interruption",
            "treatments": "persisted-compressed-transfer-scene-depth-interruption",
            "occlusionSpecificResidual": "occluded-error-minus-unoccluded-compression-error",
        },
        "source": None,
        "geometry": None,
        "treatments": [],
        "artifacts": {},
    }
    write_json(receipt_path, report)
    try:
        require(args.geometry == GEOMETRY_IDENTITY, f"unsupported occluder geometry: {args.geometry}")
        occluder_rgb = parse_rgb(args.occluder_rgb)
        require(np.array_equal(occluder_rgb, np.zeros(3, dtype=np.float32)), "geometry v0 requires matte-black RGB 0,0,0")
        source = reducer.load_transfer_input(args.input_manifest)
        unoccluded_linear = reducer.render_transfer_field(source)
        report["source"] = {
            "identity": source.manifest["source"],
            "manifestPath": str(source.manifest_path),
            "manifestSha256": source.manifest_sha256,
            "arraysPath": str(source.arrays_path),
            "arraysSha256": source.arrays_sha256,
            "route": source.manifest["route"],
            "shape": list(source.shape),
        }
        report["failurePhase"] = "treatment-validation"
        loaded = [
            load_authenticated_reduction(label, report_path, source, unoccluded_linear)
            for label, report_path in treatments_requested
        ]
        report["failurePhase"] = "geometry-construction"
        depth_map, geometry = build_occluder_geometry(source, [item[2] for item in loaded])
        report["geometry"] = geometry
        report["effective"] = {
            "geometry": GEOMETRY_IDENTITY,
            "depthSelectionPolicy": DEPTH_SELECTION_POLICY,
            "occluderRgb": occluder_rgb.astype(float).tolist(),
            "backend": "numpy-cpu-v0",
            "fallbackUsed": False,
            "fallbackIdentity": None,
            "ignoredParameters": None,
            "caps": None,
            "timeout": None,
        }
        report["failurePhase"] = "composition"
        exact_occluded_linear = reducer.render_transfer_field_with_occluder(source, depth_map, occluder_rgb)
        finite_mask = np.isfinite(depth_map)
        require(
            np.mean(np.abs(exact_occluded_linear[finite_mask] - unoccluded_linear[finite_mask])) > 1e-8,
            "scene geometry did not visibly interrupt exact active transfer support",
        )
        unoccluded_u8 = oracle.tone_map(unoccluded_linear)
        exact_occluded_u8 = oracle.tone_map(exact_occluded_linear)
        rendered_items: list[dict[str, Any]] = []
        for unoccluded_treatment, metadata, reduction in loaded:
            occluded_treatment = reducer.render_reduced_transfer_with_occluder(reduction, depth_map, occluder_rgb)
            occluded_metrics = reducer.image_metrics(occluded_treatment, exact_occluded_linear)
            unoccluded_metrics = reducer.image_metrics(unoccluded_treatment, unoccluded_linear)
            occluded_region_metrics = masked_metrics(occluded_treatment, exact_occluded_linear, finite_mask)
            unoccluded_region_metrics = masked_metrics(unoccluded_treatment, unoccluded_linear, finite_mask)
            occluded_error = occluded_treatment - exact_occluded_linear
            baseline_error = unoccluded_treatment - unoccluded_linear
            specific_metrics = reducer.image_metrics(occluded_error, baseline_error)
            interior_mask = interior_occluder_mask(depth_map, reduction.depth_spans)
            interior_count = int(np.count_nonzero(interior_mask))
            require(interior_count > 0, f"{metadata['label']} has no intra-group occluder pixels")
            ratio = None if unoccluded_metrics["mae"] <= 1e-15 else occluded_metrics["mae"] / unoccluded_metrics["mae"]
            region_ratio = (
                None
                if unoccluded_region_metrics["mae"] <= 1e-15
                else occluded_region_metrics["mae"] / unoccluded_region_metrics["mae"]
            )
            specific_ratio = (
                None
                if unoccluded_metrics["mae"] <= 1e-15
                else specific_metrics["mae"] / unoccluded_metrics["mae"]
            )
            metadata.update({
                "unoccludedLinearMetrics": unoccluded_metrics,
                "occludedLinearMetrics": occluded_metrics,
                "unoccludedOccluderRegionLinearMetrics": unoccluded_region_metrics,
                "occluderRegionLinearMetrics": occluded_region_metrics,
                "occlusionSpecificLinearMetrics": specific_metrics,
                "occludedToUnoccludedMaeRatio": ratio,
                "occluderRegionOccludedToUnoccludedMaeRatio": region_ratio,
                "occlusionSpecificToUnoccludedMaeRatio": specific_ratio,
                "occlusionErrorIncreaseMae": occluded_metrics["mae"] - unoccluded_metrics["mae"],
                "interiorOccluderPixelCount": interior_count,
                "metricReference": "exact-occluded-reference.png",
            })
            occluded_u8 = oracle.tone_map(occluded_treatment)
            rendered_items.append({
                "metadata": metadata,
                "occludedPixels": occluded_u8,
                "residualPixels": base.residual_pixels(occluded_u8, exact_occluded_u8),
                "specificResidualPixels": occlusion_specific_pixels(
                    occluded_u8, exact_occluded_u8, oracle.tone_map(unoccluded_treatment), unoccluded_u8,
                ),
            })
        report["failurePhase"] = "image-publication"
        images: dict[str, np.ndarray] = {
            "unoccluded-reference.png": unoccluded_u8,
            "exact-occluded-reference.png": exact_occluded_u8,
            "occluder-depth-map.png": depth_map_pixels(depth_map, source.depths),
        }
        for item in rendered_items:
            metadata = item["metadata"]
            label = metadata["label"]
            names = {
                "occludedImage": f"{label}-occluded.png",
                "occludedResidualImage": f"{label}-occluded-residual.png",
                "occlusionSpecificResidualImage": f"{label}-occlusion-specific-residual.png",
            }
            images[names["occludedImage"]] = item["occludedPixels"]
            images[names["occludedResidualImage"]] = item["residualPixels"]
            images[names["occlusionSpecificResidualImage"]] = item["specificResidualPixels"]
            metadata.update(names)
            report["treatments"].append(metadata)
        for name, pixels in images.items():
            Image.fromarray(pixels, mode="RGB").save(out_dir / name)
        sheet = build_sheet(
            unoccluded_u8,
            exact_occluded_u8,
            images["occluder-depth-map.png"],
            rendered_items,
            geometry,
        )
        sheet.save(out_dir / SHEET_NAME)
        images[SHEET_NAME] = np.empty((sheet.height, sheet.width, 3), dtype=np.uint8)
        for name in sorted(images):
            path = out_dir / name
            require(path.is_file() and path.stat().st_size > 0, f"primary image is missing or blank: {name}")
            with Image.open(path) as image:
                require(image.width > 0 and image.height > 0, f"primary image has invalid dimensions: {name}")
            report["artifacts"][name] = {
                "path": str(path),
                "bytes": path.stat().st_size,
                "sha256": reducer.sha256_file(path),
            }
        report["status"] = "complete"
        report["failurePhase"] = None
        write_readme(out_dir, report)
        readme_path = out_dir / "README.md"
        report["artifacts"]["README.md"] = {
            "path": str(readme_path),
            "bytes": readme_path.stat().st_size,
            "sha256": reducer.sha256_file(readme_path),
        }
        write_json(receipt_path, report)
        return report
    except Exception as exc:
        cleanup_outputs(out_dir)
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()
        report["artifacts"] = {}
        write_json(receipt_path, report)
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    reject_abbreviated_options(argv)
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--input-manifest", required=True)
    parser.add_argument("--geometry", required=True)
    parser.add_argument("--occluder-rgb", required=True)
    parser.add_argument("--treatment", action="append", required=True)
    parser.add_argument("--out-dir", required=True)
    return parser.parse_args(argv)


def write_argument_failure(out_dir: Path, argv: list[str], exc: Exception) -> None:
    cleanup_outputs(out_dir)
    write_json(out_dir / "receipt.json", {
        "schema": REPORT_SCHEMA,
        "status": "failed",
        "failurePhase": "argument-validation",
        "command": shlex.join([sys.executable, str(Path(__file__).resolve()), *argv]),
        "requested": {"argv": argv},
        "effective": None,
        "source": None,
        "geometry": None,
        "treatments": [],
        "artifacts": {},
        "error": f"{type(exc).__name__}: {exc}",
        "traceback": traceback.format_exc(),
    })


def main() -> int:
    argv = sys.argv[1:]
    out_dir_value = exact_option_value(argv, "--out-dir")
    try:
        args = parse_args(argv)
    except (ValueError, SystemExit) as exc:
        if out_dir_value:
            write_argument_failure(Path(out_dir_value).resolve(), argv, exc)
        print(f"view-conditioned transfer occluder witness argument validation failed: {exc}", file=sys.stderr)
        return 2
    command = shlex.join([sys.executable, str(Path(__file__).resolve()), *argv])
    try:
        run(args, command)
    except Exception as exc:
        print(f"view-conditioned transfer occluder witness failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
