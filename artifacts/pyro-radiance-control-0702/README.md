# Pyro Radiance Control 0702

This slice turns Pyro radiance from a single broad warm multiplier into a shaped contrast carrier:

- `Pyro Radiance`: strength, still allowed to reach loud basin-search ranges.
- `Rad Gate`: broad wash at 0, sparse hot seams at 1.
- `Rad Spill`: pinprick seam at 0, smoke-cap wash at 1.
- `Rad Warmth`: cool material contrast at 0, golden glow at 1.

The controls are route-preserved as:

- `volume_pyro_radiance`
- `volume_pyro_radiance_gate`
- `volume_pyro_radiance_spill`
- `volume_pyro_radiance_warmth`

The shader packs them into `pyro_light_controls.xyzw` and reports the effective tuple as `carrierDebug.radianceShape`.

## Visual Artifacts

- `radiance-control-normal.png`: material-space positive smoke at `view=normal`.
- `radiance-control-isolate.png`: `Carrier View=Radiance only` positive isolation view.
- `radiance-control-snuff-negative.png`: maxed radiance route with fuel-off/snuff reset.

I inspected all three PNGs. The positive normal and isolate views are intentionally hot basin-search routes, not tuned final looks. The snuff frame preserves smoke/vapor with no visible fire-like radiance.

## Witness Receipts

`radiance-control-normal.json`

- `view`: `normal`
- `radianceShape`: `0.80g/0.20s/0.40w`
- `uploadedCells`: `24`
- `effectiveGain`: `1.5`
- `materialShaderReadiness`: `sampleable-debug-only`
- `fuelMean`: `0.00479923151993389`
- `reactionMean`: `0.024760816692075676`
- `fireLayerMean`: `0.03622190621919512`
- `radianceMean`: `0.2988715198581754`

`radiance-control-isolate.json`

- `view`: `radiance`
- `viewMode`: `4`
- `radianceShape`: `0.90g/0.10s/0.25w`
- `uploadedCells`: `24`
- `effectiveGain`: `1.5`
- `materialShaderReadiness`: `sampleable-debug-only`
- `fuelMean`: `0.00412480120087653`
- `reactionMean`: `0.02513805398922604`
- `fireLayerMean`: `0.033120545775288335`
- `radianceMean`: `0.2704790225332262`

`radiance-control-snuff-negative.json`

- `view`: `radiance`
- requested radiance controls: radiance `10`, gate `1`, spill `1`, warmth `1`
- `radianceSignalMax`: `0`
- `uploadedCells`: `0`
- `effectiveGain`: `0`
- `materialShaderReadiness`: `blocked-reset`
- `fuelMean`: `0`
- `reactionMean`: `0`
- `fireLayerMean`: `0`
- `radianceMean`: `0`
- `fireLikePixels`: `0`

## Notes

One initial positive attempt failed the witness before visual acceptance because `fireLayerMean` was below the existing transported-fire threshold. That failed capture is preserved as `radiance-sparse-positive.*`; it showed live Pyro control plumbing but was visually too dim and not used as the proof artifact.
