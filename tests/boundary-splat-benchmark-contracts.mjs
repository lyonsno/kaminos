import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const benchmark = await readFile(new URL('../volume-boundary-splat-benchmark.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');

assert.match(benchmark, /BOUNDARY_SPLAT_BENCHMARK_SCHEMA\s*=\s*'kaminos\.boundary-splat\.learned-cost-benchmark\.v0'/, 'learned-cost benchmark report schema is explicit');
assert.match(benchmark, /22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472/, 'benchmark pins the corrected learned model sha256');
assert.match(benchmark, /live-boundary-sidecar-analytic-splats-v0[\s\S]*live-boundary-sidecar-learned-attribute-splats-v0/, 'benchmark pins both effective renderer identities');
assert.match(benchmark, /analytic[\s\S]*learned[\s\S]*alternat/i, 'benchmark alternates analytic and learned samples');
assert.match(benchmark, /volume_boundary_sidecar_source', 'baked'/, 'benchmark requests the baked sidecar source');
assert.match(benchmark, /--reuse-browser[\s\S]*--keep-browser-open/, 'benchmark reuses one browser session serially');
assert.match(benchmark, /closeSharedBrowser/, 'benchmark closes its kept-open browser after serial runs');
assert.match(benchmark, /falseClosureChecks[\s\S]*fallbackRoute[\s\S]*requestedEffectiveRendererDisagreement[\s\S]*staleOrDefaultModelIdentity[\s\S]*candidateCountMismatch[\s\S]*nonzeroOverflow[\s\S]*nonzeroCandidateCopy[\s\S]*missingOrBlankSamples[\s\S]*proxyRepresentedAsGpuExclusive[\s\S]*warmupMixedIntoSteadyState[\s\S]*multipleParallelBrowsers/, 'benchmark reports learned-cost false-closure checks');
assert.match(benchmark, /optimizationClaimAllowed:\s*false/, 'benchmark can explicitly reject optimization claims');
assert.match(benchmark, /boundarySplatGpuProfile[\s\S]*boundarySplatCopyDisposition[\s\S]*boundarySplatCandidateCount[\s\S]*boundarySplatOverflowCount/, 'benchmark summarizes timing, copy, candidate, and overflow evidence');
assert.match(benchmark, /renderScale[\s\S]*resolution[\s\S]*viewport/, 'benchmark characterizes viewport and candidate scaling dimensions');
assert.match(benchmark, /warmupSamples[\s\S]*steadySamples/, 'benchmark separates warmup from the steady distribution');
assert.match(benchmark, /measurementAuthority[\s\S]*(?:cpu-visible|proxy)/i, 'benchmark labels non-GPU-exclusive timing as proxy authority');
assert.match(benchmark, /CANDIDATE_HEAD_WEIGHT_PRODUCTS\s*=\s*1408[\s\S]*candidateHeadProductsPerFrame[\s\S]*CANDIDATE_HEAD_WEIGHT_PRODUCTS/, 'benchmark records the learned-head arithmetic floor per accepted candidate');
assert.match(benchmark, /compactionAnalyticSteady[\s\S]*compactionLearnedSteady[\s\S]*compactionLearnedMinusAnalyticPaired[\s\S]*splatRasterLearnedMinusAnalyticPaired/, 'benchmark separates learned-head compaction cost from output-dependent raster cost');
assert.match(benchmark, /failed-before-primary-output[\s\S]*phase[\s\S]*lastTrustworthyEvidence/, 'benchmark preserves failure phase and last trustworthy evidence');
assert.match(core, /timestampWrites[\s\S]*beginningOfPassWriteIndex[\s\S]*endOfPassWriteIndex/, 'renderer investigates pass-descriptor timestamp writes without repeating encoder.writeTimestamp');
assert.match(core, /sampleBoundarySplatCostAlternation[\s\S]*cpu-visible-queue-completion-proxy-v0[\s\S]*onSubmittedWorkDone/, 'renderer exposes a frozen same-page queue-completion cost proxy');
assert.match(witness, /--boundary-splat-cost-probe[\s\S]*sampleBoundarySplatCostAlternation/, 'witness can collect the matched analytic/learned alternation from one page');

console.log('boundary splat benchmark contracts passed');
