#!/usr/bin/env python3
import argparse
import importlib.util
import json
import math
import sys
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np


CORE_PATH = Path(__file__).resolve().with_name("boundary-splat-phase-transport-mlx.py")
CORE_SPEC = importlib.util.spec_from_file_location("boundary_splat_phase_transport_mlx", CORE_PATH)
CORE = importlib.util.module_from_spec(CORE_SPEC)
CORE_SPEC.loader.exec_module(CORE)

REPORT_SCHEMA = "kaminos-boundary-splat-phase-destination-state-training-v0"
INPUT_AUTHORITY = CORE.DESTINATION_STATE_INPUT_AUTHORITY
OUTPUT_AUTHORITY = CORE.DESTINATION_STATE_OUTPUT_AUTHORITY
ARCHITECTURE_AUTHORITY = CORE.DESTINATION_STATE_ARCHITECTURE_AUTHORITY
TRAINING_MODES = (
    "teacher-forced",
    "protected-rollout",
    "protected-online-rollout",
    "protected-anchored-online-rollout",
)
ROLLOUT_TRAINING_MODES = TRAINING_MODES[1:]
ONLINE_ROLLOUT_TRAINING_MODES = (
    "protected-online-rollout",
    "protected-anchored-online-rollout",
)
ANCHORED_ROLLOUT_TRAINING_MODE = "protected-anchored-online-rollout"
ROLLOUT_STATE_COHORTS = CORE.SUPPORTED_DESTINATION_STATE_COHORTS
SPLAT_ATTRIBUTE_ORDER = (
    "splat.support",
    "splat.color.r", "splat.color.g", "splat.color.b",
    "splat.opacity", "splat.shape.x", "splat.shape.y",
    "splat.ridge", "splat.fireSignal",
)
VISIBLE_ENERGY_COLOR_INDICES = tuple(
    len(CORE.FEATURES) + SPLAT_ATTRIBUTE_ORDER.index(channel)
    for channel in ("splat.color.r", "splat.color.g", "splat.color.b")
)
VISIBLE_ENERGY_OPACITY_INDEX = len(CORE.FEATURES) + SPLAT_ATTRIBUTE_ORDER.index("splat.opacity")


def parse_args(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--training-manifest", required=True)
    parser.add_argument("--evaluation-manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--hidden-size", type=int, default=128)
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=4096)
    parser.add_argument("--learning-rate", type=float, default=0.0015)
    parser.add_argument("--weight-decay", type=float, default=0.0001)
    parser.add_argument("--seed", type=int, default=713)
    parser.add_argument("--training-mode", choices=TRAINING_MODES, default="teacher-forced")
    parser.add_argument("--rollout-seed-model")
    parser.add_argument("--response-anchor-model")
    parser.add_argument("--response-anchor-weight", type=float, default=0.0)
    parser.add_argument("--rollout-horizon", type=int, default=4)
    parser.add_argument("--predicted-input-fraction", type=float, default=0.625)
    parser.add_argument("--candidate-loss-weight", type=float, default=0.1)
    parser.add_argument("--splat-loss-weight", type=float, default=1.0)
    parser.add_argument("--energy-loss-weight", type=float, default=0.25)
    return parser.parse_args(argv)


def build_rollout_loss_contract(candidate_weight, splat_weight, energy_weight):
    return {
        "authority": "candidate-splat-physical-visible-energy-weighted-loss-v1",
        "candidateChannelCount": len(CORE.FEATURES),
        "splatChannelCount": len(SPLAT_ATTRIBUTE_ORDER),
        "visibleEnergy": "max(opacity,0)*max(rec709-luminance,0)",
        "visibleEnergyChannels": {
            "color": list(VISIBLE_ENERGY_COLOR_INDICES),
            "opacity": VISIBLE_ENERGY_OPACITY_INDEX,
        },
        "weights": {
            "candidate": float(candidate_weight),
            "splat": float(splat_weight),
            "visibleEnergy": float(energy_weight),
        },
    }


def build_teacher_forced_loss_contract():
    return {
        "authority": "normalized-residual-aggregate-mse-v0",
        "channelCount": CORE.DESTINATION_STATE_ATTRIBUTE_COUNT,
    }


def build_training_loss_receipt(training_config, visible_energy_scale):
    receipt = dict(training_config["loss"])
    if training_config["mode"] in ROLLOUT_TRAINING_MODES:
        receipt["visibleEnergyScale"] = float(visible_energy_scale)
    return receipt


def validate_rollout_training_config(
    training_mode,
    rollout_seed_model,
    rollout_horizon,
    predicted_input_fraction,
    candidate_loss_weight,
    splat_loss_weight,
    energy_loss_weight,
    response_anchor_model=None,
    response_anchor_weight=0.0,
):
    if training_mode not in TRAINING_MODES:
        raise ValueError("destination-state training mode is unsupported")
    if rollout_horizon < 1:
        raise ValueError("rollout horizon must be positive")
    if not 0 <= predicted_input_fraction <= 1:
        raise ValueError("predicted input fraction must be inside [0, 1]")
    weights = (candidate_loss_weight, splat_loss_weight, energy_loss_weight)
    if any(not math.isfinite(value) or value < 0 for value in weights) or splat_loss_weight <= 0:
        raise ValueError("rollout loss weights must be finite and include positive splat weight")
    if training_mode in ROLLOUT_TRAINING_MODES and not rollout_seed_model:
        raise ValueError("protected rollout training requires an explicit seed model")
    is_rollout = training_mode in ROLLOUT_TRAINING_MODES
    is_online = training_mode in ONLINE_ROLLOUT_TRAINING_MODES
    is_anchored = training_mode == ANCHORED_ROLLOUT_TRAINING_MODE
    if is_anchored:
        if not response_anchor_model:
            raise ValueError("anchored online rollout requires an explicit response anchor model")
        if not math.isfinite(response_anchor_weight) or response_anchor_weight <= 0:
            raise ValueError("response anchor weight must be finite and positive")
    elif response_anchor_model is not None or response_anchor_weight != 0:
        raise ValueError("response anchor configuration requires anchored online rollout mode")
    rollout_loss = build_rollout_loss_contract(*weights) if is_rollout else build_teacher_forced_loss_contract()
    response_anchor = None
    if is_anchored:
        response_anchor = {
            "authority": "frozen-teacher-response-on-current-model-exposed-inputs-v0",
            "model": str(Path(response_anchor_model).expanduser().resolve()),
            "weight": float(response_anchor_weight),
            "scope": "predicted-splat-exposure-rows-only",
            "sampleCap": None,
        }
        rollout_loss = {
            **rollout_loss,
            "responseAnchor": {
                "authority": response_anchor["authority"],
                "scope": response_anchor["scope"],
                "weight": response_anchor["weight"],
            },
        }
    return {
        "authority": (
            "protected-splat-anchored-online-scheduled-exposure-training-v0"
            if is_anchored
            else (
                "protected-splat-online-scheduled-exposure-training-v0"
                if is_online
                else (
                    "protected-splat-scheduled-exposure-training-v0"
                    if is_rollout
                    else "adjacent-pair-teacher-forcing-v0"
                )
            )
        ),
        "mode": training_mode,
        "rolloutSeedModel": str(Path(rollout_seed_model).expanduser().resolve()) if rollout_seed_model else None,
        "rolloutHorizon": int(rollout_horizon),
        "rolloutRefreshCadence": "epoch" if is_online else None,
        "predictedInputFraction": float(predicted_input_fraction),
        "candidateStateExposed": False,
        "occupancyFeedbackEnabled": False,
        "responseAnchor": response_anchor,
        "loss": rollout_loss,
    }


def visible_energy_numpy(states):
    states = np.asarray(states, dtype=np.float32)
    if states.ndim != 2 or states.shape[1] != CORE.DESTINATION_STATE_ATTRIBUTE_COUNT:
        raise ValueError("visible energy requires aligned 25-attribute states")
    luminance = (
        states[:, VISIBLE_ENERGY_COLOR_INDICES[0]] * 0.2126
        + states[:, VISIBLE_ENERGY_COLOR_INDICES[1]] * 0.7152
        + states[:, VISIBLE_ENERGY_COLOR_INDICES[2]] * 0.0722
    )
    return np.maximum(states[:, VISIBLE_ENERGY_OPACITY_INDEX], 0) * np.maximum(luminance, 0)


def apply_protected_splat_exposure(inputs, baselines, targets, predicted_splats, exposure_mask):
    inputs = np.asarray(inputs, dtype=np.float32)
    baselines = np.asarray(baselines, dtype=np.float32)
    targets = np.asarray(targets, dtype=np.float32)
    predicted_splats = np.asarray(predicted_splats, dtype=np.float32)
    exposure_mask = np.asarray(exposure_mask, dtype=bool)
    row_count = len(baselines)
    if (
        inputs.shape != (row_count, CORE.DESTINATION_STATE_INPUT_COUNT)
        or baselines.shape != (row_count, CORE.DESTINATION_STATE_ATTRIBUTE_COUNT)
        or targets.shape != baselines.shape
        or predicted_splats.shape != (row_count, len(SPLAT_ATTRIBUTE_ORDER))
        or exposure_mask.shape != (row_count,)
    ):
        raise ValueError("protected splat exposure rows violate the destination-state contract")
    exposed_inputs = inputs.copy()
    exposed_baselines = baselines.copy()
    exposed_baselines[exposure_mask, len(CORE.FEATURES):] = predicted_splats[exposure_mask]
    baseline_start = 64
    baseline_end = baseline_start + CORE.DESTINATION_STATE_ATTRIBUTE_COUNT
    exposed_inputs[:, baseline_start:baseline_end] = exposed_baselines
    return {
        "authority": "canonical-candidate-splat-only-predicted-exposure-v0",
        "stateInputs": exposed_inputs,
        "stateBaselines": exposed_baselines,
        "stateTargets": targets.copy(),
        "stateResidualTargets": (targets - exposed_baselines).astype(np.float32),
        "responseAnchorMask": exposure_mask.copy(),
        "predictedExposureCount": int(np.sum(exposure_mask)),
        "candidateStateExposed": False,
        "occupancyFeedbackEnabled": False,
    }


def load_rollout_seed_model(path):
    model_path = Path(path).expanduser().resolve()
    data = model_path.read_bytes()
    document = json.loads(data)
    model, normalization = CORE.hydrate_frozen_destination_state_model_document(document)
    return model, normalization, {
        "path": str(model_path),
        "bytes": len(data),
        "sha256": CORE.sha256_bytes(data),
        "schema": CORE.DESTINATION_STATE_MODEL_SCHEMA,
        "route": document["route"],
    }


def resolve_training_normalization(training_mode, state_inputs, residual_targets, seed_normalization=None):
    if training_mode in ROLLOUT_TRAINING_MODES:
        if seed_normalization is None:
            raise ValueError("protected rollout normalization requires the frozen seed model")
        return {
            "authority": "frozen-rollout-seed-normalization-v0",
            "inputMean": seed_normalization["inputMean"].copy(),
            "inputScale": seed_normalization["inputScale"].copy(),
            "residualMean": seed_normalization["residualMean"].copy(),
            "residualScale": seed_normalization["residualScale"].copy(),
        }
    input_mean = np.mean(state_inputs, axis=0, dtype=np.float64).astype(np.float32)
    input_scale = np.std(state_inputs, axis=0, dtype=np.float64).astype(np.float32)
    input_scale[input_scale < 1e-6] = 1.0
    residual_mean = np.mean(residual_targets, axis=0, dtype=np.float64).astype(np.float32)
    residual_scale = np.std(residual_targets, axis=0, dtype=np.float64).astype(np.float32)
    residual_scale[residual_scale < 1e-6] = 1.0
    return {
        "authority": "training-corpus-channel-normalization-v0",
        "inputMean": input_mean,
        "inputScale": input_scale,
        "residualMean": residual_mean,
        "residualScale": residual_scale,
    }


def validate_training_route(device, fallback_reason=None):
    if fallback_reason not in (None, ""):
        raise RuntimeError(f"destination-state training forbids fallback routing: {fallback_reason}")
    if not str(device).lower().startswith("device(gpu"):
        raise RuntimeError(f"destination-state trainer requires MLX GPU, effective device was {device}")
    return {
        "backend": "mlx",
        "device": str(device),
        "effectiveRunner": sys.executable,
        "fallbackReason": None,
    }


def validate_manifest_roles(training_receipt, evaluation_receipt):
    if training_receipt.get("sha256") == evaluation_receipt.get("sha256"):
        raise ValueError("destination-state evaluation requires a distinct cross-episode corpus")


def build_failure_report(started_at, failure_phase, error, last_trustworthy):
    return {
        "schema": REPORT_SCHEMA,
        "status": "failed",
        "startedAt": started_at,
        "failedAt": time.time(),
        "failurePhase": failure_phase,
        "error": f"{type(error).__name__}: {error}",
        "lastTrustworthyEvidence": last_trustworthy,
    }


def build_running_report(started_at, phase, last_trustworthy):
    return {
        "schema": REPORT_SCHEMA,
        "status": "running",
        "startedAt": started_at,
        "updatedAt": time.time(),
        "currentPhase": phase,
        "lastTrustworthyEvidence": last_trustworthy,
        "primaryArtifactsComplete": False,
    }


def load_corpus_manifest(path):
    path = Path(path).resolve()
    data = path.read_bytes()
    document = json.loads(data)
    if document.get("schema") != "kaminos-boundary-splat-phase-candidate-corpus-v0":
        raise ValueError("destination-state trainer requires the phase candidate corpus schema")
    if document.get("featureOrder") != list(CORE.FEATURES):
        raise ValueError("destination-state trainer requires the exact deployed 16-feature candidate contract")
    if document.get("effectiveRoute") != "native-3d-compute-fluid-raymarch-v0":
        raise ValueError("destination-state corpus effective route mismatch")
    frame_documents = sorted(
        document.get("frames", []),
        key=lambda frame: int(frame.get("controlledStepFrameIndex", -1)),
    )
    indices = [int(frame.get("controlledStepFrameIndex", -1)) for frame in frame_documents]
    if len(frame_documents) < 2 or indices != list(range(len(frame_documents))):
        raise ValueError("destination-state corpus requires a contiguous multi-frame controlled episode")
    cadences = [float(frame.get("controlledStepDeltaMs", 160)) for frame in frame_documents]
    if (
        not math.isfinite(cadences[0])
        or cadences[0] <= 0
        or any(not math.isclose(value, cadences[0], rel_tol=0, abs_tol=1e-9) for value in cadences[1:])
    ):
        raise ValueError("destination-state corpus requires uniform controlled-step cadence")
    query = parse_qs(urlparse(document.get("requestedRoute", "")).query)
    grid_size = int(query.get("volume_resolution", [160])[0])
    if grid_size <= 0:
        raise ValueError("destination-state corpus grid size must be positive")
    receipt = {
        "path": str(path),
        "bytes": len(data),
        "sha256": CORE.sha256_bytes(data),
        "effectiveRoute": document["effectiveRoute"],
        "frameCount": len(frame_documents),
        "controlledStepDeltaMs": cadences[0],
    }
    frames = {
        frame["id"]: CORE.load_frame(frame, path.parent)
        for frame in frame_documents
    }
    return document, frame_documents, frames, 2.0 / grid_size, receipt


def build_adjacent_state_datasets(frame_documents, frames, grid_step, state_cohorts=None):
    reported_cohorts = tuple(state_cohorts or CORE.DESTINATION_STATE_COHORTS)
    datasets = []
    pair_reports = []
    for source_document, target_document in zip(frame_documents, frame_documents[1:]):
        dataset = CORE.build_destination_state_dataset(
            frames[source_document["id"]],
            frames[target_document["id"]],
            grid_step,
            state_cohorts=state_cohorts,
        )
        datasets.append(dataset)
        pair_reports.append({
            "sourceFrameId": source_document["id"],
            "targetFrameId": target_document["id"],
            "sampleCount": len(dataset["stateCohorts"]),
            "cohortCounts": {
                cohort: int(np.sum(dataset["stateCohorts"] == cohort))
                for cohort in reported_cohorts
            },
        })
    return datasets, pair_reports


def build_state_sampling_pools(cohorts, cohort_order):
    cohorts = np.asarray(cohorts)
    cohort_order = tuple(cohort_order)
    if not cohort_order or np.any(~np.isin(cohorts, cohort_order)):
        raise ValueError("state sampling received an unsupported cohort")
    pools = {cohort: np.flatnonzero(cohorts == cohort) for cohort in cohort_order}
    if any(not len(indices) for indices in pools.values()):
        raise ValueError("state sampling requires every configured cohort")
    return pools


def sample_state_balanced_indices(rng, pools, cohort_order, batch_size):
    cohort_order = tuple(cohort_order)
    if tuple(pools) != cohort_order or batch_size < len(cohort_order):
        raise ValueError("state sampling pools or batch size violate configured cohort balance")
    base, remainder = divmod(int(batch_size), len(cohort_order))
    sampled = []
    for cohort_index, cohort in enumerate(cohort_order):
        indices = pools[cohort]
        count = base + (1 if cohort_index < remainder else 0)
        sampled.append(rng.choice(indices, size=count, replace=True))
    result = np.concatenate(sampled).astype(np.int64)
    rng.shuffle(result)
    return result


def build_protected_rollout_datasets(
    datasets,
    frame_documents,
    frames,
    seed_model,
    seed_normalization,
    predicted_input_fraction,
    rollout_horizon,
    batch_size,
    rng,
):
    if len(datasets) != len(frame_documents) - 1:
        raise ValueError("protected rollout datasets must align with adjacent frame pairs")
    result = []
    pair_reports = []
    prior_appearance_by_key = {}
    total_eligible = 0
    total_exposed = 0
    for pair_index, dataset in enumerate(datasets):
        if pair_index % rollout_horizon == 0:
            prior_appearance_by_key = {}
        source_document = frame_documents[pair_index]
        target_document = frame_documents[pair_index + 1]
        source = frames[source_document["id"]]
        predicted_splats = dataset["stateBaselines"][:, len(CORE.FEATURES):].copy()
        eligible = np.zeros(len(predicted_splats), dtype=bool)
        for row_index, donor_index in enumerate(dataset["stateDonorIndices"]):
            donor_key = source["keys"][int(donor_index)]
            prior = prior_appearance_by_key.get(donor_key)
            if prior is not None:
                eligible[row_index] = True
                predicted_splats[row_index] = prior
        exposure_mask = eligible & (rng.random(len(eligible)) < predicted_input_fraction)
        exposed = apply_protected_splat_exposure(
            dataset["stateInputs"],
            dataset["stateBaselines"],
            dataset["stateTargets"],
            predicted_splats,
            exposure_mask,
        )
        exposed_dataset = {
            **dataset,
            "stateInputs": exposed["stateInputs"],
            "stateBaselines": exposed["stateBaselines"],
            "stateResidualTargets": exposed["stateResidualTargets"],
            "responseAnchorMask": exposed["responseAnchorMask"],
        }
        result.append(exposed_dataset)
        predicted_residuals = CORE.predict_destination_state_model(
            seed_model,
            exposed_dataset["stateInputs"],
            seed_normalization["inputMean"],
            seed_normalization["inputScale"],
            seed_normalization["residualMean"],
            seed_normalization["residualScale"],
            batch_size,
        )
        predicted_states = exposed_dataset["stateBaselines"] + predicted_residuals
        prior_appearance_by_key = {
            key: predicted_states[row_index, len(CORE.FEATURES):].copy()
            for row_index, key in enumerate(exposed_dataset["stateDestinationKeys"])
        }
        eligible_count = int(np.sum(eligible))
        exposed_count = int(np.sum(exposure_mask))
        total_eligible += eligible_count
        total_exposed += exposed_count
        pair_reports.append({
            "step": pair_index + 1,
            "sourceFrameId": source_document["id"],
            "targetFrameId": target_document["id"],
            "sequenceStep": pair_index % rollout_horizon,
            "sequenceReset": pair_index % rollout_horizon == 0,
            "sampleCount": len(exposure_mask),
            "eligiblePredictedInputCount": eligible_count,
            "predictedExposureCount": exposed_count,
            "candidateStateExposed": False,
        })
    return result, {
        "authority": "frozen-one-step-seed-protected-splat-scheduled-exposure-v0",
        "rolloutHorizon": int(rollout_horizon),
        "requestedPredictedInputFraction": float(predicted_input_fraction),
        "eligiblePredictedInputCount": total_eligible,
        "predictedExposureCount": total_exposed,
        "effectivePredictedInputFraction": total_exposed / max(1, total_eligible),
        "candidateStateExposed": False,
        "occupancyFeedbackEnabled": False,
        "pairReports": pair_reports,
        "sampleCap": None,
    }


def build_online_rollout_epoch_datasets(
    datasets,
    frame_documents,
    frames,
    current_model,
    seed_normalization,
    predicted_input_fraction,
    rollout_horizon,
    batch_size,
    rng,
    epoch_index,
    completed_optimizer_steps,
):
    if epoch_index < 1 or completed_optimizer_steps < 0:
        raise ValueError("online rollout epoch and optimizer steps must be non-negative and one-based")
    exposed_datasets, base_report = build_protected_rollout_datasets(
        datasets,
        frame_documents,
        frames,
        current_model,
        seed_normalization,
        predicted_input_fraction,
        rollout_horizon,
        batch_size,
        rng,
    )
    if base_report.get("sampleCap") is not None:
        raise ValueError("online rollout exposure forbids hidden sample caps")
    return exposed_datasets, {
        **base_report,
        "authority": "current-model-epoch-refresh-protected-splat-scheduled-exposure-v0",
        "modelSourceAuthority": "current-in-memory-model-v0",
        "currentModelCheckpoint": (
            "seed-initialization"
            if completed_optimizer_steps == 0
            else "post-optimizer-step"
        ),
        "epochIndex": int(epoch_index),
        "completedOptimizerSteps": int(completed_optimizer_steps),
        "fixedFrozenSeedGeneratorUsed": False,
    }


def attach_response_anchor_targets(
    datasets,
    anchor_model,
    anchor_normalization,
    batch_size,
    anchor_model_receipt,
    anchor_weight,
):
    model_sha256 = anchor_model_receipt.get("sha256")
    if not isinstance(model_sha256, str) or len(model_sha256) != 64:
        raise ValueError("response anchor model receipt requires a SHA-256 identity")
    if not math.isfinite(anchor_weight) or anchor_weight <= 0:
        raise ValueError("response anchor weight must be finite and positive")
    anchored = []
    total_anchor_samples = 0
    for dataset in datasets:
        state_inputs = np.asarray(dataset["stateInputs"], dtype=np.float32)
        anchor_mask = np.asarray(dataset.get("responseAnchorMask"), dtype=bool)
        if anchor_mask.shape != (len(state_inputs),):
            raise ValueError("response anchor mask must align with every exposed dataset row")
        normalized_anchor_targets = np.zeros(
            (len(state_inputs), CORE.DESTINATION_STATE_ATTRIBUTE_COUNT),
            dtype=np.float32,
        )
        anchor_count = int(np.sum(anchor_mask))
        if anchor_count:
            anchor_residuals = CORE.predict_destination_state_model(
                anchor_model,
                state_inputs[anchor_mask],
                anchor_normalization["inputMean"],
                anchor_normalization["inputScale"],
                anchor_normalization["residualMean"],
                anchor_normalization["residualScale"],
                batch_size,
            )
            normalized_anchor_targets[anchor_mask] = (
                (anchor_residuals - anchor_normalization["residualMean"])
                / anchor_normalization["residualScale"]
            ).astype(np.float32)
        anchored.append({
            **dataset,
            "responseAnchorMask": anchor_mask,
            "normalizedResponseAnchorTargets": normalized_anchor_targets,
        })
        total_anchor_samples += anchor_count
    return anchored, {
        "authority": "frozen-teacher-response-on-current-model-exposed-inputs-v0",
        "modelSha256": model_sha256,
        "weight": float(anchor_weight),
        "anchorSampleCount": total_anchor_samples,
        "sampleCap": None,
    }


def aggregate_response_anchor_receipts(
    epoch_reports,
    expected_epochs,
    expected_model_sha256,
    expected_weight,
):
    if expected_epochs < 1 or len(epoch_reports) != expected_epochs:
        raise ValueError("response anchor receipt must include every configured epoch")
    if [report.get("epochIndex") for report in epoch_reports] != list(range(1, expected_epochs + 1)):
        raise ValueError("response anchor receipt epoch indices are incomplete or unordered")
    for report in epoch_reports:
        if report.get("sampleCap") is not None:
            raise ValueError("response anchor evaluation must remain uncapped")
        if report.get("anchorSampleCount") != report.get("predictedExposureCount"):
            raise ValueError("response anchor must cover exactly every exposed row")
        if (
            report.get("authority") != "frozen-teacher-response-on-current-model-exposed-inputs-v0"
            or report.get("modelSha256") != expected_model_sha256
            or report.get("weight") != expected_weight
        ):
            raise ValueError("response anchor receipt changed teacher identity or loss weight")
    return {
        "authority": "epoch-refreshed-frozen-teacher-response-anchor-v0",
        "modelSha256": expected_model_sha256,
        "weight": float(expected_weight),
        "scope": "predicted-splat-exposure-rows-only",
        "epochCount": expected_epochs,
        "anchorSampleCount": sum(int(report["anchorSampleCount"]) for report in epoch_reports),
        "sampleCap": None,
        "epochReports": epoch_reports,
    }


def aggregate_online_rollout_exposure(
    epoch_reports,
    expected_epochs,
    expected_optimizer_steps_per_epoch,
):
    if expected_epochs < 1 or expected_optimizer_steps_per_epoch < 1 or len(epoch_reports) != expected_epochs:
        raise ValueError("online rollout receipt must include every configured epoch")
    expected_indices = list(range(1, expected_epochs + 1))
    if [report.get("epochIndex") for report in epoch_reports] != expected_indices:
        raise ValueError("online rollout receipt epoch indices are incomplete or unordered")
    optimizer_steps = [report.get("completedOptimizerSteps") for report in epoch_reports]
    expected_optimizer_steps = [
        epoch_index * expected_optimizer_steps_per_epoch
        for epoch_index in range(expected_epochs)
    ]
    if optimizer_steps != expected_optimizer_steps:
        raise ValueError("online rollout receipt optimizer steps do not prove current-model refresh")
    for report_index, report in enumerate(epoch_reports):
        expected_checkpoint = "seed-initialization" if report_index == 0 else "post-optimizer-step"
        if (
            report.get("authority") != "current-model-epoch-refresh-protected-splat-scheduled-exposure-v0"
            or report.get("modelSourceAuthority") != "current-in-memory-model-v0"
            or report.get("currentModelCheckpoint") != expected_checkpoint
            or report.get("fixedFrozenSeedGeneratorUsed") is not False
            or report.get("sampleCap") is not None
        ):
            raise ValueError("online rollout epoch report permits frozen, capped, or unverified exposure")
    eligible_count = sum(int(report["eligiblePredictedInputCount"]) for report in epoch_reports)
    exposed_count = sum(int(report["predictedExposureCount"]) for report in epoch_reports)
    return {
        "authority": "current-model-epoch-refreshed-protected-splat-scheduled-exposure-v0",
        "refreshCadence": "epoch",
        "modelSourceAuthority": "current-in-memory-model-v0",
        "firstRefreshCheckpoint": "seed-initialization",
        "subsequentRefreshCheckpoint": "post-optimizer-step",
        "optimizerStepsPerEpoch": expected_optimizer_steps_per_epoch,
        "epochCount": expected_epochs,
        "eligiblePredictedInputCount": eligible_count,
        "predictedExposureCount": exposed_count,
        "effectivePredictedInputFraction": exposed_count / max(1, eligible_count),
        "candidateStateExposed": False,
        "occupancyFeedbackEnabled": False,
        "fixedFrozenSeedGeneratorUsed": False,
        "epochReports": epoch_reports,
        "sampleCap": None,
    }


def prepare_training_arrays(datasets, normalization, training_cohorts):
    state_inputs = np.concatenate([dataset["stateInputs"] for dataset in datasets])
    state_baselines = np.concatenate([dataset["stateBaselines"] for dataset in datasets])
    state_targets = np.concatenate([dataset["stateTargets"] for dataset in datasets])
    residual_targets = np.concatenate([dataset["stateResidualTargets"] for dataset in datasets])
    cohorts = np.concatenate([dataset["stateCohorts"] for dataset in datasets])
    sampling_pools = build_state_sampling_pools(cohorts, training_cohorts)
    normalized_inputs = ((state_inputs - normalization["inputMean"]) / normalization["inputScale"]).astype(np.float32)
    normalized_targets = ((residual_targets - normalization["residualMean"]) / normalization["residualScale"]).astype(np.float32)
    prepared = {
        "stateInputs": state_inputs,
        "stateBaselines": state_baselines,
        "stateTargets": state_targets,
        "stateResidualTargets": residual_targets,
        "stateCohorts": cohorts,
        "samplingPools": sampling_pools,
        "normalizedInputs": normalized_inputs,
        "normalizedTargets": normalized_targets,
    }
    anchor_presence = ["normalizedResponseAnchorTargets" in dataset for dataset in datasets]
    if any(anchor_presence):
        if not all(anchor_presence):
            raise ValueError("response anchor targets must cover every epoch dataset")
        prepared["normalizedResponseAnchorTargets"] = np.concatenate([
            dataset["normalizedResponseAnchorTargets"] for dataset in datasets
        ]).astype(np.float32)
        prepared["responseAnchorMask"] = np.concatenate([
            dataset["responseAnchorMask"] for dataset in datasets
        ]).astype(np.float32)
        if (
            prepared["normalizedResponseAnchorTargets"].shape != normalized_targets.shape
            or prepared["responseAnchorMask"].shape != (len(cohorts),)
        ):
            raise ValueError("response anchor training arrays violate aligned state shape")
    return prepared


def visible_energy_mlx(states):
    luminance = (
        states[:, VISIBLE_ENERGY_COLOR_INDICES[0]] * 0.2126
        + states[:, VISIBLE_ENERGY_COLOR_INDICES[1]] * 0.7152
        + states[:, VISIBLE_ENERGY_COLOR_INDICES[2]] * 0.0722
    )
    return mx.maximum(states[:, VISIBLE_ENERGY_OPACITY_INDEX], 0) * mx.maximum(luminance, 0)


def rollout_destination_state_loss(
    model,
    inputs,
    normalized_targets,
    baselines,
    residual_mean,
    residual_scale,
    energy_scale,
    candidate_weight,
    splat_weight,
    energy_weight,
):
    normalized_predictions = model(inputs)
    squared = (normalized_predictions - normalized_targets) ** 2
    candidate_loss = mx.mean(squared[:, :len(CORE.FEATURES)])
    splat_loss = mx.mean(squared[:, len(CORE.FEATURES):])
    predicted_states = baselines + normalized_predictions * residual_scale + residual_mean
    target_states = baselines + normalized_targets * residual_scale + residual_mean
    energy_loss = mx.mean(
        ((visible_energy_mlx(predicted_states) - visible_energy_mlx(target_states)) / energy_scale) ** 2,
    )
    total = candidate_weight * candidate_loss + splat_weight * splat_loss + energy_weight * energy_loss
    return total, (candidate_loss, splat_loss, energy_loss)


def anchored_rollout_destination_state_loss(
    model,
    inputs,
    normalized_targets,
    baselines,
    residual_mean,
    residual_scale,
    energy_scale,
    candidate_weight,
    splat_weight,
    energy_weight,
    normalized_response_anchor_targets,
    response_anchor_mask,
    response_anchor_weight,
):
    normalized_predictions = model(inputs)
    squared = (normalized_predictions - normalized_targets) ** 2
    candidate_loss = mx.mean(squared[:, :len(CORE.FEATURES)])
    splat_loss = mx.mean(squared[:, len(CORE.FEATURES):])
    predicted_states = baselines + normalized_predictions * residual_scale + residual_mean
    target_states = baselines + normalized_targets * residual_scale + residual_mean
    energy_loss = mx.mean(
        ((visible_energy_mlx(predicted_states) - visible_energy_mlx(target_states)) / energy_scale) ** 2,
    )
    anchor_squared = (normalized_predictions - normalized_response_anchor_targets) ** 2
    anchor_numerator = mx.sum(anchor_squared * response_anchor_mask[:, None])
    anchor_denominator = mx.maximum(
        mx.sum(response_anchor_mask) * CORE.DESTINATION_STATE_ATTRIBUTE_COUNT,
        mx.array(1.0),
    )
    response_anchor_loss = anchor_numerator / anchor_denominator
    total = (
        candidate_weight * candidate_loss
        + splat_weight * splat_loss
        + energy_weight * energy_loss
        + response_anchor_weight * response_anchor_loss
    )
    return total, (candidate_loss, splat_loss, energy_loss, response_anchor_loss)


def combine_metric_scopes(metric_documents, scope):
    sample_count = sum(document[scope]["sampleCount"] for document in metric_documents)
    if sample_count <= 0:
        raise ValueError("destination-state metric aggregation requires samples")
    weighted_fields = (
        "carriedDonorMse", "predictionMse",
        "candidateCarriedDonorMse", "candidatePredictionMse",
        "splatCarriedDonorMse", "splatPredictionMse",
    )
    combined = {"sampleCount": sample_count}
    for field in weighted_fields:
        combined[field] = sum(
            document[scope][field] * document[scope]["sampleCount"]
            for document in metric_documents
        ) / sample_count
    combined["predictionToDonorMseRatio"] = (
        combined["predictionMse"] / max(combined["carriedDonorMse"], 1e-12)
    )
    combined["beatsCarriedDonor"] = combined["predictionMse"] < combined["carriedDonorMse"]
    return combined


def combine_evaluation_metrics(pair_metrics):
    aggregate_documents = [document for document in pair_metrics]
    cohort_metrics = {}
    for cohort in CORE.DESTINATION_STATE_COHORTS:
        cohort_documents = [{cohort: document["cohorts"][cohort]} for document in pair_metrics]
        cohort_metrics[cohort] = combine_metric_scopes(cohort_documents, cohort)
    aggregate = combine_metric_scopes(
        [{"aggregate": document["aggregate"]} for document in aggregate_documents],
        "aggregate",
    )
    return {
        "authority": "full-cross-episode-state-mse-versus-carried-donor-v0",
        "normalizationAuthority": "training-residual-channel-standard-deviation-v0",
        "evaluatedPairCount": len(pair_metrics),
        "aggregate": aggregate,
        "cohorts": cohort_metrics,
        "allCohortsBeatCarriedDonor": all(
            cohort_metrics[cohort]["beatsCarriedDonor"]
            for cohort in CORE.DESTINATION_STATE_COHORTS
        ),
        "aggregateMayCloseCohortClaim": False,
    }


def evaluate_cross_episode(
    model,
    frame_documents,
    frames,
    grid_step,
    input_mean,
    input_scale,
    residual_mean,
    residual_scale,
    batch_size,
):
    pair_reports = []
    pair_metrics = []
    for pair_index, (source_document, target_document) in enumerate(zip(frame_documents, frame_documents[1:]), start=1):
        dataset = CORE.build_destination_state_dataset(
            frames[source_document["id"]],
            frames[target_document["id"]],
            grid_step,
        )
        predicted_residuals = CORE.predict_destination_state_model(
            model,
            dataset["stateInputs"],
            input_mean,
            input_scale,
            residual_mean,
            residual_scale,
            batch_size,
        )
        predictions = dataset["stateBaselines"] + predicted_residuals
        metrics = CORE.summarize_destination_state_metrics(
            dataset["stateBaselines"],
            predictions,
            dataset["stateTargets"],
            dataset["stateCohorts"],
            residual_scale,
        )
        pair_metrics.append(metrics)
        pair_reports.append({
            "step": pair_index,
            "sourceFrameId": source_document["id"],
            "targetFrameId": target_document["id"],
            "sampleCount": len(dataset["stateCohorts"]),
            "metrics": metrics,
        })
    return combine_evaluation_metrics(pair_metrics), pair_reports


def main(argv=None):
    args = parse_args(argv)
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / "destination-state-training-report.json"
    started_at = time.time()
    failure_phase = "argument-validation"
    last_trustworthy = {
        "trainingManifestPath": str(Path(args.training_manifest).resolve()),
        "evaluationManifestPath": str(Path(args.evaluation_manifest).resolve()),
        "requestedEpochs": args.epochs,
        "requestedBatchSize": args.batch_size,
        "requestedTrainingMode": args.training_mode,
        "requestedRolloutHorizon": args.rollout_horizon,
        "requestedPredictedInputFraction": args.predicted_input_fraction,
        "requestedResponseAnchorModel": args.response_anchor_model,
        "requestedResponseAnchorWeight": args.response_anchor_weight,
    }
    def checkpoint(phase):
        nonlocal failure_phase
        failure_phase = phase
        CORE.write_json(report_path, build_running_report(started_at, phase, last_trustworthy))

    checkpoint("training-manifest-validation")
    try:
        if args.hidden_size < 1 or args.epochs < 1:
            raise ValueError("model and epoch dimensions must be positive")
        training_config = validate_rollout_training_config(
            args.training_mode,
            args.rollout_seed_model,
            args.rollout_horizon,
            args.predicted_input_fraction,
            args.candidate_loss_weight,
            args.splat_loss_weight,
            args.energy_loss_weight,
            args.response_anchor_model,
            args.response_anchor_weight,
        )
        training_cohorts = (
            ROLLOUT_STATE_COHORTS
            if args.training_mode in ROLLOUT_TRAINING_MODES
            else CORE.DESTINATION_STATE_COHORTS
        )
        if args.batch_size < len(training_cohorts):
            raise ValueError("batch size must cover every configured state cohort")
        _, training_documents, training_frames, training_grid_step, training_receipt = load_corpus_manifest(
            args.training_manifest,
        )
        last_trustworthy["trainingManifestSha256"] = training_receipt["sha256"]
        checkpoint("evaluation-manifest-validation")
        _, evaluation_documents, evaluation_frames, evaluation_grid_step, evaluation_receipt = load_corpus_manifest(
            args.evaluation_manifest,
        )
        last_trustworthy["evaluationManifestSha256"] = evaluation_receipt["sha256"]
        validate_manifest_roles(training_receipt, evaluation_receipt)
        if not math.isclose(training_grid_step, evaluation_grid_step, rel_tol=0, abs_tol=1e-12):
            raise ValueError("training and evaluation corpus grid steps differ")
        checkpoint("route-validation")
        route = validate_training_route(str(mx.default_device()), fallback_reason=None)
        last_trustworthy.update({
            "effectiveBackend": route["backend"],
            "effectiveDevice": route["device"],
            "fallbackReason": route["fallbackReason"],
        })

        checkpoint("training-dataset-construction")
        datasets, training_pairs = build_adjacent_state_datasets(
            training_documents,
            training_frames,
            training_grid_step,
            state_cohorts=training_cohorts,
        )
        rollout_seed_model = None
        rollout_seed_normalization = None
        rollout_seed_receipt = None
        response_anchor_model = None
        response_anchor_normalization = None
        response_anchor_model_receipt = None
        response_anchor_receipt = None
        rollout_exposure = None
        rng = np.random.default_rng(args.seed)
        raw_datasets = datasets
        if args.training_mode in ROLLOUT_TRAINING_MODES:
            checkpoint("rollout-seed-model-validation")
            rollout_seed_model, rollout_seed_normalization, rollout_seed_receipt = load_rollout_seed_model(
                args.rollout_seed_model,
            )
            if rollout_seed_normalization["hiddenSize"] != args.hidden_size:
                raise ValueError("rollout seed model hidden size must match requested training capacity")
            last_trustworthy["rolloutSeedModelSha256"] = rollout_seed_receipt["sha256"]
            last_trustworthy["rolloutSeedRoute"] = rollout_seed_receipt["route"]
            last_trustworthy["rolloutSeedFallbackReason"] = rollout_seed_receipt["route"]["fallbackReason"]
        if args.training_mode == ANCHORED_ROLLOUT_TRAINING_MODE:
            checkpoint("response-anchor-model-validation")
            (
                response_anchor_model,
                response_anchor_normalization,
                response_anchor_model_receipt,
            ) = load_rollout_seed_model(args.response_anchor_model)
            if response_anchor_normalization["hiddenSize"] != args.hidden_size:
                raise ValueError("response anchor model hidden size must match requested training capacity")
            for field in ("inputMean", "inputScale", "residualMean", "residualScale"):
                if not np.array_equal(response_anchor_normalization[field], rollout_seed_normalization[field]):
                    raise ValueError("response anchor normalization must exactly match the rollout seed")
            last_trustworthy.update({
                "responseAnchorModelSha256": response_anchor_model_receipt["sha256"],
                "responseAnchorRoute": response_anchor_model_receipt["route"],
                "responseAnchorFallbackReason": response_anchor_model_receipt["route"]["fallbackReason"],
            })
        if args.training_mode == "protected-rollout":
            checkpoint("protected-rollout-dataset-construction")
            datasets, rollout_exposure = build_protected_rollout_datasets(
                raw_datasets,
                training_documents,
                training_frames,
                rollout_seed_model,
                rollout_seed_normalization,
                args.predicted_input_fraction,
                args.rollout_horizon,
                args.batch_size,
                rng,
            )
            last_trustworthy.update({
                "eligiblePredictedInputCount": rollout_exposure["eligiblePredictedInputCount"],
                "predictedExposureCount": rollout_exposure["predictedExposureCount"],
                "effectivePredictedInputFraction": rollout_exposure["effectivePredictedInputFraction"],
            })
        normalization_datasets = datasets if args.training_mode == "protected-rollout" else raw_datasets
        state_inputs = np.concatenate([dataset["stateInputs"] for dataset in normalization_datasets])
        state_targets = np.concatenate([dataset["stateTargets"] for dataset in normalization_datasets])
        residual_targets = np.concatenate([dataset["stateResidualTargets"] for dataset in normalization_datasets])
        normalization = resolve_training_normalization(
            args.training_mode,
            state_inputs,
            residual_targets,
            rollout_seed_normalization,
        )
        input_mean = normalization["inputMean"]
        input_scale = normalization["inputScale"]
        residual_mean = normalization["residualMean"]
        residual_scale = normalization["residualScale"]
        prepared = prepare_training_arrays(normalization_datasets, normalization, training_cohorts)
        cohorts = prepared["stateCohorts"]
        target_energy = visible_energy_numpy(state_targets)
        energy_scale = max(float(np.sqrt(np.mean(target_energy ** 2, dtype=np.float64))), 1e-6)
        last_trustworthy.update({
            "trainingPairCount": len(training_pairs),
            "trainingSampleCount": len(cohorts),
            "trainingCohortCounts": {
                cohort: int(np.sum(cohorts == cohort))
                for cohort in training_cohorts
            },
        })

        checkpoint("model-training")
        mx.random.seed(args.seed)
        model = rollout_seed_model if rollout_seed_model is not None else CORE.DestinationStateModel(args.hidden_size)
        mx.eval(model.parameters())
        optimizer = optim.AdamW(learning_rate=args.learning_rate, weight_decay=args.weight_decay)
        if args.training_mode == ANCHORED_ROLLOUT_TRAINING_MODE:
            loss_function = anchored_rollout_destination_state_loss
        elif args.training_mode in ROLLOUT_TRAINING_MODES:
            loss_function = rollout_destination_state_loss
        else:
            loss_function = CORE.destination_state_loss
        loss_and_grad = nn.value_and_grad(model, loss_function)
        steps_per_epoch = math.ceil(len(cohorts) / args.batch_size)
        step_count = steps_per_epoch * args.epochs
        losses = []
        online_epoch_reports = []
        response_anchor_epoch_reports = []
        completed_optimizer_steps = 0
        for epoch_index in range(1, args.epochs + 1):
            if args.training_mode in ONLINE_ROLLOUT_TRAINING_MODES:
                checkpoint(f"online-rollout-epoch-{epoch_index}-dataset-construction")
                epoch_datasets, epoch_report = build_online_rollout_epoch_datasets(
                    raw_datasets,
                    training_documents,
                    training_frames,
                    current_model=model,
                    seed_normalization=rollout_seed_normalization,
                    predicted_input_fraction=args.predicted_input_fraction,
                    rollout_horizon=args.rollout_horizon,
                    batch_size=args.batch_size,
                    rng=rng,
                    epoch_index=epoch_index,
                    completed_optimizer_steps=completed_optimizer_steps,
                )
                if args.training_mode == ANCHORED_ROLLOUT_TRAINING_MODE:
                    checkpoint(f"anchored-online-rollout-epoch-{epoch_index}-teacher-response")
                    epoch_datasets, anchor_epoch_report = attach_response_anchor_targets(
                        epoch_datasets,
                        response_anchor_model,
                        response_anchor_normalization,
                        args.batch_size,
                        response_anchor_model_receipt,
                        args.response_anchor_weight,
                    )
                    anchor_epoch_report.update({
                        "epochIndex": epoch_index,
                        "predictedExposureCount": epoch_report["predictedExposureCount"],
                    })
                    response_anchor_epoch_reports.append(anchor_epoch_report)
                    epoch_report["responseAnchor"] = anchor_epoch_report
                prepared = prepare_training_arrays(epoch_datasets, normalization, training_cohorts)
                if len(prepared["stateCohorts"]) != len(cohorts):
                    raise ValueError("online rollout epoch changed the canonical training population")
                online_epoch_reports.append(epoch_report)
                last_trustworthy.update({
                    "onlineRolloutCompletedEpochs": len(online_epoch_reports),
                    "onlineRolloutCurrentEpoch": epoch_index,
                    "onlineRolloutCompletedOptimizerSteps": completed_optimizer_steps,
                    "onlineRolloutCurrentEpochEligiblePredictedInputCount": epoch_report["eligiblePredictedInputCount"],
                    "onlineRolloutCurrentEpochPredictedExposureCount": epoch_report["predictedExposureCount"],
                })
            for _ in range(steps_per_epoch):
                step = completed_optimizer_steps
                indices = sample_state_balanced_indices(
                    rng,
                    prepared["samplingPools"],
                    training_cohorts,
                    args.batch_size,
                )
                if args.training_mode == ANCHORED_ROLLOUT_TRAINING_MODE:
                    (loss, components), gradients = loss_and_grad(
                        model,
                        mx.array(prepared["normalizedInputs"][indices]),
                        mx.array(prepared["normalizedTargets"][indices]),
                        mx.array(prepared["stateBaselines"][indices]),
                        mx.array(residual_mean),
                        mx.array(residual_scale),
                        mx.array(energy_scale),
                        args.candidate_loss_weight,
                        args.splat_loss_weight,
                        args.energy_loss_weight,
                        mx.array(prepared["normalizedResponseAnchorTargets"][indices]),
                        mx.array(prepared["responseAnchorMask"][indices]),
                        args.response_anchor_weight,
                    )
                elif args.training_mode in ROLLOUT_TRAINING_MODES:
                    (loss, components), gradients = loss_and_grad(
                        model,
                        mx.array(prepared["normalizedInputs"][indices]),
                        mx.array(prepared["normalizedTargets"][indices]),
                        mx.array(prepared["stateBaselines"][indices]),
                        mx.array(residual_mean),
                        mx.array(residual_scale),
                        mx.array(energy_scale),
                        args.candidate_loss_weight,
                        args.splat_loss_weight,
                        args.energy_loss_weight,
                    )
                else:
                    loss, gradients = loss_and_grad(
                        model,
                        mx.array(prepared["normalizedInputs"][indices]),
                        mx.array(prepared["normalizedTargets"][indices]),
                    )
                    components = None
                optimizer.update(model, gradients)
                if components is None:
                    mx.eval(model.parameters(), optimizer.state, loss)
                else:
                    mx.eval(model.parameters(), optimizer.state, loss, *components)
                completed_optimizer_steps += 1
                if step == 0 or completed_optimizer_steps == step_count or completed_optimizer_steps % steps_per_epoch == 0:
                    loss_row = {"step": completed_optimizer_steps, "total": float(loss.item())}
                    if components is None:
                        loss_row["mse"] = loss_row["total"]
                    else:
                        loss_row.update({
                            "candidate": float(components[0].item()),
                            "splat": float(components[1].item()),
                            "visibleEnergy": float(components[2].item()),
                        })
                        if len(components) == 4:
                            loss_row["responseAnchor"] = float(components[3].item())
                    losses.append(loss_row)
        if args.training_mode in ONLINE_ROLLOUT_TRAINING_MODES:
            rollout_exposure = aggregate_online_rollout_exposure(
                online_epoch_reports,
                args.epochs,
                steps_per_epoch,
            )
            last_trustworthy.update({
                "eligiblePredictedInputCount": rollout_exposure["eligiblePredictedInputCount"],
                "predictedExposureCount": rollout_exposure["predictedExposureCount"],
                "effectivePredictedInputFraction": rollout_exposure["effectivePredictedInputFraction"],
                "onlineRolloutCompletedOptimizerSteps": completed_optimizer_steps,
            })
        if args.training_mode == ANCHORED_ROLLOUT_TRAINING_MODE:
            response_anchor_receipt = aggregate_response_anchor_receipts(
                response_anchor_epoch_reports,
                args.epochs,
                response_anchor_model_receipt["sha256"],
                args.response_anchor_weight,
            )
            last_trustworthy["responseAnchorSampleCount"] = response_anchor_receipt["anchorSampleCount"]

        checkpoint("cross-episode-evaluation")
        evaluation_metrics, evaluation_pairs = evaluate_cross_episode(
            model,
            evaluation_documents,
            evaluation_frames,
            evaluation_grid_step,
            input_mean,
            input_scale,
            residual_mean,
            residual_scale,
            args.batch_size,
        )
        checkpoint("model-write")
        model_document = {
            "schema": CORE.DESTINATION_STATE_MODEL_SCHEMA,
            "status": "completed",
            "route": route,
            "trainingManifest": training_receipt,
            "evaluationManifest": evaluation_receipt,
            "input": {
                "authority": INPUT_AUTHORITY,
                "featureCount": CORE.DESTINATION_STATE_INPUT_COUNT,
                "destinationLocalGridFeatureCount": 64,
                "selectedDonorAttributeCount": CORE.DESTINATION_STATE_ATTRIBUTE_COUNT,
                "selectedDonorDisplacementCount": CORE.DEATH_CLASS,
                "mean": input_mean.tolist(),
                "scale": input_scale.tolist(),
            },
            "output": {
                "authority": OUTPUT_AUTHORITY,
                "attributeCount": CORE.DESTINATION_STATE_ATTRIBUTE_COUNT,
                "attributeOrder": list(CORE.FEATURES) + list(SPLAT_ATTRIBUTE_ORDER),
                "residualMean": residual_mean.tolist(),
                "residualScale": residual_scale.tolist(),
            },
            "architecture": {
                "authority": ARCHITECTURE_AUTHORITY,
                "layers": [
                    CORE.model_layer(model.trunk_a, "destination-state-trunk-a", "relu"),
                    CORE.model_layer(model.trunk_b, "destination-state-trunk-b", "relu"),
                    CORE.model_layer(model.residual, "destination-state-residual-head", "linear"),
                ],
            },
            "training": {
                "samplingAuthority": "uniform-with-replacement-across-configured-state-cohorts-v0",
                "supportAssignmentAuthority": "exact-training-correspondence-and-local-birth-donor-v0",
                "trainedCohorts": list(training_cohorts),
                "distribution": training_config,
                "rolloutSeedModel": rollout_seed_receipt,
                "rolloutExposure": rollout_exposure,
                "responseAnchorModel": response_anchor_model_receipt,
                "responseAnchor": response_anchor_receipt,
                "loss": build_training_loss_receipt(training_config, energy_scale),
                "normalizationAuthority": normalization["authority"],
                "sampleCount": len(cohorts),
                "pairCount": len(training_pairs),
                "pairReports": training_pairs,
                "cohortCounts": last_trustworthy["trainingCohortCounts"],
                "hiddenSize": args.hidden_size,
                "epochs": args.epochs,
                "stepsPerEpoch": steps_per_epoch,
                "stepCount": step_count,
                "batchSize": args.batch_size,
                "learningRate": args.learning_rate,
                "weightDecay": args.weight_decay,
                "seed": args.seed,
                "losses": losses,
                "sampleCap": None,
                "timeout": None,
            },
            "evaluation": evaluation_metrics,
            "claimBoundary": (
                "offline cross-episode destination-state residual prediction after exact heldout support and donor assignment; "
                + (
                    "training rebuilds bounded predicted splat exposure from the current in-memory model before every epoch and anchors frozen-teacher responses on every exposed input with canonical candidate state and explicit energy loss; "
                    if args.training_mode == ANCHORED_ROLLOUT_TRAINING_MODE
                    else (
                        "training rebuilds bounded predicted splat exposure from the current in-memory model before every epoch with canonical candidate state and explicit energy loss; "
                        if args.training_mode == "protected-online-rollout"
                        else (
                            "training includes bounded frozen-seed predicted splat exposure with canonical candidate state and explicit energy loss; "
                            if args.training_mode == "protected-rollout"
                            else "training uses adjacent-pair teacher forcing; "
                        )
                    )
                )
                + "does not modify the deployed occupancy model or prove long-horizon recurrent stability"
            ),
        }
        model_path = out_dir / "destination-state-model.json"
        CORE.write_json(model_path, model_document)
        checkpoint("report-write")
        report = {
            "schema": REPORT_SCHEMA,
            "status": "completed",
            "startedAt": started_at,
            "completedAt": time.time(),
            "route": route,
            "trainingManifest": training_receipt,
            "evaluationManifest": evaluation_receipt,
            "model": {
                "path": str(model_path),
                "bytes": model_path.stat().st_size,
                "sha256": CORE.sha256_bytes(model_path.read_bytes()),
                "schema": CORE.DESTINATION_STATE_MODEL_SCHEMA,
            },
            "training": model_document["training"],
            "evaluation": evaluation_metrics,
            "evaluationPairs": evaluation_pairs,
            "claimBoundary": model_document["claimBoundary"],
        }
        CORE.write_json(report_path, report)
        print(json.dumps(report, indent=2))
    except Exception as error:
        failure_report = build_failure_report(started_at, failure_phase, error, last_trustworthy)
        CORE.write_json(report_path, failure_report)
        print(json.dumps(failure_report, indent=2), file=sys.stderr)
        raise


if __name__ == "__main__":
    main()
