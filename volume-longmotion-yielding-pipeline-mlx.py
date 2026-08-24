#!/usr/bin/env python3
"""Yielding long-motion pipeline: seat fit + 30-state chain, polite to the queue.

The operator's schedule is unpredictable, so long runs must be launchable at
any time without holding the shared GPU hostage. This runner executes the
champion seat fit (ladder stages) and the chained tracking witness as one
resumable pipeline:

- Every fit stage checkpoints parameters AND Adam moments (fresh-moments
  restarts shatter — measured), and checks the Greenroom pending directory
  every `yield_check_steps` steps.
- If anyone is waiting, the stage checkpoints, the pipeline records its
  position in progress.json, resubmits ITSELF to the back of the FIFO via the
  provided CLI, and exits. Waiting jobs run; the pipeline resumes later from
  exactly where it stopped, as one continuous optimization.
- Chain hops (150 steps, ~10 min) yield at hop boundaries; hop states persist
  per hop so a resumed pipeline replays nothing.

On full completion it writes the chained witness report, per-state frames,
and the blink/scrub viewers exactly as the non-yielding drivers would.
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

PIPELINE_IDENTITY = "longmotion-yielding-pipeline-v0"


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


CHAIN = load_module("chained_witness_pipeline", "volume-grid-chained-tracking-witness-mlx.py")
SETUP_CACHE = load_module("state_setup_cache", "volume-state-setup-cache.py")
PROBE = CHAIN.PROBE
ORACLE = CHAIN.ORACLE
TARGET = CHAIN.TARGET
FITTER = CHAIN.FITTER
require = FITTER.require


def state_to_json(state: dict[str, np.ndarray]) -> dict[str, Any]:
    return {key: np.asarray(value).tolist() for key, value in state.items()}


def state_from_json(payload: dict[str, Any]) -> dict[str, np.ndarray]:
    return {key: np.asarray(value, dtype=np.float64) for key, value in payload.items()}


def load_progress(path: Path) -> dict[str, Any]:
    if path.is_file():
        return json.loads(path.read_text())
    return {"phase": "seat", "seatStage": 0, "chainHop": 0}


def save_progress(path: Path, progress: dict[str, Any]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(progress, indent=2))
    tmp.replace(path)


def self_resubmit(args: argparse.Namespace) -> None:
    command = [
        str(args.resubmit_cli),
        "submit-command",
        "--repo-root", str(ROOT),
        "--cwd", str(ROOT),
        "--route-identity", args.route_identity,
        "--output-dir", str(args.output_dir),
        "--",
        sys.executable, "-u", str(Path(__file__).resolve()),
    ] + [a for a in sys.argv[1:]]
    receipt = subprocess.run(command, capture_output=True, text=True, timeout=60)
    print(f"[pipeline] self-resubmitted (rc={receipt.returncode}): {receipt.stdout.strip()[:200]}", flush=True)


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    spec = importlib.util.spec_from_file_location("optical_modes_pipeline", mode_path)
    mode_module = importlib.util.module_from_spec(spec)
    sys.modules["optical_modes_pipeline"] = mode_module
    spec.loader.exec_module(mode_module)

    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    checkpoints = output_dir / "checkpoints"
    checkpoints.mkdir(exist_ok=True)
    progress_path = output_dir / "progress.json"
    progress = load_progress(progress_path)
    report["progressAtEntry"] = dict(progress)
    yield_dir = args.yield_pending_dir.expanduser().resolve() if args.yield_pending_dir else None

    chain_states = [value.strip() for value in str(args.chain_states).split(",") if value.strip()]
    seat_state_id = chain_states[0]
    rungs = [int(v) for v in str(args.seat_rungs).split(",") if v.strip()]

    report["failurePhase"] = "source-load"
    seat_medium_by_rung: dict[int, Any] = {}
    seat_lattice_by_rung: dict[int, Any] = {}
    held_camera: dict[str, Any] = {}

    def cached_state_setup(state_id: str, rung: int):
        return SETUP_CACHE.load_or_build(
            manifest_path, state_id, rung, args.population,
            args.sigma_cells, args.fine_grid, args.setup_cache_dir,
            build_medium=lambda: PROBE.restricted_medium_for_state(
                manifest_path, state_id, rung, args.population
            ),
            build_lattice=lambda medium: TARGET.build_gaussian_density_lattice(
                medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
            )[0],
        )

    for rung in rungs:
        medium, camera, lattice = cached_state_setup(seat_state_id, rung)
        seat_medium_by_rung[rung] = medium
        seat_lattice_by_rung[rung] = lattice
        held_camera = camera or held_camera
    require(held_camera.get("cameraPose") and int(held_camera.get("width", 0)) > 0, "held camera is missing")
    fine_medium = seat_medium_by_rung[rungs[-1]]
    world_center = fine_medium.origin + fine_medium.source_spacing * fine_medium.source_grid * 0.5
    fit_cameras = ORACLE.orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)

    # ---------------- Phase 1: seat (curriculum ladder, chunk-resumable) ----
    if progress["phase"] == "seat":
        for stage_index, rung in enumerate(rungs):
            if stage_index < progress["seatStage"]:
                continue
            medium = seat_medium_by_rung[rung]
            lattice = seat_lattice_by_rung[rung]
            stage_ckpt = checkpoints / f"seat-stage{stage_index}-g{rung}.npz"
            stage_state_file = checkpoints / f"seat-stage{stage_index}-g{rung}-state.json"
            if stage_state_file.is_file():
                progress["seatStage"] = stage_index + 1
                save_progress(progress_path, progress)
                continue
            if stage_index == 0:
                seed_state = ORACLE.analytical_seed_state(medium, mode_count=args.mode_count, seed=args.seed)
            else:
                prior = checkpoints / f"seat-stage{stage_index - 1}-g{rungs[stage_index - 1]}-state.json"
                seed_state = state_from_json(json.loads(prior.read_text()))
            report["failurePhase"] = f"seat-stage{stage_index}-g{rung}"
            lr = args.learning_rate if stage_index == 0 else args.warm_learning_rate
            result = ORACLE.fit_modes(
                medium, lattice, fit_cameras,
                mode_count=args.mode_count,
                iterations=args.stage_iterations,
                fit_width=args.fit_width,
                fit_samples_per_cell=args.fit_samples_per_cell,
                seed=args.seed,
                init="warm",
                learning_rate=lr,
                initial_state=seed_state,
                high_frequency_weight=args.high_frequency_weight,
                checkpoint_path=stage_ckpt,
                yield_pending_dir=yield_dir,
                yield_check_steps=args.yield_check_steps,
                yield_min_steps=args.yield_min_steps,
            )
            if not result["finished"]:
                save_progress(progress_path, progress)
                report["status"] = "yielded"
                report["yieldedAt"] = f"seat-stage{stage_index}-g{rung}@{result['completedSteps']}"
                self_resubmit(args)
                return report
            stage_state_file.write_text(json.dumps(state_to_json(result["state"])))
            stage_ckpt.unlink(missing_ok=True)
            progress["seatStage"] = stage_index + 1
            save_progress(progress_path, progress)
        progress["phase"] = "chain"
        save_progress(progress_path, progress)

    # ---------------- Phase 2: chained witness (hop-resumable) --------------
    report["failurePhase"] = "chain-setup"
    seat_state_file = checkpoints / f"seat-stage{len(rungs) - 1}-g{rungs[-1]}-state.json"
    require(seat_state_file.is_file(), "seat solution missing at chain start")
    per_state: dict[str, dict[str, Any]] = {}
    for state_id in chain_states:
        medium, _camera, lattice = cached_state_setup(state_id, rungs[-1])
        per_state[state_id] = {"medium": medium, "lattice": lattice}
    render_kwargs = {"width": args.render_width, "samples_per_cell": args.samples_per_cell}

    current_state = state_from_json(json.loads(seat_state_file.read_text()))
    hops: list[dict[str, Any]] = list(report.get("hops", []))
    previous_residual = None
    previous_tracked = None
    previous_centers = current_state["centers"]
    hop_reports_path = output_dir / "hop-reports.json"
    if hop_reports_path.is_file():
        hops = json.loads(hop_reports_path.read_text())

    for index, state_id in enumerate(chain_states):
        short = state_id.split("-")[-1]
        data = per_state[state_id]
        hop_state_file = checkpoints / f"hop-{index:02d}-state-{short}.json"
        target_png = output_dir / f"target-state-{short}.png"
        if not target_png.exists():
            target_linear, _t, _r = TARGET.march_density_lattice(data["lattice"], data["medium"], held_camera, **render_kwargs)
            FITTER.visual_artifact(target_png, target_linear, mode_module)
        if index < progress["chainHop"] and hop_state_file.is_file():
            current_state = state_from_json(json.loads(hop_state_file.read_text()))
            fitted_lattice = ORACLE.mixture_density_lattice(current_state, data["medium"], fine_grid=args.fine_grid)
            previous_tracked, _tt, _tr = TARGET.march_density_lattice(fitted_lattice, data["medium"], held_camera, **render_kwargs)
            target_linear, _a, _b = TARGET.march_density_lattice(data["lattice"], data["medium"], held_camera, **render_kwargs)
            previous_residual = previous_tracked - target_linear
            previous_centers = current_state["centers"]
            continue
        if index > 0:
            if yield_dir is not None and yield_dir.is_dir() and any(yield_dir.iterdir()):
                save_progress(progress_path, progress)
                report["status"] = "yielded"
                report["yieldedAt"] = f"chain-hop{index}-pending"
                self_resubmit(args)
                return report
            report["failurePhase"] = f"chain-hop{index}-{short}"
            hop_ckpt = checkpoints / f"hop-{index:02d}-fit.npz"
            # Hop fits never run longer than hop_iterations, so the hop
            # boundary already bounds startup churn; a seat-scale minimum
            # quantum would make the intra-fit yield gate unreachable and
            # stretch waiter latency to a full hop cycle.
            fit = ORACLE.fit_modes(
                data["medium"], data["lattice"], fit_cameras,
                mode_count=args.mode_count,
                iterations=args.hop_iterations,
                fit_width=args.fit_width,
                fit_samples_per_cell=args.fit_samples_per_cell,
                seed=args.seed,
                init="warm",
                learning_rate=args.warm_learning_rate,
                initial_state=current_state,
                anchor_weight=args.anchor_weight,
                high_frequency_weight=args.high_frequency_weight,
                checkpoint_path=hop_ckpt,
                yield_pending_dir=yield_dir,
                yield_check_steps=args.yield_check_steps,
                yield_min_steps=hop_fit_yield_quantum(args.yield_min_steps),
            )
            if not fit["finished"]:
                save_progress(progress_path, progress)
                report["status"] = "yielded"
                report["yieldedAt"] = f"chain-hop{index}-fit@{fit['completedSteps']}"
                self_resubmit(args)
                return report
            hop_ckpt.unlink(missing_ok=True)
            current_state = fit["state"]
        report["failurePhase"] = f"chain-witness{index}-{short}"
        fitted_lattice = ORACLE.mixture_density_lattice(current_state, data["medium"], fine_grid=args.fine_grid)
        tracked, _tt2, _tr2 = TARGET.march_density_lattice(fitted_lattice, data["medium"], held_camera, **render_kwargs)
        FITTER.visual_artifact(output_dir / f"tracked-anchored-state-{short}.png", tracked, mode_module)
        target_linear, _c, _d = TARGET.march_density_lattice(data["lattice"], data["medium"], held_camera, **render_kwargs)
        residual = tracked - target_linear
        drift = np.linalg.norm(current_state["centers"] - previous_centers, axis=1)
        cell = float(np.mean(data["medium"].spacing))
        hop: dict[str, Any] = {
            "stateId": state_id,
            "hop": index,
            "heldMae": float(np.mean(np.abs(residual))),
            "meanHopDriftCells": float(np.mean(drift) / cell),
        }
        if index > 0 and previous_tracked is not None:
            prev_target, _e, _f = TARGET.march_density_lattice(
                per_state[chain_states[index - 1]]["lattice"], per_state[chain_states[index - 1]]["medium"], held_camera, **render_kwargs
            )
            target_delta = target_linear - prev_target
            fit_delta = tracked - previous_tracked
            denominator = float(np.linalg.norm(target_delta) * np.linalg.norm(fit_delta))
            hop["temporalRelativeMagnitude"] = float(np.mean(np.abs(fit_delta)) / max(np.mean(np.abs(target_delta)), 1e-12))
            hop["temporalSignedAlignment"] = (
                float(np.dot(target_delta.reshape(-1), fit_delta.reshape(-1)) / denominator) if denominator > 0 else 0.0
            )
            if previous_residual is not None:
                hop["gestaltCorrVsPreviousHop"] = PROBE.residual_correlation(previous_residual, residual)
        hops = [h for h in hops if h.get("hop") != index] + [hop]
        hops.sort(key=lambda h: h["hop"])
        hop_reports_path.write_text(json.dumps(hops, indent=2))
        hop_state_file.write_text(json.dumps(state_to_json(current_state)))
        previous_residual = residual
        previous_tracked = tracked
        previous_centers = current_state["centers"]
        progress["chainHop"] = index + 1
        save_progress(progress_path, progress)
        report["hops"] = hops
        FITTER.write_json(output_dir / "report.json", {**report, "status": "running"})
        if yield_dir is not None and yield_dir.is_dir() and any(yield_dir.iterdir()) and index < len(chain_states) - 1:
            report["status"] = "yielded"
            report["yieldedAt"] = f"chain-postwitness{index}"
            self_resubmit(args)
            return report

    report["failurePhase"] = "witness-viewer"
    shorts = [s.split("-")[-1] for s in chain_states]
    metrics = {s.split("-")[-1]: hop for s, hop in zip(chain_states, hops)}
    viewer = output_dir / "witness-anchored.html"
    viewer.write_text(CHAIN.witness_html(shorts, metrics, "anchored"), encoding="utf-8")
    require(viewer.stat().st_size > 1000, "witness viewer is suspiciously small")
    report["hops"] = hops
    report["witnessViewer"] = "witness-anchored.html"
    report["failurePhase"] = None
    report["status"] = "complete"
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--chain-states", required=True)
    parser.add_argument("--mode-module", type=Path, default=ROOT / "volume-grid96-off-lattice-optical-modes.py")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--seat-rungs", default="16,24,32")
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--mode-count", type=int, default=400)
    parser.add_argument("--stage-iterations", type=int, default=1000)
    parser.add_argument("--hop-iterations", type=int, default=150)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--warm-learning-rate", type=float, default=0.002)
    parser.add_argument("--anchor-weight", type=float, default=0.05)
    parser.add_argument("--high-frequency-weight", type=float, default=4.0)
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=3)
    parser.add_argument("--fit-cameras", type=int, default=6)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260727)
    parser.add_argument(
        "--setup-cache-dir", type=Path,
        default=Path.home() / ".local/state/gpu-greenroom/cache/state-setup",
        help="disk cache for per-state mediums/lattices; deterministic products keyed by manifest identity",
    )
    parser.add_argument("--yield-pending-dir", type=Path, default=None)
    parser.add_argument("--yield-check-steps", type=int, default=50)
    parser.add_argument("--yield-min-steps", type=int, default=300)
    parser.add_argument("--resubmit-cli", type=Path, default=None)
    parser.add_argument("--route-identity", default="sjb/longmotion-yielding-pipeline")
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.yield_pending_dir is not None and args.resubmit_cli is None:
        print("yield mode requires --resubmit-cli", file=sys.stderr)
        return 2
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {"schema": PIPELINE_IDENTITY, "status": "running", "failurePhase": "inputs"}
    try:
        run(args, report)
        FITTER.write_json(output_dir / "report.json", report)
        return 0
    except Exception as failure:  # noqa: BLE001 — durable failure report is the contract
        report["status"] = "failed"
        report["failureMessage"] = str(failure)
        report["failureTraceback"] = traceback.format_exc()
        try:
            FITTER.write_json(output_dir / "report.json", report)
        except Exception:
            pass
        print(f"yielding-pipeline failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


def hop_fit_yield_quantum(requested_min_steps: int) -> int:
    """Chain hop fits ignore the seat-scale minimum yield quantum.

    The quantum exists to stop startup-dominated ping-pong across 1000-step
    seat fits. Hop fits cap at hop_iterations (150), so the requested seat
    quantum (default 300) would disable intra-hop yield checks entirely and
    waiters would sit through a full hop cycle (fit + witness render).
    """
    return 0


if __name__ == "__main__":
    raise SystemExit(execute())
