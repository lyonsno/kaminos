#!/usr/bin/env python3
"""Advection Audit: can the simulator's own velocity field predict the oracle's
per-hop splat motion?

Analytical-first law (lane record 2026-08-23): before any learned delta predictor,
measure how far pure velocity advection gets. Prior art: Tiger's Grid16
persistent-continuation gate (2026-07-22) measured velocity-advected geometry
at 1.156x motion magnitude but only 0.236 signed alignment on a barely
converged N=48 fit. This audit re-runs the same two metrics on the converged
Grid48 curriculum chain (N=800, 11 hops) to test the operator hypothesis that
the earlier representation, not advection itself, was the limiting factor.

Offline, CPU-only. Inputs already on disk:
  - oracle hop fits: outputs/kaminos-sjb-grid48-curriculum-r1/checkpoints/hop-*-state-*.json
  - per-state features: outputs/kaminos-tiger-grid96-exact-motion-62-120-r41/artifacts/
    coefficient-state-XXX-features.f32 (rows,24; velocity.x/y/z at cols 17..19)
    + native cell indices (grid 96).

A single global time-scale scalar (least squares, sign included) calibrates
velocity units to hop spacing — a unit conversion, not a model.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np

MANIFEST_ROOT = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-grid96-exact-motion-62-120-r41"
)
CHECKPOINTS = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-sjb-grid48-curriculum-r1/checkpoints"
)
GRID = 96
VEL_COLS = (17, 18, 19)


def load_state_velocity(state_id: str) -> tuple[np.ndarray, np.ndarray]:
    """Return (cell_coords (M,3) float, velocity (M,3) float) for one state."""
    feats = np.memmap(
        MANIFEST_ROOT / "artifacts" / f"{state_id}-features.f32",
        dtype="<f4", mode="r",
    ).reshape(-1, 24)
    idx = np.memmap(
        MANIFEST_ROOT / "artifacts" / f"{state_id}-native-cell-indices.u32",
        dtype="<u4", mode="r",
    )
    z = idx // (GRID * GRID)
    y = (idx // GRID) % GRID
    x = idx % GRID
    coords = np.stack([x, y, z], axis=1).astype(np.float64) + 0.5
    vel = np.asarray(feats[:, VEL_COLS], dtype=np.float64)
    return coords, vel


def nearest_velocity(coords: np.ndarray, vel: np.ndarray, query: np.ndarray) -> np.ndarray:
    """Nearest-admitted-cell velocity lookup via a dense grid index."""
    dense = np.full((GRID, GRID, GRID, 3), np.nan)
    ci = coords.astype(int)
    dense[ci[:, 0], ci[:, 1], ci[:, 2]] = vel
    q = np.clip(np.round(query - 0.5).astype(int), 0, GRID - 1)
    out = dense[q[:, 0], q[:, 1], q[:, 2]]
    missing = np.isnan(out[:, 0])
    if missing.any():
        # brute-force nearest admitted cell for centers off the support
        qm = query[missing]
        for i, q in enumerate(qm):
            nn = int(np.argmin(((coords - q) ** 2).sum(axis=1)))
            out[np.flatnonzero(missing)[i]] = vel[nn]
    return out


def main() -> int:
    hop_files = sorted(CHECKPOINTS.glob("hop-*-state-*.json"))
    states = []
    for f in hop_files:
        payload = json.loads(f.read_text())
        sid = "coefficient-state-" + f.stem.split("-state-")[1]
        states.append((sid, {k: np.asarray(v) for k, v in payload.items()}))
    print(f"[audit] {len(states)} fitted chain states loaded")

    # World->grid mapping: infer affine from the fitted centers' extent is
    # unsafe; instead use the pipeline's own medium for origin/spacing.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import importlib.util

    spec = importlib.util.spec_from_file_location(
        "pipe", Path(__file__).resolve().parent / "volume-longmotion-yielding-pipeline-mlx.py"
    )
    pipe = importlib.util.module_from_spec(spec)
    sys.modules["pipe"] = pipe
    spec.loader.exec_module(pipe)
    manifest, state, native_ids, positions, coefficients = pipe.FITTER.load_source_rows(
        MANIFEST_ROOT / "motion-manifest.json", states[0][0]
    )
    medium = pipe.FITTER.restrict_selected_optical_medium(
        native_ids, positions, coefficients,
        source_grid=GRID, target_grid=GRID, population="ridge",
    )
    origin = np.asarray(medium.origin, dtype=np.float64)
    spacing = np.asarray(medium.source_spacing, dtype=np.float64).reshape(-1)
    if spacing.size == 1:
        spacing = np.repeat(spacing, 3)
    print(f"[audit] origin={origin.tolist()} spacing={spacing.tolist()}")

    def world_to_grid(p: np.ndarray) -> np.ndarray:
        return (p - origin) / spacing

    # Collect per-hop oracle deltas and velocity samples (at departure state).
    rows = []
    for (sid_a, a), (sid_b, b) in zip(states[:-1], states[1:]):
        d_world = b["centers"] - a["centers"]          # oracle motion (world)
        g_a = world_to_grid(a["centers"])
        coords, vel = load_state_velocity(sid_a)
        v = nearest_velocity(coords, vel, g_a)          # sim velocity at splats
        rows.append((sid_a, sid_b, d_world, v))  # deltas and velocity in world units

    D = np.concatenate([r[2] for r in rows])            # (11*800, 3) oracle
    V = np.concatenate([r[3] for r in rows])            # (11*800, 3) velocity
    # Global time-scale calibration (sign folded in): a* = <V,D>/<V,V>
    a_star = float((V * D).sum() / max((V * V).sum(), 1e-12))
    P = a_star * V
    print(f"[audit] global dt scale a*={a_star:.6f} (negative = chain runs backward in sim time)")

    def summarize(P: np.ndarray, D: np.ndarray, label: str) -> None:
        dn = np.linalg.norm(D, axis=1)
        pn = np.linalg.norm(P, axis=1)
        moved = dn > np.quantile(dn, 0.25)              # ignore the stillest quartile
        cos = (P * D).sum(1) / np.maximum(pn * dn, 1e-12)
        w = dn[moved]
        align = float((cos[moved] * w).sum() / w.sum())
        mag = float(pn[moved].mean() / dn[moved].mean())
        resid = float(np.linalg.norm(P - D, axis=1)[moved].mean() / dn[moved].mean())
        print(f"[audit] {label}: signed alignment={align:.3f}  magnitude ratio={mag:.3f}  "
              f"relative residual={resid:.3f}  (Tiger 2026-07-22 baseline: align 0.236, mag 1.156)")

    summarize(P, D, "ALL HOPS, motion-weighted")
    for sid_a, sid_b, d, v in rows:
        p = a_star * v
        dn = np.linalg.norm(d, axis=1); pn = np.linalg.norm(p, axis=1)
        moved = dn > np.quantile(dn, 0.25)
        cos = (p * d).sum(1) / np.maximum(pn * dn, 1e-12)
        w = dn[moved]
        print(f"  {sid_a}->{sid_b}: align={float((cos[moved]*w).sum()/w.sum()):.3f} "
              f"mag={float(pn[moved].mean()/dn[moved].mean()):.3f}")
    # Frozen-geometry control: predicting zero motion
    dn = np.linalg.norm(D, axis=1)
    moved = dn > np.quantile(dn, 0.25)
    print(f"[audit] frozen control: relative residual=1.000 by construction; "
          f"advection beats frozen iff relative residual above < 1.0")
    out = {
        "aStar": a_star,
        "hops": len(rows),
        "modes": int(states[0][1]["centers"].shape[0]),
    }
    Path("advection-audit-summary.json").write_text(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
