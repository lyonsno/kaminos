#!/usr/bin/env python3
import argparse
import hashlib
import importlib
import json
import subprocess
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn


ROUTE_ID = "sam3.1.multiplex-mask-decoder.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam31-multiplex-mask-decoder-meta-packet.v0"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
FAILURE_PHASE = "argument-resolution"


def parse_args():
    parser = argparse.ArgumentParser(description="Export the official Meta SAM3.1 multiplex propagation mask decoder.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--source-root", default=str(Path.home() / "dev/sam3"))
    parser.add_argument("--seed", type=int, default=3141)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def require_identity(checkpoint_path: Path, source_root: Path):
    checkpoint_sha = sha256_file(checkpoint_path)
    if checkpoint_sha != CHECKPOINT_SHA256:
        raise ValueError(f"checkpoint digest mismatch: expected {CHECKPOINT_SHA256}, got {checkpoint_sha}")
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()
    if source_commit != SOURCE_COMMIT:
        raise ValueError(f"source commit mismatch: expected {SOURCE_COMMIT}, got {source_commit}")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "sam3/model/multiplex_mask_decoder.py", "sam3/sam/transformer.py", "sam3/sam/common.py"],
        cwd=source_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if status:
        raise RuntimeError(f"source working tree is dirty under load-bearing decoder paths: {status}")
    return checkpoint_sha, source_commit


def load_official_modules(source_root: Path):
    sam3_root = source_root / "sam3"
    for name, path in (("sam3", sam3_root), ("sam3.model", sam3_root / "model"), ("sam3.sam", sam3_root / "sam")):
        package = types.ModuleType(name)
        package.__path__ = [str(path)]
        sys.modules[name] = package
    transformer = importlib.import_module("sam3.sam.transformer")
    decoder = importlib.import_module("sam3.model.multiplex_mask_decoder")
    return transformer, decoder


def build_decoder(transformer_module, decoder_module, state):
    transformer = transformer_module.TwoWayTransformer(
        depth=2,
        embedding_dim=256,
        mlp_dim=2048,
        num_heads=8,
        attention_downsample_rate=2,
    )
    decoder = decoder_module.MultiplexMaskDecoder(
        transformer_dim=256,
        transformer=transformer,
        multiplex_count=16,
        num_multimask_outputs=3,
        use_high_res_features=True,
        pred_obj_scores=True,
        pred_obj_scores_mlp=True,
        use_multimask_token_for_obj_ptr=True,
        decode_mask_with_shared_tokens=False,
        decode_mask_attribute_with_shared_tokens=False,
        multimask_outputs_only=True,
    )
    prefix = "tracker.model.sam_mask_decoder."
    decoder_state = {key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix)}
    decoder.load_state_dict(decoder_state, strict=True)
    pointer = decoder_module.MLP(256, 256, 256, 3)
    pointer_prefix = "tracker.model.obj_ptr_proj."
    pointer.load_state_dict({key.removeprefix(pointer_prefix): value for key, value in state.items() if key.startswith(pointer_prefix)}, strict=True)
    no_object = nn.Linear(256, 256)
    no_object_prefix = "tracker.model.no_obj_ptr_linear."
    no_object.load_state_dict({key.removeprefix(no_object_prefix): value for key, value in state.items() if key.startswith(no_object_prefix)}, strict=True)
    decoder.eval()
    pointer.eval()
    no_object.eval()
    return decoder, pointer, no_object


def write_array(path: Path, value) -> dict:
    if isinstance(value, torch.Tensor):
        value = value.detach().cpu().float().numpy()
    array = np.ascontiguousarray(value, dtype=np.float32)
    data = array.tobytes(order="C")
    path.write_bytes(data)
    return {"file": path.name, "sha256": sha256_bytes(data), "byteLength": len(data), "dtype": "float32", "shape": list(array.shape)}


def role_for_key(prefix: str, key: str) -> str:
    return f"{prefix}-{'-'.join(key.split('.'))}"


def invalidate_primary_outputs(out_dir: Path):
    (out_dir / "tensor-manifest.json").unlink(missing_ok=True)
    for path in out_dir.glob("*.bin"):
        path.unlink()


def write_failure_receipt(args, error: Exception):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)
    receipt = {
        "ok": False,
        "schema": "kaminos.sam31-multiplex-mask-decoder-meta-reference-receipt.v0",
        "failurePhase": FAILURE_PHASE,
        "error": f"{type(error).__name__}: {error}",
        "requested": {"checkpoint": str(Path(args.checkpoint).resolve()), "sourceRoot": str(Path(args.source_root).resolve()), "seed": args.seed},
        "expected": {"modelRevision": HF_REVISION, "checkpointSha256": CHECKPOINT_SHA256, "sourceCommit": SOURCE_COMMIT},
        "lastTrustworthyEvidence": "No primary multiplex decoder tensor packet was published.",
    }
    (out_dir / "reference-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")


def main():
    global FAILURE_PHASE
    args = parse_args()
    out_dir = Path(args.out_dir)
    checkpoint_path = Path(args.checkpoint).resolve()
    source_root = Path(args.source_root).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)

    FAILURE_PHASE = "identity-validation"
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"official checkpoint not found: {checkpoint_path}")
    checkpoint_sha, source_commit = require_identity(checkpoint_path, source_root)
    transformer_module, decoder_module = load_official_modules(source_root)

    FAILURE_PHASE = "checkpoint-load"
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    decoder, pointer_projection, no_object_projection = build_decoder(transformer_module, decoder_module, state)

    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    random = lambda shape, scale: torch.randn(shape, generator=generator, dtype=torch.float32) * scale
    inputs = {
        "image-embedding": random((1, 256, 2, 2), 0.04),
        "image-position": random((1, 256, 2, 2), 0.02),
        "high-resolution-s0": random((1, 32, 8, 8), 0.03),
        "high-resolution-s1": random((1, 64, 4, 4), 0.03),
        "extra-per-object-embedding": random((1, 16, 256), 1.0),
    }
    captures = {}
    hooks = []
    for layer_index, layer in enumerate(decoder.transformer.layers):
        def capture_layer(_module, _args, output, index=layer_index):
            captures[f"layer-{index}-queries"] = output[0].detach().clone()
            captures[f"layer-{index}-keys"] = output[1].detach().clone()
        hooks.append(layer.register_forward_hook(capture_layer))

    FAILURE_PHASE = "official-multiplex-decoder-execution"
    with torch.inference_mode():
        output = decoder(
            image_embeddings=inputs["image-embedding"],
            image_pe=inputs["image-position"],
            high_res_features=[inputs["high-resolution-s0"], inputs["high-resolution-s1"]],
            multimask_output=True,
            extra_per_object_embeddings=inputs["extra-per-object-embedding"],
        )
        masks = output["masks"][0]
        ious = output["iou_pred"][0]
        sam_tokens = output["sam_tokens_out"][0]
        object_scores = output["object_score_logits"][0]
        best_indices = torch.argmax(ious, dim=-1)
        object_indices = torch.arange(16)
        selected_masks = masks[object_indices, best_indices].unsqueeze(1)
        selected_tokens = sam_tokens[object_indices, best_indices]
        projected_pointers = pointer_projection(selected_tokens)
        appearing = object_scores[:, 0] > 0.0
        pointers = torch.where(appearing[:, None], projected_pointers, no_object_projection(projected_pointers))
    for hook in hooks:
        hook.remove()

    expected_shapes = {
        "masks": (16, 3, 8, 8),
        "iou": (16, 3),
        "samTokens": (16, 3, 256),
        "objectScores": (16, 1),
        "pointers": (16, 256),
    }
    actual_shapes = {
        "masks": tuple(masks.shape),
        "iou": tuple(ious.shape),
        "samTokens": tuple(sam_tokens.shape),
        "objectScores": tuple(object_scores.shape),
        "pointers": tuple(pointers.shape),
    }
    if actual_shapes != expected_shapes:
        raise RuntimeError(f"official decoder output shape mismatch: {actual_shapes}")

    FAILURE_PHASE = "artifact-write"
    tensors = []
    serialized_inputs = {
        **inputs,
        "image-embedding": inputs["image-embedding"].permute(0, 2, 3, 1).contiguous(),
        "image-position": inputs["image-position"].permute(0, 2, 3, 1).contiguous(),
    }
    for role, tensor in serialized_inputs.items():
        file_name = f"{role}.f32.bin"
        tensors.append({"role": role, **write_array(out_dir / file_name, tensor)})
    expected = {
        **captures,
        "expected-masks": masks,
        "expected-iou": ious,
        "expected-sam-tokens": sam_tokens,
        "expected-object-scores": object_scores,
        "expected-best-mask-indices": best_indices,
        "expected-selected-masks": selected_masks,
        "expected-projected-pointers": projected_pointers,
        "expected-object-appearing": appearing.float(),
        "expected-object-pointers": pointers,
    }
    for role, tensor in expected.items():
        file_name = f"{role}.f32.bin"
        tensors.append({"role": role, **write_array(out_dir / file_name, tensor)})

    weights = []
    weight_groups = [
        ("decoder", "tracker.model.sam_mask_decoder."),
        ("object-pointer", "tracker.model.obj_ptr_proj."),
        ("no-object-pointer", "tracker.model.no_obj_ptr_linear."),
    ]
    for group, prefix in weight_groups:
        for official_key, tensor in state.items():
            if not official_key.startswith(prefix):
                continue
            local_key = official_key.removeprefix(prefix)
            role = role_for_key(group, local_key)
            file_name = f"{role}.f32.bin"
            weights.append({"role": role, "officialKey": official_key, "localKey": local_key, "group": group, **write_array(out_dir / file_name, tensor)})

    reference = {
        "model": {"id": "facebook/sam3.1", "revision": HF_REVISION, "checkpointFile": checkpoint_path.name, "sha256": checkpoint_sha},
        "source": {"repository": "facebookresearch/sam3", "root": str(source_root), "commit": source_commit, "workingTreeClean": True},
        "execution": {
            "kind": "pinned-official-module-class",
            "decoderClass": "MultiplexMaskDecoder",
            "transformerClass": "TwoWayTransformer",
            "objectPointerClass": "MLP",
            "attentionBackend": "torch-cpu-scaled-dot-product-attention",
        },
        "framework": {"name": "torch", "version": torch.__version__, "device": "cpu"},
    }
    shape = {
        "batch": 1,
        "multiplexCount": 16,
        "maskOutputsPerObject": 3,
        "attributeTokens": 32,
        "maskTokens": 48,
        "queryTokens": 80,
        "imageHeight": 2,
        "imageWidth": 2,
        "imageTokens": 4,
        "channels": 256,
        "heads": 8,
        "attentionChannels": 128,
        "mlpHidden": 2048,
        "maskHeight": 8,
        "maskWidth": 8,
        "layerCount": 2,
    }
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "official-meta-multiplex-propagation-mask-decoder-export",
        "boundary": "sam31-propagation-features-to-multiplex-masks-scores-and-object-pointers",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "fixture": {
            "seed": args.seed,
            "kind": "deterministic-two-by-two-mixed-object-presence-multiplex-decoder",
            "sourceFeaturesSynthetic": True,
            "extraPerObjectEmbeddingScale": 1.0,
        },
        "tensorLayouts": {
            "image-embedding": "B,H,W,C-token-major",
            "image-position": "B,H,W,C-token-major",
            "high-resolution-s0": "B,C,H,W",
            "high-resolution-s1": "B,C,H,W",
        },
        "shape": shape,
        "configuration": {
            "useHighResolutionFeatures": True,
            "predObjectScores": True,
            "predObjectScoresMlp": True,
            "useMultimaskTokenForObjectPointer": True,
            "decodeMaskWithSharedTokens": False,
            "decodeMaskAttributeWithSharedTokens": False,
            "multimaskOutputsOnly": True,
            "multimaskOutput": True,
            "objectScoreThreshold": 0.0,
            "useLinearNoObjectPointer": True,
        },
        "claims": {"officialDecoderExecuted": True, "officialObjectPointerProjectionExecuted": True, "imageBackboneExecuted": False, "fullVideoTrackStepExecuted": False},
        "checkpointAudit": {"officialStateTensorCount": len(state), "decoderTensorCount": 125, "objectPointerTensorCount": 6, "noObjectPointerTensorCount": 2, "mappedTensorCount": len(weights), "allMappedOfficialKeysPresent": len(weights) == 133},
        "outputSummary": {"appearingObjectCount": int(appearing.sum().item()), "absentObjectCount": int((~appearing).sum().item()), "bestMaskIndices": best_indices.tolist()},
        "tolerances": {"webGpuIntermediateMaxAbsDiff": 0.0005, "webGpuFinalMaxAbsDiff": 0.0015},
        "tensors": tensors,
        "weights": weights,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    manifest_text = json.dumps(manifest, indent=2)
    receipt = {
        "ok": True,
        "schema": "kaminos.sam31-multiplex-mask-decoder-meta-reference-receipt.v0",
        "routeId": ROUTE_ID,
        "boundary": manifest["boundary"],
        "reference": reference,
        "shape": shape,
        "configuration": manifest["configuration"],
        "checkpointAudit": manifest["checkpointAudit"],
        "outputSummary": manifest["outputSummary"],
        "outputs": {"tensorManifest": str(manifest_path), "tensorManifestSha256": sha256_bytes(manifest_text.encode("utf-8")), "referenceReceipt": str(receipt_path)},
    }
    manifest_path.write_text(manifest_text, encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    FAILURE_PHASE = "complete"
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        write_failure_receipt(parse_args(), error)
        raise
