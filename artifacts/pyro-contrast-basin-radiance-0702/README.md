# Pyro Contrast Basin Radiance - 2026-07-02

This directory preserves the first durable smoke for the live-field contrast basin and the reset-gated Pyro radiance carrier.

## Captures

- `warm-cap-radiance-on-long.png` / `.json`
  - Route: `volume_tall_preset=pyro_contrast_warm_cap_small_flame_0702`, `volume_pyro_radiance=1.05`.
  - Witness mode: `pyro-material`.
  - Effective backend: `WebGPU:apple`.
  - Receipt: `radianceSignalMax: 7.5852`, `radiance: 1.05`, `effectiveGain: 1.5`, `liveFireAuthority: 1`, `smokeAuthority: 0.602`, `uploadedCells: 24`.

- `warm-cap-radiance-off.png` / `.json`
  - Same named basin with `volume_pyro_radiance=0`.
  - Witness mode: `pyro-material`.
  - Receipt: `radianceSignalMax: 0` while bite/fold carriers remain active.

- `warm-cap-radiance-snuff-negative.png` / `.json`
  - Same named basin with `volume_pyro_radiance=1.5`, `volume_reaction_fuel=0`, `volume_lifecycle_effect=snuff`, `volume_lifecycle_t=1`, and `volume_quench_vapor=1.5`.
  - Witness mode: `no-fire-volume`.
  - Receipt: `effectiveGain: 0`, `liveFireAuthority: 0`, `smokeAuthority: 0`, `uploadedCells: 0`, `radianceSignalMax: 0`, `fuelMean: 0`, `reactionMean: 0`, `radianceMean: 0`, `fireWeight: 0`, `emissionDetailWeight: 0`.

## Visual Read

The `warm-cap-radiance-on-long` and `warm-cap-radiance-off` frames are not same-step A/B captures, so they should not be used as a precise pixel-diff claim. They are useful as smoke artifacts proving the route, uniform, shader, and debug state are live. The snuff negative is the load-bearing reset proof: requested radiance does not keep burning when live simulation authority is removed.

An early failed `warm-cap-radiance-on` witness is also preserved. It captured a too-young bottom plume and failed the older `pyro-material` pixel threshold; that was a witness timing failure, not a shader compile or route failure.
