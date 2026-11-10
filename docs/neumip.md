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
New experiment carriers are owned by that experiment and removed on closing.
Normal **Save / Save As / Open** also retain the authored folded/sphere carrier,
transform, checkpoint URL and SHA256, UV scale, gain and native lights. A fresh
page reconstructs them through the ordinary scene and material library; the
experiment is not required. Opening the experiment over a restored neural carrier
borrows that object, so closing it leaves the saved scene intact.

The **Material** context exposes the named Neural surface recipe, installed
checkpoint selection, UV scale and gain controls, with ordinary shared assignment,
Make unique and Undo/Redo. Source edits load and verify the checkpoint before
changing the recipe; failed or superseded loads preserve the current material.
The experiment follows native edits and Undo/Redo, including custom material names.
The same recipe can be assigned to UV-equipped imported mesh slots. Missing UVs
reject assignment; unsupported Burning and area-light integration remain explicit.
The checkpoint stays an external, digest-verified source; saved documents do not
embed model bytes. Reopening still requires the same mounted asset or URL.

## Current boundary

Indirect/environment response, area-light integration, and the custom flame
surface-lighting producer are not implemented. The material does not substitute
a white diffuse response for those missing directional integrations. It uses
the shared scene rendering pipeline; native direct-light shadows remain the
light producer's responsibility. Large silhouettes remain mesh geometry.
No training, frame-rate or broad performance claim follows from this port.
The default SSGI route reuses the neural direct radiance from its existing
transport attachment in the receiving pass. Render & Output → Neural materials
controls neural shading width and height at 100%, 75%, 50% or 25%; the value is a
saved viewport preference, also exposed by `kaminosNeuralShading.setScale(value)`.
Geometry, depth, other materials and final display retain the viewport resolution.

Below 100%, a current-frame pass evaluates neural materials at the chosen rate.
Ordinary geometry supplies depth occlusion with cheap lighting overrides. A
four-sample reconstruction rejects other materials, incompatible normals and
off-plane depths; missing support evaluates the neural response directly. The
state reports the nominal pixel fraction separately from that fallback work.
There is an additional geometry pass below 100%. The full-rate route adds no
full-size attachment or geometry pass. No temporal history is used.

The lower shading rate corrects UV derivatives to retain the intended full-rate
learned mip selection. It does not downsample or regenerate the independently
learned mip fields. Spatial interpolation loses fine detail at reduced rates;
quality and frame cost require comparison in the actual scene. This control is
a baseline for that comparison, not a guarantee of near-reference quality or a
proportional speedup. Transparent and logarithmic-depth receivers retain direct
evaluation.

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

A focused production raster/cache check uses an independent Chrome for Testing
and the installed author checkpoint. It checks one and eight native point lights,
full-rate cache/direct agreement with the scalar author reference, finite pixels
and the effective reduced target sizes:

```sh
KAMINOS_TEST_BROWSER=/path/to/chrome-for-testing \
KAMINOS_TEST_PLAYWRIGHT=/path/to/playwright/index.mjs \
node tools/neural-shading-check.mjs /caller/owned/output
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
