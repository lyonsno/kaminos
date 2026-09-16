"""Regenerate the small decoder regression from the installed MLX reference on CPU."""
import argparse
import hashlib
import inspect
import json
import subprocess
from pathlib import Path

import mlx.core as mx
import numpy as np
from mlx.utils import tree_flatten
from mlx_vlm.models.sam3.config import DETRDecoderConfig
from mlx_vlm.models.sam3.decoder import DETRDecoder


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    mx.set_default_device(mx.cpu)
    mx.random.seed(916)
    config = DETRDecoderConfig(hidden_size=8, num_attention_heads=2,
                               intermediate_size=12, num_layers=2, num_queries=2)
    model = DETRDecoder(config)
    rng = np.random.default_rng(916)
    inputs = {
        "visionFeatures": rng.normal(size=(1, 6, 8)).astype(np.float32),
        "visionPosEncoding": rng.normal(size=(1, 6, 8)).astype(np.float32),
        "promptFeatures": rng.normal(size=(1, 3, 8)).astype(np.float32),
        "promptMask": np.array([[1, 1, 0]], dtype=np.float32),
    }
    hs, boxes, presence = model(
        mx.array(inputs["visionFeatures"]), mx.array(inputs["promptFeatures"]),
        mx.array(inputs["visionPosEncoding"]), mx.array(inputs["promptMask"]),
        spatial_shape=(2, 3),
    )
    mx.eval(hs, boxes, presence)
    weights = dict(tree_flatten(model.parameters()))
    def values(value):
        return np.array(value, dtype=np.float32).reshape(-1).tolist()
    def weight(key):
        return values(weights[key])
    layers = []
    for i in range(config.num_layers):
        layer = {}
        for prefix, module in [("self", "self_attn"), ("text", "text_cross_attn"), ("vision", "vision_cross_attn")]:
            for projection in "qkvo":
                for suffix in ["weight", "bias"]:
                    layer[prefix + projection.upper() + suffix.title()] = weight(f"layers.{i}.{module}.{projection}_proj.{suffix}")
        for prefix, module in [("self", "self_attn"), ("text", "text_cross_attn"), ("vision", "vision_cross_attn"), ("mlp", "mlp")]:
            for suffix in ["weight", "bias"]:
                layer[prefix + "LayerNorm" + suffix.title()] = weight(f"layers.{i}.{module}_layer_norm.{suffix}")
        for fc in ["fc1", "fc2"]:
            for suffix in ["weight", "bias"]:
                layer[fc + suffix.title()] = weight(f"layers.{i}.mlp.{fc}.{suffix}")
        layers.append(layer)
    fixture = {key: values(value) for key, value in inputs.items()}
    fixture.update(layers=layers, queryEmbed=weight("query_embed.weight"),
                   referencePoints=weight("reference_points.weight"), presenceToken=weight("presence_token.weight"))
    for prefix, module in [("outputLayerNorm", "output_layer_norm"), ("presenceLayerNorm", "presence_layer_norm")]:
        for suffix in ["weight", "bias"]:
            fixture[prefix + suffix.title()] = weight(f"{module}.{suffix}")
    for prefix, module, count in [("refPointHead", "ref_point_head", 2), ("boxHead", "box_head", 3),
                                   ("boxRpbX", "box_rpb_embed_x", 2), ("boxRpbY", "box_rpb_embed_y", 2),
                                   ("presenceHead", "presence_head", 3)]:
        for i in range(1, count + 1):
            for suffix in ["weight", "bias"]:
                fixture[f"{prefix}Layer{i}{suffix.title()}"] = weight(f"{module}.layer{i}.{suffix}")
    fixture["shape"] = dict(batch=1, channels=8, heads=2, layerCount=2, mlpHidden=12,
                            queryTokens=2, promptTokens=3, spatialTokens=6, sineFeatures=4, height=2, width=3)
    source = Path(inspect.getfile(DETRDecoder)).resolve()
    commit = subprocess.check_output(["git", "-C", str(source.parent), "rev-parse", "HEAD"], text=True).strip()
    result = {
        "provenance": {"sourceCommit": commit, "sourceFile": "mlx_vlm/models/sam3/decoder.py",
                       "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                       "backend": "mlx-cpu", "dtype": "float32", "seed": 916,
                       "claim": "Small actual-reference decoder replay; not trained-model segmentation accuracy"},
        "input": fixture,
        "expected": {"decoderHiddenStates": values(hs), "decoderBoxes": values(boxes),
                     "presenceLogits": values(presence)},
    }
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"out": str(out), "provenance": result["provenance"]}))


if __name__ == "__main__":
    main()
