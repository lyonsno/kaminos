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
TRANSPORT_COMPARISON_SCHEMA = "kaminos-boundary-splat-phase-appearance-transport-evaluation-v0"
REFERENCE_AUTHORITY = "exact-heldout-valid-local-donor-support-v0"
CONTROL_AUTHORITY = "oracle-support-carried-donor-control-v0"
PREDICTION_AUTHORITY = "frozen-destination-state-one-step-on-oracle-support-v0"
COHORT_ORDER = ("stable-q1", "stable-q2", "stable-q3", "stable-q4", "transported", "birth")


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--transport-model")
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


def build_failure_report(started_at, failure_phase, error, last_trustworthy, schema=SCHEMA):
    return {
        "schema": schema,
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


def select_forced_support_learned_donors(carrier_probabilities, valid_donor_indices):
    carrier_probabilities = np.asarray(carrier_probabilities, dtype=np.float32)
    valid_donor_indices = np.asarray(valid_donor_indices, dtype=np.int32)
    expected_probabilities = (len(valid_donor_indices), CORE.DEATH_CLASS + 1)
    expected_donors = (len(valid_donor_indices), CORE.DEATH_CLASS)
    if carrier_probabilities.shape != expected_probabilities:
        raise ValueError("learned carrier probabilities must align with destination support and classes")
    if valid_donor_indices.shape != expected_donors:
        raise ValueError("valid donor indices must align with destination support and displacements")
    if not np.all(np.isfinite(carrier_probabilities)):
        raise ValueError("learned carrier probabilities must be finite")
    valid = valid_donor_indices >= 0
    if np.any(~np.any(valid, axis=1)):
        raise ValueError("forced support destination lacks a valid local donor")

    valid_probabilities = np.where(valid, carrier_probabilities[:, :CORE.DEATH_CLASS], -np.inf)
    donor_classes = np.argmax(valid_probabilities, axis=1).astype(np.int32)
    donor_indices = valid_donor_indices[np.arange(len(donor_classes)), donor_classes]
    same_site_class = CORE.DISPLACEMENTS.index((0, 0, 0))
    unconstrained_classes = np.argmax(carrier_probabilities, axis=1)
    return donor_indices.astype(np.int32), donor_classes, {
        "authority": "forced-exact-support-best-valid-learned-displacement-v0",
        "destinationCount": len(donor_classes),
        "deathWouldHaveWonCount": int(np.sum(unconstrained_classes == CORE.DEATH_CLASS)),
        "sameSiteDonorCount": int(np.sum(donor_classes == same_site_class)),
        "transportedDonorCount": int(np.sum(donor_classes != same_site_class)),
        "invalidDonorSelectedCount": int(np.sum(donor_indices < 0)),
    }


def build_valid_local_donor_index_matrix(destination_keys, source, grid_step):
    donors = np.full((len(destination_keys), CORE.DEATH_CLASS), -1, dtype=np.int32)
    for destination_index, destination_key in enumerate(destination_keys):
        for class_index, source_index in CORE.local_destination_donors(destination_key, source, grid_step):
            donors[destination_index, class_index] = source_index
    return donors


def build_counterfactual_destination_state_inputs(destination_inputs, donor_rows, donor_classes):
    destination_inputs = np.asarray(destination_inputs, dtype=np.float32)
    donor_rows = np.asarray(donor_rows, dtype=np.float32)
    donor_classes = np.asarray(donor_classes, dtype=np.int32)
    row_count = len(destination_inputs)
    if destination_inputs.shape != (row_count, 64):
        raise ValueError("counterfactual destination inputs must preserve the exact 64-feature contract")
    if donor_rows.shape != (row_count, CORE.DESTINATION_STATE_ATTRIBUTE_COUNT):
        raise ValueError("counterfactual donor rows must preserve the exact destination-state attributes")
    if donor_classes.shape != (row_count,) or np.any(donor_classes < 0) or np.any(donor_classes >= CORE.DEATH_CLASS):
        raise ValueError("counterfactual donor classes must name one local displacement")
    if not np.all(np.isfinite(destination_inputs)) or not np.all(np.isfinite(donor_rows)):
        raise ValueError("counterfactual destination-state inputs must be finite")
    donor_codes = np.zeros((row_count, CORE.DEATH_CLASS), dtype=np.float32)
    donor_codes[np.arange(row_count), donor_classes] = 1.0
    inputs = np.concatenate((destination_inputs, donor_rows, donor_codes), axis=1).astype(np.float32)
    if inputs.shape != (row_count, CORE.DESTINATION_STATE_INPUT_COUNT):
        raise ValueError("counterfactual destination-state input width violates its explicit contract")
    return inputs


def compose_oracle_support_appearance_frames(target, target_indices, donor_rows, predicted_rows):
    target_indices = np.asarray(target_indices, dtype=np.int32)
    donor_rows = np.asarray(donor_rows, dtype=np.float32)
    predicted_rows = np.asarray(predicted_rows, dtype=np.float32)
    expected_rows = (len(target_indices), CORE.DESTINATION_STATE_ATTRIBUTE_COUNT)
    if target_indices.ndim != 1 or len(target_indices) == 0 or len(np.unique(target_indices)) != len(target_indices):
        raise ValueError("appearance comparison target indices must be unique and nonempty")
    if np.any(target_indices < 0) or np.any(target_indices >= len(target["keys"])):
        raise ValueError("appearance comparison target index is outside the exact target")
    if donor_rows.shape != expected_rows or predicted_rows.shape != expected_rows:
        raise ValueError("appearance comparison rows must align with exact target support")
    if not np.all(np.isfinite(donor_rows)) or not np.all(np.isfinite(predicted_rows)):
        raise ValueError("appearance comparison rows must be finite")

    order = np.argsort(target_indices)
    ordered_target_indices = target_indices[order]
    ordered_donors = donor_rows[order]
    ordered_predictions = predicted_rows[order]
    exact_candidates = target["candidates"][ordered_target_indices].copy()
    exact_splats = target["splats"][ordered_target_indices].copy()
    donor_splats = exact_splats.copy()
    predicted_splats = exact_splats.copy()
    donor_splats[:, 3:] = ordered_donors[:, len(CORE.FEATURES):]
    predicted_splats[:, 3:] = ordered_predictions[:, len(CORE.FEATURES):]
    exact = CORE.index_frame(exact_candidates, exact_splats)
    donor = CORE.index_frame(exact_candidates.copy(), donor_splats)
    predicted = CORE.index_frame(exact_candidates.copy(), predicted_splats)
    positions_changed = (
        not np.array_equal(exact["splats"][:, :3], donor["splats"][:, :3])
        or not np.array_equal(exact["splats"][:, :3], predicted["splats"][:, :3])
    )
    if exact["keys"] != donor["keys"] or exact["keys"] != predicted["keys"] or positions_changed:
        raise ValueError("appearance comparison changed exact support or world positions")
    return exact, donor, predicted, {
        "authority": "exact-candidate-and-support-frozen-splat-appearance-comparison-v0",
        "exactSupportCount": len(exact["keys"]),
        "candidateStateFrozenToExact": True,
        "supportChanged": False,
        "worldPositionsChanged": positions_changed,
        "changedAttributeRange": [len(CORE.FEATURES), CORE.DESTINATION_STATE_ATTRIBUTE_COUNT],
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


def state_rows(frame, indices):
    indices = np.asarray(indices, dtype=np.int32)
    return np.concatenate((
        frame["candidates"][indices],
        frame["splats"][indices, 3:],
    ), axis=1).astype(np.float32)


def summarize_appearance_transport_metrics(donors, predictions, targets, cohorts, residual_scale):
    donors = np.asarray(donors, dtype=np.float32)[:, len(CORE.FEATURES):]
    predictions = np.asarray(predictions, dtype=np.float32)[:, len(CORE.FEATURES):]
    targets = np.asarray(targets, dtype=np.float32)[:, len(CORE.FEATURES):]
    cohorts = np.asarray(cohorts)
    scale = np.asarray(residual_scale, dtype=np.float32)[len(CORE.FEATURES):]
    expected_shape = (len(cohorts), CORE.DESTINATION_STATE_ATTRIBUTE_COUNT - len(CORE.FEATURES))
    if donors.shape != expected_shape or predictions.shape != expected_shape or targets.shape != expected_shape:
        raise ValueError("appearance transport metrics require aligned nonposition splat rows")
    if scale.shape != (expected_shape[1],) or np.any(scale <= 0):
        raise ValueError("appearance transport metrics require positive training splat scales")
    if np.any(~np.isin(cohorts, CORE.SUPPORTED_DESTINATION_STATE_COHORTS)):
        raise ValueError("appearance transport metrics received an unsupported cohort")

    def metric(indices):
        donor_error = (donors[indices] - targets[indices]) / scale
        prediction_error = (predictions[indices] - targets[indices]) / scale
        donor_mse = float(np.mean(donor_error ** 2, dtype=np.float64))
        prediction_mse = float(np.mean(prediction_error ** 2, dtype=np.float64))
        return {
            "sampleCount": int(len(indices)),
            "donorMse": donor_mse,
            "predictionMse": prediction_mse,
            "predictionToDonorMseRatio": prediction_mse / max(donor_mse, 1e-12),
            "beatsDonor": prediction_mse < donor_mse,
        }

    cohort_metrics = {
        cohort: metric(np.flatnonzero(cohorts == cohort))
        for cohort in CORE.SUPPORTED_DESTINATION_STATE_COHORTS
        if np.any(cohorts == cohort)
    }
    return {
        "authority": "training-scale-normalized-nonposition-splat-mse-v0",
        "attributeCount": expected_shape[1],
        "aggregate": metric(np.arange(len(cohorts))),
        "cohorts": cohort_metrics,
        "aggregateMayCloseCohortClaim": False,
    }


def build_transport_comparison_pair_payload(
    state_model,
    state_normalization,
    transport_model,
    transport_input_mean,
    transport_input_scale,
    source,
    target,
    grid_step,
    batch_size,
):
    eulerian = CORE.build_eulerian_pair_dataset(source, target, grid_step)
    dataset = CORE.build_destination_state_dataset(
        source,
        target,
        grid_step,
        state_cohorts=CORE.SUPPORTED_DESTINATION_STATE_COHORTS,
    )
    destination_lookup = {key: index for index, key in enumerate(eulerian["destinationKeys"])}
    destination_indices = np.asarray([
        destination_lookup[key]
        for key in dataset["stateDestinationKeys"]
    ], dtype=np.int32)
    destination_inputs = eulerian["destinationInputs"][destination_indices]
    carrier_probabilities, _ = CORE.predict_model(
        transport_model,
        destination_inputs,
        transport_input_mean,
        transport_input_scale,
        batch_size,
    )
    valid_donors = build_valid_local_donor_index_matrix(
        dataset["stateDestinationKeys"],
        source,
        grid_step,
    )
    learned_donor_indices, learned_donor_classes, learned_accounting = select_forced_support_learned_donors(
        carrier_probabilities,
        valid_donors,
    )
    learned_donor_rows = state_rows(source, learned_donor_indices)
    learned_inputs = build_counterfactual_destination_state_inputs(
        destination_inputs,
        learned_donor_rows,
        learned_donor_classes,
    )
    oracle_residuals = CORE.predict_destination_state_model(
        state_model,
        dataset["stateInputs"],
        state_normalization["inputMean"],
        state_normalization["inputScale"],
        state_normalization["residualMean"],
        state_normalization["residualScale"],
        batch_size,
    )
    learned_residuals = CORE.predict_destination_state_model(
        state_model,
        learned_inputs,
        state_normalization["inputMean"],
        state_normalization["inputScale"],
        state_normalization["residualMean"],
        state_normalization["residualScale"],
        batch_size,
    )
    oracle_predictions = dataset["stateBaselines"] + oracle_residuals
    learned_predictions = learned_donor_rows + learned_residuals
    exact, oracle_donor, oracle_predicted, composition = compose_oracle_support_appearance_frames(
        target,
        dataset["stateTargetIndices"],
        dataset["stateBaselines"],
        oracle_predictions,
    )
    learned_exact, learned_donor, learned_predicted, learned_composition = compose_oracle_support_appearance_frames(
        target,
        dataset["stateTargetIndices"],
        learned_donor_rows,
        learned_predictions,
    )
    if (
        exact["keys"] != learned_exact["keys"]
        or not np.array_equal(exact["candidates"], learned_exact["candidates"])
        or not np.array_equal(exact["splats"], learned_exact["splats"])
    ):
        raise ValueError("oracle and learned transport arms do not share one exact reference")
    target_rows = dataset["stateTargets"]
    return {
        "reference": exact,
        "sourceReuse": source,
        "oracleDonor": oracle_donor,
        "oraclePredicted": oracle_predicted,
        "learnedDonor": learned_donor,
        "learnedPredicted": learned_predicted,
        "cohorts": dataset["stateCohorts"],
        "eligibleCohorts": dataset["stateCohorts"][np.argsort(dataset["stateTargetIndices"])].tolist(),
        "supportAccounting": {
            **composition,
            "targetFrameSupportCount": len(target["keys"]),
            "excludedUnsupportedTargetCount": len(target["keys"]) - len(exact["keys"]),
            "unsupportedBirthCount": int(eulerian["unsupportedBirthCount"]),
            "learnedDonor": learned_accounting,
            "learnedCompositionMatchesOracleSupport": learned_composition["exactSupportCount"] == composition["exactSupportCount"],
        },
        "metrics": {
            "authority": "matched-exact-support-oracle-versus-learned-donor-appearance-v0",
            "oracleTransport": summarize_appearance_transport_metrics(
                dataset["stateBaselines"],
                oracle_predictions,
                target_rows,
                dataset["stateCohorts"],
                state_normalization["residualScale"],
            ),
            "learnedTransport": summarize_appearance_transport_metrics(
                learned_donor_rows,
                learned_predictions,
                target_rows,
                dataset["stateCohorts"],
                state_normalization["residualScale"],
            ),
        },
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
    active_schema = TRANSPORT_COMPARISON_SCHEMA if args.transport_model else SCHEMA
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "destination-state-evaluation.json"
    started_at = time.time()
    failure_phase = "argument-validation"
    last_trustworthy = {
        "requestedModelPath": str(Path(args.model).resolve()),
        "requestedTransportModelPath": (
            str(Path(args.transport_model).resolve())
            if args.transport_model
            else None
        ),
        "requestedEvaluationManifestPath": str(Path(args.evaluation_manifest).resolve()),
        "requestedBatchSize": args.batch_size,
        "pairCap": None,
        "sampleCap": None,
    }

    def checkpoint(phase):
        nonlocal failure_phase
        failure_phase = phase
        CORE.write_json(report_path, {
            "schema": active_schema,
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
        transport_model = None
        transport_model_receipt = None
        transport_input_mean = None
        transport_input_scale = None
        if args.transport_model:
            transport_document, transport_model_receipt = file_identity(args.transport_model, CORE.MODEL_SCHEMA)
            transport_validation = CORE.validate_frozen_model_document(transport_document)
            if transport_validation["objectiveFamily"] != CORE.EULERIAN_OCCUPANCY_OBJECTIVE_FAMILY:
                raise ValueError("appearance transport comparison requires the Eulerian occupancy transport model")
            transport_model, transport_input_mean, transport_input_scale = CORE.hydrate_frozen_model_document(
                transport_document,
            )
            last_trustworthy["transportModelSha256"] = transport_model_receipt["sha256"]
            last_trustworthy["transportObjectiveFamily"] = transport_validation["objectiveFamily"]
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
            pair_dir = out_dir / f"pair-{step:03d}"
            if args.transport_model:
                comparison = build_transport_comparison_pair_payload(
                    model,
                    normalization,
                    transport_model,
                    transport_input_mean,
                    transport_input_scale,
                    frames[source_document["id"]],
                    frames[target_document["id"]],
                    grid_step,
                    args.batch_size,
                )
                accounting = comparison["supportAccounting"]
                pair = {
                    "step": step,
                    "sourceFrameId": source_document["id"],
                    "targetFrameId": target_document["id"],
                    "simulatorTimeSeconds": step * manifest_receipt["controlledStepDeltaMs"] / 1000,
                    "reference": write_role_frame_artifacts(
                        pair_dir, "reference", comparison["reference"],
                        "exact-heldout-valid-local-donor-support-and-candidate-state-v0",
                    ),
                    "sourceReuse": write_role_frame_artifacts(
                        pair_dir, "source-reuse", comparison["sourceReuse"],
                        "current-source-state-zero-flow-reuse-v0",
                    ),
                    "oracleDonor": write_role_frame_artifacts(
                        pair_dir, "oracle-donor", comparison["oracleDonor"],
                        "oracle-correspondence-transported-splat-donor-v0",
                    ),
                    "oraclePredicted": write_role_frame_artifacts(
                        pair_dir, "oracle-predicted", comparison["oraclePredicted"],
                        "oracle-correspondence-transport-plus-frozen-splat-residual-v0",
                    ),
                    "learnedDonor": write_role_frame_artifacts(
                        pair_dir, "learned-donor", comparison["learnedDonor"],
                        "forced-support-best-valid-learned-displacement-splat-donor-v0",
                    ),
                    "learnedPredicted": write_role_frame_artifacts(
                        pair_dir, "learned-predicted", comparison["learnedPredicted"],
                        "forced-support-learned-displacement-plus-frozen-splat-residual-v0",
                    ),
                    "cohorts": write_cohort_artifact(pair_dir, "cohorts", comparison["eligibleCohorts"]),
                    "supportAccounting": accounting,
                    "motionStateCohortCounts": {
                        cohort: int(np.sum(comparison["cohorts"] == cohort))
                        for cohort in CORE.SUPPORTED_DESTINATION_STATE_COHORTS
                    },
                    "metrics": comparison["metrics"],
                }
            else:
                exact, control, predicted, accounting, metrics, cohorts, eligible_cohorts = build_pair_payload(
                    model,
                    frames[source_document["id"]],
                    frames[target_document["id"]],
                    grid_step,
                    normalization,
                    args.batch_size,
                )
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
        evaluation = (
            {
                "authority": "all-adjacent-matched-appearance-transport-comparisons-v0",
                "pairCount": len(pairs),
                "oracleAggregatePredictionMse": float(np.mean([
                    pair["metrics"]["oracleTransport"]["aggregate"]["predictionMse"]
                    for pair in pairs
                ])),
                "learnedAggregatePredictionMse": float(np.mean([
                    pair["metrics"]["learnedTransport"]["aggregate"]["predictionMse"]
                    for pair in pairs
                ])),
                "oracleBeatsLearnedPairCount": int(sum(
                    pair["metrics"]["oracleTransport"]["aggregate"]["predictionMse"]
                    < pair["metrics"]["learnedTransport"]["aggregate"]["predictionMse"]
                    for pair in pairs
                )),
                "pairCap": None,
                "sampleCap": None,
            }
            if args.transport_model
            else TRAINER.combine_evaluation_metrics([pair["metrics"] for pair in pairs])
        )
        checkpoint("report-write")
        report = {
            "schema": active_schema,
            "status": "completed",
            "startedAt": started_at,
            "completedAt": time.time(),
            "model": model_receipt,
            **({"transportModel": transport_model_receipt} if transport_model_receipt else {}),
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
            "roles": (
                {
                    "reference": "exact-heldout-valid-local-donor-support-and-candidate-state-v0",
                    "sourceReuse": "current-source-state-zero-flow-reuse-v0",
                    "oracleDonor": "oracle-correspondence-transported-splat-donor-v0",
                    "oraclePredicted": "oracle-correspondence-transport-plus-frozen-splat-residual-v0",
                    "learnedDonor": "forced-support-best-valid-learned-displacement-splat-donor-v0",
                    "learnedPredicted": "forced-support-learned-displacement-plus-frozen-splat-residual-v0",
                }
                if args.transport_model
                else {
                    "reference": REFERENCE_AUTHORITY,
                    "control": CONTROL_AUTHORITY,
                    "predicted": PREDICTION_AUTHORITY,
                }
            ),
            "evaluation": evaluation,
            "pairs": pairs,
            "claimBoundary": (
                "one-step appearance-only oracle-versus-learned donor comparison with exact heldout candidate state, positions, and valid local-donor support; "
                "source reuse has its native differing support, unsupported births are excluded from matched roles, and no recurrence, analytical-raymarch agreement, or runtime integration is claimed"
                if args.transport_model
                else (
                    "one-step frozen destination-state prediction on exact heldout target support with valid local donor assignment; "
                    "unsupported births are excluded from all roles and copied static rows remain donor state; no recurrence, analytical-raymarch agreement, or runtime integration"
                )
            ),
        }
        CORE.write_json(report_path, report)
        print(json.dumps({
            "schema": active_schema,
            "status": "completed",
            "evaluatedPairCount": len(pairs),
            "report": str(report_path),
        }, indent=2))
    except Exception as error:
        failure = build_failure_report(started_at, failure_phase, error, last_trustworthy, active_schema)
        CORE.write_json(report_path, failure)
        print(json.dumps(failure, indent=2), file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
