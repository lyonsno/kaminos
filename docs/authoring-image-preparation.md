# Images for authoring generation

Selecting a browser image shows the original immediately. **Use for generation**
prepares it and displays the prepared image. Ordinary opaque images use the
existing rembg U2Net CPU route; images with existing transparency retain that
alpha without another background model call. Preparation preserves the canvas
size and RGBA pixels. SF3D separately owns its resize, background blend and
normalization; the Trellis crop/premultiply recipe is not applied to SF3D.

Register the existing preparation environment once for every worktree and revision server:

```sh
python3 image_preparation_installation.py register --python /installed/venv/bin/python3 --model /installed/u2net.onnx
python3 image_preparation_installation.py status
```

The shared `~/.config/kaminos/models.json` stores `imagePreparation.python` and
`imagePreparation.model` alongside weight packages. `KAMINOS_MODEL_INSTALLATIONS`
selects another catalog. Relative registered paths resolve beside that catalog;
virtual-environment executable symlinks retain their environment identity.
Registration preserves other catalog entries and verifies dependency metadata and
weight presence. It installs nothing and does not run background removal.

Normal server startup selects that installation. Explicit
`KAMINOS_IMAGE_PREPARATION_PYTHON` and `KAMINOS_BACKGROUND_MODEL_PATH` overrides
still take precedence individually; invalid overrides fail instead of falling
back. Without registration, the server interpreter and `~/.u2net/u2net.onnx`
remain the defaults. Restart a running server after registration or dependency
changes. `/api/runtime-config` exposes `imagePreparation`, the selected paths,
resolution sources, package versions and per-route availability reasons.
Dependency metadata is probed once per server, without importing ONNX or loading
weights. An available report establishes installation presence; actual preparation
still validates execution and the resulting pixels.

Pillow supports retaining existing alpha; opaque-image background removal also
requires rembg, CPU ONNX Runtime and existing `u2net.onnx`. Missing dependencies,
weights or empty cutouts fail visibly; original RGB never substitutes for a
successful cutout.

`KAMINOS_IMAGE_PREPARATION_DIR` chooses persistent preparation storage (default:
`$KAMINOS_ASSETS_DIR/images/prepared`). Original bytes and cutout PNGs are retained,
with input/output digests, actual model digest, CPU provider and package versions.
The cache includes original bytes, model, preprocessing source and runtime
versions; reused files are verified before serving. The browser verifies the
prepared digest and dimensions again before SF3D. Generated asset provenance
keeps the original source/digest and the preparation record through the existing
scene operations.

Stop or a different image selection cancels admission to mesh generation.
Already running CPU background removal may finish on the server; its retained
output is reusable, and no mesh inference follows the cancelled preparation.
Preparation cannot take over Stop from an already running mesh generation.

Headless callers use the same POST `/api/prepare-image` operation with original
bytes and `source`, `name`, `sha256` query parameters. The response schema is
`kaminos.image-preparation.v1`. The controller's `prepare()` and `generate()`
operations compose it with scene generation. For file-based preparation:

```sh
"$KAMINOS_IMAGE_PREPARATION_PYTHON" authoring_image_preparation.py \
  --store /caller/chosen/preparations --model /existing/u2net.onnx < input.png
```

The command returns JSON and writes retained artifacts and a report. Failed
commands also retain a failure report under that store. This prepares an image;
it does not run SF3D or create/insert a scene object.
