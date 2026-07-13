import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const benchmark = await readFile(new URL('../volume-boundary-splat-benchmark.mjs', import.meta.url), 'utf8');

assert.match(benchmark, /BOUNDARY_SPLAT_BENCHMARK_SCHEMA\s*=\s*'kaminos\.boundary-splat\.serial-benchmark\.v0'/, 'benchmark report schema is explicit');
assert.match(benchmark, /volume_boundary_splat_mode', 'learned'/, 'benchmark requests the learned splat renderer');
assert.match(benchmark, /volume_boundary_sidecar_source', 'baked'/, 'benchmark requests the baked sidecar source');
assert.match(benchmark, /--reuse-browser[\s\S]*--keep-browser-open/, 'benchmark reuses one browser session serially');
assert.match(benchmark, /closeSharedBrowser/, 'benchmark closes its kept-open browser after serial runs');
assert.match(benchmark, /falseClosureChecks[\s\S]*fallbackRoute[\s\S]*requestedEffectiveRendererDisagreement[\s\S]*missingTimestampSupport[\s\S]*blankOrPartialReport/, 'benchmark reports false-closure checks');
assert.match(benchmark, /report\.boundarySplatMode !== 'learned'/, 'benchmark validates the learned renderer mode, not the older analytic mode');
assert.match(benchmark, /boundarySplatRequestedInstanceCount \?\? report\.controls\?\.boundarySplatInstances/, 'benchmark accepts the witness controls field as requested-instance authority');
assert.match(benchmark, /boundarySplatSourceCandidateCount \?\? report\.boundarySplatCandidateCount/, 'benchmark accepts the witness candidate-count field as source-count authority');
assert.match(benchmark, /staleOrDefaultBudget[\s\S]*selectorPolicyDisagreement[\s\S]*selectorCostMissing[\s\S]*selectedCountMismatch/, 'benchmark rejects budget and selector false closure');
assert.match(benchmark, /witnessReportAvailable/, 'benchmark preserves row evidence after a witness-level visual rejection');
assert.doesNotMatch(benchmark, /if \(!run\.ok\) break/, 'benchmark continues the matrix after a rejected row instead of hiding later budget costs');
assert.match(benchmark, /visualEvidenceAccepted:\s*Boolean\(run\.ok\)/, 'benchmark labels cost rows whose visual evidence was rejected');
assert.match(benchmark, /optimizationClaimAllowed:\s*false/, 'benchmark can explicitly reject optimization claims');
assert.match(benchmark, /boundarySplatGpuProfile[\s\S]*boundarySplatCopyDisposition[\s\S]*boundarySplatCandidateCount[\s\S]*boundarySplatOverflowCount/, 'benchmark summarizes timing, copy, candidate, and overflow evidence');
assert.match(benchmark, /selectorPlusRasterMs/, 'benchmark charges selector time to the budget curve');
assert.match(benchmark, /renderScale[\s\S]*resolution[\s\S]*viewport/, 'benchmark characterizes viewport and candidate scaling dimensions');

console.log('boundary splat benchmark contracts passed');
