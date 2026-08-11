#!/usr/bin/env python3
"""Extract, compare, and render paired topology metrics from Trellis casts.

Run through Blender so the effective GLB import route is the same route used by
the existing Kaminos registration witnesses.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import sys
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT))

from fur_signal_metric_atlas import (  # noqa: E402
    analyze_topology,
    channel_discrimination,
    verify_source,
    write_failure_report,
)


RAW_CHANNELS = (
    "small_component",
    "component_sheetness",
    "boundary_fraction",
    "normal_disorder",
    "aspect_ratio",
    "relative_area",
)
ANALYSIS_CHANNELS = ("candidate_signal",) + RAW_CHANNELS
SELECTION_METRICS = ("relative_area", "component_sheetness")
SELECTION_CHANNELS = tuple(f"{name}_selected" for name in SELECTION_METRICS)
DISPLAY_CHANNELS = ANALYSIS_CHANNELS + SELECTION_CHANNELS
SIGNAL_WEIGHTS = {
    "small_component": 0.30,
    "component_sheetness": 0.25,
    "boundary_fraction": 0.20,
    "normal_disorder": 0.15,
    "aspect_ratio": 0.10,
}
LAST_TRUSTWORTHY_EVIDENCE = {}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--campaign", type=Path, default=ROOT / "campaign.json")
    parser.add_argument("--output-root", type=Path, default=ROOT)
    return parser.parse_args(sys.argv[sys.argv.index("--") + 1 :])


def imported_target(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"GLB import produced no mesh objects: {path}")
    target = max(meshes, key=lambda obj: len(obj.data.polygons))
    if len(target.data.polygons) < 1_000:
        raise RuntimeError(f"effective target mesh is implausibly sparse: {path}")
    non_triangles = sum(1 for polygon in target.data.polygons if len(polygon.vertices) != 3)
    if non_triangles:
        raise RuntimeError(f"effective target contains {non_triangles} non-triangle polygons")
    return target


def world_geometry(obj):
    mesh = obj.data
    coordinates = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", coordinates)
    local = coordinates.reshape((-1, 3))
    homogeneous = np.column_stack((local, np.ones(len(local), dtype=np.float64)))
    world = homogeneous @ np.asarray(obj.matrix_world, dtype=np.float64).T
    triangles = np.empty(len(mesh.polygons) * 3, dtype=np.int64)
    mesh.polygons.foreach_get("vertices", triangles)
    return world[:, :3], triangles.reshape((-1, 3))


def transformed_channel(name, values):
    values = np.asarray(values, dtype=np.float64)
    if name in {"aspect_ratio", "relative_area"}:
        return np.log1p(np.maximum(values, 0.0))
    return values


def channel_range(values):
    values = np.asarray(values, dtype=np.float64)
    lower = float(np.quantile(values, 0.02))
    upper = float(np.quantile(values, 0.98))
    if not upper > lower:
        return {"lower": lower, "upper": upper, "constant": True}
    return {"lower": lower, "upper": upper, "constant": False}


def apply_range(values, limits):
    if limits["constant"]:
        return np.zeros_like(np.asarray(values, dtype=np.float64))
    return np.clip(
        (values - limits["lower"]) / (limits["upper"] - limits["lower"]),
        0.0,
        1.0,
    )


def global_candidate(normalized):
    signal = np.zeros_like(next(iter(normalized.values())))
    for name, weight in SIGNAL_WEIGHTS.items():
        signal += normalized[name] * weight
    return np.clip(signal, 0.0, 1.0)


def color_map(values):
    anchors = np.asarray(
        [
            [0.020, 0.025, 0.080],
            [0.120, 0.090, 0.350],
            [0.520, 0.080, 0.440],
            [0.900, 0.250, 0.180],
            [0.990, 0.780, 0.160],
            [0.970, 0.970, 0.650],
        ],
        dtype=np.float64,
    )
    scaled = np.clip(values, 0.0, 1.0) * (len(anchors) - 1)
    lower = np.floor(scaled).astype(np.int64)
    upper = np.minimum(lower + 1, len(anchors) - 1)
    mix = (scaled - lower)[:, None]
    rgb = anchors[lower] * (1.0 - mix) + anchors[upper] * mix
    return np.column_stack((rgb, np.ones(len(rgb), dtype=np.float64)))


def selection_color_map(values):
    values = np.asarray(values, dtype=np.float64) > 0.5
    colors = np.empty((len(values), 4), dtype=np.float64)
    colors[~values] = (0.025, 0.030, 0.040, 1.0)
    colors[values] = (0.050, 0.850, 0.930, 1.0)
    return colors


def metric_material(mesh):
    attribute = mesh.color_attributes.get("metric_color")
    if attribute is None:
        attribute = mesh.color_attributes.new(
            name="metric_color", type="BYTE_COLOR", domain="CORNER"
        )
    material = bpy.data.materials.new("metric-atlas-material")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    principled = nodes.get("Principled BSDF")
    color = nodes.new("ShaderNodeVertexColor")
    color.layer_name = "metric_color"
    links.new(color.outputs["Color"], principled.inputs["Base Color"])
    principled.inputs["Roughness"].default_value = 0.72
    principled.inputs["Metallic"].default_value = 0.0
    mesh.materials.clear()
    mesh.materials.append(material)
    return attribute


def configure_scene(target, points):
    for obj in list(bpy.context.scene.objects):
        if obj != target and obj.type == "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 540
    scene.render.resolution_y = 540
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("fur-atlas-world")
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.008, 0.010, 0.016, 1.0)
    background.inputs["Strength"].default_value = 0.08

    center = (points.min(axis=0) + points.max(axis=0)) * 0.5
    extent = np.ptp(points, axis=0)
    span = float(max(extent))
    camera_data = bpy.data.cameras.new("fur-atlas-camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = span * 1.22
    camera = bpy.data.objects.new("fur-atlas-camera", camera_data)
    scene.collection.objects.link(camera)
    azimuth = math.radians(-34.0)
    elevation = math.radians(12.0)
    direction = Vector(
        (
            math.cos(elevation) * math.cos(azimuth),
            math.cos(elevation) * math.sin(azimuth),
            math.sin(elevation),
        )
    )
    camera.location = Vector(center) + direction * span * 2.8
    camera.rotation_euler = (Vector(center) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    for name, energy, size, offset in (
        ("key", 28.0, 5.0, (1.4, -1.8, 2.2)),
        ("fill", 14.0, 4.0, (-1.8, -0.3, 1.0)),
    ):
        light_data = bpy.data.lights.new(name, type="AREA")
        light_data.energy = energy
        light_data.shape = "DISK"
        light_data.size = size
        light = bpy.data.objects.new(name, light_data)
        scene.collection.objects.link(light)
        light.location = Vector(center) + Vector(offset) * span
        light.rotation_euler = (Vector(center) - light.location).to_track_quat("-Z", "Y").to_euler()


def set_face_colors(mesh, attribute, values, *, selection=False):
    if len(values) != len(mesh.polygons):
        raise RuntimeError("metric cardinality does not match the rendered mesh")
    colors = selection_color_map(values) if selection else color_map(values)
    loop_colors = np.repeat(colors, 3, axis=0).astype(np.float32)
    if len(loop_colors) != len(attribute.data):
        raise RuntimeError("metric color cardinality does not match mesh loops")
    attribute.data.foreach_set("color", loop_colors.reshape(-1))
    mesh.update()


def validate_render(path, *, selection=False):
    image = bpy.data.images.load(str(path), check_existing=False)
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    rgba = pixels.reshape((-1, 4))
    rgb = rgba[:, :3]
    luminance = rgb.mean(axis=1)
    foreground = luminance > 0.02
    foreground_count = int(foreground.sum())
    if foreground_count < 1_000:
        raise RuntimeError(f"render is blank or nearly blank: {path}")
    foreground_rgb = rgb[foreground]
    foreground_luminance = luminance[foreground]
    chroma = np.ptp(foreground_rgb, axis=1)
    validation = {
        "foregroundPixels": foreground_count,
        "nearWhiteFraction": float(np.mean(foreground_luminance > 0.90)),
        "luminanceSpan": float(
            np.quantile(foreground_luminance, 0.95)
            - np.quantile(foreground_luminance, 0.05)
        ),
        "p90Chroma": float(np.quantile(chroma, 0.90)),
    }
    if selection:
        validation["selectedPixels"] = int(np.sum(chroma > 0.08))
    bpy.data.images.remove(image)
    if validation["nearWhiteFraction"] >= 0.15:
        raise RuntimeError(f"render is materially washed out: {path}: {validation}")
    if selection and validation["selectedPixels"] <= 8:
        raise RuntimeError(f"selection render does not expose selected faces: {path}: {validation}")
    if not selection and (
        validation["luminanceSpan"] <= 0.06 or validation["p90Chroma"] <= 0.025
    ):
        raise RuntimeError(f"render does not expose the metric scale: {path}: {validation}")
    return validation


def render_asset(output_root, asset_record, arrays):
    target = imported_target(REPO / asset_record["path"])
    points, _ = world_geometry(target)
    attribute = metric_material(target.data)
    configure_scene(target, points)
    views = {}
    validation = {}
    for channel in DISPLAY_CHANNELS:
        set_face_colors(
            target.data,
            attribute,
            arrays[channel],
            selection=channel in SELECTION_CHANNELS,
        )
        relative = Path("views") / f"{asset_record['family']}-seed{asset_record['seed']}-{channel}.png"
        destination = output_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        bpy.context.scene.render.filepath = str(destination)
        bpy.ops.render.render(write_still=True)
        views[channel] = str(relative)
        validation[channel] = validate_render(
            destination,
            selection=channel in SELECTION_CHANNELS,
        )
    return views, validation


def summarize(values):
    return {
        "min": float(np.min(values)),
        "median": float(np.median(values)),
        "p90": float(np.quantile(values, 0.90)),
        "p99": float(np.quantile(values, 0.99)),
        "max": float(np.max(values)),
    }


def build_sheet(campaign, result):
    asset_lookup = {(asset["family"], asset["seed"]): asset for asset in result["assets"]}
    metric_headers = "".join(f"<th>{html.escape(name.replace('_', ' '))}</th>" for name in DISPLAY_CHANNELS)
    rows = []
    for seed in sorted({asset["seed"] for asset in result["assets"]}):
        for family in ("fur", "skin"):
            asset = asset_lookup[(family, seed)]
            cells = "".join(
                f'<td><img src="{html.escape(asset["views"][metric])}" alt="{family} {seed} {metric}"></td>'
                for metric in DISPLAY_CHANNELS
            )
            rows.append(
                f"<tr><th><strong>{family.upper()}</strong><br>seed {seed}<br>"
                f"<code>{asset['sourceSha256'][:12]}</code><br>"
                f"{asset['triangleCount']:,} triangles<br>{asset['componentCount']:,} components</th>{cells}</tr>"
            )
    discrimination = "".join(
        "<tr>"
        f"<td><strong>{html.escape(entry['metric'].replace('_', ' '))}</strong></td>"
        f"<td>{entry['separation']:.3f}</td>"
        f"<td>{entry['furCoverage']:.3f}</td>"
        f"<td>{entry['skinCoverage']:.3f}</td>"
        f"<td><code>{entry['threshold']:.4g}</code></td>"
        "</tr>"
        for entry in result["discrimination"]
    )
    status = result["quantitativeStatus"].upper()
    prompt_blocks = "".join(
        f"<div><strong>{name}</strong><p>{html.escape(family['prompt'])}</p></div>"
        for name, family in campaign["families"].items()
    )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fur signal metric atlas</title><style>
:root{{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0b0d11;color:#eef1f5}}
body{{margin:0;padding:24px}} h1{{font-size:28px;margin:0 0 6px}} h2{{margin-top:30px}}
.lede{{max-width:1000px;color:#b9c0ca;line-height:1.5}} .status{{display:inline-block;padding:5px 9px;border:1px solid #59616d;background:#171b21;font-weight:700}}
.prompts{{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;max-width:1000px}} .prompts div{{border-left:3px solid #d76458;padding:4px 12px;background:#14171c}}
table{{border-collapse:collapse;width:100%;margin-top:12px}} th,td{{border:1px solid #2b3038;padding:8px;vertical-align:top}} th{{background:#15191f;text-align:left}} code{{color:#9dc7d4}}
.atlas{{min-width:1500px}} .atlas th:first-child{{position:sticky;left:0;z-index:2;width:150px}} .atlas td{{padding:4px;background:#101318}} .atlas img{{display:block;width:210px;height:210px;object-fit:cover}}
.scroll{{overflow-x:auto;border:1px solid #2b3038}} .foot{{color:#9aa2ad;max-width:1100px;line-height:1.45}}
</style></head><body>
<h1>Fur signal metric atlas</h1>
<p class="lede">Paired topology diagnostics over three matched seeds. Every heatmap uses one campaign-wide scale. The threshold is learned only from skin controls; statistics nominate candidates but do not grant visual admission.</p>
<p><span class="status">{status}</span> &nbsp; Visual admission: {html.escape(result['visualAdmission'])}</p>
<section class="prompts">{prompt_blocks}</section>
<h2>Control-derived discrimination</h2>
<table><thead><tr><th>Metric</th><th>Separation</th><th>Fur coverage</th><th>Skin coverage</th><th>Skin p99 threshold</th></tr></thead><tbody>{discrimination}</tbody></table>
<h2>Comparative atlas</h2><div class="scroll"><table class="atlas"><thead><tr><th>Cast</th>{metric_headers}</tr></thead><tbody>{''.join(rows)}</tbody></table></div>
<h2>Evidence boundary</h2><p class="foot">{html.escape(result['claimCeiling'])}</p>
<p class="foot">Effective extractor: Blender {html.escape(result['effectiveRoute']['blenderVersion'])}; generation route: {html.escape(result['effectiveRoute']['generation']['jobType'])}, {result['effectiveRoute']['generation']['steps']} steps, target {result['effectiveRoute']['generation']['targetFaces']:,} faces. Source plate <code>{html.escape(campaign['sourcePlate']['sha256'])}</code>.</p>
</body></html>"""


def run(args):
    global LAST_TRUSTWORTHY_EVIDENCE
    output_root = args.output_root.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    result_path = output_root / "result.json"
    sheet_path = output_root / "sheet.html"
    failure_path = output_root / "failure.json"
    result_path.unlink(missing_ok=True)
    sheet_path.unlink(missing_ok=True)

    campaign = json.loads(args.campaign.read_text())
    verify_source(REPO / campaign["sourcePlate"]["path"], campaign["sourcePlate"]["sha256"])
    records = []
    arrays_by_key = {}
    LAST_TRUSTWORTHY_EVIDENCE = {
        "phase": "source-plate-authenticated",
        "sourcePlateSha256": campaign["sourcePlate"]["sha256"],
    }
    for family_name, family in campaign["families"].items():
        for asset in family["assets"]:
            source = REPO / asset["path"]
            observed = verify_source(source, asset["sha256"])
            LAST_TRUSTWORTHY_EVIDENCE = {
                "phase": "cast-authenticated",
                "family": family_name,
                "seed": asset["seed"],
                "source": str(source),
                "sourceSha256": observed,
            }
            target = imported_target(source)
            vertices, triangles = world_geometry(target)
            metrics = analyze_topology(vertices, triangles)
            LAST_TRUSTWORTHY_EVIDENCE = {
                **LAST_TRUSTWORTHY_EVIDENCE,
                "phase": "cast-metrics-extracted",
                "vertexCount": int(len(vertices)),
                "triangleCount": int(len(triangles)),
                "componentCount": metrics["component_count"],
            }
            key = (family_name, asset["seed"])
            arrays_by_key[key] = {name: metrics[name] for name in RAW_CHANNELS}
            records.append(
                {
                    "family": family_name,
                    "seed": asset["seed"],
                    "path": asset["path"],
                    "sourceSha256": observed,
                    "expectedSha256": asset["sha256"],
                    "vertexCount": int(len(vertices)),
                    "triangleCount": int(len(triangles)),
                    "componentCount": metrics["component_count"],
                    "metrics": {name: summarize(metrics[name]) for name in RAW_CHANNELS},
                    "views": {},
                }
            )

    ranges = {}
    for name in RAW_CHANNELS:
        pooled = np.concatenate(
            [transformed_channel(name, arrays[name]) for arrays in arrays_by_key.values()]
        )
        ranges[name] = channel_range(pooled)
        if ranges[name]["constant"]:
            raise RuntimeError(f"campaign metric channel {name} is constant")
    for arrays in arrays_by_key.values():
        normalized = {
            name: apply_range(transformed_channel(name, arrays[name]), ranges[name])
            for name in RAW_CHANNELS
        }
        normalized["candidate_signal"] = global_candidate(normalized)
        arrays.clear()
        arrays.update(normalized)

    discrimination = []
    seeds = sorted(asset["seed"] for asset in campaign["families"]["fur"]["assets"])
    for name in ANALYSIS_CHANNELS:
        entry = channel_discrimination(
            {seed: arrays_by_key[("fur", seed)][name] for seed in seeds},
            {seed: arrays_by_key[("skin", seed)][name] for seed in seeds},
            control_quantile=campaign["decisionPredicate"]["controlQuantile"],
        )
        entry["metric"] = name
        discrimination.append(entry)
    discrimination.sort(key=lambda entry: entry["separation"], reverse=True)
    predicate = campaign["decisionPredicate"]
    candidates = [
        entry
        for entry in discrimination
        if entry["separation"] >= predicate["minimumMeanSeparation"]
        and min(entry["furCoverageBySeed"].values()) >= predicate["minimumFurCoverageEverySeed"]
        and max(entry["skinCoverageBySeed"].values()) <= predicate["maximumSkinCoverageAnySeed"]
    ]
    discrimination_by_metric = {entry["metric"]: entry for entry in discrimination}
    for key, arrays in arrays_by_key.items():
        for metric in SELECTION_METRICS:
            threshold = discrimination_by_metric[metric]["threshold"]
            arrays[f"{metric}_selected"] = (arrays[metric] > threshold).astype(np.float64)

    record_lookup = {(record["family"], record["seed"]): record for record in records}
    metrics_dir = output_root / "metrics"
    metrics_dir.mkdir(parents=True, exist_ok=True)
    for key, arrays in arrays_by_key.items():
        family, seed = key
        np.savez_compressed(metrics_dir / f"{family}-seed{seed}.npz", **arrays)
        views, validation = render_asset(output_root, record_lookup[key], arrays)
        record_lookup[key]["views"] = views
        record_lookup[key]["renderValidation"] = validation
        record_lookup[key]["selectionCoverage"] = {
            metric: float(np.mean(arrays[f"{metric}_selected"]))
            for metric in SELECTION_METRICS
        }
        LAST_TRUSTWORTHY_EVIDENCE = {
            "phase": "cast-views-rendered",
            "family": family,
            "seed": seed,
            "sourceSha256": record_lookup[key]["sourceSha256"],
            "views": record_lookup[key]["views"],
        }
        record_lookup[key]["candidateSignal"] = summarize(arrays["candidate_signal"])

    result = {
        "schema": "kaminos.fur-signal-metric-atlas-result.v0",
        "effectiveRoute": {
            "extractor": "blender-python",
            "blenderVersion": bpy.app.version_string,
            "generation": campaign["effectiveGenerationRoute"],
        },
        "sourceCampaign": campaign["sourceCampaign"],
        "sourcePlate": campaign["sourcePlate"],
        "metricRanges": ranges,
        "discrimination": discrimination,
        "quantitativeStatus": "candidate" if candidates else "no-signal",
        "candidateMetrics": [entry["metric"] for entry in candidates],
        "visualAdmission": "pending-agent-inspection",
        "decisionPredicate": predicate,
        "assets": records,
        "claimCeiling": campaign["claimCeiling"],
    }
    sheet_path.write_text(build_sheet(campaign, result))
    result_path.write_text(json.dumps(result, indent=2) + "\n")
    failure_path.unlink(missing_ok=True)


def main():
    args = parse_args()
    output_root = args.output_root.resolve()
    try:
        run(args)
    except Exception as error:
        write_failure_report(
            output_root / "failure.json",
            phase="fur-signal-metric-atlas",
            error=repr(error),
            last_trustworthy_evidence={
                **LAST_TRUSTWORTHY_EVIDENCE,
                "traceback": traceback.format_exc(),
            },
        )
        raise


if __name__ == "__main__":
    main()
