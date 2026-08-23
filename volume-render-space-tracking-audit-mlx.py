#!/usr/bin/env python3
"""Render-space tracking audit: do cheap population updates hold up where it
matters — in the rendered image?

Per-splat trajectory prediction proved gauge-dominated (advection align 0.015,
moment tracking 0.146 with 9x-small magnitudes): overlapping Gaussians
re-allocate collectively among render-equivalent configurations, so per-splat
supervision is partly noise. The lawful objective is render fidelity. This
audit scores, for each chain hop A->B at the held camera:

  frozen arm : population A rendered against target B (zero-update floor)
  moment arm : population A with centers moved by the local density-centroid
               shift (the cheap analytical update), rendered against target B
  ceiling    : the oracle's own 150-step refit heldMae (hop-reports.json,
               route-identical render settings)

If the moment arm lands near the ceiling, live tracking is viable despite
per-splat alignment ~0.15. If it sits at the floor, cheap analytical updates
buy nothing in render space either, and the learned tracker (render-loss
trained) becomes the mainline.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import traceback
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent
MANIFEST_ROOT = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-grid96-exact-motion-62-120-r41"
)
CHECKPOINTS = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-sjb-grid48-curriculum-r1/checkpoints"
)
HOP_REPORTS = CHECKPOINTS.parent / "hop-reports.json"
GRID = 96
CHAIN_RUNG = 48
SIGMA_CELLS = 0.6
FINE_GRID = 96
RENDER_KWARGS = {"width": 320, "samples_per_cell": 8}  # matches chain heldMae route
MAX_RADIUS_CELLS = 8
MAHALANOBIS_CUT = 3.0


def load_module(name: str, filename: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


PIPE = load_module("render_audit_pipe", "volume-longmotion-yielding-pipeline-mlx.py")
PROBE, ORACLE, TARGET, FITTER = PIPE.PROBE, PIPE.ORACLE, PIPE.TARGET, PIPE.FITTER


def fitted_states() -> list[tuple[str, dict[str, np.ndarray]]]:
    out = []
    for f in sorted(CHECKPOINTS.glob("hop-*-state-*.json")):
        payload = json.loads(f.read_text())
        sid = "coefficient-state-" + f.stem.split("-state-")[1]
        out.append((sid, {k: np.asarray(v) for k, v in payload.items()}))
    return out


def moment_update_centers(
    state_a: dict[str, np.ndarray], rho_a: np.ndarray, rho_b: np.ndarray,
    origin: np.ndarray, spacing: np.ndarray,
) -> np.ndarray:
    centers_g = (state_a["centers"] - origin) / spacing
    covs_g = state_a["covariances"] / np.outer(spacing, spacing)
    new_centers = state_a["centers"].copy()
    for i in range(centers_g.shape[0]):
        ca = _local_centroid(rho_a, centers_g[i], covs_g[i])
        cb = _local_centroid(rho_b, centers_g[i], covs_g[i])
        if ca is None or cb is None:
            continue
        new_centers[i] = state_a["centers"][i] + (cb - ca) * spacing
    return new_centers


def _local_centroid(rho: np.ndarray, center_g: np.ndarray, cov_g: np.ndarray):
    evals = np.linalg.eigvalsh(cov_g)
    radius = min(MAX_RADIUS_CELLS, max(2.0, MAHALANOBIS_CUT * float(np.sqrt(max(evals.max(), 1e-12)))))
    lo = np.maximum(np.floor(center_g - radius).astype(int), 0)
    hi = np.minimum(np.ceil(center_g + radius).astype(int) + 1, GRID)
    if np.any(hi <= lo):
        return None
    xs, ys, zs = np.meshgrid(
        np.arange(lo[0], hi[0]), np.arange(lo[1], hi[1]), np.arange(lo[2], hi[2]), indexing="ij"
    )
    pts = np.stack([xs, ys, zs], axis=-1).reshape(-1, 3) + 0.5
    d = pts - center_g
    try:
        prec = np.linalg.inv(cov_g)
    except np.linalg.LinAlgError:
        return None
    m2 = np.einsum("ni,ij,nj->n", d, prec, d)
    kern = np.exp(-0.5 * np.clip(m2, 0.0, 40.0))
    kern[m2 > MAHALANOBIS_CUT**2] = 0.0
    w = kern * rho[xs.ravel(), ys.ravel(), zs.ravel()]
    total = w.sum()
    if total <= 1e-12:
        return None
    return (w[:, None] * pts).sum(axis=0) / total


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true", help="load and validate inputs, no renders")
    args = parser.parse_args()
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report: dict = {"schema": "render-space-tracking-audit-v0", "status": "running",
                    "failurePhase": "setup", "hops": []}

    def flush():
        (output_dir / "report.json").write_text(json.dumps(report, indent=2))

    try:
        states = fitted_states()
        hop_metrics = {h["stateId"]: h for h in json.loads(HOP_REPORTS.read_text())}
        report["failurePhase"] = "state-load"
        manifest_path = MANIFEST_ROOT / "motion-manifest.json"

        per_state: dict[str, dict] = {}
        for sid, _ in states:
            medium, camera = PROBE.restricted_medium_for_state(manifest_path, sid, CHAIN_RUNG, "ridge")
            lattice, _r = TARGET.build_gaussian_density_lattice(
                medium, sigma_cells=SIGMA_CELLS, fine_grid=FINE_GRID
            )
            per_state[sid] = {"medium": medium, "lattice": lattice, "camera": camera}
        first_medium = per_state[states[0][0]]["medium"]
        origin = np.asarray(first_medium.origin, dtype=np.float64)
        spacing = np.asarray(first_medium.source_spacing, dtype=np.float64).reshape(-1)
        if spacing.size == 1:
            spacing = np.repeat(spacing, 3)
        _m, state_meta, _n, _p, _c = FITTER.load_source_rows(manifest_path, states[0][0])
        held_camera = state_meta.get("target") or {}

        if args.dry_run:
            report["status"] = "dry-run-ok"
            report["failurePhase"] = None
            report["statesLoaded"] = len(states)
            flush()
            print(json.dumps(report, indent=2))
            return 0

        for (sid_a, a), (sid_b, b) in zip(states[:-1], states[1:]):
            report["failurePhase"] = f"hop-{sid_a}->{sid_b}"
            med_b = per_state[sid_b]["medium"]
            lat_b = per_state[sid_b]["lattice"]
            rho_a = np.maximum(np.asarray(per_state[sid_a]["lattice"], dtype=np.float64), 0.0)
            rho_b = np.maximum(np.asarray(lat_b, dtype=np.float64), 0.0)
            if rho_a.ndim == 4:
                rho_a = rho_a.sum(axis=-1)
                rho_b = rho_b.sum(axis=-1)

            target_img, _t, _r = TARGET.march_density_lattice(lat_b, med_b, held_camera, **RENDER_KWARGS)

            def render_pop(state: dict[str, np.ndarray]) -> np.ndarray:
                lat = ORACLE.mixture_density_lattice(state, med_b, fine_grid=FINE_GRID)
                img, _a2, _b2 = TARGET.march_density_lattice(lat, med_b, held_camera, **RENDER_KWARGS)
                return img

            frozen_img = render_pop(a)
            moment_state = dict(a)
            moment_state["centers"] = moment_update_centers(a, rho_a, rho_b, origin, spacing)
            moment_img = render_pop(moment_state)

            def mae(img: np.ndarray) -> float:
                return float(np.mean(np.abs(np.asarray(img, dtype=np.float64)
                                            - np.asarray(target_img, dtype=np.float64))))

            row = {
                "from": sid_a, "to": sid_b,
                "frozenMae": mae(frozen_img),
                "momentMae": mae(moment_img),
                "oracleHeldMae": hop_metrics.get(sid_b, {}).get("heldMae"),
            }
            report["hops"].append(row)
            print(f"[render-audit] {sid_a}->{sid_b}: frozen={row['frozenMae']:.5f} "
                  f"moment={row['momentMae']:.5f} oracle={row['oracleHeldMae']}")
            flush()

        rows = report["hops"]
        report["summary"] = {
            "meanFrozenMae": float(np.mean([r["frozenMae"] for r in rows])),
            "meanMomentMae": float(np.mean([r["momentMae"] for r in rows])),
            "meanOracleHeldMae": float(np.mean([r["oracleHeldMae"] for r in rows if r["oracleHeldMae"]])),
        }
        report["status"] = "complete"
        report["failurePhase"] = None
        flush()
        print(json.dumps(report["summary"], indent=2))
        return 0
    except Exception:
        report["status"] = "failed"
        report["error"] = traceback.format_exc()
        flush()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
