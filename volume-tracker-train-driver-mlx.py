#!/usr/bin/env python3
"""First real training run for the render-loss delta tracker.

Data: consecutive fitted chain states from the Grid48 curriculum run (the
oracle's banked hop solutions) paired with their target lattices/mediums from
the setup cache. The LAST `--holdout` pairs are never trained on; after
training the driver scores tracker vs frozen on them at the held camera —
the first honest tracker number, comparable to the render-space audit arms
(frozen 0.0509 / moment 0.0472 / oracle 0.0266).

Yield-aware: checkpoints MLP weights + Adam moments, defers to queue waiters,
self-resubmits. Fail-loud report on every phase.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import subprocess
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


TRACKER = load_module("tracker_train", "volume-splat-delta-tracker-mlx.py")
SETUP_CACHE = load_module("tracker_setup_cache", "volume-state-setup-cache.py")
CHAIN = load_module("tracker_chain", "volume-grid-chained-tracking-witness-mlx.py")
PROBE, ORACLE, TARGET = CHAIN.PROBE, CHAIN.ORACLE, CHAIN.TARGET

MANIFEST = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-grid96-exact-motion-62-120-r41/motion-manifest.json"
)
CHAIN_CHECKPOINTS = Path(
    "/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-sjb-grid48-curriculum-r1/checkpoints"
)


def fitted_states() -> list[tuple[str, dict[str, np.ndarray]]]:
    out = []
    for f in sorted(CHAIN_CHECKPOINTS.glob("hop-*-state-*.json")):
        payload = json.loads(f.read_text())
        sid = "coefficient-state-" + f.stem.split("-state-")[1]
        out.append((sid, {k: np.asarray(v) for k, v in payload.items()}))
    return out


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--iterations", type=int, default=1500)
    parser.add_argument("--holdout", type=int, default=3)
    parser.add_argument(
        "--holdout-states", default="",
        help="comma-separated state ids whose OUTGOING pairs are held out "
             "(overrides --holdout; keeps eval comparable across data scales)",
    )
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=3)
    parser.add_argument("--fit-cameras", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=20260824)
    parser.add_argument("--rung", type=int, default=48)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument(
        "--setup-cache-dir", type=Path,
        default=Path.home() / ".local/state/gpu-greenroom/cache/state-setup",
    )
    parser.add_argument("--yield-pending-dir", type=Path, default=None)
    parser.add_argument("--resubmit-cli", type=Path, default=None)
    parser.add_argument("--route-identity", default="")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "schema": "delta-tracker-train-v1", "status": "running", "failurePhase": "setup",
    }

    def flush() -> None:
        (output_dir / "report.json").write_text(json.dumps(report, indent=2))

    def resubmit() -> None:
        if args.resubmit_cli is None:
            return
        command = [
            str(args.resubmit_cli), "submit-command",
            "--repo-root", str(ROOT), "--cwd", str(ROOT),
            "--route-identity", args.route_identity,
            "--output-dir", str(output_dir),
            "--", sys.executable, "-u", str(Path(__file__).resolve()),
        ] + [a for a in sys.argv[1:]]
        receipt = subprocess.run(command, capture_output=True, text=True, timeout=60)
        print(f"[tracker-driver] self-resubmitted rc={receipt.returncode}", flush=True)

    try:
        report["failurePhase"] = "data-load"
        states = fitted_states()
        if len(states) < args.holdout + 3:
            raise RuntimeError(f"only {len(states)} fitted states; need holdout+3")

        def setup(sid: str):
            return SETUP_CACHE.load_or_build(
                MANIFEST, sid, args.rung, "ridge", args.sigma_cells, args.fine_grid,
                args.setup_cache_dir,
                build_medium=lambda: PROBE.restricted_medium_for_state(MANIFEST, sid, args.rung, "ridge"),
                build_lattice=lambda medium: TARGET.build_gaussian_density_lattice(
                    medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
                )[0],
            )

        per_state = {sid: setup(sid) for sid, _ in states}
        held_camera = next(c for _, c, _l in per_state.values() if c)
        medium0 = per_state[states[0][0]][0]
        world_center = medium0.origin + medium0.source_spacing * medium0.source_grid * 0.5
        cameras = ORACLE.orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)

        pairs = []
        for (sid_a, a), (sid_b, _b) in zip(states[:-1], states[1:]):
            med_a, _cam_a, lat_a = per_state[sid_a]
            med_b, _cam_b, lat_b = per_state[sid_b]
            pairs.append(TRACKER.TrainingPair(sid_a, sid_b, a, lat_a, lat_b, med_b))
        if args.holdout_states:
            held_ids = {v.strip() for v in args.holdout_states.split(",") if v.strip()}
            holdout_pairs = [p for p in pairs if p.id_a in held_ids]
            train_pairs = [p for p in pairs if p.id_a not in held_ids]
            if len(holdout_pairs) != len(held_ids):
                raise RuntimeError(f"holdout states unmatched: wanted {held_ids}, got {[p.id_a for p in holdout_pairs]}")
        else:
            train_pairs = pairs[: len(pairs) - args.holdout]
            holdout_pairs = pairs[len(pairs) - args.holdout:]
        report["trainPairs"] = [(p.id_a, p.id_b) for p in train_pairs]
        report["holdoutPairs"] = [(p.id_a, p.id_b) for p in holdout_pairs]
        flush()
        print(f"[tracker-driver] {len(train_pairs)} train pairs, {len(holdout_pairs)} holdout", flush=True)

        if args.dry_run:
            report["status"] = "dry-run-ok"
            report["failurePhase"] = None
            flush()
            return 0

        report["failurePhase"] = "training"
        result = TRACKER.train(
            pairs=train_pairs,
            cameras=cameras,
            fit_width=args.fit_width,
            fit_samples_per_cell=args.fit_samples_per_cell,
            iterations=args.iterations,
            learning_rate=args.learning_rate,
            seed=args.seed,
            checkpoint_path=output_dir / "tracker-weights.npz",
            yield_pending_dir=args.yield_pending_dir,
            on_yield=resubmit,
        )
        report["completedSteps"] = result["completedSteps"]
        report["finalTrainLoss"] = result["losses"][-1] if result["losses"] else None
        if not result["finished"]:
            report["status"] = "yielded"
            flush()
            return 0

        report["failurePhase"] = "holdout-eval"
        flush()
        model = TRACKER.DeltaTracker(TRACKER.FEATURE_DIM, args.seed)
        model.weights = {k: __import__("mlx.core", fromlist=["core"]).array(v) for k, v in result["weights"].items()}
        rows = []
        render_kwargs = {"width": 320, "samples_per_cell": 8}
        for pair in holdout_pairs:
            target_img, _t, _r = TARGET.march_density_lattice(
                pair.lattice_b, pair.medium, held_camera, **render_kwargs
            )

            def mae_of(state: dict[str, np.ndarray]) -> float:
                lat = ORACLE.mixture_density_lattice(state, pair.medium, fine_grid=args.fine_grid)
                img, _a2, _b2 = TARGET.march_density_lattice(lat, pair.medium, held_camera, **render_kwargs)
                return float(np.mean(np.abs(np.asarray(img) - np.asarray(target_img))))

            frozen_mae = mae_of(pair.state_a)
            features = TRACKER.splat_features(pair.state_a, pair.lattice_a, pair.lattice_b, pair.medium)
            raw = TRACKER.state_to_raw_np(pair.state_a, pair.medium)
            fine_cell = float(np.mean(np.asarray(pair.medium.source_spacing) * pair.medium.source_grid)) / args.fine_grid
            import mlx.core as mx
            deltas = TRACKER.DeltaTracker.forward(model.weights, mx.array(features.astype(np.float32)))
            raw_mx = {k: mx.array(np.asarray(v, dtype=np.float32)) for k, v in raw.items()}
            updated_raw = TRACKER._apply_deltas_mx(raw_mx, deltas, cell_world=fine_cell)
            updated_state = TRACKER.raw_to_state_np(
                {k: np.asarray(v, dtype=np.float64) for k, v in updated_raw.items()}, pair.medium
            )
            tracked_mae = mae_of(updated_state)
            rows.append({"from": pair.id_a, "to": pair.id_b,
                         "frozenMae": frozen_mae, "trackerMae": tracked_mae})
            print(f"[tracker-driver] holdout {pair.id_a}->{pair.id_b}: "
                  f"frozen={frozen_mae:.5f} tracker={tracked_mae:.5f}", flush=True)
        report["holdout"] = rows
        report["summary"] = {
            "meanFrozenMae": float(np.mean([r["frozenMae"] for r in rows])),
            "meanTrackerMae": float(np.mean([r["trackerMae"] for r in rows])),
        }
        report["status"] = "complete"
        report["failurePhase"] = None
        flush()
        print(json.dumps(report["summary"], indent=2), flush=True)
        return 0
    except Exception:
        report["status"] = "failed"
        report["error"] = traceback.format_exc()
        flush()
        raise


if __name__ == "__main__":
    raise SystemExit(main())
