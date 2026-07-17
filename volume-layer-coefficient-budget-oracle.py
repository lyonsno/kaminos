#!/usr/bin/env python3
"""Compare causal fixed-budget quadrature cohorts on exact adjacent states."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import os
import traceback
from pathlib import Path
from typing import Any

REPORT_SCHEMA = "kaminos.volume.layer-coefficient-budget-oracle.v0"
MANIFEST_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0"
MOTION_REPORT_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-render.v0"
SELECTION_AUTHORITY = "camera-independent-exact-local-optical-coefficient-selection-v0"
DEPOSITS_PER_CANDIDATE = 20
np: Any = None
ORACLE: Any = None
MOTION: Any = None
LUMA: Any = None


def load_module(filename: str, name: str) -> Any:
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {filename}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def initialize_runtime() -> None:
    global np, ORACLE, MOTION, LUMA
    if os.environ.get("KAMINOS_BUDGET_ORACLE_FAIL_RUNTIME_INIT") == "1":
        raise RuntimeError("forced runtime initialization failure")
    if np is not None:
        return
    np = importlib.import_module("numpy")
    ORACLE = load_module("volume-layer-coefficient-render-oracle.py", "kaminos_coefficient_oracle")
    MOTION = load_module("volume-layer-coefficient-bilinear-motion-render.py", "kaminos_bilinear_motion")
    LUMA = np.asarray([0.2126, 0.7152, 0.0722], dtype=np.float32)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def load_json_binding(path: Path) -> tuple[dict[str, Any], str]:
    payload = path.read_bytes()
    return json.loads(payload), hashlib.sha256(payload).hexdigest()


def require_unchanged_binding(path: Path, expected_sha256: str) -> None:
    require(sha256_file(path) == expected_sha256, f"source changed after binding: {path}")


def validate_source_contract(
    manifest: dict[str, Any],
    motion_report: dict[str, Any],
    manifest_sha256: str,
) -> None:
    require(manifest.get("schema") == MANIFEST_SCHEMA, f"manifest schema must be {MANIFEST_SCHEMA}")
    require(motion_report.get("schema") == MOTION_REPORT_SCHEMA, f"motion report schema must be {MOTION_REPORT_SCHEMA}")
    require(motion_report.get("status") == "complete", "motion report is not complete")
    require((motion_report.get("source") or {}).get("manifestSha256") == manifest_sha256, "motion report does not bind this manifest")
    require((manifest.get("sequence") or {}).get("sampleCap") is None, "source corpus applied a hidden sample cap")
    require((manifest.get("sequence") or {}).get("droppedRowCount") == 0, "source corpus dropped candidates")


def stable_hash(values: np.ndarray) -> np.ndarray:
    mixed = values.astype(np.uint64, copy=True)
    mixed ^= mixed >> np.uint64(16)
    mixed *= np.uint64(0x7FEB352D)
    mixed &= np.uint64(0xFFFFFFFF)
    mixed ^= mixed >> np.uint64(15)
    mixed *= np.uint64(0x846CA68B)
    mixed &= np.uint64(0xFFFFFFFF)
    mixed ^= mixed >> np.uint64(16)
    return mixed.astype(np.uint32)


def select_stable_uniform(native_ids: np.ndarray, budget: int) -> np.ndarray:
    require(0 < budget <= native_ids.size, "stable-uniform budget is outside the candidate population")
    order = np.lexsort((native_ids, stable_hash(native_ids)))
    return np.sort(order[:budget])


def optical_energy_scores(coefficients: np.ndarray) -> np.ndarray:
    require(coefficients.ndim == 2 and coefficients.shape[1] == 8, "optical coefficients must have shape [rows,8]")
    emission = np.maximum(coefficients[:, 0:3] + coefficients[:, 4:7], 0.0) @ LUMA
    extinction = np.maximum(coefficients[:, 3] + coefficients[:, 7], 0.0)
    emission_scale = max(float(np.percentile(emission, 99.0)), 1e-8)
    extinction_scale = max(float(np.percentile(extinction, 99.0)), 1e-8)
    return emission / emission_scale + extinction / extinction_scale


def select_optical_energy(native_ids: np.ndarray, coefficients: np.ndarray, budget: int) -> np.ndarray:
    require(native_ids.size == coefficients.shape[0], "optical selection row population drifted")
    require(0 < budget <= native_ids.size, "optical-energy budget is outside the candidate population")
    scores = optical_energy_scores(coefficients)
    order = np.lexsort((stable_hash(native_ids), -scores))
    return np.sort(order[:budget])


def fixed_budget_selections(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    budget_fraction: float,
    candidate_budget: int | None = None,
) -> dict[str, np.ndarray]:
    require(0.0 < budget_fraction <= 1.0, "budget fraction must be in (0,1]")
    budget = max(1, int(np.floor(native_ids.size * budget_fraction))) if candidate_budget is None else int(candidate_budget)
    require(0 < budget <= native_ids.size, "fixed candidate budget is outside the current state population")
    selections = {
        "stable-uniform": select_stable_uniform(native_ids, budget),
        "optical-energy": select_optical_energy(native_ids, coefficients, budget),
    }
    require({rows.size for rows in selections.values()} == {budget}, "selection arms spent different candidate budgets")
    return selections


def actual_deposit_count(multiplicity: np.ndarray) -> int:
    return int(np.sum(multiplicity, dtype=np.int64))


def adjacent_motion_receipt(previous: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    step_delta = int(current["steps"]) - int(previous["steps"])
    require(step_delta > 0, "selected adjacent states require a positive step delta")
    previous_error = previous["render"].astype(np.float32) - previous["target"].astype(np.float32)
    current_error = current["render"].astype(np.float32) - current["target"].astype(np.float32)
    return {
        "fromStateId": previous["stateId"],
        "toStateId": current["stateId"],
        "stepDelta": step_delta,
        "nodeIdentityTurnover": MOTION.node_turnover(previous["ids"], current["ids"]),
        "multiplicityChurn": MOTION.multiplicity_churn(previous, current),
        "placementVelocity": MOTION.placement_velocity(previous, current, step_delta),
        "adjacentFramePixelDiffs": {
            "targetMae": MOTION.pixel_mae(previous["target"], current["target"]),
            "renderMae": MOTION.pixel_mae(previous["render"], current["render"]),
            "motionDeltaMae": MOTION.pixel_mae(
                current["render"].astype(np.int16) - previous["render"].astype(np.int16),
                current["target"].astype(np.int16) - previous["target"].astype(np.int16),
            ),
            "errorFieldDeltaMae": float(np.mean(np.abs(current_error - previous_error)) / 255.0),
        },
    }


def selection_viewer(rows: list[dict[str, Any]], policies: list[str]) -> str:
    payload = json.dumps(rows, separators=(",", ":"))
    options = "".join(f'<option value="{policy}">{policy}</option>' for policy in policies)
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fixed-Budget Quadrature Oracle</title><style>
body{{margin:0;background:#0d1013;color:#f4f5f6;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}}header{{position:sticky;top:0;z-index:2;padding:12px;background:#15191d;border-bottom:1px solid #343a40;display:flex;gap:14px;align-items:center;flex-wrap:wrap}}button,select{{background:#222930;color:#fff;border:1px solid #46515b;padding:7px 12px}}input{{width:min(580px,55vw)}}main{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;padding:10px}}figure{{margin:0;background:#15191d;border:1px solid #343a40}}figcaption{{padding:8px;color:#b8c0c8}}img{{display:block;width:100%;height:auto}}pre{{white-space:pre-wrap;margin:0;padding:10px;border-top:1px solid #343a40;color:#b8c0c8}}@media(max-width:900px){{main{{grid-template-columns:1fr}}}}
</style></head><body><header><strong>Fixed-budget quadrature oracle</strong><select id="policy">{options}</select><button id="prev">◀</button><input id="step" type="range" min="0" max="{len(rows)-1}" value="0"><button id="next">▶</button><span id="label"></span></header><main><figure><figcaption>Exact target</figcaption><img id="target"></figure><figure><figcaption>Selected quadrature</figcaption><img id="render"></figure><figure><figcaption>Residual</figcaption><img id="residual"><pre id="metrics"></pre></figure></main><script>
const rows={payload};const slider=document.querySelector('#step');function show(index){{index=Math.max(0,Math.min(rows.length-1,index));slider.value=index;const row=rows[index],arm=row.arms[policy.value];target.src=row.target;render.src=arm.render;residual.src=arm.residual;label.textContent=`${{row.stateId}} · ${{policy.value}} · ${{arm.selectedRows.toLocaleString()}} rows`;metrics.textContent=JSON.stringify(arm.metrics,null,2)}}slider.oninput=()=>show(+slider.value);policy.onchange=()=>show(+slider.value);prev.onclick=()=>show(+slider.value-1);next.onclick=()=>show(+slider.value+1);addEventListener('keydown',event=>{{if(event.key==='ArrowLeft')show(+slider.value-1);if(event.key==='ArrowRight')show(+slider.value+1)}});show(0);
</script></body></html>"""


def selected_state(
    state: dict[str, Any],
    manifest_path: Path,
    row_indices: np.ndarray,
    path_scale: float,
    policy: str,
    images_dir: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    rows = MOTION.load_rows(state, manifest_path)
    target = MOTION.target_image(state, manifest_path)
    descriptors = rows["kernelDescriptors"]
    selected_rows = {
        "count": int(row_indices.size),
        "features": np.asarray(rows["features"][row_indices]),
        "coefficients": np.asarray(rows["coefficients"][row_indices]),
        "nativeCellIndices": np.asarray(rows["nativeCellIndices"][row_indices], dtype=np.uint32),
        "kernelDescriptors": np.asarray(descriptors[row_indices]),
    }
    planes, telemetry = ORACLE.rasterize_coefficients(
        selected_rows["kernelDescriptors"][:, 0:3],
        selected_rows["kernelDescriptors"][:, 4:7],
        selected_rows["features"],
        selected_rows["coefficients"],
        MOTION.camera_contract(state),
        MOTION.DEPTH_BINS,
        "bilinear",
    )
    linear, _, _, _ = ORACLE.compose_planes(planes, path_scale, "total")
    render = ORACLE.tone_map(linear)
    residual = ORACLE.residual_heatmap(render, target)
    del planes, linear

    state_id = str(state["id"])
    target_path = images_dir / f"{state_id}-target.png"
    render_path = images_dir / f"{state_id}-{policy}.png"
    residual_path = images_dir / f"{state_id}-{policy}-residual.png"
    if not target_path.exists():
        ORACLE.write_png(target_path, target)
    ORACLE.write_png(render_path, render)
    ORACLE.write_png(residual_path, residual)
    camera = MOTION.camera_contract(state)
    placements = MOTION.flow_tap_placements(selected_rows, camera)
    multiplicity = MOTION.bilinear_deposit_multiplicity(placements, camera["width"], camera["height"])
    steps = int((state.get("replay") or {}).get("completedSteps"))
    temporal = {
        "stateId": state_id,
        "steps": steps,
        "ids": selected_rows["nativeCellIndices"],
        "placements": placements,
        "multiplicity": multiplicity,
        "target": target,
        "render": render,
    }
    receipt = {
        "policy": policy,
        "selectionAuthority": SELECTION_AUTHORITY,
        "targetUsedForSelection": False,
        "selectedRows": int(row_indices.size),
        "candidateBudget": int(row_indices.size),
        "nominalDepositEvaluationBudget": int(row_indices.size * DEPOSITS_PER_CANDIDATE),
        "actualInBoundsDepositCount": actual_deposit_count(multiplicity),
        "clippedDepositCount": int(row_indices.size * DEPOSITS_PER_CANDIDATE - actual_deposit_count(multiplicity)),
        "metrics": ORACLE.image_metrics(render, target),
        "rasterTelemetry": telemetry,
        "images": {
            "render": str(render_path),
            "residual": str(residual_path),
        },
    }
    return receipt, temporal


def run(
    manifest_path: Path,
    motion_report_path: Path,
    out_dir: Path,
    budget_fraction: float,
    mode: str,
) -> dict[str, Any]:
    manifest, manifest_sha256 = load_json_binding(manifest_path)
    motion_report, motion_report_sha256 = load_json_binding(motion_report_path)
    validate_source_contract(manifest, motion_report, manifest_sha256)
    require(mode in {"frozen", "sequence"}, "mode must be frozen or sequence")
    states = manifest.get("states") or []
    require(len(states) >= 2, "budget oracle requires at least two captured exact states")
    selected_states = [states[-1]] if mode == "frozen" else states
    budget_anchor_state = states[-1]
    budget_anchor_rows = MOTION.load_rows(budget_anchor_state, manifest_path)
    budget_anchor_population = int(budget_anchor_rows["nativeCellIndices"].shape[0])
    candidate_budget = max(1, int(np.floor(budget_anchor_population * budget_fraction)))
    path_scale = float((motion_report.get("transport") or {}).get("globalPathScale"))
    full_by_state = {str(row["stateId"]): row for row in motion_report.get("states") or []}
    require(all(str(state["id"]) in full_by_state for state in selected_states), "motion report is partial for selected states")

    out_dir.mkdir(parents=True, exist_ok=True)
    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)
    report_states: list[dict[str, Any]] = []
    temporal_by_policy: dict[str, list[dict[str, Any]]] = {"stable-uniform": [], "optical-energy": []}
    previous_by_policy: dict[str, dict[str, Any]] = {}
    target_hashes: set[str] = set()
    render_hashes: dict[str, set[str]] = {"stable-uniform": set(), "optical-energy": set()}

    for state in selected_states:
        state_id = str(state["id"])
        rows = MOTION.load_rows(state, manifest_path)
        ids = np.asarray(rows["nativeCellIndices"], dtype=np.uint32)
        coefficients = np.asarray(rows["coefficients"])
        selections = fixed_budget_selections(
            ids,
            coefficients,
            budget_fraction,
            candidate_budget=candidate_budget,
        )
        target = MOTION.target_image(state, manifest_path)
        target_path = images_dir / f"{state_id}-target.png"
        ORACLE.write_png(target_path, target)
        target_hashes.add(MOTION.sha256_pixels(target))
        arms: dict[str, Any] = {}
        for policy, row_indices in selections.items():
            receipt, temporal = selected_state(state, manifest_path, row_indices, path_scale, policy, images_dir)
            receipt["populationRows"] = int(ids.size)
            receipt["budgetFractionEffective"] = float(row_indices.size / ids.size)
            receipt["fullSupportMetrics"] = full_by_state[state_id]["metrics"]
            arms[policy] = receipt
            render_hashes[policy].add(MOTION.sha256_pixels(temporal["render"]))
            previous = previous_by_policy.get(policy)
            if previous is not None:
                temporal_by_policy[policy].append(adjacent_motion_receipt(previous, temporal))
            previous_by_policy[policy] = temporal
        require(len({arm["candidateBudget"] for arm in arms.values()}) == 1, f"{state_id} arms spent unequal candidate budgets")
        require(
            len({arm["nominalDepositEvaluationBudget"] for arm in arms.values()}) == 1,
            f"{state_id} arms evaluated unequal nominal deposit workloads",
        )
        report_states.append({
            "stateId": state_id,
            "steps": int((state.get("replay") or {}).get("completedSteps")),
            "populationRows": int(ids.size),
            "target": str(target_path),
            "arms": arms,
        })

    if mode == "sequence":
        require(len(target_hashes) == len(selected_states), "cached-or-static-render: exact targets are duplicated")
        for policy, hashes in render_hashes.items():
            require(len(hashes) == len(selected_states), f"cached-or-static-render: {policy} renders are duplicated")

    viewer_rows = []
    for row in report_states:
        viewer_rows.append({
            "stateId": row["stateId"],
            "steps": row["steps"],
            "target": str(Path(row["target"]).relative_to(out_dir)),
            "arms": {
                policy: {
                    "selectedRows": arm["selectedRows"],
                    "metrics": arm["metrics"],
                    "render": str(Path(arm["images"]["render"]).relative_to(out_dir)),
                    "residual": str(Path(arm["images"]["residual"]).relative_to(out_dir)),
                }
                for policy, arm in row["arms"].items()
            },
        })
    viewer_path = out_dir / "selection-viewer.html"
    viewer_path.write_text(selection_viewer(viewer_rows, ["stable-uniform", "optical-energy"]))
    require_unchanged_binding(manifest_path, manifest_sha256)
    require_unchanged_binding(motion_report_path, motion_report_sha256)
    return {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": "fixed-candidate-budget-causal-selection-oracle-v0",
        "mode": mode,
        "source": {
            "manifestPath": str(manifest_path),
            "manifestSha256": manifest_sha256,
            "motionReportPath": str(motion_report_path),
            "motionReportSha256": motion_report_sha256,
        },
        "selection": {
            "authority": SELECTION_AUTHORITY,
            "targetUsedForSelection": False,
            "budgetFractionRequested": budget_fraction,
            "candidateBudget": candidate_budget,
            "budgetAnchorStateId": str(budget_anchor_state["id"]),
            "budgetAnchorPopulation": budget_anchor_population,
            "maximumDepositsPerCandidate": DEPOSITS_PER_CANDIDATE,
            "workEquivalence": "equal-selected-candidates-and-equal-nominal-deposit-evaluations; actual-in-bounds-deposits-reported-as-outcome",
            "policies": ["stable-uniform", "optical-energy"],
        },
        "transport": {
            "depthBins": MOTION.DEPTH_BINS,
            "pathScale": path_scale,
            "pathScaleSource": "exact-full-support-sequence-global-calibration-v0",
            "perArmRefit": False,
            "perStateRefit": False,
        },
        "states": report_states,
        "adjacentStateMotion": temporal_by_policy,
        "selectionViewer": str(viewer_path),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--motion-report", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--budget-fraction", type=float, default=0.25)
    parser.add_argument("--mode", choices=("frozen", "sequence"), default="frozen")
    args = parser.parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    motion_report_path = Path(args.motion_report).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    failure_phase = "runtime-initialization"
    last_trustworthy_evidence: dict[str, Any] = {
        "manifestPath": str(manifest_path),
        "motionReportPath": str(motion_report_path),
    }
    try:
        initialize_runtime()
        failure_phase = "source-validation"
        require(manifest_path.is_file(), f"manifest is missing: {manifest_path}")
        require(motion_report_path.is_file(), f"motion report is missing: {motion_report_path}")
        failure_phase = "fixed-budget-render"
        report = run(manifest_path, motion_report_path, out_dir, args.budget_fraction, args.mode)
        last_trustworthy_evidence.update(report["source"])
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"status": "complete", "reportPath": str(report_path), "selectionViewer": report["selectionViewer"]}, indent=2))
        return 0
    except Exception as error:
        failure = {
            "schema": REPORT_SCHEMA,
            "status": "failed",
            "failurePhase": failure_phase,
            "reason": str(error),
            "lastTrustworthyEvidence": last_trustworthy_evidence,
            "traceback": traceback.format_exc(),
        }
        report_path.write_text(json.dumps(failure, indent=2) + "\n")
        print(json.dumps(failure, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
