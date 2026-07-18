#!/usr/bin/env python3
"""Export an accepted persistent sparse cohort without rerunning selection downstream."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Iterable

import numpy as np


ROOT = Path(__file__).resolve().parent
EXPORT_SCHEMA = "persistent-sparse-cohort-export-v0"
EXPORT_AUTHORITY = "accepted-report-replayed-native-membership-consumer-arrays-v0"
ACCEPTED_POLICY = "optical-hysteresis-adaptive-mean-contribution-footprint-charged-deposition"
COMPLETE_IMAGE_CONTROL_ROLE = "complete-image-selection-control"
OPTICAL_OWNERSHIP_AUTHORITY = "complementary-local-optical-coefficient-ownership-v0"
EXPECTED_ARRAY_DTYPES = {
    "sourceRowIndices": "<u4",
    "nativeCellIndices": "<u4",
    "coefficients": "<f4",
    "kernelDescriptors": "<f4",
    "features": "<f4",
    "admission": "<f4",
    "footprintScales": "<f4",
    "depositMultiplicity": "|u1",
    "retainedQuadratureWeight": "<f4",
}


def canonical_optical_ownership() -> dict[str, Any]:
    return {
        "authority": OPTICAL_OWNERSHIP_AUTHORITY,
        "splatEmission": "w_j * j",
        "residualEmission": "(1 - w_j) * j",
        "splatExtinction": "w_sigma * sigma",
        "residualExtinction": "(1 - w_sigma) * sigma",
        "duplicationForbidden": True,
        "imageResidualForbidden": True,
    }


def canonical_array_contract() -> dict[str, Any]:
    return {
        "rowAlignment": "all arrays share sourceRowIndices/nativeCellIndices order",
        "consumerSelection": "do-not-rerun-selection",
        "consumerDeposition": "fixed-five-flow-taps-with-exported-footprint-scales-and-top-three-bilinear-neighbors",
        "dtypes": EXPECTED_ARRAY_DTYPES,
    }


def load_module(filename: str, name: str):
    path = ROOT / filename
    specification = importlib.util.spec_from_file_location(name, path)
    if specification is None or specification.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


BUDGET = load_module("volume-layer-coefficient-budget-oracle.py", "kaminos_persistent_cohort_budget")
BUDGET.initialize_runtime()
MOTION = BUDGET.MOTION


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    os.replace(temporary, path)


def load_bound_json(path: Path, expected_sha256: str | None, label: str) -> tuple[dict[str, Any], str]:
    require(path.is_file(), f"{label} is missing: {path}")
    digest = sha256_file(path)
    if expected_sha256 is not None:
        require(digest == expected_sha256, f"{label} sha256 drifted")
    value = json.loads(path.read_text())
    require(isinstance(value, dict), f"{label} is not a JSON object")
    return value, digest


def adaptive_contract(report: dict[str, Any]) -> dict[str, Any]:
    adaptive = ((report.get("selection") or {}).get("adaptiveSurvival") or {})
    require(isinstance(adaptive, dict), "accepted report lacks adaptive-survival authority")
    return adaptive


def chronological_split(report: dict[str, Any]) -> dict[str, Any]:
    adaptive = adaptive_contract(report)
    model = adaptive.get("model") or {}
    split = model.get("chronologicalSplit") or adaptive.get("chronologicalSplit") or {}
    require(isinstance(split.get("heldStateStartIndex"), int), "accepted report lacks a held-state split")
    return split


def validate_accepted_report(report: dict[str, Any], manifest: dict[str, Any]) -> None:
    require(report.get("schema") == BUDGET.REPORT_SCHEMA, "accepted report schema drifted")
    require(report.get("status") == "complete", "accepted report is incomplete")
    require(report.get("mode") == "sequence", "accepted report is not a temporal sequence")
    require(
        report.get("authority") == "fixed-candidate-budget-causal-selection-oracle-v0",
        "accepted report authority drifted",
    )
    selection = report.get("selection") or {}
    require(selection.get("targetUsedForSelection") is False, "accepted selector used target pixels")
    candidate_budget = selection.get("candidateBudget")
    require(isinstance(candidate_budget, int) and candidate_budget > 0, "accepted candidate budget is invalid")
    adaptive = adaptive_contract(report)
    charged = adaptive.get("contributionChargedDeposition") or {}
    require(charged.get("policy") == ACCEPTED_POLICY, "accepted charged policy drifted")
    require(charged.get("membershipPolicy") == "optical-hysteresis-adaptive-mean", "accepted membership policy drifted")
    require(charged.get("bilinearNeighborLimit") == 3, "accepted charged neighbor limit drifted")
    require(charged.get("maximumDepositsPerCandidate") == 15, "accepted charged work ceiling drifted")
    require(charged.get("targetUsedForDeposition") is False, "accepted deposition used target pixels")

    manifest_states = manifest.get("states") or []
    held_start = chronological_split(report)["heldStateStartIndex"]
    require(0 <= held_start < len(manifest_states), "accepted held-state split exceeds the manifest")
    expected_ids = [str(state.get("id")) for state in manifest_states[held_start:]]
    report_states = report.get("states") or []
    actual_ids = [str(state.get("stateId")) for state in report_states]
    require(actual_ids == expected_ids, "accepted report is partial or reordered for held states")
    require(len(report_states) >= 2, "accepted report lacks an adjacent-state witness")

    previous_selected: dict[str, Any] | None = None
    for state in report_states:
        state_id = str(state.get("stateId"))
        arm = ((state.get("arms") or {}).get(ACCEPTED_POLICY) or {})
        require(arm.get("policy") == ACCEPTED_POLICY, f"{state_id} accepted arm policy drifted")
        require(arm.get("selectedRows") == candidate_budget, f"{state_id} candidate budget drifted")
        require(arm.get("candidateBudget") == candidate_budget, f"{state_id} selected budget drifted")
        require(
            arm.get("depositRule") == BUDGET.CONTRIBUTION_CHARGED_DEPOSITION_RULE,
            f"{state_id} deposition rule drifted",
        )
        require(arm.get("bilinearNeighborLimit") == 3, f"{state_id} charged neighbor limit drifted")
        require(arm.get("maximumDepositsPerCandidate") == 15, f"{state_id} charged work ceiling drifted")
        require(arm.get("nominalTapEvaluationBudget") == candidate_budget * 5, f"{state_id} logical tap budget drifted")
        require(arm.get("nominalDepositEvaluationBudget") == candidate_budget * 20, f"{state_id} nominal work drifted")
        require(
            arm.get("requestedChargedDepositEvaluationBudget") == candidate_budget * 15,
            f"{state_id} requested charged work drifted",
        )
        receipt = arm.get("selection") or {}
        require(receipt.get("selected", {}).get("count") == candidate_budget, f"{state_id} membership count drifted")
        require(receipt.get("authority") == "matched-mean-membership-plus-target-free-fixed-five-charged-deposition-v0", f"{state_id} membership authority drifted")
        require(receipt.get("membershipPolicy") == "optical-hysteresis-adaptive-mean", f"{state_id} membership lineage drifted")
        require(receipt.get("footprintPolicy") == BUDGET.CONTRIBUTION_FOOTPRINT_POLICY, f"{state_id} footprint lineage drifted")
        require(receipt.get("depositionPolicy") == BUDGET.CONTRIBUTION_CHARGED_DEPOSITION_RULE, f"{state_id} selection deposition rule drifted")
        require(receipt.get("bilinearNeighborLimit") == 3, f"{state_id} selection neighbor limit drifted")
        if previous_selected is not None:
            require(receipt.get("previous") == previous_selected, f"{state_id} previous membership receipt broke temporal continuity")
        previous_selected = receipt.get("selected")
        deposition = arm.get("contributionChargedDeposition") or {}
        require(deposition.get("targetUsed") is False, f"{state_id} deposition plan used target pixels")
        require(deposition.get("candidateRows") == candidate_budget, f"{state_id} deposition population drifted")
        require(deposition.get("tapCount") == 5, f"{state_id} deposition tap count drifted")
        require(deposition.get("bilinearNeighborLimit") == 3, f"{state_id} deposition neighbor limit drifted")
        require(deposition.get("maximumDepositsPerCandidate") == 15, f"{state_id} deposition work ceiling drifted")


def verify_reconstructed_membership(
    state_id: str,
    native_ids: np.ndarray,
    selection_receipt: dict[str, Any],
) -> None:
    actual = BUDGET.native_id_set_receipt(np.asarray(native_ids, dtype=np.uint32))
    expected = selection_receipt.get("selected") or {}
    require(actual == expected, f"{state_id} reconstructed membership receipt drifted")


def accepted_model(report: dict[str, Any]) -> dict[str, Any]:
    receipt = adaptive_contract(report).get("model") or {}
    parameters = receipt.get("modelParameters") or {}
    model = {
        "authority": receipt.get("authority"),
        "targetAuthority": receipt.get("targetAuthority"),
        "featureMean": np.asarray(parameters.get("featureMean"), dtype=np.float64),
        "featureScale": np.asarray(parameters.get("featureScale"), dtype=np.float64),
        "intercept": parameters.get("intercept"),
        "weights": np.asarray(parameters.get("weights"), dtype=np.float64),
    }
    require(receipt.get("modelSha256") is not None, "accepted causal model lacks an identity")
    require(model["featureMean"].size == BUDGET.CAUSAL_SURVIVAL_FEATURE_COUNT, "accepted model feature mean drifted")
    require(model["featureScale"].size == BUDGET.CAUSAL_SURVIVAL_FEATURE_COUNT, "accepted model feature scale drifted")
    require(model["weights"].size == BUDGET.CAUSAL_SURVIVAL_FEATURE_COUNT, "accepted model weight width drifted")
    return model


def reconstruct_memberships(
    report: dict[str, Any],
    manifest: dict[str, Any],
    manifest_path: Path,
) -> Iterable[tuple[dict[str, Any], dict[str, Any], np.ndarray, dict[str, Any]]]:
    states = manifest["states"]
    split = chronological_split(report)
    held_states = states[split["heldStateStartIndex"]:]
    report_states = report["states"]
    candidate_budget = int(report["selection"]["candidateBudget"])
    adaptive = adaptive_contract(report)
    minimum_ratio = float(adaptive["minimumRatio"])
    maximum_ratio = float(adaptive["maximumRatio"])
    model = accepted_model(report)
    previous_adaptive_ids: np.ndarray | None = None
    previous_adaptive_predictions: np.ndarray | None = None
    previous_mean_ids: np.ndarray | None = None

    for state, report_state in zip(held_states, report_states):
        state_id = str(state["id"])
        require(state_id == str(report_state["stateId"]), f"{state_id} report-state binding drifted")
        rows = MOTION.load_rows(state, manifest_path)
        native_ids = np.asarray(rows["nativeCellIndices"], dtype=np.uint32)
        coefficients = np.asarray(rows["coefficients"])
        adaptive_receipt: dict[str, Any] = {}
        adaptive_rows = BUDGET.select_optical_adaptive_hysteresis(
            native_ids,
            coefficients,
            candidate_budget,
            previous_adaptive_ids,
            previous_adaptive_predictions,
            minimum_ratio,
            maximum_ratio,
            receipt=adaptive_receipt,
        )
        matched_mean_ratio = adaptive_receipt["matchedMeanRatio"]
        mean_receipt: dict[str, Any] = {}
        if matched_mean_ratio is None:
            selected_rows = BUDGET.select_optical_energy(native_ids, coefficients, candidate_budget)
            selected_ids = native_ids[selected_rows]
            mean_receipt.update({
                "initializedFromStatelessOptical": True,
                **BUDGET.native_id_transition_receipt(
                    np.empty(0, dtype=np.uint32) if previous_mean_ids is None else previous_mean_ids,
                    selected_ids,
                ),
            })
        else:
            selected_rows = BUDGET.select_optical_hysteresis(
                native_ids,
                coefficients,
                candidate_budget,
                previous_mean_ids,
                float(matched_mean_ratio),
                receipt=mean_receipt,
            )
        accepted_arm = report_state["arms"][ACCEPTED_POLICY]
        verify_reconstructed_membership(state_id, native_ids[selected_rows], accepted_arm["selection"])
        for key in ("previous", "selected", "retained", "entered", "exited"):
            require(mean_receipt.get(key) == accepted_arm["selection"].get(key), f"{state_id} reconstructed {key} receipt drifted")
        require(mean_receipt.get("initializedFromStatelessOptical") == accepted_arm["selection"].get("initializedFromStatelessOptical"), f"{state_id} initialization receipt drifted")

        scores = BUDGET.optical_energy_scores(coefficients)
        order = BUDGET.optical_score_order(native_ids, scores)
        entry_threshold = float(scores[order[candidate_budget - 1]])
        adaptive_features = BUDGET.causal_survival_feature_matrix(
            rows["features"],
            coefficients,
            rows["kernelDescriptors"],
            adaptive_rows,
            scores,
            entry_threshold,
        )
        current_predictions = BUDGET.predict_causal_survival_ridge(model, adaptive_features)
        previous_adaptive_ids = native_ids[adaptive_rows].copy()
        previous_adaptive_predictions = current_predictions
        previous_mean_ids = native_ids[selected_rows].copy()
        yield state, rows, np.asarray(selected_rows, dtype=np.uint32), accepted_arm


def load_admission(state: dict[str, Any], manifest_path: Path) -> np.memmap:
    rows = state.get("rows") or {}
    count = rows.get("count")
    descriptor = rows.get("admission") or {}
    require(descriptor.get("dtype") == "float32-le", f"{state.get('id')} admission dtype drifted")
    require(descriptor.get("shape") == [count, 2], f"{state.get('id')} admission shape drifted")
    path = MOTION.resolve_artifact(descriptor, manifest_path, f"{state.get('id')} admission")
    return np.memmap(path, dtype="<f4", mode="r", shape=(count, 2))


def reconstruct_state_payload(
    state: dict[str, Any],
    rows: dict[str, Any],
    selected_rows: np.ndarray,
    arm: dict[str, Any],
    manifest_path: Path,
) -> tuple[dict[str, np.ndarray], dict[str, Any]]:
    state_id = str(state["id"])
    admission = load_admission(state, manifest_path)
    indices = np.asarray(selected_rows, dtype=np.uint32)
    native_ids = np.asarray(rows["nativeCellIndices"][indices], dtype=np.uint32)
    coefficients = np.asarray(rows["coefficients"][indices], dtype=np.float32)
    descriptors = np.asarray(rows["kernelDescriptors"][indices], dtype=np.float32)
    features = np.asarray(rows["features"][indices], dtype=np.float32)
    admission_rows = np.asarray(admission[indices], dtype=np.float32)
    camera = MOTION.camera_contract(state)
    footprint_scales, plan = BUDGET.contribution_footprint_plan(
        native_ids,
        descriptors,
        coefficients,
        camera,
        float((arm.get("contributionChargedDeposition") or {}).get("requestedMinimumFootprintScale")),
    )
    placements = MOTION.flow_tap_placements(
        {"kernelDescriptors": descriptors, "features": features},
        camera,
        tap_scales=footprint_scales,
    )
    weights = MOTION.flow_tap_weights(indices.size)
    accounting = MOTION.bilinear_deposit_accounting(
        placements,
        weights,
        camera["width"],
        camera["height"],
        bilinear_neighbor_limit=3,
    )
    validate_deposition_reconstruction(state_id, plan, accounting, arm)
    return {
        "sourceRowIndices": indices,
        "nativeCellIndices": native_ids,
        "coefficients": coefficients,
        "kernelDescriptors": descriptors,
        "features": features,
        "admission": admission_rows,
        "footprintScales": np.asarray(footprint_scales, dtype=np.float32),
        "depositMultiplicity": np.asarray(accounting["actualInBoundsPositiveWeightDeposits"], dtype=np.uint8),
        "retainedQuadratureWeight": np.asarray(accounting["retainedQuadratureWeightFraction"], dtype=np.float32),
    }, camera


def array_filename(name: str, dtype: np.dtype) -> str:
    suffix = "u8" if dtype == np.dtype("|u1") else "u32" if dtype == np.dtype("<u4") else "f32"
    return f"{name}.{suffix}"


def write_state_arrays(
    output_dir: Path,
    state_id: str,
    arrays: dict[str, np.ndarray],
) -> dict[str, Any]:
    require(set(arrays) == set(EXPECTED_ARRAY_DTYPES), f"{state_id} export array set drifted")
    row_counts = {np.asarray(value).shape[0] for value in arrays.values()}
    require(len(row_counts) == 1, f"{state_id} export arrays have unequal row populations")
    row_count = row_counts.pop()
    require(row_count > 0, f"{state_id} export cohort is empty")
    state_dir = output_dir / "states" / state_id
    state_dir.mkdir(parents=True, exist_ok=True)
    descriptors: dict[str, Any] = {}
    for name, expected_dtype in EXPECTED_ARRAY_DTYPES.items():
        value = np.ascontiguousarray(arrays[name], dtype=np.dtype(expected_dtype))
        path = state_dir / array_filename(name, value.dtype)
        value.tofile(path)
        descriptors[name] = {
            "path": str(path.relative_to(output_dir)),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "dtype": value.dtype.str,
            "shape": list(value.shape),
        }
    return {"stateId": state_id, "rowCount": int(row_count), "arrays": descriptors}


def validate_deposition_reconstruction(
    state_id: str,
    plan: dict[str, Any],
    accounting: dict[str, np.ndarray],
    arm: dict[str, Any],
) -> None:
    expected_plan = arm.get("contributionChargedDeposition") or {}
    for key in (
        "authority",
        "scoreAuthority",
        "quotaAuthority",
        "targetUsed",
        "candidateRows",
        "visibleRows",
        "quotaCount",
        "tapCount",
        "nominalTapEvaluations",
        "nominalDepositEvaluations",
        "requestedMinimumFootprintScale",
        "effectiveMinimumFootprintScale",
    ):
        require(plan.get(key) == expected_plan.get(key), f"{state_id} deposition plan {key} drifted")
    actual_in_bounds = int(np.sum(accounting["actualInBoundsPositiveWeightDeposits"], dtype=np.int64))
    requested = int(np.sum(accounting["requestedChargedDepositEvaluations"], dtype=np.int64))
    retained = np.asarray(accounting["retainedQuadratureWeightFraction"], dtype=np.float64)
    require(actual_in_bounds == arm.get("actualInBoundsPositiveWeightDepositCount"), f"{state_id} effective charged work drifted")
    require(requested == arm.get("requestedChargedDepositEvaluationBudget"), f"{state_id} requested charged work drifted")
    accepted_retained = arm.get("retainedQuadratureWeightFraction") or {}
    require(abs(float(np.sum(retained)) - float(accepted_retained.get("sum"))) <= 1e-4, f"{state_id} retained quadrature sum drifted")
    require(abs(float(np.mean(retained)) - float(accepted_retained.get("meanPerCandidate"))) <= 1e-7, f"{state_id} retained quadrature mean drifted")


def verify_implementation_bundle(bundle: dict[str, Any]) -> None:
    require(bundle.get("authority") == "sha256-length-delimited-three-file-python-runtime-bundle-v0", "accepted implementation bundle authority drifted")
    files = bundle.get("files") or {}
    require(set(files) == {
        "volume-layer-coefficient-budget-oracle.py",
        "volume-layer-coefficient-render-oracle.py",
        "volume-layer-coefficient-bilinear-motion-render.py",
    }, "accepted implementation bundle file set drifted")
    for name, descriptor in files.items():
        path = Path(descriptor.get("path") or "")
        require(path.is_file(), f"accepted implementation source is missing: {name}")
        require(path.stat().st_size == descriptor.get("bytes"), f"accepted implementation source byte length drifted: {name}")
        require(sha256_file(path) == descriptor.get("sha256"), f"accepted implementation source sha256 drifted: {name}")


def verify_executing_bundle(bundle: dict[str, Any], root: Path = ROOT) -> None:
    verify_implementation_bundle(bundle)
    for name, descriptor in (bundle.get("files") or {}).items():
        path = root / name
        require(path.is_file(), f"executing implementation source is missing: {name}")
        require(path.stat().st_size == descriptor.get("bytes"), f"executing implementation source byte length drifted: {name}")
        require(sha256_file(path) == descriptor.get("sha256"), f"executing implementation source sha256 drifted: {name}")


def expected_array_shape(name: str, row_count: int) -> list[int]:
    widths = {
        "coefficients": 8,
        "kernelDescriptors": 8,
        "features": 24,
        "admission": 2,
    }
    return [row_count, widths[name]] if name in widths else [row_count]


def validate_array_payload(
    path: Path,
    descriptor: dict[str, Any],
    expected: np.ndarray,
    state_id: str,
    name: str,
) -> None:
    expected_value = np.ascontiguousarray(expected, dtype=np.dtype(EXPECTED_ARRAY_DTYPES[name]))
    actual = np.fromfile(path, dtype=np.dtype(descriptor["dtype"])).reshape(descriptor["shape"])
    require(
        np.array_equal(actual, expected_value),
        f"existing {state_id} {name} semantic payload drifted from the accepted cohort",
    )


def validate_existing_export(
    output_dir: Path,
    source_report_sha256: str,
    report: dict[str, Any],
    *,
    manifest_sha256: str,
    motion_report_sha256: str,
    source_manifest: dict[str, Any] | None = None,
    source_manifest_path: Path | None = None,
) -> dict[str, Any]:
    manifest_path = output_dir / "cohort-manifest.json"
    manifest, _ = load_bound_json(manifest_path, None, "existing cohort manifest")
    require(manifest.get("schema") == EXPORT_SCHEMA and manifest.get("status") == "complete", "existing cohort export is not complete")
    require(manifest.get("authority") == EXPORT_AUTHORITY, "existing cohort export authority drifted")
    require(manifest.get("role") == COMPLETE_IMAGE_CONTROL_ROLE, "existing cohort export role drifted")
    require(manifest.get("policy") == ACCEPTED_POLICY, "existing cohort export policy drifted")
    require(manifest.get("retargetingStatus") == "forbidden-until-analytical-hybrid-frontier-is-positive", "existing cohort export retargeting gate drifted")
    source = manifest.get("source") or {}
    require(source.get("acceptedReportSha256") == source_report_sha256, "existing cohort export binds a different report")
    require(source.get("manifestSha256") == manifest_sha256, "existing cohort export binds a different exact-state manifest")
    require(source.get("motionReportSha256") == motion_report_sha256, "existing cohort export binds a different motion report")
    require(
        source.get("implementationBundle")
        == (report.get("source") or {}).get("implementationBundle"),
        "existing cohort export binds a different implementation bundle",
    )
    candidate_budget = int((report.get("selection") or {}).get("candidateBudget"))
    require((manifest.get("selection") or {}).get("candidateBudget") == candidate_budget, "existing cohort export candidate budget drifted")
    require(manifest.get("opticalOwnership") == canonical_optical_ownership(), "existing cohort optical ownership drifted")
    require(manifest.get("arrayContract") == canonical_array_contract(), "existing cohort consumer array contract drifted")
    expected_states = report.get("states") or []
    states = manifest.get("states") or []
    require(
        [state.get("stateId") for state in states]
        == [state.get("stateId") for state in expected_states],
        "existing cohort state sequence is partial or reordered",
    )
    output_root = output_dir.resolve()
    for state, report_state in zip(states, expected_states):
        state_id = str(state.get("stateId"))
        require(state.get("rowCount") == candidate_budget, f"existing {state_id} cohort cardinality drifted")
        accepted_arm = ((report_state.get("arms") or {}).get(ACCEPTED_POLICY) or {})
        require(state.get("selectionReceipt") == (accepted_arm.get("selection") or {}), f"existing {state_id} membership receipt drifted")
        deposition = state.get("depositionReceipt") or {}
        for key in (
            "depositRule",
            "bilinearNeighborLimit",
            "maximumDepositsPerCandidate",
            "nominalTapEvaluationBudget",
            "nominalDepositEvaluationBudget",
            "requestedChargedDepositEvaluationBudget",
            "actualInBoundsPositiveWeightDepositCount",
            "retainedQuadratureWeightFraction",
        ):
            require(deposition.get(key) == accepted_arm.get(key), f"existing {state_id} deposition receipt {key} drifted")
        require(deposition.get("contributionPlan") == accepted_arm.get("contributionChargedDeposition"), f"existing {state_id} contribution plan drifted")
        arrays = state.get("arrays") or {}
        require(set(arrays) == set(EXPECTED_ARRAY_DTYPES), f"existing {state_id} array set is partial")
        for name, expected_dtype in EXPECTED_ARRAY_DTYPES.items():
            descriptor = arrays[name]
            shape = expected_array_shape(name, candidate_budget)
            require(descriptor.get("dtype") == expected_dtype, f"existing {state_id} {name} dtype drifted")
            require(descriptor.get("shape") == shape, f"existing {state_id} {name} shape drifted")
            expected_bytes = int(np.prod(shape, dtype=np.int64)) * np.dtype(expected_dtype).itemsize
            require(descriptor.get("bytes") == expected_bytes, f"existing {state_id} {name} byte contract drifted")
            raw_path = descriptor.get("path")
            require(isinstance(raw_path, str) and raw_path, f"existing {state_id} {name} path is missing")
            relative_path = Path(raw_path)
            require(not relative_path.is_absolute(), f"existing {state_id} {name} path escaped the cohort")
            path = (output_dir / relative_path).resolve()
            require(path.is_relative_to(output_root), f"existing {state_id} {name} path escaped the cohort")
            require(path.is_file(), f"existing cohort array is missing: {path}")
            require(path.stat().st_size == descriptor["bytes"], f"existing cohort array byte length drifted: {path}")
            require(sha256_file(path) == descriptor["sha256"], f"existing cohort array sha256 drifted: {path}")

    require(source_manifest is not None and source_manifest_path is not None, "existing cohort semantic replay source is missing")
    reconstructed = reconstruct_memberships(report, source_manifest, source_manifest_path)
    for state, report_state, replay in zip(states, expected_states, reconstructed):
        source_state, rows, selected_rows, arm = replay
        state_id = str(state["stateId"])
        require(state_id == str(source_state["id"]), f"existing {state_id} semantic source-state binding drifted")
        require(state.get("steps") == int((source_state.get("replay") or {}).get("completedSteps")), f"existing {state_id} replay-step identity drifted")
        require(state.get("sourceRows") == source_state.get("rows"), f"existing {state_id} source-row identity drifted")
        expected_arrays, expected_camera = reconstruct_state_payload(
            source_state,
            rows,
            selected_rows,
            arm,
            source_manifest_path,
        )
        require(state.get("camera") == expected_camera, f"existing {state_id} camera contract drifted")
        for name, expected in expected_arrays.items():
            descriptor = state["arrays"][name]
            path = (output_dir / descriptor["path"]).resolve()
            validate_array_payload(path, descriptor, expected, state_id, name)
    return manifest


def write_failure_report(
    path: Path,
    *,
    source_report: Path,
    output_dir: Path,
    failure_phase: str,
    error: Exception,
    last_trustworthy_evidence: dict[str, Any] | None = None,
) -> None:
    write_json(path, {
        "schema": EXPORT_SCHEMA,
        "status": "failed",
        "failurePhase": failure_phase,
        "error": f"{type(error).__name__}: {error}",
        "sourceReport": str(source_report),
        "requestedOutputDirectory": str(output_dir),
        "lastTrustworthyEvidence": last_trustworthy_evidence,
    })


def export_persistent_cohort(
    report_path: Path,
    output_dir: Path,
    expected_report_sha256: str,
) -> dict[str, Any]:
    report_path = report_path.resolve()
    output_dir = output_dir.resolve()
    failure_path = output_dir.parent / f"{output_dir.name}-failed-report.json"
    failure_phase = "source-report-binding"
    last_trustworthy: dict[str, Any] = {}
    staging: Path | None = None
    try:
        require(
            isinstance(expected_report_sha256, str)
            and len(expected_report_sha256) == 64
            and all(character in "0123456789abcdef" for character in expected_report_sha256),
            "source-signed accepted-report sha256 is invalid",
        )
        report, report_sha256 = load_bound_json(
            report_path,
            expected_report_sha256,
            "accepted charged-deposition report",
        )
        last_trustworthy["acceptedReportSha256"] = report_sha256

        source = report.get("source") or {}
        manifest_path = Path(source.get("manifestPath") or "").resolve()
        motion_report_path = Path(source.get("motionReportPath") or "").resolve()
        failure_phase = "source-artifact-binding"
        manifest, manifest_sha256 = load_bound_json(manifest_path, source.get("manifestSha256"), "exact-state manifest")
        _, motion_report_sha256 = load_bound_json(motion_report_path, source.get("motionReportSha256"), "motion report")
        verify_executing_bundle(source.get("implementationBundle") or {})
        last_trustworthy.update({
            "manifestSha256": manifest_sha256,
            "motionReportSha256": motion_report_sha256,
            "implementationBundleSha256": (source.get("implementationBundle") or {}).get("sha256"),
        })
        failure_phase = "accepted-contract-validation"
        validate_accepted_report(report, manifest)
        if output_dir.exists():
            return validate_existing_export(
                output_dir,
                report_sha256,
                report,
                manifest_sha256=manifest_sha256,
                motion_report_sha256=motion_report_sha256,
                source_manifest=manifest,
                source_manifest_path=manifest_path,
            )

        output_dir.parent.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(prefix=f".{output_dir.name}-", dir=output_dir.parent))
        exported_states: list[dict[str, Any]] = []
        failure_phase = "membership-reconstruction"
        for state, rows, selected_rows, arm in reconstruct_memberships(report, manifest, manifest_path):
            state_id = str(state["id"])
            arrays, camera = reconstruct_state_payload(
                state,
                rows,
                selected_rows,
                arm,
                manifest_path,
            )
            failure_phase = f"state-array-export:{state_id}"
            descriptor = write_state_arrays(staging, state_id, arrays)
            descriptor.update({
                "steps": int((state.get("replay") or {}).get("completedSteps")),
                "selectionReceipt": arm["selection"],
                "depositionReceipt": {
                    "depositRule": arm["depositRule"],
                    "bilinearNeighborLimit": arm["bilinearNeighborLimit"],
                    "maximumDepositsPerCandidate": arm["maximumDepositsPerCandidate"],
                    "nominalTapEvaluationBudget": arm["nominalTapEvaluationBudget"],
                    "nominalDepositEvaluationBudget": arm["nominalDepositEvaluationBudget"],
                    "requestedChargedDepositEvaluationBudget": arm["requestedChargedDepositEvaluationBudget"],
                    "actualInBoundsPositiveWeightDepositCount": arm["actualInBoundsPositiveWeightDepositCount"],
                    "retainedQuadratureWeightFraction": arm["retainedQuadratureWeightFraction"],
                    "contributionPlan": arm["contributionChargedDeposition"],
                },
                "sourceRows": state["rows"],
                "camera": camera,
            })
            exported_states.append(descriptor)
            last_trustworthy["lastExportedStateId"] = state_id

        failure_phase = "manifest-publication"
        cohort_manifest = {
            "schema": EXPORT_SCHEMA,
            "status": "complete",
            "failurePhase": None,
            "authority": EXPORT_AUTHORITY,
            "role": COMPLETE_IMAGE_CONTROL_ROLE,
            "policy": ACCEPTED_POLICY,
            "retargetingStatus": "forbidden-until-analytical-hybrid-frontier-is-positive",
            "source": {
                "acceptedReportPath": str(report_path),
                "acceptedReportSha256": report_sha256,
                "manifestPath": str(manifest_path),
                "manifestSha256": manifest_sha256,
                "motionReportPath": str(motion_report_path),
                "motionReportSha256": motion_report_sha256,
                "implementationBundle": source["implementationBundle"],
            },
            "selection": {
                "targetPixelsUsed": False,
                "candidateBudget": report["selection"]["candidateBudget"],
                "membershipPolicy": "optical-hysteresis-adaptive-mean",
                "stableIdentity": "native-cell-index",
                "temporalReceipts": "previous-selected-retained-entered-exited-native-id-sets",
            },
            "opticalOwnership": canonical_optical_ownership(),
            "arrayContract": canonical_array_contract(),
            "states": exported_states,
        }
        write_json(staging / "cohort-manifest.json", cohort_manifest)
        os.replace(staging, output_dir)
        staging = None
        if failure_path.exists():
            failure_path.unlink()
        return cohort_manifest
    except Exception as error:
        if staging is not None and staging.exists():
            shutil.rmtree(staging)
        write_failure_report(
            failure_path,
            source_report=report_path,
            output_dir=output_dir,
            failure_phase=failure_phase,
            error=error,
            last_trustworthy_evidence=last_trustworthy or None,
        )
        raise


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True, help="Accepted charged-deposition report.json")
    parser.add_argument(
        "--expected-report-sha256",
        required=True,
        help="Source-signed SHA-256 of the exact accepted report",
    )
    parser.add_argument("--out", type=Path, required=True, help="Immutable cohort output directory")
    arguments = parser.parse_args()
    manifest = export_persistent_cohort(
        arguments.report,
        arguments.out,
        arguments.expected_report_sha256,
    )
    print(json.dumps({
        "status": manifest["status"],
        "schema": manifest["schema"],
        "output": str(arguments.out.resolve()),
        "states": len(manifest["states"]),
        "candidateBudget": manifest["selection"]["candidateBudget"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
