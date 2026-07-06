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

from mlx_vlm.models.sam3.config import ModelConfig
from mlx_vlm.models.sam3.processing_sam3 import Sam3Processor
from mlx_vlm.models.sam3.sam3 import Model
from mlx_vlm.utils import get_model_path


ROUTE_ID = "sam3.detr-decoder.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam3-detr-decoder-real-boundary-packet.v0"
BOUNDARY = "sam3-detector-detr-decoder-phase-program"


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
    return {"sha256": sha256_bytes(data), "byteLength": len(data)}


def snapshot_id(model_path: Path) -> str:
    parts = model_path.resolve().parts
    if "snapshots" in parts:
        idx = parts.index("snapshots")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return model_path.name


def load_model(model_id: str):
    model_path = Path(get_model_path(model_id))
    weights_path = model_path / "model.safetensors"
    weights = mx.load(str(weights_path))
    model = Model(ModelConfig())
    model.load_weights(list(weights.items()), strict=False)
    return model, model_path, weights_path, sha256_file(weights_path)


def parse_args():
    parser = argparse.ArgumentParser(description="Export real MLX SAM3 DETR decoder tensors and weights.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", default="mlx-community/sam3-image")
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
    hs, ref_boxes, presence_logits = det.detr_decoder(
        vision_features=encoded,
        inputs_embeds=inputs_embeds,
        vision_pos_encoding=pos_flat,
        text_mask=attention_mask,
        spatial_shape=(height, width),
    )
    md = det.mask_decoder
    residual = encoded
    normed = md.prompt_cross_attn_norm(encoded)
    cross_mask = (1 - attention_mask[:, None, None, :].astype(mx.float32)) * -1e9
    attn_out = md.prompt_cross_attn(normed, inputs_embeds, inputs_embeds, mask=cross_mask)
    encoder_hidden_states = residual + attn_out
    prompt_fpn_feature = encoder_hidden_states.reshape(batch, height, width, channels)
    feats_for_fpn = list(fpn_trimmed)
    feats_for_fpn[-1] = prompt_fpn_feature
    pixel_embed = md.pixel_decoder(feats_for_fpn)
    instance_embed = md.instance_projection(pixel_embed)
    mask_embeddings = md.mask_embedder(hs[-1])
    mx.eval(encoded, pos_flat, inputs_embeds, attention_mask, hs, ref_boxes, presence_logits, pixel_embed, instance_embed, mask_embeddings)
    pixel = np.array(pixel_embed, dtype=np.float32)
    mask_emb = np.array(mask_embeddings, dtype=np.float32)
    upscaled = np.array(instance_embed.transpose(0, 3, 1, 2), dtype=np.float32)
    logits = np.einsum("btc,bchw->bthw", mask_emb.astype(np.float64), upscaled.astype(np.float64)).astype(np.float32)
    binary = (logits > 0).astype(np.uint32)
    return {
        "encoder_hidden_states": np.array(encoded, dtype=np.float32),
        "encoder_pos": np.array(pos_flat, dtype=np.float32),
        "prompt_features": np.array(inputs_embeds, dtype=np.float32),
        "prompt_mask": np.array(attention_mask, dtype=np.float32),
        "decoder_hidden_states": np.array(hs, dtype=np.float32),
        "last_hs": np.array(hs[-1], dtype=np.float32),
        "reference_boxes": np.array(ref_boxes[-1], dtype=np.float32),
        "presence_logits": np.array(presence_logits, dtype=np.float32),
        "pixel": pixel,
        "mask_emb": mask_emb,
        "upscaled": upscaled,
        "logits": logits,
        "binary": binary,
    }


def add_tensor(tensor_entries, out_dir, role, file, array, shape, layout, dtype="float32"):
    written = write_array(out_dir / file, array)
    tensor_entries.append({"role": role, "file": file, "sha256": written["sha256"], "dtype": dtype, "shape": shape, "layout": layout, "byteLength": written["byteLength"]})


def add_weight(weight_entries, out_dir, params, role, key, file, layout):
    array = np.array(params[key], dtype=np.float32)
    if role == "instance-projection-weight":
        array = array[:, 0, 0, :]
    written = write_array(out_dir / file, array)
    weight_entries.append({"role": role, "file": file, "sha256": written["sha256"], "dtype": "float32", "shape": list(array.shape), "layout": layout, "byteLength": written["byteLength"]})


def add_decoder_layer_weights(weight_entries, out_dir, params, layer_count):
    role_prefixes = [
        ("self", "self_attn"),
        ("text", "text_cross_attn"),
        ("vision", "vision_cross_attn"),
    ]
    norm_names = [
        ("self-layernorm", "self_attn_layer_norm"),
        ("text-layernorm", "text_cross_attn_layer_norm"),
        ("vision-layernorm", "vision_cross_attn_layer_norm"),
        ("mlp-layernorm", "mlp_layer_norm"),
    ]
    for layer in range(layer_count):
        base = f"detector_model.detr_decoder.layers.{layer}"
        for role_prefix, module in role_prefixes:
            for proj in ["q", "k", "v", "o"]:
                add_weight(weight_entries, out_dir, params, f"detr-decoder-layer-{layer}-{role_prefix}-{proj}-weight", f"{base}.{module}.{proj}_proj.weight", f"detr-decoder-layer-{layer}-{role_prefix}-{proj}-weight.f32.bin", "out,in")
                add_weight(weight_entries, out_dir, params, f"detr-decoder-layer-{layer}-{role_prefix}-{proj}-bias", f"{base}.{module}.{proj}_proj.bias", f"detr-decoder-layer-{layer}-{role_prefix}-{proj}-bias.f32.bin", "out")
        for role_prefix, module in norm_names:
            add_weight(weight_entries, out_dir, params, f"detr-decoder-layer-{layer}-{role_prefix}-weight", f"{base}.{module}.weight", f"detr-decoder-layer-{layer}-{role_prefix}-weight.f32.bin", "channels")
            add_weight(weight_entries, out_dir, params, f"detr-decoder-layer-{layer}-{role_prefix}-bias", f"{base}.{module}.bias", f"detr-decoder-layer-{layer}-{role_prefix}-bias.f32.bin", "channels")
        for role, key, layout in [
            ("fc1-weight", "mlp.fc1.weight", "out,in"),
            ("fc1-bias", "mlp.fc1.bias", "out"),
            ("fc2-weight", "mlp.fc2.weight", "out,in"),
            ("fc2-bias", "mlp.fc2.bias", "out"),
        ]:
            add_weight(weight_entries, out_dir, params, f"detr-decoder-layer-{layer}-{role}", f"{base}.{key}", f"detr-decoder-layer-{layer}-{role}.f32.bin", layout)


def add_decoder_shared_weights(weight_entries, out_dir, params):
    specs = [
        ("detr-decoder-query-embed-weight", "detector_model.detr_decoder.query_embed.weight", "detr-decoder-query-embed-weight.f32.bin", "queries,channels"),
        ("detr-decoder-reference-points-weight", "detector_model.detr_decoder.reference_points.weight", "detr-decoder-reference-points-weight.f32.bin", "queries,4"),
        ("detr-decoder-presence-token-weight", "detector_model.detr_decoder.presence_token.weight", "detr-decoder-presence-token-weight.f32.bin", "1,channels"),
        ("detr-decoder-output-layernorm-weight", "detector_model.detr_decoder.output_layer_norm.weight", "detr-decoder-output-layernorm-weight.f32.bin", "channels"),
        ("detr-decoder-output-layernorm-bias", "detector_model.detr_decoder.output_layer_norm.bias", "detr-decoder-output-layernorm-bias.f32.bin", "channels"),
        ("detr-decoder-ref-point-head-layer-1-weight", "detector_model.detr_decoder.ref_point_head.layer1.weight", "detr-decoder-ref-point-head-layer-1-weight.f32.bin", "out,in"),
        ("detr-decoder-ref-point-head-layer-1-bias", "detector_model.detr_decoder.ref_point_head.layer1.bias", "detr-decoder-ref-point-head-layer-1-bias.f32.bin", "out"),
        ("detr-decoder-ref-point-head-layer-2-weight", "detector_model.detr_decoder.ref_point_head.layer2.weight", "detr-decoder-ref-point-head-layer-2-weight.f32.bin", "out,in"),
        ("detr-decoder-ref-point-head-layer-2-bias", "detector_model.detr_decoder.ref_point_head.layer2.bias", "detr-decoder-ref-point-head-layer-2-bias.f32.bin", "out"),
        ("detr-decoder-box-head-layer-1-weight", "detector_model.detr_decoder.box_head.layer1.weight", "detr-decoder-box-head-layer-1-weight.f32.bin", "out,in"),
        ("detr-decoder-box-head-layer-1-bias", "detector_model.detr_decoder.box_head.layer1.bias", "detr-decoder-box-head-layer-1-bias.f32.bin", "out"),
        ("detr-decoder-box-head-layer-2-weight", "detector_model.detr_decoder.box_head.layer2.weight", "detr-decoder-box-head-layer-2-weight.f32.bin", "out,in"),
        ("detr-decoder-box-head-layer-2-bias", "detector_model.detr_decoder.box_head.layer2.bias", "detr-decoder-box-head-layer-2-bias.f32.bin", "out"),
        ("detr-decoder-box-head-layer-3-weight", "detector_model.detr_decoder.box_head.layer3.weight", "detr-decoder-box-head-layer-3-weight.f32.bin", "out,in"),
        ("detr-decoder-box-head-layer-3-bias", "detector_model.detr_decoder.box_head.layer3.bias", "detr-decoder-box-head-layer-3-bias.f32.bin", "out"),
        ("detr-decoder-box-rpb-x-layer-1-weight", "detector_model.detr_decoder.box_rpb_embed_x.layer1.weight", "detr-decoder-box-rpb-x-layer-1-weight.f32.bin", "out,in"),
        ("detr-decoder-box-rpb-x-layer-1-bias", "detector_model.detr_decoder.box_rpb_embed_x.layer1.bias", "detr-decoder-box-rpb-x-layer-1-bias.f32.bin", "out"),
        ("detr-decoder-box-rpb-x-layer-2-weight", "detector_model.detr_decoder.box_rpb_embed_x.layer2.weight", "detr-decoder-box-rpb-x-layer-2-weight.f32.bin", "out,in"),
        ("detr-decoder-box-rpb-x-layer-2-bias", "detector_model.detr_decoder.box_rpb_embed_x.layer2.bias", "detr-decoder-box-rpb-x-layer-2-bias.f32.bin", "out"),
        ("detr-decoder-box-rpb-y-layer-1-weight", "detector_model.detr_decoder.box_rpb_embed_y.layer1.weight", "detr-decoder-box-rpb-y-layer-1-weight.f32.bin", "out,in"),
        ("detr-decoder-box-rpb-y-layer-1-bias", "detector_model.detr_decoder.box_rpb_embed_y.layer1.bias", "detr-decoder-box-rpb-y-layer-1-bias.f32.bin", "out"),
        ("detr-decoder-box-rpb-y-layer-2-weight", "detector_model.detr_decoder.box_rpb_embed_y.layer2.weight", "detr-decoder-box-rpb-y-layer-2-weight.f32.bin", "out,in"),
        ("detr-decoder-box-rpb-y-layer-2-bias", "detector_model.detr_decoder.box_rpb_embed_y.layer2.bias", "detr-decoder-box-rpb-y-layer-2-bias.f32.bin", "out"),
        ("detr-decoder-presence-layernorm-weight", "detector_model.detr_decoder.presence_layer_norm.weight", "detr-decoder-presence-layernorm-weight.f32.bin", "channels"),
        ("detr-decoder-presence-layernorm-bias", "detector_model.detr_decoder.presence_layer_norm.bias", "detr-decoder-presence-layernorm-bias.f32.bin", "channels"),
        ("detr-decoder-presence-head-layer-1-weight", "detector_model.detr_decoder.presence_head.layer1.weight", "detr-decoder-presence-head-layer-1-weight.f32.bin", "out,in"),
        ("detr-decoder-presence-head-layer-1-bias", "detector_model.detr_decoder.presence_head.layer1.bias", "detr-decoder-presence-head-layer-1-bias.f32.bin", "out"),
        ("detr-decoder-presence-head-layer-2-weight", "detector_model.detr_decoder.presence_head.layer2.weight", "detr-decoder-presence-head-layer-2-weight.f32.bin", "out,in"),
        ("detr-decoder-presence-head-layer-2-bias", "detector_model.detr_decoder.presence_head.layer2.bias", "detr-decoder-presence-head-layer-2-bias.f32.bin", "out"),
        ("detr-decoder-presence-head-layer-3-weight", "detector_model.detr_decoder.presence_head.layer3.weight", "detr-decoder-presence-head-layer-3-weight.f32.bin", "out,in"),
        ("detr-decoder-presence-head-layer-3-bias", "detector_model.detr_decoder.presence_head.layer3.bias", "detr-decoder-presence-head-layer-3-bias.f32.bin", "out"),
    ]
    for spec in specs:
        add_weight(weight_entries, out_dir, params, *spec)


def add_mask_tail_weights(weight_entries, out_dir, params):
    for spec in [
        ("mask-embedder-layer-0-weight", "detector_model.mask_decoder.mask_embedder.layers.0.weight", "mask-embedder-layer-0-weight.f32.bin", "out,in"),
        ("mask-embedder-layer-0-bias", "detector_model.mask_decoder.mask_embedder.layers.0.bias", "mask-embedder-layer-0-bias.f32.bin", "out"),
        ("mask-embedder-layer-1-weight", "detector_model.mask_decoder.mask_embedder.layers.1.weight", "mask-embedder-layer-1-weight.f32.bin", "out,in"),
        ("mask-embedder-layer-1-bias", "detector_model.mask_decoder.mask_embedder.layers.1.bias", "mask-embedder-layer-1-bias.f32.bin", "out"),
        ("mask-embedder-layer-2-weight", "detector_model.mask_decoder.mask_embedder.layers.2.weight", "mask-embedder-layer-2-weight.f32.bin", "out,in"),
        ("mask-embedder-layer-2-bias", "detector_model.mask_decoder.mask_embedder.layers.2.bias", "mask-embedder-layer-2-bias.f32.bin", "out"),
        ("instance-projection-weight", "detector_model.mask_decoder.instance_projection.weight", "instance-projection-weight.f32.bin", "out,in"),
        ("instance-projection-bias", "detector_model.mask_decoder.instance_projection.bias", "instance-projection-bias.f32.bin", "out"),
    ]:
        add_weight(weight_entries, out_dir, params, *spec)


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model, model_path, weights_path, weights_sha = load_model(args.model)
    image_path = Path(args.image).resolve()
    image = Image.open(image_path).convert("RGB")
    source_path = out_dir / "source-image.png"
    image.resize((args.resolution, args.resolution), Image.BILINEAR).save(source_path)
    ref = run_reference(model, image, args.prompt, args.resolution)
    shape = {
        "batch": int(ref["last_hs"].shape[0]),
        "channels": int(ref["last_hs"].shape[2]),
        "heads": 8,
        "layerCount": int(ref["decoder_hidden_states"].shape[0]),
        "mlpHidden": 2048,
        "queryTokens": int(ref["last_hs"].shape[1]),
        "promptTokens": int(ref["prompt_features"].shape[1]),
        "spatialTokens": int(ref["encoder_hidden_states"].shape[1]),
        "sineFeatures": int(ref["last_hs"].shape[2] // 2),
        "height": 16,
        "width": 16,
        "maskTokens": int(ref["last_hs"].shape[1]),
        "maskHeight": int(ref["pixel"].shape[1]),
        "maskWidth": int(ref["pixel"].shape[2]),
    }
    params = dict(flatten(model.parameters()))
    tensor_entries = []
    add_tensor(tensor_entries, out_dir, "encoder-hidden-states", "encoder-hidden-states.f32.bin", ref["encoder_hidden_states"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    add_tensor(tensor_entries, out_dir, "encoder-pos", "encoder-pos.f32.bin", ref["encoder_pos"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    add_tensor(tensor_entries, out_dir, "prompt-features", "prompt-features.f32.bin", ref["prompt_features"], [shape["batch"], shape["promptTokens"], shape["channels"]], "B,T,C")
    add_tensor(tensor_entries, out_dir, "prompt-mask", "prompt-mask.f32.bin", ref["prompt_mask"], [shape["batch"], shape["promptTokens"]], "B,T")
    add_tensor(tensor_entries, out_dir, "expected-decoder-hidden-states", "expected-decoder-hidden-states.f32.bin", ref["decoder_hidden_states"], [shape["layerCount"], shape["batch"], shape["queryTokens"], shape["channels"]], "L,B,Q,C")
    add_tensor(tensor_entries, out_dir, "expected-last-hs", "expected-last-hs.f32.bin", ref["last_hs"], [shape["batch"], shape["queryTokens"], shape["channels"]], "B,Q,C")
    add_tensor(tensor_entries, out_dir, "expected-reference-boxes", "expected-reference-boxes.f32.bin", ref["reference_boxes"], [shape["batch"], shape["queryTokens"], 4], "B,Q,4")
    add_tensor(tensor_entries, out_dir, "expected-presence-logits", "expected-presence-logits.f32.bin", ref["presence_logits"], [shape["layerCount"], shape["batch"], 1], "L,B,1")
    add_tensor(tensor_entries, out_dir, "pixel-embed", "pixel-embed.f32.bin", ref["pixel"], [shape["batch"], shape["maskHeight"], shape["maskWidth"], shape["channels"]], "B,H,W,C")
    add_tensor(tensor_entries, out_dir, "expected-mask-embeddings", "expected-mask-embeddings.f32.bin", ref["mask_emb"], [shape["batch"], shape["maskTokens"], shape["channels"]], "B,Q,C")
    add_tensor(tensor_entries, out_dir, "expected-upscaled-embedding", "expected-upscaled-embedding.f32.bin", ref["upscaled"], [shape["batch"], shape["channels"], shape["maskHeight"], shape["maskWidth"]], "B,C,H,W")
    add_tensor(tensor_entries, out_dir, "expected-mask-logits", "expected-mask-logits.f32.bin", ref["logits"], [shape["batch"], shape["maskTokens"], shape["maskHeight"], shape["maskWidth"]], "B,Q,H,W")
    add_tensor(tensor_entries, out_dir, "expected-binary-mask", "expected-binary-mask.u32.bin", ref["binary"], [shape["batch"], shape["maskTokens"], shape["maskHeight"], shape["maskWidth"]], "B,Q,H,W", "uint32")
    weight_entries = []
    add_decoder_layer_weights(weight_entries, out_dir, params, shape["layerCount"])
    add_decoder_shared_weights(weight_entries, out_dir, params)
    add_mask_tail_weights(weight_entries, out_dir, params)
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-reference-export",
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": {"model": {"id": args.model, "snapshot": snapshot_id(model_path), "role": "mlx-reference-upstream"}, "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha}, "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"}},
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "prompt": {"text": args.prompt, "sha256": sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:detr-decoder-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser DETR decoder and downstream mask-tail phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": ["detr-decoder", "mask-embedder", "instance-projection", "decode-mask", "threshold-mask"]},
        "tolerances": {"lastHsMaxAbsDiff": 0.0005, "referenceBoxesMaxAbsDiff": 0.0005, "presenceLogitsMaxAbsDiff": 0.0005, "maskEmbeddingsMaxAbsDiff": 0.0001, "upscaledEmbeddingMaxAbsDiff": 0.0001, "webGpuLogitsMaxAbsDiff": 0.001, "cpuOracleBinaryMismatchCount": 8, "binaryMismatchCount": 8},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    (out_dir / "tensor-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out_dir / "tensor-manifest.json"), "routeId": ROUTE_ID, "schema": SCHEMA}, indent=2))


if __name__ == "__main__":
    main()
