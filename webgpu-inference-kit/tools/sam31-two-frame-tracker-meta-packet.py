#!/usr/bin/env python3
import argparse
import contextlib
import hashlib
import importlib
import importlib.util
import json
import subprocess
import sys
import types
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch


SCHEMA = "kaminos.sam31-two-frame-tracker-meta-packet.v0"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
NO_OBJ_SCORE = -1024.0
FAILURE_PHASE = "argument-resolution"


def parse_args():
    parser = argparse.ArgumentParser(description="Export a pinned official SAM3.1 two-frame decoder-memory-attention-decoder episode.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--source-root", default=str(Path.home() / "dev/sam3"))
    parser.add_argument("--seed", type=int, default=3167)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def load_tool(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load tool module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def invalidate_primary_outputs(out_dir: Path):
    (out_dir / "tensor-manifest.json").unlink(missing_ok=True)
    for path in out_dir.glob("*.bin"):
        path.unlink()


def write_array(path: Path, value) -> dict:
    if isinstance(value, torch.Tensor):
        value = value.detach().cpu().float().numpy()
    array = np.ascontiguousarray(value, dtype=np.float32)
    data = array.tobytes(order="C")
    path.write_bytes(data)
    return {
        "file": path.name,
        "sha256": sha256_bytes(data),
        "byteLength": len(data),
        "dtype": "float32",
        "shape": list(array.shape),
    }


def require_identity(checkpoint_path: Path, source_root: Path):
    checkpoint_sha = sha256_file(checkpoint_path)
    if checkpoint_sha != CHECKPOINT_SHA256:
        raise ValueError(f"checkpoint digest mismatch: expected {CHECKPOINT_SHA256}, got {checkpoint_sha}")
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()
    if source_commit != SOURCE_COMMIT:
        raise ValueError(f"source commit mismatch: expected {SOURCE_COMMIT}, got {source_commit}")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "sam3/model", "sam3/sam"],
        cwd=source_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if status:
        raise RuntimeError(f"source working tree is dirty under load-bearing paths: {status}")
    return checkpoint_sha, source_commit


def build_memory_encoder(classes: dict, state: dict):
    position_encoding = classes["PositionEmbeddingSine"](
        num_pos_feats=256,
        temperature=10000,
        normalize=True,
        scale=None,
        precompute_resolution=None,
    )
    mask_downsampler = classes["SimpleMaskDownSampler"](
        embed_dim=256,
        kernel_size=3,
        stride=2,
        padding=1,
        total_stride=16,
        interpol_size=[32, 32],
        multiplex_count=16,
        starting_out_chan=4,
        input_channel_multiplier=2,
    )
    fuser = classes["SimpleFuser"](
        layer=classes["CXBlock"](
            dim=256,
            kernel_size=7,
            padding=3,
            layer_scale_init_value=1e-6,
            use_dwconv=True,
        ),
        num_layers=2,
    )
    encoder = classes["SimpleMaskEncoder"](
        out_dim=256,
        mask_downsampler=mask_downsampler,
        fuser=fuser,
        position_encoding=position_encoding,
        in_dim=256,
    )
    prefix = "tracker.model.maskmem_backbone."
    encoder.load_state_dict({key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix)}, strict=True)
    encoder.eval()
    return encoder


def build_memory_proxy(encoder, state):
    return types.SimpleNamespace(
        hidden_dim=256,
        non_overlap_masks_for_mem_enc=False,
        training=False,
        apply_sigmoid_to_mask_logits_for_mem_enc=True,
        binarize_mask_from_pts_for_mem_enc=False,
        sigmoid_scale_for_mem_enc=2.0,
        sigmoid_bias_for_mem_enc=-1.0,
        add_object_conditional_embeddings=False,
        condition_as_mask_input=True,
        condition_as_mask_input_fg=1.0,
        condition_as_mask_input_bg=0.0,
        maskmem_backbone=encoder,
        no_obj_embed_spatial=state["tracker.model.no_obj_embed_spatial"].detach().float(),
        object_score_logit_threshold=0.0,
        _maybe_clone=lambda value: value.clone(),
    )


def decode_frame(decoder, pointer_projection, no_object_projection, image, position, high0, high1, extra):
    output = decoder(
        image_embeddings=image,
        image_pe=position,
        high_res_features=[high0, high1],
        multimask_output=True,
        extra_per_object_embeddings=extra,
    )
    masks = output["masks"][0]
    ious = output["iou_pred"][0]
    tokens = output["sam_tokens_out"][0]
    scores = output["object_score_logits"][0]
    best = torch.argmax(ious, dim=-1)
    objects = torch.arange(16)
    selected_masks = masks[objects, best].unsqueeze(1)
    selected_tokens = tokens[objects, best]
    projected_pointers = pointer_projection(selected_tokens)
    appearing = scores[:, 0] > 0.0
    pointers = torch.where(appearing[:, None], projected_pointers, no_object_projection(projected_pointers))
    return {
        "masks": masks,
        "ious": ious,
        "tokens": tokens,
        "scores": scores,
        "best": best,
        "selected_masks": selected_masks,
        "projected_pointers": projected_pointers,
        "appearing": appearing,
        "pointers": pointers,
    }


def write_failure_receipt(args, error: Exception):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)
    receipt = {
        "ok": False,
        "schema": "kaminos.sam31-two-frame-tracker-meta-reference-receipt.v0",
        "failurePhase": FAILURE_PHASE,
        "error": f"{type(error).__name__}: {error}",
        "requested": {"checkpoint": str(Path(args.checkpoint).resolve()), "sourceRoot": str(Path(args.source_root).resolve()), "seed": args.seed},
        "expected": {"modelRevision": HF_REVISION, "checkpointSha256": CHECKPOINT_SHA256, "sourceCommit": SOURCE_COMMIT},
        "lastTrustworthyEvidence": "No primary two-frame tracker packet was published.",
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
    tool_root = Path(__file__).resolve().parent
    decoder_tool = load_tool("sam31_decoder_packet_tool", tool_root / "sam31-multiplex-mask-decoder-meta-packet.py")
    memory_tool = load_tool("sam31_memory_packet_tool", tool_root / "sam31-propagation-memory-meta-packet.py")
    temporal_tool = load_tool("sam31_temporal_packet_tool", tool_root / "sam31-temporal-memory-bank-meta-packet.py")

    FAILURE_PHASE = "official-module-load"
    transformer_module, decoder_module = decoder_tool.load_official_modules(source_root)
    memory_classes = memory_tool.load_official_classes(source_root)
    temporal_decoder_module, video_module = temporal_tool.load_official_modules(source_root)
    multiplex_module = importlib.import_module("sam3.model.multiplex_utils")

    FAILURE_PHASE = "checkpoint-load"
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    decoder, pointer_projection, no_object_projection = decoder_tool.build_decoder(transformer_module, decoder_module, state)
    memory_encoder = build_memory_encoder(memory_classes, state)
    memory_proxy = build_memory_proxy(memory_encoder, state)
    official_attention = temporal_tool.build_official_encoder(temporal_decoder_module)
    attention_prefix = "tracker.model.transformer.encoder."
    official_attention.load_state_dict({key.removeprefix(attention_prefix): value for key, value in state.items() if key.startswith(attention_prefix)}, strict=True)
    official_attention.eval()
    capturing_attention = temporal_tool.CapturingEncoder(official_attention)
    temporal_proxy = temporal_tool.make_proxy(video_module, capturing_attention, state)
    multiplex_state = multiplex_module.MultiplexState(
        assignments=[list(range(16))],
        device=torch.device("cpu"),
        dtype=torch.float32,
        allowed_bucket_capacity=16,
    )

    FAILURE_PHASE = "official-two-frame-execution"
    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    random = lambda shape, scale: torch.randn(shape, generator=generator, dtype=torch.float32) * scale
    frame0_inputs = {
        "image": random((1, 256, 2, 2), 0.04),
        "position": random((1, 256, 2, 2), 0.02),
        "high0": random((1, 32, 8, 8), 0.03),
        "high1": random((1, 64, 4, 4), 0.03),
        "extra": random((1, 16, 256), 1.0),
    }
    frame1_inputs = {
        "image": random((1, 256, 2, 2), 0.04),
        "position": random((1, 256, 2, 2), 0.02),
        "high0": random((1, 32, 8, 8), 0.03),
        "high1": random((1, 64, 4, 4), 0.03),
        "extra": random((1, 16, 256), 1.0),
    }
    with torch.inference_mode():
        frame0 = decode_frame(decoder, pointer_projection, no_object_projection, **frame0_inputs)
        frame0_memory_input_masks = torch.where(
            frame0["appearing"][:, None, None, None],
            frame0["selected_masks"],
            NO_OBJ_SCORE,
        )
        frame0_tokens = frame0_inputs["image"].flatten(2).permute(2, 0, 1)
        frame0_memory, frame0_memory_pos = video_module.VideoTrackingMultiplex._encode_new_memory(
            memory_proxy,
            image=torch.zeros((1, 3, 8, 8), dtype=torch.float32),
            current_vision_feats=[frame0_tokens],
            feat_sizes=[(2, 2)],
            pred_masks_high_res=frame0_memory_input_masks,
            object_score_logits=frame0["scores"],
            is_mask_from_pts=True,
            conditioning_objects=range(16),
            multiplex_state=multiplex_state,
        )
        frame1_tokens = frame1_inputs["image"].flatten(2).permute(2, 0, 1)
        frame1_position_tokens = frame1_inputs["position"].flatten(2).permute(2, 0, 1)
        output_dict = {
            "cond_frame_outputs": {
                0: {
                    "maskmem_features": frame0_memory,
                    "maskmem_pos_enc": frame0_memory_pos,
                    "image_features": frame0_tokens,
                    "image_pos_enc": frame0_inputs["position"].flatten(2).permute(2, 0, 1),
                    "obj_ptr": frame0["pointers"].unsqueeze(0),
                },
            },
            "non_cond_frame_outputs": {},
        }
        original_cuda = torch.Tensor.cuda
        original_pin_memory = torch.Tensor.pin_memory
        torch.Tensor.cuda = lambda self, *_args, **_kwargs: self
        torch.Tensor.pin_memory = lambda self, *_args, **_kwargs: self
        try:
            conditioned = video_module.VideoTrackingMultiplex._prepare_memory_conditioned_features(
                temporal_proxy,
                frame_idx=1,
                is_init_cond_frame=False,
                current_vision_feats=[frame1_tokens],
                current_vision_masks=[None],
                current_vision_pos_embeds=[frame1_position_tokens],
                feat_sizes=[(2, 2)],
                output_dict=output_dict,
                num_frames=2,
                track_in_reverse=False,
                use_prev_mem_frame=True,
                multiplex_state=multiplex_state,
            )
        finally:
            torch.Tensor.cuda = original_cuda
            torch.Tensor.pin_memory = original_pin_memory
        frame1 = decode_frame(decoder, pointer_projection, no_object_projection, image=conditioned, position=frame1_inputs["position"], high0=frame1_inputs["high0"], high1=frame1_inputs["high1"], extra=frame1_inputs["extra"])

    captured = capturing_attention.inputs
    if captured is None or captured["num_obj_ptr_tokens"] != 16:
        raise RuntimeError("official frame-one attention did not consume exactly sixteen frame-zero pointers")
    if tuple(captured["memory"].shape) != (20, 1, 256):
        raise RuntimeError(f"official frame-one memory bank shape mismatch: {tuple(captured['memory'].shape)}")

    FAILURE_PHASE = "artifact-write"
    tensors = {
        "frame-0-image-embedding": frame0_inputs["image"].permute(0, 2, 3, 1),
        "frame-0-image-position": frame0_inputs["position"].permute(0, 2, 3, 1),
        "frame-0-high-resolution-s0": frame0_inputs["high0"],
        "frame-0-high-resolution-s1": frame0_inputs["high1"],
        "frame-0-extra-per-object-embedding": frame0_inputs["extra"],
        "frame-0-selected-masks": frame0["selected_masks"],
        "frame-0-memory-input-masks": frame0_memory_input_masks,
        "frame-0-object-scores": frame0["scores"],
        "frame-0-object-pointers": frame0["pointers"],
        "frame-0-memory-features": frame0_memory.permute(0, 2, 3, 1),
        "frame-0-memory-position": frame0_memory_pos[-1].permute(0, 2, 3, 1),
        "frame-1-image-embedding": frame1_inputs["image"].permute(0, 2, 3, 1),
        "frame-1-image-position": frame1_inputs["position"].permute(0, 2, 3, 1),
        "frame-1-high-resolution-s0": frame1_inputs["high0"],
        "frame-1-high-resolution-s1": frame1_inputs["high1"],
        "frame-1-extra-per-object-embedding": frame1_inputs["extra"],
        "frame-1-assembled-memory-image": captured["memory_image"].transpose(0, 1),
        "frame-1-assembled-memory": captured["memory"].transpose(0, 1),
        "frame-1-assembled-memory-image-position": captured["memory_image_pos"].transpose(0, 1),
        "frame-1-assembled-memory-position": captured["memory_pos"].transpose(0, 1),
        "frame-1-memory-conditioned-features": conditioned.permute(0, 2, 3, 1),
        "frame-1-selected-masks": frame1["selected_masks"],
        "frame-1-object-scores": frame1["scores"],
        "frame-1-object-pointers": frame1["pointers"],
    }
    entries = []
    for role, tensor in tensors.items():
        file_name = f"{role}.f32.bin"
        entries.append({"role": role, **write_array(out_dir / file_name, tensor)})

    appearing0 = int(frame0["appearing"].sum().item())
    appearing1 = int(frame1["appearing"].sum().item())
    reference = {
        "model": {"id": "facebook/sam3.1", "revision": HF_REVISION, "checkpointFile": checkpoint_path.name, "sha256": checkpoint_sha},
        "source": {"repository": "facebookresearch/sam3", "root": str(source_root), "commit": source_commit, "workingTreeClean": True},
        "execution": {
            "kind": "pinned-official-two-frame-composed-method-and-module-execution",
            "decoderClass": "MultiplexMaskDecoder",
            "memoryMethod": "VideoTrackingMultiplex._encode_new_memory",
            "temporalMethod": "VideoTrackingMultiplex._prepare_memory_conditioned_features",
            "attentionClass": "TransformerEncoderDecoupledCrossAttention",
        },
        "framework": {"name": "torch", "version": torch.__version__, "device": "cpu"},
    }
    manifest = {
        "schema": SCHEMA,
        "mode": "official-meta-two-frame-decoder-memory-attention-decoder",
        "boundary": "frame-0-decoder-to-memory-state-to-frame-1-conditioned-decoder",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "fixture": {"seed": args.seed, "kind": "deterministic-two-frame-mixed-object-presence", "sourceFeaturesSynthetic": True},
        "componentManifests": {"decoder": "/oracle/decoder/tensor-manifest.json", "memory": "/oracle/memory/tensor-manifest.json", "temporal": "/oracle/temporal/tensor-manifest.json"},
        "shape": {"batch": 1, "multiplexCount": 16, "queryHeight": 2, "queryWidth": 2, "queryTokens": 4, "memorySpatialTokens": 4, "numObjPtrTokens": 16, "memoryTokens": 20, "channels": 256, "maskHeight": 8, "maskWidth": 8},
        "plan": {"frameIndex": 1, "numFrames": 2, "conditioningFrameIndices": [0], "nonConditioningFrameIndices": [], "selectedConditioningFrameIndices": [0], "spatialFrameIndices": [0], "spatialTemporalPositionIndices": [5], "pointerFrameIndices": [0], "pointerRelativePositions": [1], "numMaskmem": 7, "maxConditioningFrames": 4, "maxObjectPointerFrames": 2, "memoryTemporalStride": 1, "useMaskmemTemporalPositionV2": True, "trackInReverse": False},
        "stateTransition": {
            "frame0Kind": "conditioning",
            "frame1Kind": "non-conditioning",
            "conditioningObjects": list(range(16)),
            "frame0AppearingObjectCount": appearing0,
            "frame0AbsentObjectCount": 16 - appearing0,
            "frame0SuppressedAbsentMaskCount": 16 - appearing0,
            "noObjectMaskScore": NO_OBJ_SCORE,
            "frame1AppearingObjectCount": appearing1,
            "frame1AbsentObjectCount": 16 - appearing1,
        },
        "claims": {"officialFrame0DecoderExecuted": True, "officialMemoryMethodExecuted": True, "officialTemporalMethodExecuted": True, "officialMemoryAttentionExecuted": True, "officialFrame1DecoderExecuted": True, "fullImageBackboneExecuted": False},
        "tolerances": {"decoderMaxAbsDiff": 0.0015, "memoryMaxAbsDiff": 0.0008, "bankMaxAbsDiff": 0.0001, "conditionedMaxAbsDiff": 0.0001},
        "tensors": entries,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    manifest_text = json.dumps(manifest, indent=2)
    receipt = {
        "ok": True,
        "schema": "kaminos.sam31-two-frame-tracker-meta-reference-receipt.v0",
        "boundary": manifest["boundary"],
        "reference": reference,
        "shape": manifest["shape"],
        "plan": manifest["plan"],
        "stateTransition": manifest["stateTransition"],
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
