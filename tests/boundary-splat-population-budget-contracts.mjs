import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = await import('../volume-core.js');
const coreSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');

assert.equal(
  typeof core.boundarySplatPopulationAllocationPlan,
  'function',
  'runtime must export the deterministic joint projected-work population planner',
);

const descriptors = [
  { index: 0, projectedDiameterPx: 32, salience: 1 },
  { index: 1, projectedDiameterPx: 96, salience: 1 },
  { index: 2, projectedDiameterPx: 192, salience: 1 },
  { index: 3, projectedDiameterPx: 384, salience: 1 },
];

const plan = core.boundarySplatPopulationAllocationPlan(descriptors, {
  sourceCandidateCount: 10000,
  candidateDrawLimit: 5600,
  projectedWorkLimit: 1_000_000_000,
  requestedHistoryDepth: 64,
  historyDepthTiers: [16, 32, 64],
  historyCandidateCapacity: 1000,
  candidateStrideBytes: 48,
  historyMemoryLimitBytes: 32 * 1000 * 48,
});

assert.equal(plan.ok, true, 'feasible joint population plan must succeed');
assert.equal(plan.identity, 'boundary-splat-global-marginal-utility-population-v0');
assert.equal(plan.authority, 'deterministic-cpu-request-gpu-count-readback-required-v0');
assert.deepEqual(plan.constraints, {
  candidateDrawLimit: 5600,
  projectedWorkLimit: 1_000_000_000,
  historyMemoryLimitBytes: 32 * 1000 * 48,
});
assert.equal(plan.allocations.length, descriptors.length, 'planner must preserve aggregate population coverage');
assert.deepEqual(
  plan.allocations.map(allocation => allocation.index).sort((a, b) => a - b),
  descriptors.map(descriptor => descriptor.index),
  'planner must not drop an instance to make the ledger look cheaper',
);
assert.ok(plan.allocations.every(allocation => allocation.requestedCandidateBudget >= 800));
assert.ok(plan.totalCandidateDraws <= plan.constraints.candidateDrawLimit, 'hard candidate draw limit must bind globally');
assert.ok(plan.totalProjectedWork <= plan.constraints.projectedWorkLimit, 'projected visible-work limit must bind independently');
assert.ok(
  plan.allocations.find(allocation => allocation.index === 3).requestedCandidateBudget
    >= plan.allocations.find(allocation => allocation.index === 0).requestedCandidateBudget,
  'equal-salience large support must not receive less detail than the smallest support when visible work is unconstrained',
);
assert.equal(plan.history.requestedDepth, 64);
assert.equal(plan.history.effectiveDepth, 32, 'shared truthful history must adapt to the explicit memory constraint');
assert.equal(plan.history.residentSourceCandidateCount, 32 * 1000, 'history residency is source-level and must not multiply by instance count');
assert.equal(plan.history.memoryBytes, 32 * 1000 * 48);
assert.equal(plan.history.authority, 'truthful-shared-source-history-residency-plan-v0');

const repeated = core.boundarySplatPopulationAllocationPlan([...descriptors].reverse(), {
  sourceCandidateCount: 10000,
  candidateDrawLimit: 5600,
  projectedWorkLimit: 1_000_000_000,
  requestedHistoryDepth: 64,
  historyDepthTiers: [16, 32, 64],
  historyCandidateCapacity: 1000,
  candidateStrideBytes: 48,
  historyMemoryLimitBytes: 32 * 1000 * 48,
});
assert.deepEqual(
  repeated.allocations.map(row => [row.index, row.requestedCandidateBudget]).sort((a, b) => a[0] - b[0]),
  plan.allocations.map(row => [row.index, row.requestedCandidateBudget]).sort((a, b) => a[0] - b[0]),
  'global allocation must not depend on descriptor arrival order',
);

const infeasible = core.boundarySplatPopulationAllocationPlan(descriptors, {
  sourceCandidateCount: 10000,
  candidateDrawLimit: 3199,
  projectedWorkLimit: 1_000_000_000,
  requestedHistoryDepth: 16,
  historyCandidateCapacity: 1000,
  candidateStrideBytes: 48,
  historyMemoryLimitBytes: 16 * 1000 * 48,
});
assert.equal(infeasible.ok, false, 'planner must fail loud when minimum population coverage exceeds the hard draw limit');
assert.ok(infeasible.reasons.includes('candidate-draw-limit-below-population-minimum'));
assert.equal(infeasible.allocations.length, 0, 'infeasible evidence must not look like a lawful partial population');

const projectedInfeasible = core.boundarySplatPopulationAllocationPlan(descriptors, {
  sourceCandidateCount: 10000,
  candidateDrawLimit: 100000,
  projectedWorkLimit: 1,
  requestedHistoryDepth: 16,
  historyCandidateCapacity: 1000,
  candidateStrideBytes: 48,
  historyMemoryLimitBytes: 16 * 1000 * 48,
});
assert.equal(projectedInfeasible.ok, false);
assert.ok(projectedInfeasible.reasons.includes('projected-work-limit-below-population-minimum'));

for (const candidateDrawLimit of [0, -1]) {
  const zeroCandidatePlan = core.boundarySplatPopulationAllocationPlan(descriptors, {
    sourceCandidateCount: 10000,
    candidateDrawLimit,
    projectedWorkLimit: 1_000_000_000,
    requestedHistoryDepth: 16,
    historyCandidateCapacity: 1000,
    candidateStrideBytes: 48,
    historyMemoryLimitBytes: 16 * 1000 * 48,
  });
  assert.equal(zeroCandidatePlan.ok, false, 'explicit non-positive candidate limits must not become unbounded');
  assert.ok(zeroCandidatePlan.reasons.includes('candidate-draw-limit-below-population-minimum'));
  assert.equal(zeroCandidatePlan.constraints.candidateDrawLimit, candidateDrawLimit, 'evidence must preserve the explicit candidate limit');
}

for (const projectedWorkLimit of [0, -1]) {
  const zeroProjectedPlan = core.boundarySplatPopulationAllocationPlan(descriptors, {
    sourceCandidateCount: 10000,
    candidateDrawLimit: 100000,
    projectedWorkLimit,
    requestedHistoryDepth: 16,
    historyCandidateCapacity: 1000,
    candidateStrideBytes: 48,
    historyMemoryLimitBytes: 16 * 1000 * 48,
  });
  assert.equal(zeroProjectedPlan.ok, false, 'explicit non-positive projected-work limits must not become unbounded');
  assert.ok(zeroProjectedPlan.reasons.includes('projected-work-limit-below-population-minimum'));
  assert.equal(zeroProjectedPlan.constraints.projectedWorkLimit, projectedWorkLimit, 'evidence must preserve the explicit projected-work limit');
}

for (const historyMemoryLimitBytes of [0, -1]) {
  const zeroHistoryPlan = core.boundarySplatPopulationAllocationPlan(descriptors, {
    sourceCandidateCount: 10000,
    candidateDrawLimit: 100000,
    projectedWorkLimit: 1_000_000_000,
    requestedHistoryDepth: 16,
    historyCandidateCapacity: 1000,
    candidateStrideBytes: 48,
    historyMemoryLimitBytes,
  });
  assert.equal(zeroHistoryPlan.ok, false, 'explicit non-positive history limits must not become unbounded');
  assert.ok(zeroHistoryPlan.reasons.includes('history-memory-limit-below-minimum-depth'));
  assert.equal(zeroHistoryPlan.constraints.historyMemoryLimitBytes, historyMemoryLimitBytes, 'evidence must preserve the explicit history limit');
}

assert.match(
  coreSource,
  /BOUNDARY_SPLAT_POPULATION_ALLOCATOR_IDENTITY\s*=\s*'boundary-splat-global-marginal-utility-population-v0'/,
  'runtime telemetry must publish the global allocator identity',
);
assert.match(
  coreSource,
  /residentSourceCandidateCount[\s\S]*historyMemoryLimitBytes/,
  'population planning must keep truthful source residency and memory authority explicit',
);

console.log('boundary splat population budget contracts passed');
