# Neural surface materials

The `neumip` Workbench experiment renders existing NeuMIP author checkpoints
with a fused WebGPU material. It retains the learned view-dependent offset,
independently fitted texture pyramid, and directional reflectance decoder.
The surface uses the normal scene camera, selection and transforms. Native
point, spot and directional lights evaluate the learned response; there is no
fixed light-count array in the material.

## Install and open

Install the original public author models into the mounted image-inbox root
reported by `/api/roots`. The installer downloads three materials by default:

```sh
python3 tools/install_neumip_models.py \
  --root "$HOME/.local/state/kaminos/assets/images/inbox/neumip-author-models"
python3 serve.py 8095
```

Open `http://127.0.0.1:8095/?experiment=neumip&workspace=workbench`.
Choose wool, rock or embroidery; adjust UV scale and material gain, orbit, or
switch the carrier between a static folded surface and a sphere. Use normal
scene light controls to edit illumination. The folded carrier is an analytical
static mesh, not a cloth simulation.

`--materials` accepts `cave cliff dotted embroidery foam rocky sbai shell
victorian wool wool2`. Existing catalog entries remain when installing more
materials. `--source-dir` reuses previously downloaded original `.model` files.
The installer records source URLs, byte lengths and SHA256 values in
`catalog.json`; the browser verifies each selected archive against that digest.
Models remain local assets; no model archive is bundled with this source.

Experiment inputs retain `material`, `surface`, `uvScale` and `gain` through the
normal experiment URL. `inputs.view` can restore an explicit scene camera.
The carrier is experiment-owned and is removed on closing. This first version
does not reconstruct its custom material through ordinary scene-file saving.

## Current boundary

Indirect/environment response, area-light integration, and the custom flame
surface-lighting producer are not implemented. The material does not substitute
a white diffuse response for those missing directional integrations. It uses
the shared scene rendering pipeline; native direct-light shadows remain the
light producer's responsibility. Large silhouettes remain mesh geometry.
No training, frame-rate or broad performance claim follows from this port.
The default SSGI source and beauty passes currently evaluate this material
twice. Reusing the first evaluation is an identified optimization before
interpreting a practical screen-coverage budget.

The public factory `createNeumipMaterial(model, options)` returns a node material,
live scale/gain uniforms and its source identity. `loadNeumipModel` loads and
validates the author web-export format. Source float32 textures are retained;
manual bilinear lookup avoids requiring optional float32 filtering. Model
changes compile the new material's small networks into shader code.

## Verification

```sh
npm test -- --only tests/neumip-model.mjs
SHADER_HERDER_STRICT_METAL=1 node tools/neumip-native-check.mjs \
  /path/to/wool2_web.model /path/to/numerical-evidence
```

The resource-lifetime check runs without a GPU:

```sh
node tools/neumip-lifecycle-check.mjs /path/to/wool2_web.model
```

The numerical check executes the production generated WGSL against an
independent scalar evaluation of the original matrix rows. It includes a valid
altered network that the oracle must reject. `tests/neumip-render-native.html`
provides controlled native-light render/readback for source-coordinate and
multi-light conformance; it is a test surface, not the operator workbench.

## Source and attribution

[NeuMIP: Multi-Resolution Neural Materials](https://cseweb.ucsd.edu/~viscomp/projects/NeuMIP/),
Alexandr Kuznetsov, Krishna Mullia, Zexiang Xu, Miloš Hašan and Ravi Ramamoorthi,
SIGGRAPH 2021. This port follows the public web-export model, embedded author
GLSL, and the Cereal archive schema in
[`straintensor/NeuMIP`](https://github.com/straintensor/NeuMIP).
The author code copyright and terms are retained in
[the license notice](licenses/neumip-license.txt).

## Spatial training curriculum

`tools/neumip-fit.mjs` and `tools/ground-material-fit.mjs` select
`author-web-spatial-v1` for new fits. This restores the spatial portion of the
released `StandardWeb` recipe: zero offset-field initialization, appearance
field initialization at standard deviation .1, differentiable periodic Gaussian
filtering before both feature lookups, and the transpose of that filter in the
raw-parameter gradient path. The initial sigma is eight base-level texels;
`8 * 2 ** (-step / (10000 / 3))` reaches one at step10,000. Appearance sigma has
floor .1 and scales by `2 ** mip`; offset sigma has floor one, and offset-field
optimization stops after step10,000. The offset decoder remains trainable.
Before the training forward at steps0,100,...,2900, raw appearance fields are
also damped in place with `.9 * raw + .1 * periodicBlur(raw, 1.03)` at every
mip, matching the released `fuse_blur`. This operation leaves raw offset
features, decoder parameters and optimizer moments alone; it is distinct from
the differentiable lookup filter and is not applied during evaluation/export.

These widths are measured in each model's base-level texels. At64² the initial
eight-texel sigma spans eight times the normalized UV extent it does at512².
Checkpoint state includes sigma in both texels and normalized UV coordinates;
small-resolution fits must be interpreted with this change of physical support.

Export bakes the effective filtered fields into the ordinary model format;
the renderer needs no additional smoothing operation. Frozen teacher models
use ordinary inference and are not filtered a second time. The low-level
training factory requires an explicit `trainingRecipe` before optimizer updates.
Inference without a recipe retains the ordinary unsmoothed model evaluation.

The new-fit defaults are30,000updates. Explicit `--steps` or config `fit.steps`
remain honored, including shorter preview runs. Each checkpoint records the
actual spatial state; a short fit can stop while broad smoothing is still
active and is not a convergence claim. Select the reproducible previous route
with `--training-recipe legacy-unsmoothed-v1` in `tools/neumip-fit.mjs`, or
`"trainingRecipe": "legacy-unsmoothed-v1"` in a ground/grass fit config.

This is spatial-recipe parity, not a reproduction of the full author training
method. Current runners retain linear-RGB half-squared difference, their own
optimizer rates/network initialization and query exposure, and their existing
frozen-model or independent geometry target construction. The author recommends
other objective/scale-weighting choices. Those differences remain explicit.
The implementation follows pinned author code
[`c1e2f2aa`](https://github.com/straintensor/NeuMIP/tree/c1e2f2aa3488b7460cbf19f5bf6d1c4343926178),
particularly `experiments/simple.py`, `neural_rendering.py`, `mipmaptexture.py`
and `utils/tensor.py`.

CPU schedule/API checks run through `tests/neumip-training-curriculum.mjs` and
`tests/neumip-training.mjs`. The native numerical witness is
`tools/neumip-spatial-training-check.mjs OUTPUT_DIR`; run it through Greenroom.
It executes the production filters, full material gradients, raw damping,
export/reload, explicit baseline and optimizer freeze behavior. A Dawn null-backend validation
only establishes shader/pipeline validity, not these numerical claims.
