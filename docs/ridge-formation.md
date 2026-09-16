# Ridge Formation

The Reaction Front Extractor offers two explicitly saved formation modes.
**Curvature** is the default and retains the absolute six-neighbor Laplacian,
Ridge select and Ridge cut transfer used by existing basins.

**Support transition** is an experimental alternative, not a reconstruction of
missing simulation detail. Band level chooses a value of the existing support
field. The local central gradient estimates distance to that level in native
simulation cells. Band radius controls a smooth compact profile around it;
Ridge strength and Baked ridge multiply its amplitude. Ridge cut is inactive.
Local directional change divided by total neighbor variation downweights local
reversals. Flat regions and symmetric extremum centers produce no response.

This uses the existing six-neighbor stencil in both baked and live extraction.
It adds neither a smoothing pass nor a field. It does not guarantee connected
sheets, remove source-grid quantization, or reject every noisy feature. Narrow
bands can still be under-resolved; the linearized distance is approximate in
strongly curved regions. Its intended live comparison is whether placement,
width and emphasis are easier to steer without the curvature-versus-grit tradeoff.

The controls round-trip as volume_ridge_extractor_mode,
volume_ridge_support_level and volume_ridge_radius_cells. Older saved presets
gain mode 0, level 0.2 and radius 1.5 without changing existing control values.
External sidecar overrides remain caller-owned; the selector does not regenerate
their ridge. Debug boundarySidecar.ridgeExtractor distinguishes that effective
source from the requested mode. Material/color and raymarch traversal are unchanged.

`node tests/volume-support-transition-contracts.mjs` checks production scalar
arithmetic and legacy equivalence. Native browser compilation and live operator
judgment remain distinct from those numerical checks.
