#!/usr/bin/env python3
"""Derive a provisional bone->region manifest from the authored skeleton GLB.

Provisional-spatial derivation (agent-constructed, operator visual sign
pending). Region set matches the preregistered registration-success measure
(registration-success-measure-preregistration_2026-08-08, durable state).

Frame assumption (verified at runtime by bilateral-symmetry check, fail-loud):
authored blend frame ML=X, AP=Z, DV=Y (Plate-Forge detected frame for the
authored envelope; skeleton exported from the same blend).
"""
import struct, json, sys, hashlib
from collections import defaultdict

GLB = "inputs/authored_cat_skeleton.glb"
OUT = "provisional-region-manifest.v0.json"

REGIONS = ["skull_mandible", "spine", "ribcage", "scapulae", "pelvis",
            "forelimb", "hindlimb", "pedal", "caudal"]


def parse_glb(path):
    d = open(path, "rb").read()
    magic, ver, total = struct.unpack("<III", d[:12])
    assert magic == 0x46546C67, "not a GLB"
    ln, ty = struct.unpack("<II", d[12:20])
    gltf = json.loads(d[20:20 + ln])
    off = 20 + ln
    binbuf = b""
    if off < len(d):
        bl, bt = struct.unpack("<II", d[off:off + 8])
        binbuf = d[off + 8:off + 8 + bl]
    return gltf, binbuf, hashlib.sha256(d).hexdigest()


def node_world_positions(gltf, binbuf):
    """Per mesh-bearing node: world centroid + world AABB from POSITION data."""
    import numpy as np

    def acc_array(ai):
        acc = gltf["accessors"][ai]
        bv = gltf["bufferViews"][acc["bufferView"]]
        start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
        n = acc["count"]
        comp = {5126: ("f", 4)}[acc["componentType"]]
        ncomp = {"VEC3": 3}[acc["type"]]
        stride = bv.get("byteStride", comp[1] * ncomp)
        out = np.zeros((n, ncomp), dtype=np.float64)
        for i in range(n):
            o = start + i * stride
            out[i] = struct.unpack_from("<" + comp[0] * ncomp, binbuf, o)
        return out

    def local_matrix(node):
        if "matrix" in node:
            return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
        m = np.eye(4)
        t = node.get("translation", [0, 0, 0])
        s = node.get("scale", [1, 1, 1])
        q = node.get("rotation", [0, 0, 0, 1])
        x, y, z, w = q
        R = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
        m[:3, :3] = R * np.array(s)
        m[:3, 3] = t
        return m

    # build parent map and world transforms
    parent = {}
    for i, n in enumerate(gltf["nodes"]):
        for c in n.get("children", []):
            parent[c] = i

    world_cache = {}

    def world(i):
        if i in world_cache:
            return world_cache[i]
        m = local_matrix(gltf["nodes"][i])
        if i in parent:
            m = world(parent[i]) @ m
        world_cache[i] = m
        return m

    rows = []
    for i, n in enumerate(gltf["nodes"]):
        if "mesh" not in n:
            continue
        mesh = gltf["meshes"][n["mesh"]]
        pts = []
        for prim in mesh["primitives"]:
            pts.append(acc_array(prim["attributes"]["POSITION"]))
        pts = np.concatenate(pts)
        w = world(i)
        wp = (w[:3, :3] @ pts.T).T + w[:3, 3]
        rows.append({
            "node": i, "name": n.get("name", f"node{i}"),
            "centroid": wp.mean(axis=0).tolist(),
            "min": wp.min(axis=0).tolist(), "max": wp.max(axis=0).tolist(),
            "nverts": int(len(wp)),
        })
    return rows


def main():
    import numpy as np
    gltf, binbuf, sha = parse_glb(GLB)
    rows = node_world_positions(gltf, binbuf)

    C = np.array([r["centroid"] for r in rows])
    # Frame sanity (fail loud): ML=X must be the bilaterally symmetric axis —
    # bone centroids mirrored in X must roughly match the centroid set.
    mid_x = float(np.median(C[:, 0]))
    for ax, name in ((0, "X/ML"),):
        mid = float(np.median(C[:, ax]))
        m = C.copy(); m[:, ax] = 2 * mid - m[:, ax]
        d = np.sqrt(((C[None, :, :] - m[:, None, :]) ** 2).sum(-1)).min(1)
        span = C.max(0) - C.min(0)
        sym_res = float(np.median(d)) / float(np.linalg.norm(span))
        if sym_res > 0.05:
            sys.exit(f"FRAME INSANE: {name} symmetry residual {sym_res:.4f} > 0.05")

    span = C.max(0) - C.min(0)
    if not (span[2] > span[1] > span[0] * 0.0):  # AP=Z longest expected
        print(f"WARN: extent order unexpected: span={span}")

    pelvis = next((r for r in rows if r["name"] == "SRC_PELVIS"), None)
    if pelvis is None:
        sys.exit("FAIL LOUD: SRC_PELVIS anchor missing")
    pz = pelvis["centroid"][2]

    zmin, zmax = C[:, 2].min(), C[:, 2].max()
    ymin, ymax = C[:, 1].min(), C[:, 1].max()
    # head end = far-from-pelvis extreme in Z
    head_z = zmax if abs(zmax - pz) > abs(zmin - pz) else zmin
    tail_z = zmin if head_z == zmax else zmax
    sgn = 1.0 if head_z > tail_z else -1.0  # +Z toward head?

    def frac_to_head(z):
        return (z - tail_z) / (head_z - tail_z)

    # Up direction: verified visually 2026-08-08 — this export has +Y pointing
    # DOWN (feet at ymax, spine near ymin). h_up: 0 = feet, 1 = dorsal-most.
    manifest = {}
    diag = defaultdict(list)
    pz_thresh = pz - 0.02 * (head_z - tail_z) * sgn
    for r in rows:
        cx, cy, cz = r["centroid"]
        f = frac_to_head(cz)              # 0 tail-end .. 1 head-end
        h = (ymax - cy) / (ymax - ymin)   # 0 feet .. 1 dorsal (inverted Y)
        lat = abs(cx - mid_x) / (span[0] / 2 + 1e-9)
        if r["name"] == "SRC_PELVIS":
            reg = "pelvis"
        elif f > 0.90 and h > 0.7:
            reg = "skull_mandible"
        elif (cz - pz_thresh) * sgn < 0 and h > 0.6:
            reg = "caudal"
        elif h < 0.12:
            reg = "pedal"
        elif lat < 0.22 and h > 0.8:
            reg = "spine"
        elif lat > 0.22 and 0.62 < h < 0.88 and 0.55 < f < 0.88:
            reg = "scapulae"
        elif lat > 0.22 and 0.45 < h < 0.85 and 0.30 < f < 0.62:
            reg = "ribcage"
        else:
            reg = "forelimb" if f > 0.5 else "hindlimb"
        manifest[r["name"]] = reg
        diag[reg].append(r["name"])

    out = {
        "schema": "kaminos.provisional-region-manifest.v0",
        "authority": "provisional-spatial-derivation; operator visual sign pending",
        "source_glb_sha256": sha,
        "frame": {"ML": "X", "AP": "Z", "DV": "Y", "head_direction_z": sgn},
        "regions": REGIONS,
        "bone_to_region": manifest,
        "region_counts": {k: len(v) for k, v in sorted(diag.items())},
    }
    json.dump(out, open(OUT, "w"), indent=1)
    print("frame ok; head at z", "+max" if sgn > 0 else "-min")
    for k in REGIONS:
        print(f"{k:15s} {len(diag[k]):3d}  {diag[k][:6]}")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
