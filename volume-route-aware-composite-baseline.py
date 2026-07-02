#!/usr/bin/env python3
"""Route-aware RIFE/DIS composite interframe baseline for Kaminos evidence."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


BASELINE_ID = "route-aware-rife-dis-mask-composite-rgba-v0"
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
    bgra = cv2.cvtColor(image, cv2.COLOR_RGBA2BGRA)
    if not cv2.imwrite(str(path), bgra):
        raise RuntimeError(f"could not write image: {path}")


def load_context(path):
    if not path:
        return {}
    context = json.loads(Path(path).read_text())
    if context.get("actualMiddleUsed") is not False:
        raise RuntimeError("candidate context did not declare actualMiddleUsed=false")
    return context


def luma(image):
    rgb = image[:, :, :3].astype(np.float32)
    return rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722


def blur(mask, radius):
    if radius <= 0:
        return mask
    kernel = radius * 2 + 1
    return cv2.GaussianBlur(mask.astype(np.float32), (kernel, kernel), 0)


def fire_probability(image):
    rgb = image[:, :, :3].astype(np.float32)
    r = rgb[:, :, 0]
    g = rgb[:, :, 1]
    b = rgb[:, :, 2]
    lum = luma(image)
    warm = np.clip((r - b - 18.0) / 90.0, 0.0, 1.0)
    yellow = np.clip((g - b - 6.0) / 75.0, 0.0, 1.0)
    bright = np.clip((lum - 24.0) / 120.0, 0.0, 1.0)
    return blur(np.maximum(warm * 0.65 + yellow * 0.25, bright * warm), 3)


def smoke_probability(image):
    rgb = image[:, :, :3].astype(np.float32)
    lum = luma(image)
    chroma = np.max(rgb, axis=2) - np.min(rgb, axis=2)
    visible = np.clip((lum - 10.0) / 70.0, 0.0, 1.0)
    neutral = np.clip(1.0 - chroma / 80.0, 0.0, 1.0)
    not_fire = 1.0 - fire_probability(image)
    return blur(visible * neutral * not_fire, 5)


def route_profile(context):
    scene = context.get("t0", {}).get("volumeScene") or context.get("volumeScene") or ""
    effective_route = context.get("effectiveRoute") or ""
    if scene == "tall_plume" and effective_route == "native-3d-compute-fluid-raymarch-v0":
        return {
            "identity": "tall-plume-rgb-mask-profile-v0",
            "rifeFireGain": 0.78,
            "flowSmokeGain": 0.58,
            "lowConfidenceMidpointGain": 0.18,
        }
    return {
        "identity": "generic-rgb-mask-profile-v0",
        "rifeFireGain": 0.68,
        "flowSmokeGain": 0.50,
        "lowConfidenceMidpointGain": 0.22,
    }


def target_ratio(context):
    raw = context.get("ratio", context.get("cadencePhase", 0.5))
    try:
        ratio = float(raw)
    except (TypeError, ValueError) as exc:
        raise RuntimeError(f"invalid target ratio in context: {raw}") from exc
    if not 0.0 < ratio < 1.0:
        raise RuntimeError(f"target ratio must be between 0 and 1, got {ratio}")
    return ratio


def composite(first, third, rife, flow, context):
    first_f = first.astype(np.float32)
    third_f = third.astype(np.float32)
    rife_f = rife.astype(np.float32)
    flow_f = flow.astype(np.float32)
    ratio = target_ratio(context)
    midpoint = first_f * (1.0 - ratio) + third_f * ratio
    endpoint_min = np.minimum(first_f, third_f)
    profile = route_profile(context)

    input_fire = np.maximum(fire_probability(first), fire_probability(third))
    parent_fire = np.maximum(fire_probability(rife), fire_probability(flow))
    fire_mask = np.clip(input_fire * 0.65 + parent_fire * 0.35, 0.0, 1.0)
    smoke_mask = np.maximum(smoke_probability(first), smoke_probability(third))

    route_fire_gain = profile["rifeFireGain"]
    route_smoke_gain = profile["flowSmokeGain"]
    rife_weight = np.clip(0.30 + fire_mask * route_fire_gain + (1.0 - smoke_mask) * 0.08, 0.0, 1.0)
    flow_weight = np.clip((1.0 - fire_mask) * (0.18 + smoke_mask * route_smoke_gain), 0.0, 1.0)
    midpoint_weight = np.clip((1.0 - np.maximum(fire_mask, smoke_mask)) * profile["lowConfidenceMidpointGain"], 0.0, 0.35)

    total = np.maximum(0.001, rife_weight + flow_weight + midpoint_weight)
    rife_weight = rife_weight / total
    flow_weight = flow_weight / total
    midpoint_weight = midpoint_weight / total
    blended = (
        rife_f * rife_weight[:, :, None] +
        flow_f * flow_weight[:, :, None] +
        midpoint * midpoint_weight[:, :, None]
    )
    endpoint_delta = blur(np.abs(luma(first) - luma(third)) / 255.0, 5)
    volatility_suppression = np.clip((endpoint_delta - 0.10) / 0.35, 0.0, 1.0) * np.clip(fire_mask + parent_fire * 0.5, 0.0, 1.0)
    volatility_suppression = np.clip(volatility_suppression, 0.0, 0.72)
    # Fire topology can disappear between two bright endpoints; do not let parent interpolators
    # mint a confident flame where the observed endpoints disagree strongly.
    suppressed = np.minimum(blended, endpoint_min * 1.18 + 8.0)
    blended = blended * (1.0 - volatility_suppression[:, :, None]) + suppressed * volatility_suppression[:, :, None]
    blended[:, :, 3] = 255
    masks = {
        "meanFireMask": float(np.mean(fire_mask)),
        "maxFireMask": float(np.max(fire_mask)),
        "meanSmokeMask": float(np.mean(smoke_mask)),
        "maxSmokeMask": float(np.max(smoke_mask)),
        "meanRifeWeight": float(np.mean(rife_weight)),
        "meanFlowWeight": float(np.mean(flow_weight)),
        "meanMidpointWeight": float(np.mean(midpoint_weight)),
        "meanVolatilitySuppression": float(np.mean(volatility_suppression)),
        "maxVolatilitySuppression": float(np.max(volatility_suppression)),
        "routeProfile": profile["identity"],
        "ratio": ratio,
        "cadencePhase": context.get("cadencePhase", ratio),
    }
    return blended, masks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", required=True)
    parser.add_argument("--third", required=True)
    parser.add_argument("--rife", required=True)
    parser.add_argument("--flow", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    first_path = Path(args.first)
    third_path = Path(args.third)
    rife_path = Path(args.rife)
    flow_path = Path(args.flow)
    report_path = Path(args.report)
    out_path = Path(args.out)
    context = load_context(report_path)

    first = read_rgba(first_path)
    third = read_rgba(third_path)
    rife = read_rgba(rife_path)
    flow = read_rgba(flow_path)
    shapes = {tuple(image.shape) for image in [first, third, rife, flow]}
    if len(shapes) != 1:
        raise RuntimeError(f"input dimensions differ: {sorted(shapes)}")

    synthetic, masks = composite(first, third, rife, flow, context)
    write_rgba(out_path, synthetic)
    sidecar = {
        "schema": "kaminos.volume.route-aware-composite-baseline.v0",
        "baselineId": BASELINE_ID,
        "syntheticAuthority": SYNTHETIC_AUTHORITY,
        "actualMiddleUsed": False,
        "first": str(first_path),
        "third": str(third_path),
        "rife": str(rife_path),
        "flow": str(flow_path),
        "report": str(report_path),
        "out": str(out_path),
        "effectiveRoute": context.get("effectiveRoute"),
        "prototypeIdentity": context.get("prototypeIdentity"),
        "backend": context.get("backend"),
        "frameStride": context.get("frameStride"),
        "framesAvailableToCandidate": context.get("framesAvailableToCandidate"),
        "framesWithheldFromCandidate": context.get("framesWithheldFromCandidate"),
        **masks,
        "width": int(first.shape[1]),
        "height": int(first.shape[0]),
    }
    out_path.with_suffix(out_path.suffix + ".json").write_text(json.dumps(sidecar, indent=2) + "\n")


if __name__ == "__main__":
    main()
