# Ordinary Raymarch Cockpit Apple WebGPU Witness

## Result

Exact clean carrier `9723ee323770d2c76b929f4e1bb5d0c94869176f` serves the
ordinary Volume cockpit at
`http://127.0.0.1:18416/?kaminos_volume_smoke=1`. The source includes the
narrow analytic-emitter WGSL portability fix from
`1cad2e544940041515302e65bdaa1f55cc962595`.

The captured debug state records:

- effective route `native-3d-compute-fluid-raymarch-v0`;
- backend `WebGPU:apple`;
- `87` advancing frames and `87` advancing simulation steps;
- authored ray quality `132` steps, adaptive `1.0`, render scale `0.65`;
- raymarch encoded and applied, with splats and residual passes not encoded;
- no renderer error or route fallback.

The full-cockpit screenshot was visually inspected. It shows one active live
flame in the ordinary Volume cockpit, with the authored smoke contribution,
no WGSL compilation error, and no incoherent UI overlap.

## Harness disposition

The generic `volume-witness.mjs` process exits nonzero at its identity phase
with `density route/control did not apply`. This is not a live renderer
failure: the cockpit preserves its authored density `6`, while the witness
expects its own implicit scene default because no density override was
requested. An earlier attempt similarly expected implicit `96` ray steps
instead of the cockpit's authored `132`.

The raw reports and screenshots are preserved here and in the sibling
`20260831-exact-9723ee32-repaired` directory. They establish live compilation,
execution, route identity, and visual output. They do not claim that the
generic all-control conformance predicate passed.
