#!/usr/bin/env python3
import argparse
import importlib.util
import json
import sys
import time
from pathlib import Path

import mlx.core as mx
import numpy as np


ROOT = Path(__file__).resolve().parent


def load_local_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_local_module("boundary_splat_phase_transport_mlx", ROOT / "boundary-splat-phase-transport-mlx.py")
TRAINER = load_local_module("boundary_splat_phase_state_residual_mlx", ROOT / "boundary-splat-phase-state-residual-mlx.py")

SCHEMA = "kaminos-boundary-splat-phase-destination-state-evaluation-v0"
REFERENCE_AUTHORITY = "exact-heldout-valid-local-donor-support-v0"
CONTROL_AUTHORITY = "oracle-support-carried-donor-control-v0"
PREDICTION_AUTHORITY = "frozen-destination-state-one-step-on-oracle-support-v0"
COHORT_ORDER = ("stable-q1", "stable-q2", "stable-q3", "stable-q4", "transported", "birth")


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--evaluation-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--batch-size", type=int, default=4096)
    return parser.parse_args(argv)


def validate_route(device, fallback_reason=None):
    if fallback_reason not in (None, ""):
        raise RuntimeError(f"destination-state evaluator forbids fallback routing: {fallback_reason}")
    if not str(device).lower().startswith("device(gpu"):
        raise RuntimeError(f"destination-state evaluator requires MLX GPU, effective device was {device}")
    return {
        "backend": "mlx",
        "device": str(device),
        "effectiveRunner": sys.executable,
        "fallbackReason": None,
    }


def file_identity(path, schema=None):
    path = Path(path).resolve()
    data = path.read_bytes()
    document = json.loads(data)
    if schema is not None and document.get("schema") != schema:
        raise ValueError(f"{path.name} schema mismatch")
    return document, {
        "path": str(path),
        "bytes": len(data),
        "sha256": CORE.sha256_bytes(data),
        **({"schema": schema} if schema is not None else {}),
    }


def build_failure_report(started_at, failure_phase, error, last_trustworthy):
    return {
        "schema": SCHEMA,
        "status": "failed",
        "startedAt": started_at,
        "failedAt": time.time(),
        "failurePhase": failure_phase,
        "error": f"{type(error).__name__}: {error}",
        "lastTrustworthyEvidence": last_trustworthy,
    }


def write_role_frame_artifacts(out_dir, label, frame, authority):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    candidate_path = out_dir / f"{label}.features.f32"
    splat_path = out_dir / f"{label}.splats.f32"
    candidate_bytes = np.asarray(frame["candidates"], dtype="<f4").tobytes()
    splat_bytes = np.asarray(frame["splats"], dtype="<f4").tobytes()
    candidate_path.write_bytes(candidate_bytes)
    splat_path.write_bytes(splat_bytes)

    def artifact(path, data, stride):
        return {
            "path": str(path.resolve()),
            "bytes": len(data),
            "sha256": CORE.sha256_bytes(data),
            "count": len(frame["keys"]),
            "strideFloats": stride,
            "dtype": "float32-le",
            "authority": authority,
        }

    return {
        "candidates": artifact(candidate_path, candidate_bytes, 16),
        "splats": artifact(splat_path, splat_bytes, 12),
    }


def write_cohort_artifact(out_dir, label, cohorts):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    cohort_index = {cohort: index for index, cohort in enumerate(COHORT_ORDER)}
    try:
        values = bytes(cohort_index[cohort] for cohort in cohorts)
    except KeyError as error:
        raise ValueError(f"unknown oracle-support cohort {error.args[0]}") from error
    if not values:
        raise ValueError("oracle-support cohort artifact cannot be empty")
    path = out_dir / f"{label}.u8"
    path.write_bytes(values)
    return {
        "path": str(path.resolve()),
        "bytes": len(values),
        "sha256": CORE.sha256_bytes(values),
        "count": len(values),
        "dtype": "uint8",
        "authority": "exact-oracle-support-motion-cohort-index-v0",
        "order": list(COHORT_ORDER),
    }


def compose_oracle_support_frames(
    target,
    target_indices,
    baseline_rows,
    predicted_target_indices,
    predicted_rows,
):
    target_indices = np.asarray(target_indices, dtype=np.int32)
    baseline_rows = np.asarray(baseline_rows, dtype=np.float32)
    predicted_target_indices = np.asarray(predicted_target_indices, dtype=np.int32)
    predicted_rows = np.asarray(predicted_rows, dtype=np.float32)
    if target_indices.ndim != 1 or len(target_indices) == 0:
        raise ValueError("oracle-support target indices must be nonempty and one-dimensional")
    if len(np.unique(target_indices)) != len(target_indices):
        raise ValueError("oracle-support target indices must be unique")
    if np.any(target_indices < 0) or np.any(target_indices >= len(target["keys"])):
        raise ValueError("oracle-support target index is outside the exact target")
    if baseline_rows.shape != (len(target_indices), CORE.DESTINATION_STATE_ATTRIBUTE_COUNT):
        raise ValueError("oracle-support baseline rows must align with eligible targets")
    if predicted_rows.shape != (len(predicted_target_indices), CORE.DESTINATION_STATE_ATTRIBUTE_COUNT):
        raise ValueError("one-step predicted rows must align with predicted target indices")
    if len(np.unique(predicted_target_indices)) != len(predicted_target_indices):
        raise ValueError("one-step predicted target indices must be unique")
    eligible = set(target_indices.tolist())
    if any(int(index) not in eligible for index in predicted_target_indices):
        raise ValueError("one-step prediction escaped eligible oracle support")
    if not np.all(np.isfinite(baseline_rows)) or not np.all(np.isfinite(predicted_rows)):
        raise ValueError("oracle-support state rows must be finite")

    order = np.argsort(target_indices)
    ordered_target_indices = target_indices[order]
    ordered_baselines = baseline_rows[order]
    target_to_output = {int(target_index): output_index for output_index, target_index in enumerate(ordered_target_indices)}
    exact_candidates = target["candidates"][ordered_target_indices].copy()
    exact_splats = target["splats"][ordered_target_indices].copy()
    control_candidates = ordered_baselines[:, :len(CORE.FEATURES)].copy()
    control_splats = exact_splats.copy()
    control_splats[:, 3:] = ordered_baselines[:, len(CORE.FEATURES):]
    prediction_candidates = control_candidates.copy()
    prediction_splats = control_splats.copy()
    for target_index, row in zip(predicted_target_indices, predicted_rows):
        output_index = target_to_output[int(target_index)]
        prediction_candidates[output_index] = row[:len(CORE.FEATURES)]
        prediction_splats[output_index, 3:] = row[len(CORE.FEATURES):]

    exact = CORE.index_frame(exact_candidates, exact_splats)
    control = CORE.index_frame(control_candidates, control_splats)
    predicted = CORE.index_frame(prediction_candidates, prediction_splats)
    support_changed = exact["keys"] != control["keys"] or exact["keys"] != predicted["keys"]
    positions_changed = (
        not np.array_equal(exact["splats"][:, :3], control["splats"][:, :3])
        or not np.array_equal(exact["splats"][:, :3], predicted["splats"][:, :3])
    )
    if support_changed or positions_changed:
        raise ValueError("oracle-support composition changed support or world positions")
    return exact, control, predicted, {
        "authority": "exact-target-valid-local-donor-support-with-motion-state-overwrite-v0",
        "targetFrameSupportCount": len(target["keys"]),
        "exactSupportCount": len(exact["keys"]),
        "excludedUnsupportedTargetCount": len(target["keys"]) - len(exact["keys"]),
        "learnedUpdatedCount": len(predicted_target_indices),
        "copiedStaticCount": len(exact["keys"]) - len(predicted_target_indices),
        "supportChanged": support_changed,
        "worldPositionsChanged": positions_changed,
    }


def build_pair_payload(model, source, target, grid_step, normalization, batch_size):
    eulerian = CORE.build_eulerian_pair_dataset(source, target, grid_step)
    eligible_rows = np.flatnonzero(
        (eulerian["destinationTargetIndices"] >= 0)
        & (eulerian["destinationDonorIndices"] >= 0)
        & (eulerian["carrierLabels"] < CORE.DEATH_CLASS)
    )
    if not len(eligible_rows):
        raise ValueError("heldout pair has no valid local-donor target support")
    target_indices = eulerian["destinationTargetIndices"][eligible_rows]
    donor_indices = eulerian["destinationDonorIndices"][eligible_rows]
    eligible_cohorts = np.asarray(eulerian["destinationCohorts"], dtype=object)[eligible_rows]
    baseline_rows = np.concatenate((
        source["candidates"][donor_indices],
        source["splats"][donor_indices, 3:],
    ), axis=1).astype(np.float32)
    dataset = CORE.build_destination_state_dataset(source, target, grid_step)
    predicted_residuals = CORE.predict_destination_state_model(
        model,
        dataset["stateInputs"],
        normalization["inputMean"],
        normalization["inputScale"],
        normalization["residualMean"],
        normalization["residualScale"],
        batch_size,
    )
    predicted_rows = dataset["stateBaselines"] + predicted_residuals
    metrics = CORE.summarize_destination_state_metrics(
        dataset["stateBaselines"],
        predicted_rows,
        dataset["stateTargets"],
        dataset["stateCohorts"],
        normalization["residualScale"],
    )
    exact, control, predicted, accounting = compose_oracle_support_frames(
        target,
        target_indices,
        baseline_rows,
        dataset["stateTargetIndices"],
        predicted_rows,
    )
    accounting["unsupportedBirthCount"] = int(eulerian["unsupportedBirthCount"])
    if accounting["excludedUnsupportedTargetCount"] != accounting["unsupportedBirthCount"]:
        raise ValueError("oracle-support exclusion does not match unsupported birth accounting")
    eligible_cohorts = eligible_cohorts[np.argsort(target_indices)].tolist()
    return exact, control, predicted, accounting, metrics, dataset["stateCohorts"], eligible_cohorts


def main(argv=None):
    args = parse_args(argv)
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "destination-state-evaluation.json"
    started_at = time.time()
    failure_phase = "argument-validation"
    last_trustworthy = {
        "requestedModelPath": str(Path(args.model).resolve()),
        "requestedEvaluationManifestPath": str(Path(args.evaluation_manifest).resolve()),
        "requestedBatchSize": args.batch_size,
        "pairCap": None,
        "sampleCap": None,
    }

    def checkpoint(phase):
        nonlocal failure_phase
        failure_phase = phase
        CORE.write_json(report_path, {
            "schema": SCHEMA,
            "status": "running",
            "startedAt": started_at,
            "updatedAt": time.time(),
            "currentPhase": phase,
            "lastTrustworthyEvidence": last_trustworthy,
            "primaryArtifactsComplete": False,
        })

    checkpoint("argument-validation")
    try:
        if args.batch_size < 1:
            raise ValueError("batch size must be positive")
        checkpoint("model-validation")
        model_document, model_receipt = file_identity(args.model, CORE.DESTINATION_STATE_MODEL_SCHEMA)
        model, normalization = CORE.hydrate_frozen_destination_state_model_document(model_document)
        last_trustworthy["modelSha256"] = model_receipt["sha256"]
        checkpoint("evaluation-manifest-validation")
        _, frame_documents, frames, grid_step, manifest_receipt = TRAINER.load_corpus_manifest(args.evaluation_manifest)
        if model_document.get("evaluationManifest", {}).get("sha256") != manifest_receipt["sha256"]:
            raise ValueError("frozen model evaluation corpus identity mismatch")
        last_trustworthy["evaluationManifestSha256"] = manifest_receipt["sha256"]
        checkpoint("route-validation")
        route = validate_route(str(mx.default_device()), fallback_reason=None)
        last_trustworthy.update({
            "effectiveBackend": route["backend"],
            "effectiveDevice": route["device"],
            "fallbackReason": route["fallbackReason"],
        })
        pairs = []
        for step, (source_document, target_document) in enumerate(zip(frame_documents, frame_documents[1:]), start=1):
            checkpoint(f"pair-{step:03d}-inference")
            exact, control, predicted, accounting, metrics, cohorts, eligible_cohorts = build_pair_payload(
                model,
                frames[source_document["id"]],
                frames[target_document["id"]],
                grid_step,
                normalization,
                args.batch_size,
            )
            pair_dir = out_dir / f"pair-{step:03d}"
            pair = {
                "step": step,
                "sourceFrameId": source_document["id"],
                "targetFrameId": target_document["id"],
                "simulatorTimeSeconds": step * manifest_receipt["controlledStepDeltaMs"] / 1000,
                "reference": write_role_frame_artifacts(pair_dir, "reference", exact, REFERENCE_AUTHORITY),
                "control": write_role_frame_artifacts(pair_dir, "control", control, CONTROL_AUTHORITY),
                "predicted": write_role_frame_artifacts(pair_dir, "predicted", predicted, PREDICTION_AUTHORITY),
                "cohorts": write_cohort_artifact(pair_dir, "cohorts", eligible_cohorts),
                "supportAccounting": accounting,
                "motionStateCohortCounts": {
                    cohort: int(np.sum(cohorts == cohort))
                    for cohort in CORE.DESTINATION_STATE_COHORTS
                },
                "metrics": metrics,
            }
            pairs.append(pair)
            last_trustworthy.update({
                "completedPairCount": len(pairs),
                "lastCompletedPair": step,
                "lastTargetFrameId": target_document["id"],
                "lastExactSupportCount": accounting["exactSupportCount"],
                "lastLearnedUpdatedCount": accounting["learnedUpdatedCount"],
            })
        expected_pairs = len(frame_documents) - 1
        if len(pairs) != expected_pairs:
            raise ValueError(f"destination-state evaluation is partial: {len(pairs)}/{expected_pairs}")
        evaluation = TRAINER.combine_evaluation_metrics([pair["metrics"] for pair in pairs])
        checkpoint("report-write")
        report = {
            "schema": SCHEMA,
            "status": "completed",
            "startedAt": started_at,
            "completedAt": time.time(),
            "model": model_receipt,
            "evaluationManifest": manifest_receipt,
            "route": route,
            "temporal": {
                "authority": "all-adjacent-cross-episode-one-step-evaluations-v0",
                "referenceFrameIds": [frame["id"] for frame in frame_documents],
                "evaluatedPairCount": len(pairs),
                "controlledStepDeltaMs": manifest_receipt["controlledStepDeltaMs"],
                "simulatorDurationSeconds": len(pairs) * manifest_receipt["controlledStepDeltaMs"] / 1000,
                "pairCap": None,
                "sampleCap": None,
            },
            "roles": {
                "reference": REFERENCE_AUTHORITY,
                "control": CONTROL_AUTHORITY,
                "predicted": PREDICTION_AUTHORITY,
            },
            "evaluation": evaluation,
            "pairs": pairs,
            "claimBoundary": (
                "one-step frozen destination-state prediction on exact heldout target support with valid local donor assignment; "
                "unsupported births are excluded from all roles and copied static rows remain donor state; no recurrence, analytical-raymarch agreement, or runtime integration"
            ),
        }
        CORE.write_json(report_path, report)
        print(json.dumps({
            "schema": SCHEMA,
            "status": "completed",
            "evaluatedPairCount": len(pairs),
            "report": str(report_path),
        }, indent=2))
    except Exception as error:
        CORE.write_json(report_path, build_failure_report(started_at, failure_phase, error, last_trustworthy))
        print(json.dumps(build_failure_report(started_at, failure_phase, error, last_trustworthy), indent=2), file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
