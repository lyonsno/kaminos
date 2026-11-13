# Shared hand input

The Hands control in the shared header enables camera tracking and opens a
compact popover. Choose MobRecon SpiralConv, MobRecon DSConv or full WiLoR;
left and right automatic acquisition are independent. The current model and
actual tracking state remain visible. Controls apply immediately. Tracking
starts only after explicit activation; opening a scene does not start a camera.

The virtual hand is transient input visualization, excluded from the Outliner,
object transforms and scene documents. Its solid material and opposite-camera
view follow the existing Iron Gland display. Palm placement follows source-image
boxes in the current view with fixed display magnification and native metric
proportions; finger articulation does not rescale the whole hand. It uses Iron
Gland’s wrist/knuckle anchors rather than the all-vertex centroid. It is an
uncalibrated camera-plane presentation,
not physical world registration. Contextual authoring gestures remain with the
consuming tool.

## Existing installations

`serve.py` reads `~/.config/kaminos/hands.json`, or the explicit
`KAMINOS_HAND_INPUT_CONFIG` file. Register existing packages and a native WiLoR
environment by reference; no weights are copied or downloaded by this route.

```json
{
  "schema": "kaminos.hand-input-installation.v1",
  "packages": {
    "spiralconv": "/absolute/spiralconv-package",
    "dsconv": "/absolute/dsconv-package",
    "detector": {
      "root": "/absolute/detector-package",
      "manifest": "detector.package.json"
    }
  },
  "wilor": {
    "python": "/absolute/wilor-environment/bin/python3",
    "source": "/absolute/wilor-mlx-checkout",
    "weights": "/absolute/wilor-mlx.safetensors",
    "detector": "/absolute/hand-detector.safetensors",
    "mano": "/absolute/mano.npz"
  },
  "evidenceRoot": "/absolute/hand-captures"
}
```

A package directory uses `package.json` by default. A `{root,manifest}` entry
explicitly aliases another metadata filename. The browser loaders verify the
model package and weight identity. The native worker requires existing WiLoR
MLX, NumPy and Pillow in the named interpreter, and the WiLoR source's
`HandPosePipeline`, `WiLoR` and `HandDetector` APIs. The configured native source is
WiLoR-MLX `30cd14e`; model code remains with that project.

`GET /api/hand-input` reports configuration and file availability, without
starting models. Availability is not an inference result. An absent or failed
model reports an error instead of selecting a different model. MobRecon uses
the shared page WebGPU application host. Full WiLoR runs in a per-client MLX
Metal process, starts on demand and closes when tracking stops or the model
changes. Cross-backend cooperative scheduling and performance are not
established by this integration.

## Observation and ownership

`window.kaminosHands` exposes `read`, `subscribe`, `setEnabled`, `setModel`,
`setAuto`, `openSettings`, `closeSettings` and `visualization`. `read().model`
is requested; `effectiveModel` and `identity` describe the actual loaded route.
Each presented observation names its source capture. Disabled sides never
receive another side's reflected observation. Detector misses clear the hand;
there is no manual-crop fallback in this input path.

Every sampled source frame and inference outcome is retained by a worker at
the installation's `evidenceRoot`. The server acknowledges the original PNG
and its SHA256 before native WiLoR consumes that exact source. Outcomes reuse
the source reference; the PNG is neither uploaded twice nor embedded in JSON.
Browser IndexedDB preserves the complete source only if server retention fails;
there are no routine duplicate recordings on the internal disk.
`captures/<capture-id>.png` preserves the source image and its JSON preserves
requested configuration, effective route and output. No automatic pruning is
installed. Native workers also retain load/failure reports and stderr under
their session. Turn tracking off to release its camera, model and writer.

The focused witness `tools/hand-input-witness.mjs` accepts explicit `--out`,
`--base`, `--chrome` and `--root`. UI-only boot/capture runs directly. `--infer
--fixture /absolute/retained-camera.jpg` exercises all three real model routes,
an explicitly mirrored left-hand input, absence and Stop; run that workload
through Greenroom. A repeated still answers route/lifecycle/orientation
questions, not temporal tracking quality or operator feel.
