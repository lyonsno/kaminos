# Gaussian Phase Transfer Experiment

## Question

Can independently decoded sparse Gaussian smoke products follow phase-offset flame instances without decoding once per instance, losing source attachment, hiding budget truncation, or collapsing when the splat budget rises?

## Verdict

**The shared phase-product architecture passes; the current `gradient4` static fitter does not yet produce production-quality smoke.** Four instances consume two adjacent teacher phases with exactly two decodes and two validated GPU products at both 1K and 8K. The smoke stays attached to each instance and preserves the teacher's broad tall-plume support and phase-dependent side lobe. Raising the budget from 1,024 to 8,192 thickens support and modestly improves the silhouette, but does not remove the axial lattice or add convincing interior articulation.

This is a positive result for sparse Gaussian smoke as a parallel research vein and a negative result for count-only optimization. The next research target is learned allocation and overlap-aware optical/temporal training. The hybrid smoke raymarch remains the production hedge until that target produces a materially stronger visual witness.

## Exact Source

- Teacher: accepted R160 `operator_fire_0622` low-emitter source from the temporal ceiling experiment.
- Teacher route: `native-3d-compute-fluid-raymarch-v0` on `WebGPU:apple`.
- Camera: `sha256:52d62666d901cd0fbdbc11d5658ae3f40fd035b404cf4aaab674cab2837a4d7e`.
- Phases: simulation steps 45 and 46, bound to history slots 0 and 1.
- Product authority: `oracle-fitted-gaussian-smoke-splat-producer-v0`.
- Temporal authority: `independent-adjacent-teacher-phase-products-v0`.
- GPU product socket: `kaminos.smoke-splat-gpu-product.v1`.
- Renderer packing: `float32x16-axisymmetric-smoke-v0`, converted from the oracle's `float32x28` full-covariance records by `full-covariance-to-axisymmetric-major-eigenvector-v0`.

The request manifests name and hash the fit reports and Gaussian binaries directly:

- `request-1024.json`
- `request-8192.json`

The loader rejects wrong report or artifact hashes, blank artifacts, hidden budget caps, fallback teacher routes, camera substitution, stale phase ticks, non-consecutive phases, truncation, overflow, and optical-accounting disagreement before the runtime can claim evidence.

## Systems Receipts

| Budget | Instances | Unique slots | Decodes | Cached products | Drawn splats | Rejected extinction | p50 frame interval | p95 frame interval |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1,024 | 4 | 2 | 2 | 2 | 4,096 | 0 | 8.4 ms | 17.0 ms |
| 8,192 | 4 | 2 | 2 | 2 | 32,768 | 0 | 8.4 ms | 17.0 ms |

The intervals are browser `requestAnimationFrame` CPU-submit observations under the shop's concurrent load, not isolated GPU pass timings. They establish that this witness stayed live; they do not establish production GPU cost.

The authoritative reports are:

- `witness-1024/report.json`
- `witness-8192/report.json`

Both reports record requested and effective route, backend, temporal authority, source/product identities, slot-decode accounting, validated GPU product identities, frame digests, output hashes, failure phase, and false-closure checks.

## Visual Read

Inspected frames:

- `witness-1024/frame-000.png` and `witness-1024/frame-007.png`
- `witness-8192/frame-000.png` and `witness-8192/frame-007.png`

The 1K witness preserves broad support and a phase-dependent lateral lobe, but individual ellipses form a conspicuous regular lattice. The 8K witness makes the columns denser and the projected support more continuous without materially changing the visual basis. Neither budget produces the billowing interior hierarchy, soft self-occlusion, or coherent articulated breakup required to compete with the raymarch.

The visible delta between phase products is real but subtle because the products are adjacent simulation ticks. This experiment proves phase identity, sharing, attachment, and transport through the production-shaped socket. It does not prove a full phase-cycle decoder, recurrent temporal coherence, flame-smoke depth composition, or final smoke fidelity.

## Smoke Route

With the repository server running at port 8099, the 1K motion witness is:

`http://127.0.0.1:8099/smoke-splat-motion.html?route=webgpu-real-field-hierarchical-smoke-motion-v0&manifest=./artifacts/gaussian-phase-transfer-0715/request-1024.json&instances=4&fine_lod=1&motion_rate=0.16&footprint=axisymmetric-projected-covariance-v1&coarse_coverage=1`

Change `request-1024.json` to `request-8192.json` for the count discriminator.

## Decision

1. Keep sparse Gaussian smoke active as a bounded parallel research lane.
2. Stop treating higher splat count as the next hypothesis; 8K falsified that move for this fitter.
3. Train allocation and optics against rendered transmittance, overlap, silhouette, and temporal correspondence rather than static extinction partition alone.
4. Preserve exact phase-slot caching and the shared GPU product socket as production architecture.
5. Continue hybrid flame-splat plus smoke-raymarch integration in parallel so renderer delivery does not depend on the research lane paying off.
