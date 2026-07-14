#!/usr/bin/env python3
import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import PIL
from PIL import Image


SCHEMA = "kaminos.sam31-meta-image-preprocess-evidence.v0"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
LOADER_FILE = "sam3/model/io_utils.py"
ALGORITHM = "Meta Image.open(path).convert(RGB).resize((size,size)) default Pillow bicubic"


def parse_args():
    parser = argparse.ArgumentParser(description="Hash the exact pinned Meta SAM 3.1 image preprocessing result.")
    parser.add_argument("--image", action="append", required=True)
    parser.add_argument("--resolution", type=int, required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def git_output(source_root: Path, *arguments: str) -> str:
    return subprocess.check_output(["git", *arguments], cwd=source_root, text=True).strip()


def write_report(path: Path, report: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2), encoding="utf-8")


def main() -> int:
    args = parse_args()
    out_path = Path(args.out).resolve()
    source_root = Path(args.source_root).resolve()
    image_paths = [Path(path).resolve() for path in args.image]
    phase = "argument-validation"
    report = {
        "schema": SCHEMA,
        "ok": False,
        "failurePhase": phase,
        "requested": {
            "sourceRoot": str(source_root),
            "sourceCommit": SOURCE_COMMIT,
            "images": [str(path) for path in image_paths],
            "resolution": args.resolution,
        },
        "effective": None,
        "images": [],
        "primaryOutputWritten": False,
        "lastTrustworthyEvidence": "Arguments were parsed; source identity and image preprocessing remain unverified.",
    }
    try:
        if args.resolution <= 0:
            raise ValueError("resolution must be positive")
        if len(image_paths) != 2:
            raise ValueError("exactly two --image arguments are required")
        if len(set(image_paths)) != len(image_paths):
            raise ValueError("source image paths must be distinct")
        if not source_root.is_dir():
            raise FileNotFoundError(f"Meta source root not found: {source_root}")
        for path in image_paths:
            if not path.is_file():
                raise FileNotFoundError(f"source image not found: {path}")

        phase = "meta-source-identity"
        report["failurePhase"] = phase
        source_commit = git_output(source_root, "rev-parse", "HEAD")
        if source_commit != SOURCE_COMMIT:
            raise RuntimeError(f"Meta source commit mismatch: expected {SOURCE_COMMIT}, got {source_commit}")
        loader_path = source_root / LOADER_FILE
        if not loader_path.is_file():
            raise FileNotFoundError(f"pinned Meta image loader not found: {loader_path}")
        dirty_loader = subprocess.run(
            ["git", "status", "--porcelain", "--", LOADER_FILE],
            cwd=source_root,
            text=True,
            capture_output=True,
            check=True,
        ).stdout.strip()
        if dirty_loader:
            raise RuntimeError(f"pinned Meta image loader is locally modified: {dirty_loader}")
        loader_blob = git_output(source_root, "hash-object", LOADER_FILE)
        report["effective"] = {
            "sourceRoot": str(source_root),
            "sourceCommit": source_commit,
            "loaderFile": LOADER_FILE,
            "loaderGitBlob": loader_blob,
            "pillowVersion": PIL.__version__,
            "defaultResizeFilter": "Resampling.BICUBIC",
            "defaultResizeFilterValue": int(Image.Resampling.BICUBIC),
            "algorithm": ALGORITHM,
            "resolution": args.resolution,
        }
        report["lastTrustworthyEvidence"] = "Pinned Meta source identity and unmodified image-loader blob were verified."

        phase = "meta-image-preprocess"
        report["failurePhase"] = phase
        for index, path in enumerate(image_paths):
            with Image.open(path) as encoded:
                source_size = list(encoded.size)
            image = Image.open(path).convert("RGB").resize((args.resolution, args.resolution))
            rgb = image.tobytes()
            rgba = bytearray(args.resolution * args.resolution * 4)
            for pixel in range(args.resolution * args.resolution):
                rgba[pixel * 4:pixel * 4 + 3] = rgb[pixel * 3:pixel * 3 + 3]
                rgba[pixel * 4 + 3] = 255
            report["images"].append({
                "frameIndex": index,
                "path": str(path),
                "sourceSize": source_size,
                "encodedSha256": sha256_file(path),
                "rgbSha256": sha256_bytes(rgb),
                "rgbaSha256": sha256_bytes(bytes(rgba)),
                "rgbaByteLength": len(rgba),
                "outputSize": [args.resolution, args.resolution],
            })
        if report["images"][0]["encodedSha256"] == report["images"][1]["encodedSha256"]:
            raise RuntimeError("encoded source images collapsed to identical content")
        if report["images"][0]["rgbaSha256"] == report["images"][1]["rgbaSha256"]:
            raise RuntimeError("Meta-preprocessed source images collapsed to identical RGBA content")

        report["ok"] = True
        report["failurePhase"] = None
        report["primaryOutputWritten"] = True
        report["lastTrustworthyEvidence"] = "Two distinct source images were preprocessed by the pinned Meta/Pillow operation and hashed."
        write_report(out_path, report)
        print(json.dumps({"ok": True, "report": str(out_path), "rgbaSha256": [image["rgbaSha256"] for image in report["images"]]}))
        return 0
    except Exception as error:
        report["ok"] = False
        report["failurePhase"] = phase
        report["error"] = f"{type(error).__name__}: {error}"
        report["primaryOutputWritten"] = False
        write_report(out_path, report)
        print(json.dumps(report, indent=2), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
