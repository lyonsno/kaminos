# Boundary Fire thermal + reaction color

Opt-in `volume_physical_mode=1` applies to `inspect / boundary_fire` only.
Mode 0 preserves the prior color and display path. Old saved settings receive
mode 0 through additive schema projection; immutable preset bytes are untouched.

The thermal component integrates Planck's spectral shape over the complete CIE
1931 2-degree observer (360–830 nm, 1 nm). The data source is CIE 2019,
https://doi.org/10.25039/CIE.DS.xvudnb9b, CC BY-SA 4.0; attribution and original
CSV SHA256 are in `cie-1931-observer.mjs`. Numerical data transcription is
distributed under that license. The physical relation is documented at
https://www.pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Light_Emission.

XYZ converts to linear sRGB and normalizes photopic luminance to one. A 10 K
lookup over 800–6000 K interpolates this chromaticity, including signed RGB
components until display gamut compression. The midpoint sweep verifies maximum
absolute RGB interpolation error below 0.0002 at unit luminance. The 2856 K
reference verifies CIE illuminant A chromaticity within 0.0002 in x and y.

This is a physical thermal **color locus**, not calibrated combustion or
absolute spectral radiance. The existing dimensionless heat/detail/front signal
maps to temperature as `center + (clamp(signal / 2.4, 0, 1) - 0.5) * spread`,
clamped to the declared lookup domain. Thermal strength independently sets
relative photopic emission. Clean-reaction emission uses the existing linear
clean swatch normalized to unit luminance, with independent strength and the
existing clean reaction gate. The components add; soot maturity weights thermal
emission. Soot yield therefore remains a distribution control.

Boundary support and standard extinction are unchanged. The new radiance is
`fireAlpha * boundaryColor + visibleSmokeAlpha * smokeColor * smokeAuthority`.
Legacy inspection contrast, palette repaint, and Pyro color additions do not
grade that radiance. Existing Pyro contributions to extinction remain; this is
not a Pyro or simulation rewrite. Legacy Fire can still affect existing support
or extinction pathways; it is not the new emission-strength control.

Final display applies exposure in stops, a linear-below-knee exponential
luminance shoulder, and the minimum neutral-axis chroma compression needed to
fit the SDR cube at the mapped luminance. It then applies standard sRGB encoding
once. The ordinary WebGPU canvas explicitly declares sRGB. This does not claim
HDR display, P3 output, or perceptually uniform hue preservation. Peak saturation
necessarily falls as display luminance approaches white.

Controls: center Kelvin, spread Kelvin, thermal strength, clean strength,
exposure EV, highlight knee, and legacy/new mode. Inactive legacy controls are
disabled in the cockpit; source settings remain present for exact A/B. Debug
state records requested/effective mode, temperature authority, working/output
space, display transform, and effective numeric settings. The optional splat,
learned residual, and external caller-owned resolve paths are not independently
validated by this implementation's ordinary-cockpit witness.

Tests: `node tests/volume-physical-color-contracts.mjs`,
`node tests/volume-boundary-fire-palette-equivalence.mjs`,
`python3 tests/volume-settings-schema-evolution-contracts.py`.
The new reference test failed before implementation on the absent Planck/CIE
contract; the saved-control test failed on the absent new schema descriptors;
the source-count test failed on an accepted missing `controlCount` write.

`volume-physical-color-witness.mjs URL OUT_DIR REPO_ROOT COMMIT` uses the ordinary
cockpit and existing deterministic replay/native readback APIs. It retains
source identity, replay settings, all native pixels and effective controls,
including a terminal report on failure. This is provisional engineering visual
evidence; the operator's current basin still owns final appearance acceptance.
