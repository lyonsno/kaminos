import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const page = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const witness = await readFile(new URL('../volume-witness.mjs', import.meta.url), 'utf8');
const benchmark = await readFile(new URL('../volume-boundary-splat-benchmark.mjs', import.meta.url), 'utf8');

assert.match(core, /BOUNDARY_SPLAT_SELECTOR_POLICY_IDENTITY\s*=\s*'boundary-splat-deterministic-gpu-hash-thinning-v0'/, 'deterministic hash selector policy identity is explicit');
assert.match(core, /BOUNDARY_SPLAT_SELECTOR_BUDGETS\s*=\s*\[0,\s*6400,\s*3200,\s*1600,\s*800\]/, 'runtime preserves an uncapped default alongside the requested exact budget ladder');
assert.match(core, /function normalizeBoundarySplatCandidateBudget/, 'candidate budget normalization is explicit');
assert.match(page, /volume_boundary_splat_candidate_budget/, 'operator route exposes the candidate-budget control in URLs');
assert.match(page, /id="volume-boundary-splat-candidate-budget"/, 'operator UI exposes the candidate-budget control');

assert.match(core, /selectorPolicyId:\s*u32,[\s\S]*requestedCandidateBudget:\s*u32,[\s\S]*effectiveCandidateBudget:\s*u32,[\s\S]*selectedCandidateCount:\s*u32/, 'GPU draw state preserves selector policy, requested/effective budget, and selected count');
assert.match(core, /fn boundarySplatDeterministicHash[\s\S]*fn boundarySplatSelectedSourceIndex/, 'WGSL owns deterministic GPU hash-thinning source-index selection');
assert.match(core, /let effectiveBudget = select\(candidateCount,\s*min\(candidateCount,\s*boundarySplatDraw\.requestedCandidateBudget\),\s*boundarySplatDraw\.requestedCandidateBudget > 0u\)/, 'finalize pass preserves the full source unless it clamps an explicit positive budget');
assert.match(core, /boundarySplatDraw\.selectedCandidateCount = effectiveBudget/, 'finalize pass records selected count separately from source count');
assert.match(core, /atomicStore\(&boundarySplatDraw\.instanceCount,\s*effectiveBudget \* boundarySplatDraw\.requestedInstanceCount\)/, 'indirect draw count is charged only for selected candidates times requested instances');
assert.match(core, /archiveBoundarySplatHistory[\s\S]*let selectedSourceCandidateIndex = boundarySplatSelectedSourceIndex\(candidateIndex,[\s\S]*boundarySplatDraw\.sourceCandidateCount,[\s\S]*boundarySplatDraw\.selectedCandidateCount[\s\S]*boundarySplatHistory\[targetIndex\] = boundarySplats\[selectedSourceCandidateIndex\]/, 'archive pass maps selected ranks onto deterministic source candidates without CPU readback');

assert.match(core, /boundarySplatSelectorPolicyIdentity/, 'runtime state reports selector policy identity');
assert.match(core, /boundarySplatRequestedCandidateBudget/, 'runtime state reports requested candidate budget');
assert.match(core, /boundarySplatEffectiveCandidateBudget/, 'runtime state reports effective candidate budget');
assert.match(core, /boundarySplatSelectedCandidateCount/, 'runtime state reports selected candidate count');
assert.match(core, /boundarySplatSelectorCostProfile[\s\S]*selectorGpuMs/, 'runtime state reports selector cost rather than hiding it inside raster time');
assert.match(core, /selectorPolicyId: boundarySplatSelectorPolicyCode/, 'draw-buffer initialization publishes selector policy id to GPU telemetry');

assert.match(witness, /boundarySplatSelectorPolicyIdentity:\s*sample\.boundarySplatSelectorPolicyIdentity\s*\?\?\s*state\.boundarySplatSelectorPolicyIdentity/, 'witness preserves selector policy identity');
assert.match(witness, /boundarySplatEffectiveCandidateBudget:\s*sample\.boundarySplatEffectiveCandidateBudget\s*\?\?\s*state\.boundarySplatEffectiveCandidateBudget/, 'witness preserves effective budget evidence');
assert.match(witness, /boundarySplatSelectedCandidateCount:\s*sample\.boundarySplatSelectedCandidateCount\s*\?\?\s*state\.boundarySplatSelectedCandidateCount/, 'witness preserves selected candidate count evidence');
assert.match(witness, /boundarySplatBudgetVisualEvidence[\s\S]*boundary-splat-deterministic-gpu-hash-thinning-v0[\s\S]*budgeted learned-splat volume signal/, 'witness has a narrow nonblank visual gate for sparse budgeted learned-splat rows');

assert.match(benchmark, /const BUDGETS = \[6400,\s*3200,\s*1600,\s*800\]/, 'benchmark runs the requested first-slice budget ladder');
assert.match(benchmark, /const INSTANCE_COUNTS = \[1,\s*16,\s*64,\s*100\]/, 'benchmark runs the requested first-slice instance ladder');
assert.match(benchmark, /volume_boundary_splat_candidate_budget/, 'benchmark routes the budget into the browser');
assert.match(benchmark, /staleOrDefaultBudget[\s\S]*selectorPolicyDisagreement[\s\S]*selectorCostMissing[\s\S]*selectedCountMismatch/, 'benchmark rejects stale budget, wrong selector, missing cost, and selected-count mismatch');
assert.match(benchmark, /selectorPlusRasterMs/, 'benchmark charges selector time into the cost curve');

console.log('boundary splat candidate budget contracts passed');
