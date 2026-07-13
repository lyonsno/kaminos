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


ROUTE_ID = "sam3.1.memory-attention.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam31-memory-attention-meta-packet.v0"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
FAILURE_PHASE = "argument-resolution"


def parse_args():
    parser = argparse.ArgumentParser(description="Export a pinned Meta SAM3.1 four-layer memory-attention component packet.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--source-root", default=str(Path.home() / "dev/sam3"))
    parser.add_argument("--seed", type=int, default=3117)
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


def load_decoder_module(source_root: Path):
    sam3_root = source_root / "sam3"
    if not (sam3_root / "model" / "decoder.py").is_file():
        raise FileNotFoundError(f"official decoder source not found under {sam3_root}")
    for name, path in (("sam3", sam3_root), ("sam3.model", sam3_root / "model"), ("sam3.sam", sam3_root / "sam")):
        package = types.ModuleType(name)
        package.__path__ = [str(path)]
        sys.modules[name] = package
    decoder = importlib.import_module("sam3.model.decoder")
    decoder.sdpa_kernel = lambda *args, **kwargs: contextlib.nullcontext()
    return decoder


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


def weight_specs():
    specs = []
    prefix = "tracker.model.transformer.encoder"
    projection_names = {
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
        for role_name, source_name in projection_names.items():
            for suffix in ("weight", "bias"):
                specs.append((f"layer-{layer}-{role_name}-{suffix}", f"{layer_prefix}.{source_name}.{suffix}", "out,in" if suffix == "weight" else "out"))
        for norm in ("norm1", "norm2", "norm3"):
            for suffix in ("weight", "bias"):
                specs.append((f"layer-{layer}-{norm}-{suffix}", f"{layer_prefix}.{norm}.{suffix}", "channels"))
    specs.extend([
        ("final-norm-weight", f"{prefix}.norm.weight", "channels"),
        ("final-norm-bias", f"{prefix}.norm.bias", "channels"),
    ])
    return specs


def write_failure_receipt(args, error: Exception):
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    invalidate_primary_outputs(out_dir)
    receipt = {
        "ok": False,
        "schema": "kaminos.sam31-memory-attention-meta-reference-receipt.v0",
        "failurePhase": FAILURE_PHASE,
        "error": f"{type(error).__name__}: {error}",
        "requested": {"checkpoint": str(Path(args.checkpoint).resolve()), "sourceRoot": str(Path(args.source_root).resolve()), "seed": args.seed},
        "expected": {"modelRevision": HF_REVISION, "checkpointSha256": CHECKPOINT_SHA256, "sourceCommit": SOURCE_COMMIT},
        "lastTrustworthyEvidence": "No primary memory-attention tensor packet was published.",
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
    decoder = load_decoder_module(source_root)

    FAILURE_PHASE = "checkpoint-load"
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    if not isinstance(state, dict):
        raise TypeError("official checkpoint must be a flat state dictionary")
    encoder = build_official_encoder(decoder)
    prefix = "tracker.model.transformer.encoder."
    encoder_state = {key.removeprefix(prefix): value for key, value in state.items() if key.startswith(prefix)}
    encoder.load_state_dict(encoder_state, strict=True)
    encoder.eval()

    FAILURE_PHASE = "checkpoint-audit"
    specs = weight_specs()
    weight_entries = []
    for role, source_key, layout in specs:
        if source_key not in state:
            raise KeyError(f"official checkpoint is missing {source_key}")
        tensor = state[source_key].detach().cpu().float().numpy()
        file_name = f"{role}.f32.bin"
        written = write_array(out_dir / file_name, tensor)
        weight_entries.append({
            "role": role,
            "file": file_name,
            "sha256": written["sha256"],
            "byteLength": written["byteLength"],
            "dtype": "float32",
            "shape": written["shape"],
            "layout": layout,
            "officialKey": source_key,
        })

    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    random = lambda shape, scale=0.03: torch.randn(shape, generator=generator, dtype=torch.float32) * scale
    current_image = random((1, 4, 256))
    current_src = random((1, 4, 256))
    current_src_pos = random((1, 4, 256), 0.01)
    memory_image = random((1, 4, 256))
    memory = random((1, 20, 256))
    memory_image_pos = random((1, 4, 256), 0.01)
    memory_pos = random((1, 20, 256), 0.01)
    memory[:, 4:, :] += torch.linspace(-0.08, 0.08, 16, dtype=torch.float32)[None, :, None]

    FAILURE_PHASE = "official-reference-execution"
    official_layer_outputs = []
    hooks = [
        layer.register_forward_hook(
            lambda _module, _inputs, output: official_layer_outputs.append(output[1].detach().clone())
        )
        for layer in encoder.layers
    ]
    with torch.inference_mode():
        try:
            result = encoder(
                image=current_image.transpose(0, 1),
                src=current_src.transpose(0, 1),
                memory_image=memory_image.transpose(0, 1),
                memory=memory.transpose(0, 1),
                image_pos=current_src_pos.transpose(0, 1),
                src_pos=current_src_pos.transpose(0, 1),
                memory_image_pos=memory_image_pos.transpose(0, 1),
                memory_pos=memory_pos.transpose(0, 1),
                num_obj_ptr_tokens=16,
            )
        finally:
            for hook in hooks:
                hook.remove()
    if len(official_layer_outputs) != 4:
        raise RuntimeError(f"official layer witness count mismatch: expected 4, got {len(official_layer_outputs)}")
    expected_memory = result["memory"].transpose(0, 1).contiguous()

    FAILURE_PHASE = "artifact-write"
    tensor_specs = [
        ("current-image", current_image, "B,Q,C"),
        ("current-src", current_src, "B,Q,C"),
        ("current-src-pos", current_src_pos, "B,Q,C"),
        ("memory-image", memory_image, "B,S,C"),
        ("memory", memory, "B,K,C"),
        ("memory-image-pos", memory_image_pos, "B,S,C"),
        ("memory-pos", memory_pos, "B,K,C"),
        *[(f"expected-layer-{index}-memory", output, "B,Q,C") for index, output in enumerate(official_layer_outputs)],
        ("expected-memory", expected_memory, "B,Q,C"),
    ]
    tensor_entries = []
    for role, tensor, layout in tensor_specs:
        file_name = f"{role}.f32.bin"
        written = write_array(out_dir / file_name, tensor.detach().cpu().numpy())
        tensor_entries.append({"role": role, "file": file_name, "sha256": written["sha256"], "byteLength": written["byteLength"], "dtype": "float32", "shape": written["shape"], "layout": layout})

    shape = {
        "batch": 1,
        "queryHeight": 2,
        "queryWidth": 2,
        "queryTokens": 4,
        "memorySpatialTokens": 4,
        "numObjPtrTokens": 16,
        "memoryTokens": 20,
        "channels": 256,
        "heads": 8,
        "headDim": 32,
        "mlpHidden": 2048,
        "layerCount": 4,
    }
    reference = {
        "model": {"id": "facebook/sam3.1", "revision": HF_REVISION, "checkpointFile": checkpoint_path.name, "sha256": checkpoint_sha},
        "source": {"repository": "facebookresearch/sam3", "root": str(source_root), "commit": source_commit, "workingTreeClean": True},
        "execution": {"kind": "pinned-official-module-class", "class": "sam3.model.decoder.TransformerEncoderDecoupledCrossAttention", "attentionBackend": "torch-cpu-scaled-dot-product-attention"},
        "framework": {"name": "torch", "version": torch.__version__, "device": "cpu"},
    }
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "official-meta-memory-attention-component-export",
        "boundary": "sam31-four-layer-decoupled-cross-attention-with-pointer-tail",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "fixture": {"seed": args.seed, "kind": "deterministic-algebraic-component", "officialVideoPath": False, "queryGrid": "2x2", "pointerTailTokens": 16},
        "shape": shape,
        "claims": {"officialModuleExecuted": True, "fullSam31VideoPath": False, "fullResolution72x72": False, "pointerTailPreserved": True, "fourLayersExecuted": True},
        "checkpointAudit": {"officialStateTensorCount": len(state), "mappedTensorCount": len(specs), "allMappedOfficialKeysPresent": True},
        "tolerances": {"cpuOracleMaxAbsDiff": 0.00008, "webGpuMaxAbsDiff": 0.0015},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    receipt = {
        "ok": True,
        "schema": "kaminos.sam31-memory-attention-meta-reference-receipt.v0",
        "routeId": ROUTE_ID,
        "boundary": manifest["boundary"],
        "reference": reference,
        "checkpointAudit": manifest["checkpointAudit"],
        "shape": shape,
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
