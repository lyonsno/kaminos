#!/usr/bin/env python3
"""Progressive coarse-to-fine ladder oracle: one population, refined up rungs.

Operator hypothesis: fit the FULL final mode budget against the easy coarse
target first (a curriculum, not a component), then refine every attribute —
centers, covariances, coefficients — as the target sharpens up the restriction
ladder. Nothing is frozen, so the frozen-coarse overshoot tax cannot exist by
construction, and per-mode width is free to stay fat where fat is safe.

Arms at EQUAL total step budget, all scored against the final-rung target:
- ladder:       fit@16 -> damped lift @24 -> damped lift @32
- direct:       fit@16 -> damped lift straight @32
- naive-jump:   fit@16 -> full-rate lift @32 (prices the shatter, not assumed)

Per-stage endpoint evaluations against each rung's own target fall out as a
same-population capacity curve. Stage-1 fits are cached by step count so the
direct and naive arms share an identical curriculum start.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent

LADDER_IDENTITY = "grid-progressive-ladder-oracle-v0"


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ORACLE = load_module("ceiling_oracle_ladder", "volume-grid16-ceiling-oracle-mlx.py")
TARGET = ORACLE.TARGET
FITTER = ORACLE.FITTER
require = FITTER.require


def arm_schedules(args: argparse.Namespace) -> list[dict[str, Any]]:
    return [
        {
            "name": "ladder",
            "stages": [
                {"grid": args.rung_coarse, "iterations": args.stage_iterations, "lr": args.learning_rate, "warm": False},
                {"grid": args.rung_mid, "iterations": args.stage_iterations, "lr": args.warm_learning_rate, "warm": True},
                {"grid": args.rung_fine, "iterations": args.stage_iterations, "lr": args.warm_learning_rate, "warm": True},
            ],
        },
        {
            "name": "direct",
            "stages": [
                {"grid": args.rung_coarse, "iterations": args.jump_iterations, "lr": args.learning_rate, "warm": False},
                {"grid": args.rung_fine, "iterations": args.jump_iterations, "lr": args.warm_learning_rate, "warm": True},
            ],
        },
        {
            "name": "naive-jump",
            "stages": [
                {"grid": args.rung_coarse, "iterations": args.jump_iterations, "lr": args.learning_rate, "warm": False},
                {"grid": args.rung_fine, "iterations": args.jump_iterations, "lr": args.learning_rate, "warm": True},
            ],
        },
    ]


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    spec = importlib.util.spec_from_file_location("optical_modes_ladder", mode_path)
    mode_module = importlib.util.module_from_spec(spec)
    sys.modules["optical_modes_ladder"] = mode_module
    spec.loader.exec_module(mode_module)
    schedules = arm_schedules(args)
    if args.arms:
        keep = {name.strip() for name in str(args.arms).split(",") if name.strip()}
        schedules = [arm for arm in schedules if arm["name"] in keep]
        require(len(schedules) > 0, f"arm filter matched nothing: {args.arms}")
    budgets = {arm["name"]: sum(stage["iterations"] for stage in arm["stages"]) for arm in schedules}
    require(len(set(budgets.values())) == 1, f"arm step budgets are unequal: {budgets}")

    report["failurePhase"] = "source-load"
    manifest, state, native_ids, positions, coefficients = FITTER.load_source_rows(manifest_path, args.state_id)
    held_camera = state.get("target") or {}
    require(held_camera.get("cameraPose") and int(held_camera.get("width", 0)) > 0, "held camera is missing")
    source_grid = int((state.get("replay") or {}).get("grid", 0))

    report["failurePhase"] = "rung-contracts"
    rungs = sorted({stage["grid"] for arm in schedules for stage in arm["stages"]})
    rung_data: dict[int, dict[str, Any]] = {}
    for grid in rungs:
        medium = FITTER.restrict_selected_optical_medium(
            native_ids, positions, coefficients, source_grid=source_grid, target_grid=grid, population=args.population
        )
        lattice, receipt = TARGET.build_gaussian_density_lattice(
            medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
        )
        rung_data[grid] = {
            "medium": medium,
            "lattice": lattice,
            "digest": ORACLE.lattice_digest(lattice),
            "contract": receipt,
        }
    report["source"] = {
        "manifestPath": str(manifest_path),
        "manifestSha256": FITTER.sha256_file(manifest_path),
        "stateId": args.state_id,
        "modeCount": args.mode_count,
        "rungs": rungs,
        "rungTargetSha256": {str(g): rung_data[g]["digest"] for g in rungs},
        "armStepBudget": budgets[schedules[0]["name"]],
    }

    fine_medium = rung_data[args.rung_fine]["medium"]
    world_center = fine_medium.origin + fine_medium.source_spacing * fine_medium.source_grid * 0.5
    fit_cameras = ORACLE.orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)
    eval_cameras = [held_camera] + ORACLE.orbit_cameras(
        held_camera, angles_degrees=[30.0, 90.0, 150.0], pivot=world_center
    )
    for grid in rungs:
        ORACLE.require_cameras_see_medium(fit_cameras + eval_cameras, rung_data[grid]["medium"])
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    stage_one_cache: dict[int, dict[str, Any]] = {}
    arms: list[dict[str, Any]] = []
    for arm in schedules:
        current_state: dict[str, np.ndarray] | None = None
        stage_receipts: list[dict[str, Any]] = []
        for index, stage in enumerate(arm["stages"]):
            grid = stage["grid"]
            data = rung_data[grid]
            label = f"{arm['name']}-stage{index}-g{grid}"
            report["failurePhase"] = f"fit-{label}"
            if index == 0 and stage["iterations"] in stage_one_cache:
                result = stage_one_cache[stage["iterations"]]
                print(f"[arm] {label}: reusing cached stage-1 fit ({stage['iterations']} steps)", flush=True)
            else:
                if stage["warm"]:
                    require(current_state is not None, "warm stage has no predecessor state")
                    seed_state = current_state
                    init = "warm"
                else:
                    seed_state = ORACLE.analytical_seed_state(data["medium"], mode_count=args.mode_count, seed=args.seed)
                    init = "warm"  # explicit state passthrough keeps one code path
                result = ORACLE.fit_modes(
                    data["medium"],
                    data["lattice"],
                    fit_cameras,
                    mode_count=args.mode_count,
                    iterations=stage["iterations"],
                    fit_width=args.fit_width,
                    fit_samples_per_cell=args.fit_samples_per_cell,
                    seed=args.seed,
                    init=init,
                    learning_rate=stage["lr"],
                    initial_state=seed_state,
                )
                ORACLE.require_lattice_identity(data["lattice"], data["digest"])
                if index == 0:
                    stage_one_cache[stage["iterations"]] = result
            current_state = result["state"]
            report["failurePhase"] = f"evaluate-{label}"
            evaluation = ORACLE.evaluate_arm(
                {
                    "state": current_state,
                    "modeCount": args.mode_count,
                    "init": label,
                    "seed": args.seed,
                    "initialLoss": result["initialLoss"],
                    "finalLoss": result["finalLoss"],
                },
                data["medium"],
                data["lattice"],
                eval_cameras,
                mode_module,
                output_dir,
                fine_grid=args.fine_grid,
                render_width=args.render_width,
                samples_per_cell=args.samples_per_cell,
            )
            stage_receipts.append(
                {
                    "stage": index,
                    "grid": grid,
                    "iterations": stage["iterations"],
                    "learningRate": stage["lr"],
                    "unseenMaeVsOwnRung": evaluation["meanHeldLinearMae"],
                    "maeFractionOfRungLuma": evaluation["meanHeldLinearMae"]
                    / max(evaluation["meanHeldTargetLuma"], 1e-12),
                    "massReceipt": evaluation["massReceipt"],
                    "artifactLabel": evaluation["label"],
                }
            )
        arms.append(
            {
                "name": arm["name"],
                "stages": stage_receipts,
                "finalUnseenMaeVsFineRung": stage_receipts[-1]["unseenMaeVsOwnRung"],
            }
        )
        report["arms"] = arms
        FITTER.write_json(output_dir / "report.json", {**report, "status": "running"})

    report["failurePhase"] = "summary"
    best = min(arms, key=lambda arm: arm["finalUnseenMaeVsFineRung"])
    report["summary"] = {
        "best": best["name"],
        "finalUnseenMaeVsFineRung": best["finalUnseenMaeVsFineRung"],
        "baselines": {
            "soloConfinedGrid32": 0.09270,
            "frozenHierGrid32": 0.11640,
            "coarseAloneGrid32": 0.12794,
        },
    }
    report["failurePhase"] = None
    report["status"] = "complete"
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--state-id", default="coefficient-state-120")
    parser.add_argument("--mode-module", type=Path, default=ROOT / "volume-grid96-off-lattice-optical-modes.py")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--rung-coarse", type=int, default=16)
    parser.add_argument("--rung-mid", type=int, default=24)
    parser.add_argument("--rung-fine", type=int, default=32)
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--mode-count", type=int, default=200)
    parser.add_argument("--stage-iterations", type=int, default=500)
    parser.add_argument("--jump-iterations", type=int, default=750)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--warm-learning-rate", type=float, default=0.002)
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=3)
    parser.add_argument("--fit-cameras", type=int, default=6)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--arms", default="")
    parser.add_argument("--seed", type=int, default=20260727)
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {"schema": LADDER_IDENTITY, "status": "running", "failurePhase": "inputs"}
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
        print(f"progressive-ladder failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(execute())
