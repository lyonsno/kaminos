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
    return parser.parse_args()


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model, model_path, weights_path, weights_sha = encoder_tool.load_model(args.model)
    image_path = Path(args.image).resolve()
    image = Image.open(image_path).convert("RGB")
    source_path = out_dir / "source-image.png"
    image.resize((args.resolution, args.resolution), Image.BILINEAR).save(source_path)
    ref = encoder_tool.run_reference(model, image, args.prompt, args.resolution)
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
    }
    params = dict(encoder_tool.flatten(model.parameters()))
    tensor_entries = []
    encoder_tool.add_tensor(tensor_entries, out_dir, "encoder-src", "encoder-src.f32.bin", ref["encoder_src"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "encoder-pos", "encoder-pos.f32.bin", ref["encoder_pos"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "prompt-features", "prompt-features.f32.bin", ref["prompt_features"], [shape["batch"], shape["promptTokens"], shape["channels"]], "B,T,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "prompt-mask", "prompt-mask.f32.bin", ref["prompt_mask"], [shape["batch"], shape["promptTokens"]], "B,T")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-encoder-hidden-states", "expected-encoder-hidden-states.f32.bin", ref["encoder_hidden_states"], [shape["batch"], shape["spatialTokens"], shape["channels"]], "B,S,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-decoder-hidden-states", "expected-decoder-hidden-states.f32.bin", ref["decoder_hidden_states"], [shape["layerCount"], shape["batch"], shape["queryTokens"], shape["channels"]], "L,B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-last-hs", "expected-last-hs.f32.bin", ref["last_hs"], [shape["batch"], shape["queryTokens"], shape["channels"]], "B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-reference-boxes", "expected-reference-boxes.f32.bin", ref["reference_boxes"], [shape["batch"], shape["queryTokens"], 4], "B,Q,4")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-presence-logits", "expected-presence-logits.f32.bin", ref["presence_logits_full"], [shape["layerCount"], shape["batch"], 1], "L,B,1")
    if args.include_scoring:
        encoder_tool.add_tensor(tensor_entries, out_dir, "expected-pred-logits", "expected-pred-logits.f32.bin", ref["all_pred_logits"], [shape["layerCount"], shape["batch"], shape["queryTokens"], 1], "L,B,Q,1")
    encoder_tool.add_tensor(tensor_entries, out_dir, "pixel-embed", "pixel-embed.f32.bin", ref["pixel"], [shape["batch"], shape["maskHeight"], shape["maskWidth"], shape["channels"]], "B,H,W,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-mask-embeddings", "expected-mask-embeddings.f32.bin", ref["mask_emb"], [shape["batch"], shape["maskTokens"], shape["channels"]], "B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-upscaled-embedding", "expected-upscaled-embedding.f32.bin", ref["upscaled"], [shape["batch"], shape["channels"], shape["maskHeight"], shape["maskWidth"]], "B,C,H,W")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-mask-logits", "expected-mask-logits.f32.bin", ref["logits"], [shape["batch"], shape["maskTokens"], shape["maskHeight"], shape["maskWidth"]], "B,Q,H,W")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-binary-mask", "expected-binary-mask.u32.bin", ref["binary"], [shape["batch"], shape["maskTokens"], shape["maskHeight"], shape["maskWidth"]], "B,Q,H,W", "uint32")

    weight_entries = []
    encoder_tool.add_detr_encoder_weights(weight_entries, out_dir, params, shape["layerCount"])
    decoder_tool.add_decoder_layer_weights(weight_entries, out_dir, params, shape["layerCount"])
    decoder_tool.add_decoder_shared_weights(weight_entries, out_dir, params)
    if args.include_scoring:
        scoring_tool.add_scoring_weights(weight_entries, out_dir, params)
    decoder_tool.add_mask_tail_weights(weight_entries, out_dir, params)
    reference = {
        "model": {"id": args.model, "snapshot": encoder_tool.snapshot_id(model_path), "role": "mlx-reference-upstream"},
        "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha},
        "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"},
    }
    manifest = {
        "schema": SCORING_SCHEMA if args.include_scoring else SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-detr-stack-scoring-export" if args.include_scoring else "mlx-detr-stack-export",
        "boundary": SCORING_BOUNDARY if args.include_scoring else BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "prompt": {"text": args.prompt, "sha256": encoder_tool.sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": encoder_tool.sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:detr-stack-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser DETR encoder, DETR decoder, dot-product scoring, and downstream mask-tail phase-program execution" if args.include_scoring else "weights exported for browser DETR encoder, DETR decoder, and downstream mask-tail phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": ["detr-encoder", "detr-decoder", *(['dot-product-scoring'] if args.include_scoring else []), "mask-embedder", "instance-projection", "decode-mask", "threshold-mask"]},
        "tolerances": {"encoderHiddenStatesMaxAbsDiff": 0.0003, "lastHsMaxAbsDiff": 0.0006, "decoderHiddenStatesMaxAbsDiff": 0.0006, "referenceBoxesMaxAbsDiff": 0.0006, "presenceLogitsMaxAbsDiff": 0.0006, "predLogitsMaxAbsDiff": 0.0005, "maskEmbeddingsMaxAbsDiff": 0.0001, "upscaledEmbeddingMaxAbsDiff": 0.0001, "webGpuLogitsMaxAbsDiff": 0.001, "cpuOracleBinaryMismatchCount": 8, "binaryMismatchCount": 8},
        "visualization": {"selectedMaskIndex": int(ref["selected"]), "selectedMaskScore": float(ref["scores"][ref["selected"]]), "presenceLogits": [float(x) for x in ref["presence"]]},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    (out_dir / "tensor-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out_dir / "tensor-manifest.json"), "routeId": ROUTE_ID, "schema": SCHEMA}, indent=2))


if __name__ == "__main__":
    main()
