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


ROUTE_ID = "sam3.detr-encoder.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam3-detr-encoder-real-boundary-packet.v0"
BOUNDARY = "sam3-detector-detr-encoder-phase-program"


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
    model_path = Path(get_model_path(model_id))
    weights_path = model_path / "model.safetensors"
    weights = mx.load(str(weights_path))
    model = Model(ModelConfig())
    model.load_weights(list(weights.items()), strict=False)
    return model, model_path, weights_path, sha256_file(weights_path)


def parse_args():
    parser = argparse.ArgumentParser(description="Export real MLX SAM3 DETR encoder tensors and weights.")
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
    patch_embeddings = det.vision_encoder.backbone.embeddings(pixel_values)
    backbone = det.vision_encoder.backbone
    patch_h = resolution // backbone.config.patch_size
    patch_w = resolution // backbone.config.patch_size
    pos = backbone._tile_pos_embed(backbone.embeddings.position_embeddings, patch_h, patch_w)
    vit_prefix_hidden_states = backbone.layer_norm(
        (patch_embeddings + pos).reshape(patch_embeddings.shape[0], patch_h, patch_w, -1)
    )
    vit_first_block_hidden_states = backbone.layers[0](
        vit_prefix_hidden_states, backbone._rope_window_cos, backbone._rope_window_sin
    )
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
    all_logits = det.dot_product_scoring(hs, inputs_embeds, attention_mask)
    pred_logits = all_logits[-1].squeeze(-1)

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

    mx.eval(
        src,
        patch_embeddings,
        pos_flat,
        *fpn_trimmed,
        encoded,
        inputs_embeds,
        attention_mask,
        prompt_fpn_feature,
        *feats_for_fpn,
        hs[-1],
        pixel_embed,
        instance_embed,
        mask_embeddings,
        vit_prefix_hidden_states,
        vit_first_block_hidden_states,
        all_logits,
        pred_logits,
        ref_boxes,
        presence_logits,
    )
    backbone_features = [np.array(feat, dtype=np.float32) for feat in fpn_trimmed]
    composed_features = [np.array(feat, dtype=np.float32) for feat in feats_for_fpn]
    pixel = np.array(pixel_embed, dtype=np.float32)
    mask_emb = np.array(mask_embeddings, dtype=np.float32)
    upscaled = np.array(instance_embed.transpose(0, 3, 1, 2), dtype=np.float32)
    logits = np.einsum("btc,bchw->bthw", mask_emb.astype(np.float64), upscaled.astype(np.float64)).astype(np.float32)
    binary = (logits > 0).astype(np.uint32)
    scores = np.array(pred_logits, dtype=np.float32).reshape(mask_emb.shape[1])
    positive_area = binary.reshape(mask_emb.shape[1], -1).sum(axis=1)
    target_area = 0.45 * logits.shape[-1] * logits.shape[-2]
    selected = int(np.lexsort((np.arange(scores.size), -scores, np.abs(positive_area - target_area)))[0])
    return {
        "encoder_src": np.array(src, dtype=np.float32),
        "patch_embeddings": np.array(patch_embeddings, dtype=np.float32),
        "vit_prefix_hidden_states": np.array(vit_prefix_hidden_states, dtype=np.float32),
        "vit_first_block_hidden_states": np.array(vit_first_block_hidden_states, dtype=np.float32),
        "encoder_pos": np.array(pos_flat, dtype=np.float32),
        "encoder_hidden_states": np.array(encoded, dtype=np.float32),
        "backbone_features": backbone_features,
        "composed_features": composed_features,
        "prompt_features": np.array(inputs_embeds, dtype=np.float32),
        "prompt_mask": np.array(attention_mask, dtype=np.float32),
        "prompt_fpn_feature": np.array(prompt_fpn_feature, dtype=np.float32),
        "decoder_hidden_states": np.array(hs, dtype=np.float32),
        "all_pred_logits": np.array(all_logits, dtype=np.float32),
        "last_hs": np.array(hs[-1], dtype=np.float32),
        "reference_boxes": np.array(ref_boxes[-1], dtype=np.float32),
        "presence_logits_full": np.array(presence_logits, dtype=np.float32),
        "pixel": pixel,
        "mask_emb": mask_emb,
        "upscaled": upscaled,
        "logits": logits,
        "binary": binary,
        "selected": selected,
        "scores": scores,
        "presence": np.array(presence_logits, dtype=np.float32).reshape(-1),
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


def add_detr_encoder_weights(weight_entries, out_dir, params, layer_count):
    for layer in range(layer_count):
        base = f"detector_model.detr_encoder.layers.{layer}"
        specs = [
            (f"detr-encoder-layer-{layer}-layernorm1-weight", f"{base}.layer_norm1.weight", f"detr-encoder-layer-{layer}-layernorm1-weight.f32.bin", "channels"),
            (f"detr-encoder-layer-{layer}-layernorm1-bias", f"{base}.layer_norm1.bias", f"detr-encoder-layer-{layer}-layernorm1-bias.f32.bin", "channels"),
            (f"detr-encoder-layer-{layer}-self-q-weight", f"{base}.self_attn.q_proj.weight", f"detr-encoder-layer-{layer}-self-q-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-self-q-bias", f"{base}.self_attn.q_proj.bias", f"detr-encoder-layer-{layer}-self-q-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-self-k-weight", f"{base}.self_attn.k_proj.weight", f"detr-encoder-layer-{layer}-self-k-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-self-k-bias", f"{base}.self_attn.k_proj.bias", f"detr-encoder-layer-{layer}-self-k-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-self-v-weight", f"{base}.self_attn.v_proj.weight", f"detr-encoder-layer-{layer}-self-v-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-self-v-bias", f"{base}.self_attn.v_proj.bias", f"detr-encoder-layer-{layer}-self-v-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-self-o-weight", f"{base}.self_attn.o_proj.weight", f"detr-encoder-layer-{layer}-self-o-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-self-o-bias", f"{base}.self_attn.o_proj.bias", f"detr-encoder-layer-{layer}-self-o-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-layernorm2-weight", f"{base}.layer_norm2.weight", f"detr-encoder-layer-{layer}-layernorm2-weight.f32.bin", "channels"),
            (f"detr-encoder-layer-{layer}-layernorm2-bias", f"{base}.layer_norm2.bias", f"detr-encoder-layer-{layer}-layernorm2-bias.f32.bin", "channels"),
            (f"detr-encoder-layer-{layer}-cross-q-weight", f"{base}.cross_attn.q_proj.weight", f"detr-encoder-layer-{layer}-cross-q-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-cross-q-bias", f"{base}.cross_attn.q_proj.bias", f"detr-encoder-layer-{layer}-cross-q-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-cross-k-weight", f"{base}.cross_attn.k_proj.weight", f"detr-encoder-layer-{layer}-cross-k-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-cross-k-bias", f"{base}.cross_attn.k_proj.bias", f"detr-encoder-layer-{layer}-cross-k-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-cross-v-weight", f"{base}.cross_attn.v_proj.weight", f"detr-encoder-layer-{layer}-cross-v-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-cross-v-bias", f"{base}.cross_attn.v_proj.bias", f"detr-encoder-layer-{layer}-cross-v-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-cross-o-weight", f"{base}.cross_attn.o_proj.weight", f"detr-encoder-layer-{layer}-cross-o-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-cross-o-bias", f"{base}.cross_attn.o_proj.bias", f"detr-encoder-layer-{layer}-cross-o-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-layernorm3-weight", f"{base}.layer_norm3.weight", f"detr-encoder-layer-{layer}-layernorm3-weight.f32.bin", "channels"),
            (f"detr-encoder-layer-{layer}-layernorm3-bias", f"{base}.layer_norm3.bias", f"detr-encoder-layer-{layer}-layernorm3-bias.f32.bin", "channels"),
            (f"detr-encoder-layer-{layer}-fc1-weight", f"{base}.mlp.fc1.weight", f"detr-encoder-layer-{layer}-fc1-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-fc1-bias", f"{base}.mlp.fc1.bias", f"detr-encoder-layer-{layer}-fc1-bias.f32.bin", "out"),
            (f"detr-encoder-layer-{layer}-fc2-weight", f"{base}.mlp.fc2.weight", f"detr-encoder-layer-{layer}-fc2-weight.f32.bin", "out,in"),
            (f"detr-encoder-layer-{layer}-fc2-bias", f"{base}.mlp.fc2.bias", f"detr-encoder-layer-{layer}-fc2-bias.f32.bin", "out"),
        ]
        for spec in specs:
            add_weight(weight_entries, out_dir, params, *spec)


def add_downstream_weights(weight_entries, out_dir, params, composed_feature_count):
    prompt_base = "detector_model.mask_decoder"
    for spec in [
        ("prompt-cross-attn-norm-weight", f"{prompt_base}.prompt_cross_attn_norm.weight", "prompt-cross-attn-norm-weight.f32.bin", "channels"),
        ("prompt-cross-attn-norm-bias", f"{prompt_base}.prompt_cross_attn_norm.bias", "prompt-cross-attn-norm-bias.f32.bin", "channels"),
        ("prompt-cross-attn-q-weight", f"{prompt_base}.prompt_cross_attn.q_proj.weight", "prompt-cross-attn-q-weight.f32.bin", "out,in"),
        ("prompt-cross-attn-q-bias", f"{prompt_base}.prompt_cross_attn.q_proj.bias", "prompt-cross-attn-q-bias.f32.bin", "out"),
        ("prompt-cross-attn-k-weight", f"{prompt_base}.prompt_cross_attn.k_proj.weight", "prompt-cross-attn-k-weight.f32.bin", "out,in"),
        ("prompt-cross-attn-k-bias", f"{prompt_base}.prompt_cross_attn.k_proj.bias", "prompt-cross-attn-k-bias.f32.bin", "out"),
        ("prompt-cross-attn-v-weight", f"{prompt_base}.prompt_cross_attn.v_proj.weight", "prompt-cross-attn-v-weight.f32.bin", "out,in"),
        ("prompt-cross-attn-v-bias", f"{prompt_base}.prompt_cross_attn.v_proj.bias", "prompt-cross-attn-v-bias.f32.bin", "out"),
        ("prompt-cross-attn-o-weight", f"{prompt_base}.prompt_cross_attn.o_proj.weight", "prompt-cross-attn-o-weight.f32.bin", "out,in"),
        ("prompt-cross-attn-o-bias", f"{prompt_base}.prompt_cross_attn.o_proj.bias", "prompt-cross-attn-o-bias.f32.bin", "out"),
    ]:
        add_weight(weight_entries, out_dir, params, *spec)
    for stage in range(composed_feature_count - 1):
        base = "detector_model.mask_decoder.pixel_decoder"
        for spec in [
            (f"pixel-decoder-stage-{stage}-conv-weight", f"{base}.conv_layers.{stage}.weight", f"pixel-decoder-stage-{stage}-conv-weight.f32.bin", "out,kH,kW,in"),
            (f"pixel-decoder-stage-{stage}-conv-bias", f"{base}.conv_layers.{stage}.bias", f"pixel-decoder-stage-{stage}-conv-bias.f32.bin", "out"),
            (f"pixel-decoder-stage-{stage}-norm-weight", f"{base}.norms.{stage}.weight", f"pixel-decoder-stage-{stage}-norm-weight.f32.bin", "channels"),
            (f"pixel-decoder-stage-{stage}-norm-bias", f"{base}.norms.{stage}.bias", f"pixel-decoder-stage-{stage}-norm-bias.f32.bin", "channels"),
        ]:
            add_weight(weight_entries, out_dir, params, *spec)
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
    encoder = ref["encoder_hidden_states"]
    shape = {
        "batch": int(encoder.shape[0]),
        "channels": int(encoder.shape[2]),
        "heads": 8,
        "layerCount": 6,
        "mlpHidden": 2048,
        "spatialTokens": int(encoder.shape[1]),
        "promptTokens": int(ref["prompt_features"].shape[1]),
        "height": int(ref["prompt_fpn_feature"].shape[1]),
        "width": int(ref["prompt_fpn_feature"].shape[2]),
        "groups": 8,
        "levels": [{"height": int(feat.shape[1]), "width": int(feat.shape[2])} for feat in ref["composed_features"]],
        "maskTokens": int(ref["last_hs"].shape[1]),
    }
    params = dict(flatten(model.parameters()))
    tensor_entries = []
    add_tensor(tensor_entries, out_dir, "encoder-src", "encoder-src.f32.bin", ref["encoder_src"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    add_tensor(tensor_entries, out_dir, "encoder-pos", "encoder-pos.f32.bin", ref["encoder_pos"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    add_tensor(tensor_entries, out_dir, "prompt-features", "prompt-features.f32.bin", ref["prompt_features"], [shape["batch"], shape["promptTokens"], shape["channels"]], "B,T,C")
    add_tensor(tensor_entries, out_dir, "prompt-mask", "prompt-mask.f32.bin", ref["prompt_mask"], [shape["batch"], shape["promptTokens"]], "B,T")
    add_tensor(tensor_entries, out_dir, "expected-encoder-hidden-states", "expected-encoder-hidden-states.f32.bin", ref["encoder_hidden_states"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    for index, feat in enumerate(ref["backbone_features"]):
        level = shape["levels"][index]
        add_tensor(tensor_entries, out_dir, f"backbone-fpn-feature-{index}", f"backbone-fpn-feature-{index}.f32.bin", feat, [shape["batch"], level["height"], level["width"], shape["channels"]], "B,H,W,C")
    add_tensor(tensor_entries, out_dir, "expected-prompt-fpn-feature", "expected-prompt-fpn-feature.f32.bin", ref["prompt_fpn_feature"], [shape["batch"], shape["height"], shape["width"], shape["channels"]], "B,H,W,C")
    for index, feat in enumerate(ref["composed_features"]):
        level = shape["levels"][index]
        add_tensor(tensor_entries, out_dir, f"expected-fpn-feature-{index}", f"expected-fpn-feature-{index}.f32.bin", feat, [shape["batch"], level["height"], level["width"], shape["channels"]], "B,H,W,C")
    add_tensor(tensor_entries, out_dir, "last-hs", "last-hs.f32.bin", ref["last_hs"], [shape["batch"], shape["maskTokens"], shape["channels"]], "B,T,C")
    add_tensor(tensor_entries, out_dir, "expected-pixel-embed", "expected-pixel-embed.f32.bin", ref["pixel"], [shape["batch"], shape["levels"][0]["height"], shape["levels"][0]["width"], shape["channels"]], "B,H,W,C")
    add_tensor(tensor_entries, out_dir, "expected-mask-embeddings", "expected-mask-embeddings.f32.bin", ref["mask_emb"], [shape["batch"], shape["maskTokens"], shape["channels"]], "B,T,C")
    add_tensor(tensor_entries, out_dir, "expected-upscaled-embedding", "expected-upscaled-embedding.f32.bin", ref["upscaled"], [shape["batch"], shape["channels"], shape["levels"][0]["height"], shape["levels"][0]["width"]], "B,C,H,W")
    add_tensor(tensor_entries, out_dir, "expected-mask-logits", "expected-mask-logits.f32.bin", ref["logits"], [shape["batch"], shape["maskTokens"], shape["levels"][0]["height"], shape["levels"][0]["width"]], "B,T,H,W")
    add_tensor(tensor_entries, out_dir, "expected-binary-mask", "expected-binary-mask.u32.bin", ref["binary"], [shape["batch"], shape["maskTokens"], shape["levels"][0]["height"], shape["levels"][0]["width"]], "B,T,H,W", "uint32")

    weight_entries = []
    add_detr_encoder_weights(weight_entries, out_dir, params, shape["layerCount"])
    add_downstream_weights(weight_entries, out_dir, params, len(ref["composed_features"]))

    reference = {"model": {"id": args.model, "snapshot": snapshot_id(model_path), "role": "mlx-reference-upstream"}, "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha}, "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"}}
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-reference-export",
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "prompt": {"text": args.prompt, "sha256": sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:detr-encoder-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser DETR encoder, prompt-FPN, pixel-decoder, and mask-tail phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": ["detr-encoder", "prompt-cross-attention-fpn", "pixel-decoder", "mask-embedder", "instance-projection", "decode-mask", "threshold-mask"]},
        "tolerances": {"encoderHiddenStatesMaxAbsDiff": 0.0003, "promptFpnMaxAbsDiff": 0.0003, "pixelEmbedMaxAbsDiff": 0.0005, "maskEmbeddingsMaxAbsDiff": 0.0001, "upscaledEmbeddingMaxAbsDiff": 0.0001, "webGpuLogitsMaxAbsDiff": 0.001, "cpuOracleBinaryMismatchCount": 8, "binaryMismatchCount": 8},
        "visualization": {"selectedMaskIndex": ref["selected"], "selectedMaskScore": float(ref["scores"][ref["selected"]]), "presenceLogits": [float(x) for x in ref["presence"]]},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    (out_dir / "tensor-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out_dir / "tensor-manifest.json"), "routeId": ROUTE_ID, "schema": SCHEMA}, indent=2))


if __name__ == "__main__":
    main()
