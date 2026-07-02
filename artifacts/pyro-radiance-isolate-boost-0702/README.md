# Pyro Radiance Isolate Boost - 2026-07-02

This artifact set records the first loud `Radiance only` Pyro carrier smoke.

- `radiance-only-boost.*`: `volume_pyro_carrier_view=radiance`, `volume_pyro_radiance=8`, `volume_pyro_overdrive=8`, diagnostic paint `0.35`, `128^3` witness profile. Passed `pyro-material`; debug state reports `view="radiance"`, `viewMode=4`, `effectiveGain=1.5`, `liveFireAuthority=1`, uploaded cells `24`, and `radianceSignalMax=57.792`.
- `radiance-only-snuff-negative.*`: same isolate path with `volume_pyro_radiance=10`, fuel-off/snuff/quench enabled. Passed `no-fire-volume`; debug state reports `view="radiance"`, `effectiveGain=0`, `liveFireAuthority=0`, uploaded cells `0`, `radianceSignalMax=0`, `fuelMean=0`, `reactionMean=0`, `radianceMean=0`, `fireWeight=0`, and `emissionDetailWeight=0`.

The boosted witness intentionally uses `128^3` and `render_scale=0.45` so the proof exercises carrier plumbing and reset semantics without making browser capture success depend on the heaviest operator tuning profile.
