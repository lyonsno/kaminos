# Images for authoring generation

Selecting a browser image shows the original immediately. **Use for generation**
prepares it and displays the prepared image. Ordinary opaque images use the
existing rembg U2Net CPU route; images with existing transparency retain that
alpha without another background model call. Preparation preserves the canvas
size and RGBA pixels. SF3D separately owns its resize, background blend and
normalization; the Trellis crop/premultiply recipe is not applied to SF3D.

The server needs a Python environment containing Pillow, rembg and CPU
ONNX Runtime, plus existing `u2net.onnx` weights. Set
`KAMINOS_IMAGE_PREPARATION_PYTHON` to that environment's Python (default: the
server interpreter) and `KAMINOS_BACKGROUND_MODEL_PATH` to the existing weights
(default: `~/.u2net/u2net.onnx`). Missing dependencies/weights or empty cutouts
fail visibly; original RGB is never used as a successful preparation fallback.

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
