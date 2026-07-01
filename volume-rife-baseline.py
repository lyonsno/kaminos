#!/usr/bin/env python3
"""RIFE learned interframe baseline adapter for Kaminos triplet evidence."""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np


BASELINE_ID = "learned-rife-hdv3-rgba-v0"
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


def write_bgr_temp(path, rgba):
    bgr = cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2BGR)
    if not cv2.imwrite(str(path), bgr):
        raise RuntimeError(f"could not write temporary RIFE input: {path}")


def write_rgba(path, bgr):
    if bgr is None:
        raise RuntimeError("RIFE output image was unreadable")
    if bgr.ndim == 2:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_GRAY2RGB)
    elif bgr.shape[2] == 3:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    elif bgr.shape[2] == 4:
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGRA2RGBA)[:, :, :3]
    else:
        raise RuntimeError(f"unsupported RIFE output channel count: {bgr.shape}")
    alpha = np.full((rgb.shape[0], rgb.shape[1], 1), 255, dtype=np.uint8)
    rgba = np.concatenate([rgb, alpha], axis=2)
    path.parent.mkdir(parents=True, exist_ok=True)
    bgra = cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA)
    if not cv2.imwrite(str(path), bgra):
        raise RuntimeError(f"could not write image: {path}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", required=True)
    parser.add_argument("--third", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--rife-root", required=True)
    parser.add_argument("--model-dir", required=True)
    args = parser.parse_args()

    first_path = Path(args.first)
    third_path = Path(args.third)
    out_path = Path(args.out)
    rife_root = Path(args.rife_root).resolve()
    model_dir = Path(args.model_dir).resolve()
    inference_path = rife_root / "inference_img.py"
    output_dir = rife_root / "output"
    output_image = output_dir / "img1.png"

    if not inference_path.exists():
        raise RuntimeError(f"missing RIFE inference_img.py: {inference_path}")
    if not model_dir.exists():
        raise RuntimeError(f"missing RIFE model directory: {model_dir}")

    first = read_rgba(first_path)
    third = read_rgba(third_path)
    if first.shape != third.shape:
        raise RuntimeError(f"input dimensions differ: {first.shape} vs {third.shape}")

    with tempfile.TemporaryDirectory(prefix="kaminos-rife-baseline-") as temp_root:
        temp_root_path = Path(temp_root)
        first_temp = temp_root_path / "first.png"
        third_temp = temp_root_path / "third.png"
        write_bgr_temp(first_temp, first)
        write_bgr_temp(third_temp, third)

        if output_dir.exists():
            shutil.rmtree(output_dir)

        command = [
            sys.executable,
            str(inference_path),
            "--img",
            str(first_temp),
            str(third_temp),
            "--ratio",
            "0.5",
            "--model",
            str(model_dir),
        ]
        result = subprocess.run(
            command,
            cwd=str(rife_root),
            text=True,
            capture_output=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "RIFE inference failed with status "
                f"{result.returncode}\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
            )
        if not output_image.exists():
            raise RuntimeError(f"RIFE did not write expected middle frame: {output_image}")

        write_rgba(out_path, cv2.imread(str(output_image), cv2.IMREAD_UNCHANGED))

    sidecar = {
        "schema": "kaminos.volume.rife-baseline.v0",
        "baselineId": BASELINE_ID,
        "syntheticAuthority": SYNTHETIC_AUTHORITY,
        "first": str(first_path),
        "third": str(third_path),
        "out": str(out_path),
        "rifeRoot": str(rife_root),
        "modelDir": str(model_dir),
        "entrypoint": str(inference_path),
        "command": command,
        "inferenceStdout": result.stdout,
        "inferenceStderr": result.stderr,
        "width": int(first.shape[1]),
        "height": int(first.shape[0]),
    }
    out_path.with_suffix(out_path.suffix + ".json").write_text(json.dumps(sidecar, indent=2) + "\n")


if __name__ == "__main__":
    main()
