# Pyro Material Bonfire Family Preset - 2026-07-02

This bundle preserves the operator-found bonfire/material basin as a stable named preset:

- `volume_tall_preset=pyro_material_bonfire_family_0702`
- UI button: `Bonfire`

The preset keeps the operator's creative basin controls but deliberately drops proof/default quality cost:

- `resolution: 96`, not the 160^3 hero setting used in the operator screenshots.
- `renderScale: 0.30`, not the copied URL's expensive `1.00`.
- `majorantSkip: 1.00`, so the cheap route takes the aggressive majorant path by default.

The higher-fidelity visual attractor remains the operator move: raise resolution toward 120-160 and render scale upward when judging final look. The named preset is the durable basin seed, not a claim that every cheap witness frame will reproduce the hero stills.

## Preserved Control Family

The creative controls came from the copied URL and are preserved except for the quality-cost adjustments above. Key values:

- Base sim: `density=6`, `fire=3.5`, `radiance=2.55`, `absorption=1.95`, `glow=2.35`, `smoke=2.8`, `curl=3.65`.
- Shape: `speed=3.45`, `fireScale=0.52`, `detailScale=1.85`, `plumeHeight=1.85`, `windStrength=1.5`, `windAngle=-65`, `windHeight=-0.65`, `inputRadius=0.20`, `flowRate=0.25`.
- Pyro carrier: `edgeBite=1`, `biteBorder=0.45`, `biteTeeth=0.60`, `biteWake=1`, `smokeFold=0.35`, `foldBorder=1`, `foldWake=1`, `radiance=6.10`, `radianceGate=1`, `radianceSpill=0.90`, `radianceWarmth=0.75`, `overdrive=8`.
- New color controls are pinned to neutral/warm defaults so the preset does not inherit stale cockpit state: `biteHeat=0.70`, `biteChroma=0.60`, `radianceHue=0.50`, `radianceChroma=0.55`.

## Witnesses

All witnesses ran against `http://127.0.0.1:8107/` with WebGPU on Apple and `webgpu-copy-src-readback` capture.

| Artifact | Result | Notes |
| --- | --- | --- |
| `bonfire-family-preset.png` / `.json` | Passed `pyro-material` evidence. | Cheap preset route loaded at `96^3`, `renderScale=0.30`, `majorantSkip=1.00`, `liveFireAuthority=1`, `effectiveGain=1.5`, `biteSignalMax=12`, `radianceSignalMax=57.3888`. Visually under-settled/thinner than the operator screenshots. |
| `bonfire-family-preset-long.png` / `.json` | Passed `pyro-material` evidence. | Longer wall-clock settle did not improve visual representativeness because the heavy route produced fewer frames in the witness window. |
| `bonfire-family-preset-small-window.png` / `.json` | Passed `pyro-material` evidence. | Smaller viewport increased frame count to 27 and sim steps to 38, still visually reads as a young/thin fresh-run plume rather than the mature hero bonfire attractor. |

## Visual Inspection

The preserved preset is correct as a route/control basin, but the committed witness images should not be treated as gallery examples of the operator screenshots. The operator examples were run at much higher quality, around `160^3` and high render scale, and had enough live interaction time for the bonfire body to settle. These witnesses are proof that the named preset, cheap defaults, and Pyro carrier controls route correctly.
