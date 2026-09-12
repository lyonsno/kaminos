# Boundary Fire thermal + reaction color

## Complete emissive replacement — implementation target, 2026-09-12

The implementation described below is incomplete and has failed operator
acceptance. Its component checks do not establish the requested outcome:
usable flame color and brightness together in the ordinary Boundary Fire
cockpit. This section is the replacement plan, not a claim that it is built.

The consumer is Noah using his existing dynamics and emitter controls. The
composition horizon is the ordinary Boundary Fire raymarch, including visible
smoke and final display. The simulation, source geometry, and transported
detail are retained; their rendering interpretation is explicitly approximate.
The renderer must own its own success assessment before an operator handoff.

### Source-to-pixel gap and disposition

| Current term at source `5c55cbe4` | Replacement disposition |
| --- | --- |
| `thermalLinearRGB()` normalizes every temperature to Y=1 | Retain Planck/CIE integration but preserve temperature-dependent emitted power, normalized only to one fixed reference unit. Temperature controls spectrum and energy; exposure controls the camera. |
| `thermalCoordinate` mixes heat, flame detail, and front into a narrow temperature interval | Give the existing transported signals one explicit render-temperature interpretation, including cooling into a negligibly emissive state. This is a field-to-material approximation, not calibrated simulated Kelvin. |
| `sootMaturity` and `cleanBurnGate` overlap broadly; clean color comes from a legacy swatch | Separate soot amount from reaction-zone emissivity. Use a documented approximate blue reaction spectrum and local reaction/fuel support; do not normalize a broad blue wash into every warm sample. Overlap remains possible where the inferred materials actually overlap. |
| `fireAlpha * boundaryFireColor` uses capped segment opacity as emitted energy | Construct emission and absorption per unit volume-local distance, then integrate both over the actual segment length. |
| `standardExtinctionStep` applies another transform to already capped alpha, including Pyro alpha additions | Replace on the new path with the same material extinction used in the segment integral. Legacy/Pyro opacity edits may not silently alter the new transport. |
| `smokeCol` is a fixed cool radiance modulated partly by speed | Make smoke an absorbing/scattering material illuminated by an explicit incident-light approximation. Remove the speed-colored, self-luminous cool veil. |
| Peak shoulder plus sRGB encoding, with no explicit chromatic adaptation | Retain a single camera resolve; include a fixed, explicit white-balance transform before highlight compression. Do not auto-normalize each frame to its hottest sample. Evaluate the shoulder on the integrated result, not only a color patch. |
| Physical-mode eligibility checks only `inspect / boundary_fire` | Also account for diagnostic sidecar views, appearance decompositions, learned residuals, and caller-owned presentation. These are separate authorities; they must not masquerade as the new ordinary color route. |
| Old controls remain in saved basins | Keep legacy reproducibility. Give the new route an honest model identity and clearly identify active material/camera controls; do not silently reuse a control with a different physical meaning. |

### Target transport

Use an RGB participating-medium approximation. At each sample, determine soot
absorption `sigma_a`, smoke scattering `sigma_s`, reaction emission `j_gas`,
and thermal source radiance `B(T)`. In consistent relative units:

```
sigma_t = sigma_a + sigma_s
j = sigma_a * B(T) + j_gas + sigma_s * incidentRadiance
segmentT = exp(-sigma_t * ds)
segmentL = j * (1 - segmentT) / sigma_t
L += T * segmentL
T *= segmentT
```

Use the analytic `j * ds` limit as extinction tends to zero. Geometric ridge
support determines where the inferred emitting material exists; it does not
provide a second display palette or an unrelated per-step opacity clamp.
Smoke visibility is a presentation choice, not the authority for whether hot
soot exists. All components share transmittance before the single display
resolve. This separates material amount, source temperature, and exposure.

The physical basis is Planck emission and participating-medium transport:
[PBRT light emission](https://www.pbr-book.org/4ed/Radiometry,_Spectra,_and_Color/Light_Emission)
and [volume processes](https://pbr-book.org/4ed/Volume_Scattering/Volume_Scattering_Processes).
Nguyen, Fedkiw, and Jensen's
[fire rendering paper, sections 5–5.2](https://graphics.stanford.edu/~henrik/papers/fire/fire.pdf)
also separates thermal emission, reaction-zone light, smoke transport, and
chromatic adaptation. We are not adopting its combustion solver or recursive
Monte Carlo renderer.

### Smoke illumination and cost

Prior work exists on `cc/beaming-fire-to-scene-lighting-0831@d3bfd66a`:
a compact RGB irradiance lattice, buffers, dispatch, and atlas plumbing.
Its current source seed uses stock `fireRadianceEmission()`, not Boundary Fire.
Its neighbor update has coefficient sum 1.15 in a uniform interior. Neither
that source law nor that propagation is a justified unchanged implementation
of this target. Reuse relevant resource/plumbing ideas, not a blind branch merge.

The intended inexpensive lighting route is a low-resolution, same-state
incident-light field seeded from the new emission and extinction coefficients.
A low-order directional transport approximation can supply smoke lighting
without secondary rays at every camera sample. Keep this approximation explicit,
with exposure applied only afterward. Source, material edits, and frozen-frame
edits must invalidate it. Resolution/dispatch cost and visible sufficiency need
an engineering measurement before fixing the implementation size. Exact spectral
scattering, multiple scattering, and external scene-lighting integration are not
required for this ordinary-cockpit replacement.

### Implementation and verification

Implement the material/emission evaluation and segment integration together;
compose smoke illumination and the camera transform before declaring the
replacement successful. Finish control identity and saved-state compatibility
as part of that same delivery. Existing lookup and capture code are reusable.

Use small analytic checks where they settle real implementation risks, such as
constant-medium segment subdivision and reference spectral integration. Use
intermediate captures when they buy information. There is no new scalar-image
completion gate, full PIP, mandatory per-step visual gate, or exhaustive image
campaign. Before handoff, inspect meaningful ordinary-route output with the
intended components active, and assess whether useful warm body colors,
localized bright highlights, reaction-zone blue, and smoke coexist without the
previous broad peach lock. Preserve the settings and captures actually used.
Review and numerical passes support that judgment; they cannot replace it.

## Current incomplete implementation (through `5c55cbe4`)

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
evidence; it does not discharge the implementer's responsibility to inspect
and assess the integrated result before offering it to the operator.
