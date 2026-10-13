# Material Photograph

Turn a photograph into a surface you can relight.

**[Explore Material Photograph in your browser](https://lyonsno.github.io/kaminos/inference-kit/material-photo/)**. Three included model results are available for orbiting, relighting and comparison without downloading model weights. To generate a result from your own photograph, use the local setup below.

![Original photograph, photograph with depth, image as albedo, and inferred materials in the same HDR environment](comparison.png)

MoGe-2 recovers depth and normals. SuperMat estimates albedo, roughness and metalness. The four synchronized views separate what each contributes: an unchanged photograph on a flat plane, the photograph on recovered geometry, that geometry lit with the photograph as albedo, and the surface lit with inferred materials.

The original photograph and photograph with depth retain their backgrounds. The two lit views isolate the orb and backpack with hand-authored display cutouts. Original images and model outputs remain intact.

Orbit the views together, enlarge one, move the light, or change the HDR environment. The tuning panel exposes material contrast, screen-space GI and AO, and optional heuristic glow extraction with bloom. Material inference supports 512, 768 and 1024 pixel square outputs. Completed results are retained in browser storage when available, so returning to an image and resolution can restore them without another run.

## Run Locally

From a local Kaminos checkout, run `python3 serve.py 8095` and open [Material Photograph](http://127.0.0.1:8095/demos/material-photo/index.html) in a WebGPU-capable Chromium browser. The included examples are playable without model weights: orbit, relight and browse the three saved results immediately. They are labeled separately from your cached and newly generated results.

Generating a new result requires a prepared SuperMat WebGPU weight package. MoGe weights download after you select **Reveal depth & materials**; SuperMat weights are separate from the repository and npm package.

1. Prepare the SuperMat package with [pack-weights.py](../../models/supermat/pack-weights.py). Its inputs are the SuperMat checkpoint, the Stable Diffusion 2.1 VAE and conditioning exported by [export-reference.py](../../models/supermat/export-reference.py). Use the packer's `--dtype f16` and `--chunk-bytes 16777216` options for the chunked FP16 route.
2. Make that package directory available as `scratch/supermat-weights/f16/` in the checkout. It must contain `package.json` and all referenced bundle and chunk files. A symlink to an existing package directory works.
3. From the repository root, start the server:

```sh
python3 serve.py 8095
```

Choose a sample or upload an image, then select **Reveal depth & materials**. Initial model loading is separate from inference and can take substantially longer. You can keep exploring included results during loading and generation. If you browse to another photograph, completion offers **View your result** without replacing the photograph you are exploring. **Generate at** selects the next run's material resolution; included results are labeled with their saved resolution.

To use a separately served package, append a URL-encoded `weights` query parameter containing the package directory URL, with a trailing slash. The server must permit browser access from the demo's origin.

## How It Composes

[main.js](main.js) owns image selection, model setup, inference and result restoration. The [comparison viewer](comparison-viewer.js) shares the device and camera controls across four views and the same subject geometry between the two lit views; [viewer.js](viewer.js) handles material rendering. The [SuperMat adapter](../../models/supermat/supermat-route.js) owns model resources and execution.

The application creates the shared device and inference session, gives MoGe that device, and registers SuperMat's weight and inference routes with the session. Model outputs become rendering inputs without replacing the application's device. Emission is a presentation heuristic, not a SuperMat output.

Read the [Kaminos WebGPU Inference Kit guide](../../webgpu-inference-kit/README.md) for the reusable runtime and [Getting Started](../../webgpu-inference-kit/docs/getting-started.md) for a smaller integration example.
