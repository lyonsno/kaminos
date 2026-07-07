#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image


ROUTE_ID = "sam3.detr-encoder.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam3-detr-stack-real-boundary-packet.v0"
BOUNDARY = "sam3-detector-detr-encoder-decoder-mask-tail-phase-program"
SCORING_SCHEMA = "kaminos.sam3-detr-stack-scoring-real-boundary-packet.v0"
SCORING_BOUNDARY = "sam3-detector-detr-encoder-decoder-scoring-mask-tail-phase-program"
SELECTION_SCHEMA = "kaminos.sam3-detr-stack-selection-real-boundary-packet.v0"
SELECTION_BOUNDARY = "sam3-detector-detr-encoder-decoder-scoring-selection-mask-tail-phase-program"
DETECTOR_STACK_SCHEMA = "kaminos.sam3-detector-stack-real-boundary-packet.v0"
DETECTOR_STACK_BOUNDARY = "sam3-detector-stack-browser-local-detector-mask-phase-program"
DETECTOR_STACK_PREPROCESS_SCHEMA = "kaminos.sam3-detector-stack-image-preprocess-real-boundary-packet.v0"
DETECTOR_STACK_PREPROCESS_BOUNDARY = "sam3-browser-local-image-preprocess-detector-stack-phase-program"
DETECTOR_STACK_PATCH_EMBED_SCHEMA = "kaminos.sam3-detector-stack-image-patch-embed-real-boundary-packet.v0"
DETECTOR_STACK_PATCH_EMBED_BOUNDARY = "sam3-browser-local-image-preprocess-patch-embed-detector-stack-phase-program"
DETECTOR_STACK_VIT_PREFIX_SCHEMA = "kaminos.sam3-detector-stack-image-vit-prefix-real-boundary-packet.v0"
DETECTOR_STACK_VIT_PREFIX_BOUNDARY = "sam3-browser-local-image-preprocess-patch-embed-vit-prefix-detector-stack-phase-program"
DETECTOR_STACK_VIT_FIRST_BLOCK_SCHEMA = "kaminos.sam3-detector-stack-image-vit-first-block-real-boundary-packet.v0"
DETECTOR_STACK_VIT_FIRST_BLOCK_BOUNDARY = "sam3-browser-local-image-preprocess-patch-embed-vit-prefix-first-block-detector-stack-phase-program"
DETECTOR_STACK_VIT_BLOCK_STACK_SCHEMA = "kaminos.sam3-detector-stack-image-vit-block-stack-real-boundary-packet.v0"
DETECTOR_STACK_VIT_BLOCK_STACK_BOUNDARY = "sam3-browser-local-image-preprocess-patch-embed-vit-prefix-block-stack-first-global-detector-stack-phase-program"
DETECTOR_STACK_VIT_BACKBONE_SCHEMA = "kaminos.sam3-detector-stack-image-vit-backbone-real-boundary-packet.v0"
DETECTOR_STACK_VIT_BACKBONE_BOUNDARY = "sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-detector-stack-phase-program"
DETECTOR_STACK_IMAGE_FPN_NECK_SCHEMA = "kaminos.sam3-detector-stack-image-fpn-neck-real-boundary-packet.v0"
DETECTOR_STACK_IMAGE_FPN_NECK_BOUNDARY = "sam3-browser-local-image-preprocess-patch-embed-vit-prefix-full-backbone-fpn-neck-detector-stack-phase-program"
DETECTOR_STACK_VIT_BLOCK_STACK_FIRST_GLOBAL_Q_WEIGHT_ROLE = "vit-block-stack-layer7-q-proj-weight"
DETECTOR_STACK_VIT_BACKBONE_FINAL_Q_WEIGHT_ROLE = "vit-block-stack-layer31-q-proj-weight"
FPN_NECK_FEATURE_ROLES = ["expected-fpn-neck-feature-0", "expected-fpn-neck-feature-1", "expected-fpn-neck-feature-2"]


def load_tool_module(filename: str, name: str):
    path = Path(__file__).with_name(filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


encoder_tool = load_tool_module("sam-detr-encoder-mlx-packet.py", "sam_detr_encoder_mlx_packet")
decoder_tool = load_tool_module("sam-detr-decoder-mlx-packet.py", "sam_detr_decoder_mlx_packet")
scoring_tool = load_tool_module("sam-scoring-mlx-packet.py", "sam_scoring_mlx_packet")


def parse_args():
    parser = argparse.ArgumentParser(description="Export real MLX SAM3 DETR encoder -> decoder -> mask-tail tensors and weights.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", default="mlx-community/sam3-image")
    parser.add_argument("--resolution", type=int, default=224)
    parser.add_argument("--include-scoring", action="store_true", help="Also export SAM3 dot-product scoring tensors and weights for composed browser execution.")
    parser.add_argument("--include-selection", action="store_true", help="Also export SAM3 score threshold/object-selection postprocess expectations.")
    parser.add_argument("--detector-stack", action="store_true", help="Export the canonical detector-stack witness packet with DETR, scoring, selection, and mask-tail expectations.")
    parser.add_argument("--image-preprocess-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local source-image to normalized pixel-values ingress.")
    parser.add_argument("--image-patch-embed-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local normalized pixel-values to SAM3 patch embeddings ingress.")
    parser.add_argument("--image-vit-prefix-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local patch embeddings through SAM3 ViT position tiling and backbone layer norm ingress.")
    parser.add_argument("--image-vit-first-block-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local SAM3 first ViT block ingress after ViT prefix.")
    parser.add_argument("--image-vit-block-stack-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local SAM3 ViT block-stack ingress through the first global-attention layer.")
    parser.add_argument("--image-vit-full-backbone-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local SAM3 full ViT backbone ingress through the final transformer layer.")
    parser.add_argument("--image-fpn-neck-ingress", action="store_true", help="Export detector-stack packet expectations for browser-local SAM3 full ViT backbone through detector-consumed FPN-neck features.")
    parser.add_argument("--score-threshold", type=float, default=0.5)
    return parser.parse_args()


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


def selection_reference(ref, resolution, threshold):
    logits = ref["all_pred_logits"]
    boxes_cxcywh = ref["reference_boxes"]
    presence = ref["presence_logits_full"]
    scores = sigmoid(logits[-1, :, :, 0]) * sigmoid(presence[-1, :, 0])[:, None]
    cx = boxes_cxcywh[..., 0]
    cy = boxes_cxcywh[..., 1]
    width = boxes_cxcywh[..., 2]
    height = boxes_cxcywh[..., 3]
    boxes = np.stack(
        [
            (cx - width / 2) * resolution,
            (cy - height / 2) * resolution,
            (cx + width / 2) * resolution,
            (cy + height / 2) * resolution,
        ],
        axis=-1,
    )
    boxes = np.clip(boxes, 0, resolution).astype(np.float32)
    keep = (scores > threshold).astype(np.uint32)
    selected_index = np.zeros((scores.shape[0],), dtype=np.uint32)
    selected_score = np.zeros((scores.shape[0],), dtype=np.float32)
    selected_box = np.zeros((scores.shape[0], 4), dtype=np.float32)
    for batch in range(scores.shape[0]):
        candidates = np.where(keep[batch] == 1)[0]
        if candidates.size:
            local = int(candidates[np.argmax(scores[batch, candidates])])
            selected_index[batch] = local
            selected_score[batch] = scores[batch, local]
            selected_box[batch] = boxes[batch, local]
    return {
        "scores": scores.astype(np.float32),
        "boxes": boxes,
        "keep": keep,
        "selected_index": selected_index,
        "selected_score": selected_score,
        "selected_box": selected_box,
    }


def add_vit_block_weights(weight_entries, out_dir, params, start_layer, end_layer):
    for layer in range(start_layer, end_layer + 1):
        base = f"detector_model.vision_encoder.backbone.layers.{layer}"
        prefix = f"vit-block-stack-layer{layer}"
        specs = [
            (f"{prefix}-layernorm1-weight", f"{base}.layer_norm1.weight", f"{prefix}-layernorm1-weight.f32.bin", "channels"),
            (f"{prefix}-layernorm1-bias", f"{base}.layer_norm1.bias", f"{prefix}-layernorm1-bias.f32.bin", "channels"),
            (f"{prefix}-q-proj-weight", f"{base}.attention.q_proj.weight", f"{prefix}-q-proj-weight.f32.bin", "out,in"),
            (f"{prefix}-q-proj-bias", f"{base}.attention.q_proj.bias", f"{prefix}-q-proj-bias.f32.bin", "out"),
            (f"{prefix}-k-proj-weight", f"{base}.attention.k_proj.weight", f"{prefix}-k-proj-weight.f32.bin", "out,in"),
            (f"{prefix}-k-proj-bias", f"{base}.attention.k_proj.bias", f"{prefix}-k-proj-bias.f32.bin", "out"),
            (f"{prefix}-v-proj-weight", f"{base}.attention.v_proj.weight", f"{prefix}-v-proj-weight.f32.bin", "out,in"),
            (f"{prefix}-v-proj-bias", f"{base}.attention.v_proj.bias", f"{prefix}-v-proj-bias.f32.bin", "out"),
            (f"{prefix}-o-proj-weight", f"{base}.attention.o_proj.weight", f"{prefix}-o-proj-weight.f32.bin", "out,in"),
            (f"{prefix}-o-proj-bias", f"{base}.attention.o_proj.bias", f"{prefix}-o-proj-bias.f32.bin", "out"),
            (f"{prefix}-layernorm2-weight", f"{base}.layer_norm2.weight", f"{prefix}-layernorm2-weight.f32.bin", "channels"),
            (f"{prefix}-layernorm2-bias", f"{base}.layer_norm2.bias", f"{prefix}-layernorm2-bias.f32.bin", "channels"),
            (f"{prefix}-mlp-fc1-weight", f"{base}.mlp.fc1.weight", f"{prefix}-mlp-fc1-weight.f32.bin", "out,in"),
            (f"{prefix}-mlp-fc1-bias", f"{base}.mlp.fc1.bias", f"{prefix}-mlp-fc1-bias.f32.bin", "out"),
            (f"{prefix}-mlp-fc2-weight", f"{base}.mlp.fc2.weight", f"{prefix}-mlp-fc2-weight.f32.bin", "out,in"),
            (f"{prefix}-mlp-fc2-bias", f"{base}.mlp.fc2.bias", f"{prefix}-mlp-fc2-bias.f32.bin", "out"),
        ]
        for spec in specs:
            encoder_tool.add_weight(weight_entries, out_dir, params, *spec)


def add_fpn_neck_weights(weight_entries, out_dir, params):
    specs = [
        ("fpn-neck-layer0-scale0-weight", "detector_model.vision_encoder.neck.fpn_layers.0.scale_layers.0.weight", "fpn-neck-layer0-scale0-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer0-scale0-bias", "detector_model.vision_encoder.neck.fpn_layers.0.scale_layers.0.bias", "fpn-neck-layer0-scale0-bias.f32.bin", "out"),
        ("fpn-neck-layer0-scale2-weight", "detector_model.vision_encoder.neck.fpn_layers.0.scale_layers.2.weight", "fpn-neck-layer0-scale2-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer0-scale2-bias", "detector_model.vision_encoder.neck.fpn_layers.0.scale_layers.2.bias", "fpn-neck-layer0-scale2-bias.f32.bin", "out"),
        ("fpn-neck-layer0-proj1-weight", "detector_model.vision_encoder.neck.fpn_layers.0.proj1.weight", "fpn-neck-layer0-proj1-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer0-proj1-bias", "detector_model.vision_encoder.neck.fpn_layers.0.proj1.bias", "fpn-neck-layer0-proj1-bias.f32.bin", "out"),
        ("fpn-neck-layer0-proj2-weight", "detector_model.vision_encoder.neck.fpn_layers.0.proj2.weight", "fpn-neck-layer0-proj2-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer0-proj2-bias", "detector_model.vision_encoder.neck.fpn_layers.0.proj2.bias", "fpn-neck-layer0-proj2-bias.f32.bin", "out"),
        ("fpn-neck-layer1-scale0-weight", "detector_model.vision_encoder.neck.fpn_layers.1.scale_layers.0.weight", "fpn-neck-layer1-scale0-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer1-scale0-bias", "detector_model.vision_encoder.neck.fpn_layers.1.scale_layers.0.bias", "fpn-neck-layer1-scale0-bias.f32.bin", "out"),
        ("fpn-neck-layer1-proj1-weight", "detector_model.vision_encoder.neck.fpn_layers.1.proj1.weight", "fpn-neck-layer1-proj1-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer1-proj1-bias", "detector_model.vision_encoder.neck.fpn_layers.1.proj1.bias", "fpn-neck-layer1-proj1-bias.f32.bin", "out"),
        ("fpn-neck-layer1-proj2-weight", "detector_model.vision_encoder.neck.fpn_layers.1.proj2.weight", "fpn-neck-layer1-proj2-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer1-proj2-bias", "detector_model.vision_encoder.neck.fpn_layers.1.proj2.bias", "fpn-neck-layer1-proj2-bias.f32.bin", "out"),
        ("fpn-neck-layer2-proj1-weight", "detector_model.vision_encoder.neck.fpn_layers.2.proj1.weight", "fpn-neck-layer2-proj1-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer2-proj1-bias", "detector_model.vision_encoder.neck.fpn_layers.2.proj1.bias", "fpn-neck-layer2-proj1-bias.f32.bin", "out"),
        ("fpn-neck-layer2-proj2-weight", "detector_model.vision_encoder.neck.fpn_layers.2.proj2.weight", "fpn-neck-layer2-proj2-weight.f32.bin", "out,kH,kW,in"),
        ("fpn-neck-layer2-proj2-bias", "detector_model.vision_encoder.neck.fpn_layers.2.proj2.bias", "fpn-neck-layer2-proj2-bias.f32.bin", "out"),
    ]
    for spec in specs:
        encoder_tool.add_weight(weight_entries, out_dir, params, *spec)


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model, model_path, weights_path, weights_sha = encoder_tool.load_model(args.model)
    image_path = Path(args.image).resolve()
    image = Image.open(image_path).convert("RGB")
    source_path = out_dir / "source-image.png"
    source_image = image.resize((args.resolution, args.resolution), Image.BILINEAR)
    source_image.save(source_path)
    expected_pixel_values = (np.array(source_image).astype(np.float32) / 255.0 - 0.5) / 0.5
    ref = encoder_tool.run_reference(model, image, args.prompt, args.resolution)
    include_selection = args.include_selection or args.detector_stack or args.image_preprocess_ingress or args.image_patch_embed_ingress or args.image_vit_prefix_ingress or args.image_vit_first_block_ingress or args.image_vit_block_stack_ingress or args.image_vit_full_backbone_ingress or args.image_fpn_neck_ingress
    include_scoring = args.include_scoring or include_selection
    include_image_preprocess = args.image_preprocess_ingress or args.image_patch_embed_ingress or args.image_vit_prefix_ingress or args.image_vit_first_block_ingress or args.image_vit_block_stack_ingress or args.image_vit_full_backbone_ingress or args.image_fpn_neck_ingress
    include_image_patch_embed = args.image_patch_embed_ingress or args.image_vit_prefix_ingress or args.image_vit_first_block_ingress or args.image_vit_block_stack_ingress or args.image_vit_full_backbone_ingress or args.image_fpn_neck_ingress
    include_image_vit_prefix = args.image_vit_prefix_ingress or args.image_vit_first_block_ingress or args.image_vit_block_stack_ingress or args.image_vit_full_backbone_ingress or args.image_fpn_neck_ingress
    include_image_vit_first_block = args.image_vit_first_block_ingress or args.image_vit_block_stack_ingress or args.image_vit_full_backbone_ingress or args.image_fpn_neck_ingress
    include_image_vit_full_backbone = args.image_vit_full_backbone_ingress or args.image_fpn_neck_ingress
    include_image_fpn_neck = args.image_fpn_neck_ingress
    include_image_vit_block_stack = args.image_vit_block_stack_ingress or include_image_vit_full_backbone
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
        "height": int(ref["prompt_fpn_feature"].shape[1]),
        "width": int(ref["prompt_fpn_feature"].shape[2]),
        "maskTokens": int(ref["last_hs"].shape[1]),
        "maskHeight": int(ref["pixel"].shape[1]),
        "maskWidth": int(ref["pixel"].shape[2]),
        "imageHeight": args.resolution,
        "imageWidth": args.resolution,
        "imageChannels": 3,
        "patchSize": int(model.detector_model.vision_encoder.backbone.config.patch_size),
        "patchHeight": int(args.resolution // model.detector_model.vision_encoder.backbone.config.patch_size),
        "patchWidth": int(args.resolution // model.detector_model.vision_encoder.backbone.config.patch_size),
        "patchTokens": int(ref["patch_embeddings"].shape[1]),
        "visionHiddenSize": int(ref["patch_embeddings"].shape[2]),
        "visionHeads": int(model.detector_model.vision_encoder.backbone.config.num_attention_heads),
        "visionHeadDim": int(model.detector_model.vision_encoder.backbone.config.hidden_size // model.detector_model.vision_encoder.backbone.config.num_attention_heads),
        "visionMlpHidden": int(model.detector_model.vision_encoder.backbone.config.intermediate_size),
        "visionWindowSize": int(model.detector_model.vision_encoder.backbone.config.window_size),
        "visionLayerNormEps": float(model.detector_model.vision_encoder.backbone.config.layer_norm_eps),
        "visionRopeTheta": float(model.detector_model.vision_encoder.backbone.config.rope_theta),
        "pretrainGridSize": int(model.detector_model.vision_encoder.backbone.config.pretrain_image_size // model.detector_model.vision_encoder.backbone.config.patch_size),
        "vitBlockStackStartLayerIndex": int(ref["vit_block_stack_start_layer_index"]),
        "vitBlockStackEndLayerIndex": int(ref["vit_backbone_final_layer_index"] if include_image_vit_full_backbone else ref["vit_block_stack_end_layer_index"]),
        "vitBackboneFinalLayerIndex": int(ref["vit_backbone_final_layer_index"]),
        "vitBlockStackFullBackbone": bool(include_image_vit_full_backbone),
        "firstGlobalLayerIndex": int(ref["vit_block_stack_first_global_layer_index"]),
        "globalAttnIndexes": [int(value) for value in ref["vit_block_stack_global_attn_indexes"]],
        "fpnHiddenSize": int(ref["backbone_features"][0].shape[3]),
        "fpnNeckLevels": [
            {"level": int(index), "scaleFactor": float([4.0, 2.0, 1.0][index]), "height": int(feature.shape[1]), "width": int(feature.shape[2])}
            for index, feature in enumerate(ref["backbone_features"])
        ],
        "groups": 8,
        "levels": [
            {"height": int(feature.shape[1]), "width": int(feature.shape[2])}
            for feature in ref["backbone_features"]
        ],
    }
    params = dict(encoder_tool.flatten(model.parameters()))
    tensor_entries = []
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-pixel-values", "expected-pixel-values.f32.bin", expected_pixel_values, [shape["batch"], shape["imageHeight"], shape["imageWidth"], shape["imageChannels"]], "B,H,W,C")
    if include_image_patch_embed:
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-patch-embeddings", "expected-patch-embeddings.f32.bin", ref["patch_embeddings"], [shape["batch"], shape["patchTokens"], shape["visionHiddenSize"]], "B,N,C")
    if include_image_vit_prefix:
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-vit-prefix-hidden-states", "expected-vit-prefix-hidden-states.f32.bin", ref["vit_prefix_hidden_states"], [shape["batch"], shape["patchHeight"], shape["patchWidth"], shape["visionHiddenSize"]], "B,H,W,C")
    if include_image_vit_first_block:
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-vit-first-block-hidden-states", "expected-vit-first-block-hidden-states.f32.bin", ref["vit_first_block_hidden_states"], [shape["batch"], shape["patchHeight"], shape["patchWidth"], shape["visionHiddenSize"]], "B,H,W,C")
    if include_image_vit_block_stack:
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-vit-pre-first-global-hidden-states", "expected-vit-pre-first-global-hidden-states.f32.bin", ref["vit_pre_first_global_hidden_states"], [shape["batch"], shape["patchHeight"], shape["patchWidth"], shape["visionHiddenSize"]], "B,H,W,C")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-vit-first-global-hidden-states", "expected-vit-first-global-hidden-states.f32.bin", ref["vit_first_global_hidden_states"], [shape["batch"], shape["patchHeight"], shape["patchWidth"], shape["visionHiddenSize"]], "B,H,W,C")
        block_stack_expected = ref["vit_backbone_hidden_states"] if include_image_vit_full_backbone else ref["vit_block_stack_hidden_states"]
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-vit-block-stack-hidden-states", "expected-vit-block-stack-hidden-states.f32.bin", block_stack_expected, [shape["batch"], shape["patchHeight"], shape["patchWidth"], shape["visionHiddenSize"]], "B,H,W,C")
        if include_image_vit_full_backbone:
            encoder_tool.add_tensor(tensor_entries, out_dir, "expected-vit-backbone-hidden-states", "expected-vit-backbone-hidden-states.f32.bin", ref["vit_backbone_hidden_states"], [shape["batch"], shape["patchHeight"], shape["patchWidth"], shape["visionHiddenSize"]], "B,H,W,C")
    if include_image_fpn_neck:
        for index, feature in enumerate(ref["backbone_features"]):
            encoder_tool.add_tensor(tensor_entries, out_dir, FPN_NECK_FEATURE_ROLES[index], f"{FPN_NECK_FEATURE_ROLES[index]}.f32.bin", feature, [shape["batch"], shape["fpnNeckLevels"][index]["height"], shape["fpnNeckLevels"][index]["width"], shape["fpnHiddenSize"]], "B,H,W,C")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-prompt-fpn-feature", "expected-prompt-fpn-feature.f32.bin", ref["prompt_fpn_feature"], [shape["batch"], shape["height"], shape["width"], shape["channels"]], "B,H,W,C")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-pixel-embed", "expected-pixel-embed.f32.bin", ref["pixel"], [shape["batch"], shape["maskHeight"], shape["maskWidth"], shape["channels"]], "B,H,W,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "encoder-src", "encoder-src.f32.bin", ref["encoder_src"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "encoder-pos", "encoder-pos.f32.bin", ref["encoder_pos"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "prompt-features", "prompt-features.f32.bin", ref["prompt_features"], [shape["batch"], shape["promptTokens"], shape["channels"]], "B,T,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "prompt-mask", "prompt-mask.f32.bin", ref["prompt_mask"], [shape["batch"], shape["promptTokens"]], "B,T")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-encoder-hidden-states", "expected-encoder-hidden-states.f32.bin", ref["encoder_hidden_states"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-decoder-hidden-states", "expected-decoder-hidden-states.f32.bin", ref["decoder_hidden_states"], [shape["layerCount"], shape["batch"], shape["queryTokens"], shape["channels"]], "L,B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-last-hs", "expected-last-hs.f32.bin", ref["last_hs"], [shape["batch"], shape["queryTokens"], shape["channels"]], "B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-reference-boxes", "expected-reference-boxes.f32.bin", ref["reference_boxes"], [shape["batch"], shape["queryTokens"], 4], "B,Q,4")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-presence-logits", "expected-presence-logits.f32.bin", ref["presence_logits_full"], [shape["layerCount"], shape["batch"], 1], "L,B,1")
    if include_scoring:
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-pred-logits", "expected-pred-logits.f32.bin", ref["all_pred_logits"], [shape["layerCount"], shape["batch"], shape["queryTokens"], 1], "L,B,Q,1")
    if include_selection:
        selection = selection_reference(ref, args.resolution, args.score_threshold)
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-selection-scores", "expected-selection-scores.f32.bin", selection["scores"], [shape["batch"], shape["queryTokens"]], "B,Q")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-selection-boxes", "expected-selection-boxes.f32.bin", selection["boxes"], [shape["batch"], shape["queryTokens"], 4], "B,Q,4")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-selection-keep", "expected-selection-keep.u32.bin", selection["keep"], [shape["batch"], shape["queryTokens"]], "B,Q", "uint32")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-selected-index", "expected-selected-index.u32.bin", selection["selected_index"], [shape["batch"]], "B", "uint32")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-selected-score", "expected-selected-score.f32.bin", selection["selected_score"], [shape["batch"]], "B")
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-selected-box", "expected-selected-box.f32.bin", selection["selected_box"], [shape["batch"], 4], "B,4")
    encoder_tool.add_tensor(tensor_entries, out_dir, "pixel-embed", "pixel-embed.f32.bin", ref["pixel"], [shape["batch"], shape["maskHeight"], shape["maskWidth"], shape["channels"]], "B,H,W,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-mask-embeddings", "expected-mask-embeddings.f32.bin", ref["mask_emb"], [shape["batch"], shape["maskTokens"], shape["channels"]], "B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-upscaled-embedding", "expected-upscaled-embedding.f32.bin", ref["upscaled"], [shape["batch"], shape["channels"], shape["maskHeight"], shape["maskWidth"]], "B,C,H,W")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-mask-logits", "expected-mask-logits.f32.bin", ref["logits"], [shape["batch"], shape["maskTokens"], shape["maskHeight"], shape["maskWidth"]], "B,Q,H,W")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-binary-mask", "expected-binary-mask.u32.bin", ref["binary"], [shape["batch"], shape["maskTokens"], shape["maskHeight"], shape["maskWidth"]], "B,Q,H,W", "uint32")

    weight_entries = []
    encoder_tool.add_detr_encoder_weights(weight_entries, out_dir, params, shape["layerCount"])
    decoder_tool.add_decoder_layer_weights(weight_entries, out_dir, params, shape["layerCount"])
    decoder_tool.add_decoder_shared_weights(weight_entries, out_dir, params)
    if include_image_patch_embed:
        encoder_tool.add_weight(weight_entries, out_dir, params, "patch-embed-projection-weight", "detector_model.vision_encoder.backbone.embeddings.patch_embeddings.projection.weight", "patch-embed-projection-weight.f32.bin", "out,kH,kW,in")
    if include_image_vit_prefix:
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-position-embeddings", "detector_model.vision_encoder.backbone.embeddings.position_embeddings", "vit-position-embeddings.f32.bin", "1,N,C")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-backbone-layernorm-weight", "detector_model.vision_encoder.backbone.layer_norm.weight", "vit-backbone-layernorm-weight.f32.bin", "channels")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-backbone-layernorm-bias", "detector_model.vision_encoder.backbone.layer_norm.bias", "vit-backbone-layernorm-bias.f32.bin", "channels")
    if include_image_vit_first_block:
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-layernorm1-weight", "detector_model.vision_encoder.backbone.layers.0.layer_norm1.weight", "vit-block0-layernorm1-weight.f32.bin", "channels")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-layernorm1-bias", "detector_model.vision_encoder.backbone.layers.0.layer_norm1.bias", "vit-block0-layernorm1-bias.f32.bin", "channels")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-q-proj-weight", "detector_model.vision_encoder.backbone.layers.0.attention.q_proj.weight", "vit-block0-q-proj-weight.f32.bin", "out,in")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-q-proj-bias", "detector_model.vision_encoder.backbone.layers.0.attention.q_proj.bias", "vit-block0-q-proj-bias.f32.bin", "out")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-k-proj-weight", "detector_model.vision_encoder.backbone.layers.0.attention.k_proj.weight", "vit-block0-k-proj-weight.f32.bin", "out,in")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-k-proj-bias", "detector_model.vision_encoder.backbone.layers.0.attention.k_proj.bias", "vit-block0-k-proj-bias.f32.bin", "out")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-v-proj-weight", "detector_model.vision_encoder.backbone.layers.0.attention.v_proj.weight", "vit-block0-v-proj-weight.f32.bin", "out,in")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-v-proj-bias", "detector_model.vision_encoder.backbone.layers.0.attention.v_proj.bias", "vit-block0-v-proj-bias.f32.bin", "out")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-o-proj-weight", "detector_model.vision_encoder.backbone.layers.0.attention.o_proj.weight", "vit-block0-o-proj-weight.f32.bin", "out,in")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-o-proj-bias", "detector_model.vision_encoder.backbone.layers.0.attention.o_proj.bias", "vit-block0-o-proj-bias.f32.bin", "out")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-layernorm2-weight", "detector_model.vision_encoder.backbone.layers.0.layer_norm2.weight", "vit-block0-layernorm2-weight.f32.bin", "channels")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-layernorm2-bias", "detector_model.vision_encoder.backbone.layers.0.layer_norm2.bias", "vit-block0-layernorm2-bias.f32.bin", "channels")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-mlp-fc1-weight", "detector_model.vision_encoder.backbone.layers.0.mlp.fc1.weight", "vit-block0-mlp-fc1-weight.f32.bin", "out,in")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-mlp-fc1-bias", "detector_model.vision_encoder.backbone.layers.0.mlp.fc1.bias", "vit-block0-mlp-fc1-bias.f32.bin", "out")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-mlp-fc2-weight", "detector_model.vision_encoder.backbone.layers.0.mlp.fc2.weight", "vit-block0-mlp-fc2-weight.f32.bin", "out,in")
        encoder_tool.add_weight(weight_entries, out_dir, params, "vit-block0-mlp-fc2-bias", "detector_model.vision_encoder.backbone.layers.0.mlp.fc2.bias", "vit-block0-mlp-fc2-bias.f32.bin", "out")
    if include_image_vit_block_stack:
        add_vit_block_weights(weight_entries, out_dir, params, shape["vitBlockStackStartLayerIndex"], shape["vitBlockStackEndLayerIndex"])
    if include_image_fpn_neck:
        add_fpn_neck_weights(weight_entries, out_dir, params)
        encoder_tool.add_downstream_weights(weight_entries, out_dir, params, len(ref["composed_features"]))
    if include_scoring:
        scoring_tool.add_scoring_weights(weight_entries, out_dir, params)
    if not include_image_fpn_neck:
        decoder_tool.add_mask_tail_weights(weight_entries, out_dir, params)
    reference = {
        "model": {"id": args.model, "snapshot": encoder_tool.snapshot_id(model_path), "role": "mlx-reference-upstream"},
        "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha},
        "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"},
    }
    legacy_detector_stack_tolerances = {
        "pixelValuesMaxAbsDiff": 0.000001,
        "patchEmbeddingsMaxAbsDiff": 0.0005,
        "imagePatchEmbedCpuMaxAbsDiff": 0.000003,
        "vitPrefixHiddenStatesMaxAbsDiff": 0.0007,
        "imageVitPrefixCpuMaxAbsDiff": 0.0007,
        "vitFirstBlockHiddenStatesMaxAbsDiff": 0.0025,
        "imageVitFirstBlockCpuMaxAbsDiff": 0.0025,
        "vitBlockStackHiddenStatesMaxAbsDiff": 0.01,
        "imageVitBlockStackCpuMaxAbsDiff": 0.01,
        "vitFirstGlobalHiddenStatesMaxAbsDiff": 0.01,
        "fpnNeckFeature0MaxAbsDiff": 0.02,
        "fpnNeckFeature1MaxAbsDiff": 0.02,
        "fpnNeckFeature2MaxAbsDiff": 0.02,
        "imageFpnNeckCpuMaxAbsDiff": 0.02,
        "promptFpnMaxAbsDiff": 0.0003,
        "pixelEmbedMaxAbsDiff": 0.0005,
        "encoderSrcMaxAbsDiff": 0.0003,
        "encoderPosMaxAbsDiff": 0.00001,
        "encoderHiddenStatesMaxAbsDiff": 0.0003,
        "lastHsMaxAbsDiff": 0.0006,
        "decoderHiddenStatesMaxAbsDiff": 0.0006,
        "referenceBoxesMaxAbsDiff": 0.0006,
        "presenceLogitsMaxAbsDiff": 0.0006,
        "predLogitsMaxAbsDiff": 0.0005,
        "selectedIndexMaxAbsDiff": 0,
        "selectedScoreMaxAbsDiff": 0.00001,
        "selectedBoxMaxAbsDiff": 0.0001,
        "selectionScoresMaxAbsDiff": 0.00001,
        "selectionBoxesMaxAbsDiff": 0.0002,
        "selectionKeepMismatchCount": 0,
        "maskEmbeddingsMaxAbsDiff": 0.0001,
        "upscaledEmbeddingMaxAbsDiff": 0.0001,
        "webGpuLogitsMaxAbsDiff": 0.001,
        "cpuOracleBinaryMismatchCount": 8,
        "binaryMismatchCount": 8,
    }
    gate_n_image_fpn_tolerances = {
        **legacy_detector_stack_tolerances,
        "encoderSrcMaxAbsDiff": 0.02,
        "encoderHiddenStatesMaxAbsDiff": 0.001,
        "promptFpnMaxAbsDiff": 0.001,
        "pixelEmbedMaxAbsDiff": 0.0015,
        "selectedBoxMaxAbsDiff": 0.003,
        "selectionBoxesMaxAbsDiff": 0.006,
        "cpuOracleBinaryMismatchCount": 64,
        "binaryMismatchCount": 64,
    }
    detector_stack_tolerances = gate_n_image_fpn_tolerances if include_image_fpn_neck else legacy_detector_stack_tolerances
    tolerance_budget_source = "browser-fpn-prompt-pixel-detector-stack" if include_image_fpn_neck else "legacy-mlx-image-ingress"
    manifest = {
        "schema": DETECTOR_STACK_IMAGE_FPN_NECK_SCHEMA if include_image_fpn_neck else DETECTOR_STACK_VIT_BACKBONE_SCHEMA if include_image_vit_full_backbone else DETECTOR_STACK_VIT_BLOCK_STACK_SCHEMA if include_image_vit_block_stack else DETECTOR_STACK_VIT_FIRST_BLOCK_SCHEMA if include_image_vit_first_block else DETECTOR_STACK_VIT_PREFIX_SCHEMA if include_image_vit_prefix else DETECTOR_STACK_PATCH_EMBED_SCHEMA if include_image_patch_embed else DETECTOR_STACK_PREPROCESS_SCHEMA if args.image_preprocess_ingress else DETECTOR_STACK_SCHEMA if args.detector_stack else SELECTION_SCHEMA if include_selection else SCORING_SCHEMA if include_scoring else SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-detector-stack-image-fpn-neck-export" if include_image_fpn_neck else "mlx-detector-stack-vit-backbone-export" if include_image_vit_full_backbone else "mlx-detector-stack-vit-block-stack-export" if include_image_vit_block_stack else "mlx-detector-stack-vit-first-block-export" if include_image_vit_first_block else "mlx-detector-stack-vit-prefix-export" if include_image_vit_prefix else "mlx-detector-stack-patch-embed-export" if include_image_patch_embed else "mlx-detector-stack-preprocess-export" if args.image_preprocess_ingress else "mlx-detector-stack-export" if args.detector_stack else "mlx-detr-stack-selection-export" if include_selection else "mlx-detr-stack-scoring-export" if include_scoring else "mlx-detr-stack-export",
        "boundary": DETECTOR_STACK_IMAGE_FPN_NECK_BOUNDARY if include_image_fpn_neck else DETECTOR_STACK_VIT_BACKBONE_BOUNDARY if include_image_vit_full_backbone else DETECTOR_STACK_VIT_BLOCK_STACK_BOUNDARY if include_image_vit_block_stack else DETECTOR_STACK_VIT_FIRST_BLOCK_BOUNDARY if include_image_vit_first_block else DETECTOR_STACK_VIT_PREFIX_BOUNDARY if include_image_vit_prefix else DETECTOR_STACK_PATCH_EMBED_BOUNDARY if include_image_patch_embed else DETECTOR_STACK_PREPROCESS_BOUNDARY if args.image_preprocess_ingress else DETECTOR_STACK_BOUNDARY if args.detector_stack else SELECTION_BOUNDARY if include_selection else SCORING_BOUNDARY if include_scoring else BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "prompt": {"text": args.prompt, "sha256": encoder_tool.sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": encoder_tool.sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:detr-stack-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser image ViT full-backbone plus detector-consumed FPN-neck ingress, DETR encoder, prompt-FPN, pixel-decoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_image_fpn_neck else "weights exported for browser image ViT full-backbone ingress through the final transformer layer, DETR encoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_image_vit_full_backbone else "weights exported for browser image ViT block-stack ingress through first global-attention layer, DETR encoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_image_vit_block_stack else "weights exported for browser image ViT first-block ingress, DETR encoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_image_vit_first_block else "weights exported for browser image ViT-prefix ingress, DETR encoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_image_vit_prefix else "weights exported for browser DETR encoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_selection else "weights exported for browser DETR encoder, DETR decoder, dot-product scoring, and downstream mask-tail phase-program execution" if include_scoring else "weights exported for browser DETR encoder, DETR decoder, and downstream mask-tail phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": [*(["image-preprocess"] if include_image_preprocess else []), *(["image-patch-embed"] if include_image_patch_embed else []), *(["image-vit-prefix"] if include_image_vit_prefix else []), *(["image-vit-first-block"] if include_image_vit_first_block and not include_image_vit_block_stack else []), *(["image-vit-backbone"] if include_image_vit_full_backbone else ["image-vit-block-stack"] if include_image_vit_block_stack else []), *(["image-fpn-neck"] if include_image_fpn_neck else []), "detr-encoder", *(["prompt-cross-attention-fpn", "pixel-decoder"] if include_image_fpn_neck else []), "detr-decoder", *(['dot-product-scoring'] if include_scoring else []), *(['score-threshold', 'box-postprocess', 'object-selection'] if include_selection else []), "mask-embedder", "instance-projection", "decode-mask", "threshold-mask"]},
        "upstreamBoundaries": [
            {"role": "source-image", "owner": "browser-served-source-image" if include_image_preprocess else "mlx-vlm-reference", "status": "browser-local-ingress" if include_image_preprocess else "mlx-owned", "nextBrowserIsland": "image-preprocess-and-vision-encoder"},
            {"role": "patch-embeddings", "owner": "browser-local-route" if include_image_patch_embed else "mlx-vlm-reference", "status": "browser-local-ingress" if include_image_patch_embed else "mlx-owned", "nextBrowserIsland": "sam3-vit-prefix" if include_image_vit_prefix else "sam3-vit-backbone"},
            {"role": "vit-prefix-hidden-states", "owner": "browser-local-route" if include_image_vit_prefix else "mlx-vlm-reference", "status": "browser-local-ingress" if include_image_vit_prefix else "mlx-owned", "nextBrowserIsland": "sam3-vit-block-0"},
            {"role": "vit-first-block-hidden-states", "owner": "browser-local-route" if include_image_vit_first_block else "mlx-vlm-reference", "status": "browser-local-ingress" if include_image_vit_first_block else "mlx-owned", "nextBrowserIsland": "sam3-vit-block-1"},
            {"role": "vit-block-stack-hidden-states", "owner": "browser-local-route" if include_image_vit_block_stack else "mlx-vlm-reference", "status": "browser-local-full-backbone" if include_image_vit_full_backbone else "browser-local-ingress-through-first-global" if include_image_vit_block_stack else "mlx-owned", "nextBrowserIsland": "sam3-fpn-neck" if include_image_vit_full_backbone else "sam3-remaining-vit-blocks-or-fpn-neck"},
            {"role": "fpn-neck-features", "owner": "browser-local-route" if include_image_fpn_neck else "mlx-vlm-reference", "status": "browser-local-detector-consumed-levels-0-2" if include_image_fpn_neck else "mlx-owned", "nextBrowserIsland": "image-text-detr-encoder-inputs"},
            {"role": "encoder-src", "owner": "browser-local-composition" if include_image_fpn_neck else "mlx-vlm-reference", "status": "browser-derived-from-fpn-neck-feature-2" if include_image_fpn_neck else "mlx-owned", "referenceTensor": "encoder-src"},
            {"role": "encoder-pos", "owner": "browser-local-composition" if include_image_fpn_neck else "mlx-vlm-reference", "status": "browser-position-embedding-sine-from-fpn-level-2-shape" if include_image_fpn_neck else "mlx-owned", "referenceTensor": "encoder-pos"},
            {"role": "prompt-features", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "text-token-prompt-encoder"},
            {"role": "prompt-mask", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "text-token-prompt-encoder"},
            {"role": "pixel-embed", "owner": "browser-local-route" if include_image_fpn_neck else "mlx-vlm-reference", "status": "browser-derived-from-prompt-fpn-pixel-decoder" if include_image_fpn_neck else "mlx-owned", "referenceTensor": "expected-pixel-embed" if include_image_fpn_neck else None, "nextBrowserIsland": None if include_image_fpn_neck else "image-encoder-pixel-embedding"},
        ] if (args.detector_stack or include_image_preprocess) else None,
        "postprocess": {"scoreThreshold": args.score_threshold, "nms": False} if include_selection else None,
        "toleranceBudgetSource": tolerance_budget_source,
        "imagePreprocess": {
            "boundary": "sam3-source-image-to-normalized-pixel-values-phase-program",
            "source": "browser-served-source-image",
            "normalization": {"mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5], "layout": "B,H,W,C"},
            "browserExecuted": bool(include_image_preprocess),
            "claim": "browser-local image byte to normalized pixel-values ingress only; resize/original-image ownership and ViT/FPN execution remain outside this boundary",
        },
        "imagePatchEmbed": {
            "boundary": "sam3-normalized-pixel-values-to-patch-embeddings-phase-program",
            "source": "browser-local-normalized-pixel-values",
            "projection": {"weightLayout": "out,kH,kW,in", "patchSize": shape["patchSize"], "stride": shape["patchSize"], "layout": "B,N,C"},
            "browserExecuted": bool(include_image_patch_embed),
            "claim": "browser-local SAM3 patch projection ingress only; position embeddings, layer norm, ViT blocks, FPN neck, and text encoder remain outside this boundary" if not include_image_vit_prefix else "browser-local SAM3 patch projection feeds browser-local ViT prefix; transformer blocks, FPN neck, and text encoder remain outside this boundary",
        } if include_image_patch_embed else None,
        "imageVitPrefix": {
            "boundary": "sam3-patch-embeddings-to-vit-prefix-phase-program",
            "source": "browser-local-patch-embeddings",
            "positionEmbeddings": {"rule": "tiling (repeating), not interpolation", "pretrainGridSize": shape["pretrainGridSize"], "targetGridSize": [shape["patchHeight"], shape["patchWidth"]], "layout": "B,H,W,C"},
            "layerNorm": {"eps": 0.000001, "layout": "B,H,W,C"},
            "browserExecuted": bool(include_image_vit_prefix),
            "claim": "browser-local SAM3 ViT prefix only: learned absolute position tiling, patch-plus-position addition, and backbone layer norm; ViT transformer blocks, RoPE/window attention, FPN neck, and text encoder remain outside this boundary",
        } if include_image_vit_prefix else None,
        "imageVitFirstBlock": {
            "boundary": "sam3-vit-prefix-hidden-states-to-first-vit-block-phase-program",
            "source": "browser-local-vit-prefix-hidden-states",
            "windowPartition": {"windowSize": shape["visionWindowSize"], "rule": "MLX window partition/pad/crop", "targetGridSize": [shape["patchHeight"], shape["patchWidth"]], "layout": "B,H,W,C"},
            "ropeWindow": {"rule": "SAM3 2D axial pairwise RoPE", "theta": shape["visionRopeTheta"], "headDim": shape["visionHeadDim"], "windowSize": shape["visionWindowSize"]},
            "layerNorm": {"eps": shape["visionLayerNormEps"], "layout": "B,H,W,C"},
            "mlp": {"activation": "gelu", "intermediateSize": shape["visionMlpHidden"]},
            "browserExecuted": bool(include_image_vit_first_block),
            "claim": "browser-local SAM3 first ViT block only: LN1, window partition/pad/crop, QKV/O projection, pairwise RoPE attention, residuals, LN2, and GELU MLP; remaining ViT blocks, FPN neck, and text encoder remain outside this boundary",
        } if include_image_vit_first_block else None,
        "imageVitBlockStack": {
            "boundary": "sam3-vit-prefix-hidden-states-to-full-vit-backbone-phase-program" if include_image_vit_full_backbone else "sam3-vit-prefix-hidden-states-to-vit-block-stack-first-global-phase-program",
            "source": "browser-local-vit-prefix-hidden-states",
            "routeKind": "image-vit-backbone-detector-stack-composition" if include_image_vit_full_backbone else "image-vit-block-stack-detector-stack-composition",
            "layerRange": {"startLayerIndex": shape["vitBlockStackStartLayerIndex"], "endLayerIndex": shape["vitBlockStackEndLayerIndex"], "firstGlobalLayerIndex": shape["firstGlobalLayerIndex"], "finalLayerIndex": shape["vitBackboneFinalLayerIndex"], "fullBackbone": include_image_vit_full_backbone, "globalAttnIndexes": shape["globalAttnIndexes"]},
            "windowPartition": {"windowSize": shape["visionWindowSize"], "rule": "MLX window partition/pad/crop for non-global layers", "targetGridSize": [shape["patchHeight"], shape["patchWidth"]], "layout": "B,H,W,C"},
            "globalAttention": {"rule": "MLX global attention at every global_attn_indexes layer in range" if include_image_vit_full_backbone else "MLX global attention at first global_attn_indexes layer", "firstGlobalLayerIndex": shape["firstGlobalLayerIndex"], "globalAttnIndexes": shape["globalAttnIndexes"], "targetGridSize": [shape["patchHeight"], shape["patchWidth"]]},
            "rope": {"rule": "SAM3 2D axial pairwise RoPE; window RoPE for non-global layers, actual-grid global RoPE for global layers", "theta": shape["visionRopeTheta"], "headDim": shape["visionHeadDim"]},
            "layerNorm": {"eps": shape["visionLayerNormEps"], "layout": "B,H,W,C"},
            "mlp": {"activation": "gelu", "intermediateSize": shape["visionMlpHidden"]},
            "fullBackbone": bool(include_image_vit_full_backbone),
            "browserExecuted": bool(include_image_vit_block_stack),
            "claim": "browser-local contiguous SAM3 ViT full backbone from block 0 through the final transformer layer; detector-consumed FPN neck executes in the following browser-local route, and browser-produced DETR image ingress is composed after that FPN route; text encoder remains outside this boundary" if include_image_fpn_neck else "browser-local contiguous SAM3 ViT full backbone from block 0 through the final transformer layer; FPN neck, browser-produced DETR/FPN inputs, and text encoder remain outside this boundary" if include_image_vit_full_backbone else "browser-local contiguous SAM3 ViT block stack from block 0 through the first global-attention block only; remaining ViT blocks, FPN neck, browser-produced DETR/FPN inputs, and text encoder remain outside this boundary",
        } if include_image_vit_block_stack else None,
        "imageFpnNeck": {
            "boundary": "sam3-vit-backbone-hidden-states-to-detector-consumed-fpn-neck-features-phase-program",
            "source": "browser-local-vit-backbone-hidden-states",
            "routeKind": "image-fpn-neck-detector-stack-composition",
            "levels": shape["fpnNeckLevels"],
            "scaleLayers": {"level0": ["transpose-conv-2x", "gelu", "transpose-conv-2x"], "level1": ["transpose-conv-2x"], "level2": ["identity-scale"]},
            "projection": {"proj1": "1x1 Conv2d", "proj2": "3x3 Conv2d padding=1", "weightLayout": "out,kH,kW,in", "layout": "B,H,W,C"},
            "browserExecuted": bool(include_image_fpn_neck),
            "claim": "browser-local SAM3 FPN neck for detector-consumed levels 0, 1, and 2 from browser-local full ViT backbone; the browser smoke derives DETR encoder source/position from level 2 while level 3 and text encoder remain outside this boundary",
        } if include_image_fpn_neck else None,
        "tolerances": detector_stack_tolerances,
        "visualization": {"selectedMaskIndex": int(ref["selected"]), "selectedMaskScore": float(ref["scores"][ref["selected"]]), "presenceLogits": [float(x) for x in ref["presence"]]},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    (out_dir / "tensor-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out_dir / "tensor-manifest.json"), "routeId": manifest["routeId"], "schema": manifest["schema"]}, indent=2))


if __name__ == "__main__":
    main()
