#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import mlx.core as mx
import numpy as np
from PIL import Image

from mlx_vlm.models.sam3.processing_sam3 import Sam3Processor
from sam_mlx_model_loader import load_sam3_model


ROUTE_ID = "sam3.pixel-decoder.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam3-pixel-decoder-real-boundary-packet.v0"
BOUNDARY = "sam3-detector-pixel-decoder-phase-program"


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def flatten(obj, prefix=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from flatten(v, f"{prefix}.{k}" if prefix else k)
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            yield from flatten(v, f"{prefix}.{i}" if prefix else str(i))
    else:
        yield prefix, obj


def write_array(path: Path, array: np.ndarray) -> dict:
    contiguous = np.ascontiguousarray(array)
    data = contiguous.tobytes(order="C")
    path.write_bytes(data)
    return {"file": path.name, "path": str(path), "sha256": sha256_bytes(data), "byteLength": len(data)}


def snapshot_id(model_path: Path) -> str:
    parts = model_path.resolve().parts
    if "snapshots" in parts:
        idx = parts.index("snapshots")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return model_path.name


def load_model(model_id: str):
    model, model_path, weights_path, checkpoint_audit = load_sam3_model(model_id)
    return model, model_path, weights_path, sha256_file(weights_path), checkpoint_audit


def parse_args():
    parser = argparse.ArgumentParser(description="Export real MLX SAM3 pixel-decoder tensors and weights.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", default="mlx-community/sam3-bf16")
    parser.add_argument("--resolution", type=int, default=224)
    return parser.parse_args()


def run_reference(model, image, prompt, resolution):
    processor = Sam3Processor(image_size=resolution)
    pixel_values = mx.array(processor.preprocess_image(image)["pixel_values"])
    text = processor.preprocess_text(prompt)
    input_ids = mx.array(text["input_ids"])
    attention_mask = mx.array(text["attention_mask"])
    det = model.detector_model
    fpn_features = det.vision_encoder(pixel_values)
    fpn_pos = [det._pos_enc(feat) for feat in fpn_features]
    fpn_trimmed = fpn_features[:-1]
    fpn_pos_trimmed = fpn_pos[:-1]
    inputs_embeds = det.get_input_embeddings(input_ids, attention_mask)
    encoder_feat = fpn_trimmed[-1]
    batch, height, width, channels = encoder_feat.shape
    src = encoder_feat.reshape(batch, height * width, channels)
    pos_flat = fpn_pos_trimmed[-1].reshape(batch, height * width, channels)
    encoded = det.detr_encoder(src, pos_flat, inputs_embeds, attention_mask)
    hs, _, presence_logits = det.detr_decoder(
        vision_features=encoded,
        inputs_embeds=inputs_embeds,
        vision_pos_encoding=pos_flat,
        text_mask=attention_mask,
        spatial_shape=(height, width),
    )
    all_logits = det.dot_product_scoring(hs, inputs_embeds, attention_mask)
    pred_logits = all_logits[-1].squeeze(-1)
    md = det.mask_decoder
    residual = encoded
    normed = md.prompt_cross_attn_norm(encoded)
    cross_mask = (1 - attention_mask[:, None, None, :].astype(mx.float32)) * -1e9
    attn_out = md.prompt_cross_attn(normed, inputs_embeds, inputs_embeds, mask=cross_mask)
    encoder_hidden_states = residual + attn_out
    feats_for_fpn = list(fpn_trimmed)
    finest = feats_for_fpn[-1]
    batch, fpn_h, fpn_w, channels = finest.shape
    spatial_dim = fpn_h * fpn_w
    encoder_visual = encoder_hidden_states[:, :spatial_dim, :].reshape(batch, fpn_h, fpn_w, channels)
    feats_for_fpn[-1] = encoder_visual
    pixel_embed = md.pixel_decoder(feats_for_fpn)
    instance_embed = md.instance_projection(pixel_embed)
    mask_embeddings = md.mask_embedder(hs[-1])
    mx.eval(*feats_for_fpn, hs[-1], pixel_embed, instance_embed, mask_embeddings, pred_logits, presence_logits)
    features = [np.array(feat, dtype=np.float32) for feat in feats_for_fpn]
    last_hs = np.array(hs[-1], dtype=np.float32)
    pixel = np.array(pixel_embed, dtype=np.float32)
    mask_emb = np.array(mask_embeddings, dtype=np.float32)
    upscaled = np.array(instance_embed.transpose(0, 3, 1, 2), dtype=np.float32)
    logits = np.einsum("btc,bchw->bthw", mask_emb.astype(np.float64), upscaled.astype(np.float64)).astype(np.float32)
    binary = (logits > 0).astype(np.uint32)
    scores = np.array(pred_logits, dtype=np.float32).reshape(mask_emb.shape[1])
    positive_area = binary.reshape(mask_emb.shape[1], -1).sum(axis=1)
    target_area = 0.45 * logits.shape[-1] * logits.shape[-2]
    selected = int(np.lexsort((np.arange(scores.size), -scores, np.abs(positive_area - target_area)))[0])
    return features, last_hs, pixel, mask_emb, upscaled, logits, binary, selected, scores, np.array(presence_logits, dtype=np.float32).reshape(-1)


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model, model_path, weights_path, weights_sha, model_load_audit = load_model(args.model)
    image_path = Path(args.image).resolve()
    image = Image.open(image_path).convert("RGB")
    source_path = out_dir / "source-image.png"
    image.resize((args.resolution, args.resolution), Image.BILINEAR).save(source_path)
    features, last_hs, pixel, mask_emb, upscaled, logits, binary, selected, scores, presence = run_reference(model, image, args.prompt, args.resolution)
    shape = {
        "batch": int(last_hs.shape[0]),
        "channels": int(last_hs.shape[2]),
        "groups": 8,
        "levels": [{"height": int(feat.shape[1]), "width": int(feat.shape[2])} for feat in features],
        "maskTokens": int(last_hs.shape[1]),
        "height": int(pixel.shape[1]),
        "width": int(pixel.shape[2]),
    }
    params = dict(flatten(model.parameters()))
    tensor_specs = []
    for index, feat in enumerate(features):
        level = shape["levels"][index]
        tensor_specs.append((f"fpn-feature-{index}", f"fpn-feature-{index}.f32.bin", feat, [shape["batch"], level["height"], level["width"], shape["channels"]], "B,H,W,C"))
    tensor_specs.extend([
        ("last-hs", "last-hs.f32.bin", last_hs, [shape["batch"], shape["maskTokens"], shape["channels"]], "B,T,C"),
        ("expected-pixel-embed", "expected-pixel-embed.f32.bin", pixel, [shape["batch"], shape["height"], shape["width"], shape["channels"]], "B,H,W,C"),
        ("expected-mask-embeddings", "expected-mask-embeddings.f32.bin", mask_emb, [shape["batch"], shape["maskTokens"], shape["channels"]], "B,T,C"),
        ("expected-upscaled-embedding", "expected-upscaled-embedding.f32.bin", upscaled, [shape["batch"], shape["channels"], shape["height"], shape["width"]], "B,C,H,W"),
        ("expected-mask-logits", "expected-mask-logits.f32.bin", logits, [shape["batch"], shape["maskTokens"], shape["height"], shape["width"]], "B,T,H,W"),
        ("expected-binary-mask", "expected-binary-mask.u32.bin", binary, [shape["batch"], shape["maskTokens"], shape["height"], shape["width"]], "B,T,H,W"),
    ])
    tensor_entries = []
    for role, file, array, tensor_shape, layout in tensor_specs:
        written = write_array(out_dir / file, array)
        tensor_entries.append({"role": role, "file": file, "sha256": written["sha256"], "dtype": "uint32" if role == "expected-binary-mask" else "float32", "shape": tensor_shape, "layout": layout, "byteLength": written["byteLength"]})

    weight_specs = []
    for stage in range(len(features) - 1):
        base = f"detector_model.mask_decoder.pixel_decoder"
        weight_specs.extend([
            (f"pixel-decoder-stage-{stage}-conv-weight", f"{base}.conv_layers.{stage}.weight", f"pixel-decoder-stage-{stage}-conv-weight.f32.bin", "out,kH,kW,in"),
            (f"pixel-decoder-stage-{stage}-conv-bias", f"{base}.conv_layers.{stage}.bias", f"pixel-decoder-stage-{stage}-conv-bias.f32.bin", "out"),
            (f"pixel-decoder-stage-{stage}-norm-weight", f"{base}.norms.{stage}.weight", f"pixel-decoder-stage-{stage}-norm-weight.f32.bin", "channels"),
            (f"pixel-decoder-stage-{stage}-norm-bias", f"{base}.norms.{stage}.bias", f"pixel-decoder-stage-{stage}-norm-bias.f32.bin", "channels"),
        ])
    weight_specs.extend([
        ("mask-embedder-layer-0-weight", "detector_model.mask_decoder.mask_embedder.layers.0.weight", "mask-embedder-layer-0-weight.f32.bin", "out,in"),
        ("mask-embedder-layer-0-bias", "detector_model.mask_decoder.mask_embedder.layers.0.bias", "mask-embedder-layer-0-bias.f32.bin", "out"),
        ("mask-embedder-layer-1-weight", "detector_model.mask_decoder.mask_embedder.layers.1.weight", "mask-embedder-layer-1-weight.f32.bin", "out,in"),
        ("mask-embedder-layer-1-bias", "detector_model.mask_decoder.mask_embedder.layers.1.bias", "mask-embedder-layer-1-bias.f32.bin", "out"),
        ("mask-embedder-layer-2-weight", "detector_model.mask_decoder.mask_embedder.layers.2.weight", "mask-embedder-layer-2-weight.f32.bin", "out,in"),
        ("mask-embedder-layer-2-bias", "detector_model.mask_decoder.mask_embedder.layers.2.bias", "mask-embedder-layer-2-bias.f32.bin", "out"),
        ("instance-projection-weight", "detector_model.mask_decoder.instance_projection.weight", "instance-projection-weight.f32.bin", "out,in"),
        ("instance-projection-bias", "detector_model.mask_decoder.instance_projection.bias", "instance-projection-bias.f32.bin", "out"),
    ])
    weight_entries = []
    for role, key, file, layout in weight_specs:
        array = np.array(params[key], dtype=np.float32)
        if role == "instance-projection-weight":
            array = array[:, 0, 0, :]
        written = write_array(out_dir / file, array)
        weight_entries.append({"role": role, "file": file, "sha256": written["sha256"], "dtype": "float32", "shape": list(array.shape), "layout": layout, "byteLength": written["byteLength"]})

    reference = {"model": {"id": args.model, "snapshot": snapshot_id(model_path), "role": "mlx-reference-upstream"}, "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha}, "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"}}
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-reference-export",
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "modelLoad": model_load_audit,
        "prompt": {"text": args.prompt, "sha256": sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:pixel-decoder-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser pixel-decoder and mask-tail phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": ["pixel-decoder", "mask-embedder", "instance-projection", "decode-mask", "threshold-mask"]},
        "visualization": {"selectedMaskIndex": selected, "selectedMaskScore": float(scores[selected]), "presenceLogits": [float(x) for x in presence]},
        "tolerances": {"pixelEmbedMaxAbsDiff": 0.0002, "maskEmbeddingsMaxAbsDiff": 0.0001, "upscaledEmbeddingMaxAbsDiff": 0.0001, "webGpuLogitsMaxAbsDiff": 0.0004, "cpuOracleBinaryMismatchCount": 4, "binaryMismatchCount": 4},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    manifest_path = out_dir / "tensor-manifest.json"
    receipt = {"ok": True, "schema": "kaminos.sam3-pixel-decoder-reference-receipt.v0", "routeId": ROUTE_ID, "mode": manifest["mode"], "boundary": BOUNDARY, "reference": reference, "shape": shape, "outputs": {"tensorManifest": str(manifest_path), "sourceImage": str(source_path)}}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (out_dir / "reference-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
