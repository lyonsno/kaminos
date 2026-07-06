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
    include_selection = args.include_selection or args.detector_stack or args.image_preprocess_ingress
    include_scoring = args.include_scoring or include_selection
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
    }
    params = dict(encoder_tool.flatten(model.parameters()))
    tensor_entries = []
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-pixel-values", "expected-pixel-values.f32.bin", expected_pixel_values, [shape["batch"], shape["imageHeight"], shape["imageWidth"], shape["imageChannels"]], "B,H,W,C")
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
    if include_scoring:
        scoring_tool.add_scoring_weights(weight_entries, out_dir, params)
    decoder_tool.add_mask_tail_weights(weight_entries, out_dir, params)
    reference = {
        "model": {"id": args.model, "snapshot": encoder_tool.snapshot_id(model_path), "role": "mlx-reference-upstream"},
        "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha},
        "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"},
    }
    manifest = {
        "schema": DETECTOR_STACK_PREPROCESS_SCHEMA if args.image_preprocess_ingress else DETECTOR_STACK_SCHEMA if args.detector_stack else SELECTION_SCHEMA if include_selection else SCORING_SCHEMA if include_scoring else SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-detector-stack-preprocess-export" if args.image_preprocess_ingress else "mlx-detector-stack-export" if args.detector_stack else "mlx-detr-stack-selection-export" if include_selection else "mlx-detr-stack-scoring-export" if include_scoring else "mlx-detr-stack-export",
        "boundary": DETECTOR_STACK_PREPROCESS_BOUNDARY if args.image_preprocess_ingress else DETECTOR_STACK_BOUNDARY if args.detector_stack else SELECTION_BOUNDARY if include_selection else SCORING_BOUNDARY if include_scoring else BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "prompt": {"text": args.prompt, "sha256": encoder_tool.sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": encoder_tool.sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:detr-stack-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser DETR encoder, DETR decoder, dot-product scoring, selection postprocess, and downstream mask-tail phase-program execution" if include_selection else "weights exported for browser DETR encoder, DETR decoder, dot-product scoring, and downstream mask-tail phase-program execution" if include_scoring else "weights exported for browser DETR encoder, DETR decoder, and downstream mask-tail phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": [*(["image-preprocess"] if args.image_preprocess_ingress else []), "detr-encoder", "detr-decoder", *(['dot-product-scoring'] if include_scoring else []), *(['score-threshold', 'box-postprocess', 'object-selection'] if include_selection else []), "mask-embedder", "instance-projection", "decode-mask", "threshold-mask"]},
        "upstreamBoundaries": [
            {"role": "source-image", "owner": "browser-served-source-image" if args.image_preprocess_ingress else "mlx-vlm-reference", "status": "browser-local-ingress" if args.image_preprocess_ingress else "mlx-owned", "nextBrowserIsland": "image-preprocess-and-vision-encoder"},
            {"role": "encoder-src", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "image-text-detr-encoder-inputs"},
            {"role": "encoder-pos", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "image-text-detr-encoder-inputs"},
            {"role": "prompt-features", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "text-token-prompt-encoder"},
            {"role": "prompt-mask", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "text-token-prompt-encoder"},
            {"role": "pixel-embed", "owner": "mlx-vlm-reference", "status": "mlx-owned", "nextBrowserIsland": "image-encoder-pixel-embedding"},
        ] if (args.detector_stack or args.image_preprocess_ingress) else None,
        "postprocess": {"scoreThreshold": args.score_threshold, "nms": False} if include_selection else None,
        "imagePreprocess": {
            "boundary": "sam3-source-image-to-normalized-pixel-values-phase-program",
            "source": "browser-served-source-image",
            "normalization": {"mean": [0.5, 0.5, 0.5], "std": [0.5, 0.5, 0.5], "layout": "B,H,W,C"},
            "browserExecuted": bool(args.image_preprocess_ingress),
            "claim": "browser-local image byte to normalized pixel-values ingress only; resize/original-image ownership and ViT/FPN execution remain outside this boundary",
        },
        "tolerances": {"pixelValuesMaxAbsDiff": 0.000001, "encoderHiddenStatesMaxAbsDiff": 0.0003, "lastHsMaxAbsDiff": 0.0006, "decoderHiddenStatesMaxAbsDiff": 0.0006, "referenceBoxesMaxAbsDiff": 0.0006, "presenceLogitsMaxAbsDiff": 0.0006, "predLogitsMaxAbsDiff": 0.0005, "selectedIndexMaxAbsDiff": 0, "selectedScoreMaxAbsDiff": 0.00001, "selectedBoxMaxAbsDiff": 0.0001, "selectionScoresMaxAbsDiff": 0.00001, "selectionBoxesMaxAbsDiff": 0.0002, "selectionKeepMismatchCount": 0, "maskEmbeddingsMaxAbsDiff": 0.0001, "upscaledEmbeddingMaxAbsDiff": 0.0001, "webGpuLogitsMaxAbsDiff": 0.001, "cpuOracleBinaryMismatchCount": 8, "binaryMismatchCount": 8},
        "visualization": {"selectedMaskIndex": int(ref["selected"]), "selectedMaskScore": float(ref["scores"][ref["selected"]]), "presenceLogits": [float(x) for x in ref["presence"]]},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    (out_dir / "tensor-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out_dir / "tensor-manifest.json"), "routeId": manifest["routeId"], "schema": manifest["schema"]}, indent=2))


if __name__ == "__main__":
    main()
