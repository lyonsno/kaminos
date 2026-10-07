# Flame system performance ledger

Updated 2026-10-07. This is a working budget ledger, not a benchmark claim. Its purpose is to make room for larger fluid grids and composed scene features while protecting the accepted flame-driven light character. Keep measurements, structural work estimates, and missing measurements distinct.

## Current budget model

The distributed route shares a current emission/extinction source between mesh receivers and smoke. Static receiver-to-source visibility is cached; changing emission is integrated over those cached rays. Coarse surface receivers reduce gathering but add material-side reconstruction. Combined screen-space GI/AO is a separate consumer of lit surfaces, not another volume-scattering solve.

| Component | Main cost drivers | Current evidence / estimate |
| --- | --- | --- |
| Fluid update, advection and pressure | Full allocated grid, iterations, active solver and boundary passes | No comparable current GPU-ms estimate collated yet. A hidden upper half of a volume is not computationally free. |
| Primary volume-source preparation | Full source-grid cells, material evaluation, copies | Not isolated in the current timing records. Camera display exposure is distinct from source power. |
| Static mesh packing and ray visibility | Caster triangles, receiver count × directions; rebuilds after relevant geometry/receiver/guide edits | Preparation cost, not steady-frame cost. Emission-only changes reuse visibility. Receiver-only edits retain packed caster geometry. |
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

Re-exercise with existing witnesses rather than a new profiling framework: `scratch/beaming-distributed-witness.mjs --receiver-spacing-check`, `scratch/beaming-source-guide-witness.mjs`, and the Rendering tab's actual-input inspection / explicitly attributed scene GPU timing. Their required URL/output arguments and route admission matter. A saved basin records controls, not a replay of fluid/history buffers.

The two96direction references in the held guide comparisons differ themselves. Low-count guide results fill a local miss but show overshoot and worse aggregate field error against both references in those fixtures. Appearance acceptance in the separately authored composition does not convert either reference into ground truth or erase that numerical evidence.

## Updating this ledger

For each useful new estimate, record source revision, effective route/device, source/scene configuration, grid and receiver counts, directions, viewport, pass scope, sample distribution/restoration, and whether the source was held or changing. Link retained raw evidence in the local accountability record. State unsupported/unknown rather than inserting a guessed zero or multiplying a gather ratio into whole-frame time.

The next missing quantity is a reliable synchronized cost allocation on the accepted configuration. That is future budget work, not a prerequisite to documenting the observations already available or a claim supplied by this landing.
