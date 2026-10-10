---
license: apache-2.0
base_model: black-forest-labs/FLUX.2-klein-4B
base_model_relation: quantized
pipeline_tag: text-to-image
library_name: kaminos
tags:
- webgpu
- text-to-image
- flux
- quantized
- browser
---

# FLUX.2 [klein] 4B for WebGPU

Quantized weights of [FLUX.2 [klein] 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B), packed for text-to-image generation entirely in the browser with the [Kaminos](https://github.com/lyonsno/kaminos) WebGPU inference kit. The page downloads about 3.6 GB once (gzip copies of everything except the embedding table, from which it fetches only the rows a prompt uses), caches it, and generates on the visitor's own GPU. No server-side compute is involved.

**[Try it in your browser](https://lyonsno.github.io/kaminos/inference-kit/klein/)** · [Source](https://github.com/lyonsno/kaminos/tree/main/models/flux2-klein)

In Chrome, a 512 × 512 image (4 steps) takes 6–7 seconds on an Apple M4 Max and about 20 seconds on a 16 GB Apple M2 Pro. The page also offers 768 and 1024, and frees each stage's working memory before the next, so a 16 GB Mac generates at 1024 × 1024 without swapping.

## Contents

| Folder | Component | Format | Size |
| --- | --- | --- | --- |
| `te/` | Qwen3-4B text encoder, layers 0–26 (the pipeline reads hidden states 9, 18 and 27) | int4 weights, group 64, affine; norms f16 | 1.53 GB |
| `te/te-embed.bin` | Token-embedding table, read one row per token with HTTP range requests | f16 | 0.78 GB |
| `te/tokenizer.json` | Qwen2 byte-level BPE tokenizer | JSON | 11 MB |
| `dit/` | Rectified-flow transformer | block linears int4 (group 64, affine); embedders, modulation and output projections int8 (group 64); norms f16 | 2.27 GB |
| `vae/` | VAE decoder and latent batch-norm statistics | f16; statistics f32 | 0.1 GB |

Each folder has a `manifest.json` listing every tensor's shape, format, byte offset, and the SHA-256 of each file. Every bundle and the tokenizer also have a gzip copy (`.gz`, listed in the manifest), which is what the page downloads; the embedding table stays uncompressed for range requests. Quantization is weight-only. Activations and the residual stream stay in floating point.

## Changes from the original

- Weights quantized and repacked into per-block files as described above.
- Text encoder truncated to the layers the FLUX.2 [klein] pipeline uses.
- Projections that share an input are fused (for example query, key and value).
- 3×3 VAE convolution weights reordered for channels-last execution.

## License

Apache License 2.0, the same license as the original model. FLUX.2 [klein] 4B is by Black Forest Labs. Its text encoder is Qwen3-4B by the Qwen team, also Apache 2.0.
