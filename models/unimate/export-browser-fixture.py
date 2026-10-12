"""Convert a forward-mode reference capture into a browser fixture bundle.

The browser route works on valid joints only (padding independence is checked
by ``probe-conditioning.py``), so joint-indexed conditioning and activations
are sliced to ``n_joints``; the forward input and outputs keep their padded
reference shape so the page can slice them the same way the route does.

Output: ``<out>/fixture.bin`` (little-endian float32 / int32 arrays, 256-byte
aligned) and ``<out>/fixture.json`` (name, shape, dtype, offset, byteLength,
plus the capture's report identities).
"""

import argparse
import hashlib
import json
import os

import numpy as np

JOINT_AXES = {  # conditioning key -> joint axes in the padded (B, 71, ...) layout
    "tpos_first_frame": [1], "tpos_first_frame_parents": [1], "joint_depths": [1],
    "joint_names_emb": [1], "spectral_feats": [1], "graph_dist": [1, 2], "joint_relations": [1, 2],
    "mean": [1], "std": [1], "offsets": [1],
}
SCALAR_KEYS = ["caption_emb", "motion_length", "n_joints"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    cond = np.load(os.path.join(args.capture, "cond.npz"))
    fwd = np.load(os.path.join(args.capture, "forward.npz"))
    acts = np.load(os.path.join(args.capture, "activations.npz"))
    capture_report = json.load(open(os.path.join(args.capture, "report.json")))

    n = cond["n_joints"]
    if not (n == n[0]).all():
        raise ValueError(f"fixture expects one skeleton per batch, got n_joints={n.tolist()}")
    J = int(n[0])

    arrays = {}
    for key, axes in JOINT_AXES.items():
        a = cond[key]
        for ax in axes:
            a = np.take(a, np.arange(J), axis=ax)
        arrays[f"cond/{key}"] = a
    for key in SCALAR_KEYS:
        arrays[f"cond/{key}"] = cond[key]
    for key in ["noise", "t", "out_cond", "out_uncond", "out_cfg"]:
        arrays[f"forward/{key}"] = fwd[key]
    for key in acts.files:
        arrays[f"act/{key}"] = acts[key]

    os.makedirs(args.out, exist_ok=True)
    entries, offset = [], 0
    with open(os.path.join(args.out, "fixture.bin"), "wb") as f:
        for name, a in arrays.items():
            if a.dtype.kind == "f":
                a, dtype = a.astype("<f4"), "float32"
            elif a.dtype.kind in "iub":
                a, dtype = a.astype("<i4"), "int32"
            else:
                raise TypeError(f"{name}: unsupported dtype {a.dtype}")
            pad = (-offset) % 256
            f.write(b"\0" * pad)
            offset += pad
            data = np.ascontiguousarray(a).tobytes()
            f.write(data)
            entries.append({"name": name, "shape": list(a.shape), "dtype": dtype,
                            "offset": offset, "byteLength": len(data)})
            offset += len(data)
    h = hashlib.sha256(open(os.path.join(args.out, "fixture.bin"), "rb").read()).hexdigest()
    index = {
        "schema": "kaminos.unimate.browser-fixture.v0",
        "capture": os.path.abspath(args.capture),
        "capture_inputs": capture_report.get("inputs"),
        "capture_route": capture_report.get("effective_route"),
        "n_joints": J,
        "padded_joints": int(cond["joint_mask"].shape[-1]),
        "sha256": h,
        "byteLength": offset,
        "arrays": entries,
    }
    with open(os.path.join(args.out, "fixture.json"), "w") as f:
        json.dump(index, f, indent=2)
    print(f"{len(entries)} arrays, {offset} bytes, valid joints {J}")


if __name__ == "__main__":
    main()
