# Flame system performance ledger

Updated 2026-10-08. This is a working budget ledger, not a benchmark claim. Its purpose is to make room for larger fluid grids and composed scene features while protecting the accepted flame-driven light character. Keep measurements, structural work estimates, and missing measurements distinct.

## Current budget model

The distributed route shares a current emission/extinction source between mesh receivers and smoke. Static receiver-to-source visibility is cached; changing emission is integrated over those cached rays. Coarse surface receivers reduce gathering but add material-side reconstruction. Combined screen-space GI/AO is a separate consumer of lit surfaces, not another volume-scattering solve.

| Component | Main cost drivers | Current evidence / estimate |
| --- | --- | --- |
| Fluid update, advection and pressure | Full allocated grid, iterations, active solver and boundary passes | No comparable current GPU-ms estimate collated yet. A hidden upper half of a volume is not computationally free. |
| Primary volume-source preparation | Full source-grid cells, material evaluation, copies | Not isolated in the current timing records. Camera display exposure is distinct from source power. |
| Static mesh packing and ray visibility | Caster triangles, receiver count × directions; rebuilds after relevant geometry/receiver/guide edits | Preparation cost only while rays stay fixed. Emission-only changes reuse visibility; moving the guide makes visibility a recurring cost. Receiver-only edits retain packed caster geometry. Live-guide observation below finds this recurring work prohibitive on the tested kiln. |
| Live distributed gather | Surface plus smoke receiver rays, source cells crossed, extinction/scattering | GPU gather observations below. The source-guide PDF adds arithmetic; importance sampling is not a free equal-count optimization. |
| Surface receiver reconstruction | Render vertices and four-sample reconstruction/material reads | Added when coarsening. No independently isolated GPU-ms estimate; retaining full geometry means gather savings are not render savings. |
| Optional source softening / surface reconstruction filtering | Grid / receiver texture size × passes | Additional opt-in work. Current low-count acceptance does not require promoting these filters. |
| Visible flame and smoke rendering | Screen coverage, ray steps, depth/geometry handling and reconstruction | Not separately measured on the accepted composition. |
| Scene drawing and combined GI/AO | Viewport, geometry, normal/depth/source passes, GI slices/steps/filtering, MSAA | Scene draw timing is observable; isolated GI incremental GPU cost remains unresolved. |
| Diagnostic inspection and captures | Explicit readbacks, CPU replay, file export | On-demand evidence work, not an idle per-frame obligation. Exclude it from a serving budget. |

For a future whole-frame allocation, use one matched observation with non-overlapping pass scopes. Do not add independent medians from different runs, equate browser invocation rate with GPU cost, or count the same render/compute work twice.

## Receiver and angular work estimates

Observed native kiln layout at source `3b43c0e0`: 409,848 render vertices, 412,879 caster triangles. Surface receiver counts were 409,848 at spacing0, 313,628 at0.04, 250,496 at0.08 and194,914 at0.16 source units. Render/caster geometry remains unchanged. These counts belong to that mesh, transform and partition configuration, not every scene.

- Spacing0.16 retains47.56% of the dense surface receivers:52.44% fewer surface gather origins.
- Eight directions use one third of the ray count of24, or one twelfth of96, at fixed receiver configuration.
- Dense24 has9,836,352 surface receiver-direction pairs; this layout's0.16/eight configuration has1,559,312, or15.85% as many. This is an84.15% reduction in **surface ray pairs**, not an84.15% whole-frame saving.
- Smoke receivers, source preparation, fluid work, full mesh drawing and GI/AO are not eliminated by those surface reductions. Guide arithmetic and four-sample material reconstruction remain.

Operator exercise on October7 accepts the new emitter-informed appearance at8directions/0.16spacing in a separately authored kiln composition. That establishes usefulness of the shown look at those reported controls; it does not independently measure its frame cost or reference accuracy. Preserve that composition when making subsequent budget decisions.

## Measured GPU observations

All times below are milliseconds. Native routes used an Apple `metal-3` adapter and independent Chrome for Testing. Full retained run records, configuration identities and raw samples remain local evidence; dataset names below locate the records. The source revisions and executable witness are included so the observations can be re-exercised.

| Dataset / source | Scope and controls | Observation | Interpretation |
| --- | --- | --- | --- |
| `receiver-quality-native-001` / `1e8e5ce8` | Gather only, ordinary source-aware12; spacing0/0.04/0.08/0.16 | Medians0.910/0.774/0.699/0.654; restored dense0.979 | Approximately28% lower gather median dense→0.16 in this run; not a net frame estimate. |
| `receiver-quality-native-006` / `3b43c0e0` | Attributed explicit scene draws,12directions; same spacing order | Scene render medians35.208/17.158/20.892/27.334; restored dense25.281. Gather medians1.359/5.683/3.406/3.288; restored dense5.771 | Requested/observed frame attribution verified, but wide ranges, restoration variation and nonmonotonic costs defeat a causal net-saving claim. |
| `source-guide-target-003` / `b7917782` | Gather only, held primary, per-vertex, ordinary12/ordinary96/guided12/guided8/guided96/restored ordinary12 | Medians1.143/8.640/1.177/0.860/12.346/1.150 | Guided12 was about3% above ordinary12; guided96 about43% above ordinary96. Eight is lower work than12 here, not an equal-count sampler speedup. |
| `source-guide-budget-8-003` / `9530a842` | Gather only, another held primary, per-vertex | Ordinary8 initial7.170, guided8 3.741, identical restored ordinary8 0.857 | More than8× variation between identical ordinary8 fields. Comparing the first ordinary8 to guided8 would falsely suggest a48% win. Cause not attributed. |
| Combined GI `cost001` / `01a7a009` | Held-source whole-app render-invocation throughput; GTAO/combined/restored GTAO | 59.856/59.176/59.998 invocations/s | Browser-pacing limited. Does not establish equal GPU cost or live simulation FPS. Render-only timestamp hooks also omit separate compute work. |
| `source-guide-landing-native-003` / `8947221c` | First valid arm only: guided8, spacing0.16, 194,914 surface and8,192 smoke receivers, fluid resolution control48, held source, combined GI10 | 20 lighting-compute samples; total median1.249, range0.883–3.992 | Actual accepted controls on the composed host. The run later failed on missing/nonmonotonic timestamps in another arm; this is a partial observation, not a successful timing comparison or whole-frame budget. |

The first valid arm of the last row also supplies a component snapshot:

| Lighting compute component | Median GPU ms, same20recorded samples |
| --- | ---: |
| Direct light to smoke | 0.350 |
| Prepared smoke illumination reconstruction | 0.089 |
| Combine primary emission and once-scattered smoke source | 0.021 |
| Primary plus smoke-scattered light to mesh surfaces | 0.686 |
| **Observed lighting-compute total, including inter-pass gaps** | **1.249** |

Use the observed total, not a sum of component medians. This scope excludes fluid dynamics/pressure, primary source seeding, visible volume raymarching, host scene drawing and GI/AO. The subsequent `source-guide-landing-native-004` consumer/restoration exercise explicitly did not request profiling and contributes no timing measurement. These records make the current budget question more concrete without repairing the profiler or claiming the whole system takes1.249ms.

Re-exercise with existing witnesses rather than a new profiling framework: `scratch/beaming-distributed-witness.mjs --receiver-spacing-check`, `scratch/beaming-source-guide-witness.mjs`, and the Rendering tab's actual-input inspection / explicitly attributed scene GPU timing. Their required URL/output arguments and route admission matter. A saved basin records controls, not a replay of fluid/history buffers.

The two96direction references in the held guide comparisons differ themselves. Low-count guide results fill a local miss but show overshoot and worse aggregate field error against both references in those fixtures. Appearance acceptance in the separately authored composition does not convert either reference into ground truth or erase that numerical evidence.

## October 8: changing the guide makes solid visibility the dominant cost

Experimental source `fb125bd362ec09e8a37ed7e607b0b9041fe2db94`, based on accepted `d0624507`, not current-main adoption. Dataset `beaming-live-guide-budget-1008-003`, independent Chrome for Testing154 / Apple metal-3 / nonfallback. Accepted saved kiln composition and basin, guided8, receiver spacing0.16, GI10, source/filter reconstruction0, camera matching on, master/surface gain0 stops, held source generation129. Fluid resolution control48; effective coefficient grid32×64×32. 194,914 surface +8,192 smoke receivers and412,879 triangles:1,624,848 receiver-ray visibility queries per full guide refresh. Viewport1600×1200; timestamps cover lighting compute only, not scene drawing/GI, fluid update, source preparation or visible volume rendering.

| Recorded scope | Valid GPU samples / requested | Median ms | Range ms |
| --- | ---: | ---: | ---: |
| Cached-guide lighting compute | 32 /32 | 1.533581 | 0.945318–4.264810 |
| Changing-guide lighting compute, including refreshed visibility | 18 /32 | 86.793717 | 71.667240–96.799523 |
| Visibility pass within those18 changing-guide records | 18 /32 | 84.322630 | 69.973099–94.278437 |

This is a **partial failed run**, not a completed A/B/restoration benchmark. Changing record19 (zero-based18) failed the existing strict timestamp-order guard: successive pass ranges overlap; raw timestamps remain recorded, costs are null, and the cause is not attributed. No failing sample was deleted, repaired or counted as valid. The remaining13 changing samples and all32 restored samples were not executed; final source/output byte restoration therefore remains unproved. All51 recorded invocations show exactly one encode, no new pipelines or ray buffers, constant source-generation metadata129 and visibility preparation count advancing exactly for each changed guide. Native five-state prefix-growth/changed-guide arithmetic passed separately in the same run, maximum error7.68e-7. Baseline kiln/blue-gold flame screenshot was inspected; no changed-guide visual-quality claim.

CPU encode medians over all recorded samples were0.20ms cached /0.40ms changing. Submit-to-queue-completion wall medians were5.25ms cached /141.5ms changing (ranges2.2–145.5 and82.7–279.9). These include waiting and are not GPU-pass cost; retain every outlier. Per-pass timestamp observations already identify approximately70–94ms visibility work, even after eliminating allocation churn. This direct full-refresh implementation is not an affordable per-frame route for the accepted kiln; this does **not** establish the cost of an optimized/shared visibility representation or actual-emission guide construction. Do not build the emission hierarchy on the assumption that replacing emitter bounds makes this path cheap. Return the visibility architecture decision first.

The dataset retains the raw report, original/executed modules, native outputs, baseline fields and screenshot. The missing restoration limits comparison precision, not the observed order-of-magnitude mismatch to an interactive frame budget. No repeat is scheduled merely to obtain a successful status label.

## October 8: bounded exact rays and scene-covering occupancy

These are completed native paired experiments, not production adoption. Source4f843328 (`native-001`) tests exact source-volume-exit bounds with held material and eight prescribed guide states. Source93bda024 (`occupancy-{64,128}-003`) tests exact-near triangles plus conservative scene-covering occupancy farther away. All use independent Chrome for Testing154.0.8037.92, Apple metal-3/nonfallback, the accepted authored kiln/basin, guided8/.16/GI10, 194,914 surface plus8,192 smoke receivers,412,879 triangles, and a32×64×32 coefficient grid. Each run retains32pairs/64valid timings, zero invalid samples, no browser/HTTP errors, and exact original source/output restoration. Raw records: `/Users/noahlyons/.local/state/kaminos/beaming-bounded-visibility-1008/`.

| Paired run | Unbounded exact visibility median | Candidate visibility median | Candidate lighting command span median | Visibility reduction |
| --- | ---: | ---: | ---: | ---: |
| Exact source-volume bounds | 29.324ms | 24.923ms | 25.794ms | 15.0% |
| Scene occupancy64×128×64 | 35.692ms | 14.882ms | 15.332ms | 58.3% |
| Scene occupancy128×256×128 | 36.116ms | 12.953ms | 13.503ms | 64.1% |

Visibility ranges: exact-bounds baseline28.335–49.545/candidate24.434–41.916ms; occupancy64 baseline29.761–53.663/candidate13.606–32.916ms; occupancy128 baseline27.292–47.534/candidate12.239–34.212ms. Median within-pair savings4.299/19.537/21.447ms;29/32,31/32 and32/32 pairs favor the corresponding candidate. Arm order is fixed reference-then-candidate. Compare within each run; the earlier failed84ms baseline does not establish an84→13ms optimization.

The exact-bounds experiment has byte-identical full front/back/smoke fields across all eight guide states. Occupancy deliberately trades fidelity: original/displaced/split RGB replay holds extinction and burner controls fixed, uses an offline all-cell CPU-moment guide and leaves the visible flame held. It measures the visibility response to changed emission, **not** live GPU guide discovery or moving-fluid animation. Replay texture/scattering installation is reported separately; every measured pair retains strict no-new-pipeline/no-new-ray-buffer checks.

| Occupancy proxy | Front-field relative L2, original/displaced/split | Back-field energy ratio, original/displaced/split | Static CPU proxy build | Packed nodes |
| --- | --- | --- | ---: | ---: |
| 64×128×64 | 2.46% /7.71% /6.53% | 83.24% /97.25% /96.50% | 872.7ms | 237,216bytes |
| 128×256×128 | 3.85% /9.53% /8.79% | 81.18% /97.13% /94.17% | 1,344.9ms | 1,660,176bytes |

These ratios describe packed receiver fields, not area-weighted physical power. Baseline coefficient/output bytes match between the two occupancy runs although generation counters differ. Increasing resolution also halves the exact-near radius (.54144→.27068 source units), so this is a coupled policy comparison, not a clean grid-convergence study. Finer occupancy is not established as a fidelity improvement. All complete raw fields remain available; no tail/error sample was omitted.

All12 lighting-only frames were inspected: the kiln and broad wall/door response persist, with no gross collapse at the captured view. This is not wall/opening fidelity or motion acceptance; global field errors and the17–19% original back-field energy deficit remain material. Presentation-frame identity is not independently recorded for these screenshots; raw GPU fields bear the numeric comparison.

Budget interpretation: cheaper blockers demonstrably buy a2.4–2.8× refresh reduction, but13–15ms recurring visibility alone still crowds out fluid-grid and composition work. A60Hz frame is16.67ms; the candidate consumes78–89% of that budget before fluid simulation, source discovery/preparation, scene/GI or visible-volume rendering. This is budget arithmetic, not measured application FPS. Keep exact bounded queries as a useful lossless control; do not promote either occupancy setting as the live-lighting solution. The next architecture decision is how to avoid refreshing1.625million receiver-ray visibility queries whenever source guidance moves.

## Updating this ledger

For each useful new estimate, record source revision, effective route/device, source/scene configuration, grid and receiver counts, directions, viewport, pass scope, sample distribution/restoration, and whether the source was held or changing. Link retained raw evidence in the local accountability record. State unsupported/unknown rather than inserting a guessed zero or multiplying a gather ratio into whole-frame time.

The next missing quantity is a reliable synchronized cost allocation on the accepted configuration. That is future budget work, not a prerequisite to documenting the observations already available or a claim supplied by this landing.
