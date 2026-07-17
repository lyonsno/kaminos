#!/usr/bin/env node
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../volume-exact-state-cadence-ring.mjs', import.meta.url);
assert.ok(existsSync(fileURLToPath(moduleUrl)), 'bounded exact-state cadence ring module exists');

const {
  EXACT_STATE_CADENCE_RING_IDENTITY,
  createExactStateCadenceRing,
  exactStateCadenceAllocationPlan,
  planExactStateProduction,
  recordCompletedExactState,
  resetExactStateCadenceRing,
  selectExactStatePresentation,
} = await import(moduleUrl.href);

assert.equal(EXACT_STATE_CADENCE_RING_IDENTITY, 'kaminos.volume.exact-state-cadence-ring.v0');
assert.equal(typeof planExactStateProduction, 'function', 'cadence ring exposes a non-mutating GPU slot reservation plan');

const allocation = exactStateCadenceAllocationPlan({
  requestedDepth: 4,
  presentationDelaySteps: 2,
  fluidBytes: 56_623_104,
  frontBytes: 3_538_944,
  maxBufferSize: 268_435_456,
  maxStorageBufferBindingSize: 134_217_728,
});
assert.equal(allocation.ok, true);
assert.equal(allocation.requestedDepth, 4);
assert.equal(allocation.allocatedDepth, 4);
assert.equal(allocation.requiredDepth, 4);
assert.equal(allocation.slotBytes, 60_162_048);
assert.equal(allocation.ringBytes, 240_648_192);
assert.equal(allocation.presentationBytes, 60_162_048);
assert.equal(allocation.authority, 'requested-depth-plus-webgpu-per-buffer-limits-v0');

const tooShallow = exactStateCadenceAllocationPlan({
  requestedDepth: 3,
  presentationDelaySteps: 2,
  fluidBytes: 64,
  frontBytes: 16,
  maxBufferSize: 1024,
  maxStorageBufferBindingSize: 1024,
});
assert.equal(tooShallow.ok, false);
assert.deepEqual(tooShallow.refusalReasons, ['requested-depth-cannot-hold-delayed-adjacent-bracket']);
assert.equal(tooShallow.allocatedDepth, 0, 'allocation refuses instead of silently reducing delay or inventing depth');

const bindingOverflow = exactStateCadenceAllocationPlan({
  requestedDepth: 4,
  presentationDelaySteps: 2,
  fluidBytes: 2048,
  frontBytes: 16,
  maxBufferSize: 4096,
  maxStorageBufferBindingSize: 1024,
});
assert.equal(bindingOverflow.ok, false);
assert.ok(bindingOverflow.refusalReasons.includes('fluid-state-exceeds-device-storage-binding-limit'));

const ring = createExactStateCadenceRing({
  capacity: 4,
  presentationDelaySteps: 2,
  stepDurationMs: 40,
  controlGeneration: 7,
});
assert.equal(ring.identity, EXACT_STATE_CADENCE_RING_IDENTITY);
assert.equal(ring.oneSimulatorAuthority, 'single-authoritative-simulator-completed-state-history-v0');

const firstProduction = planExactStateProduction(ring, {
  sourceStep: 10,
  controlGeneration: 7,
});
assert.equal(firstProduction.ok, true);
assert.equal(firstProduction.receipt.slot, 0);
assert.equal(firstProduction.receipt.evictedSourceStep, null);

for (let sourceStep = 10; sourceStep <= 13; sourceStep += 1) {
  const production = planExactStateProduction(ring, { sourceStep, controlGeneration: 7 });
  const completion = recordCompletedExactState(ring, {
    sourceStep,
    completedAtMs: 1000 + (sourceStep - 10) * 20,
    controlGeneration: 7,
    plannedSlot: production.receipt.slot,
  });
  assert.equal(completion.ok, true);
  assert.equal(completion.receipt.slot, (sourceStep - 10) % 4);
}

const initialPresentation = selectExactStatePresentation(ring, { nowMs: 2000 });
assert.equal(initialPresentation.ok, true);
assert.equal(initialPresentation.receipt.fromSourceStep, 11);
assert.equal(initialPresentation.receipt.toSourceStep, 12);
assert.equal(initialPresentation.receipt.alpha, 0);
assert.equal(initialPresentation.receipt.controlGeneration, 7);
assert.equal(initialPresentation.receipt.phaseSource, 'completed-exact-state-continuation-history');

const halfStepPresentation = selectExactStatePresentation(ring, { nowMs: 2020 });
assert.equal(halfStepPresentation.ok, true);
assert.equal(halfStepPresentation.receipt.fromSourceStep, 11);
assert.equal(halfStepPresentation.receipt.toSourceStep, 12);
assert.equal(halfStepPresentation.receipt.alpha, 0.5);

const duplicatePresentation = selectExactStatePresentation(ring, { nowMs: 2020 });
assert.equal(duplicatePresentation.ok, false);
assert.equal(duplicatePresentation.reason, 'duplicate-presentation-clock-sample');

const appendAfterConsumption = recordCompletedExactState(ring, {
  sourceStep: 14,
  completedAtMs: 1100,
  controlGeneration: 7,
  plannedSlot: planExactStateProduction(ring, { sourceStep: 14, controlGeneration: 7 }).receipt.slot,
});
assert.equal(appendAfterConsumption.ok, true, 'producer can evict only a state consumed by presentation');
assert.equal(appendAfterConsumption.receipt.evictedSourceStep, 10);

const fullRing = createExactStateCadenceRing({
  capacity: 4,
  presentationDelaySteps: 2,
  stepDurationMs: 40,
  controlGeneration: 3,
});
for (let sourceStep = 1; sourceStep <= 4; sourceStep += 1) {
  assert.equal(recordCompletedExactState(fullRing, {
    sourceStep,
    completedAtMs: sourceStep * 10,
    controlGeneration: 3,
  }).ok, true);
}
const overwriteRefusal = recordCompletedExactState(fullRing, {
  sourceStep: 5,
  completedAtMs: 50,
  controlGeneration: 3,
});
assert.equal(overwriteRefusal.ok, false);
assert.equal(overwriteRefusal.reason, 'producer-would-overwrite-unpresented-state');
assert.equal(fullRing.newestSourceStep, 4, 'refused production does not mutate completed-state authority');

const underflowRing = createExactStateCadenceRing({
  capacity: 4,
  presentationDelaySteps: 2,
  stepDurationMs: 40,
  controlGeneration: 1,
});
for (let sourceStep = 20; sourceStep <= 23; sourceStep += 1) {
  recordCompletedExactState(underflowRing, {
    sourceStep,
    completedAtMs: sourceStep * 10,
    controlGeneration: 1,
  });
}
assert.equal(selectExactStatePresentation(underflowRing, { nowMs: 5000 }).ok, true);
const underflow = selectExactStatePresentation(underflowRing, { nowMs: 5080 });
assert.equal(underflow.ok, false);
assert.equal(underflow.reason, 'presentation-lead-underflow');
assert.equal(underflow.receipt.requestedToSourceStep, 24);
assert.equal(recordCompletedExactState(underflowRing, {
  sourceStep: 24,
  completedAtMs: 5085,
  controlGeneration: 1,
}).ok, true);
const recoveredWithoutSkip = selectExactStatePresentation(underflowRing, { nowMs: 5100 });
assert.equal(recoveredWithoutSkip.ok, true);
assert.equal(recoveredWithoutSkip.receipt.fromSourceStep, 21, 'underflow freezes the last consumed source position');
assert.equal(recoveredWithoutSkip.receipt.toSourceStep, 22);
assert.equal(recoveredWithoutSkip.receipt.alpha, 0.5, 'presentation resumes from the frozen position without wall-clock catch-up');

const reset = resetExactStateCadenceRing(ring, {
  controlGeneration: 8,
  reason: 'source-controls-changed',
});
assert.equal(reset.ok, true);
assert.equal(ring.controlGeneration, 8);
assert.equal(ring.residentCount, 0);
assert.equal(ring.presentationClockStartMs, null);
const staleCompletion = recordCompletedExactState(ring, {
  sourceStep: 15,
  completedAtMs: 1200,
  controlGeneration: 7,
});
assert.equal(staleCompletion.ok, false);
assert.equal(staleCompletion.reason, 'completed-state-control-generation-mismatch');

console.log('exact-state cadence ring contracts passed');
