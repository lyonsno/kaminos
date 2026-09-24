# Emissive transport implementation — native composition inspected

Consumer: Noah's ordinary Boundary Fire cockpit. Owner: Sexy Fireman.
Source branch: `cc/sexy-fireman-color-model-0908`. Main landing is not authorized.

The replacement is mode 2; modes 0 and 1 retain their prior transport. New mode
uses fixed-reference Planck/CIE power, local fresh-fuel reaction emission,
shared emission/extinction segment integration, a coarse six-direction
single-scattering incident-light lattice, and fixed Bradford camera white
balance before independent channel shoulders and a single sRGB encode.
The dynamics and camera ridge support are unchanged. The lighting lattice
currently approximates ridge coverage by eight coarse source samples per cell;
this is an illumination approximation, not an exact ridge integral.

## Evidence and outstanding work

Exact `a6dd10ee` native Apple WebGPU final capture:
`/private/tmp/kaminos-emissive-camera-0912/receipt.json`. Owner inspected warm,
bright, and clean PNGs: amber/gold body, yellow-white exposed ridges, visible
smoke, separate blue low-soot reaction zone. Existing structural banding remains;
this is not a claim about a new dynamics basin. The normal route is
`emissive-transport-v2`, 96³ simulation, 160 steps, native pixel resolution.
Raising legacy Boundary contrast/gamma/opacity and Smoke strength leaves the
bright arm's raw pixels byte-identical. Incident-light compute was 0.309245 ms;
whole-frame speed and raymarch optimization have not been benchmarked here.

The inherited peak shoulder's added neutral component caused the brighter
intermediate capture to become pastel again. Mode 2 now saturates independent
channels, preserving neutral inputs without manufacturing green/blue from red
exposure. The old response failed that explicit channel-isolation numerical
check; the new one passes. Mode 1 keeps its old response unchanged.

Source confirmation at exact `a6dd10ee` accepted both runtime corrections and
the inspected native component coexistence. Final narrow confirmation at
`608fed7b` accepted the production-linked shader and raw-RGBA isolation
regressions with no material findings. Renderer code is unchanged across those
revisions. Final evidence and review custody remain in the owner's scoped report.
The saved link was also opened normally, allowed to advance to 80 simulation
steps, and inspected from the displayed browser canvas on Apple WebGPU.
The separate Authored Mix bootstrap warning and stock-only Content label are
known cockpit residuals, not failures of the ordinary emissive route.
The local server accepted and read back all 205 controls in a new, separately
named derived preset; existing operator records were not overwritten.
Preset: `vsp-2956bbf0d01fe8b1aa10e270a32fa26b826341fa4580c8a18cf58b8aaf11d50f`.
The first scripted write used an invalid checkbox descriptor and was rejected
before mutation; its failure receipt is retained alongside the corrected write.

Initial native capture on `f5783b89` completed on Apple WebGPU. The owner
inspected the previous, emissive, and exposed PNGs: amber/gold replaces the
salmon cast, with localized cream highlights as exposure rises. The default
smoke was too faint; a second ring-source material check at
`/private/tmp/kaminos-emissive-smoke-0912/receipt.json` exposed an over-hot
temperature mapping and excessive blue/thermal overlap when reaction strength
was raised. These are intermediate observations, not handoff acceptance.

Successor changes make mode 2 temperature explicitly the peak soot Kelvin,
with spread cooling below it, and reduce reaction emission in soot-rich regions.
The previous mode retains center/spread semantics. The existing selective-head
profiler is not applicable with that composition off: its unwritten query
reported `timestamp-query-incomplete:0,0` before any new captures. That failed
attempt is preserved at `/private/tmp/kaminos-emissive-final-0912/receipt.json`.
Use a direct timestamp pair around the incident-light compute pass instead;
it reports only that pass, not whole-frame performance. No image-completion gate.
Source review found two material defects: legacy display shaping still entered
material density, and smoke was materially suppressed. The successor removes
Boundary contrast/gamma/opacity from mode-2 material support and removes the old
Smoke strength multiplier from the new smoke coefficient. Those legacy controls
are explicitly inactive in mode 2. Approximate CH*/C2* reaction bands replace
the violet CH-only approximation; this is not a fuel-chemistry solver.
The direct native incident-light timestamps were 0.912403 and 0.319703 ms;
these are two samples of the added compute pass, not a whole-frame benchmark.
Successor composition capture: `/private/tmp/kaminos-emissive-composed-0912/receipt.json`,
receiver Sexy Fireman. Its arms include a visual composition check and an exact
frozen-image check that retired display controls cannot reshape mode 2.

- `node --check volume-core.js`: pass.
- `node tests/volume-emissive-transport-contracts.mjs`: pass (constant-medium
  subdivision, zero extinction, reference power, fixed camera white).
- `node tests/volume-physical-color-contracts.mjs`: pass.
- `node tests/volume-physical-highlight-contracts.mjs`: pass.
- `node tests/volume-physical-color-label-contracts.mjs`: pass after preserving
  mode-1 active labels; mode 2 labels request separately from runtime status.
- `python3 tests/volume-settings-schema-evolution-contracts.py`: pass.
- `node tests/volume-settings-preset-contracts.mjs`: blocked by missing existing
  `artifacts/volume-captures/20260715-082845-operator-original-live-basin-settings.json`.
- Meaningful pre-fix failure: existing `thermalLinearRGB(2400)` has luminance 1,
  violating fixed-reference power. The first new-module import failure was
  setup-only and is not fail-first evidence for the mechanism.

Capture receiver: Sexy Fireman, this session. Reuse the ordinary native witness
and the preserved crackle-derived input `/private/tmp/kaminos-color-crackle-derived-0909/input.json`.
Capture arms: `docs/emissive-transport-capture-arms.json`.
First terminal receipt: `/private/tmp/kaminos-emissive-native-0912/receipt.json`.
Raw RGBA, PNG, exact route and settings remain alongside the receipt.
