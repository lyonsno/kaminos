# FLUX.2 [klein] 4B for WebGPU

Generate images from a text prompt with [FLUX.2 [klein] 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) running entirely in the browser. The text encoder, the diffusion transformer and the image decoder all run on the visitor's GPU through WebGPU, using the [Kaminos inference kit](../../webgpu-inference-kit/README.md). No server does any of the work.

**[Try it in the browser](https://lyonsno.github.io/kaminos/inference-kit/klein/)**

![Six images generated in the browser: a fisherman portrait, a celadon teapot, a misty forest valley, a watercolor fox under a mushroom, a neon OPEN ALL NIGHT sign, and a brass toy locomotive](assets/examples.jpg)

*Six prompts at 512 × 512 with 4 steps, generated in Chrome.*

## What it does

- **The whole model in the browser.** The Qwen3-4B text encoder (the 27 layers whose hidden states the model reads), the 4-step rectified-flow transformer and the VAE decoder all run as WGSL compute shaders.
- **A 3.2 GB download, cached.** Weights are int4 (groups of 128, weight-only), packed per block, downloaded as gzip copies that the page inflates, and kept in the browser's Cache API after the first visit. The 0.8 GB token-embedding table is never downloaded whole: the page fetches only the rows a prompt uses, with HTTP range requests.
- **Room for the application to keep rendering.** Model work is submitted as inference-kit command duties sized to measured GPU throughput, so a renderer on the same device keeps its frame rate during generation. Generation can be paused, resumed and stopped between duties.
- **Same output either way.** A generation that shares the GPU produces the same pixels as one that runs without yielding, and on a given machine and browser the same seed and prompt reproduce the same image.

## Speed

Times are for one image with 4 steps in Chrome, sharing the GPU with a continuously rendering scene.

| Size | 16 GB Apple M2 Pro | Apple M4 Max |
| --- | --- | --- |
| 512 × 512 | 19–22 s | 6–7 s |
| 768 × 768 | 40–46 s | about 12 s |
| 1024 × 1024 | 67–69 s | about 23 s |

During generation the scene kept a median frame time of about 20 ms on the M2 Pro.

## Memory

The weights take 3.9 GB of GPU memory. Working memory grows with image size, so the transformer's buffers are released before the image decoder allocates its own, and the decoder's are released once the image is read back. On the 16 GB M2 Pro a 1024 × 1024 image left 30% of memory free without any swapping.

## Running it

The [demo page](index.html) loads weights from [BasinShapers/flux2-klein-4b-webgpu](https://huggingface.co/BasinShapers/flux2-klein-4b-webgpu). Add `?weights=<base URL>` to load them from elsewhere; the base must contain the `te/`, `dit/` and `vae/` folders.

To pack the weights yourself from the original checkpoint:

```sh
hf download black-forest-labs/FLUX.2-klein-4B
python pack-text-encoder.py --model-dir <snapshot> --format i4 --out weights/te
python pack-transformer.py --model-dir <snapshot> --format i4 --globals-format i8 --out weights/dit
python pack-vae.py --model-dir <snapshot> --out weights/vae
node serve-klein.mjs --te weights/te --dit weights/dit --vae weights/vae
```

Then open `http://localhost:18709/index.html?weights=` (an empty base loads from the local server). The packers need Python with `torch`, `safetensors` and `numpy`.

## Using it in an application

- [`KleinPipeline`](klein-pipeline.js) is the model: `load()` fetches and uploads the weights, and `generate({ prompt, seed, width, height })` returns RGBA pixels with per-stage timings. Passing a `schedule` with an inference-kit route runtime and its queued invocation makes the run cooperative.
- [`createKleinDemo`](klein-demo.js) shows the complete wiring: an inference session on a shared device, a foreground service for the renderer's frames, a route per run, and pause, resume and stop through the inference control.

## License

FLUX.2 [klein] 4B is by Black Forest Labs and its text encoder, Qwen3-4B, is by the Qwen team; both are released under the Apache License 2.0, as are the converted weights.
