#!/usr/bin/env python3
import argparse
import contextlib
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


ROUTE_ID = "sam3.1.temporal-memory-bank.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam31-temporal-memory-bank-meta-packet.v0"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
FAILURE_PHASE = "argument-resolution"


def parse_args():
    parser = argparse.ArgumentParser(description="Export an official Meta SAM3.1 multi-frame temporal memory-bank episode.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--source-root", default=str(Path.home() / "dev/sam3"))
    parser.add_argument("--seed", type=int, default=3129)
    return parser.parse_args()


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return f"sha256:{digest.hexdigest()}"


def source_revision(source_root: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()


def require_clean_source_tree(source_root: Path) -> None:
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "sam3/model", "sam3/sam"],
        cwd=source_root,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if status:
        changed = ", ".join(line[3:] for line in status.splitlines()[:8])
        raise RuntimeError(f"source working tree is dirty under load-bearing paths: {changed}")


def invalidate_primary_outputs(out_dir: Path) -> None:
    (out_dir / "tensor-manifest.json").unlink(missing_ok=True)
    for path in out_dir.glob("*.bin"):
        path.unlink()


def write_array(path: Path, array: np.ndarray) -> dict:
    contiguous = np.ascontiguousarray(array, dtype=np.float32)
    data = contiguous.tobytes(order="C")
    path.write_bytes(data)
    return {"file": path.name, "sha256": sha256_bytes(data), "byteLength": len(data), "shape": list(contiguous.shape)}


def load_official_modules(source_root: Path):
    sam3_root = source_root / "sam3"
    for name, path in (("sam3", sam3_root), ("sam3.model", sam3_root / "model"), ("sam3.sam", sam3_root / "sam")):
        package = types.ModuleType(name)
        package.__path__ = [str(path)]
        sys.modules[name] = package
    # sam3_tracker_utils imports EDT for training-only point sampling; temporal
    # memory assembly never calls it, and Triton is unavailable on this CPU host.
    edt = types.ModuleType("sam3.model.edt")
    edt.edt_triton = lambda *_args, **_kwargs: None
    sys.modules["sam3.model.edt"] = edt
    decoder = importlib.import_module("sam3.model.decoder")
    decoder.sdpa_kernel = lambda *_args, **_kwargs: contextlib.nullcontext()
    video = importlib.import_module("sam3.model.video_tracking_multiplex")
    return decoder, video


def build_official_encoder(decoder):
    self_attention = decoder.SimpleRoPEAttention(
        d_model=256,
        num_heads=8,
        dropout_p=0.1,
        rope_theta=10000.0,
        feat_sizes=[2, 2],
        use_fa3=False,
        use_rope_real=False,
    )
    cross_attention = decoder.SimpleRoPEAttention(
        d_model=256,
        num_heads=8,
        dropout_p=0.1,
        rope_theta=10000.0,
        feat_sizes=[2, 2],
        rope_k_repeat=True,
        use_fa3=False,
        use_rope_real=False,
    )
    layer = decoder.DecoupledTransformerDecoderLayerv2(
        activation="gelu",
        d_model=256,
        num_heads=8,
        dropout=0.1,
        dim_feedforward=2048,
        pos_enc_at_attn=False,
        pre_norm=True,
        pos_enc_at_cross_attn_keys=True,
        pos_enc_at_cross_attn_queries=False,
        self_attention_rope=self_attention,
        cross_attention_rope=cross_attention,
    )
    return decoder.TransformerEncoderDecoupledCrossAttention(
        d_model=256,
        frozen=False,
        pos_enc_at_input=True,
        use_image_in_output=False,
        layer=layer,
        num_layers=4,
        use_act_checkpoint=False,
        batch_first=True,
    )


def memory_attention_weight_specs():
    specs = []
    prefix = "tracker.model.transformer.encoder"
    projections = {
        "self-q": "self_attn_q_proj",
        "self-k": "self_attn_k_proj",
        "self-v": "self_attn_v_proj",
        "self-out": "self_attn_out_proj",
        "cross-q": "cross_attn_q_proj",
        "cross-k": "cross_attn_k_proj",
        "cross-v": "cross_attn_v_proj",
        "cross-out": "cross_attn_out_proj",
        "image-cross-q": "image_cross_attn_q_proj",
        "image-cross-k": "image_cross_attn_k_proj",
        "linear1": "linear1",
        "linear2": "linear2",
    }
    for layer in range(4):
        layer_prefix = f"{prefix}.layers.{layer}"
        for role, source in projections.items():
            for suffix in ("weight", "bias"):
                specs.append((f"layer-{layer}-{role}-{suffix}", f"{layer_prefix}.{source}.{suffix}", "out,in" if suffix == "weight" else "out"))
        for norm in ("norm1", "norm2", "norm3"):
            for suffix in ("weight", "bias"):
                specs.append((f"layer-{layer}-{norm}-{suffix}", f"{layer_prefix}.{norm}.{suffix}", "channels"))
    specs.extend([
        ("final-norm-weight", f"{prefix}.norm.weight", "channels"),
        ("final-norm-bias", f"{prefix}.norm.bias", "channels"),
    ])
    return specs


class MultiplexState:
    num_buckets = 1
    multiplex_count = 16

    @staticmethod
    def demux(value):
        raise AssertionError(f"unexpected demux for fixture tensor shape {tuple(value.shape)}")


class CapturingEncoder(nn.Module):
    def __init__(self, encoder):
        super().__init__()
        self.encoder = encoder
        self.inputs = None

    def forward(self, **kwargs):
        self.inputs = {
            key: value.detach().clone()
            for key, value in kwargs.items()
            if isinstance(value, torch.Tensor)
        }
        self.inputs["num_obj_ptr_tokens"] = kwargs["num_obj_ptr_tokens"]
        return self.encoder(**kwargs)


def make_proxy(video, encoder, state):
    proxy = types.SimpleNamespace(
        num_maskmem=7,
        memory_temporal_stride_for_eval=1,
        use_memory_selection=False,
        save_image_features=True,
        max_cond_frames_in_attn=4,
        keep_first_cond_frame=False,
        use_maskmem_tpos_v2=True,
        use_obj_ptrs_in_encoder=True,
        max_obj_ptrs_in_encoder=16,
        only_obj_ptrs_in_the_past_for_eval=False,
        use_signed_tpos_enc_to_obj_ptrs=False,
        add_tpos_enc_to_obj_ptrs=True,
        mem_dim=256,
        hidden_dim=256,
        proj_tpos_enc_in_obj_ptrs=True,
        sincos_tpos_enc=True,
        training=False,
        maskmem_tpos_enc=state["tracker.model.maskmem_tpos_enc"].detach().float(),
        obj_ptr_tpos_proj=nn.Linear(256, 256),
        transformer=types.SimpleNamespace(encoder=encoder),
    )
    proxy.obj_ptr_tpos_proj.load_state_dict({
        "weight": state["tracker.model.obj_ptr_tpos_proj.weight"],
        "bias": state["tracker.model.obj_ptr_tpos_proj.bias"],
    }, strict=True)
    proxy.obj_ptr_tpos_proj.eval()
    proxy._get_tpos_enc = types.MethodType(video.VideoTrackingMultiplex._get_tpos_enc, proxy)
    return proxy


def tensor_to_btc(tensor):
    return tensor.transpose(0, 1).contiguous()


def build_episode(generator):
    random = lambda shape, scale=0.03: torch.randn(shape, generator=generator, dtype=torch.float32) * scale
    all_frames = [0, 1, 2, 3, 4, 5, 6, 7, 9, 10]
    outputs = {}
    for frame in all_frames:
        offset = frame * 0.002
        outputs[frame] = {
            "maskmem_features": random((1, 256, 2, 2)) + offset,
            "maskmem_pos_enc": [random((1, 256, 2, 2), 0.01) - offset],
            "image_features": random((4, 1, 256)) + offset * 0.5,
            "image_pos_enc": random((4, 1, 256), 0.01) + offset * 0.25,
            "obj_ptr": random((1, 16, 256)) + offset * 1.5,
        }
    cond_indices = [0, 1, 3, 9, 10]
    non_cond_indices = [2, 4, 5, 6, 7]
    return {
        "cond_frame_outputs": {frame: outputs[frame] for frame in cond_indices},
        "non_cond_frame_outputs": {frame: outputs[frame] for frame in non_cond_indices},
    }, outputs


def independent_assembly(proxy, outputs, selected, spatial_indices, spatial_tpos_indices, pointer_indices, pointer_relative):
    memory = []
    memory_pos = []
    image = []
    image_pos = []
    for frame, tpos_index in zip(spatial_indices, spatial_tpos_indices):
        output = outputs[frame]
        temporal = proxy.maskmem_tpos_enc[tpos_index]
        memory.append(output["maskmem_features"].flatten(2).transpose(1, 2))
        memory_pos.append(output["maskmem_pos_enc"][-1].flatten(2).transpose(1, 2) + temporal)
        image.append(tensor_to_btc(output["image_features"]))
        image_pos.append(tensor_to_btc(output["image_pos_enc"]) + temporal)
    pointer_values = torch.cat([outputs[frame]["obj_ptr"] for frame in pointer_indices], dim=1)
    with torch.inference_mode():
        pointer_positions = proxy._get_tpos_enc(pointer_relative, max_abs_pos=11, device=torch.device("cpu"))
    pointer_positions = pointer_positions.repeat_interleave(16, dim=0).unsqueeze(0)
    return {
        "memory_image": torch.cat(image, dim=1),
        "memory": torch.cat([torch.cat(memory, dim=1), pointer_values], dim=1),
        "memory_image_pos": torch.cat(image_pos, dim=1),
        "memory_pos": torch.cat([torch.cat(memory_pos, dim=1), pointer_positions], dim=1),
    }


def max_abs(left, right):
    return float(torch.max(torch.abs(left.float() - right.float())).item())


def write_failure_receipt(args, error: Exception):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)
    receipt = {
        "ok": False,
        "schema": "kaminos.sam31-temporal-memory-bank-meta-reference-receipt.v0",
        "failurePhase": FAILURE_PHASE,
        "error": f"{type(error).__name__}: {error}",
        "requested": {"checkpoint": str(Path(args.checkpoint).resolve()), "sourceRoot": str(Path(args.source_root).resolve()), "seed": args.seed},
        "expected": {"modelRevision": HF_REVISION, "checkpointSha256": CHECKPOINT_SHA256, "sourceCommit": SOURCE_COMMIT},
        "lastTrustworthyEvidence": "No primary temporal memory-bank tensor packet was published.",
    }
    (out_dir / "reference-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")


def main():
    global FAILURE_PHASE
    args = parse_args()
    checkpoint_path = Path(args.checkpoint).resolve()
    source_root = Path(args.source_root).resolve()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)

    FAILURE_PHASE = "identity-validation"
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"official checkpoint not found: {checkpoint_path}")
    checkpoint_sha = sha256_file(checkpoint_path)
    if checkpoint_sha != CHECKPOINT_SHA256:
        raise ValueError(f"checkpoint digest mismatch: expected {CHECKPOINT_SHA256}, got {checkpoint_sha}")
    source_commit = source_revision(source_root)
    if source_commit != SOURCE_COMMIT:
        raise ValueError(f"source commit mismatch: expected {SOURCE_COMMIT}, got {source_commit}")
    require_clean_source_tree(source_root)
    decoder, video = load_official_modules(source_root)

    FAILURE_PHASE = "checkpoint-load"
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    encoder = build_official_encoder(decoder)
    encoder_prefix = "tracker.model.transformer.encoder."
    encoder.load_state_dict({key.removeprefix(encoder_prefix): value for key, value in state.items() if key.startswith(encoder_prefix)}, strict=True)
    encoder.eval()
    capturing_encoder = CapturingEncoder(encoder)
    proxy = make_proxy(video, capturing_encoder, state)

    FAILURE_PHASE = "official-video-memory-execution"
    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    output_dict, outputs = build_episode(generator)
    current_vision = torch.randn((4, 1, 256), generator=generator, dtype=torch.float32) * 0.03
    current_position = torch.randn((4, 1, 256), generator=generator, dtype=torch.float32) * 0.01
    original_cuda = torch.Tensor.cuda
    original_pin_memory = torch.Tensor.pin_memory
    torch.Tensor.cuda = lambda self, *_args, **_kwargs: self
    torch.Tensor.pin_memory = lambda self, *_args, **_kwargs: self
    try:
        with torch.inference_mode():
            conditioned = video.VideoTrackingMultiplex._prepare_memory_conditioned_features(
                proxy,
                frame_idx=8,
                is_init_cond_frame=False,
                current_vision_feats=[current_vision],
                current_vision_masks=[None],
                current_vision_pos_embeds=[current_position],
                feat_sizes=[(2, 2)],
                output_dict=output_dict,
                num_frames=11,
                track_in_reverse=False,
                use_prev_mem_frame=True,
                multiplex_state=MultiplexState(),
            )
    finally:
        torch.Tensor.cuda = original_cuda
        torch.Tensor.pin_memory = original_pin_memory

    captured = capturing_encoder.inputs
    if captured is None:
        raise RuntimeError("official tracker method did not call the memory-attention encoder")
    selected = [3, 9, 10, 1]
    unselected = [0]
    spatial_indices = [3, 9, 10, 1, 2, 4, 5, 6, 7]
    spatial_tpos_indices = [1, 6, 6, 6, 5, 3, 2, 1, 0]
    pointer_indices = [3, 9, 10, 1, 7, 6, 5, 4, 2, 0]
    pointer_relative = [5, 1, 2, 7, 1, 2, 3, 4, 6, 8]
    torch.Tensor.pin_memory = lambda self, *_args, **_kwargs: self
    try:
        independent = independent_assembly(proxy, outputs, selected, spatial_indices, spatial_tpos_indices, pointer_indices, pointer_relative)
    finally:
        torch.Tensor.pin_memory = original_pin_memory
    official_bank = {
        "memory_image": tensor_to_btc(captured["memory_image"]),
        "memory": tensor_to_btc(captured["memory"]),
        "memory_image_pos": tensor_to_btc(captured["memory_image_pos"]),
        "memory_pos": tensor_to_btc(captured["memory_pos"]),
    }
    assembly_diffs = {key: max_abs(official_bank[key], independent[key]) for key in official_bank}
    assembly_max = max(assembly_diffs.values())
    if assembly_max != 0.0:
        raise RuntimeError(f"official versus independent temporal assembly mismatch: {assembly_diffs}")
    if captured["num_obj_ptr_tokens"] != 160:
        raise RuntimeError(f"official pointer token count mismatch: {captured['num_obj_ptr_tokens']}")
    expected_conditioned = conditioned.permute(0, 2, 3, 1).reshape(1, 4, 256).contiguous()

    FAILURE_PHASE = "artifact-write"
    tensor_specs = [
        ("current-image", tensor_to_btc(captured["image"]), "B,Q,C"),
        ("current-src", tensor_to_btc(captured["src"]), "B,Q,C"),
        ("current-src-pos", tensor_to_btc(captured["src_pos"]), "B,Q,C"),
        ("spatial-frame-memory", torch.stack([outputs[frame]["maskmem_features"].flatten(2).transpose(1, 2) for frame in spatial_indices]), "F,B,T,C"),
        ("spatial-frame-memory-pos", torch.stack([outputs[frame]["maskmem_pos_enc"][-1].flatten(2).transpose(1, 2) for frame in spatial_indices]), "F,B,T,C"),
        ("spatial-frame-image", torch.stack([tensor_to_btc(outputs[frame]["image_features"]) for frame in spatial_indices]), "F,B,T,C"),
        ("spatial-frame-image-pos", torch.stack([tensor_to_btc(outputs[frame]["image_pos_enc"]) for frame in spatial_indices]), "F,B,T,C"),
        ("pointer-frame-values", torch.stack([outputs[frame]["obj_ptr"] for frame in pointer_indices]), "F,B,M,C"),
        ("maskmem-temporal-embeddings", proxy.maskmem_tpos_enc[:, 0, 0, :], "N,C"),
        ("pointer-position-projection-weight", proxy.obj_ptr_tpos_proj.weight, "out,in"),
        ("pointer-position-projection-bias", proxy.obj_ptr_tpos_proj.bias, "out"),
        ("assembled-memory-image", official_bank["memory_image"], "B,S,C"),
        ("assembled-memory", official_bank["memory"], "B,K,C"),
        ("assembled-memory-image-pos", official_bank["memory_image_pos"], "B,S,C"),
        ("assembled-memory-pos", official_bank["memory_pos"], "B,K,C"),
        ("expected-memory-conditioned-features", expected_conditioned, "B,Q,C"),
    ]
    tensor_entries = []
    for role, tensor, layout in tensor_specs:
        file_name = f"{role}.f32.bin"
        written = write_array(out_dir / file_name, tensor.detach().cpu().numpy())
        tensor_entries.append({"role": role, "file": file_name, "sha256": written["sha256"], "byteLength": written["byteLength"], "dtype": "float32", "shape": written["shape"], "layout": layout})

    attention_entries = []
    specs = memory_attention_weight_specs()
    for role, source_key, layout in specs:
        tensor = state[source_key].detach().cpu().float().numpy()
        file_name = f"attention-{role}.f32.bin"
        written = write_array(out_dir / file_name, tensor)
        attention_entries.append({"role": role, "file": file_name, "sha256": written["sha256"], "byteLength": written["byteLength"], "dtype": "float32", "shape": written["shape"], "layout": layout, "officialKey": source_key})

    shape = {
        "batch": 1,
        "queryHeight": 2,
        "queryWidth": 2,
        "queryTokens": 4,
        "frameTokens": 4,
        "spatialFrameCount": 9,
        "memorySpatialTokens": 36,
        "pointerFrameCount": 10,
        "multiplexCount": 16,
        "numObjPtrTokens": 160,
        "memoryTokens": 196,
        "channels": 256,
    }
    plan = {
        "frameIndex": 8,
        "numFrames": 11,
        "conditioningFrameIndices": [0, 1, 3, 9, 10],
        "nonConditioningFrameIndices": [2, 4, 5, 6, 7],
        "selectedConditioningFrameIndices": selected,
        "unselectedConditioningFrameIndices": unselected,
        "spatialFrameIndices": spatial_indices,
        "spatialTemporalPositionIndices": spatial_tpos_indices,
        "pointerFrameIndices": pointer_indices,
        "pointerRelativePositions": pointer_relative,
        "numMaskmem": 7,
        "maxConditioningFrames": 4,
        "maxObjectPointerFrames": 11,
        "memoryTemporalStride": 1,
        "useMaskmemTemporalPositionV2": True,
        "trackInReverse": False,
    }
    reference = {
        "model": {"id": "facebook/sam3.1", "revision": HF_REVISION, "checkpointFile": checkpoint_path.name, "sha256": checkpoint_sha},
        "source": {"repository": "facebookresearch/sam3", "root": str(source_root), "commit": source_commit, "workingTreeClean": True},
        "execution": {
            "kind": "pinned-official-unbound-method-and-module-class",
            "method": "Sam3VideoTrackingMultiplex._prepare_memory_conditioned_features",
            "encoderClass": "TransformerEncoderDecoupledCrossAttention",
            "attentionBackend": "torch-cpu-scaled-dot-product-attention",
            "unusedTrainingEdtImportShimmed": True,
        },
        "framework": {"name": "torch", "version": torch.__version__, "device": "cpu"},
    }
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "official-meta-multi-frame-temporal-memory-export",
        "boundary": "sam31-video-output-dictionary-to-temporal-bank-to-four-layer-memory-attention",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "fixture": {"seed": args.seed, "kind": "deterministic-multi-frame-video-memory-episode", "sourceFramesSynthetic": True, "officialVideoMemoryMethodExecuted": True},
        "plan": plan,
        "shape": shape,
        "claims": {"officialVideoMemoryAssemblyExecuted": True, "officialMemoryAttentionExecuted": True, "fullSemanticTracking": False, "imageBackboneExecutedForEpisode": False, "maskDecoderExecutedForEpisode": False},
        "checkpointAudit": {"officialStateTensorCount": len(state), "memoryAttentionTensorCount": len(specs), "temporalPositionTensorCount": 3, "allMappedOfficialKeysPresent": True},
        "assemblyParity": {"officialVersusIndependentMaxAbsDiff": assembly_max, "byTensor": assembly_diffs},
        "tolerances": {"webGpuAssemblyMaxAbsDiff": 0.000002, "webGpuConditionedFeaturesMaxAbsDiff": 0.0015},
        "tensors": tensor_entries,
        "attentionWeights": attention_entries,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    receipt = {
        "ok": True,
        "schema": "kaminos.sam31-temporal-memory-bank-meta-reference-receipt.v0",
        "routeId": ROUTE_ID,
        "boundary": manifest["boundary"],
        "reference": reference,
        "plan": plan,
        "shape": shape,
        "checkpointAudit": manifest["checkpointAudit"],
        "assemblyParity": manifest["assemblyParity"],
        "outputs": {"tensorManifest": str(manifest_path), "referenceReceipt": str(receipt_path)},
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    FAILURE_PHASE = "complete"
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        write_failure_receipt(parse_args(), error)
        raise
