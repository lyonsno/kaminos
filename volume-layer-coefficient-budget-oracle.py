#!/usr/bin/env python3
"""Compare causal fixed-budget quadrature cohorts on exact adjacent states."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import importlib.util
import json
import math
import os
import traceback
import types
from pathlib import Path
from typing import Any

REPORT_SCHEMA = "kaminos.volume.layer-coefficient-budget-oracle.v0"
MANIFEST_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-manifest.v0"
MOTION_REPORT_SCHEMA = "kaminos.volume.layer-coefficient-bilinear-motion-render.v0"
SELECTION_AUTHORITY = "camera-independent-exact-local-optical-coefficient-selection-v0"
HYSTERESIS_AUTHORITY = "prior-native-cell-membership-schmitt-admission-v0"
UNIFORM_AUTHORITY = "camera-independent-native-cell-hash-uniform-selection-v0"
COMPARISON_AUTHORITY = "fixed-candidate-budget-matched-policy-comparator-v0"
DEPOSITS_PER_CANDIDATE = 20
np: Any = None
ORACLE: Any = None
MOTION: Any = None
LUMA: Any = None
BOUND_IMPLEMENTATION_PAYLOADS: dict[str, bytes] | None = None
IMPLEMENTATION_PATH = Path(__file__).resolve()
IMPLEMENTATION_FILENAMES = (
    "volume-layer-coefficient-budget-oracle.py",
    "volume-layer-coefficient-render-oracle.py",
    "volume-layer-coefficient-bilinear-motion-render.py",
)


def load_module(filename: str, name: str) -> Any:
    path = Path(__file__).with_name(filename)
    if BOUND_IMPLEMENTATION_PAYLOADS is not None:
        if filename not in BOUND_IMPLEMENTATION_PAYLOADS:
            raise RuntimeError(f"bound implementation bundle omitted {filename}")
        module = types.ModuleType(name)
        module.__file__ = str(path)
        module.__package__ = ""
        if filename == "volume-layer-coefficient-bilinear-motion-render.py":
            if ORACLE is None:
                raise RuntimeError("bound motion runtime requires the already-bound render oracle")
            module.__dict__["BOUND_ORACLE"] = ORACLE
        exec(compile(BOUND_IMPLEMENTATION_PAYLOADS[filename], str(path), "exec"), module.__dict__)
        return module
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


def capture_implementation_bundle() -> tuple[dict[str, Any], dict[str, bytes]]:
    digest = hashlib.sha256()
    files: dict[str, dict[str, Any]] = {}
    payloads: dict[str, bytes] = {}
    for filename in IMPLEMENTATION_FILENAMES:
        path = IMPLEMENTATION_PATH.with_name(filename)
        payload = path.read_bytes()
        payloads[filename] = payload
        file_sha256 = hashlib.sha256(payload).hexdigest()
        encoded_name = filename.encode("utf-8")
        digest.update(len(encoded_name).to_bytes(4, "little"))
        digest.update(encoded_name)
        digest.update(len(payload).to_bytes(8, "little"))
        digest.update(payload)
        files[filename] = {
            "path": str(path),
            "bytes": len(payload),
            "sha256": file_sha256,
        }
    receipt = {
        "authority": "sha256-length-delimited-three-file-python-runtime-bundle-v0",
        "sha256": digest.hexdigest(),
        "files": files,
    }
    return receipt, payloads


def implementation_bundle_receipt() -> dict[str, Any]:
    receipt, _ = capture_implementation_bundle()
    return receipt


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


def native_id_sha256(native_ids: np.ndarray) -> str:
    ordered = np.sort(np.asarray(native_ids, dtype="<u4"))
    return hashlib.sha256(ordered.tobytes()).hexdigest()


def native_id_set_receipt(native_ids: np.ndarray) -> dict[str, Any]:
    ids = np.asarray(native_ids, dtype=np.uint32)
    return {
        "count": int(ids.size),
        "distinctCount": int(np.unique(ids).size),
        "sha256": native_id_sha256(ids),
    }


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


def optical_score_order(native_ids: np.ndarray, scores: np.ndarray) -> np.ndarray:
    return np.lexsort((native_ids, stable_hash(native_ids), -scores))


def select_optical_energy(native_ids: np.ndarray, coefficients: np.ndarray, budget: int) -> np.ndarray:
    require(native_ids.size == coefficients.shape[0], "optical selection row population drifted")
    require(0 < budget <= native_ids.size, "optical-energy budget is outside the candidate population")
    scores = optical_energy_scores(coefficients)
    order = optical_score_order(native_ids, scores)
    return np.sort(order[:budget])


def select_optical_hysteresis(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    budget: int,
    previous_optical_ids: np.ndarray | None,
    hysteresis_ratio: float,
    receipt: dict[str, Any] | None = None,
) -> np.ndarray:
    require(native_ids.size == coefficients.shape[0], "optical-hysteresis selection row population drifted")
    require(np.unique(native_ids).size == native_ids.size, "current optical native IDs must be unique")
    require(0 < budget <= native_ids.size, "optical-hysteresis budget is outside the candidate population")
    require(0.0 <= hysteresis_ratio < 1.0, "hysteresis ratio must be in [0,1)")
    scores = optical_energy_scores(coefficients)
    order = optical_score_order(native_ids, scores)
    entry_threshold = float(scores[order[budget - 1]])
    exit_threshold = entry_threshold * (1.0 - hysteresis_ratio)
    if previous_optical_ids is None or previous_optical_ids.size == 0:
        selected_rows = select_optical_energy(native_ids, coefficients, budget)
        if receipt is not None:
            selected_ids = native_ids[selected_rows]
            receipt.update({
                "authority": HYSTERESIS_AUTHORITY,
                "initializedFromStatelessOptical": True,
                "entryThreshold": entry_threshold,
                "exitThreshold": exit_threshold,
                "previous": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
                "selected": native_id_set_receipt(selected_ids),
                "retained": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
                "entered": native_id_set_receipt(selected_ids),
                "exited": native_id_set_receipt(np.empty(0, dtype=np.uint32)),
            })
        return selected_rows

    previous_ids = np.asarray(previous_optical_ids, dtype=native_ids.dtype)
    require(np.unique(previous_ids).size == previous_ids.size, "previous optical native IDs must be unique")
    previous_mask = np.isin(native_ids, previous_ids)
    retained = np.flatnonzero(previous_mask & (scores >= exit_threshold))
    retained_order = optical_score_order(native_ids[retained], scores[retained])
    retained = retained[retained_order[:budget]]

    selected = np.zeros(native_ids.size, dtype=bool)
    selected[retained] = True
    remaining = budget - retained.size
    if remaining > 0:
        selected[order[~selected[order]][:remaining]] = True
    selected_rows = np.flatnonzero(selected)
    require(selected_rows.size == budget, "optical-hysteresis selector failed to spend the fixed candidate budget")
    if receipt is not None:
        selected_ids = native_ids[selected_rows]
        retained_ids = np.intersect1d(selected_ids, previous_ids, assume_unique=True)
        entered_ids = np.setdiff1d(selected_ids, previous_ids, assume_unique=True)
        exited_ids = np.setdiff1d(previous_ids, selected_ids, assume_unique=True)
        receipt.update({
            "authority": HYSTERESIS_AUTHORITY,
            "initializedFromStatelessOptical": False,
            "entryThreshold": entry_threshold,
            "exitThreshold": exit_threshold,
            "previous": native_id_set_receipt(previous_ids),
            "selected": native_id_set_receipt(selected_ids),
            "retained": native_id_set_receipt(retained_ids),
            "entered": native_id_set_receipt(entered_ids),
            "exited": native_id_set_receipt(exited_ids),
        })
    return selected_rows


def fixed_budget_selections(
    native_ids: np.ndarray,
    coefficients: np.ndarray,
    budget_fraction: float,
    candidate_budget: int | None = None,
    previous_optical_ids: np.ndarray | None = None,
    hysteresis_ratio: float = 0.1,
    selection_receipts: dict[str, dict[str, Any]] | None = None,
) -> dict[str, np.ndarray]:
    require(0.0 < budget_fraction <= 1.0, "budget fraction must be in (0,1]")
    require(np.unique(native_ids).size == native_ids.size, "native-cell candidate IDs must be unique")
    budget = max(1, int(np.floor(native_ids.size * budget_fraction))) if candidate_budget is None else int(candidate_budget)
    require(0 < budget <= native_ids.size, "fixed candidate budget is outside the current state population")
    hysteresis_receipt: dict[str, Any] = {}
    selections = {
        "stable-uniform": select_stable_uniform(native_ids, budget),
        "optical-energy": select_optical_energy(native_ids, coefficients, budget),
        "optical-hysteresis": select_optical_hysteresis(
            native_ids,
            coefficients,
            budget,
            previous_optical_ids,
            hysteresis_ratio,
            hysteresis_receipt,
        ),
    }
    require({rows.size for rows in selections.values()} == {budget}, "selection arms spent different candidate budgets")
    if selection_receipts is not None:
        authorities = {
            "stable-uniform": UNIFORM_AUTHORITY,
            "optical-energy": SELECTION_AUTHORITY,
        }
        for policy in ("stable-uniform", "optical-energy"):
            selection_receipts[policy] = {
                "authority": authorities[policy],
                "selected": native_id_set_receipt(native_ids[selections[policy]]),
            }
        selection_receipts["optical-hysteresis"] = hysteresis_receipt
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


def validate_adjacent_state_motion(
    report_states: list[dict[str, Any]],
    temporal_by_policy: dict[str, list[dict[str, Any]]],
    policies: list[str],
    mode: str,
) -> None:
    expected_transitions = max(0, len(report_states) - 1) if mode == "sequence" else 0
    require(set(temporal_by_policy) == set(policies), "adjacent-state motion policy buckets drifted")

    def nonnegative_integer(value: Any, label: str) -> int:
        require(isinstance(value, int) and not isinstance(value, bool) and value >= 0, f"{label} must be a nonnegative integer")
        return value

    def finite_nonnegative(value: Any, label: str) -> float:
        require(isinstance(value, (int, float)) and not isinstance(value, bool), f"{label} must be numeric")
        numeric = float(value)
        require(math.isfinite(numeric) and numeric >= 0.0, f"{label} must be finite and nonnegative")
        return numeric

    for policy in policies:
        transitions = temporal_by_policy[policy]
        require(len(transitions) == expected_transitions, f"{policy} adjacent-state motion ledger is partial")
        for index, row in enumerate(transitions):
            previous_state = report_states[index]
            current_state = report_states[index + 1]
            previous_arm = (previous_state.get("arms") or {}).get(policy)
            current_arm = (current_state.get("arms") or {}).get(policy)
            require(isinstance(previous_arm, dict), f"{policy} previous state arm receipt is missing")
            require(isinstance(current_arm, dict), f"{policy} current state arm receipt is missing")
            previous_selected = nonnegative_integer(previous_arm.get("selectedRows"), f"{policy} previous selected rows")
            current_selected = nonnegative_integer(current_arm.get("selectedRows"), f"{policy} current selected rows")
            previous_budget = nonnegative_integer(previous_arm.get("candidateBudget"), f"{policy} previous candidate budget")
            current_budget = nonnegative_integer(current_arm.get("candidateBudget"), f"{policy} current candidate budget")
            require(previous_selected == previous_budget, f"{policy} previous state did not spend its candidate budget")
            require(current_selected == current_budget, f"{policy} current state did not spend its candidate budget")
            expected_step_delta = int(current_state["steps"]) - int(previous_state["steps"])
            require(row.get("fromStateId") == previous_state["stateId"], f"{policy} adjacent-state source identity is misrouted")
            require(row.get("toStateId") == current_state["stateId"], f"{policy} adjacent-state destination identity is misrouted")
            require(expected_step_delta > 0 and row.get("stepDelta") == expected_step_delta, f"{policy} adjacent-state step delta is invalid")

            turnover = row.get("nodeIdentityTurnover")
            require(isinstance(turnover, dict), f"{policy} node turnover evidence is missing")
            previous_count = nonnegative_integer(turnover.get("previousNodeCount"), f"{policy} previous node count")
            current_count = nonnegative_integer(turnover.get("currentNodeCount"), f"{policy} current node count")
            require(previous_count == previous_selected, f"{policy} previous node count disagrees with the state arm")
            require(current_count == current_selected, f"{policy} current node count disagrees with the state arm")
            shared_count = nonnegative_integer(turnover.get("sharedNodeCount"), f"{policy} shared node count")
            entered_count = nonnegative_integer(turnover.get("enteredNodeCount"), f"{policy} entered node count")
            exited_count = nonnegative_integer(turnover.get("exitedNodeCount"), f"{policy} exited node count")
            union_count = nonnegative_integer(turnover.get("unionNodeCount"), f"{policy} union node count")
            require(shared_count <= min(previous_count, current_count), f"{policy} shared node count exceeds a cohort")
            require(entered_count == current_count - shared_count, f"{policy} entered node accounting is inconsistent")
            require(exited_count == previous_count - shared_count, f"{policy} exited node accounting is inconsistent")
            require(union_count == previous_count + current_count - shared_count, f"{policy} union node accounting is inconsistent")
            jaccard = finite_nonnegative(turnover.get("jaccard"), f"{policy} node jaccard")
            turnover_fraction = finite_nonnegative(turnover.get("turnoverFraction"), f"{policy} turnover fraction")
            require(jaccard <= 1.0 and turnover_fraction <= 1.0, f"{policy} turnover fractions exceed one")
            expected_jaccard = shared_count / max(union_count, 1)
            require(abs(jaccard - expected_jaccard) <= 1e-9, f"{policy} node jaccard is inconsistent")
            require(abs(turnover_fraction - (1.0 - expected_jaccard)) <= 1e-9, f"{policy} turnover fraction is inconsistent")

            churn = row.get("multiplicityChurn")
            require(isinstance(churn, dict), f"{policy} multiplicity churn evidence is missing")
            require(churn.get("depositRule") == "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0", f"{policy} deposit rule drifted")
            maximum_deposits = nonnegative_integer(churn.get("maximumDepositsPerCandidate"), f"{policy} maximum deposits per candidate")
            require(maximum_deposits == DEPOSITS_PER_CANDIDATE, f"{policy} maximum deposit contract drifted")
            previous_deposits = nonnegative_integer(churn.get("previousDepositCount"), f"{policy} previous deposit count")
            current_deposits = nonnegative_integer(churn.get("currentDepositCount"), f"{policy} current deposit count")
            previous_arm_deposits = nonnegative_integer(
                previous_arm.get("actualInBoundsDepositCount"),
                f"{policy} previous state in-bounds deposit count",
            )
            current_arm_deposits = nonnegative_integer(
                current_arm.get("actualInBoundsDepositCount"),
                f"{policy} current state in-bounds deposit count",
            )
            require(previous_deposits == previous_arm_deposits, f"{policy} previous deposit count disagrees with the state arm")
            require(current_deposits == current_arm_deposits, f"{policy} current deposit count disagrees with the state arm")
            require(previous_deposits <= previous_count * maximum_deposits, f"{policy} previous deposits exceed the fixed workload")
            require(current_deposits <= current_count * maximum_deposits, f"{policy} current deposits exceed the fixed workload")
            require(churn.get("sharedNodeCount") == shared_count, f"{policy} churn shared-node count disagrees with turnover")
            changed_count = nonnegative_integer(churn.get("sharedNodesWithChangedMultiplicity"), f"{policy} changed multiplicity count")
            require(changed_count <= shared_count, f"{policy} changed multiplicity count exceeds shared nodes")
            require(churn.get("authority") == "actual-in-bounds-bilinear-deposit-count-v0", f"{policy} multiplicity authority drifted")
            if shared_count == 0:
                require(churn.get("meanAbsoluteSharedNodeDepositDelta") is None, f"{policy} empty churn mean must be null")
                require(churn.get("maxAbsoluteSharedNodeDepositDelta") is None, f"{policy} empty churn max must be null")
            else:
                mean_deposit_delta = finite_nonnegative(churn.get("meanAbsoluteSharedNodeDepositDelta"), f"{policy} mean deposit delta")
                max_deposit_delta = finite_nonnegative(churn.get("maxAbsoluteSharedNodeDepositDelta"), f"{policy} max deposit delta")
                require(mean_deposit_delta <= max_deposit_delta <= maximum_deposits, f"{policy} multiplicity delta range is inconsistent")

            velocity = row.get("placementVelocity")
            require(isinstance(velocity, dict), f"{policy} placement velocity evidence is missing")
            require(velocity.get("sharedNodeCount") == shared_count, f"{policy} velocity shared-node count disagrees with turnover")
            visible_taps = nonnegative_integer(velocity.get("sharedVisibleTapCount"), f"{policy} shared visible tap count")
            require(visible_taps <= shared_count * 5, f"{policy} shared visible taps exceed five taps per node")
            require(velocity.get("unit") == "screen-pixels-per-simulator-step", f"{policy} placement velocity unit drifted")
            if visible_taps == 0:
                require(all(velocity.get(field) is None for field in ("mean", "p50", "p95", "max")), f"{policy} empty placement statistics must be null")
            else:
                require(velocity.get("authority") == "matched-native-node-flow-tangent-tap-centers-v0", f"{policy} placement authority drifted")
                mean_velocity = finite_nonnegative(velocity.get("mean"), f"{policy} mean placement velocity")
                p50_velocity = finite_nonnegative(velocity.get("p50"), f"{policy} p50 placement velocity")
                p95_velocity = finite_nonnegative(velocity.get("p95"), f"{policy} p95 placement velocity")
                max_velocity = finite_nonnegative(velocity.get("max"), f"{policy} max placement velocity")
                require(p50_velocity <= p95_velocity <= max_velocity and mean_velocity <= max_velocity, f"{policy} placement velocity quantiles are inconsistent")

            image_diffs = row.get("adjacentFramePixelDiffs")
            require(isinstance(image_diffs, dict), f"{policy} adjacent-frame image evidence is missing")
            for field in ("targetMae", "renderMae"):
                value = finite_nonnegative(image_diffs.get(field), f"{policy} {field}")
                require(value <= 1.0, f"{policy} {field} exceeds normalized image range")
            for field in ("motionDeltaMae", "errorFieldDeltaMae"):
                value = finite_nonnegative(image_diffs.get(field), f"{policy} {field}")
                require(value <= 2.0, f"{policy} {field} exceeds normalized difference-field range")


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
    hysteresis_ratio: float,
    implementation_bundle_sha256: str,
    bound_implementation_bundle: dict[str, Any],
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
    policies = ["stable-uniform", "optical-energy", "optical-hysteresis"]
    temporal_by_policy: dict[str, list[dict[str, Any]]] = {policy: [] for policy in policies}
    previous_by_policy: dict[str, dict[str, Any]] = {}
    previous_hysteresis_ids: np.ndarray | None = None
    target_hashes: set[str] = set()
    render_hashes: dict[str, set[str]] = {policy: set() for policy in policies}

    for state in selected_states:
        state_id = str(state["id"])
        rows = MOTION.load_rows(state, manifest_path)
        ids = np.asarray(rows["nativeCellIndices"], dtype=np.uint32)
        coefficients = np.asarray(rows["coefficients"])
        selection_receipts: dict[str, dict[str, Any]] = {}
        selections = fixed_budget_selections(
            ids,
            coefficients,
            budget_fraction,
            candidate_budget=candidate_budget,
            previous_optical_ids=previous_hysteresis_ids,
            hysteresis_ratio=hysteresis_ratio,
            selection_receipts=selection_receipts,
        )
        previous_hysteresis_ids = ids[selections["optical-hysteresis"]].copy()
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
            receipt["selection"] = selection_receipts[policy]
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
    validate_adjacent_state_motion(report_states, temporal_by_policy, policies, mode)

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
    viewer_path.write_text(selection_viewer(viewer_rows, policies))
    require_unchanged_binding(manifest_path, manifest_sha256)
    require_unchanged_binding(motion_report_path, motion_report_sha256)
    implementation_bundle_at_completion = implementation_bundle_receipt()
    require(
        implementation_bundle_at_completion["sha256"] == implementation_bundle_sha256,
        "implementation bundle changed after binding",
    )
    return {
        "schema": REPORT_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": "fixed-candidate-budget-causal-selection-oracle-v0",
        "mode": mode,
        "source": {
            "implementationBundle": bound_implementation_bundle,
            "implementationBundleAtCompletion": implementation_bundle_at_completion,
            "manifestPath": str(manifest_path),
            "manifestSha256": manifest_sha256,
            "motionReportPath": str(motion_report_path),
            "motionReportSha256": motion_report_sha256,
        },
        "selection": {
            "authority": COMPARISON_AUTHORITY,
            "targetUsedForSelection": False,
            "budgetFractionRequested": budget_fraction,
            "candidateBudget": candidate_budget,
            "budgetAnchorStateId": str(budget_anchor_state["id"]),
            "budgetAnchorPopulation": budget_anchor_population,
            "maximumDepositsPerCandidate": DEPOSITS_PER_CANDIDATE,
            "workEquivalence": "equal-selected-candidates-and-equal-nominal-deposit-evaluations; actual-in-bounds-deposits-reported-as-outcome",
            "policies": policies,
            "hysteresis": {
                "authority": HYSTERESIS_AUTHORITY,
                "ratio": hysteresis_ratio,
                "entryThreshold": "current-state optical-energy kth score",
                "exitThreshold": "entry-threshold-times-one-minus-ratio",
                "identitySource": "previous selected native-cell ids",
            },
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
    global BOUND_IMPLEMENTATION_PAYLOADS
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--motion-report", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--implementation-bundle-sha256", required=True)
    parser.add_argument("--budget-fraction", type=float, default=0.25)
    parser.add_argument("--hysteresis-ratio", type=float, default=0.1)
    parser.add_argument("--mode", choices=("frozen", "sequence"), default="frozen")
    args = parser.parse_args()
    manifest_path = Path(args.manifest).expanduser().resolve()
    motion_report_path = Path(args.motion_report).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    implementation_bundle_sha256 = str(args.implementation_bundle_sha256).lower()
    failure_phase = "implementation-binding"
    last_trustworthy_evidence: dict[str, Any] = {
        "implementationPath": str(IMPLEMENTATION_PATH),
        "implementationBundleSha256Expected": implementation_bundle_sha256,
        "manifestPath": str(manifest_path),
        "motionReportPath": str(motion_report_path),
    }
    try:
        require(len(implementation_bundle_sha256) == 64 and all(character in "0123456789abcdef" for character in implementation_bundle_sha256), "implementation bundle SHA-256 must be 64 lowercase hexadecimal characters")
        implementation_bundle_at_start, implementation_payloads = capture_implementation_bundle()
        last_trustworthy_evidence["implementationBundleAtStart"] = implementation_bundle_at_start
        require(implementation_bundle_at_start["sha256"] == implementation_bundle_sha256, "launched implementation bundle does not match the externally bound SHA-256")
        BOUND_IMPLEMENTATION_PAYLOADS = implementation_payloads
        failure_phase = "runtime-initialization"
        initialize_runtime()
        failure_phase = "source-validation"
        require(manifest_path.is_file(), f"manifest is missing: {manifest_path}")
        require(motion_report_path.is_file(), f"motion report is missing: {motion_report_path}")
        failure_phase = "fixed-budget-render"
        report = run(
            manifest_path,
            motion_report_path,
            out_dir,
            args.budget_fraction,
            args.mode,
            args.hysteresis_ratio,
            implementation_bundle_sha256,
            implementation_bundle_at_start,
        )
        last_trustworthy_evidence.update(report["source"])
        report_path.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({"status": "complete", "reportPath": str(report_path), "selectionViewer": report["selectionViewer"]}, indent=2))
        return 0
    except Exception as error:
        try:
            last_trustworthy_evidence["implementationBundleAtFailure"] = implementation_bundle_receipt()
        except OSError as digest_error:
            last_trustworthy_evidence["implementationSha256AtFailureError"] = str(digest_error)
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
