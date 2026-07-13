# Spatially stratified smoke support v2

Question: Can coarse smoke consolidation preserve broad plume topology while keeping exact extinction and a bounded splat count, after global high-mass anchor transfer collapsed the product into one narrow upper band?

Result: Yes, at the representation level. `mass-preserving-spatial-strata-v2` partitions the `20^3` coarse lattice into fixed `4^3`-bin strata. Every occupied stratum retains at least one mass-relative local anchor, and tail extinction transfers only within that stratum. The selected step-96 product reduces `7,964` occupied coarse bins to `1,645` transport splats while retaining exact total extinction and broad support from `y=-0.7512` to `0.8516`. Its mass-weighted coarse `y` moves only from `0.3257` to `0.3566`, compared with the prior global transfer's collapse to `y=0.7043`.

This is the first material smoke-shape progress from the splat hierarchy. The exact moving route now shows tapered broad plume bodies instead of an upper-band bead carpet. It is still a prototype: internal structure remains soft and somewhat stratified, the motion authority is short-horizon velocity extrapolation, and the gray standalone resolve is not final flame/smoke composition.

## Selected configuration

- Coarse block: `8^3` simulation cells
- Fine block: `4^3` simulation cells
- Coarse anchor mass ratio: `0.8`, evaluated relative to each occupied stratum
- Coarse stratum size: `4^3` coarse bins
- Fine occupancy ratio: `0.4`
- Projected footprint: `axisymmetric-projected-covariance-v1`
- Coarse coverage scale: `1.8`, area-normalized
- Capacity: uncapped; no output truncation and zero rejected extinction

Step 96 emits `1,645` coarse plus `773` fine splats. The adjacent target emits `1,652` coarse plus `764` fine splats, with `1,619` shared coarse keys and `682` shared fine keys. The held-out learned phase emits `1,657` coarse plus `642` fine splats. The four-instance draw invocation envelope is `9,672`; product uploads remain one per unique phase product.

## Visual selection

`stratum-sweep.png` compares sizes `2`, `4`, and `5` left-to-right at coverage `1`. Size `2` is the support-faithful control but retains dense vertical striping. Size `4` preserves the tapered silhouette at materially lower count. Size `5` is cheaper but visibly perforated and shifts coarse mass upward.

`coverage-sweep.png` compares size `4` at `1.4/1.8` on the top row and size `5` at `1.4/1.8` on the bottom row. Coverage `1.8` on size `4` best fills the local lattice without recreating the broad upper blobs of global transfer.

`filmstrip.png` and `spatial-strata-smoke.mp4` are derived from the final-path 48-frame witness. Direct inspection confirms coherent short-horizon movement and stable broad support across the sequence; the report records 48 unique frame hashes.

## Route evidence

- `report.json`: exact real-field corpus compilation, support telemetry, adjacent-phase comparison, and learned-selector report.
- `motion-source.json`: compiler-emitted, directly consumable manifest with a hash of `report.json` and relative product paths.
- `motion-witness-report.json`: final four-instance route at the durable manifest URL.
- `single-witness-report.json`: final one-instance close route at the durable manifest URL.
- `motion-frames/`: all 48 raw four-instance captures used by the MP4.
- `single-frames/`: eight raw close captures.
- `sweep-summary.json`: bounded numeric and visual disposition for sizes `2/4/5`.

Both final witnesses report effective `webgpu-real-field-hierarchical-smoke-motion-v0`, `WebGPU:apple`, projected covariance, requested/effective coverage `1.8`, null fallback, unique live frame hashes, no runtime exception, no rejected extinction, and no truncated product.

## Boundary

This proves a deterministic multiscale splat representation can preserve coherent broad smoke support while remaining far sparser than one coarse splat per occupied bin. It does not prove recurrent learned smoke, long-horizon phase coherence, final HDR smoke shading, flame/smoke depth integration, isolated GPU duration, or a shipping count at 100 visible instances. Browser timing remains RAF plus CPU-submit authority only.
