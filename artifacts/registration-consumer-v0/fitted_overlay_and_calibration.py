#!/usr/bin/env python3
"""Golden consumer exercise: fitted-overlay render + one-shot calibration.

Consumes Mushfinger's receipted chain (frame-link -> Stage A -> articulated
refinement) plus the per-bone containment and coverage receipts, entirely
from receipt data — no solver rerun. Renders the fitted skeleton over the
SF3D skin cast and executes the preregistered calibrate-once rule.

Independent-consumer discipline: transforms are applied from receipt fields
only; group membership is reconstructed from the frozen provisional manifest
and verified against receipt bone counts (fail-loud on mismatch).
"""
import struct, json, sys, math
import numpy as np

MB = "/private/tmp/kaminos-mushfinger-cast-correspondence-0807/artifacts/cast-correspondence-v0/"
MY = "."


def parse_glb(path):
    d = open(path, "rb").read()
    assert struct.unpack("<I", d[:4])[0] == 0x46546C67
    ln = struct.unpack("<I", d[12:16])[0]
    gltf = json.loads(d[20:20 + ln])
    off = 20 + ln
    bl = struct.unpack("<I", d[off:off + 4])[0]
    binbuf = d[off + 8:off + 8 + bl]
    return gltf, binbuf


def acc_array(gltf, binbuf, ai):
    acc = gltf["accessors"][ai]
    bv = gltf["bufferViews"][acc["bufferView"]]
    start = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)
    n, ncomp = acc["count"], {"VEC3": 3, "SCALAR": 1}[acc["type"]]
    fmt, sz = {5126: ("f", 4), 5125: ("I", 4), 5123: ("H", 2)}[acc["componentType"]]
    stride = bv.get("byteStride", sz * ncomp)
    out = np.zeros((n, ncomp))
    for i in range(n):
        out[i] = struct.unpack_from("<" + fmt * ncomp, binbuf, start + i * stride)
    return out


def local_matrix(node):
    if "matrix" in node:
        return np.array(node["matrix"]).reshape(4, 4).T
    m = np.eye(4)
    t = node.get("translation", [0, 0, 0]); s = node.get("scale", [1, 1, 1])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    R = np.array([[1-2*(y*y+z*z), 2*(x*y-z*w), 2*(x*z+y*w)],
                  [2*(x*y+z*w), 1-2*(x*x+z*z), 2*(y*z-x*w)],
                  [2*(x*z-y*w), 2*(y*z+x*w), 1-2*(x*x+y*y)]])
    m[:3, :3] = R * np.array(s); m[:3, 3] = t
    return m


def node_meshes(gltf, binbuf):
    parent = {}
    for i, n in enumerate(gltf["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    cache = {}
    def world(i):
        if i in cache: return cache[i]
        m = local_matrix(gltf["nodes"][i])
        if i in parent: m = world(parent[i]) @ m
        cache[i] = m; return m
    out = []
    for i, n in enumerate(gltf["nodes"]):
        if "mesh" not in n: continue
        pts = np.concatenate([acc_array(gltf, binbuf, p["attributes"]["POSITION"])
                              for p in gltf["meshes"][n["mesh"]]["primitives"]])
        w = world(i)
        out.append((n.get("name", f"n{i}"), (w[:3, :3] @ pts.T).T + w[:3, 3]))
    return out


def rot_axis_angle(axis, deg):
    a = np.array(axis, dtype=float); a /= np.linalg.norm(a)
    th = math.radians(deg); c, s = math.cos(th), math.sin(th)
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) * c + s * K + (1 - c) * np.outer(a, a)


def main():
    fl = json.load(open(MB + "receipts/frame-link--skeleton--envelope-baseline.json"))
    sa = json.load(open(MB + "receipts/envelope-baseline--cast-sf3d-skin-baseline.json"))
    ar = json.load(open(MB + "receipts/articulated-refinement--cast-sf3d-skin-baseline.json"))
    bc = json.load(open(MB + "receipts/bone-containment--cast-sf3d-skin-baseline.json"))
    man = json.load(open(MB + "frozen/region-manifest-golden-provisional.json"))["bone_to_region"]

    # skeleton bones in authored frame
    g, bb = parse_glb(MB + "frozen/skeleton-authored.glb")
    bones = node_meshes(g, bb)

    # chain: frame link (rigid) then Stage A (similarity)
    Rfl = np.array(fl["link"]["transform"]["rotation"]); tfl = np.array(fl["link"]["transform"]["translation"])
    T = sa["registration"]["transform"]
    Rsa = np.array(T["rotation"]); ssa = T["scale"]; tsa = np.array(T["translation"])

    def to_cast(p):
        return (ssa * (Rsa @ (Rfl @ p.T + tfl[:, None]))).T + tsa

    # group assignment reconstructed from manifest + laterality/AP split
    cents = {n: pts.mean(0) for n, pts in bones}
    C = np.array(list(cents.values()))
    mid_x = float(np.median(C[:, 0]))
    zs = np.array([c[2] for c in cents.values()])
    zmid = float((zs.min() + zs.max()) / 2)

    def group_of(name):
        r = man[name]
        if r == "caudal": return "tail"
        if r == "skull_mandible": return "head"
        if r in ("spine", "ribcage", "pelvis", "scapulae"): return "core"
        c = cents[name]
        limb = "forelimb" if (r == "forelimb" or (r == "pedal" and c[2] > zmid) or
                              (r == "hindlimb" and False)) else "hindlimb"
        if r == "hindlimb": limb = "hindlimb"
        if r == "forelimb": limb = "forelimb"
        side = "left" if c[0] < mid_x else "right"
        return f"{limb}-{side}"

    counts = {}
    for n, _ in bones:
        counts[group_of(n)] = counts.get(group_of(n), 0) + 1
    receipt_counts = {gr["group"]: gr["boneCount"] for gr in ar["refinement"]["groups"]}
    def flipname(k):
        return k.replace("left", "TMP").replace("right", "left").replace("TMP", "right")

    swap_fore = swap_hind = False
    for sf in (False, True):
        for sh in (False, True):
            trial = {}
            for k, v in counts.items():
                kk = k
                if kk.startswith("forelimb") and sf: kk = flipname(kk)
                if kk.startswith("hindlimb") and sh: kk = flipname(kk)
                trial[kk] = trial.get(kk, 0) + v
            if trial == receipt_counts:
                swap_fore, swap_hind = sf, sh
                break
        else:
            continue
        break
    else:
        sys.exit(f"FAIL LOUD: group reconstruction mismatch {counts} vs {receipt_counts}")

    groups = {gr["group"]: gr for gr in ar["refinement"]["groups"]}

    def refine(name, p):
        gname = group_of(name)
        if (gname.startswith("forelimb") and swap_fore) or (gname.startswith("hindlimb") and swap_hind):
            gname = flipname(gname)
        gr = groups[gname]
        if not gr.get("refinable"): return p
        piv = np.array(gr["pivotCastFrame"]); R = rot_axis_angle(gr["correctionAxis"], gr["correctionAngleDeg"])
        return (R @ (p - piv).T).T + piv

    # cast vertices
    cg, cb = parse_glb(MB + "frozen/cast-sf3d-skin-baseline.glb")
    cast = np.concatenate([pts for _, pts in node_meshes(cg, cb)])
    if len(cast) > 15000:
        cast = cast[np.random.RandomState(0).choice(len(cast), 15000, replace=False)]

    # render lateral + dorsal, global vs refined
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(2, 2, figsize=(20, 14))
    span = cast.max(0) - cast.min(0)
    lat_ax, up_ax, ml_ax = int(np.argmax(span)), None, None
    rest = [i for i in range(3) if i != lat_ax]
    ml_ax = rest[int(np.argmin(span[rest]))]
    up_ax = [i for i in range(3) if i not in (lat_ax, ml_ax)][0]

    # Color by MANIFEST REGION — same palette and semantics as the canonical
    # scatter-check derivation artifact, with a legend. (Coloring by
    # refinement group without a legend caused an operator misread during
    # manifest sign review; artifact-defect report 2026-08-08T065316Z.)
    REGION_COLORS = {"skull_mandible": "red", "spine": "orange",
                     "ribcage": "green", "scapulae": "purple",
                     "pelvis": "black", "forelimb": "blue",
                     "hindlimb": "cyan", "pedal": "brown", "caudal": "magenta"}
    for row, mode in enumerate(["global fit", "articulated refined"]):
        for col, (a1, a2, ttl) in enumerate([(lat_ax, up_ax, "lateral"), (lat_ax, ml_ax, "dorsal")]):
            ax = axes[row][col]
            ax.scatter(cast[:, a1], cast[:, a2], s=1, c="lightgray", alpha=0.5)
            for n, pts in bones:
                q = to_cast(pts[:: max(1, len(pts)//120)])
                if row == 1: q = refine(n, q)
                ax.scatter(q[:, a1], q[:, a2], s=2, c=REGION_COLORS[man[n]])
            ax.set_aspect("equal")
            ax.set_title(f"{ttl} — {mode} (colors = manifest regions)")
    import matplotlib.patches as mpatches
    fig.legend(handles=[mpatches.Patch(color=v, label=k)
                        for k, v in REGION_COLORS.items()],
               loc="lower center", ncol=9)
    plt.tight_layout(rect=(0, 0.04, 1, 1))
    plt.savefig("fitted-overlay-sf3d-skin.png", dpi=75)

    # ---- calibration (one-shot, per preregistration + supersession) ----
    per_bone = {x["name"]: x for x in bc["probe"]["perBone"]}
    regions = {}
    for n, _ in bones:
        regions.setdefault(man[n], []).append(n)
    gt_positive = ["spine", "scapulae", "pelvis", "forelimb", "hindlimb", "pedal", "skull_mandible"]
    calib = {"schema": "kaminos.registration-success-calibration.v0",
             "anchor": "cast-sf3d-skin-baseline (operator six-view verified)",
             "vectors": {}, "thresholds": {}, "verdicts": {}}
    for reg, names in sorted(regions.items()):
        vals = [per_bone[n]["insideFraction"] for n in names if n in per_bone]
        if not vals: continue
        mean_in = float(np.mean(vals))
        calib["vectors"][reg] = {"containment_mean_globalfit": round(mean_in, 4),
                                 "bones": len(vals)}
    # thresholds: loosest values classifying all GT-positive regions REGISTERS
    floor = min(calib["vectors"][r]["containment_mean_globalfit"]
                for r in gt_positive if r in calib["vectors"])
    calib["thresholds"]["containment_mean_min"] = round(floor, 4)
    cov = {("tail" if gr["group"] == "tail" else gr["group"]):
           gr.get("coverage", {}).get("coverage") for gr in ar["refinement"]["groups"]}
    calib["coverage_articulated"] = {k: (round(v, 4) if v else None) for k, v in cov.items()}
    for reg in calib["vectors"]:
        v = calib["vectors"][reg]["containment_mean_globalfit"]
        if reg == "caudal":
            calib["verdicts"][reg] = "UNDERSPANS (pose-corrected; coverage 0.29; operator: tail unfinished-short)"
        elif reg == "ribcage":
            calib["verdicts"][reg] = "UNMEASURABLE-AT-BONE-GRANULARITY (ribs not separate meshes)"
        elif reg == "skull_mandible":
            calib["verdicts"][reg] = f"REGISTERS-CONTAINMENT-ONLY (coverage NOT-YET-FORMULATED; containment {v})"
        else:
            calib["verdicts"][reg] = "REGISTERS" if v >= floor else f"BELOW-FLOOR ({v})"
    calib["notes"] = [
        "Thresholds bound once on the verified anchor; FROZEN for all later casts.",
        "Residual-quantile leg deferred: envelope-sample region restriction pending; containment+coverage legs bound now, residual leg binds on first region-restricted residual receipt without re-fitting these.",
        "Maquette paw band barred from GT-positive at global fit (calibration guard).",
    ]
    json.dump(calib, open("calibration-receipt.v0.json", "w"), indent=1)
    print(json.dumps(calib["vectors"], indent=1))
    print(json.dumps(calib["verdicts"], indent=1))
    print("floor:", floor)
    print("wrote fitted-overlay-sf3d-skin.png + calibration-receipt.v0.json")


if __name__ == "__main__":
    main()
