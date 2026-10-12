"""Record UniMate's upstream decode on retained Go2 outputs as a JS fixture.

Inputs: the Go2 asset's cond.npy (parents, rest-pose positions, joint names)
and retained denormalized features (60, 18, 12). For each clip, upstream code
computes the grounded rest-pose offsets (tpos_first_frame with its lowest Y
moved to 0, then Animation.offsets_from_positions, as float32) and
recover_unimate_joint_pos_from_rot. Writes JSON with skeleton, features and
world positions. No model or GPU involved.
"""

import argparse
import hashlib
import json

import numpy as np
from Animation import offsets_from_positions
from unimate.utils.motion_utils import recover_unimate_joint_pos_from_rot


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cond", required=True, help="asset cond.npy")
    ap.add_argument("--motion", nargs="+", required=True, help="denormalized feature .npy files (T, J, 12)")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    loaded = np.load(args.cond, allow_pickle=True).item()
    key = next(iter(loaded))
    cond = loaded[key]
    parents = np.asarray(cond["parents"])
    tpos = np.asarray(cond["tpos_first_frame"]).copy()
    tpos[..., 1] -= tpos[..., 1].min()
    offsets = offsets_from_positions(tpos, parents).astype(np.float32)
    clips = []
    for path in args.motion:
        feats = np.load(path)
        positions = recover_unimate_joint_pos_from_rot(feats, parents, offsets)
        clips.append({"source": path, "source_sha256": hashlib.sha256(open(path, "rb").read()).hexdigest(),
                      "shape": list(feats.shape), "features": feats.astype(np.float32).ravel().tolist(),
                      "positions": positions.ravel().tolist(), "positions_dtype": str(positions.dtype)})
    json.dump({"schema": "kaminos.unimate.decode-fixture.v0", "asset_key": key,
               "cond_sha256": hashlib.sha256(open(args.cond, "rb").read()).hexdigest(),
               "parents": parents.tolist(), "joint_names": list(cond["joint_names"]),
               "tpos_first_frame": np.asarray(cond["tpos_first_frame"]).tolist(), "offsets": offsets.tolist(),
               "clips": clips}, open(args.out, "w"))
    print(f"{len(clips)} clips, {len(parents)} joints")


if __name__ == "__main__":
    main()
