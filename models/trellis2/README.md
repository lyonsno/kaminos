# TRELLIS 2 for WebGPU

Turn an image into a textured 3D mesh with [TRELLIS 2](https://github.com/microsoft/TRELLIS.2)
running in the browser. This port runs the image encoder, shape generation and
material generation on WebGPU, using the [Kaminos inference kit](../../webgpu-inference-kit/README.md).

The output is a **GLB**: a single 3D file containing the mesh and its textures,
which you can open in Kaminos, Blender or another glTF-compatible application.
Materials include color, roughness and metallic textures.

## What it does

- **512-resolution previews** for exploring an image, and **1024-resolution
  generation** that refines a coarse shape into a more detailed one.
- **Automatic image preparation:** remove the background, crop the foreground
  and prepare the pixels before generation. Images with transparency use their
  existing foreground mask.
- **Mesh finishing:** clean up and simplify the generated surface, unwrap its
  texture coordinates, and bake 1K material textures.
- **Generation alongside rendering:** a host application can share its GPU
  device with the model and render between model operations.
- **Stage-by-stage loading:** load and release each model's weights as the
  pipeline progresses instead of keeping all models in GPU memory together.

The learned model runs on WebGPU. Image preparation and mesh finishing use
local Python and worker tools.

## Using the port

This is currently a **developer port**, provided as JavaScript adapters and
local command-line tools. The command-line workflow starts with a prepared
weight package; a direct installer for the original model checkpoints is not
included yet.

Start with the [developer setup and generation guide](developer-guide.md).
It explains the required files, dependencies and commands for taking an image
through to a GLB. The current command-line workflow uses Apple Silicon macOS
and an independent Chrome for Testing browser.

For application integration, the two main entrypoints are:

- [`createTrellisImageGenerationAdapter`](trellis-generation.js): run the
  complete model through an inference-kit route.
- [`createTrellisSharedHost`](shared-host.js): connect generation to Kaminos'
  existing GPU device and renderer.

The model code lives in this directory. Installing
`@kaminos/webgpu-inference-kit` installs the reusable runtime, not the TRELLIS
weights or these model tools. Integration with Kaminos' normal Generate panel
is in development.

## Choosing an input and output size

Use a clear view of one object, with its whole outline visible. Background
preparation happens before the model sees the image; mesh cleanup is for the
generated surface, not for removing a photographed background.

Start with the 512 profile and eight sampling steps. The 1024 profile adds a
second shape-generation pass for more detail and takes longer. The finishing
command lets you choose the target triangle count independently of generation.

This version uses float32 model weights and is developed on high-memory Apple
Silicon Macs. Support for 16–18 GB machines is being worked on. See the
[developer guide](developer-guide.md#memory-and-performance) for current memory
measurements and performance considerations.

## Related projects

- [Microsoft TRELLIS 2](https://github.com/microsoft/TRELLIS.2) — the original model.
- [Meta DINOv3](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m) — the image encoder.
- [TRELLIS2MLX](https://github.com/lyonsno/trellis2mlx) — the Apple Silicon MLX port whose image-preparation and mesh-cleanup utilities this workflow uses.
