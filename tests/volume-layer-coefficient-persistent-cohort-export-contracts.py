#!/usr/bin/env python3
"""Fail-first contracts for immutable persistent sparse-cohort export."""

from __future__ import annotations

import copy
import importlib.util
import inspect
import json
import tempfile
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "volume-layer-coefficient-persistent-cohort-export.py"
SPEC = importlib.util.spec_from_file_location("kaminos_persistent_cohort_export", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


require(
    MODULE.EXPORT_SCHEMA == "persistent-sparse-cohort-export-v0",
    "persistent cohort export schema drifted",
)
require(
    MODULE.ACCEPTED_POLICY
    == "optical-hysteresis-adaptive-mean-contribution-footprint-charged-deposition",
    "exporter targets the wrong accepted selector arm",
)
require(
    "expected_report_sha256" in inspect.signature(MODULE.export_persistent_cohort).parameters,
    "exporter does not require a source-signed accepted-report identity",
)


def set_receipt(ids: np.ndarray) -> dict[str, object]:
    return MODULE.BUDGET.native_id_set_receipt(np.asarray(ids, dtype=np.uint32))


state_ids = ["coefficient-state-114", "coefficient-state-116"]
selected_ids = {
    state_ids[0]: np.asarray([3, 7, 11], dtype=np.uint32),
    state_ids[1]: np.asarray([3, 11, 19], dtype=np.uint32),
}
manifest = {
    "schema": "fixture-manifest-v0",
    "status": "complete",
    "states": [
        {"id": "coefficient-state-112"},
        {"id": state_ids[0]},
        {"id": state_ids[1]},
    ],
}
states = []
previous = np.empty(0, dtype=np.uint32)
for state_id in state_ids:
    current = selected_ids[state_id]
    transition = MODULE.BUDGET.native_id_transition_receipt(previous, current)
    states.append({
        "stateId": state_id,
        "populationRows": 8,
        "arms": {
            MODULE.ACCEPTED_POLICY: {
                "policy": MODULE.ACCEPTED_POLICY,
                "selectedRows": 3,
                "candidateBudget": 3,
                "depositRule": MODULE.BUDGET.CONTRIBUTION_CHARGED_DEPOSITION_RULE,
                "bilinearNeighborLimit": 3,
                "maximumDepositsPerCandidate": 15,
                "nominalTapEvaluationBudget": 15,
                "nominalDepositEvaluationBudget": 60,
                "requestedChargedDepositEvaluationBudget": 45,
                "selection": {
                    **transition,
                    "authority": "matched-mean-membership-plus-target-free-fixed-five-charged-deposition-v0",
                    "membershipPolicy": "optical-hysteresis-adaptive-mean",
                    "footprintPolicy": MODULE.BUDGET.CONTRIBUTION_FOOTPRINT_POLICY,
                    "depositionPolicy": MODULE.BUDGET.CONTRIBUTION_CHARGED_DEPOSITION_RULE,
                    "bilinearNeighborLimit": 3,
                },
                "contributionChargedDeposition": {
                    "authority": "fixed-five-target-free-contribution-ranked-footprint-v0",
                    "targetUsed": False,
                    "candidateRows": 3,
                    "tapCount": 5,
                    "nominalTapEvaluations": 15,
                    "nominalDepositEvaluations": 60,
                    "requestedMinimumFootprintScale": 0.6875,
                    "effectiveMinimumFootprintScale": 0.6875,
                    "bilinearNeighborLimit": 3,
                    "logicalTapCount": 5,
                    "maximumDepositsPerCandidate": 15,
                },
            }
        },
    })
    previous = current

report = {
    "schema": MODULE.BUDGET.REPORT_SCHEMA,
    "status": "complete",
    "mode": "sequence",
    "authority": "fixed-candidate-budget-causal-selection-oracle-v0",
    "source": {
        "manifestSha256": "a" * 64,
        "motionReportSha256": "b" * 64,
        "implementationBundle": {"sha256": "c" * 64},
    },
    "selection": {
        "targetUsedForSelection": False,
        "candidateBudget": 3,
        "adaptiveSurvival": {
            "chronologicalSplit": {"heldStateStartIndex": 1},
            "contributionChargedDeposition": {
                "policy": MODULE.ACCEPTED_POLICY,
                "membershipPolicy": "optical-hysteresis-adaptive-mean",
                "bilinearNeighborLimit": 3,
                "maximumDepositsPerCandidate": 15,
                "targetUsedForDeposition": False,
            },
        },
    },
    "states": states,
}

MODULE.validate_accepted_report(report, manifest)

with tempfile.TemporaryDirectory() as temporary_directory:
    report_path = Path(temporary_directory) / "report.json"
    report_path.write_text(json.dumps(report))
    report_digest = MODULE.sha256_file(report_path)
    loaded, loaded_digest = MODULE.load_bound_json(
        report_path,
        report_digest,
        "accepted report fixture",
    )
    require(loaded == report and loaded_digest == report_digest, "accepted report binding changed payload")
    try:
        MODULE.load_bound_json(report_path, "0" * 64, "accepted report fixture")
    except ValueError as error:
        require("sha256 drifted" in str(error), "wrong accepted report failed for the wrong reason")
    else:
        raise AssertionError("wrong-but-valid accepted report bypassed source-signed identity")

partial = copy.deepcopy(report)
partial["states"] = partial["states"][:-1]
try:
    MODULE.validate_accepted_report(partial, manifest)
except ValueError as error:
    require("partial" in str(error), "partial export source failed for the wrong reason")
else:
    raise AssertionError("partial accepted-state sequence passed export validation")

wrong_rule = copy.deepcopy(report)
wrong_rule["states"][0]["arms"][MODULE.ACCEPTED_POLICY]["depositRule"] = "five-flow-taps-times-four-bilinear-neighbors-clipped-to-frame-v0"
try:
    MODULE.validate_accepted_report(wrong_rule, manifest)
except ValueError as error:
    require("deposition rule" in str(error), "wrong deposition rule failed for the wrong reason")
else:
    raise AssertionError("wrong deposition rule passed export validation")

MODULE.verify_reconstructed_membership(
    state_ids[0],
    selected_ids[state_ids[0]],
    report["states"][0]["arms"][MODULE.ACCEPTED_POLICY]["selection"],
)
wrong_membership = selected_ids[state_ids[0]].copy()
wrong_membership[-1] = 13
try:
    MODULE.verify_reconstructed_membership(
        state_ids[0],
        wrong_membership,
        report["states"][0]["arms"][MODULE.ACCEPTED_POLICY]["selection"],
    )
except ValueError as error:
    require("membership receipt" in str(error), "wrong membership failed for the wrong reason")
else:
    raise AssertionError("wrong reconstructed native-ID set passed export validation")

with tempfile.TemporaryDirectory() as temporary_directory:
    output = Path(temporary_directory)
    arrays = {
        "sourceRowIndices": np.asarray([1, 4, 7], dtype=np.uint32),
        "nativeCellIndices": selected_ids[state_ids[0]],
        "coefficients": np.arange(24, dtype=np.float32).reshape(3, 8),
        "kernelDescriptors": np.arange(24, dtype=np.float32).reshape(3, 8),
        "features": np.arange(72, dtype=np.float32).reshape(3, 24),
        "admission": np.arange(6, dtype=np.float32).reshape(3, 2),
        "footprintScales": np.asarray([0.6875, 0.8, 1.0], dtype=np.float32),
        "depositMultiplicity": np.asarray([15, 12, 9], dtype=np.uint8),
        "retainedQuadratureWeight": np.asarray([1.0, 0.95, 0.8], dtype=np.float32),
    }
    descriptor = MODULE.write_state_arrays(output, state_ids[0], arrays)
    require(descriptor["rowCount"] == 3, "state export changed cohort cardinality")
    require(set(descriptor["arrays"]) == set(arrays), "state export dropped a consumer array")
    for name, source in arrays.items():
        array_descriptor = descriptor["arrays"][name]
        path = output / array_descriptor["path"]
        require(path.is_file(), f"state export omitted {name}")
        require(MODULE.sha256_file(path) == array_descriptor["sha256"], f"state export did not bind {name}")
        loaded = np.fromfile(path, dtype=np.dtype(array_descriptor["dtype"])).reshape(array_descriptor["shape"])
        require(np.array_equal(loaded, source), f"state export changed {name} values")

    failure_report = output / "failed-export.json"
    MODULE.write_failure_report(
        failure_report,
        source_report=Path("accepted-report.json"),
        output_dir=output / "cohort",
        failure_phase="membership-reconstruction",
        error=ValueError("synthetic membership mismatch"),
    )
    failure = json.loads(failure_report.read_text())
    require(failure["status"] == "failed", "pre-artifact failure pretended to succeed")
    require(failure["failurePhase"] == "membership-reconstruction", "failure report hid the failing phase")
    require("synthetic membership mismatch" in failure["error"], "failure report hid the causal error")

with tempfile.TemporaryDirectory() as temporary_directory:
    temporary_root = Path(temporary_directory)
    accepted_root = temporary_root / "accepted"
    bundle_root = temporary_root / "executing"
    accepted_root.mkdir()
    bundle_root.mkdir()
    bundle_files = {}
    for name in (
        "volume-layer-coefficient-budget-oracle.py",
        "volume-layer-coefficient-render-oracle.py",
        "volume-layer-coefficient-bilinear-motion-render.py",
    ):
        path = accepted_root / name
        source = f"fixture:{name}\n"
        path.write_text(source)
        (bundle_root / name).write_text(source)
        bundle_files[name] = {
            "path": str(path),
            "bytes": path.stat().st_size,
            "sha256": MODULE.sha256_file(path),
        }
    bundle = {
        "authority": "sha256-length-delimited-three-file-python-runtime-bundle-v0",
        "files": bundle_files,
    }
    MODULE.verify_executing_bundle(bundle, bundle_root)
    (bundle_root / "volume-layer-coefficient-budget-oracle.py").write_text("drifted\n")
    try:
        MODULE.verify_executing_bundle(bundle, bundle_root)
    except ValueError as error:
        require("executing implementation" in str(error), "executing-code drift failed for the wrong reason")
    else:
        raise AssertionError("export replay accepted code different from the bound implementation")

with tempfile.TemporaryDirectory() as temporary_directory:
    output = Path(temporary_directory) / "cohort"
    output.mkdir()
    partial_manifest = {
        "schema": MODULE.EXPORT_SCHEMA,
        "status": "complete",
        "authority": MODULE.EXPORT_AUTHORITY,
        "role": MODULE.COMPLETE_IMAGE_CONTROL_ROLE,
        "policy": MODULE.ACCEPTED_POLICY,
        "retargetingStatus": "forbidden-until-analytical-hybrid-frontier-is-positive",
        "source": {
            "acceptedReportSha256": "d" * 64,
            "manifestSha256": "a" * 64,
            "motionReportSha256": "b" * 64,
            "implementationBundle": {"sha256": "c" * 64},
        },
        "selection": {"candidateBudget": 3},
        "opticalOwnership": MODULE.canonical_optical_ownership(),
        "arrayContract": MODULE.canonical_array_contract(),
        "states": [],
    }
    (output / "cohort-manifest.json").write_text(json.dumps(partial_manifest))
    try:
        MODULE.validate_existing_export(
            output,
            "d" * 64,
            report,
            manifest_sha256="a" * 64,
            motion_report_sha256="b" * 64,
        )
    except ValueError as error:
        require("state sequence" in str(error), "partial existing export failed for the wrong reason")
    else:
        raise AssertionError("partial existing export pretended to be a complete cohort")

with tempfile.TemporaryDirectory() as temporary_directory:
    output = Path(temporary_directory) / "cohort"
    output.mkdir()
    exported_states = []
    for state_id in state_ids:
        state_arrays = {
            "sourceRowIndices": np.asarray([0, 2, 5], dtype=np.uint32),
            "nativeCellIndices": selected_ids[state_id],
            "coefficients": np.zeros((3, 8), dtype=np.float32),
            "kernelDescriptors": np.zeros((3, 8), dtype=np.float32),
            "features": np.zeros((3, 24), dtype=np.float32),
            "admission": np.zeros((3, 2), dtype=np.float32),
            "footprintScales": np.ones(3, dtype=np.float32),
            "depositMultiplicity": np.full(3, 15, dtype=np.uint8),
            "retainedQuadratureWeight": np.ones(3, dtype=np.float32),
        }
        descriptor = MODULE.write_state_arrays(output, state_id, state_arrays)
        accepted_arm = next(state for state in states if state["stateId"] == state_id)["arms"][MODULE.ACCEPTED_POLICY]
        descriptor.update({
            "selectionReceipt": accepted_arm["selection"],
            "depositionReceipt": {
                "depositRule": accepted_arm["depositRule"],
                "bilinearNeighborLimit": accepted_arm["bilinearNeighborLimit"],
                "maximumDepositsPerCandidate": accepted_arm["maximumDepositsPerCandidate"],
                "nominalTapEvaluationBudget": accepted_arm["nominalTapEvaluationBudget"],
                "nominalDepositEvaluationBudget": accepted_arm["nominalDepositEvaluationBudget"],
                "requestedChargedDepositEvaluationBudget": accepted_arm["requestedChargedDepositEvaluationBudget"],
                "actualInBoundsPositiveWeightDepositCount": accepted_arm.get("actualInBoundsPositiveWeightDepositCount"),
                "retainedQuadratureWeightFraction": accepted_arm.get("retainedQuadratureWeightFraction"),
                "contributionPlan": accepted_arm["contributionChargedDeposition"],
            },
        })
        exported_states.append(descriptor)
    complete_manifest = {
        "schema": MODULE.EXPORT_SCHEMA,
        "status": "complete",
        "authority": MODULE.EXPORT_AUTHORITY,
        "role": MODULE.COMPLETE_IMAGE_CONTROL_ROLE,
        "policy": MODULE.ACCEPTED_POLICY,
        "retargetingStatus": "forbidden-until-analytical-hybrid-frontier-is-positive",
        "source": {
            "acceptedReportSha256": "d" * 64,
            "manifestSha256": "a" * 64,
            "motionReportSha256": "b" * 64,
            "implementationBundle": {"sha256": "c" * 64},
        },
        "selection": {"candidateBudget": 3},
        "opticalOwnership": MODULE.canonical_optical_ownership(),
        "arrayContract": MODULE.canonical_array_contract(),
        "states": exported_states,
    }
    manifest_path = output / "cohort-manifest.json"
    manifest_path.write_text(json.dumps(complete_manifest))
    wrong_ownership_manifest = copy.deepcopy(complete_manifest)
    wrong_ownership_manifest["opticalOwnership"]["splatEmission"] = "j"
    manifest_path.write_text(json.dumps(wrong_ownership_manifest))
    try:
        MODULE.validate_existing_export(
            output,
            "d" * 64,
            report,
            manifest_sha256="a" * 64,
            motion_report_sha256="b" * 64,
        )
    except ValueError as error:
        require("optical ownership" in str(error), "ownership-metadata falsifier failed for the wrong reason")
    else:
        raise AssertionError("existing export accepted changed optical ownership formulas")
    escaped_manifest = copy.deepcopy(complete_manifest)
    escaped_manifest["states"][0]["arrays"]["coefficients"]["path"] = "../escaped.bin"
    manifest_path.write_text(json.dumps(escaped_manifest))
    try:
        MODULE.validate_existing_export(
            output,
            "d" * 64,
            report,
            manifest_sha256="a" * 64,
            motion_report_sha256="b" * 64,
        )
    except ValueError as error:
        require("escaped the cohort" in str(error), "path-escape falsifier failed for the wrong reason")
    else:
        raise AssertionError("existing export accepted an array outside the cohort")
    partial_array_manifest = copy.deepcopy(complete_manifest)
    partial_array_manifest["states"][0]["arrays"].pop("features")
    manifest_path.write_text(json.dumps(partial_array_manifest))
    try:
        MODULE.validate_existing_export(
            output,
            "d" * 64,
            report,
            manifest_sha256="a" * 64,
            motion_report_sha256="b" * 64,
        )
    except ValueError as error:
        require("array set is partial" in str(error), "partial-array falsifier failed for the wrong reason")
    else:
        raise AssertionError("existing export accepted a missing consumer array")

    forged_path = output / complete_manifest["states"][0]["arrays"]["coefficients"]["path"]
    forged = np.fromfile(forged_path, dtype="<f4").reshape(3, 8)
    expected = forged.copy()
    forged[0, 0] = 1.0
    forged.tofile(forged_path)
    forged_descriptor = copy.deepcopy(complete_manifest["states"][0]["arrays"]["coefficients"])
    forged_descriptor["sha256"] = MODULE.sha256_file(forged_path)
    try:
        MODULE.validate_array_payload(
            forged_path,
            forged_descriptor,
            expected,
            state_ids[0],
            "coefficients",
        )
    except ValueError as error:
        require("semantic payload drifted" in str(error), "forged-array falsifier failed for the wrong reason")
    else:
        raise AssertionError("self-consistent forged array passed semantic validation")

with tempfile.TemporaryDirectory() as temporary_directory:
    temporary_root = Path(temporary_directory)
    output = temporary_root / "cohort"
    try:
        MODULE.export_persistent_cohort(
            temporary_root / "accepted-report.json",
            output,
            "malformed-source-signature",
        )
    except ValueError:
        failure_path = temporary_root / "cohort-failed-report.json"
        require(failure_path.is_file(), "pre-source-binding failure omitted its durable report")
        failure = json.loads(failure_path.read_text())
        require(failure["failurePhase"] == "source-report-binding", "source-signature failure reported the wrong phase")
        require(failure["lastTrustworthyEvidence"] is None, "invalid source signature claimed trustworthy evidence")
    else:
        raise AssertionError("malformed source signature was accepted")

print("persistent sparse-cohort export contracts passed")
