#!/usr/bin/env python3
import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import mlx.core as mx
import numpy as np

from sam_mlx_model_loader import checkpoint_parameter_audit, load_sam3_model


SCHEMA = "kaminos.sam3-browser-diagnostic-mlx-replay.v0"
REQUIRED_BROWSER_TENSORS = {
    "encoderHiddenStates": ("batch", "spatialTokens", "channels"),
    "encoderPos": ("batch", "spatialTokens", "channels"),
    "promptFeatures": ("batch", "promptTokens", "channels"),
    "promptMask": ("batch", "promptTokens"),
    "pixelEmbed": ("batch", "maskHeight", "maskWidth", "channels"),
}
OPTIONAL_BROWSER_OUTPUT_TENSORS = {
    "decoderHiddenStates": (("layerCount", "batch", "queryTokens", "channels"), "decoderHiddenStates"),
    "lastHs": (("batch", "queryTokens", "channels"), "lastHs"),
    "referenceBoxes": (("batch", "queryTokens", 4), "referenceBoxes"),
    "presenceLogits": (("layerCount", "batch", 1), "presenceLogits"),
    "maskLogits": (("batch", "maskTokens", "maskHeight", "maskWidth"), "maskLogits"),
}


def parse_args():
    parser = argparse.ArgumentParser(
        description="Replay authenticated browser SAM3 intermediates through the MLX decoder and mask tail."
    )
    parser.add_argument("--browser-report", required=True)
    parser.add_argument("--packet-dir", required=True)
    parser.add_argument("--out", required=True)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def verified_manifest(packet_dir: Path, root: dict, key: str) -> tuple[dict, dict]:
    identity = root.get(key)
    if not isinstance(identity, dict) or not identity.get("file") or not identity.get("sha256"):
        raise ValueError(f"packet root missing {key} identity")
    path = packet_dir / identity["file"]
    actual_sha = sha256_file(path)
    if actual_sha != identity["sha256"]:
        raise ValueError(f"packet {key} sha256 mismatch: expected {identity['sha256']} got {actual_sha}")
    return read_json(path), {"path": str(path), "sha256": actual_sha, "schema": identity.get("schema")}


def shape_from_names(shape: dict, names: tuple[str | int, ...]) -> tuple[int, ...]:
    values = tuple(int(shape[name]) if isinstance(name, str) else int(name) for name in names)
    if any(value < 1 for value in values):
        raise ValueError(f"invalid packet shape for {names}: {values}")
    return values


def load_browser_tensor(name: str, evidence: dict, expected_shape: tuple[int, ...]) -> tuple[np.ndarray, dict]:
    identity = evidence.get("tensors", {}).get(name)
    if not isinstance(identity, dict) or not identity.get("path") or not identity.get("sha256"):
        raise ValueError(f"browser diagnostic tensor {name} identity missing")
    path = Path(identity["path"])
    data = path.read_bytes()
    actual_sha = sha256_bytes(data)
    if actual_sha != identity["sha256"]:
        raise ValueError(f"browser diagnostic tensor {name} sha256 mismatch")
    expected_count = int(np.prod(expected_shape))
    if identity.get("dtype") != "float32-le" or identity.get("elementCount") != expected_count:
        raise ValueError(f"browser diagnostic tensor {name} shape or dtype mismatch")
    if len(data) != expected_count * 4 or identity.get("byteLength") != len(data):
        raise ValueError(f"browser diagnostic tensor {name} byte length mismatch")
    array = np.frombuffer(data, dtype="<f4").reshape(expected_shape).copy()
    return array, {
        "path": str(path),
        "sha256": actual_sha,
        "dtype": identity["dtype"],
        "shape": list(expected_shape),
        "byteLength": len(data),
    }


def tensor_entry(verification: dict, role: str) -> dict:
    entries = [entry for entry in verification.get("tensors", []) if entry.get("role") == role]
    if len(entries) != 1:
        raise ValueError(f"verification tensor role {role} has {len(entries)} entries")
    return entries[0]


def load_reference_tensor(packet_dir: Path, verification: dict, role: str) -> tuple[np.ndarray, dict]:
    entry = tensor_entry(verification, role)
    if entry.get("dtype") != "float32":
        raise ValueError(f"verification tensor {role} must be float32")
    path = packet_dir / entry["file"]
    data = path.read_bytes()
    actual_sha = sha256_bytes(data)
    if actual_sha != entry.get("sha256"):
        raise ValueError(f"verification tensor {role} sha256 mismatch")
    shape = tuple(int(value) for value in entry["shape"])
    expected_bytes = int(np.prod(shape)) * 4
    if len(data) != expected_bytes or entry.get("byteLength") != expected_bytes:
        raise ValueError(f"verification tensor {role} byte length mismatch")
    return np.frombuffer(data, dtype="<f4").reshape(shape).copy(), {
        "role": role,
        "path": str(path),
        "sha256": actual_sha,
        "shape": list(shape),
        "byteLength": len(data),
    }


def diff_metrics(actual: np.ndarray, expected: np.ndarray) -> dict:
    if actual.shape != expected.shape:
        raise ValueError(f"comparison shape mismatch: actual={actual.shape} expected={expected.shape}")
    delta = np.abs(actual.astype(np.float64) - expected.astype(np.float64)).reshape(-1)
    if delta.size == 0 or not np.all(np.isfinite(delta)):
        raise ValueError("comparison contains no values or non-finite deltas")
    return {
        "maxAbsDiff": float(np.max(delta)),
        "meanAbsDiff": float(np.mean(delta)),
        "p99AbsDiff": float(np.quantile(delta, 0.99)),
        "elementCount": int(delta.size),
    }


def run_replay(args, report: dict) -> dict:
    packet_dir = Path(args.packet_dir).resolve()
    browser_report_path = Path(args.browser_report).resolve()
    root_path = packet_dir / "tensor-manifest.json"
    root = read_json(root_path)
    model_package, package_identity = verified_manifest(packet_dir, root, "modelPackage")
    invocation, invocation_identity = verified_manifest(packet_dir, root, "invocation")
    verification, verification_identity = verified_manifest(packet_dir, root, "verification")
    package_id = model_package.get("packageId")
    invocation_id = invocation.get("invocationId")
    if not package_id or not invocation_id:
        raise ValueError("packet package or invocation identity missing")
    report["packetEvidence"] = {
        "root": {"path": str(root_path), "sha256": sha256_file(root_path), "schema": root.get("schema")},
        "modelPackage": package_identity,
        "invocation": invocation_identity,
        "verification": verification_identity,
        "packageId": package_id,
        "invocationId": invocation_id,
    }
    report["lastTrustedEvidence"] = "packet-manifests-authenticated"

    report["failurePhase"] = "authenticate-browser-diagnostics"
    browser_report = read_json(browser_report_path)
    candidates = browser_report.get("diagnosticReadbackEvidence", [])
    matches = [
        item for item in candidates
        if item.get("packageId") == package_id and item.get("invocationId") == invocation_id
    ]
    if len(matches) != 1:
        raise ValueError(f"expected one matching browser diagnostic evidence record, found {len(matches)}")
    diagnostic = matches[0]
    shape = model_package.get("shape", {})
    browser_arrays = {}
    browser_identities = {}
    for name, shape_names in REQUIRED_BROWSER_TENSORS.items():
        browser_arrays[name], browser_identities[name] = load_browser_tensor(
            name, diagnostic, shape_from_names(shape, shape_names)
        )
    report["browserDiagnosticEvidence"] = {
        "sourceReport": {"path": str(browser_report_path), "sha256": sha256_file(browser_report_path)},
        "packageId": package_id,
        "invocationId": invocation_id,
        "tensors": browser_identities,
    }
    report["lastTrustedEvidence"] = "browser-diagnostic-tensors-authenticated"

    report["failurePhase"] = "load-audited-mlx-checkpoint"
    model_id = model_package.get("model", {}).get("id")
    if not model_id:
        raise ValueError("model package model id missing")
    model, model_path, weights_path, checkpoint_audit = load_sam3_model(model_id)
    weights_sha = sha256_file(weights_path)
    expected_weights_sha = model_package.get("staticWeights", {}).get("sha256")
    if weights_sha != expected_weights_sha:
        raise ValueError(f"effective MLX checkpoint sha256 mismatch: expected {expected_weights_sha} got {weights_sha}")
    report["mlxRuntimeEvidence"] = {
        "modelId": model_id,
        "modelPath": str(model_path),
        "weightsPath": str(weights_path),
        "weightsSha256": weights_sha,
        "checkpointParameterAudit": checkpoint_audit,
        "checkpoint_parameter_audit": "passed",
        "effectiveComputeDtype": "float32",
    }
    report["lastTrustedEvidence"] = "mlx-checkpoint-authenticated"

    report["failurePhase"] = "run-mlx-decoder-replay"
    det = model.detector_model
    encoder_hidden = mx.array(browser_arrays["encoderHiddenStates"], dtype=mx.float32)
    encoder_pos = mx.array(browser_arrays["encoderPos"], dtype=mx.float32)
    prompt_features = mx.array(browser_arrays["promptFeatures"], dtype=mx.float32)
    prompt_mask = mx.array(browser_arrays["promptMask"], dtype=mx.float32)
    pixel_embed = mx.array(browser_arrays["pixelEmbed"], dtype=mx.float32)
    hs, reference_boxes, presence_logits = det.detr_decoder(
        vision_features=encoder_hidden,
        inputs_embeds=prompt_features,
        vision_pos_encoding=encoder_pos,
        text_mask=prompt_mask,
        spatial_shape=(int(shape["height"]), int(shape["width"])),
    )
    mask_decoder = det.mask_decoder
    instance_embed = mask_decoder.instance_projection(pixel_embed)
    mask_embeddings = mask_decoder.mask_embedder(hs[-1])
    mx.eval(hs, reference_boxes, presence_logits, mask_embeddings, instance_embed)
    mask_embeddings_np = np.array(mask_embeddings, dtype=np.float32)
    upscaled_embedding_np = np.array(instance_embed.transpose(0, 3, 1, 2), dtype=np.float32)
    mask_logits_np = np.einsum(
        "btc,bchw->bthw",
        mask_embeddings_np.astype(np.float64),
        upscaled_embedding_np.astype(np.float64),
    ).astype(np.float32)
    replay = {
        "decoderHiddenStates": np.array(hs, dtype=np.float32),
        "lastHs": np.array(hs[-1], dtype=np.float32),
        "referenceBoxes": np.array(reference_boxes[-1], dtype=np.float32),
        "presenceLogits": np.array(presence_logits, dtype=np.float32),
        "maskEmbeddings": mask_embeddings_np,
        "upscaledEmbedding": upscaled_embedding_np,
        "maskLogits": mask_logits_np,
    }
    report["lastTrustedEvidence"] = "mlx-replay-completed"

    report["failurePhase"] = "compare-mlx-replay-canonical"
    comparison_roles = {
        "decoderHiddenStates": "expected-decoder-hidden-states",
        "lastHs": "expected-last-hs",
        "referenceBoxes": "expected-reference-boxes",
        "presenceLogits": "expected-presence-logits",
        "maskEmbeddings": "expected-mask-embeddings",
        "upscaledEmbedding": "expected-upscaled-embedding",
        "maskLogits": "expected-mask-logits",
    }
    comparisons = {}
    reference_evidence = {}
    reference_arrays = {}
    for name, role in comparison_roles.items():
        reference_arrays[name], reference_evidence[name] = load_reference_tensor(packet_dir, verification, role)
        comparisons[name] = diff_metrics(replay[name], reference_arrays[name])
    replay_binary = replay["maskLogits"] > 0
    canonical_binary = reference_arrays["maskLogits"] > 0
    comparisons["binaryMismatchCount"] = int(np.count_nonzero(replay_binary != canonical_binary))
    comparisons["binaryElementCount"] = int(replay_binary.size)
    report["canonicalReferenceEvidence"] = reference_evidence
    report["mlxReplayVsCanonical"] = comparisons
    optional_names = set(OPTIONAL_BROWSER_OUTPUT_TENSORS)
    available_optional_names = optional_names.intersection(diagnostic.get("tensors", {}))
    if available_optional_names and available_optional_names != optional_names:
        missing = sorted(optional_names - available_optional_names)
        raise ValueError(f"browser output diagnostic set is partial; missing {missing}")
    if available_optional_names == optional_names:
        report["failurePhase"] = "compare-browser-mlx-replay"
        browser_vs_replay = {}
        for name, (shape_names, replay_name) in OPTIONAL_BROWSER_OUTPUT_TENSORS.items():
            browser_output, browser_output_identity = load_browser_tensor(
                name, diagnostic, shape_from_names(shape, shape_names)
            )
            browser_arrays[name] = browser_output
            browser_identities[name] = browser_output_identity
            browser_vs_replay[name] = diff_metrics(browser_output, replay[replay_name])
        browser_vs_replay["binaryMismatchCount"] = int(np.count_nonzero(
            (browser_arrays["maskLogits"] > 0) != (replay["maskLogits"] > 0)
        ))
        browser_vs_replay["binaryElementCount"] = int(replay["maskLogits"].size)
        report["browserDiagnosticEvidence"]["tensors"] = browser_identities
        report["browserVsMlxReplay"] = browser_vs_replay
    else:
        report["browserVsMlxReplay"] = {
            "status": "not-captured",
            "missingTensors": sorted(optional_names),
        }
    report["lastTrustedEvidence"] = "mlx-replay-canonical-comparison-completed"
    return report


def main():
    args = parse_args()
    out = Path(args.out).resolve()
    out.parent.mkdir(parents=True, exist_ok=True)
    report = {
        "schema": SCHEMA,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "requested": {
            "browserReport": str(Path(args.browser_report).resolve()),
            "packetDir": str(Path(args.packet_dir).resolve()),
            "out": str(out),
        },
        "status": "running",
        "failurePhase": None,
        "lastTrustedEvidence": None,
    }
    try:
        report["failurePhase"] = "authenticate-input-evidence"
        run_replay(args, report)
        report["status"] = "passed"
        report["failurePhase"] = None
    except Exception as error:
        report["status"] = "failed"
        report["error"] = {"type": type(error).__name__, "message": str(error)}
        out.write_text(json.dumps(report, indent=2), encoding="utf-8")
        raise
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "report": str(out),
        "status": report["status"],
        "packageId": report["packetEvidence"]["packageId"],
        "invocationId": report["packetEvidence"]["invocationId"],
        "mlxReplayVsCanonical": report["mlxReplayVsCanonical"],
    }, indent=2))


if __name__ == "__main__":
    main()
