"""Bundle one skeleton and its prompts for the UniMate demo page.

From a forward-mode capture (export-reference.py) and the asset's cond.npy,
writes ``<out>/demo.json`` and ``<out>/demo.bin`` holding, for one skeleton:
- model conditioning for one batch row, sliced to valid joints (the
  denoiser's writeConditioning inputs), plus denormalization mean and std;
- the decode skeleton: parents, rest-pose positions, joint names;
- each captured prompt's T5 caption embedding and its reference initial noise
  (the capture's noise for that batch row), so the page can replay an accepted run.

Text and skeleton conditioning still come from Python until the browser T5
encoder and importer exist. Output carries the capture's identities.
"""

import argparse
import hashlib
import json
import os

import numpy as np


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--capture", required=True)
    ap.add_argument("--asset-cond", required=True)
    ap.add_argument("--asset-key", help="skeleton name inside a multi-skeleton cond.npy (default: its first entry)")
    ap.add_argument("--exp-dir", required=True, help="experiment dir with the sampler's config.json")
    ap.add_argument("--reference-positions", nargs="*", default=[],
                    help="accepted world positions (T, J, 3) .npy per prompt, in capture prompt order")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    # The sampler's output times, from upstream's own interval and float32 linspace.
    import torch
    from unimate.configs.schema import MainConfig
    from unimate.models.factory import create_transport
    transport = create_transport(training_config=MainConfig.from_json(os.path.join(args.exp_dir, "config.json")).training)
    t0, t1 = transport.check_interval(transport.train_eps, transport.sample_eps, sde=False, eval=True,
                                      reverse=False, last_step_size=0.0)
    output_times = torch.linspace(t0, t1, 50).tolist()

    cond = np.load(os.path.join(args.capture, "cond.npz"))
    fwd = np.load(os.path.join(args.capture, "forward.npz"))
    nontensor = json.load(open(os.path.join(args.capture, "cond-nontensor.json")))
    report = json.load(open(os.path.join(args.capture, "report.json")))
    J = int(cond["n_joints"][0])
    raw = np.load(args.asset_cond, allow_pickle=True).item()
    key = args.asset_key or next(iter(raw))
    skel = raw[key]
    if len(skel["parents"]) != J:
        raise ValueError(f"asset has {len(skel['parents'])} joints, capture has {J}")

    row = 0
    arrays = {
        "tpos": cond["tpos_first_frame"][row, :J], "tposParents": cond["tpos_first_frame_parents"][row, :J],
        "depths": cond["joint_depths"][row, :J].astype(np.int32), "jointNamesEmb": cond["joint_names_emb"][row, :J],
        "spectral": cond["spectral_feats"][row, :J], "graphDist": cond["graph_dist"][row, :J, :J].astype(np.int32),
        "jointRelations": cond["joint_relations"][row, :J, :J].astype(np.int32),
        "mean": cond["mean"][row, :J], "std": cond["std"][row, :J],
        "restPositions": np.asarray(skel["tpos_first_frame"], dtype=np.float32),
    }
    prompts = []
    for i, caption in enumerate(nontensor["caption"]):
        arrays[f"caption{i}"] = cond["caption_emb"][i]
        arrays[f"noise{i}"] = fwd["noise"][i, :J]
        entry = {"text": caption, "caption": f"caption{i}", "referenceNoise": f"noise{i}"}
        if i < len(args.reference_positions):
            arrays[f"reference{i}"] = np.load(args.reference_positions[i]).astype(np.float32)
            entry["referencePositions"] = f"reference{i}"
            entry["referenceSource"] = os.path.abspath(args.reference_positions[i])
        prompts.append(entry)

    os.makedirs(args.out, exist_ok=True)
    entries, offset = [], 0
    with open(os.path.join(args.out, "demo.bin"), "wb") as f:
        for name, a in arrays.items():
            a = np.ascontiguousarray(a.astype("<i4") if a.dtype.kind in "iu" else a.astype("<f4"))
            pad = (-offset) % 256
            f.write(b"\0" * pad)
            offset += pad
            data = a.tobytes()
            f.write(data)
            entries.append({"name": name, "shape": list(a.shape), "dtype": "int32" if a.dtype.kind == "i" else "float32",
                            "offset": offset, "byteLength": len(data)})
            offset += len(data)
    index = {
        "schema": "kaminos.unimate.demo-bundle.v0",
        "skeleton": {"name": key, "joints": J, "parents": [int(p) for p in skel["parents"]],
                     "jointNames": list(skel["joint_names"]), "fps": 30, "frames": int(fwd["noise"].shape[-1])},
        "motionLength": int(cond["motion_length"][row]),
        "outputTimes": output_times,
        "prompts": prompts,
        "capture": os.path.abspath(args.capture),
        "captureInputs": report.get("inputs"),
        "assetCondSha256": hashlib.sha256(open(args.asset_cond, "rb").read()).hexdigest(),
        "sha256": hashlib.sha256(open(os.path.join(args.out, "demo.bin"), "rb").read()).hexdigest(),
        "arrays": entries,
    }
    json.dump(index, open(os.path.join(args.out, "demo.json"), "w"), indent=2)
    print(f"{key}: {J} joints, {len(prompts)} prompts, {offset} bytes")


if __name__ == "__main__":
    main()
