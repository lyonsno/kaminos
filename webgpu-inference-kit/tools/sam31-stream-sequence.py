#!/usr/bin/env python3
"""Prepare a retained recorded sequence and explicit polygon seed for a stream exercise."""
import argparse
import hashlib
import json
from pathlib import Path
from PIL import Image, ImageDraw


def prepare(source, out, size):
    config = json.loads(source.read_text())
    out.mkdir(parents=True, exist_ok=False)
    report = {"schema": "kaminos.sam31-stream-sequence.v1", "width": size, "height": size,
              "source": config, "preprocess": "Pillow RGB to RGBA, bicubic square resize", "frames": []}
    def save(name, data):
        (out / name).write_bytes(data)
        return {"file": name, "byteLength": len(data), "sha256": "sha256:" + hashlib.sha256(data).hexdigest()}
    for index, frame in enumerate(config["frames"]):
        path = source.parent / frame["file"]
        encoded = path.read_bytes()
        with Image.open(path) as image:
            if index == 0:
                mask = Image.new("L", image.size)
                ImageDraw.Draw(mask).polygon([tuple(p) for p in config["seedPolygon"]], fill=1)
                seed = mask.resize((size, size), Image.Resampling.NEAREST)
                seed.point(lambda value: value * 255).save(out / "seed.png")
                report["seed"] = {**save("seed.u8", seed.tobytes()),
                                  "authority": "hand-authored approximate seed; not model output or ground truth"}
            rgba = image.convert("RGB").resize((size, size), Image.Resampling.BICUBIC).convert("RGBA").tobytes()
        report["frames"].append({**save(f"frame-{index}.rgba", rgba), "encodedSha256": "sha256:" + hashlib.sha256(encoded).hexdigest(), "url": frame["url"]})
    (out / "sequence.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--size", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(prepare(args.source, args.out, args.size), indent=2))
