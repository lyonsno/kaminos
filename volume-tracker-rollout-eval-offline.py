#!/usr/bin/env python3
"""Rollout eval: how long does the tracker fly solo before drift eats it?

Per-hop gap recovery plateaued (~20%) across three feature dials; the live
design question is different — with an async oracle correction every K
frames, how large can K be? Answer: apply the tracker ITERATIVELY from one
oracle-fitted start across consecutive targets with no refit, render each
step at the held camera, and compare the MAE growth curve against the frozen
population rolled across the same targets. The oracle's own per-hop fits are
the floor. The hop index where an arm crosses a quality threshold IS its
correction cadence.

CPU renders; uses banked chain states + the v1.1 weights (best holdout).
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
Q = Path("/Users/noahlyons/.local/state/gpu-greenroom")
WEIGHTS = Q / "outputs" / "kaminos-sjb-tracker-train-r2" / "tracker-weights.npz"  # v1.1
CHECKPOINTS = Q / "outputs" / "kaminos-sjb-grid48-curriculum-r1" / "checkpoints"
MANIFEST = Q / "outputs" / "kaminos-tiger-grid96-exact-motion-62-120-r41" / "motion-manifest.json"
OUT = Q / "outputs" / "kaminos-sjb-tracker-train-r2"
START = "coefficient-state-102"   # a held-out-era start (past training pairs)
HOPS = 8
RENDER = {"width": 320, "samples_per_cell": 8}


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


TRACKER = load_module("rollout_tracker", "volume-splat-delta-tracker-mlx.py")
CACHE = load_module("rollout_cache", "volume-state-setup-cache.py")
CHAIN = load_module("rollout_chain", "volume-grid-chained-tracking-witness-mlx.py")
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


def main():
    import mlx.core as mx

    n0 = int(START.split("-")[-1])
    states = [f"coefficient-state-{n:03d}" for n in range(n0, n0 - 2 * (HOPS + 1), -2)]
    archive = np.load(WEIGHTS)
    weights = {k[len("weight."):]: mx.array(archive[k]) for k in archive.files if k.startswith("weight.")}
    model = TRACKER.DeltaTracker(TRACKER.FEATURE_DIM, 0, weights=weights)
    # v1.1 weights expect the v1.1 feature dim (132); rebuild features accordingly
    feat_dim = int(archive["weight.w1"].shape[0])

    per = {sid: setup(sid) for sid in states}

    def render_mae(state, sid):
        med, cam, lat = per[sid]
        latm = ORACLE.mixture_density_lattice(state, med, fine_grid=96)
        img, _t, _r = TARGET.march_density_lattice(latm, med, cam, **RENDER)
        target, _a, _b = TARGET.march_density_lattice(lat, med, cam, **RENDER)
        return float(np.mean(np.abs(np.asarray(img) - np.asarray(target))))

    def features_for(state, sid_a, sid_b):
        _ma, _ca, lat_a = per[sid_a]
        med_b, _cb, lat_b = per[sid_b]
        f = TRACKER.splat_features(state, lat_a, lat_b, med_b)
        if f.shape[1] != feat_dim:
            # Reconstruct the EXACT v1.1 layout from the v1.2 module's 120-dim
            # local block: [rho_b 0:27, delta 27:54, reg_b 54:81, reg_d 81:108,
            # frac 108:111, diag 111:114, emission 114:117, ext 117:118,
            # la 118:119, lb 119:120]. v1.1 local(66) = fine stencils + params,
            # NO regional block. A naive f[:, :66] silently feeds regional
            # columns where v1.1 expects params — measured poisoning the first
            # rollout attempt.
            assert f.shape[1] == 240, f.shape
            local = np.concatenate([f[:, 0:54], f[:, 108:120]], axis=1)
            assert local.shape[1] == 66
            pooled = np.broadcast_to(local.mean(axis=0, keepdims=True), local.shape)
            f = np.concatenate([local, pooled], axis=1)
            assert f.shape[1] == feat_dim, (f.shape, feat_dim)
        return f, med_b

    start_state = fitted(START)
    tracked = {k: v.copy() for k, v in start_state.items()}
    frozen = start_state
    rows = []
    for hop in range(1, HOPS + 1):
        sid_a, sid_b = states[hop - 1], states[hop]
        feats, med_b = features_for(tracked, sid_a, sid_b)
        raw = TRACKER.state_to_raw_np(tracked, med_b)
        fine_cell = float(np.mean(np.asarray(med_b.source_spacing) * med_b.source_grid)) / 96
        deltas = TRACKER.DeltaTracker.forward(model.weights, mx.array(feats.astype(np.float32)))
        raw_mx = {k: mx.array(np.asarray(v, dtype=np.float32)) for k, v in raw.items()}
        updated = TRACKER._apply_deltas_mx(raw_mx, deltas, cell_world=fine_cell)
        tracked = TRACKER.raw_to_state_np(
            {k: np.asarray(v, dtype=np.float64) for k, v in updated.items()}, med_b
        )
        row = {
            "hop": hop, "to": sid_b,
            "trackerMae": render_mae(tracked, sid_b),
            "frozenMae": render_mae(frozen, sid_b),
            "oracleMae": render_mae(fitted(sid_b), sid_b),
        }
        rows.append(row)
        print(f"[rollout] hop {hop} -> {sid_b}: tracker {row['trackerMae']:.4f} "
              f"frozen {row['frozenMae']:.4f} oracle {row['oracleMae']:.4f}", flush=True)
        if os.environ.get("SAVE_FRAMES"):
            from PIL import Image
            med, cam, lat = per[sid_b]
            def render_img(state):
                latm = ORACLE.mixture_density_lattice(state, med, fine_grid=96)
                img, _t, _r = TARGET.march_density_lattice(latm, med, cam, **RENDER)
                return np.asarray(img, dtype=np.float64)
            target_img, _a, _b = TARGET.march_density_lattice(lat, med, cam, **RENDER)
            frames = {"target": np.asarray(target_img, dtype=np.float64),
                      "tracker": render_img(tracked), "frozen": render_img(frozen),
                      "oracle": render_img(fitted(sid_b))}
            scale = max(frames["target"].max(), 1e-9)
            fdir = OUT / "rollout-frames"; fdir.mkdir(exist_ok=True)
            for arm, img in frames.items():
                Image.fromarray((np.clip(img / scale, 0, 1) * 255).astype(np.uint8)).save(
                    fdir / f"hop{hop:02d}-{arm}.png")
    (OUT / "rollout-eval.json").write_text(json.dumps(rows, indent=2))


if __name__ == "__main__":
    raise SystemExit(main())
