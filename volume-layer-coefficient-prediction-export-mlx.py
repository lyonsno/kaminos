#!/usr/bin/env python3
"""Export checksum-bound learned layer coefficients for an exact held simulator state."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import tempfile
import time
from pathlib import Path
from typing import Any


OVERLAY_SCHEMA = "kaminos.volume.layer-coefficient-prediction-overlay.v0"
REPORT_SCHEMA = "kaminos.volume.layer-coefficient-prediction-export-report.v0"
AUTHORITY = "learned-post-admission-coefficient-prediction-v0"
FAILURE_SCHEMA = "kaminos.volume.layer-coefficient-prediction-export-failure.v0"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=path.parent, delete=False, encoding="utf-8") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.write("\n")
        temporary = Path(handle.name)
    os.replace(temporary, path)


def canonical_identity(value: dict[str, Any]) -> str:
    identity_payload = dict(value)
    identity_payload.pop("identity", None)
    identity_payload.pop("elapsedSeconds", None)
    payload = json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def load_learner() -> Any:
    path = Path(__file__).with_name("volume-layer-coefficient-learner-mlx.py")
    spec = importlib.util.spec_from_file_location("kaminos_layer_coefficient_learner", path)
    require(spec is not None and spec.loader is not None, f"cannot load learner module at {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_artifact(base_path: Path, artifact: Any, label: str) -> Path:
    require(isinstance(artifact, dict), f"{label} artifact receipt is missing")
    raw_path = artifact.get("path")
    require(isinstance(raw_path, str) and raw_path, f"{label} artifact path is missing")
    path = Path(raw_path).expanduser()
    path = path.resolve() if path.is_absolute() else (base_path.parent / path).resolve()
    require(path.is_file(), f"{label} artifact is missing at {path}")
    require(path.stat().st_size > 0, f"{label} artifact is blank")
    require(artifact.get("bytes") == path.stat().st_size, f"{label} artifact byte count differs")
    require(artifact.get("sha256") == sha256_file(path), f"{label} artifact sha256 differs")
    return path


def source_hashes(state: dict[str, Any]) -> dict[str, str]:
    value = state["rows"]["kernelDescriptors"].get("sourceHashes")
    expected = {"fluidSha256", "frontSha256", "boundarySidecarSha256", "majorantSha256"}
    require(isinstance(value, dict) and set(value) == expected, "state source hashes are incomplete")
    for name, digest in value.items():
        require(isinstance(digest, str) and len(digest) == 64, f"state source hash {name} is invalid")
    return dict(value)


def validate_training_contract(
    manifest: dict[str, Any],
    manifest_path: Path,
    report: dict[str, Any],
    report_path: Path,
    arm: str,
    state_id: str | None,
) -> dict[str, Any]:
    learner = load_learner()
    manifest_bytes = manifest_path.read_bytes()
    require(manifest.get("schema") == learner.MANIFEST_SCHEMA, "training manifest schema drifted")
    require(manifest.get("status") == "complete", "training manifest is not complete")
    require(manifest.get("authority") == learner.TRAINING_AUTHORITY, "training authority drifted")
    require(report.get("schema") == learner.TRAINING_RESULT_SCHEMA, "training report schema drifted")
    require(report.get("status") == "trained" and report.get("failurePhase") is None, "training report is not a completed model receipt")
    require(report.get("backend") == "mlx", "training report backend is not MLX")
    source = report.get("source")
    require(isinstance(source, dict), "training report source receipt is missing")
    require(source.get("manifestIdentity") == manifest.get("identity"), "training report corpus identity differs")
    require(source.get("manifestSha256") == hashlib.sha256(manifest_bytes).hexdigest(), "training report corpus sha256 differs")
    pairing = report.get("settings", {}).get("descriptorPairing")
    require(isinstance(pairing, dict) and pairing.get("mode") == "paired", "prediction export refuses unpaired descriptor training")
    require(arm in {"baseline", "treatment"}, f"unknown arm {arm}")
    arm_receipt = report.get("arms", {}).get(arm)
    require(isinstance(arm_receipt, dict), f"training report arm {arm} is missing")
    architecture = arm_receipt.get("architecture")
    require(isinstance(architecture, dict), f"training report arm {arm} architecture is missing")
    expected_architecture = learner.BASELINE_ARCHITECTURE_IDENTITY if arm == "baseline" else learner.TREATMENT_ARCHITECTURE_IDENTITY
    require(architecture.get("identity") == expected_architecture, f"training report arm {arm} architecture drifted")
    require(architecture.get("trainableParameters") == learner.TRAINABLE_PARAMETER_COUNT, "training model parameter count drifted")
    model_path = resolve_artifact(report_path, arm_receipt.get("modelArtifact"), f"{arm} model")
    states = manifest.get("states")
    require(isinstance(states, list) and states, "training manifest states are missing")
    candidates = [state for state in states if state.get("id") == state_id] if state_id else [state for state in states if state.get("splitRole") == "heldOut"]
    require(len(candidates) == 1, "prediction export requires exactly one selected held simulator state")
    state = candidates[0]
    require(state.get("splitRole") == "heldOut", "prediction export is held-state only")
    rows = state.get("rows")
    require(isinstance(rows, dict), "selected state row receipt is missing")
    count = rows.get("count")
    require(isinstance(count, int) and count > 0, "selected state row count is invalid")
    feature_count = len(manifest.get("featureView", {}).get("order", []))
    require(feature_count == 24, "selected state shared feature count drifted")
    producer_order = manifest.get("descriptorComparison", {}).get("producer", {}).get("descriptorOrder")
    treatment_order = manifest.get("descriptorComparison", {}).get("treatment", {}).get("order")
    require(treatment_order == learner.DEFAULT_DESCRIPTOR_CHANNELS, "treatment descriptor order drifted")
    require(isinstance(producer_order, list) and len(producer_order) == learner.DESCRIPTOR_STRIDE_FLOATS, "producer descriptor ABI drifted")
    producer_indices = {name: index for index, name in enumerate(producer_order)}
    descriptor_indices = [producer_indices[name] for name in treatment_order]
    features_path = resolve_artifact(manifest_path, rows.get("features"), "held features")
    descriptors_path = resolve_artifact(manifest_path, rows.get("kernelDescriptors"), "held kernel descriptors")
    require(rows["features"].get("dtype") == "float32-le" and rows["features"].get("shape") == [count, feature_count], "held feature tensor contract drifted")
    require(rows["kernelDescriptors"].get("dtype") == "float32-le" and rows["kernelDescriptors"].get("shape") == [count, learner.DESCRIPTOR_STRIDE_FLOATS], "held descriptor tensor contract drifted")
    normalization = arm_receipt.get("normalization")
    expected_input_count = feature_count if arm == "baseline" else feature_count + len(descriptor_indices)
    require(isinstance(normalization, dict), "training normalization receipt is missing")
    require(len(normalization.get("featureMean", [])) == expected_input_count, "normalization mean shape drifted")
    require(len(normalization.get("featureStd", [])) == expected_input_count, "normalization std shape drifted")
    require(len(normalization.get("targetScale", [])) == len(learner.COEFFICIENT_ORDER), "normalization target scale shape drifted")
    descriptor_group = report.get("settings", {}).get("descriptorGroup", {})
    if arm == "treatment":
        require(descriptor_group.get("identity") == learner.DESCRIPTOR_GROUP_IDENTITY, "descriptor group identity drifted")
        require(descriptor_group.get("mode") in learner.DESCRIPTOR_GROUPS, "descriptor group mode drifted")
    return {
        "learner": learner,
        "state": state,
        "count": count,
        "featureCount": feature_count,
        "descriptorIndices": descriptor_indices,
        "descriptorGroup": "none" if arm == "baseline" else descriptor_group["mode"],
        "featuresPath": features_path,
        "descriptorsPath": descriptors_path,
        "modelPath": model_path,
        "modelSha256": arm_receipt["modelArtifact"]["sha256"],
        "normalization": normalization,
        "sourceHashes": source_hashes(state),
        "manifestSha256": hashlib.sha256(manifest_bytes).hexdigest(),
    }


def validate_overlay_contract(overlay: dict[str, Any], expected: dict[str, Any]) -> None:
    require(overlay.get("schema") == OVERLAY_SCHEMA, "prediction overlay schema drifted")
    require(overlay.get("status") == "complete", "prediction overlay is incomplete")
    require(overlay.get("authority") == AUTHORITY, "prediction overlay authority drifted")
    require(overlay.get("source", {}).get("manifestIdentity") == expected["manifestIdentity"], "prediction overlay corpus identity differs")
    require(overlay.get("model", {}).get("sha256") == expected["modelSha256"], "prediction overlay model sha256 differs")
    require(overlay.get("state", {}).get("sourceHashes") == expected["sourceHashes"], "prediction overlay state source hashes differ")


def run_self_test() -> dict[str, Any]:
    import mlx.core as mx
    import numpy as np

    learner = load_learner()
    reload_errors: dict[str, float] = {}
    parameters: dict[str, int] = {}
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for arm in ("baseline", "treatment"):
            mx.random.seed(7162026)
            model = learner.build_arm_model(arm, 24, 7)
            mx.eval(model.parameters())
            input_count = 24 if arm == "baseline" else 31
            values = mx.array(np.linspace(-1.0, 1.0, input_count * 5, dtype=np.float32).reshape(5, input_count))
            expected = np.asarray(model(values), dtype=np.float32)
            path = root / f"{arm}.safetensors"
            from mlx.utils import tree_flatten
            mx.save_safetensors(str(path), dict(tree_flatten(model.parameters())))
            loaded = learner.build_arm_model(arm, 24, 7)
            loaded.load_weights(str(path))
            mx.eval(loaded.parameters())
            actual = np.asarray(loaded(values), dtype=np.float32)
            reload_errors[arm] = float(np.max(np.abs(expected - actual)))
            parameters[arm] = learner.count_trainable_parameters(loaded)
    expected_overlay = {
        "manifestIdentity": f"sha256:{'a' * 64}",
        "modelSha256": "b" * 64,
        "sourceHashes": {name: character * 64 for name, character in zip(sorted(learner.DESCRIPTOR_SOURCE_HASH_KEYS), "cdef")},
    }
    overlay = {
        "schema": OVERLAY_SCHEMA,
        "status": "complete",
        "authority": AUTHORITY,
        "source": {"manifestIdentity": expected_overlay["manifestIdentity"]},
        "model": {"sha256": expected_overlay["modelSha256"]},
        "state": {"sourceHashes": expected_overlay["sourceHashes"]},
    }
    overlay_identity = canonical_identity(overlay)
    overlay["elapsedSeconds"] = 1.0
    require(canonical_identity(overlay) == overlay_identity, "volatile elapsed time changed overlay identity")
    overlay["identity"] = overlay_identity
    validate_overlay_contract(overlay, expected_overlay)
    rejected = []
    mutations = {
        "corpus-identity": lambda value: value["source"].update(manifestIdentity=f"sha256:{'0' * 64}"),
        "model-sha256": lambda value: value["model"].update(sha256="0" * 64),
        "state-source-hashes": lambda value: value["state"].update(sourceHashes={}),
    }
    for name, mutate in mutations.items():
        candidate = json.loads(json.dumps(overlay))
        mutate(candidate)
        try:
            validate_overlay_contract(candidate, expected_overlay)
        except ValueError:
            rejected.append(name)
    return {
        "identity": "layer-coefficient-prediction-export-self-test-v0",
        "status": "passed",
        "authority": AUTHORITY,
        "trainableParameters": parameters,
        "reloadMaxAbsError": reload_errors,
        "rejectedDrift": rejected,
    }


def export_predictions(args: argparse.Namespace) -> dict[str, Any]:
    import mlx.core as mx
    import numpy as np

    manifest_path = Path(args.input).expanduser().resolve()
    report_path = Path(args.training_report).expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    training_report = json.loads(report_path.read_text(encoding="utf-8"))
    contract = validate_training_contract(manifest, manifest_path, training_report, report_path, args.arm, args.state_id)
    if args.probe_only:
        return {
            "schema": REPORT_SCHEMA,
            "status": "contract-valid",
            "failurePhase": None,
            "authority": AUTHORITY,
            "source": {"manifestIdentity": manifest["identity"], "manifestSha256": contract["manifestSha256"]},
            "model": {"arm": args.arm, "sha256": contract["modelSha256"]},
            "state": {"id": contract["state"]["id"], "rowCount": contract["count"], "sourceHashes": contract["sourceHashes"]},
        }
    learner = contract["learner"]
    model = learner.build_arm_model(args.arm, contract["featureCount"], len(contract["descriptorIndices"]))
    model.load_weights(str(contract["modelPath"]))
    mx.eval(model.parameters())
    features = np.memmap(contract["featuresPath"], dtype="<f4", mode="r", shape=(contract["count"], contract["featureCount"]))
    descriptors = np.memmap(contract["descriptorsPath"], dtype="<f4", mode="r", shape=(contract["count"], learner.DESCRIPTOR_STRIDE_FLOATS))
    normalization = contract["normalization"]
    feature_mean = np.asarray(normalization["featureMean"], dtype=np.float32)
    feature_std = np.asarray(normalization["featureStd"], dtype=np.float32)
    target_scale = np.asarray(normalization["targetScale"], dtype=np.float32)
    mask = np.ones_like(feature_mean) if args.arm == "baseline" else learner.descriptor_group_mask(contract["featureCount"], contract["descriptorGroup"])
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(f".{output_path.name}.partial")
    output = np.memmap(temporary_path, dtype="<f4", mode="w+", shape=(contract["count"], len(learner.COEFFICIENT_ORDER)))
    for start in range(0, contract["count"], args.batch_size):
        stop = min(start + args.batch_size, contract["count"])
        batch = np.asarray(features[start:stop], dtype=np.float32)
        if args.arm == "treatment":
            descriptor_batch = np.asarray(descriptors[start:stop][:, contract["descriptorIndices"]], dtype=np.float32)
            batch = np.concatenate((batch, descriptor_batch), axis=1)
        normalized = ((batch - feature_mean) / feature_std) * mask
        predictions = np.asarray(model(mx.array(normalized)), dtype=np.float32) * target_scale
        require(np.all(np.isfinite(predictions)) and float(np.min(predictions)) >= 0.0, "prediction batch contains nonfinite or negative coefficients")
        output[start:stop] = predictions
    output.flush()
    del output
    os.replace(temporary_path, output_path)
    artifact = {
        "path": str(output_path),
        "bytes": output_path.stat().st_size,
        "sha256": sha256_file(output_path),
        "dtype": "float32-le",
        "shape": [contract["count"], len(learner.COEFFICIENT_ORDER)],
        "semanticRole": "learned-post-admission-layer-emission-extinction-prediction",
    }
    require(sha256_file(manifest_path) == contract["manifestSha256"], "completion revalidation found corpus manifest mutation")
    require(sha256_file(contract["modelPath"]) == contract["modelSha256"], "completion revalidation found model mutation")
    require(sha256_file(contract["featuresPath"]) == manifest["states"][[state["id"] for state in manifest["states"]].index(contract["state"]["id"])]["rows"]["features"]["sha256"], "completion revalidation found held feature mutation")
    require(sha256_file(contract["descriptorsPath"]) == contract["state"]["rows"]["kernelDescriptors"]["sha256"], "completion revalidation found held descriptor mutation")
    overlay = {
        "schema": OVERLAY_SCHEMA,
        "status": "complete",
        "failurePhase": None,
        "authority": AUTHORITY,
        "source": {
            "manifestPath": str(manifest_path),
            "manifestIdentity": manifest["identity"],
            "manifestSha256": contract["manifestSha256"],
        },
        "model": {
            "trainingReportPath": str(report_path),
            "arm": args.arm,
            "architecture": training_report["arms"][args.arm]["architecture"],
            "descriptorGroup": contract["descriptorGroup"],
            "sha256": contract["modelSha256"],
        },
        "state": {
            "id": contract["state"]["id"],
            "splitRole": contract["state"]["splitRole"],
            "rowCount": contract["count"],
            "sourceHashes": contract["sourceHashes"],
            "sourceManifestSha256": contract["state"]["rows"]["kernelDescriptors"]["sourceManifestSha256"],
            "admissionIndexSha256": contract["state"]["rows"]["kernelDescriptors"]["admissionIndexAuthority"]["indexSha256"],
        },
        "coefficientArtifact": artifact,
        "execution": {
            "backend": "mlx",
            "device": str(mx.default_device()),
            "batchSize": args.batch_size,
            "sampleCap": None,
            "droppedRowCount": 0,
        },
    }
    overlay["identity"] = canonical_identity(overlay)
    validate_overlay_contract(overlay, {
        "manifestIdentity": manifest["identity"],
        "modelSha256": contract["modelSha256"],
        "sourceHashes": contract["sourceHashes"],
    })
    return overlay


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input")
    parser.add_argument("--training-report")
    parser.add_argument("--arm", choices=("baseline", "treatment"), default="treatment")
    parser.add_argument("--state-id")
    parser.add_argument("--output")
    parser.add_argument("--report")
    parser.add_argument("--batch-size", type=int, default=8192)
    parser.add_argument("--probe-only", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        print(json.dumps(run_self_test(), sort_keys=True))
        return 0
    require(args.input and args.training_report and args.report, "--input, --training-report, and --report are required")
    require(args.probe_only or args.output, "--output is required outside probe-only mode")
    require(args.batch_size > 0, "--batch-size must be positive")
    started = time.time()
    report_path = Path(args.report).expanduser().resolve()
    phase = "validate-contract"
    try:
        phase = "export-predictions" if not args.probe_only else "validate-contract"
        report = export_predictions(args)
        report["elapsedSeconds"] = time.time() - started
        atomic_json(report_path, report)
        print(json.dumps({"status": report["status"], "report": str(report_path), "identity": report.get("identity")}))
        return 0
    except Exception as error:
        failure = {
            "schema": FAILURE_SCHEMA,
            "status": "blocked",
            "failurePhase": phase,
            "reason": str(error),
            "lastTrustworthyEvidence": {
                "input": args.input,
                "trainingReport": args.training_report,
                "arm": args.arm,
                "stateId": args.state_id,
            },
            "elapsedSeconds": time.time() - started,
        }
        atomic_json(report_path, failure)
        print(json.dumps(failure), file=os.sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
