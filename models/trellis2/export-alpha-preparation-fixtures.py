"""Replay the pinned MLX CPU alpha preparation; no neural/model construction."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile

import numpy as np
import PIL
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source-root", type=Path, required=True)
parser.add_argument("--expected-source-commit", required=True)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--images-out", type=Path)
args = parser.parse_args()
root = args.source_root.resolve()
commit = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
dirty = subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True).strip()
if commit != args.expected_source_commit or dirty:
    raise ValueError("exact clean preprocessing source required")
sys.path.insert(0, str(root))
from trellmlx.preprocess import preprocess_image_with_provenance
module = Path(sys.modules["trellmlx.preprocess"].__file__).resolve()
if module != root / "trellmlx/preprocess.py":
    raise ValueError("effective preprocessing module differs from pinned source")
sha = lambda b: hashlib.sha256(b).hexdigest()

def pattern(width, height, variant):
    y, x = np.indices((height, width))
    rgba = np.empty((height, width, 4), dtype=np.uint8)
    for c in range(3):
        rgba[:, :, c] = (x * 37 + y * 101 + c * 79 + variant * 17) % 256
    # Includes strict-threshold 204, semitransparency, and colors hidden by alpha.
    rgba[:, :, 3] = np.asarray([0, 64, 127, 204, 205, 254, 255], dtype=np.uint8)[(x + y * 3 + variant) % 7]
    x0 = 0 if variant % 2 else 1
    x1 = width - 1 if variant % 3 else width - 2
    y0 = 0 if variant % 3 else 1
    y1 = height - 1 if variant % 2 else height - 2
    outside = (x < x0) | (x > x1) | (y < y0) | (y > y1)
    rgba[outside, 3] = 0
    return rgba

cases = []
with tempfile.TemporaryDirectory(prefix="trellis-alpha-source-fixture-") as temp:
    for name, width, height, variant in [
        ("odd-center", 7, 8, 1), ("even-center", 8, 9, 2),
        ("wide-padding", 15, 4, 3), ("tall-padding", 4, 15, 4),
        ("threshold-and-rounding", 13, 11, 5),
        ("rgb-downscale", 519, 523, 6),
        ("rgba-max-side-downscale", 1031, 1025, 7),
        ("thin-max-side-downscale", 1057, 13, 8),
    ]:
        rgba = pattern(width, height, variant)
        path = Path(temp) / (name + ".png")
        Image.fromarray(rgba).save(path)
        encoded = path.read_bytes()
        if args.images_out:
            args.images_out.mkdir(parents=True, exist_ok=True)
            (args.images_out / (name + ".png")).write_bytes(encoded)
        source = preprocess_image_with_provenance(path)
        if source.provenance["route"] != "input-alpha" or source.provenance.get("fallback"):
            raise ValueError("fixture must exercise the real input-alpha source without fallback")
        resized = source.image.resize((512, 512), Image.Resampling.LANCZOS)
        p = source.provenance
        cases.append({
            "name": name, "width": width, "height": height, "variant": variant,
            "inputRgbaSha256": sha(rgba.tobytes()),
            "encodedPngSha256": sha(encoded), "encodedPngBytes": len(encoded),
            "foregroundPixels": p["foreground_pixels"],
            "foregroundBbox": p["foreground_bbox_xyxy"], "crop": p["crop"],
            "scaledSize": p["resize"]["output_size"],
            "croppedSize": list(source.image.size),
            "croppedRgbSha256": sha(source.image.tobytes()),
            "preparedRgbSha256": sha(resized.tobytes()),
            "preparedByteLength": len(resized.tobytes()),
        })
fixture = {
    "schema": "trellis2.alpha-preparation-source.v0",
    "source": {"commit": commit, "moduleSha256": sha(module.read_bytes()),
               "pillow": PIL.__version__, "numpy": np.__version__, "modelCalls": 0,
               "route": "preprocess_image_with_provenance(input-alpha) / PIL RGB LANCZOS512",
               "pattern": "channel=(37*x+101*y+79*c+17*variant)%256; alpha-table and margins in generator"},
    "cases": cases,
}
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(fixture, indent=2) + "\n")
print(json.dumps({"out": str(args.out.resolve()), "sha256": sha(args.out.read_bytes()),
                  "cases": len(cases), "source": fixture["source"]}))
