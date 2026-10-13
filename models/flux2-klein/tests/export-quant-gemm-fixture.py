"""Export GEMM decode fixtures from packed Klein weight bundles.

For each named tensor, writes the tensor's packed codes and f16 scale/bias exactly as stored in the
bundle, a random input A [M, K], and the expected C = A @ W^T where W is decoded here, independently
of the packer, from the bit layout the kernels implement (i4: 8 codes per u32; i3: 32 codes per 3
u32 words, code j at bit 3j; i2: 16 codes per u32; scale and bias f16 per group). The browser check
(quant-gemm-check.html) runs the production GEMM shaders on those bytes and compares.

  python export-quant-gemm-fixture.py --weights <packed dit dir> --tensor double02/ff_out [...] --out <dir>
"""
import argparse
import json
from pathlib import Path

import numpy as np

CODES_PER_WORD = {"i4": 8, "i2": 16}


def decode(words, fmt, n, k, group, scale_bias):
    words = words.reshape(n, -1).astype(np.uint64)
    codes = np.zeros((n, k), dtype=np.uint64)
    if fmt in CODES_PER_WORD:
        bits, per = int(fmt[1]), CODES_PER_WORD[fmt]
        for c in range(per):
            codes[:, c::per] = (words >> np.uint64(bits * c)) & np.uint64(2 ** bits - 1)
    elif fmt == "i3":
        for j in range(32):
            w, sh = divmod(3 * j, 32)
            v = words[:, w::3] >> np.uint64(sh)
            if sh > 29:
                v |= words[:, w + 1::3] << np.uint64(32 - sh)
            codes[:, j::32] = v & np.uint64(7)
    else:
        raise ValueError(fmt)
    sb = scale_bias.reshape(n, k // group, 2).astype(np.float32)
    return (codes.astype(np.float32).reshape(n, k // group, group) * sb[:, :, :1] + sb[:, :, 1:]).reshape(n, k)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--weights", required=True)
    ap.add_argument("--tensor", action="append", required=True, help="bundle/name, e.g. double02/ff_out")
    ap.add_argument("--rows", type=int, default=100, help="rows of A (not a multiple of the 64-row tile)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    root, out = Path(args.weights), Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((root / "manifest.json").read_text())
    rng = np.random.default_rng(0)
    cases = []
    for spec in args.tensor:
        bundle_name, tensor_name = spec.split("/")
        bundle = manifest["bundles"][bundle_name]
        t = next(x for x in bundle["tensors"] if x["name"] == tensor_name)
        fmt, (n, k) = t["format"], t["shape"]
        group = t.get("group", manifest.get("group", 64))
        blob = (root / bundle["file"]).read_bytes()
        data = np.frombuffer(blob, dtype=np.uint32, count=t["bytes"] // 4, offset=t["offset"])
        scale_bias = np.frombuffer(blob, dtype=np.float16, count=t["scale_bytes"] // 2, offset=t["scale_offset"])
        w = decode(data, fmt, n, k, group, scale_bias)
        a = rng.standard_normal((args.rows, k)).astype(np.float32)
        c = (a.astype(np.float64) @ w.astype(np.float64).T).astype(np.float32)
        # One buffer like a bundle: codes at word 0, scales at a 256-byte aligned offset.
        scale_at = (len(data) * 4 + 255) // 256 * 256
        buf = bytearray(scale_at + scale_bias.nbytes)
        buf[: len(data) * 4] = data.tobytes()
        buf[scale_at:] = scale_bias.tobytes()
        name = spec.replace("/", "-")
        (out / f"{name}.w.bin").write_bytes(bytes(buf))
        (out / f"{name}.a.bin").write_bytes(a.tobytes())
        (out / f"{name}.c.bin").write_bytes(c.tobytes())
        cases.append({"name": name, "format": fmt, "group": group, "M": args.rows, "N": n, "K": k,
                      "scaleOffsetBytes": scale_at})
        print(name, fmt, (n, k), "group", group)
    (out / "meta.json").write_text(json.dumps({"source": str(root.resolve()), "cases": cases}, indent=1))


if __name__ == "__main__":
    main()
