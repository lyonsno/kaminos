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


ROUTE_ID = "sam3.mask-decoder-island.webgpu-local.v0"
SCHEMA = "kaminos.sam3-mask-island-real-boundary-packet.v0"
BOUNDARY = "sam3-detector-mask-projection-threshold"


def sha256_bytes(data: bytes) -> str:
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return f"sha256:{h.hexdigest()}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export real MLX SAM3 detector mask-boundary tensors for the Kaminos WebGPU mask island."
    )
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--model", default="mlx-community/sam3-image")
    parser.add_argument("--resolution", type=int, default=224)
    return parser.parse_args()


def write_array(path: Path, array: np.ndarray) -> dict:
    contiguous = np.ascontiguousarray(array)
    data = contiguous.tobytes(order="C")
    path.write_bytes(data)
    return {
        "file": path.name,
        "path": str(path),
        "sha256": sha256_bytes(data),
        "byteLength": len(data),
    }


def snapshot_id(model_path: Path) -> str:
    parts = model_path.resolve().parts
    if "snapshots" in parts:
        idx = parts.index("snapshots")
        if idx + 1 < len(parts):
            return parts[idx + 1]
    return model_path.name


def load_model(model_id: str) -> tuple[Model, Path, Path, str]:
    model_path = Path(get_model_path(model_id))
    weights_path = model_path / "model.safetensors"
    if not weights_path.exists():
        raise FileNotFoundError(f"model weights not found: {weights_path}")
    weights = mx.load(str(weights_path))
    model = Model(ModelConfig())
    model.load_weights(list(weights.items()), strict=False)
    return model, model_path, weights_path, sha256_file(weights_path)


def export_boundary_tensors(model: Model, image: Image.Image, prompt: str, resolution: int) -> dict:
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

    mx.eval(mask_embeddings, instance_embed, pred_logits, presence_logits)

    hyper_input = np.array(mask_embeddings, dtype=np.float32)
    upscaled_embedding = np.array(instance_embed.transpose(0, 3, 1, 2), dtype=np.float32)
    expected_logits = np.einsum(
        "btc,bchw->bthw",
        hyper_input.astype(np.float64),
        upscaled_embedding.astype(np.float64),
    ).astype(np.float32)
    expected_binary = (expected_logits > 0).astype(np.uint32)
    scores = np.array(pred_logits, dtype=np.float32).reshape(hyper_input.shape[1])
    positive_area = expected_binary.reshape(hyper_input.shape[1], -1).sum(axis=1)
    target_area = 0.45 * expected_binary.shape[-1] * expected_binary.shape[-2]
    selected_mask_index = int(np.lexsort((np.arange(scores.size), -scores, np.abs(positive_area - target_area)))[0])

    return {
        "hyperInput": hyper_input,
        "upscaledEmbedding": upscaled_embedding,
        "expectedMaskLogits": expected_logits,
        "expectedBinaryMask": expected_binary,
        "selectedMaskIndex": selected_mask_index,
        "scores": scores,
        "presenceLogits": np.array(presence_logits, dtype=np.float32).reshape(-1),
    }


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    model, model_path, weights_path, weights_sha = load_model(args.model)
    image_path = Path(args.image).resolve()
    image = Image.open(image_path).convert("RGB")
    source_image = image.resize((args.resolution, args.resolution), Image.BILINEAR)
    source_path = out_dir / "source-image.png"
    source_image.save(source_path)
    source_sha = sha256_file(source_path)

    exported = export_boundary_tensors(model, image, args.prompt, args.resolution)
    hyper_input = exported["hyperInput"]
    upscaled_embedding = exported["upscaledEmbedding"]
    expected_logits = exported["expectedMaskLogits"]
    expected_binary = exported["expectedBinaryMask"]
    shape = {
        "batch": int(hyper_input.shape[0]),
        "maskTokens": int(hyper_input.shape[1]),
        "channels": int(hyper_input.shape[2]),
        "height": int(upscaled_embedding.shape[2]),
        "width": int(upscaled_embedding.shape[3]),
    }

    written = {
        "hyperInput": write_array(out_dir / "hyper-input.f32.bin", hyper_input),
        "upscaledEmbedding": write_array(out_dir / "upscaled-embedding.f32.bin", upscaled_embedding),
        "expectedMaskLogits": write_array(out_dir / "expected-mask-logits.f32.bin", expected_logits),
        "expectedBinaryMask": write_array(out_dir / "expected-binary-mask.u32.bin", expected_binary),
    }

    prompt_sha = sha256_bytes(args.prompt.encode("utf-8"))
    reference = {
        "model": {
            "id": args.model,
            "snapshot": snapshot_id(model_path),
            "role": "mlx-reference-upstream",
        },
        "weights": {
            "file": "model.safetensors",
            "path": str(weights_path),
            "sha256": weights_sha,
        },
        "framework": {
            "name": "mlx-vlm",
            "root": str(Path(os.environ.get("KAMINOS_MLX_VLM_ROOT", Path.cwd())).resolve()),
            "execution": "uv-run",
        },
        "source": {
            "module": "mlx_vlm.models.sam3.segmentation.MaskDecoder",
            "boundaryFunction": "detector MaskDecoder mask_embedder(instance_projection(pixel_embed)) dot product",
        },
    }
    static_weights = {
        "artifactId": f"sam3-weights:{args.model}:reference-upstream",
        "sha256": weights_sha,
        "role": "reference-upstream",
        "reason": "weights produced the exported MLX boundary tensors; browser island consumes tensors only",
    }

    manifest = {
        "schema": SCHEMA,
        "routeId": ROUTE_ID,
        "mode": "mlx-reference-export",
        "boundary": BOUNDARY,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "reference": reference,
        "model": {
            "id": args.model,
            "role": "mlx-reference-upstream",
        },
        "prompt": {
            "text": args.prompt,
            "sha256": prompt_sha,
        },
        "sourceImage": {
            "artifactId": f"image:{image_path.name}:sam3-reference-source",
            "file": "source-image.png",
            "path": str(source_path),
            "sha256": source_sha,
            "originalPath": str(image_path),
            "resolution": [args.resolution, args.resolution],
        },
        "staticWeights": static_weights,
        "shape": shape,
        "claims": {
            "fullSam3BrowserExecution": False,
            "upstream": "mlx-vlm-sam3-detector-reference",
            "browserExecutedStages": ["decode-mask", "threshold-mask"],
        },
        "visualization": {
            "selectedMaskIndex": exported["selectedMaskIndex"],
            "selectedMaskScore": float(exported["scores"][exported["selectedMaskIndex"]]),
            "presenceLogits": [float(value) for value in exported["presenceLogits"]],
        },
        "tolerances": {
            "cpuOracleLogitsMaxAbsDiff": 0.0001,
            "webGpuLogitsMaxAbsDiff": 0.0001,
            "binaryMismatchCount": 0,
        },
        "tensors": [
            {
                "role": "hyper-input",
                "file": written["hyperInput"]["file"],
                "sha256": written["hyperInput"]["sha256"],
                "dtype": "float32",
                "shape": [shape["batch"], shape["maskTokens"], shape["channels"]],
                "layout": "B,T,C",
                "byteLength": written["hyperInput"]["byteLength"],
            },
            {
                "role": "upscaled-embedding",
                "file": written["upscaledEmbedding"]["file"],
                "sha256": written["upscaledEmbedding"]["sha256"],
                "dtype": "float32",
                "shape": [shape["batch"], shape["channels"], shape["height"], shape["width"]],
                "layout": "B,C,H,W",
                "byteLength": written["upscaledEmbedding"]["byteLength"],
            },
            {
                "role": "expected-mask-logits",
                "file": written["expectedMaskLogits"]["file"],
                "sha256": written["expectedMaskLogits"]["sha256"],
                "dtype": "float32",
                "shape": [shape["batch"], shape["maskTokens"], shape["height"], shape["width"]],
                "layout": "B,T,H,W",
                "byteLength": written["expectedMaskLogits"]["byteLength"],
            },
            {
                "role": "expected-binary-mask",
                "file": written["expectedBinaryMask"]["file"],
                "sha256": written["expectedBinaryMask"]["sha256"],
                "dtype": "uint32",
                "shape": [shape["batch"], shape["maskTokens"], shape["height"], shape["width"]],
                "layout": "B,T,H,W",
                "byteLength": written["expectedBinaryMask"]["byteLength"],
            },
        ],
    }

    manifest_path = out_dir / "tensor-manifest.json"
    receipt_path = out_dir / "reference-receipt.json"
    receipt = {
        "ok": True,
        "schema": "kaminos.sam3-mask-island-reference-receipt.v0",
        "routeId": ROUTE_ID,
        "mode": manifest["mode"],
        "boundary": manifest["boundary"],
        "reference": reference,
        "prompt": manifest["prompt"],
        "sourceImage": manifest["sourceImage"],
        "staticWeights": static_weights,
        "shape": shape,
        "outputs": {
            "tensorManifest": str(manifest_path),
            "sourceImage": str(source_path),
            "hyperInput": written["hyperInput"]["path"],
            "upscaledEmbedding": written["upscaledEmbedding"]["path"],
            "expectedMaskLogits": written["expectedMaskLogits"]["path"],
            "expectedBinaryMask": written["expectedBinaryMask"]["path"],
        },
    }

    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    receipt_path.write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
