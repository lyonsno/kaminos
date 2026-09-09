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

Final display applies exposure in stops, projects signed RGB toward equal RGB
at fixed luminance only enough to remove negative components, then compresses
the peak channel with a smooth shoulder. In-gamut input below the peak knee is
unchanged. With peak `p`, knee `k`, and `d=1-k`, the compressed peak is
`q=1-d*d/(p+1-2*k)`. RGB scales by `q/p`; the neutral blend toward `[q,q,q]`
is `1-1/(1+0.15*(p-q))`. Thus bright colors may lose luminance before saturation;
only stronger highlights gradually converge to white. Standard sRGB encoding
runs once. The CPU reference and WGSL implement the same equations.

This shoulder and delayed desaturation adapt
[Khronos PBR Neutral](https://github.com/KhronosGroup/ToneMapping/tree/main/PBR_Neutral).
The reflective-material black offset is deliberately omitted for emitted light;
the operator's existing knee replaces its fixed compression threshold. The
signed-input projection is our addition. This is not the unmodified Khronos
transform or its reflective-material color-matching guarantee.

The former fixed-luminance SDR fitting turned pure 1900 K at input Y=0.6 into
`#ffbca1`, even without clean blue or smoke. The corrected mapping yields
approximately `#f28e52` at the same input. Brightness is intentionally lower at
equal exposure; exposure can now traverse a wider warm-highlight range. Existing
thermal presets retain their numeric values but receive this corrected display;
Legacy mode and its complete color path are unchanged. The diagnostic identity
is `peak-shoulder-delayed-neutral-srgb-v2`.

The ordinary WebGPU canvas explicitly declares sRGB. This does not claim HDR
display, P3 output, calibrated flame photography, or perceptually uniform hue
preservation. Clean-blue swatch emission and cool smoke can still shift the
combined color. They must be judged separately from this display correction.

Controls: center Kelvin, spread Kelvin, thermal strength, clean strength,
exposure EV, highlight knee, and legacy/new mode. Inactive legacy controls are
disabled in the cockpit; source settings remain present for exact A/B. Debug
state records requested/effective mode, temperature authority, working/output
space, display transform, and effective numeric settings. The optional splat,
learned residual, and external caller-owned resolve paths are not independently
validated by this implementation's ordinary-cockpit witness.

Tests: `node tests/volume-physical-color-contracts.mjs`,
`node tests/volume-physical-highlight-contracts.mjs`,
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
