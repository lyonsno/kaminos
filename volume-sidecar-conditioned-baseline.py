#!/usr/bin/env python3
"""Simulator-sidecar-conditioned interframe baseline for Kaminos evidence."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


BASELINE_ID = "sidecar-conditioned-rife-dis-rgba-v0"
SYNTHETIC_AUTHORITY = "synthetic-comparison-not-live-simulator-output"


def read_rgba(path):
    image = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if image is None:
        raise RuntimeError(f"could not read image: {path}")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2RGBA)
    elif image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_BGR2RGBA)
    elif image.shape[2] == 4:
        image = cv2.cvtColor(image, cv2.COLOR_BGRA2RGBA)
    else:
        raise RuntimeError(f"unsupported channel count for {path}: {image.shape}")
    return image


def write_rgba(path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    image = np.clip(image, 0, 255).astype(np.uint8)
    image[:, :, 3] = 255
    if not cv2.imwrite(str(path), cv2.cvtColor(image, cv2.COLOR_RGBA2BGRA)):
        raise RuntimeError(f"could not write image: {path}")


def load_context(path):
    context = json.loads(Path(path).read_text())
    if context.get("actualMiddleUsed") is not False:
        raise RuntimeError("candidate context did not declare actualMiddleUsed=false")
    return context


def luma(image):
    rgb = image[:, :, :3].astype(np.float32)
    return rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722


def blur(mask, radius):
    if radius <= 0:
        return mask.astype(np.float32)
    kernel = radius * 2 + 1
    return cv2.GaussianBlur(mask.astype(np.float32), (kernel, kernel), 0)


def fire_probability(image):
    rgb = image[:, :, :3].astype(np.float32)
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]
    lum = luma(image)
    warm = np.clip((r - b - 14.0) / 84.0, 0.0, 1.0)
    yellow = np.clip((g - b - 5.0) / 70.0, 0.0, 1.0)
    bright = np.clip((lum - 20.0) / 120.0, 0.0, 1.0)
    return blur(np.maximum(warm * 0.62 + yellow * 0.24, bright * warm), 3)


def smoke_probability(image):
    rgb = image[:, :, :3].astype(np.float32)
    lum = luma(image)
    chroma = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    visible = np.clip((lum - 10.0) / 70.0, 0.0, 1.0)
    neutral = np.clip(1.0 - chroma / 82.0, 0.0, 1.0)
    return blur(visible * neutral * (1.0 - fire_probability(image)), 5)


def sidecar_value(context, role, path, default=0.0):
    value = context.get(role, {})
    for part in path:
        value = value.get(part, {}) if isinstance(value, dict) else {}
    return float(value) if isinstance(value, (int, float)) else default


def sidecar_bounds(context, role, name):
    value = context.get(role, {}).get("metrics", {}).get(name)
    return value if isinstance(value, dict) and value.get("pixelCount", 0) > 0 else None


def lerp(a, b, t=0.5):
    return a * (1.0 - t) + b * t


def target_ratio(context):
    raw = context.get("ratio", context.get("cadencePhase", 0.5))
    try:
        ratio = float(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"invalid target ratio in context: {raw}") from exc
    if not 0.0 < ratio < 1.0:
        raise RuntimeError(f"target ratio must be between 0 and 1, got {ratio}")
    return ratio


def bounds_corridor(context, width, height, name, shrink=1.0, ratio=None):
    ratio = target_ratio(context) if ratio is None else ratio
    a = sidecar_bounds(context, "t0", name)
    b = sidecar_bounds(context, "t2", name)
    if not a and not b:
        return np.zeros((height, width), dtype=np.float32), {"available": False}
    if not a:
        a = b
    if not b:
        b = a
    cx = lerp(float(a.get("centerX", width * 0.5)), float(b.get("centerX", width * 0.5)), ratio)
    cy = lerp(float(a.get("centerY", height * 0.5)), float(b.get("centerY", height * 0.5)), ratio)
    bw = max(8.0, lerp(float(a.get("width", 16)), float(b.get("width", 16)), ratio) * shrink)
    bh = max(18.0, lerp(float(a.get("height", 32)), float(b.get("height", 32)), ratio) * shrink)
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    distance = ((xx - cx) / max(1.0, bw * 0.50)) ** 2 + ((yy - cy) / max(1.0, bh * 0.50)) ** 2
    mask = np.exp(-0.5 * distance).astype(np.float32)
    return blur(mask, 3), {
        "available": True,
        "centerX": cx,
        "centerY": cy,
        "width": bw,
        "height": bh,
    }


def sidecar_profile(context):
    ratio = target_ratio(context)
    t0_fire = sidecar_value(context, "t0", ["simReadback", "fireLayerMean"])
    t2_fire = sidecar_value(context, "t2", ["simReadback", "fireLayerMean"])
    t0_radiance = sidecar_value(context, "t0", ["simReadback", "radianceMean"])
    t2_radiance = sidecar_value(context, "t2", ["simReadback", "radianceMean"])
    t0_density = sidecar_value(context, "t0", ["simReadback", "densityMean"])
    t2_density = sidecar_value(context, "t2", ["simReadback", "densityMean"])
    t0_fire_pixels = sidecar_value(context, "t0", ["metrics", "fireLikePixels"])
    t2_fire_pixels = sidecar_value(context, "t2", ["metrics", "fireLikePixels"])
    t0_smoke_pixels = sidecar_value(context, "t0", ["metrics", "smokeLikePixels"])
    t2_smoke_pixels = sidecar_value(context, "t2", ["metrics", "smokeLikePixels"])
    avg_fire_layer = lerp(t0_fire, t2_fire, ratio)
    avg_radiance = lerp(t0_radiance, t2_radiance, ratio)
    avg_density = lerp(t0_density, t2_density, ratio)
    fire_pixel_trend = (t2_fire_pixels + 1.0) / (t0_fire_pixels + 1.0)
    smoke_pixel_trend = (t2_smoke_pixels + 1.0) / (t0_smoke_pixels + 1.0)
    low_fire_suppression = np.clip((0.010 - avg_fire_layer) / 0.010, 0.0, 0.72)
    radiance_suppression = np.clip((0.050 - avg_radiance) / 0.050, 0.0, 0.45)
    interval_frames = float(context.get("frameCountDelta", {}).get("t0ToT2") or 0)
    interval_uncertainty = np.clip((interval_frames - 16.0) / 48.0, 0.0, 0.45)
    return {
        "avgFireLayerMean": avg_fire_layer,
        "avgRadianceMean": avg_radiance,
        "avgDensityMean": avg_density,
        "firePixelTrend": fire_pixel_trend,
        "smokePixelTrend": smoke_pixel_trend,
        "lowFireSuppression": float(low_fire_suppression),
        "radianceSuppression": float(radiance_suppression),
        "intervalUncertainty": float(interval_uncertainty),
        "frameInterval": interval_frames,
        "ratio": ratio,
        "cadencePhase": context.get("cadencePhase", ratio),
    }


def composite(first, third, rife, flow, practical, context):
    first_f = first.astype(np.float32)
    third_f = third.astype(np.float32)
    ratio = target_ratio(context)
    midpoint = first_f * (1.0 - ratio) + third_f * ratio
    learned = practical.astype(np.float32) if practical is not None else rife.astype(np.float32)
    rife_f = rife.astype(np.float32)
    flow_f = flow.astype(np.float32)
    endpoint_min = np.minimum(first_f, third_f)
    profile = sidecar_profile(context)

    height, width = first.shape[:2]
    fire_corridor, fire_corridor_meta = bounds_corridor(context, width, height, "fireBounds", shrink=0.72, ratio=ratio)
    smoke_corridor, smoke_corridor_meta = bounds_corridor(context, width, height, "smokeBounds", shrink=1.15, ratio=ratio)
    input_fire = np.maximum(fire_probability(first), fire_probability(third))
    parent_fire = np.maximum.reduce([fire_probability(rife), fire_probability(flow), fire_probability(practical) if practical is not None else np.zeros_like(input_fire)])
    input_smoke = np.maximum(smoke_probability(first), smoke_probability(third))
    sidecar_fire = np.clip(fire_corridor * 0.72 + input_fire * 0.28, 0.0, 1.0)
    sidecar_smoke = np.clip(smoke_corridor * 0.58 + input_smoke * 0.42, 0.0, 1.0)

    learned_weight = np.clip(0.26 + sidecar_fire * 0.42 + (1.0 - sidecar_smoke) * 0.08, 0.0, 1.0)
    flow_weight = np.clip(0.18 + sidecar_smoke * 0.55 - sidecar_fire * 0.12, 0.0, 1.0)
    midpoint_weight = np.clip(0.18 + profile["intervalUncertainty"] * 0.45 + (1.0 - np.maximum(sidecar_fire, sidecar_smoke)) * 0.16, 0.05, 0.65)
    if practical is not None:
        learned_parent = learned * 0.72 + rife_f * 0.28
    else:
        learned_parent = learned
    total = np.maximum(0.001, learned_weight + flow_weight + midpoint_weight)
    blended = (
        learned_parent * (learned_weight / total)[:, :, None] +
        flow_f * (flow_weight / total)[:, :, None] +
        midpoint * (midpoint_weight / total)[:, :, None]
    )

    endpoint_delta = blur(np.abs(luma(first) - luma(third)) / 255.0, 5)
    volatility = np.clip((endpoint_delta - 0.08) / 0.34, 0.0, 1.0)
    low_fire = max(profile["lowFireSuppression"], profile["radianceSuppression"])
    fire_overconfidence = np.clip(parent_fire * (1.0 - sidecar_fire * 0.65), 0.0, 1.0)
    suppression = np.clip(
        fire_overconfidence * (0.35 + low_fire * 0.70) +
        volatility * parent_fire * (0.20 + profile["intervalUncertainty"]),
        0.0,
        0.86,
    )
    suppressed = np.minimum(blended, endpoint_min * (1.06 + sidecar_fire[:, :, None] * 0.10) + 7.0)
    blended = blended * (1.0 - suppression[:, :, None]) + suppressed * suppression[:, :, None]
    smoke_floor = np.maximum(midpoint, flow_f * 0.72 + learned_parent * 0.28)
    smoke_keep = np.clip(sidecar_smoke * (1.0 - sidecar_fire), 0.0, 0.52)
    blended = blended * (1.0 - smoke_keep[:, :, None]) + smoke_floor * smoke_keep[:, :, None]
    blended[:, :, 3] = 255
    masks = {
        **profile,
        "meanInputFireMask": float(np.mean(input_fire)),
        "meanParentFireMask": float(np.mean(parent_fire)),
        "meanSidecarFireMask": float(np.mean(sidecar_fire)),
        "meanSidecarSmokeMask": float(np.mean(sidecar_smoke)),
        "meanSuppression": float(np.mean(suppression)),
        "maxSuppression": float(np.max(suppression)),
        "meanSmokeKeep": float(np.mean(smoke_keep)),
        "fireCorridor": fire_corridor_meta,
        "smokeCorridor": smoke_corridor_meta,
    }
    return blended, masks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", required=True)
    parser.add_argument("--third", required=True)
    parser.add_argument("--rife", required=True)
    parser.add_argument("--flow", required=True)
    parser.add_argument("--practical")
    parser.add_argument("--report", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    first_path = Path(args.first)
    third_path = Path(args.third)
    rife_path = Path(args.rife)
    flow_path = Path(args.flow)
    practical_path = Path(args.practical) if args.practical else None
    report_path = Path(args.report)
    out_path = Path(args.out)
    context = load_context(report_path)

    first = read_rgba(first_path)
    third = read_rgba(third_path)
    rife = read_rgba(rife_path)
    flow = read_rgba(flow_path)
    practical = read_rgba(practical_path) if practical_path else None
    shapes = {tuple(image.shape) for image in [first, third, rife, flow] + ([practical] if practical is not None else [])}
    if len(shapes) != 1:
        raise RuntimeError(f"input dimensions differ: {sorted(shapes)}")

    synthetic, masks = composite(first, third, rife, flow, practical, context)
    write_rgba(out_path, synthetic)
    sidecar = {
        "schema": "kaminos.volume.sidecar-conditioned-baseline.v0",
        "baselineId": BASELINE_ID,
        "syntheticAuthority": SYNTHETIC_AUTHORITY,
        "actualMiddleUsed": False,
        "first": str(first_path),
        "third": str(third_path),
        "rife": str(rife_path),
        "flow": str(flow_path),
        "practical": str(practical_path) if practical_path else None,
        "report": str(report_path),
        "out": str(out_path),
        "effectiveRoute": context.get("effectiveRoute"),
        "prototypeIdentity": context.get("prototypeIdentity"),
        "backend": context.get("backend"),
        "frameStride": context.get("frameStride"),
        "framesAvailableToCandidate": context.get("framesAvailableToCandidate"),
        "framesWithheldFromCandidate": context.get("framesWithheldFromCandidate"),
        "simReadback": {
            "t0": context.get("t0", {}).get("simReadback"),
            "t2": context.get("t2", {}).get("simReadback"),
        },
        "fireBounds": {
            "t0": context.get("t0", {}).get("metrics", {}).get("fireBounds"),
            "t2": context.get("t2", {}).get("metrics", {}).get("fireBounds"),
        },
        "smokeBounds": {
            "t0": context.get("t0", {}).get("metrics", {}).get("smokeBounds"),
            "t2": context.get("t2", {}).get("metrics", {}).get("smokeBounds"),
        },
        **masks,
        "width": int(first.shape[1]),
        "height": int(first.shape[0]),
    }
    out_path.with_suffix(out_path.suffix + ".json").write_text(json.dumps(sidecar, indent=2) + "\n")


if __name__ == "__main__":
    main()
