#!/usr/bin/env python3
"""Chained cadence tracking with an embedded blink/scrub motion witness.

Chains the curriculum population across every exact adjacent state in the
manifest (120 -> 118 -> 116) at the cadence budget: ~150 damped steps per hop,
warm from the previous hop's solution. Two chains run — damped and
damped+anchored — because the anchor's gauge-pinning may matter more across
hops than within one.

The accumulation question: does error and gestalt decorrelation GROW hop over
hop (compounding drift), or does the tracked population self-correct? Per hop:
unseen-camera MAE vs that state's own frozen-contract target, motion
magnitude/alignment vs the target's own delta, gestalt residual correlation
against the PREVIOUS hop's residual, and center drift (per-hop and cumulative).

The witness is not optional garnish: per state, target and tracked renders are
emitted under one fixed held camera with matched exposure, no interpolation,
and a small HTML viewer (A/B blink toggle, state scrub, loop play) is written
beside the report so the operator's eye — the only instrument that can measure
temporal calm — gets exact frames the moment the numbers exist.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import traceback
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parent

CHAIN_IDENTITY = "grid-chained-tracking-witness-v0"


def load_module(name: str, filename: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


PROBE = load_module("temporal_probe_chain", "volume-grid16-temporal-warmstart-probe-mlx.py")
ORACLE = PROBE.ORACLE
TARGET = ORACLE.TARGET
FITTER = ORACLE.FITTER
require = FITTER.require


def witness_html(states: list[str], metrics: dict[str, Any], chain_name: str) -> str:
    payload = json.dumps({"states": states, "metrics": metrics, "chain": chain_name}).replace("</", "<\\/")
    return f"""<!doctype html>
<html><head><meta charset="utf-8"><title>Chained tracking witness — {chain_name}</title>
<style>
body{{margin:0;background:#08090b;color:#dde5eb;font:13px system-ui,sans-serif;display:grid;grid-template-rows:auto 1fr auto;height:100vh}}
header{{padding:10px 14px;background:#11161b;border-bottom:1px solid #26313a;display:flex;gap:14px;align-items:center}}
main{{display:grid;place-items:center;min-height:0}}
img{{max-width:96vw;max-height:80vh;image-rendering:auto}}
footer{{padding:8px 14px;background:#10151a;border-top:1px solid #26313a;font:12px ui-monospace,monospace;color:#9eb0bd}}
button{{background:#1b2430;color:#dde5eb;border:1px solid #2a3540;border-radius:4px;padding:4px 10px;cursor:pointer}}
#track{{color:#ffb060;font-weight:600;min-width:70px;display:inline-block}}
</style></head><body>
<header>
<strong>Chained witness — {chain_name}</strong>
<button id="blink">blink A/B (space)</button>
<button id="play">play states (p)</button>
<span>state: <span id="state">-</span></span>
<span>showing: <span id="track">target</span></span>
<span style="color:#82919c">← → scrub states · space toggles target/tracked</span>
</header>
<main><img id="frame"></main>
<footer id="metrics"></footer>
<script>
const data={payload};
let si=0, tracked=false, playing=false, last=0;
const img=document.querySelector('#frame');
function src(){{const s=data.states[si];return (tracked?`tracked-${{data.chain}}-state-${{s}}.png`:`target-state-${{s}}.png`)}}
function draw(){{img.src=src();document.querySelector('#state').textContent=data.states[si];
document.querySelector('#track').textContent=tracked?'TRACKED':'target';
const m=data.metrics[data.states[si]]||{{}};
document.querySelector('#metrics').textContent=JSON.stringify(m);}}
document.addEventListener('keydown',e=>{{
if(e.code==='Space'){{tracked=!tracked;draw();e.preventDefault()}}
if(e.code==='ArrowRight'){{si=Math.min(data.states.length-1,si+1);draw()}}
if(e.code==='ArrowLeft'){{si=Math.max(0,si-1);draw()}}
if(e.key==='p'){{playing=!playing}}}});
document.querySelector('#blink').onclick=()=>{{tracked=!tracked;draw()}};
document.querySelector('#play').onclick=()=>{{playing=!playing}};
function tick(t){{if(playing&&t-last>450){{si=(si+1)%data.states.length;draw();last=t}}requestAnimationFrame(tick)}}
draw();requestAnimationFrame(tick);
</script></body></html>"""


def run(args: argparse.Namespace, report: dict[str, Any]) -> dict[str, Any]:
    report["failurePhase"] = "inputs"
    manifest_path = args.motion_manifest.expanduser().resolve()
    require(manifest_path.is_file(), f"motion manifest is missing: {manifest_path}")
    mode_path = args.mode_module.expanduser().resolve()
    require(mode_path.is_file(), f"mode module is missing: {mode_path}")
    spec = importlib.util.spec_from_file_location("optical_modes_chain", mode_path)
    mode_module = importlib.util.module_from_spec(spec)
    sys.modules["optical_modes_chain"] = mode_module
    spec.loader.exec_module(mode_module)
    source_solution = PROBE.load_state_json(args.source_solution.expanduser().resolve(), args.mode_count)
    chain_states = [value.strip() for value in str(args.chain_states).split(",") if value.strip()]
    require(len(chain_states) >= 2, "chain needs at least the source state and one hop")

    report["failurePhase"] = "state-contracts"
    per_state: dict[str, dict[str, Any]] = {}
    held_camera = None
    for state_id in chain_states:
        medium, camera = PROBE.restricted_medium_for_state(
            manifest_path, state_id, args.target_grid, args.population
        )
        if held_camera is None:
            held_camera = camera
        lattice, receipt = TARGET.build_gaussian_density_lattice(
            medium, sigma_cells=args.sigma_cells, fine_grid=args.fine_grid
        )
        per_state[state_id] = {
            "medium": medium,
            "lattice": lattice,
            "digest": ORACLE.lattice_digest(lattice),
            "contract": receipt,
        }
    digests = [per_state[s]["digest"] for s in chain_states]
    require(len(set(digests)) == len(digests), "two chain states share an identical target; no motion to witness")

    fine_medium = per_state[chain_states[0]]["medium"]
    world_center = fine_medium.origin + fine_medium.source_spacing * fine_medium.source_grid * 0.5
    fit_cameras = ORACLE.orbit_cameras(held_camera, count=args.fit_cameras, pivot=world_center)
    eval_cameras = [held_camera] + ORACLE.orbit_cameras(
        held_camera, angles_degrees=[30.0, 90.0, 150.0], pivot=world_center
    )
    for state_id in chain_states:
        ORACLE.require_cameras_see_medium(fit_cameras + eval_cameras, per_state[state_id]["medium"])
    output_dir = args.output_dir.expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    render_kwargs = {"width": args.render_width, "samples_per_cell": args.samples_per_cell}

    report["failurePhase"] = "target-frames"
    target_held: dict[str, np.ndarray] = {}
    for state_id in chain_states:
        data = per_state[state_id]
        linear, _t, _r = TARGET.march_density_lattice(data["lattice"], data["medium"], held_camera, **render_kwargs)
        target_held[state_id] = linear
        FITTER.visual_artifact(output_dir / f"target-state-{state_id.split('-')[-1]}.png", linear, mode_module)

    report["source"] = {
        "manifestPath": str(manifest_path),
        "manifestSha256": FITTER.sha256_file(manifest_path),
        "chainStates": chain_states,
        "targetSha256": {s: per_state[s]["digest"] for s in chain_states},
        "modeCount": args.mode_count,
        "hopIterations": args.hop_iterations,
        "sourceSolutionPath": str(args.source_solution),
    }

    chains = [
        {"name": "damped", "anchor": 0.0},
        {"name": "anchored", "anchor": args.anchor_weight},
    ]
    results: list[dict[str, Any]] = []
    for chain in chains:
        current_state = source_solution
        previous_residual: np.ndarray | None = None
        previous_centers = source_solution["centers"]
        hops: list[dict[str, Any]] = []
        for index, state_id in enumerate(chain_states):
            short = state_id.split("-")[-1]
            data = per_state[state_id]
            label = f"{chain['name']}-state-{short}"
            if index > 0:
                report["failurePhase"] = f"fit-{label}"
                fit = ORACLE.fit_modes(
                    data["medium"],
                    data["lattice"],
                    fit_cameras,
                    mode_count=args.mode_count,
                    iterations=args.hop_iterations,
                    fit_width=args.fit_width,
                    fit_samples_per_cell=args.fit_samples_per_cell,
                    seed=args.seed,
                    init="warm",
                    learning_rate=args.warm_learning_rate,
                    initial_state=current_state,
                    anchor_weight=chain["anchor"],
                )
                ORACLE.require_lattice_identity(data["lattice"], data["digest"])
                current_state = fit["state"]
            report["failurePhase"] = f"witness-{label}"
            fitted_lattice = ORACLE.mixture_density_lattice(current_state, data["medium"], fine_grid=args.fine_grid)
            tracked, _tt, _tr = TARGET.march_density_lattice(fitted_lattice, data["medium"], held_camera, **render_kwargs)
            FITTER.visual_artifact(output_dir / f"tracked-{chain['name']}-state-{short}.png", tracked, mode_module)
            residual = tracked - target_held[state_id]
            unseen = []
            for camera in eval_cameras[1:]:
                cam_target, _a, _b = TARGET.march_density_lattice(data["lattice"], data["medium"], camera, **render_kwargs)
                cam_fit, _c, _d = TARGET.march_density_lattice(fitted_lattice, data["medium"], camera, **render_kwargs)
                unseen.append(float(np.mean(np.abs(cam_fit - cam_target))))
            drift = np.linalg.norm(current_state["centers"] - previous_centers, axis=1)
            cumulative = np.linalg.norm(current_state["centers"] - source_solution["centers"], axis=1)
            cell = float(np.mean(data["medium"].spacing))
            hop: dict[str, Any] = {
                "stateId": state_id,
                "hop": index,
                "unseenMae": float(np.mean(unseen)),
                "heldMae": float(np.mean(np.abs(residual))),
                "meanHopDriftCells": float(np.mean(drift) / cell),
                "meanCumulativeDriftCells": float(np.mean(cumulative) / cell),
            }
            if index > 0:
                target_delta = target_held[state_id] - target_held[chain_states[index - 1]]
                fit_delta = tracked - previous_tracked
                denominator = float(np.linalg.norm(target_delta) * np.linalg.norm(fit_delta))
                hop["temporalRelativeMagnitude"] = float(
                    np.mean(np.abs(fit_delta)) / max(np.mean(np.abs(target_delta)), 1e-12)
                )
                hop["temporalSignedAlignment"] = (
                    float(np.dot(target_delta.reshape(-1), fit_delta.reshape(-1)) / denominator)
                    if denominator > 0
                    else 0.0
                )
                hop["gestaltCorrVsPreviousHop"] = PROBE.residual_correlation(previous_residual, residual)
            hops.append(hop)
            previous_residual = residual
            previous_tracked = tracked
            previous_centers = current_state["centers"]
        results.append({"name": chain["name"], "anchorWeight": chain["anchor"], "hops": hops})
        report["chains"] = results
        FITTER.write_json(output_dir / "report.json", {**report, "status": "running"})

    report["failurePhase"] = "witness-viewer"
    shorts = [s.split("-")[-1] for s in chain_states]
    for chain_result in results:
        metrics = {s.split("-")[-1]: hop for s, hop in zip(chain_states, chain_result["hops"])}
        viewer = output_dir / f"witness-{chain_result['name']}.html"
        viewer.write_text(witness_html(shorts, metrics, chain_result["name"]), encoding="utf-8")
        require(viewer.stat().st_size > 1000, "witness viewer is suspiciously small")
    report["witnessViewers"] = [f"witness-{c['name']}.html" for c in results]
    report["failurePhase"] = None
    report["status"] = "complete"
    return report


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--motion-manifest", required=True, type=Path)
    parser.add_argument("--source-solution", required=True, type=Path)
    parser.add_argument("--chain-states", default="coefficient-state-120,coefficient-state-118,coefficient-state-116")
    parser.add_argument("--mode-module", type=Path, default=ROOT / "volume-grid96-off-lattice-optical-modes.py")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--population", choices=("ridge", "nonridge", "combined"), default="ridge")
    parser.add_argument("--target-grid", type=int, default=32)
    parser.add_argument("--fine-grid", type=int, default=96)
    parser.add_argument("--sigma-cells", type=float, default=0.6)
    parser.add_argument("--mode-count", type=int, default=200)
    parser.add_argument("--hop-iterations", type=int, default=150)
    parser.add_argument("--warm-learning-rate", type=float, default=0.002)
    parser.add_argument("--anchor-weight", type=float, default=0.05)
    parser.add_argument("--fit-width", type=int, default=96)
    parser.add_argument("--fit-samples-per-cell", type=int, default=3)
    parser.add_argument("--fit-cameras", type=int, default=6)
    parser.add_argument("--render-width", type=int, default=320)
    parser.add_argument("--samples-per-cell", type=int, default=8)
    parser.add_argument("--seed", type=int, default=20260727)
    return parser.parse_args(argv)


def execute(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    output_dir = args.output_dir.expanduser().resolve()
    report: dict[str, Any] = {"schema": CHAIN_IDENTITY, "status": "running", "failurePhase": "inputs"}
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
        print(f"chained-witness failure [{report['failurePhase']}]: {failure}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(execute())
