#!/usr/bin/env python3
import argparse
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
import torch.nn.functional as F


ROUTE_ID = "sam3.1.interactive-pointer.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam31-interactive-pointer-meta-packet.v0"
HF_REVISION = "daa63191845a41281374e725f4c9e51c7a824460"
SOURCE_COMMIT = "5dd401d1c5c1d5c3eedff06d41b77af824517619"
CHECKPOINT_SHA256 = "sha256:0567debeec80ba4ac6369540c6c248025283cb3ff2b92827509e57e2b3541cb6"
DEFAULT_CHECKPOINT = Path.home() / ".cache/huggingface/hub/models--facebook--sam3.1/snapshots" / HF_REVISION / "sam3.1_multiplex.pt"
FAILURE_PHASE = "argument-resolution"


def parse_args():
    parser = argparse.ArgumentParser(description="Export the official Meta SAM3.1 binary-mask interactive pointer path.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--checkpoint", default=str(DEFAULT_CHECKPOINT))
    parser.add_argument("--source-root", default=str(Path.home() / "dev/sam3"))
    parser.add_argument("--seed", type=int, default=3167)
    parser.add_argument("--ingress-dir")
    parser.add_argument("--expected-ingress-manifest-sha256")
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
        raise ImportError(f"cannot load helper module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def require_identity(checkpoint_path: Path, source_root: Path):
    checkpoint_sha = sha256_file(checkpoint_path)
    if checkpoint_sha != CHECKPOINT_SHA256:
        raise ValueError(f"checkpoint digest mismatch: expected {CHECKPOINT_SHA256}, got {checkpoint_sha}")
    source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source_root, text=True).strip()
    if source_commit != SOURCE_COMMIT:
        raise ValueError(f"source commit mismatch: expected {SOURCE_COMMIT}, got {source_commit}")
    status = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all", "--", "sam3/model/video_tracking_multiplex.py", "sam3/sam"],
        cwd=source_root, check=True, capture_output=True, text=True,
    ).stdout.strip()
    if status:
        raise RuntimeError(f"source working tree is dirty under load-bearing interactive paths: {status}")
    return checkpoint_sha, source_commit


def write_array(path: Path, value) -> dict:
    if isinstance(value, torch.Tensor):
        value = value.detach().cpu().float().numpy()
    array = np.ascontiguousarray(value, dtype=np.float32)
    data = array.tobytes(order="C")
    path.write_bytes(data)
    return {"file": path.name, "sha256": sha256_bytes(data), "byteLength": len(data), "dtype": "float32", "shape": list(array.shape)}


def require_mapping(value, label: str) -> dict:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def require_ingress_tensor(ingress_dir: Path, entries: dict, role: str, expected_shape: tuple[int, ...]) -> torch.Tensor:
    entry = require_mapping(entries.get(role), f"ingress tensor {role}")
    if entry.get("dtype") != "float32" or tuple(entry.get("shape", ())) != expected_shape:
        raise ValueError(f"ingress tensor {role} shape/dtype mismatch: {entry.get('shape')} {entry.get('dtype')}")
    path = ingress_dir / entry.get("file", "")
    if not path.is_file() or path.parent != ingress_dir:
        raise ValueError(f"ingress tensor {role} file is missing or escapes ingress directory")
    data = path.read_bytes()
    if len(data) != entry.get("byteLength") or sha256_bytes(data) != entry.get("sha256"):
        raise ValueError(f"ingress tensor {role} byte authority mismatch")
    return torch.from_numpy(np.frombuffer(data, dtype=np.float32).copy().reshape(expected_shape))


def load_authenticated_ingress(ingress_dir: Path, expected_manifest_sha256: str) -> dict:
    manifest_path = ingress_dir / "tensor-manifest.json"
    receipt_path = ingress_dir / "reference-receipt.json"
    manifest_bytes = manifest_path.read_bytes()
    manifest_sha256 = sha256_bytes(manifest_bytes)
    if manifest_sha256 != expected_manifest_sha256:
        raise ValueError(f"ingress manifest digest mismatch: expected {expected_manifest_sha256}, got {manifest_sha256}")
    manifest = require_mapping(json.loads(manifest_bytes), "ingress manifest")
    receipt = require_mapping(json.loads(receipt_path.read_text(encoding="utf-8")), "ingress reference receipt")
    if manifest.get("schema") != "kaminos.sam31-two-image-ingress-meta-packet.v0":
        raise ValueError(f"unsupported ingress schema {manifest.get('schema')}")
    if receipt.get("ok") is not True or receipt.get("schema") != "kaminos.sam31-two-image-ingress-meta-reference-receipt.v0":
        raise ValueError("ingress reference receipt is not a successful official receipt")
    if receipt.get("primaryOutputWritten") is not True or receipt.get("outputs", {}).get("tensorManifestSha256") != manifest_sha256:
        raise ValueError("ingress reference receipt does not bind the requested manifest")
    reference = require_mapping(manifest.get("reference"), "ingress reference")
    if reference.get("model", {}).get("revision") != HF_REVISION:
        raise ValueError("ingress model revision mismatch")
    if reference.get("source", {}).get("commit") != SOURCE_COMMIT or reference.get("source", {}).get("clean") is not True:
        raise ValueError("ingress source authority mismatch")
    if reference.get("checkpoint", {}).get("sha256") != CHECKPOINT_SHA256:
        raise ValueError("ingress checkpoint authority mismatch")
    if receipt.get("reference") != reference or receipt.get("shape") != manifest.get("shape") or receipt.get("checkpointAudit") != manifest.get("checkpointAudit"):
        raise ValueError("ingress receipt reference, shape, or checkpoint audit mismatch")
    audit = require_mapping(manifest.get("checkpointAudit"), "ingress checkpoint audit")
    if audit.get("allMappedOfficialKeysPresent") is not True or audit.get("allOfficialModuleLoadsAccepted") is not True:
        raise ValueError("ingress checkpoint audit is incomplete")
    shape = require_mapping(manifest.get("shape"), "ingress shape")
    image_height = shape.get("patchHeight")
    image_width = shape.get("patchWidth")
    if not isinstance(image_height, int) or image_height <= 0 or not isinstance(image_width, int) or image_width <= 0:
        raise ValueError("ingress patch geometry is invalid")
    if shape.get("patchTokens") != image_height * image_width:
        raise ValueError("ingress patch token geometry is inconsistent")
    entries = {entry.get("role"): entry for entry in manifest.get("tensors", []) if isinstance(entry, dict)}
    image_embedding = require_ingress_tensor(
        ingress_dir, entries, "frame-0-interactive-feature-2", (1, image_height, image_width, 256),
    ).permute(0, 3, 1, 2).contiguous()
    high_resolution_s0 = require_ingress_tensor(
        ingress_dir, entries, "frame-0-interactive-high-resolution-s0", (1, 32, image_height * 4, image_width * 4),
    )
    high_resolution_s1 = require_ingress_tensor(
        ingress_dir, entries, "frame-0-interactive-high-resolution-s1", (1, 64, image_height * 2, image_width * 2),
    )
    bindings = {
        "frame0ImageEmbedding": entries["frame-0-interactive-feature-2"]["sha256"],
        "frame0HighResolutionS0": entries["frame-0-interactive-high-resolution-s0"]["sha256"],
        "frame0HighResolutionS1": entries["frame-0-interactive-high-resolution-s1"]["sha256"],
    }
    return {
        "manifest": manifest,
        "manifestSha256": manifest_sha256,
        "receiptSha256": sha256_file(receipt_path),
        "imageHeight": image_height,
        "imageWidth": image_width,
        "imageEmbedding": image_embedding,
        "highResolutionS0": high_resolution_s0,
        "highResolutionS1": high_resolution_s1,
        "bindings": bindings,
    }


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
        "schema": "kaminos.sam31-interactive-pointer-meta-reference-receipt.v0",
        "failurePhase": FAILURE_PHASE,
        "error": f"{type(error).__name__}: {error}",
        "requested": {
            "checkpoint": str(Path(args.checkpoint).resolve()),
            "sourceRoot": str(Path(args.source_root).resolve()),
            "seed": args.seed,
            "ingressDir": str(Path(args.ingress_dir).resolve()) if args.ingress_dir else None,
            "expectedIngressManifestSha256": args.expected_ingress_manifest_sha256,
        },
        "expected": {"modelRevision": HF_REVISION, "checkpointSha256": CHECKPOINT_SHA256, "sourceCommit": SOURCE_COMMIT},
        "lastTrustworthyEvidence": "No primary interactive pointer tensor packet was published.",
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

    if bool(args.ingress_dir) != bool(args.expected_ingress_manifest_sha256):
        raise ValueError("--ingress-dir and --expected-ingress-manifest-sha256 must be supplied together")
    ingress = None
    if args.ingress_dir:
        FAILURE_PHASE = "ingress-authority-validation"
        ingress = load_authenticated_ingress(Path(args.ingress_dir).resolve(), args.expected_ingress_manifest_sha256)

    FAILURE_PHASE = "identity-validation"
    if not checkpoint_path.is_file():
        raise FileNotFoundError(f"official checkpoint not found: {checkpoint_path}")
    checkpoint_sha, source_commit = require_identity(checkpoint_path, source_root)

    FAILURE_PHASE = "official-module-load"
    helper = load_tool("sam31_two_frame_helper", Path(__file__).with_name("sam31-two-frame-tracker-meta-packet.py"))
    temporal = load_tool("sam31_temporal_helper", Path(__file__).with_name("sam31-temporal-memory-bank-meta-packet.py"))
    _, video_module = temporal.load_official_modules(source_root)
    multiplex_module = importlib.import_module("sam3.model.multiplex_utils")

    FAILURE_PHASE = "checkpoint-load"
    state = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    image_height = ingress["imageHeight"] if ingress else 2
    image_width = ingress["imageWidth"] if ingress else 2
    if image_height != image_width:
        raise ValueError("interactive pointer exporter currently requires square authenticated image geometry")
    input_mask_height = image_height * 4
    input_mask_width = image_width * 4
    proxy = helper.build_interactive_mask_proxy(
        video_module, state, image_embedding_size=image_height, input_image_size=input_mask_height,
    )
    multiplex_state = multiplex_module.MultiplexState(
        assignments=[list(range(16))], device=torch.device("cpu"), dtype=torch.float32, allowed_bucket_capacity=16,
    )

    captures = {}
    hooks = []
    hooks.append(proxy.interactive_mask_downsample.register_forward_hook(lambda _m, _a, out: captures.__setitem__("mask-downsample", out.detach().clone())))
    hooks.append(proxy.interactive_sam_prompt_encoder.register_forward_hook(lambda _m, _a, out: captures.update({"sparse-embeddings": out[0].detach().clone(), "dense-embeddings": out[1].detach().clone()})))
    for layer_index, layer in enumerate(proxy.interactive_sam_mask_decoder.transformer.layers):
        def capture_layer(_module, _args, output, index=layer_index):
            captures[f"layer-{index}-queries"] = output[0].detach().clone()
            captures[f"layer-{index}-keys"] = output[1].detach().clone()
        hooks.append(layer.register_forward_hook(capture_layer))
    hooks.append(proxy.interactive_sam_mask_decoder.register_forward_hook(lambda _m, _a, out: captures.update({
        "decoder-masks": out[0].detach().clone(), "decoder-ious": out[1].detach().clone(),
        "sam-output-tokens": out[2].detach().clone(), "decoder-object-scores": out[3].detach().clone(),
    })))
    hooks.append(proxy.interactive_obj_ptr_proj.register_forward_hook(lambda _m, _a, out: captures.__setitem__("projected-pointers", out.detach().clone())))
    no_object_outputs = []
    hooks.append(proxy.no_obj_ptr_linear.register_forward_hook(lambda _m, _a, out: no_object_outputs.append(out.detach().clone())))
    original_forward = proxy._forward_sam_heads

    def capture_forward(_self, *forward_args, **forward_kwargs):
        result = original_forward(*forward_args, **forward_kwargs)
        captures["forward-object-pointers"] = result["obj_ptr"].detach().clone()
        return result

    proxy._forward_sam_heads = types.MethodType(capture_forward, proxy)

    generator = torch.Generator(device="cpu").manual_seed(args.seed)
    random = lambda shape, scale: torch.randn(shape, generator=generator, dtype=torch.float32) * scale
    binary_masks = helper.create_binary_mask_fixture()
    if (input_mask_height, input_mask_width) != tuple(binary_masks.shape[-2:]):
        binary_masks = F.interpolate(binary_masks, size=(input_mask_height, input_mask_width), mode="nearest")
    image_embedding = ingress["imageEmbedding"] if ingress else random((1, 256, image_height, image_width), 0.04)
    high_resolution_s0 = ingress["highResolutionS0"] if ingress else random((1, 32, image_height * 4, image_width * 4), 0.03)
    high_resolution_s1 = ingress["highResolutionS1"] if ingress else random((1, 64, image_height * 2, image_width * 2), 0.03)

    FAILURE_PHASE = "official-interactive-pointer-execution"
    with torch.inference_mode():
        outputs = video_module.VideoTrackingMultiplex._use_mask_as_output(
            proxy,
            backbone_features=image_embedding,
            high_res_features=[high_resolution_s0, high_resolution_s1],
            mask_inputs=binary_masks,
            multiplex_state=multiplex_state,
            objects_in_mask=list(range(16)),
        )
        captures["image-position"] = proxy.interactive_sam_prompt_encoder.get_dense_pe().detach().clone()
        captures["final-object-pointers"] = outputs["obj_ptr"].detach().clone()
        captures["mask-appearing"] = torch.any(binary_masks.flatten(1) > 0.0, dim=1).float()
    for hook in hooks:
        hook.remove()

    if len(no_object_outputs) != 2:
        raise RuntimeError(f"expected two official no-object pointer transitions, observed {len(no_object_outputs)}")
    captures["forward-no-object-projection"] = no_object_outputs[0]
    captures["final-no-object-projection"] = no_object_outputs[1]

    expected_shapes = {
        "mask-downsample": (16, 1, image_height, image_width), "sparse-embeddings": (16, 2, 256),
        "dense-embeddings": (16, 256, image_height, image_width), "image-position": (1, 256, image_height, image_width),
        "decoder-masks": (16, 1, input_mask_height, input_mask_width), "decoder-ious": (16, 1),
        "sam-output-tokens": (16, 1, 256), "decoder-object-scores": (16, 1),
        "projected-pointers": (16, 256), "forward-object-pointers": (16, 256),
        "final-object-pointers": (16, 256),
    }
    actual_shapes = {key: tuple(captures[key].shape) for key in expected_shapes}
    if actual_shapes != expected_shapes:
        raise RuntimeError(f"official interactive pointer output shape mismatch: {actual_shapes}")

    FAILURE_PHASE = "artifact-write"
    tensors = []
    inputs = {
        "binary-mask-inputs": binary_masks,
        "image-embedding": image_embedding.permute(0, 2, 3, 1).contiguous(),
        "high-resolution-s0": high_resolution_s0,
        "high-resolution-s1": high_resolution_s1,
    }
    for role, tensor in inputs.items():
        tensors.append({"role": role, **write_array(out_dir / f"{role}.f32.bin", tensor)})
    for key, tensor in captures.items():
        role = f"expected-{key}"
        if key == "image-position":
            tensor = tensor.permute(0, 2, 3, 1).contiguous()
        tensors.append({"role": role, **write_array(out_dir / f"{role}.f32.bin", tensor)})

    weights = []
    groups = [
        ("mask-downsample", "tracker.model.interactive_mask_downsample."),
        ("prompt", "tracker.model.interactive_sam_prompt_encoder."),
        ("decoder", "tracker.model.interactive_sam_mask_decoder."),
        ("interactive-pointer", "tracker.model.interactive_obj_ptr_proj."),
        ("no-object-pointer", "tracker.model.no_obj_ptr_linear."),
    ]
    group_counts = {}
    for group, prefix in groups:
        group_counts[group] = 0
        for official_key, tensor in state.items():
            if not official_key.startswith(prefix):
                continue
            local_key = official_key.removeprefix(prefix)
            role = f"{group}-{'-'.join(local_key.split('.'))}"
            weights.append({
                "role": role, "officialKey": official_key, "localKey": local_key, "group": group,
                **write_array(out_dir / f"{role}.f32.bin", tensor),
            })
            group_counts[group] += 1

    appearing = captures["mask-appearing"].bool()
    reference = {
        "model": {"id": "facebook/sam3.1", "revision": HF_REVISION, "checkpointFile": checkpoint_path.name, "sha256": checkpoint_sha},
        "source": {"repository": "facebookresearch/sam3", "root": str(source_root), "commit": source_commit, "workingTreeClean": True},
        "framework": {"name": "torch", "version": torch.__version__, "device": "cpu"},
    }
    shape = {
        "batch": 16, "queryTokens": 8, "sparsePromptTokens": 2, "imageHeight": image_height, "imageWidth": image_width,
        "imageTokens": image_height * image_width, "channels": 256, "heads": 8, "attentionChannels": 128, "mlpHidden": 2048,
        "inputMaskHeight": input_mask_height, "inputMaskWidth": input_mask_width, "decoderMaskHeight": input_mask_height, "decoderMaskWidth": input_mask_width,
        "maskOutputs": 4, "layerCount": 2,
    }
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "official-meta-binary-mask-interactive-pointer-export",
        "boundary": "binary-mask-to-interactive-prompt-decoder-to-final-object-pointer",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "execution": {
            "officialUseMaskAsOutputExecuted": True,
            "officialForwardSamHeadsExecuted": True,
            "promptEncoderClass": "PromptEncoder",
            "decoderClass": "MaskDecoder",
            "transformerClass": "TwoWayTransformer",
            "noObjectTransitionCount": len(no_object_outputs),
        },
        "fixture": {
            "seed": args.seed,
            "kind": "authenticated-ingress-mixed-object-presence" if ingress else "deterministic-reduced-geometry-mixed-object-presence",
            "sourceFeaturesSynthetic": ingress is None,
            "initialMaskSynthetic": True,
        },
        "ingressAuthority": ({
            "passed": True,
            "schema": ingress["manifest"]["schema"],
            "manifestSha256": ingress["manifestSha256"],
            "referenceReceiptSha256": ingress["receiptSha256"],
            "bindings": ingress["bindings"],
        } if ingress else {"passed": False, "state": "not-attached"}),
        "tensorLayouts": {"image-embedding": "B,H,W,C-token-major", "expected-image-position": "B,H,W,C-token-major"},
        "shape": shape,
        "configuration": {
            "multimaskOutput": False, "repeatImage": True, "useHighResolutionFeatures": True,
            "predObjectScores": True, "useMultimaskTokenForObjectPointer": True,
            "dynamicMultimaskViaStability": True, "objectScoreThreshold": 0.0,
            "useLinearNoObjectPointer": True, "outerNoObjectTransitionUsesBinaryMaskAppearance": True,
        },
        "checkpointAudit": {
            "officialStateTensorCount": len(state), "groupTensorCounts": group_counts,
            "mappedTensorCount": len(weights), "allMappedOfficialKeysPresent": len(weights) == 158,
        },
        "outputSummary": {"appearingObjectCount": int(appearing.sum().item()), "absentObjectCount": int((~appearing).sum().item())},
        "claims": {
            "fullProductionInteractiveGeometryExecuted": image_height == 72 and image_width == 72,
            "fullImageBackboneExecuted": ingress is not None,
        },
        "tolerances": {"webGpuIntermediateMaxAbsDiff": 0.0005, "webGpuFinalMaxAbsDiff": 0.0015},
        "tensors": tensors,
        "weights": weights,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    manifest_text = json.dumps(manifest, indent=2)
    receipt = {
        "ok": True,
        "schema": "kaminos.sam31-interactive-pointer-meta-reference-receipt.v0",
        "routeId": ROUTE_ID,
        "boundary": manifest["boundary"],
        "reference": reference,
        "shape": shape,
        "ingressAuthority": manifest["ingressAuthority"],
        "checkpointAudit": manifest["checkpointAudit"],
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
