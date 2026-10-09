# TRELLIS 2 developer setup

This guide covers the local tools for converting an image into a textured GLB
and the JavaScript interfaces for embedding the model in an application.
For a capability overview, see the [model README](README.md).

## Before you start

The current generation tools require a **prepared weight package**: a directory
containing `manifest.json` and the float32 tensor files named by that manifest.
This is different from the original Hugging Face safetensors download.

For the examples below, use the **full base package** assembled by
`pack-generation.py`, including the high-resolution shape model. It combines
the TRELLIS shape/material models and the DINOv3 image encoder and can be reused
for different images. This base is separate from the per-image preview package
written later under `TRELLIS_OUTPUT/input`. The conversion tools currently
assemble it from exported model stages; the repository does not yet provide
a standalone converter for every stage, including the DINOv3 export.
If you only have the original checkpoints, preparation of this package is
still a development step. The commands below start after that step.

You will also need:

- An Apple Silicon Mac running macOS, with enough memory for the model.
- Node.js 22 or newer. The browser runner uses Node's built-in WebSocket client.
- A WebGPU-enabled **Chrome for Testing** executable. Use a separate browser
  installation rather than your normal Chrome application; the runner creates
  and removes its own temporary browser profile.
- A clean [TRELLIS2MLX checkout](https://github.com/lyonsno/trellis2mlx) and its
  Python environment. The workflow imports `trellmlx.preprocess` for image
  preparation and mesh-cleanup utilities for finishing.
- Python packages NumPy, Pillow, rembg, ONNX Runtime, SciPy, trimesh and
  fast-simplification in that environment. Follow TRELLIS2MLX's setup guide,
  then install any missing packages there.

The original checkpoints are available from
[Microsoft's TRELLIS 2 model page](https://huggingface.co/microsoft/TRELLIS.2-4B)
and [Meta's DINOv3 model page](https://huggingface.co/facebook/dinov3-vitl16-pretrain-lvd1689m).
Check the model pages for access and license requirements.

## Set up the checkout and paths

~~~sh
git clone https://github.com/lyonsno/kaminos.git
cd kaminos
npm ci
~~~

The following examples use a POSIX shell. Set these four paths for your machine:

~~~sh
TRELLIS_WEIGHTS="/absolute/path/to/prepared-weight-package"
TRELLIS_MLX="/absolute/path/to/trellis2mlx"
TRELLIS_CHROME="/absolute/path/to/Chrome-for-Testing-executable"
TRELLIS_IMAGE="/absolute/path/to/object.png"
~~~

`TRELLIS_WEIGHTS` contains the prepared package's `manifest.json`.
`TRELLIS_MLX` contains `trellmlx/preprocess.py` and a configured `.venv`.
`TRELLIS_CHROME` names the executable itself, not the application directory.
`TRELLIS_IMAGE` is the original image.

Set the remaining values from those paths:

~~~sh
TRELLIS_KAMINOS_ROOT="$(pwd)"
TRELLIS_KAMINOS_REV="$(git rev-parse HEAD)"
TRELLIS_MLX_REV="$(git -C "$TRELLIS_MLX" rev-parse HEAD)"
TRELLIS_PYTHON="$TRELLIS_MLX/.venv/bin/python"
TRELLIS_IMAGE_SHA="$(shasum -a 256 "$TRELLIS_IMAGE" | cut -d ' ' -f 1)"
TRELLIS_WEIGHTS="$(node -p 'require("node:fs").realpathSync(process.argv[1])' "$TRELLIS_WEIGHTS")"
TRELLIS_OUTPUT="$(dirname "$TRELLIS_WEIGHTS")/trellis-output/object"
mkdir -p "$TRELLIS_OUTPUT"
~~~

The image packer uses hard links to share weight files without copying them,
so its input-package output must be on the **same filesystem as the weights**.
The example resolves the weights' actual path and places the output beside
that directory; this also works when the weights are on an external drive.
You can choose another output directory on that filesystem. Keep generated
files outside the Kaminos and TRELLIS2MLX source checkouts: these tools require
clean source trees. Revisions and the image hash are computed above.

## 1. Prepare the image

This command removes the background when needed, crops the object and creates
the generation inputs. It reuses the existing model weights.

~~~sh
"$TRELLIS_PYTHON" models/trellis2/pack-prepared-generation.py \
  --repo-root "$TRELLIS_KAMINOS_ROOT" --expected-commit "$TRELLIS_KAMINOS_REV" \
  --base "$TRELLIS_WEIGHTS" --image "$TRELLIS_IMAGE" \
  --expected-image-sha256 "$TRELLIS_IMAGE_SHA" \
  --preprocess-source-root "$TRELLIS_MLX" \
  --expected-preprocess-source-commit "$TRELLIS_MLX_REV" \
  --pipeline-type 512 --steps 8 --out "$TRELLIS_OUTPUT/input"
~~~

Inspect `$TRELLIS_OUTPUT/input/foreground/prepared-shoe.png` before generating.
The current tool uses that filename for every object; it does not require a
shoe image. Transparent images use their existing alpha channel.

For the higher-resolution route, change `--pipeline-type 512` to
`--pipeline-type 1024_cascade`. This adds a second shape-sampling pass.
Keep `TRELLIS_WEIGHTS` pointing to the full base package. A reduced 512 package
omits the high-resolution model and cannot enable the cascade merely by
changing this argument.
`--steps` chooses the sampling-step count; eight is a useful preview starting
point, while the original full configuration uses twelve.

## 2. Generate the geometry and materials

~~~sh
node models/trellis2/run-sparse-prefix-witness.mjs \
  --repo-root "$TRELLIS_KAMINOS_ROOT" --expected-commit "$TRELLIS_KAMINOS_REV" \
  --witness generation --fields-only --fixture "$TRELLIS_OUTPUT/input" \
  --chrome "$TRELLIS_CHROME" --memory-python "$TRELLIS_PYTHON" \
  --receiver local-user --report "$TRELLIS_OUTPUT/generated/report.json"
~~~

Despite its historical filename, this command runs the complete image-to-3D
model when given `--witness generation`. It opens its own browser, executes
WebGPU inference and saves the geometry, material data and run report.

`--fields-only` saves the model output without first exporting the unsimplified
mesh. This lets you release model resources and finish the mesh separately.
The `--fixture` argument names the prepared input directory; it is not a
pre-generated output. `--receiver` is a label stored in the report.

## 3. Finish and export the mesh

~~~sh
node models/trellis2/finalize-retained-generation.mjs \
  --repo-root "$TRELLIS_KAMINOS_ROOT" --expected-commit "$TRELLIS_KAMINOS_REV" \
  --input-root "$TRELLIS_OUTPUT/generated" \
  --expected-native-commit "$TRELLIS_KAMINOS_REV" \
  --python "$TRELLIS_PYTHON" --source-root "$TRELLIS_MLX" \
  --expected-source-commit "$TRELLIS_MLX_REV" --target-faces 200000 \
  --receiver local-user --output "$TRELLIS_OUTPUT/finished/asset.glb"
~~~

This extracts and cleans the surface, simplifies it toward 200,000 triangles,
unwraps texture coordinates and bakes 1K color and metallic/roughness textures.
Open the resulting `asset.glb` in Blender or import it into Kaminos.

Finishing does not rerun the model. You can choose another `--target-faces`
value and output directory to try a different mesh size from the same
generation. If generation fails, inspect `generated/report.json` before
attempting export; it names the failing stage.

## Embedding generation in a browser application

The model uses a registered inference-kit **route**, which groups model work
on an existing WebGPU device. Queue one invocation through that route, then
consume the returned GPU tensors before disposing the generator:

~~~js
import { createTrellisImageGenerationAdapter } from "./models/trellis2/trellis-generation.js";
import { loadGenerationInputs } from "./models/trellis2/generation-inputs.js";

// manifest: the prepared package's manifest.json.
// fetchTensor: loads a named tensor from that package as a Float32Array.
// route: a registered route from the application's inference-kit session.
const inputs = await loadGenerationInputs(manifest, fetchTensor);
const generator = createTrellisImageGenerationAdapter({ route, ...inputs });
const job = route.enqueue({
  jobId: crypto.randomUUID(),
  execute: invocation => generator.run(invocation),
});
const result = await job.completion;
if (result.status === "succeeded") {
  // result.output contains resident geometry and material tensors.
  // Read or consume them before calling generator.dispose().
}
~~~

For Kaminos renderer integration, [`createTrellisSharedHost`](shared-host.js)
attaches to the host's existing device and queue. Its `beginRun({runId,signal})`
returns a run object with a `route` field; use that route for generation, then
call the run's `finish()` to wait for model/foreground work and release it.
The host retains ownership of its device. The
[shared-generation example](shared-generation-smoke.js) shows that connection.

## Memory and performance

Model weights are float32 and load one stage at a time. Keep the weight package
on local storage and start with the 512 profile before spending on 1024.
Generation time and memory grow with settings and the complexity of the
generated surface; simultaneous rendering also consumes GPU time.

A recorded 512 sneaker run peaked at about 6.27 GiB of WebGPU buffers. The
sampled sum of browser/runner process footprints reached about 16.4 GiB.
Those counters measure different allocations and must not be added together;
the process sum is not unique physical RAM usage. Measurements for smaller
16–18 GB machines are still pending.

## Weight conversion and model development

[`pack-generation.py`](pack-generation.py) assembles the prepared weight
package used above. Its inputs are the original TRELLIS checkpoint snapshot
and five exported-stage directories:

| Input | Contents |
| --- | --- |
| `--dino-reference` | Normalized image/prefix tensors and all 24 DINOv3 layer weights, described by `reference-manifest.json` |
| `--sparse-reference` | Sparse-flow weights and activation tables |
| `--shape-reference` | Low-resolution shape-flow weights |
| `--decoder-reference` | Shape-decoder weights and activation tables |
| `--occupancy-reference` | Occupancy-decoder weights |

The last four directories use `manifest.json`. The exporter scripts in this
directory produce individual stages for model development. The DINOv3 export
step is not packaged here yet, so `pack-generation.py` is an assembly tool for
existing exports, not a direct safetensors importer.

Tests live under [`tests/`](tests/). Numerical development uses the individual
sparse, shape and decoder exporters plus their browser runners; the ordinary
generation workflow above uses the complete model rather than those isolated
stage tests.
