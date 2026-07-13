#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image


ROUTE_ID = "sam3.scoring.phase-program.webgpu-local.v0"
SCHEMA = "kaminos.sam3-scoring-real-boundary-packet.v0"
BOUNDARY = "sam3-detector-dot-product-scoring-phase-program"


def load_encoder_tool():
    path = Path(__file__).with_name("sam-detr-encoder-mlx-packet.py")
    spec = importlib.util.spec_from_file_location("sam_detr_encoder_mlx_packet", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


encoder_tool = load_encoder_tool()


def parse_args():
    parser = argparse.ArgumentParser(description="Export real MLX SAM3 dot-product scoring tensors and weights.")
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", default="mlx-community/sam3-bf16")
    parser.add_argument("--resolution", type=int, default=224)
    return parser.parse_args()


def add_scoring_weights(weight_entries, out_dir, params):
    specs = [
        ("scoring-query-proj-weight", "detector_model.dot_product_scoring.query_proj.weight", "scoring-query-proj-weight.f32.bin", "out,in"),
        ("scoring-query-proj-bias", "detector_model.dot_product_scoring.query_proj.bias", "scoring-query-proj-bias.f32.bin", "out"),
        ("scoring-text-proj-weight", "detector_model.dot_product_scoring.text_proj.weight", "scoring-text-proj-weight.f32.bin", "out,in"),
        ("scoring-text-proj-bias", "detector_model.dot_product_scoring.text_proj.bias", "scoring-text-proj-bias.f32.bin", "out"),
        ("scoring-text-mlp-layer-1-weight", "detector_model.dot_product_scoring.text_mlp.layer1.weight", "scoring-text-mlp-layer-1-weight.f32.bin", "out,in"),
        ("scoring-text-mlp-layer-1-bias", "detector_model.dot_product_scoring.text_mlp.layer1.bias", "scoring-text-mlp-layer-1-bias.f32.bin", "out"),
        ("scoring-text-mlp-layer-2-weight", "detector_model.dot_product_scoring.text_mlp.layer2.weight", "scoring-text-mlp-layer-2-weight.f32.bin", "out,in"),
        ("scoring-text-mlp-layer-2-bias", "detector_model.dot_product_scoring.text_mlp.layer2.bias", "scoring-text-mlp-layer-2-bias.f32.bin", "out"),
        ("scoring-text-mlp-out-norm-weight", "detector_model.dot_product_scoring.text_mlp_out_norm.weight", "scoring-text-mlp-out-norm-weight.f32.bin", "channels"),
        ("scoring-text-mlp-out-norm-bias", "detector_model.dot_product_scoring.text_mlp_out_norm.bias", "scoring-text-mlp-out-norm-bias.f32.bin", "channels"),
    ]
    for spec in specs:
        encoder_tool.add_weight(weight_entries, out_dir, params, *spec)


def main():
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    model, model_path, weights_path, weights_sha, model_load_audit = encoder_tool.load_model(args.model)
    image_path = Path(args.image).resolve()
    image = Image.open(image_path).convert("RGB")
    source_path = out_dir / "source-image.png"
    image.resize((args.resolution, args.resolution), Image.BILINEAR).save(source_path)
    ref = encoder_tool.run_reference(model, image, args.prompt, args.resolution)
    hidden = ref["decoder_hidden_states"]
    logits = ref["all_pred_logits"]
    shape = {
        "layerCount": int(hidden.shape[0]),
        "batch": int(hidden.shape[1]),
        "queryTokens": int(hidden.shape[2]),
        "promptTokens": int(ref["prompt_features"].shape[1]),
        "channels": int(hidden.shape[3]),
        "mlpHidden": int(hidden.shape[3] * 8),
    }
    params = dict(encoder_tool.flatten(model.parameters()))
    tensor_entries = []
    encoder_tool.add_tensor(tensor_entries, out_dir, "hidden-states", "hidden-states.f32.bin", hidden, [shape["layerCount"], shape["batch"], shape["queryTokens"], shape["channels"]], "L,B,Q,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "prompt-features", "prompt-features.f32.bin", ref["prompt_features"], [shape["batch"], shape["promptTokens"], shape["channels"]], "B,T,C")
    encoder_tool.add_tensor(tensor_entries, out_dir, "prompt-mask", "prompt-mask.f32.bin", ref["prompt_mask"], [shape["batch"], shape["promptTokens"]], "B,T")
    encoder_tool.add_tensor(tensor_entries, out_dir, "expected-pred-logits", "expected-pred-logits.f32.bin", logits, [shape["layerCount"], shape["batch"], shape["queryTokens"], 1], "L,B,Q,1")
    weight_entries = []
    add_scoring_weights(weight_entries, out_dir, params)
    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-reference-export",
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": {"model": {"id": args.model, "snapshot": encoder_tool.snapshot_id(model_path), "role": "mlx-reference-upstream"}, "weights": {"file": "model.safetensors", "path": str(weights_path), "sha256": weights_sha}, "framework": {"name": "mlx-vlm", "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()), "execution": "uv-run"}},
        "model": {"id": args.model, "role": "mlx-reference-upstream"},
        "modelLoad": model_load_audit,
        "prompt": {"text": args.prompt, "sha256": encoder_tool.sha256_bytes(args.prompt.encode("utf-8"))},
        "sourceImage": {"artifactId": f"image:{image_path.name}:sam3-reference-source", "file": "source-image.png", "path": str(source_path), "sha256": encoder_tool.sha256_file(source_path), "originalPath": str(image_path), "resolution": [args.resolution, args.resolution]},
        "staticWeights": {"artifactId": f"sam3-weights:{args.model}:scoring-reference-upstream", "sha256": weights_sha, "role": "reference-upstream", "reason": "weights exported for browser SAM3 dot-product scoring phase-program execution"},
        "shape": shape,
        "claims": {"fullSam3BrowserExecution": False, "upstream": "mlx-vlm-sam3-detector-reference", "browserExecutedStages": ["dot-product-scoring"]},
        "tolerances": {"predLogitsMaxAbsDiff": 0.0005},
        "tensors": tensor_entries,
        "weights": weight_entries,
    }
    (out_dir / "tensor-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(json.dumps({"manifest": str(out_dir / "tensor-manifest.json"), "routeId": ROUTE_ID, "schema": SCHEMA}, indent=2))


if __name__ == "__main__":
    main()
