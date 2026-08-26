#!/usr/bin/env python3
"""Error anatomy for the v1 tracker: WHERE does the residual render error live?

For one held-out hop pair, renders target / frozen / tracker / oracle at the
held camera and decomposes each arm's error by image structure: the target's
gradient-magnitude quartiles split the frame into smooth-body vs fine-filament
bands. If the tracker's untouched error concentrates in the top-gradient band,
the coarse 2-cell feature stencil (which cannot resolve that band) is the
binding constraint and finer/multi-scale features are the next dial; if error
is uniform, capacity/optimization is the story instead.

CPU-only (numpy renders). Writes PNGs + diff maps + a JSON band ledger.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
Q = Path("/Users/noahlyons/.local/state/gpu-greenroom")
import os
OUT = Q / "outputs" / os.environ.get("ANATOMY_RUN", "kaminos-sjb-tracker-train-r1")
CHECKPOINTS = Q / "outputs" / "kaminos-sjb-grid48-curriculum-r1" / "checkpoints"
MANIFEST = Q / "outputs" / "kaminos-tiger-grid96-exact-motion-62-120-r41" / "motion-manifest.json"
PAIR = ("coefficient-state-082", "coefficient-state-080")  # best holdout gain
RENDER = {"width": 320, "samples_per_cell": 8}


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


TRACKER = load_module("anatomy_tracker", "volume-splat-delta-tracker-mlx.py")
CACHE = load_module("anatomy_cache", "volume-state-setup-cache.py")
CHAIN = load_module("anatomy_chain", "volume-grid-chained-tracking-witness-mlx.py")
PROBE, ORACLE, TARGET = CHAIN.PROBE, CHAIN.ORACLE, CHAIN.TARGET


def fitted(sid):
    f = next(CHECKPOINTS.glob(f"hop-*-state-{sid.split('-')[-1]}.json"))
    return {k: np.asarray(v) for k, v in json.loads(f.read_text()).items()}


def setup(sid):
    return CACHE.load_or_build(
        MANIFEST, sid, 48, "ridge", 0.6, 96,
        Path.home() / ".local/state/gpu-greenroom/cache/state-setup",
        build_medium=lambda: PROBE.restricted_medium_for_state(MANIFEST, sid, 48, "ridge"),
        build_lattice=lambda m: TARGET.build_gaussian_density_lattice(m, sigma_cells=0.6, fine_grid=96)[0],
    )


def save_png(path, img, scale=None):
    from PIL import Image
    arr = np.asarray(img, dtype=np.float64)
    if scale is None:
        scale = max(arr.max(), 1e-9)
    Image.fromarray((np.clip(arr / scale, 0, 1) * 255).astype(np.uint8)).save(path)
    return scale


def main():
    sid_a, sid_b = PAIR
    state_a = fitted(sid_a)
    state_b = fitted(sid_b)  # oracle's own fit at B = ceiling arm
    med_a, cam, lat_a = setup(sid_a)
    med_b, _c, lat_b = setup(sid_b)

    # tracker arm
    import mlx.core as mx
    archive = np.load(OUT / "tracker-weights.npz")
    weights = {k[len("weight."):]: mx.array(archive[k]) for k in archive.files if k.startswith("weight.")}
    model = TRACKER.DeltaTracker(TRACKER.FEATURE_DIM, 0, weights=weights)
    features = TRACKER.splat_features(state_a, lat_a, lat_b, med_b)
    raw = TRACKER.state_to_raw_np(state_a, med_b)
    fine_cell = float(np.mean(np.asarray(med_b.source_spacing) * med_b.source_grid)) / 96
    deltas = TRACKER.DeltaTracker.forward(model.weights, mx.array(features.astype(np.float32)))
    raw_mx = {k: mx.array(np.asarray(v, dtype=np.float32)) for k, v in raw.items()}
    updated = TRACKER._apply_deltas_mx(raw_mx, deltas, cell_world=fine_cell)
    state_tracker = TRACKER.raw_to_state_np({k: np.asarray(v, dtype=np.float64) for k, v in updated.items()}, med_b)

    def render_state(state):
        lat = ORACLE.mixture_density_lattice(state, med_b, fine_grid=96)
        img, _t, _r = TARGET.march_density_lattice(lat, med_b, cam, **RENDER)
        return np.asarray(img, dtype=np.float64)

    print("[anatomy] rendering target...", flush=True)
    target, _t, _r = TARGET.march_density_lattice(lat_b, med_b, cam, **RENDER)
    target = np.asarray(target, dtype=np.float64)
    arms = {}
    for name, st in (("frozen", state_a), ("tracker", state_tracker), ("oracle", state_b)):
        print(f"[anatomy] rendering {name}...", flush=True)
        arms[name] = render_state(st)

    # gradient-band decomposition on the target's luma
    luma = target.mean(axis=-1)
    gy, gx = np.gradient(luma)
    gmag = np.hypot(gx, gy)
    body = luma > np.quantile(luma, 0.5)  # only score inside the flame body
    thresholds = np.quantile(gmag[body], [0.5, 0.75, 0.9])
    bands = {
        "smooth(body, grad<p50)": body & (gmag < thresholds[0]),
        "mid(p50-p75)": body & (gmag >= thresholds[0]) & (gmag < thresholds[1]),
        "sharp(p75-p90)": body & (gmag >= thresholds[1]) & (gmag < thresholds[2]),
        "filament(top10%)": body & (gmag >= thresholds[2]),
    }
    ledger = {}
    for name, img in arms.items():
        err = np.abs(img - target).mean(axis=-1)
        ledger[name] = {"overall": float(err[body].mean())}
        for band, mask in bands.items():
            ledger[name][band] = float(err[mask].mean())

    scale = save_png(OUT / "anatomy-target.png", target)
    for name, img in arms.items():
        save_png(OUT / f"anatomy-{name}.png", img, scale)
        diff = np.abs(img - target).mean(axis=-1)
        save_png(OUT / f"anatomy-diff-{name}.png", np.stack([diff] * 3, -1), scale * 0.25)
    (OUT / "anatomy-ledger.json").write_text(json.dumps(ledger, indent=2))
    print(json.dumps(ledger, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
