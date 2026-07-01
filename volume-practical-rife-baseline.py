#!/usr/bin/env python3
"""Practical-RIFE learned interframe baseline adapter for Kaminos evidence."""

import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import torch
from torch.nn import functional as F


BASELINE_ID = "learned-practical-rife-425-lite-rgba-v0"
SYNTHETIC_AUTHORITY = "synthetic-comparison-not-live-simulator-output"
PADDING_MULTIPLE = 128


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


def tensor_from_rgba(image, pad):
    bgr = cv2.cvtColor(image[:, :, :3], cv2.COLOR_RGB2BGR)
    tensor = torch.tensor(bgr.transpose(2, 0, 1)).unsqueeze(0).float() / 255.0
    return F.pad(tensor, pad)


def write_rgba(path, bgr_float, height, width):
    bgr = np.clip(bgr_float[:, :height, :width].transpose(1, 2, 0) * 255.0, 0, 255).astype(np.uint8)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    alpha = np.full((rgb.shape[0], rgb.shape[1], 1), 255, dtype=np.uint8)
    rgba = np.concatenate([rgb, alpha], axis=2)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(str(path), cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)):
        raise RuntimeError(f"could not write image: {path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", required=True)
    parser.add_argument("--third", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--practical-rife-root", required=True)
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    first_path = Path(args.first)
    third_path = Path(args.third)
    out_path = Path(args.out)
    practical_root = Path(args.practical_rife_root).resolve()
    model_dir = Path(args.model_dir).resolve()
    if not practical_root.exists():
        raise RuntimeError(f"missing Practical-RIFE checkout: {practical_root}")
    if not model_dir.exists():
        raise RuntimeError(f"missing Practical-RIFE model directory: {model_dir}")

    sys.path.insert(0, str(practical_root))
    from train_log.RIFE_HDv3 import Model  # noqa: WPS433

    first = read_rgba(first_path)
    third = read_rgba(third_path)
    if first.shape != third.shape:
        raise RuntimeError(f"input dimensions differ: {first.shape} vs {third.shape}")
    height, width = first.shape[:2]
    padded_height = ((height - 1) // PADDING_MULTIPLE + 1) * PADDING_MULTIPLE
    padded_width = ((width - 1) // PADDING_MULTIPLE + 1) * PADDING_MULTIPLE
    padding = (0, padded_width - width, 0, padded_height - height)

    model = Model()
    model.load_model(str(model_dir), -1)
    model.eval()
    model.device()
    with torch.no_grad():
      first_tensor = tensor_from_rgba(first, padding)
      third_tensor = tensor_from_rgba(third, padding)
      middle = model.inference(first_tensor, third_tensor, 0.5)[0].cpu().numpy()
    write_rgba(out_path, middle, height, width)

    sidecar = {
        "schema": "kaminos.volume.practical-rife-baseline.v0",
        "baselineId": BASELINE_ID,
        "syntheticAuthority": SYNTHETIC_AUTHORITY,
        "first": str(first_path),
        "third": str(third_path),
        "out": str(out_path),
        "practicalRifeRoot": str(practical_root),
        "modelDir": str(model_dir),
        "modelClass": "RIFE_HDv3",
        "modelVariant": "4.25.lite",
        "paddingMultiple": PADDING_MULTIPLE,
        "paddedWidth": int(padded_width),
        "paddedHeight": int(padded_height),
        "width": int(width),
        "height": int(height),
    }
    out_path.with_suffix(out_path.suffix + ".json").write_text(json.dumps(sidecar, indent=2) + "\n")


if __name__ == "__main__":
    main()
