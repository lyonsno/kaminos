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
SPLAT_ATTRIBUTE_ORDER = (
    "splat.scale.x", "splat.scale.y", "splat.scale.z",
    "splat.color.r", "splat.color.g", "splat.color.b",
    "splat.opacity", "splat.rotation.x", "splat.rotation.y",
)


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
    return parser.parse_args(argv)


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
        "controlledStepDeltaMs": int(frame_documents[0].get("controlledStepDeltaMs", 160)),
    }
    frames = {
        frame["id"]: CORE.load_frame(frame, path.parent)
        for frame in frame_documents
    }
    return document, frame_documents, frames, 2.0 / grid_size, receipt


def build_adjacent_state_datasets(frame_documents, frames, grid_step):
    datasets = []
    pair_reports = []
    for source_document, target_document in zip(frame_documents, frame_documents[1:]):
        dataset = CORE.build_destination_state_dataset(
            frames[source_document["id"]],
            frames[target_document["id"]],
            grid_step,
        )
        datasets.append(dataset)
        pair_reports.append({
            "sourceFrameId": source_document["id"],
            "targetFrameId": target_document["id"],
            "sampleCount": len(dataset["stateCohorts"]),
            "cohortCounts": {
                cohort: int(np.sum(dataset["stateCohorts"] == cohort))
                for cohort in CORE.DESTINATION_STATE_COHORTS
            },
        })
    return datasets, pair_reports


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
    }
    def checkpoint(phase):
        nonlocal failure_phase
        failure_phase = phase
        CORE.write_json(report_path, build_running_report(started_at, phase, last_trustworthy))

    checkpoint("training-manifest-validation")
    try:
        if args.hidden_size < 1 or args.epochs < 1 or args.batch_size < len(CORE.DESTINATION_STATE_COHORTS):
            raise ValueError("model, epoch, and batch dimensions must be positive and cover every state cohort")
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
        )
        state_inputs = np.concatenate([dataset["stateInputs"] for dataset in datasets])
        residual_targets = np.concatenate([dataset["stateResidualTargets"] for dataset in datasets])
        cohorts = np.concatenate([dataset["stateCohorts"] for dataset in datasets])
        sampling_pools = CORE.build_destination_state_sampling_pools(cohorts)
        input_mean = np.mean(state_inputs, axis=0, dtype=np.float64).astype(np.float32)
        input_scale = np.std(state_inputs, axis=0, dtype=np.float64).astype(np.float32)
        input_scale[input_scale < 1e-6] = 1.0
        residual_mean = np.mean(residual_targets, axis=0, dtype=np.float64).astype(np.float32)
        residual_scale = np.std(residual_targets, axis=0, dtype=np.float64).astype(np.float32)
        residual_scale[residual_scale < 1e-6] = 1.0
        normalized_inputs = ((state_inputs - input_mean) / input_scale).astype(np.float32)
        normalized_targets = ((residual_targets - residual_mean) / residual_scale).astype(np.float32)
        last_trustworthy.update({
            "trainingPairCount": len(training_pairs),
            "trainingSampleCount": len(cohorts),
            "trainingCohortCounts": {
                cohort: int(np.sum(cohorts == cohort))
                for cohort in CORE.DESTINATION_STATE_COHORTS
            },
        })

        checkpoint("model-training")
        rng = np.random.default_rng(args.seed)
        mx.random.seed(args.seed)
        model = CORE.DestinationStateModel(args.hidden_size)
        mx.eval(model.parameters())
        optimizer = optim.AdamW(learning_rate=args.learning_rate, weight_decay=args.weight_decay)
        loss_and_grad = nn.value_and_grad(model, CORE.destination_state_loss)
        steps_per_epoch = math.ceil(len(cohorts) / args.batch_size)
        step_count = steps_per_epoch * args.epochs
        losses = []
        for step in range(step_count):
            indices = CORE.sample_destination_state_balanced_indices(
                rng,
                sampling_pools,
                args.batch_size,
            )
            loss, gradients = loss_and_grad(
                model,
                mx.array(normalized_inputs[indices]),
                mx.array(normalized_targets[indices]),
            )
            optimizer.update(model, gradients)
            mx.eval(model.parameters(), optimizer.state, loss)
            if step == 0 or step == step_count - 1 or (step + 1) % steps_per_epoch == 0:
                losses.append({"step": step + 1, "mse": float(loss.item())})

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
                "samplingAuthority": "uniform-with-replacement-across-q3-q4-transported-birth-v0",
                "supportAssignmentAuthority": "exact-training-correspondence-and-local-birth-donor-v0",
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
                "does not yet apply state residuals to predicted support or modify the deployed occupancy model"
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
