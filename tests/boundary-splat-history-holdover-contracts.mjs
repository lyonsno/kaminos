#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as volumeCore from '../volume-core.js';

const {
  nextBoundarySplatHistoryAllocation,
  boundarySplatHistoryArchiveDecision,
  boundarySplatHistorySlotReadiness,
  boundarySplatHistoryHoldoverDrawPlan,
} = volumeCore;

assert.equal(typeof nextBoundarySplatHistoryAllocation, 'function', 'history allocations must publish a monotonic generation contract');
assert.equal(typeof boundarySplatHistoryArchiveDecision, 'function', 'history archive writes must be decided from source generation rather than render cadence');
assert.equal(typeof boundarySplatHistorySlotReadiness, 'function', 'holdover must reject stale or incomplete slots before draw');
assert.equal(typeof boundarySplatHistoryHoldoverDrawPlan, 'function', 'holdover must derive an archived-count-safe one-flame indirect draw');

const allocation = nextBoundarySplatHistoryAllocation({ generation: 4 }, {
  slotCount: 4,
  allocatedSlotCount: 16,
  candidateCapacity: 131072,
  reason: 'capacity-growth',
});
assert.equal(allocation.generation, 5);
assert.equal(allocation.slotCount, 4);
assert.equal(allocation.allocatedSlotCount, 16);
assert.equal(allocation.candidateCapacity, 131072);
assert.equal(allocation.reason, 'capacity-growth');
assert.equal(allocation.slots.length, 4);
assert.ok(allocation.slots.every(slot => slot.initialized === false && slot.writeSubmissionCompleted === false));

assert.deepEqual(boundarySplatHistoryArchiveDecision({
  allocationGeneration: 5,
  sourceCandidateGeneration: 18,
  sourceSimStepCount: 18,
  lastArchivedAllocationGeneration: 5,
  lastArchivedSourceCandidateGeneration: 18,
  historyFrameStride: 8,
  holdover: false,
}), {
  archive: false,
  reason: 'source-generation-already-archived',
  writeTick: 2,
  writeSlot: 2,
});

assert.deepEqual(boundarySplatHistoryArchiveDecision({
  allocationGeneration: 5,
  sourceCandidateGeneration: 19,
  sourceSimStepCount: 19,
  lastArchivedAllocationGeneration: 5,
  lastArchivedSourceCandidateGeneration: 18,
  historyFrameStride: 8,
  historyDepth: 4,
  holdover: false,
}), {
  archive: true,
  reason: 'new-source-candidate-generation',
  writeTick: 2,
  writeSlot: 2,
});

assert.equal(boundarySplatHistoryArchiveDecision({
  allocationGeneration: 5,
  sourceCandidateGeneration: 20,
  sourceSimStepCount: 20,
  lastArchivedAllocationGeneration: 5,
  lastArchivedSourceCandidateGeneration: 19,
  historyFrameStride: 8,
  historyDepth: 4,
  holdover: true,
}).reason, 'holdover-does-not-archive');

const completedSlot = {
  slotIndex: 2,
  initialized: true,
  historyAllocationGeneration: 5,
  archiveWriteSequence: 41,
  writeSubmissionCompleted: true,
  sourceCandidateGeneration: 19,
  sourceSimStepCount: 19,
  sourceCandidateCount: 3758,
  effectiveDrawCount: 3200,
  sourceRenderFrameCount: 144,
};

const validSelection = {
  slotIndex: 2,
  historyAllocationGeneration: 5,
  archiveWriteSequence: 41,
  currentSourceCandidateGeneration: 22,
  maxAgeGenerations: 8,
  requestedDrawCount: 3200,
  candidateCapacity: 131072,
};
assert.deepEqual(boundarySplatHistorySlotReadiness(completedSlot, validSelection), {
  ok: true,
  reasons: [],
  sourceAgeGenerations: 3,
});

const rejectionCases = [
  [{ ...completedSlot, initialized: false }, validSelection, 'slot-uninitialized'],
  [{ ...completedSlot, writeSubmissionCompleted: false }, validSelection, 'write-not-completed'],
  [completedSlot, { ...validSelection, historyAllocationGeneration: 6 }, 'allocation-generation-mismatch'],
  [completedSlot, { ...validSelection, archiveWriteSequence: 40 }, 'slot-overwritten-after-selection'],
  [{ ...completedSlot, sourceCandidateGeneration: 23 }, validSelection, 'source-generation-future'],
  [{ ...completedSlot, sourceCandidateCount: 0 }, validSelection, 'source-candidate-count-zero'],
  [{ ...completedSlot, sourceCandidateCount: 131073 }, validSelection, 'source-candidate-count-exceeds-capacity'],
  [{ ...completedSlot, effectiveDrawCount: 3759 }, validSelection, 'archived-draw-count-exceeds-source-count'],
  [completedSlot, { ...validSelection, requestedDrawCount: 3201 }, 'requested-draw-count-exceeds-archived-count'],
  [completedSlot, { ...validSelection, currentSourceCandidateGeneration: 29 }, 'source-generation-age-exceeded'],
];
for (const [slot, selection, expectedReason] of rejectionCases) {
  assert.ok(
    boundarySplatHistorySlotReadiness(slot, selection).reasons.includes(expectedReason),
    `readiness must reject ${expectedReason}`,
  );
}

assert.deepEqual(boundarySplatHistoryHoldoverDrawPlan(completedSlot, validSelection), {
  ok: true,
  reasons: [],
  sourceAgeGenerations: 3,
  drawCount: 3200,
  indirectCommand: {
    vertexCount: 6,
    instanceCount: 3200,
    firstVertex: 0,
    firstInstance: 0,
  },
});

const core = fs.readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(core, /boundarySplatHistorySlotMetadataBuffer/, 'GPU archive must own compact per-slot metadata beside the candidate history ring');
assert.match(core, /@binding\(11\) var<uniform> boundarySplatHistoryArchiveControl/, 'CPU-authored archive control must consume a uniform binding so history metadata stays within the WebGPU storage-buffer stage limit');
assert.match(core, /boundarySplatHistoryArchiveControlBuffer = device\.createBuffer\([\s\S]{0,300}GPUBufferUsage\.UNIFORM \| GPUBufferUsage\.COPY_DST/, 'archive-control allocation must match its uniform WGSL authority');
assert.match(core, /binding: 11, visibility: GPUShaderStage\.COMPUTE, buffer: \{ type: 'uniform' \}/, 'compute layout must bind archive control as uniform rather than a ninth storage buffer');
assert.match(core, /historyAllocationGeneration/, 'runtime telemetry must expose the physical history allocation generation');
assert.match(core, /boundarySplatHistorySlotOverride/, 'a single-flame descriptor must accept an explicit validated history slot');
assert.match(core, /renderBoundarySplatHistorySlotToCanvas/, 'the public prototype must expose a draw-only history-slot render socket');
assert.match(core, /simulationSubmitted:\s*false[\s\S]*sidecarSubmitted:\s*false[\s\S]*compactionSubmitted:\s*false[\s\S]*archiveSubmitted:\s*false/, 'holdover evidence must deny all source-progression work explicitly');
assert.match(
  core,
  /function resumeBoundarySplatHistoryHoldoverLoop[\s\S]*finally \{[\s\S]*resumeBoundarySplatHistoryHoldoverLoop\(options\)/,
  'every post-cancel holdover exit must pass through one render-loop restoration point',
);
assert.match(
  core,
  /\.\.\.\(options\.controlOverrides[\s\S]{0,300}boundarySplatInstances:\s*1/,
  'the holdover socket must force one instance after applying caller overrides',
);

console.log('boundary splat history holdover contracts: ok');
