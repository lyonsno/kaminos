# Emissive transport implementation — in progress

Consumer: Noah's ordinary Boundary Fire cockpit. Owner: Sexy Fireman.
Source branch: `cc/sexy-fireman-color-model-0908`. Main landing is not authorized.

The replacement is mode 2; modes 0 and 1 retain their prior transport. New mode
uses fixed-reference Planck/CIE power, local fresh-fuel reaction emission,
shared emission/extinction segment integration, a coarse six-direction
single-scattering incident-light lattice, and fixed Bradford camera white
balance before the existing highlight shoulder and single sRGB encode.
The dynamics and camera ridge support are unchanged. The lighting lattice
currently approximates ridge coverage by eight coarse source samples per cell;
this is an illumination approximation, not an exact ridge integral.

## Evidence and outstanding work

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
Source review is running against the first implementation; successor delta
will be exposed for confirmation. The 32³ size awaits that runtime measurement.

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
