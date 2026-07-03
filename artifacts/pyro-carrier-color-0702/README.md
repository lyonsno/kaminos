# Pyro Carrier Color Proof - 2026-07-02

This bundle preserves the carrier color-shaping slice for Pyro Cellular Ghostfire Butcher. The slice adds live-coupled Bite and Radiance color controls to the existing pyro material-memory path. These controls bias the cheap carrier response; they do not create independent fire.

## Implemented Controls

- `volume_pyro_bite_heat`: moves Bite color from ember/copper toward white-hot edge color.
- `volume_pyro_bite_chroma`: moves Bite from muted material response toward saturated torn-edge color.
- `volume_pyro_radiance_hue`: moves Radiance contrast from smoke-blue toward amber carrier bias.
- `volume_pyro_radiance_chroma`: moves Radiance from gray contrast toward colored glow tissue.

The renderer reports these through `pyroMaterialRendererCoupling.carrierControls` and `carrierDebug.colorShape`, for example `0.95bh/1.00bc/0.15rh/1.00rc`.

## Accepted Witnesses

All accepted witnesses ran against `http://127.0.0.1:8107/` with WebGPU on Apple and `webgpu-copy-src-readback` capture.

| Artifact | Evidence mode | Frames / sim steps | Effective signal |
| --- | --- | ---: | --- |
| `color-normal.png` / `color-normal.json` | `pyro-material` | 84 / 114 | Normal carrier view with Bite and Radiance color shaping active. Reported `liveFireAuthority: 1`, `effectiveGain: 1.5`, `biteSignalMax: 12`, `radianceSignalMax: 39.732`, and color shape `0.95bh/1.00bc/0.15rh/1.00rc`. |
| `color-bite-isolate.png` / `color-bite-isolate.json` | `pyro-material` | 85 / 117 | Bite isolation view with radiance set to zero. Reported `view: bite`, `radianceSignalMax: 0`, `biteSignalMax: 12`, and color shape `0.15bh/1.00bc/0.15rh/1.00rc`. |
| `color-snuff-negative.png` / `color-snuff-negative.json` | `no-fire-volume` | 85 / 117 | Snuff/fuel-off negative control with color and radiance controls pinned loud. Reported `liveFireAuthority: 0`, `effectiveGain: 0`, `fuelMean: 0`, `reactionMean: 0`, `fireLayerMean: 0`, `radianceMean: 0`, and `fireLikePixels: 0`. |

## Visual Inspection

- `color-normal.png`: subtle proof-budget render, small live flame with smoke plume and shaped warm/cool carrier response.
- `color-bite-isolate.png`: Bite-only response remains tied to flame authority and does not become a separate radiance wash.
- `color-snuff-negative.png`: smoke-only dark plume remains; no warm fire/radiance hangover survives the snuff/fuel-off state.

The operator's higher-budget live basins are visually richer than these witnesses. These artifacts are evidence harness outputs, not gallery renders.

## Refused / Failed Evidence Attempts

- The first normal witness attempt failed because the route rendered too few frames for the requested evidence window.
- A second normal attempt failed because the requested render scale did not match the effective snapped render scale.
- The first snuff attempt failed before witness capture because `no-fire` was not a valid evidence mode; the accepted negative uses `no-fire-volume`.

These failures are useful: the witness refused stale/partial/mismatched proof instead of silently blessing it.
