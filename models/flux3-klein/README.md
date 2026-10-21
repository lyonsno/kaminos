# FLUX.3 Klein (WebGPU, in progress)

Browser port of FLUX.3 Image Klein (`black-forest-labs/flux-3-image-klein`, the 16-step distilled
flow-map checkpoint), text-to-image only. Built on the FLUX.2 Klein port: every FLUX.3 block is one
LayerNorm feeding parallel attention and SwiGLU, so the packer fuses each into FLUX.2's single-stream
layout and the GEMM, attention, norm and duty-scheduling kernels are reused unchanged.

Present: the transformer.

- `pack-flux3-transformer.py`: per-block bundles, int4 blocks and int8 globals by default (2.85 GB),
  leaving out the reference-image mode that text-to-image never runs.
- `flux3-transformer.js`: the forward pass (timestep plus flow-map target conditioning, per-mode text
  and image blocks, joint single blocks with per-mode modulation, 4-axis RoPE with theta 10000 and the
  image positions scaled by 0.5).
- `flux3-schedule.js`: the shift-6.93 sigma schedule and per-step targets.
- `export-flux3-reference.py`, `transformer-witness.html`, `run-flux3-transformer-witness.mjs`: parity
  against diffusers' own transformer in float32 on the same quantized weights and real text features,
  every block compared, then timing.

Not yet: the text encoder (Qwen3-VL, layers 0-31), VAE decode (FLUX.2's), the page.

    python pack-flux3-transformer.py --model-dir <snapshot> --out <weights>
    python export-flux3-reference.py --model-dir <snapshot> --out <ref> --prompt-file <txt>
    node run-flux3-transformer-witness.mjs --chrome <Chrome for Testing> --weights <weights> --ref <ref> \
        --out <report.json> [--timing-size 512] [--profile]

The reference export needs diffusers with FLUX.3 support (main after 0.41.0) and torchvision.
