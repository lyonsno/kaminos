# FLUX.3 Klein (WebGPU, in progress)

Browser port of FLUX.3 Image Klein (`black-forest-labs/flux-3-image-klein`, the 16-step distilled
flow-map checkpoint), text-to-image only. Built on the FLUX.2 Klein port: every FLUX.3 block is one
LayerNorm feeding parallel attention and SwiGLU, so the packer fuses each into FLUX.2's single-stream
layout and the GEMM, attention, norm and duty-scheduling kernels are reused unchanged.

Present: text-to-image end to end. On an M4 Max a 512 × 512 image takes about 23 s (16 steps at about 1.35 s each with the product kernels, text 0.2 s, decode 0.4 s), with a 5.4 GB GPU peak.

- `pack-flux3-transformer.py`: per-block bundles, int4 blocks and int8 globals by default (2.85 GB),
  leaving out the reference-image mode that text-to-image never runs.
- `flux3-transformer.js`: the forward pass (timestep plus flow-map target conditioning, per-mode text
  and image blocks, joint single blocks with per-mode modulation, 4-axis RoPE with theta 10000 and the
  image positions scaled by 0.5).
- `flux3-schedule.js`: the shift-6.93 sigma schedule and per-step targets.
- `export-flux3-reference.py`, `transformer-witness.html`, `run-flux3-transformer-witness.mjs`: parity
  against diffusers' own transformer in float32 on the same quantized weights and real text features,
  every block compared, then timing.

- Text encoder: the Qwen3-VL text model has Qwen3-4B's shapes, so FLUX.2 Klein's encoder runs it.
  `../flux2-klein/pack-text-encoder.py` with the layout options in its docstring packs layers 0-31
  (hidden states 4, 8, ..., 32 are read) at int4, 1.82 GB plus the range-fetched f16 embedding table;
  `flux3-prompt.js` frames the prompt (chat template without a think block, padded to a multiple of
  80, padding at RoPE position 1, which `KleinTextEncoder.allocate` now accepts). With `--te` the
  witness checks the framing, every tapped hidden state and the prompt embeddings, then runs the
  transformer on the browser's own text features.

- Decoder: FLUX.3 ships FLUX.2's VAE at higher precision (rounded to bf16, every tensor equals
  FLUX.2's), so FLUX.2 Klein's f16 VAE pack decodes FLUX.3 latents.
- `flux3-pipeline.js`: `Flux3Pipeline` extends `KleinPipeline`, overriding only its model hooks
  (transformer class, prompt framing, RoPE ids, schedule); weight caching, lean residency,
  precompile, prompt reuse, live previews (same latent space) and decoding are Klein's. FLUX.2 Klein's
  `generate.html` runs it with `?model=flux3`, and `run-generate.mjs --model flux3 --steps 16` batches it.

- Few-step variant: the base checkpoint (`flux-3-image-klein-base`, no flow map) with the community
  4-step distill LoRA `Muinez/flux3-klein-distil-4step` merged in at pack time
  (`pack-flux3-transformer.py --lora <file>`, `flux3_lora.py` finishes the LoRA's key conversion).
  The manifest records the recipe (shift 3, 4 steps; 2-3 also work), which `Flux3Pipeline` follows.
  Same size as the distilled pack (2.83 GB); a 512 image takes 4 transformer steps instead of 16.

## Use in Kaminos

The Generate tab's Image step offers **FLUX.3 Image Klein (local)** alongside FLUX.2.
Mount an existing local weight package with `te/`, `dit/` and `vae/` directories, each
containing its manifest and packed files:

```sh
KAMINOS_FLUX3_WEIGHTS_ROOT=/path/to/local/package python3 serve.py 8090
```

Choose FLUX.3, enter a prompt and generate. The transformer manifest selects the sampling
recipe: the merged four-step LoRA pack uses four steps and the distilled pack uses sixteen.
The current pack is 4-bit; FLUX.2's 3-bit and 2-bit choices are unavailable for FLUX.3.
Switching models releases the previous pipeline before loading the next one. The output
is saved in Source images and selected for the existing image-to-mesh flow. Its PNG carries
the effective model, route, weight source, sampling recipe and merged-adapter metadata.

The server reports the mount under `flux3` in `/api/runtime-config` and serves it at
`/flux3-weights/`, including the text encoder's byte-range reads. A missing, incomplete or
FLUX.2 transformer package is unavailable; the app does not substitute hosted FLUX.2 weights
for a FLUX.3 request. Choose the server's bind address and network access deliberately, as
for other locally mounted models.

FLUX.3 weights retain the [FLUX Kommunity License](https://huggingface.co/black-forest-labs/flux-3-image-klein/blob/main/LICENSE.md).
Local application integration does not change those terms. This port has no public FLUX.3
weight host or standalone public demo.

    python pack-flux3-transformer.py --model-dir <snapshot> --out <weights>
    python export-flux3-reference.py --model-dir <snapshot> --out <ref> --prompt-file <txt>
    node run-flux3-transformer-witness.mjs --chrome <Chrome for Testing> --weights <weights> --ref <ref> \
        --out <report.json> [--te <text-encoder dir>] [--timing-size 512] [--profile]

The reference export needs diffusers with FLUX.3 support (main after 0.41.0) and torchvision.
