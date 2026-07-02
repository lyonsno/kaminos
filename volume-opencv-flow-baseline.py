#!/usr/bin/env python3
"""OpenCV dense-flow interframe baseline for Kaminos triplet evidence."""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np


BASELINE_ID = "opencv-dis-bidirectional-warp-rgba-v0"
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


def rgba_to_gray_u8(image):
    rgb = image[:, :, :3].astype(np.float32) / 255.0
    gray = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    return np.clip(gray * 255.0, 0, 255).astype(np.uint8)


def dense_flow(first_gray, third_gray, method):
    if method == "dis":
        if not hasattr(cv2, "DISOpticalFlow_create"):
            raise RuntimeError("cv2.DISOpticalFlow_create is unavailable")
        solver = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        return solver.calc(first_gray, third_gray, None)
    if method == "farneback":
        return cv2.calcOpticalFlowFarneback(
            first_gray,
            third_gray,
            None,
            0.5,
            5,
            21,
            5,
            7,
            1.5,
            0,
        )
    raise RuntimeError(f"unknown method: {method}")


def remap_at_ratio(image, flow, ratio):
    height, width = flow.shape[:2]
    grid_x, grid_y = np.meshgrid(np.arange(width, dtype=np.float32), np.arange(height, dtype=np.float32))
    map_x = grid_x - flow[:, :, 0] * ratio
    map_y = grid_y - flow[:, :, 1] * ratio
    return cv2.remap(
        image,
        map_x,
        map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REPLICATE,
    )


def write_rgba(path, image):
    path.parent.mkdir(parents=True, exist_ok=True)
    bgra = cv2.cvtColor(image, cv2.COLOR_RGBA2BGRA)
    if not cv2.imwrite(str(path), bgra):
        raise RuntimeError(f"could not write image: {path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", required=True)
    parser.add_argument("--third", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--method", default="dis", choices=["dis", "farneback"])
    parser.add_argument("--ratio", type=float, default=0.5)
    args = parser.parse_args()
    if not 0.0 < args.ratio < 1.0:
        raise RuntimeError(f"--ratio must be between 0 and 1, got {args.ratio}")

    first_path = Path(args.first)
    third_path = Path(args.third)
    out_path = Path(args.out)
    first = read_rgba(first_path)
    third = read_rgba(third_path)
    if first.shape != third.shape:
        raise RuntimeError(f"input dimensions differ: {first.shape} vs {third.shape}")

    first_gray = rgba_to_gray_u8(first)
    third_gray = rgba_to_gray_u8(third)
    forward = dense_flow(first_gray, third_gray, args.method)
    backward = dense_flow(third_gray, first_gray, args.method)
    first_mid = remap_at_ratio(first, forward, args.ratio)
    third_mid = remap_at_ratio(third, backward, 1.0 - args.ratio)
    synthetic = np.clip(
        first_mid.astype(np.float32) * (1.0 - args.ratio) + third_mid.astype(np.float32) * args.ratio,
        0,
        255,
    ).astype(np.uint8)
    synthetic[:, :, 3] = 255
    write_rgba(out_path, synthetic)
    sidecar = {
        "schema": "kaminos.volume.opencv-flow-baseline.v0",
        "baselineId": BASELINE_ID if args.method == "dis" else f"opencv-farneback-bidirectional-warp-rgba-v0",
        "syntheticAuthority": SYNTHETIC_AUTHORITY,
        "method": args.method,
        "ratio": args.ratio,
        "first": str(first_path),
        "third": str(third_path),
        "out": str(out_path),
        "width": int(first.shape[1]),
        "height": int(first.shape[0]),
    }
    out_path.with_suffix(out_path.suffix + ".json").write_text(json.dumps(sidecar, indent=2) + "\n")


if __name__ == "__main__":
    main()
