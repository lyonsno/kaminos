#!/usr/bin/env python3
"""Build a source-authenticated, directly inspectable transfer-reduction witness."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
import textwrap
import traceback
from pathlib import Path
from typing import Any

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REDUCER_PATH = ROOT / "view-conditioned-transfer-compression.py"
ORACLE_PATH = ROOT / "volume-layer-coefficient-render-oracle.py"
REPORT_SCHEMA = "kaminos.view-conditioned-transfer-witness.v0"
METRIC_REFERENCE_ROLE = "exact-adapted-96-bin-transfer-reference"
ANALYTICAL_TARGET_ROLE = "context-only-not-metric-reference"
SHEET_NAME = "annotated-reduction-sheet.png"
LABEL_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]*$")


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ValueError(f"could not load {name}: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reducer = load_module(REDUCER_PATH, "view_conditioned_transfer_compression_witness")
oracle = load_module(ORACLE_PATH, "volume_layer_coefficient_render_oracle_witness")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")


def load_json(path: Path, label: str) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text())
    except Exception as exc:
        raise ValueError(f"{label} JSON could not be read: {exc}") from exc
    require(isinstance(value, dict), f"{label} must be a JSON object")
    return value


def parse_treatment(value: str) -> tuple[str, Path]:
    label, separator, raw_path = value.partition("=")
    require(bool(separator), "treatment must use LABEL=REPORT_PATH")
    require(bool(LABEL_PATTERN.fullmatch(label)), f"invalid treatment label: {label}")
    require(bool(raw_path), f"treatment report path is missing for {label}")
    return label, Path(raw_path).resolve()


def font(size: int, *, bold: bool = False) -> ImageFont.ImageFont:
    candidates = [
        Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial.ttf"),
        Path("/System/Library/Fonts/SFNS.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        if candidate.is_file():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def load_treatment(
    label: str,
    report_path: Path,
    source,
    reference_linear: np.ndarray,
) -> tuple[np.ndarray, dict[str, Any]]:
    require(report_path.is_file(), f"{label} report is missing: {report_path}")
    report = load_json(report_path, f"{label} report")
    require(report.get("schema") == reducer.REPORT_SCHEMA, f"{label} report schema drifted")
    require(report.get("status") == "complete", f"{label} report is not complete")
    requested = report.get("requested") or {}
    effective = report.get("effective") or {}
    source_report = report.get("source") or {}
    require(Path(requested.get("inputManifest", "")).resolve() == source.manifest_path, f"{label} input manifest drifted")
    require(source_report.get("manifestSha256") == source.manifest_sha256, f"{label} manifest sha256 drifted")
    require(source_report.get("arraysSha256") == source.arrays_sha256, f"{label} arrays sha256 drifted")
    require(source_report.get("cameraIdentity") == source.manifest["source"]["cameraIdentity"], f"{label} camera identity drifted")
    require(effective.get("fallbackUsed") is False, f"{label} used a fallback")
    depth_groups = requested.get("depthGroups")
    tile_size = requested.get("tileSize")
    require(isinstance(depth_groups, int) and depth_groups > 0, f"{label} depth groups are invalid")
    require(isinstance(tile_size, int) and tile_size > 0, f"{label} tile size is invalid")
    require(effective.get("depthGroups") == depth_groups, f"{label} effective depth groups drifted")
    require(effective.get("tileSize") == tile_size, f"{label} effective tile size drifted")
    descriptor = (report.get("artifacts") or {}).get("treatment") or {}
    treatment_path = Path(descriptor.get("path", ""))
    if not treatment_path.is_absolute():
        treatment_path = (report_path.parent / treatment_path).resolve()
    require(treatment_path.is_file(), f"{label} treatment is missing: {treatment_path}")
    require(descriptor.get("bytes") == treatment_path.stat().st_size, f"{label} treatment byte length drifted")
    treatment_sha256 = reducer.sha256_file(treatment_path)
    require(descriptor.get("sha256") == treatment_sha256, f"{label} treatment sha256 drifted")
    try:
        with np.load(treatment_path, allow_pickle=False) as arrays:
            require({"depths", "radiance", "transmittance"}.issubset(arrays.files), f"{label} treatment is partial")
            depths = np.asarray(arrays["depths"], dtype=np.float32)
            radiance = np.asarray(arrays["radiance"], dtype=np.float32)
            transmittance = np.asarray(arrays["transmittance"], dtype=np.float32)
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(f"{label} treatment could not be read: {exc}") from exc
    height, width = source.shape[1:]
    tile_height = (height + tile_size - 1) // tile_size
    tile_width = (width + tile_size - 1) // tile_size
    require(depths.shape == (depth_groups,), f"{label} treatment depth shape drifted")
    require(radiance.shape == (depth_groups, tile_height, tile_width, 6), f"{label} treatment radiance shape drifted")
    require(transmittance.shape == (depth_groups, tile_height, tile_width), f"{label} treatment transmittance shape drifted")
    require(np.all(np.isfinite(radiance)), f"{label} treatment radiance is not finite")
    require(np.all(np.isfinite(transmittance)), f"{label} treatment transmittance is not finite")
    spans = ((effective.get("occlusionAuthority") or {}).get("sourceDepthCenterSpans"))
    require(isinstance(spans, list) and len(spans) == depth_groups, f"{label} depth spans are missing")
    reduction = reducer.TransferReduction(
        [reducer.Transfer(radiance[index], transmittance[index]) for index in range(depth_groups)],
        depths=depths,
        depth_spans=np.asarray(spans, dtype=np.float32),
        source_height=height,
        source_width=width,
        source_depth_slice_count=source.shape[0],
        tile_size=tile_size,
        identity=effective.get("identity", ""),
    )
    rendered = reducer.render_reduced_transfer(reduction)
    recomputed_metrics = reducer.image_metrics(rendered, reference_linear)
    recorded_metrics = report.get("metrics") or {}
    serialization_metric_delta: dict[str, float] = {}
    for key, value in recomputed_metrics.items():
        recorded_value = recorded_metrics.get(key)
        require(isinstance(recorded_value, (int, float)), f"{label} producer metric {key} is missing")
        require(np.isclose(value, recorded_value, rtol=1e-5, atol=1e-6), f"{label} metric {key} drifted beyond float32 serialization")
        serialization_metric_delta[key] = float(value - recorded_value)
    return rendered, {
        "label": label,
        "reportPath": str(report_path),
        "reportSha256": reducer.sha256_file(report_path),
        "treatmentPath": str(treatment_path),
        "treatmentSha256": treatment_sha256,
        "depthGroups": depth_groups,
        "tileSize": tile_size,
        "elementCount": effective.get("elementCount"),
        "activeElementCount": effective.get("activeElementCount"),
        "linearMetrics": recomputed_metrics,
        "linearMetricsBasis": "reloaded-persisted-treatment-v0",
        "producerInMemoryLinearMetrics": recorded_metrics,
        "serializationMetricDelta": serialization_metric_delta,
        "occlusionAuthority": effective.get("occlusionAuthority"),
        "metricReference": "adapted-reference.png",
    }


def residual_pixels(candidate: np.ndarray, reference: np.ndarray) -> np.ndarray:
    delta = np.abs(candidate.astype(np.int16) - reference.astype(np.int16))
    return np.clip(delta * 4, 0, 255).astype(np.uint8)


def make_panel(image: Image.Image, title: str, lines: list[str], accent: tuple[int, int, int], panel_width: int) -> Image.Image:
    pad = 10
    caption_height = 102
    panel = Image.new("RGB", (panel_width, image.height + caption_height), (18, 20, 24))
    draw = ImageDraw.Draw(panel)
    draw.rectangle((0, 0, panel_width, 7), fill=accent)
    x = (panel_width - image.width) // 2
    panel.paste(image, (x, caption_height))
    draw.rectangle((x - 1, caption_height - 1, x + image.width, caption_height + image.height), outline=(92, 98, 108), width=1)
    draw.text((pad, 14), title, font=font(18, bold=True), fill=(244, 246, 249))
    y = 42
    for line in lines:
        draw.text((pad, y), line, font=font(13), fill=(191, 197, 207))
        y += 19
    return panel


def make_context_panel(
    width: int,
    height: int,
    source_height: int,
    source_width: int,
    treatment_count: int,
) -> Image.Image:
    panel = Image.new("RGB", (width, height), (24, 27, 32))
    draw = ImageDraw.Draw(panel)
    draw.rectangle((0, 0, width, 7), fill=(119, 213, 163))
    draw.text((14, 16), "HOW TO READ THIS WITNESS", font=font(20, bold=True), fill=(248, 249, 251))
    body = (
        "Left: analytical same-state target, shown only as visual context. It is not the metric baseline. "
        "Right: exact composition of the adapted 96-bin coefficient field. Every treatment and residual below "
        "is compared to that adapted reference. Residuals show 4x absolute tone-mapped RGB error on one shared scale. "
        f"This sheet contains {treatment_count} authenticated saved treatments at native {source_width}x{source_height} resolution."
    )
    y = 52
    for line in textwrap.wrap(body, width=max(36, width // 9)):
        draw.text((14, y), line, font=font(15), fill=(207, 212, 220))
        y += 22
    draw.text((14, height - 28), "Depth composition can still fail around geometry inside a grouped span.", font=font(14, bold=True), fill=(255, 190, 102))
    return panel


def build_sheet(
    analytical: np.ndarray,
    reference: np.ndarray,
    treatments: list[tuple[np.ndarray, dict[str, Any]]],
) -> Image.Image:
    image_height, image_width = reference.shape[:2]
    panel_width = max(image_width + 20, 334)
    title_height = 86
    reference_panel = make_panel(
        Image.fromarray(reference, mode="RGB"),
        "ADAPTED 96-BIN REFERENCE",
        ["METRIC REFERENCE", f"native {image_width}x{image_height} | exact field composition"],
        (94, 205, 146),
        panel_width,
    )
    analytical_panel = make_panel(
        Image.fromarray(analytical, mode="RGB"),
        "ANALYTICAL TARGET",
        ["CONTEXT ONLY", "not used for reduction metrics"],
        (91, 160, 232),
        panel_width,
    )
    panel_height = reference_panel.height
    rows: list[list[Image.Image]] = []
    context = make_context_panel(panel_width * 2, panel_height, image_height, image_width, len(treatments))
    rows.append([analytical_panel, reference_panel, context])
    treatment_panels: list[Image.Image] = []
    for rendered, metadata in treatments:
        rendered_u8 = oracle.tone_map(rendered)
        label = metadata["label"]
        metrics = metadata["linearMetrics"]
        treatment_panels.append(make_panel(
            Image.fromarray(rendered_u8, mode="RGB"),
            f"{label.upper()} TREATMENT",
            [
                f"groups {metadata['depthGroups']} | tile {metadata['tileSize']}px | active {metadata['activeElementCount']:,}",
                f"linear MAE {metrics['mae']:.5f} | elements {metadata['elementCount']:,}",
            ],
            (236, 169, 82),
            panel_width,
        ))
        treatment_panels.append(make_panel(
            Image.fromarray(residual_pixels(rendered_u8, reference), mode="RGB"),
            f"{label.upper()} RESIDUAL",
            [
                "vs adapted reference",
                f"4x absolute RGB | max linear {metrics['maxAbsError']:.4f}",
            ],
            (217, 105, 149),
            panel_width,
        ))
    for index in range(0, len(treatment_panels), 4):
        row = treatment_panels[index : index + 4]
        while len(row) < 4:
            row.append(Image.new("RGB", (panel_width, panel_height), (14, 16, 19)))
        rows.append(row)
    sheet_width = panel_width * 4
    sheet_height = title_height + panel_height * len(rows)
    sheet = Image.new("RGB", (sheet_width, sheet_height), (10, 12, 15))
    draw = ImageDraw.Draw(sheet)
    draw.text((16, 13), "VIEW-CONDITIONED TRANSFER REDUCTION WITNESS", font=font(27, bold=True), fill=(250, 251, 252))
    draw.text((16, 49), "State 120 | camera 10 | native panels | analytical context, adapted metric reference, treatments, residuals", font=font(16), fill=(177, 184, 194))
    y = title_height
    for row_index, row in enumerate(rows):
        x = 0
        for panel in row:
            sheet.paste(panel, (x, y))
            x += panel.width
        y += panel_height
    return sheet


def write_readme(out_dir: Path, report: dict[str, Any]) -> None:
    treatment_lines = "\n".join(
        f"- `{item['image']}` and `{item['residualImage']}`: {item['label']} treatment and its 4x absolute tone-mapped RGB residual against `adapted-reference.png`."
        for item in report["treatments"]
    )
    readme = f"""# View-Conditioned Transfer Reduction Witness

Question: What do the saved state-120 camera-10 spatial/depth transfer reductions actually look like?

Result: Inspect `annotated-reduction-sheet.png` directly. The images are the evidence; this text only fixes their roles and route.

Roles:
- `analytical-target.png`: analytical same-state target for context only. It is not the reduction metric reference.
- `adapted-reference.png`: exact composition of the authenticated adapted 96-bin coefficient field and the metric reference for all reductions.
{treatment_lines}
- `annotated-reduction-sheet.png`: the directly viewable, labeled comparison at native panel resolution.

Route:
- repo: {report['repo']['worktree']}
- commit: {report['repo']['commit']}
- command: `{report['command']}`
- source manifest: `{report['source']['manifestPath']}` (`{report['source']['manifestSha256']}`)
- transfer arrays: `{report['source']['arraysPath']}` (`{report['source']['arraysSha256']}`)
- route/backend: `{report['source']['route']['effective']}` / `{report['source']['route']['backend']}`
- tone map: `{report['toneMap']}`

Does not prove: parity with analytical raymarch, correct scene-geometry occlusion inside a grouped depth span, adjacent-camera validity, motion stability, or production economics.
"""
    (out_dir / "README.md").write_text(readme)


def run(args: argparse.Namespace, command: str) -> dict[str, Any]:
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    receipt_path = out_dir / "receipt.json"
    treatments_requested = [parse_treatment(value) for value in args.treatment]
    require(bool(treatments_requested), "at least one treatment is required")
    require(len({label for label, _ in treatments_requested}) == len(treatments_requested), "treatment labels must be unique")
    output_names = {SHEET_NAME, "analytical-target.png", "adapted-reference.png", "README.md"}
    for label, _ in treatments_requested:
        output_names.update({f"{label}.png", f"{label}-residual.png"})
    for name in output_names:
        path = out_dir / name
        if path.exists():
            path.unlink()
    report: dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "status": "running",
        "failurePhase": "input-validation",
        "command": command,
        "repo": {
            "worktree": str(ROOT),
            "commit": args.commit,
        },
        "requested": {
            "inputManifest": str(Path(args.input_manifest).resolve()),
            "analyticalTarget": str(Path(args.analytical_target).resolve()),
            "treatments": [{"label": label, "reportPath": str(path)} for label, path in treatments_requested],
        },
        "metricReferenceRole": METRIC_REFERENCE_ROLE,
        "analyticalTargetRole": ANALYTICAL_TARGET_ROLE,
        "toneMap": "oracle-exposure-0.96-power-0.84-uint8-v0",
        "source": None,
        "treatments": [],
        "artifacts": {},
    }
    write_json(receipt_path, report)
    try:
        source = reducer.load_transfer_input(args.input_manifest)
        target_path = Path(args.analytical_target).resolve()
        require(target_path.is_file(), f"analytical target is missing: {target_path}")
        analytical = np.asarray(Image.open(target_path).convert("RGB"), dtype=np.uint8)
        require(analytical.shape == (source.shape[1], source.shape[2], 3), "analytical target dimensions drifted")
        reference_linear = reducer.render_transfer_field(source)
        reference_u8 = oracle.tone_map(reference_linear)
        report["source"] = {
            "identity": source.manifest["source"],
            "manifestPath": str(source.manifest_path),
            "manifestSha256": source.manifest_sha256,
            "arraysPath": str(source.arrays_path),
            "arraysSha256": source.arrays_sha256,
            "route": source.manifest["route"],
            "shape": list(source.shape),
            "analyticalTargetPath": str(target_path),
            "analyticalTargetSha256": reducer.sha256_file(target_path),
        }
        report["failurePhase"] = "treatment-validation"
        rendered_treatments: list[tuple[np.ndarray, dict[str, Any]]] = []
        for label, treatment_report_path in treatments_requested:
            rendered_treatments.append(load_treatment(label, treatment_report_path, source, reference_linear))
        report["failurePhase"] = "image-publication"
        Image.fromarray(analytical, mode="RGB").save(out_dir / "analytical-target.png")
        Image.fromarray(reference_u8, mode="RGB").save(out_dir / "adapted-reference.png")
        for rendered, metadata in rendered_treatments:
            rendered_u8 = oracle.tone_map(rendered)
            image_name = f"{metadata['label']}.png"
            residual_name = f"{metadata['label']}-residual.png"
            Image.fromarray(rendered_u8, mode="RGB").save(out_dir / image_name)
            Image.fromarray(residual_pixels(rendered_u8, reference_u8), mode="RGB").save(out_dir / residual_name)
            metadata["image"] = image_name
            metadata["residualImage"] = residual_name
            report["treatments"].append(metadata)
        sheet = build_sheet(analytical, reference_u8, rendered_treatments)
        sheet.save(out_dir / SHEET_NAME)
        for name in sorted(output_names - {"README.md"}):
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
        report["artifacts"]["README.md"] = {
            "path": str(out_dir / "README.md"),
            "bytes": (out_dir / "README.md").stat().st_size,
            "sha256": reducer.sha256_file(out_dir / "README.md"),
        }
        write_json(receipt_path, report)
        return report
    except Exception as exc:
        for name in output_names:
            path = out_dir / name
            if path.exists():
                path.unlink()
        report["status"] = "failed"
        report["error"] = f"{type(exc).__name__}: {exc}"
        report["traceback"] = traceback.format_exc()
        report["artifacts"] = {}
        write_json(receipt_path, report)
        raise


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--input-manifest", required=True)
    parser.add_argument("--analytical-target", required=True)
    parser.add_argument("--treatment", action="append", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--commit", default="uncommitted")
    return parser.parse_args(argv)


def main() -> int:
    args = parse_args()
    command = " ".join([Path(sys.executable).name, Path(__file__).name, *sys.argv[1:]])
    try:
        run(args, command)
    except Exception as exc:
        print(f"view-conditioned transfer witness failed: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
