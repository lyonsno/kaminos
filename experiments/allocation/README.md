# Moving fine material: bounded allocation prototype

This compares a dense four-channel material field with GPU-compacted bricks executing the same update. It asks how expensive fine storage and computation become when their spatial support changes every step. It does not choose a production refinement policy or benchmark rendering.

The update backtraces with a prescribed velocity, gathers eight neighboring cells, interpolates, and applies a small local fuel/heat/soot/reaction calculation. This is a representative transport workload, not the production combustion kernel. Both versions use storage buffers and the same brick-shaped dispatch. Production texture sampling can have different costs.

An initial set of finite boxes defines material support. Its conservative evolution follows the exact finite stencil: after t steps, each lower bound advances by t*floor(velocity) and each upper bound by t*ceil(velocity), clipped to the domain. The GPU scans brick coordinates against these support boxes, compacts the active set with an atomic counter, writes a page map, and indirectly dispatches material work. Every step reads the previous field through its previous page map. This exercises allocation, retirement, relocation and cross-brick reads without a CPU active-list readback. Support is prescribed; detecting refinement demand from evolving fire remains outside the measured cost.

Two compact field pools and maps ping-pong. Pool capacity is the maximum active-brick count of the known sequence, calculated before timing. Real demand-driven pool growth, emergency overflow policy and coarse/fine transfers are not implemented. Overflow is an error. Inactive cells are exactly zero, so this establishes preservation for a finite-support field, not refinement/coarsening of a nonzero coarse background.

## Repeating

Run CPU contracts with `npm test -- --only tests/volume-adaptive-allocation.mjs`.

Run GPU work through Greenroom using `node experiments/allocation/run.mjs <output-directory>`. Set `ALLOCATION_CHROMIUM` to an independent Chrome for Testing/Chromium executable and `ALLOCATION_PLAYWRIGHT` to a Playwright module. It requires native Apple WebGPU and timestamp-query. A private browser profile, mock Keychain and temporary local module server are owned and closed by the runner. No visible scene or ray marcher runs.

Default fixtures use a 96³ address space, 12 transported steps, bricks of width 4/8/16, a discarded-but-preserved warmup and five measured repeats. Four geometries bracket sparse columns, fragmented hotspots, broad activity and full occupancy. Dense and sparse order alternates. Each route starts from the same initial field every repeat.

GPU timestamps distinguish counter reset + map construction from sparse material updates and dense updates. Pipeline compilation, initial upload, step-zero initialization, final numerical readback, CPU reconstruction and serialization are outside per-step GPU timings. Queue-submit-to-completion wall times include initialization and synchronization and are recorded separately. The full dense baseline uses the same dispatch shape for each brick width; comparisons should also consider the fastest measured dense shape rather than attributing a poor dense dispatch to sparsity gains.

`signal.json` retains all measured samples and warmups. `report.json` is written on success or failure, including the failure phase, source hashes and effective adapter. Last-repeat dense/pool/map binary arrays preserve the numerical signal, with layout defined by `gpu.mjs`: four float32 channels per cell, dense X fastest; pool slot then brick-local X fastest; uint32 page map, 0xffffffff inactive. Intermediate completed configurations survive later failure. These records support an allocation-overhead result for this workload, not whole-fire frame rate or final visual quality.
