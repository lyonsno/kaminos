import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const corePath = join(root, 'volume-core.js');
const coreSource = readFileSync(corePath, 'utf8');
const witnessSource = readFileSync(join(root, 'volume-witness.mjs'), 'utf8');
const coreModule = await import(`../volume-core.js?pressure-history-contract=${Date.now()}`);

assert.equal(
  typeof coreModule.globalPressureBufferPlan,
  'function',
  'global pressure exposes a deterministic persistent-buffer ownership planner'
);

const p1Frame0 = coreModule.globalPressureBufferPlan(0, 1);
assert.deepEqual(p1Frame0.dispatches, [{ iteration: 1, readIndex: 0, writeIndex: 1 }]);
assert.equal(p1Frame0.finalIndex, 1);
const p1Frame1 = coreModule.globalPressureBufferPlan(p1Frame0.finalIndex, 1);
assert.deepEqual(p1Frame1.dispatches, [{ iteration: 1, readIndex: 1, writeIndex: 0 }]);
assert.equal(p1Frame1.finalIndex, 0, 'P1 starts from the previous frame final pressure instead of fixed buffer A');

const p2Frame0 = coreModule.globalPressureBufferPlan(0, 2);
assert.deepEqual(p2Frame0.dispatches, [
  { iteration: 1, readIndex: 0, writeIndex: 1 },
  { iteration: 2, readIndex: 1, writeIndex: 0 },
]);
assert.equal(p2Frame0.finalIndex, 0);

const p3Frame0 = coreModule.globalPressureBufferPlan(0, 3);
assert.equal(p3Frame0.finalIndex, 1);
const p3Frame1 = coreModule.globalPressureBufferPlan(p3Frame0.finalIndex, 3);
assert.equal(p3Frame1.dispatches[0].readIndex, 1, 'P3 starts from its previous final third iteration');
assert.equal(p3Frame1.finalIndex, 0);

assert.equal(
  typeof coreModule.pressureJacobiStageTimestampWrites,
  'function',
  'aggregate Jacobi telemetry exposes deterministic endpoint ownership'
);
const querySetMarker = {};
const aggregateJacobiWrites = { querySet: querySetMarker, beginningOfPassWriteIndex: 2, endOfPassWriteIndex: 3 };
assert.deepEqual(
  coreModule.pressureJacobiStageTimestampWrites(aggregateJacobiWrites, 1, 3),
  { querySet: querySetMarker, beginningOfPassWriteIndex: 2 }
);
assert.equal(
  coreModule.pressureJacobiStageTimestampWrites(aggregateJacobiWrites, 2, 3),
  null,
  'interior Jacobi iterations omit timestampWrites instead of emitting an invalid query-set-only descriptor'
);
assert.deepEqual(
  coreModule.pressureJacobiStageTimestampWrites(aggregateJacobiWrites, 3, 3),
  { querySet: querySetMarker, endOfPassWriteIndex: 3 }
);

assert.match(coreSource, /SIM_GPU_PROFILE_IDENTITY/, 'sim timing has a durable profile identity');
assert.match(coreSource, /sampleSimGpuProfile/, 'prototype exposes an isolated simulation GPU timing sample');
assert.match(
  coreSource,
  /simGpuProfile[\s\S]*mainFluid[\s\S]*pressureJacobi[\s\S]*pressureProjection[\s\S]*total/,
  'sim timing reports main fluid, aggregate Jacobi, projection, and total stages'
);
assert.match(coreSource, /timestamp-query-incomplete/, 'sim timing rejects incomplete timestamp evidence');
assert.match(coreSource, /timestamp-query-stage-reversed/, 'sim timing rejects a reversed begin/end pair within one stage');
assert.match(coreSource, /simGpuProfileInFlight/, 'live RAF work is excluded while an isolated sim profile is in flight');
assert.match(coreSource, /queue\.onSubmittedWorkDone/, 'isolated sim timing drains prior live queue work before sampling');
assert.match(coreSource, /stageOverlap/, 'sim timing reports legal cross-pass GPU overlap instead of rejecting it');
assert.match(coreSource, /pressureTail/, 'sim timing separates serialized pressure tail from overlapping pressure work');
assert.match(coreSource, /pressureBufferStartIndex/, 'debug state exposes effective global pressure start ownership');
assert.match(coreSource, /pressureBufferFinalIndex/, 'debug state exposes effective global pressure final ownership');
assert.doesNotMatch(
  coreSource,
  /let pressureReadIndex = 0;\s*for \(let i = 0; i < pressureIterationCount/,
  'global pressure must not hard-reset ownership to buffer A each frame'
);
assert.match(witnessSource, /sampleSimGpuProfile/, 'volume witness explicitly requests isolated simulation GPU timing');
assert.match(
  witnessSource,
  /simGpuProfile[\s\S]*timestampStatus[\s\S]*available/,
  'volume witness rejects unsupported timestamp profiles instead of treating them as zero-cost evidence'
);
assert.match(
  witnessSource,
  /simGpuProfile[\s\S]*pressureBufferHistoryStrategy[\s\S]*pressureFraction/,
  'volume witness preserves effective pressure ownership and measured pressure share'
);
assert.match(
  witnessSource,
  /sim-profile-only/,
  'volume witness can isolate pressure telemetry from unrelated appearance-control assertions'
);
assert.match(
  witnessSource,
  /sim-profile-samples[\s\S]*samples[\s\S]*p50[\s\S]*p95/,
  'isolated telemetry preserves uncapped requested samples and distribution summaries'
);
assert.match(
  witnessSource,
  /sim-profile-pressure-disabled[\s\S]*pressure-disabled-counterfactual/,
  'isolated telemetry exposes a labeled pressure-disabled P0 counterfactual without changing live pressure modes'
);
assert.match(
  witnessSource,
  /sim-profile-iteration-sweep[\s\S]*rotatedIterations[\s\S]*simGpuProfileSweep/,
  'one browser job can rotate pressure levels to balance scheduler stalls across treatments'
);

console.log('pressure history and telemetry contracts passed');
