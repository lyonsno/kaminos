import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const benchmark = await readFile(new URL('../volume-boundary-splat-benchmark.mjs', import.meta.url), 'utf8');

assert.match(benchmark, /BOUNDARY_SPLAT_BENCHMARK_SCHEMA\s*=\s*'kaminos\.boundary-splat\.serial-benchmark\.v0'/, 'benchmark report schema is explicit');
assert.match(benchmark, /volume_boundary_splat_mode', 'analytic'/, 'benchmark requests the analytic splat renderer');
assert.match(benchmark, /volume_boundary_sidecar_source', 'baked'/, 'benchmark requests the baked sidecar source');
assert.match(benchmark, /--reuse-browser[\s\S]*--keep-browser-open/, 'benchmark reuses one browser session serially');
assert.match(benchmark, /closeSharedBrowser/, 'benchmark closes its kept-open browser after serial runs');
assert.match(benchmark, /falseClosureChecks[\s\S]*fallbackRoute[\s\S]*requestedEffectiveRendererDisagreement[\s\S]*missingTimestampSupport[\s\S]*blankOrPartialReport/, 'benchmark reports false-closure checks');
assert.match(benchmark, /optimizationClaimAllowed:\s*false/, 'benchmark can explicitly reject optimization claims');
assert.match(benchmark, /boundarySplatGpuProfile[\s\S]*boundarySplatCopyDisposition[\s\S]*boundarySplatCandidateCount[\s\S]*boundarySplatOverflowCount/, 'benchmark summarizes timing, copy, candidate, and overflow evidence');
assert.match(benchmark, /renderScale[\s\S]*resolution[\s\S]*viewport/, 'benchmark characterizes viewport and candidate scaling dimensions');

console.log('boundary splat benchmark contracts passed');
