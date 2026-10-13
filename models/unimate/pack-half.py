"""Repack a float32 weight file (pack-weights.py or pack-t5.py output) with float16 storage.

Every float32 tensor of at least --min-elements values is rounded to float16 (round to nearest
even); smaller ones (biases, norms, small tables) stay float32. Tensors keep their 256-byte
alignment and gain a per-tensor ``dtype``. The page widens float16 back to float32 at load
(unimate-weights.js), so the kernels are unchanged and only the stored values are rounded.

  python pack-half.py --src <dir with the float32 manifest> --manifest manifest.json --out <dir>
"""
import argparse
import hashlib
import json
import os

import numpy as np

ALIGN = 256


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--manifest", required=True, help="manifest file name inside --src")
    ap.add_argument("--out", required=True)
    ap.add_argument("--min-elements", type=int, default=4096)
    args = ap.parse_args()
    manifest = json.load(open(os.path.join(args.src, args.manifest)))
    data = open(os.path.join(args.src, manifest["file"]), "rb").read()
    out_name = manifest["file"].replace("fp32", "fp16") if "fp32" in manifest["file"] else "half-" + manifest["file"]
    os.makedirs(args.out, exist_ok=True)
    tensors, chunks, offset, halved = [], [], 0, 0
    for t in manifest["tensors"]:
        if t.get("dtype", "float32") != "float32":
            raise ValueError(f"{t['name']}: expected float32 source")
        values = np.frombuffer(data, dtype="<f4", count=t["byteLength"] // 4, offset=t["offset"])
        if values.size >= args.min_elements:
            body, dtype = values.astype("<f2").tobytes(), "float16"
            halved += 1
        else:
            body, dtype = values.tobytes(), "float32"
        pad = (-offset) % ALIGN
        chunks.append(b"\0" * pad)
        offset += pad
        tensors.append({**t, "offset": offset, "byteLength": len(body), "dtype": dtype})
        chunks.append(body)
        offset += len(body)
    blob = b"".join(chunks)
    with open(os.path.join(args.out, out_name), "wb") as f:
        f.write(blob)
    out = {**manifest, "file": out_name, "byteLength": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "tensors": tensors,
           "storage": {"dtype": "float16", "min_elements": args.min_elements, "float32_source_sha256": manifest.get("sha256"),
                       "note": "float16 storage, widened to float32 at load"}}
    json.dump(out, open(os.path.join(args.out, args.manifest), "w"), indent=1)
    print(f"{halved}/{len(tensors)} tensors float16, {len(data)} -> {len(blob)} bytes")


if __name__ == "__main__":
    main()
