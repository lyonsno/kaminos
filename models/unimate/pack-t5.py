"""Pack the Flan-T5-base encoder and its tokenizer for the UniMate WebGPU port.

Writes to ``--out``:
- ``t5-encoder-fp32.bin`` + ``t5-manifest.json``: encoder weights as float32, each
  tensor 256-byte aligned. Per block, q/k/v are fused into ``qkv`` [2304, 768]
  (rows q, k, v) and the gated feed-forward's wi_0/wi_1 into ``wi`` [4096, 768]
  (rows gate, up), matching the port's LINEAR + attention/gating kernels.
- ``t5-tokenizer.json``: the SentencePiece unigram pieces and scores, unk id and
  special ids, from the model's tokenizer.json.

With ``--reference`` it also writes ``t5-reference.json`` for a prompt corpus,
computed by upstream UniMate code: token ids from the T5Tokenizer that
``T5Conditioner`` uses, and the caption embedding from
``sample._make_text_encoder`` / ``_encode_prompt`` (mean of the last hidden state).
"""

import argparse
import hashlib
import json
import os

import numpy as np

ALIGN = 256
CORPUS = [
    "An object trots forward.", "An object rears up on its hind legs.", "A cat walks forward.",
    "A parrot flaps its wings.", "A dog sits down, then stands up and shakes.",
    "The creature crouches low and pounces to the left!", "a horse gallops in a circle",
    "Walk forward slowly, then turn around.", "  Leaps   over a gap   ", "It's jumping; then it's resting.",
    "A fox sniffs the ground (cautiously) and trots away.", "jump 3 times", "naïve café: déjà vu",
    "Bip01_L_Thigh", "BN_Tail_03", "FR_foot", "Head_upper", "left hind paw", "",
]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--t5-dir", required=True, help="google/flan-t5-base snapshot (model.safetensors, tokenizer.json)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--reference", action="store_true")
    ap.add_argument("--exp-dir", help="UniMate experiment dir, needed with --reference")
    args = ap.parse_args()

    from safetensors.numpy import load_file
    w = load_file(os.path.join(args.t5_dir, "model.safetensors"))
    cfg = json.load(open(os.path.join(args.t5_dir, "config.json")))
    L = cfg["num_layers"]
    tensors = {"shared": w["shared.weight"],
               "relative_attention_bias": w["encoder.block.0.layer.0.SelfAttention.relative_attention_bias.weight"],
               "final_layer_norm": w["encoder.final_layer_norm.weight"]}
    for i in range(L):
        a, f = f"encoder.block.{i}.layer.0", f"encoder.block.{i}.layer.1"
        tensors[f"block{i}.ln_attn"] = w[f"{a}.layer_norm.weight"]
        tensors[f"block{i}.qkv"] = np.concatenate([w[f"{a}.SelfAttention.{x}.weight"] for x in "qkv"], 0)
        tensors[f"block{i}.o"] = w[f"{a}.SelfAttention.o.weight"]
        tensors[f"block{i}.ln_ff"] = w[f"{f}.layer_norm.weight"]
        tensors[f"block{i}.wi"] = np.concatenate([w[f"{f}.DenseReluDense.wi_0.weight"], w[f"{f}.DenseReluDense.wi_1.weight"]], 0)
        tensors[f"block{i}.wo"] = w[f"{f}.DenseReluDense.wo.weight"]

    os.makedirs(args.out, exist_ok=True)
    bin_path = os.path.join(args.out, "t5-encoder-fp32.bin")
    entries, offset = [], 0
    with open(bin_path, "wb") as fh:
        for name, a in tensors.items():
            a = np.ascontiguousarray(a.astype("<f4"))
            pad = (-offset) % ALIGN
            fh.write(b"\0" * pad)
            offset += pad
            fh.write(a.tobytes())
            entries.append({"name": name, "shape": list(a.shape), "offset": offset, "byteLength": a.nbytes})
            offset += a.nbytes
    sha = lambda p: hashlib.sha256(open(p, "rb").read()).hexdigest()
    manifest = {"schema": "kaminos.unimate.t5-encoder-weights.v0", "file": os.path.basename(bin_path), "byteLength": offset,
                "sha256": sha(bin_path), "config": {k: cfg[k] for k in ["d_model", "d_kv", "d_ff", "num_heads", "num_layers",
                "relative_attention_num_buckets", "relative_attention_max_distance", "layer_norm_epsilon", "feed_forward_proj",
                "vocab_size"]},
                "source": {"model_sha256": sha(os.path.join(args.t5_dir, "model.safetensors")), "model": "google/flan-t5-base",
                           "license": "Apache-2.0"}, "tensors": entries}
    json.dump(manifest, open(os.path.join(args.out, "t5-manifest.json"), "w"), indent=2)

    tj = json.load(open(os.path.join(args.t5_dir, "tokenizer.json")))
    model = tj["model"]
    tok = {"schema": "kaminos.unimate.t5-tokenizer.v0", "type": model["type"], "unk_id": model["unk_id"],
           "pieces": [p for p, _ in model["vocab"]], "scores": [s for _, s in model["vocab"]],
           "eos_id": 1, "pad_id": 0, "normalizer": tj["normalizer"], "pre_tokenizer": tj["pre_tokenizer"],
           "source_sha256": sha(os.path.join(args.t5_dir, "tokenizer.json"))}
    # Relative-position buckets for distances -511..511, from HF's own function, so the
    # browser never re-derives T5's float32 log rule.
    import torch
    from transformers.models.t5.modeling_t5 import T5Attention
    rel = torch.arange(-511, 512)
    buckets = T5Attention._relative_position_bucket(rel, bidirectional=True, num_buckets=cfg["relative_attention_num_buckets"],
                                                     max_distance=cfg["relative_attention_max_distance"])
    manifest["relative_buckets"] = {"min_distance": -511, "buckets": buckets.tolist()}
    json.dump(manifest, open(os.path.join(args.out, "t5-manifest.json"), "w"), indent=2)
    json.dump(tok, open(os.path.join(args.out, "t5-tokenizer.json"), "w"))
    print(f"packed {len(entries)} tensors, {offset} bytes; tokenizer {len(tok['pieces'])} pieces")

    if args.reference:
        import torch
        from unimate.configs.schema import MainConfig
        from unimate.inference.sample import _encode_prompt, _make_text_encoder
        config = MainConfig.from_json(os.path.join(args.exp_dir, "config.json"))
        enc = _make_text_encoder(config, torch.device("cpu"))
        cases = []
        for text in CORPUS:
            ids = enc.t5_tokenizer(text)["input_ids"]
            row = {"text": text, "ids": ids}
            if text:
                e = _encode_prompt(enc, text)
                row["caption_emb"] = np.asarray(e["caption_emb"], dtype=np.float32).tolist()
                row["tokens"] = np.asarray(e["caption_tokens"], dtype=np.float32).tolist()
            cases.append(row)
        json.dump({"schema": "kaminos.unimate.t5-reference.v0", "torch": torch.__version__, "cases": cases},
                  open(os.path.join(args.out, "t5-reference.json"), "w"))
        print(f"reference: {len(cases)} cases")


if __name__ == "__main__":
    main()
