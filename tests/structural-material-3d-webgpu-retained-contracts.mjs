import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildLayeredStructuralWitnessScenario,
  createLayeredStructuralMaterial,
} from '../structural-material-3d-core.js';

const root = new URL('..', import.meta.url).pathname;
const retainedCorePath = join(root, 'structural-material-3d-webgpu-retained.js');
const retainedWitnessPath = join(root, 'structural-material-3d-webgpu-retained-witness.mjs');
const pagePath = join(root, 'structural-material-3d.html');

assert.ok(existsSync(retainedCorePath), 'retained WebGPU structural sidecar core exists');
assert.ok(existsSync(retainedWitnessPath), 'retained WebGPU sidecar has a reusable browser witness');

const {
  STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
  buildLayeredStructuralCpuSequenceOracle,
  compareLayeredStructuralRetainedGpuParity,
  layeredStructuralInteractionSequenceIdentity,
  layeredStructuralRetainedCleanupMatches,
  runLayeredStructuralRetainedWebGpuParity,
} = await import('../structural-material-3d-webgpu-retained.js');

const retainedSource = readFileSync(retainedCorePath, 'utf8');
const witnessSource = readFileSync(retainedWitnessPath, 'utf8');
const pageSource = readFileSync(pagePath, 'utf8');

assert.equal(
  STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
  'kaminos.structural-material.webgpu-retained-bond-sequence.v0',
);
assert.match(retainedSource, /intermediateReadbackCount/, 'retained receipt exposes intermediate readback count');
assert.match(retainedSource, /validationReadbackCount/, 'retained receipt exposes terminal validation readback count');
assert.match(retainedSource, /pipelineCreateCount/, 'retained receipt exposes pipeline creation count');
assert.match(retainedSource, /interactionUploadCount/, 'retained receipt exposes compact interaction upload count');
assert.match(retainedSource, /eventEpoch/, 'retained event comparison carries the causing interaction epoch');
assert.match(witnessSource, /effectiveSequenceIdentity/, 'browser witness preserves effective interaction-sequence identity');
assert.match(witnessSource, /failurePhase/, 'browser witness preserves failure phase');
assert.match(witnessSource, /noIntermediateReadback/, 'browser witness rejects intermediate GPU readback');
assert.match(witnessSource, /allBuffersDestroyed/, 'browser witness rejects incomplete buffer destruction');
assert.match(witnessSource, /deviceDestroyed/, 'browser witness rejects incomplete device destruction');
assert.match(pageSource, /__structuralMaterial3dRunGpuRetainedParity/, '3D route exposes retained WebGPU execution');
assert.equal(
  typeof layeredStructuralRetainedCleanupMatches,
  'function',
  'retained WebGPU sidecar exposes a post-cleanup acceptance gate',
);

const completeCleanupLifecycle = {
  adapterRequestCount: 1,
  deviceRequestCount: 1,
  pipelineCreateCount: 1,
  validationReadbackCount: 1,
  mappedBufferCount: 4,
  bufferAllocationCount: 10,
  bufferDestroyCount: 10,
  bufferDestroyErrorCount: 0,
  deviceDestroyCount: 1,
  deviceDestroyErrorCount: 0,
};
assert.equal(
  layeredStructuralRetainedCleanupMatches(completeCleanupLifecycle),
  true,
  'complete terminal readback and resource destruction satisfy cleanup',
);
assert.equal(
  layeredStructuralRetainedCleanupMatches({
    ...completeCleanupLifecycle,
    bufferDestroyCount: completeCleanupLifecycle.bufferDestroyCount - 1,
  }),
  false,
  'one undestroyed buffer invalidates cleanup',
);
assert.equal(
  layeredStructuralRetainedCleanupMatches({
    ...completeCleanupLifecycle,
    deviceDestroyCount: 0,
  }),
  false,
  'an undestroyed device invalidates cleanup',
);

const scenario = buildLayeredStructuralWitnessScenario();
const state = createLayeredStructuralMaterial({ columns: 9, rows: 5, layers: 4, notch: true });
const interactions = [
  {
    kind: 'sub-threshold-contact',
    point: { x: 0.7, y: 0.35, z: 0.5 },
    vector: { x: 0.9, y: 0.1, z: 0.2 },
    magnitude: 0.2,
    radius: 0.2,
  },
  scenario.force,
  scenario.force,
  {
    ...scenario.force,
    kind: 'shifted-depth-shear',
    point: { x: 0.78, y: 0.62, z: 0.28 },
    vector: { x: 0.68, y: -0.18, z: -0.71 },
    magnitude: 1.72,
    radius: 0.24,
  },
];
const requestedSequenceIdentity = layeredStructuralInteractionSequenceIdentity(interactions);
const changedSequenceIdentity = layeredStructuralInteractionSequenceIdentity([
  ...interactions.slice(0, -1),
  { ...interactions.at(-1), magnitude: 1.71 },
]);
assert.notEqual(requestedSequenceIdentity, changedSequenceIdentity, 'sequence identity changes with effective force input');
const gestureOneIdentity = layeredStructuralInteractionSequenceIdentity([{
  ...scenario.force,
  gestureId: 'gesture-one',
  dragLength: 0.18,
  contactIdentity: { authority: 'stable-rest-material-contact-v0', kind: 'node', id: 'n17' },
}]);
const gestureTwoIdentity = layeredStructuralInteractionSequenceIdentity([{
  ...scenario.force,
  gestureId: 'gesture-two',
  dragLength: 0.18,
  contactIdentity: { authority: 'stable-rest-material-contact-v0', kind: 'node', id: 'n17' },
}]);
const extendedGestureIdentity = layeredStructuralInteractionSequenceIdentity([{
  ...scenario.force,
  gestureId: 'gesture-one',
  dragLength: 0.24,
  contactIdentity: { authority: 'stable-rest-material-contact-v0', kind: 'node', id: 'n17' },
}]);
assert.notEqual(
  gestureOneIdentity,
  gestureTwoIdentity,
  'a new gesture cannot alias an exact replay from a prior retained-state generation',
);
assert.notEqual(
  gestureOneIdentity,
  extendedGestureIdentity,
  'solver travel participates in replay identity even when the legacy force envelope is unchanged',
);

const oracle = buildLayeredStructuralCpuSequenceOracle(state, interactions);
assert.equal(oracle.interactionCount, interactions.length);
assert.equal(oracle.sequenceIdentity, requestedSequenceIdentity);
assert.equal(oracle.eventCandidates.some(event => event.eventEpoch === 1), false, 'sub-threshold epoch emits no crack');
assert.ok(oracle.eventCandidates.some(event => event.eventEpoch === 2), 'first strong epoch emits cracks');
assert.equal(
  new Set(oracle.eventCandidates.map(event => event.bondIndex)).size,
  oracle.eventCandidates.length,
  'persistent CPU oracle emits each fractured bond once',
);

const exactGpuResult = {
  requestedSequenceIdentity,
  effectiveSequenceIdentity: requestedSequenceIdentity,
  lifecycle: {
    adapterRequestCount: 1,
    deviceRequestCount: 1,
    pipelineCreateCount: 1,
    interactionUploadCount: interactions.length,
    dispatchCount: interactions.length,
    dispatchSubmissionCount: interactions.length,
    intermediateReadbackCount: 0,
    validationReadbackCount: 1,
    readbackSubmissionCount: 1,
  },
  responses: oracle.responses.map(response => ({ ...response })),
  eventCandidates: oracle.eventCandidates.map(event => ({ ...event, midpoint: { ...event.midpoint } })),
  finalBondLiveness: [...oracle.finalBondLiveness],
  eventCount: oracle.eventCandidates.length,
  eventOverflowCount: 0,
};
const exactParity = compareLayeredStructuralRetainedGpuParity(oracle, exactGpuResult);
assert.equal(exactParity.ok, true, 'exact retained GPU-shaped sequence satisfies CPU oracle');
assert.equal(exactParity.lifecycleMatches, true);
assert.equal(exactParity.sequenceIdentityMatches, true);
assert.equal(exactParity.eventEpochsMatch, true);
assert.equal(exactParity.noDuplicateEvents, true);

const recreatedPipeline = {
  ...exactGpuResult,
  lifecycle: { ...exactGpuResult.lifecycle, pipelineCreateCount: 2 },
};
assert.equal(
  compareLayeredStructuralRetainedGpuParity(oracle, recreatedPipeline).ok,
  false,
  'pipeline recreation cannot masquerade as retained execution',
);

const intermediateReadback = {
  ...exactGpuResult,
  lifecycle: { ...exactGpuResult.lifecycle, intermediateReadbackCount: 1, validationReadbackCount: 2 },
};
assert.equal(
  compareLayeredStructuralRetainedGpuParity(oracle, intermediateReadback).ok,
  false,
  'intermediate readback cannot satisfy retained execution',
);

const substitutedSequence = {
  ...exactGpuResult,
  effectiveSequenceIdentity: changedSequenceIdentity,
};
assert.equal(
  compareLayeredStructuralRetainedGpuParity(oracle, substitutedSequence).ok,
  false,
  'stale or substituted interaction sequence cannot pass',
);

const wrongEpoch = {
  ...exactGpuResult,
  eventCandidates: exactGpuResult.eventCandidates.map((event, index) => index === 0
    ? { ...event, eventEpoch: event.eventEpoch + 1 }
    : event),
};
assert.equal(
  compareLayeredStructuralRetainedGpuParity(oracle, wrongEpoch).ok,
  false,
  'matching event IDs cannot hide the wrong causing epoch',
);

const duplicateEvent = {
  ...exactGpuResult,
  eventCandidates: [...exactGpuResult.eventCandidates, { ...exactGpuResult.eventCandidates[0] }],
  eventCount: exactGpuResult.eventCount + 1,
};
assert.equal(
  compareLayeredStructuralRetainedGpuParity(oracle, duplicateEvent).ok,
  false,
  'an already-dead bond cannot emit a second fracture event',
);

const resetLiveness = {
  ...exactGpuResult,
  finalBondLiveness: exactGpuResult.finalBondLiveness.map(() => true),
};
assert.equal(
  compareLayeredStructuralRetainedGpuParity(oracle, resetLiveness).ok,
  false,
  'state reset between epochs cannot pass final liveness parity',
);

const unavailable = await runLayeredStructuralRetainedWebGpuParity({ state, interactions, gpu: null });
assert.equal(unavailable.status, 'failed', 'missing WebGPU cannot produce a retained passing receipt');
assert.equal(unavailable.failurePhase, 'gpu-availability');
assert.equal(unavailable.effectiveRoute, null);
assert.equal(unavailable.effectiveBackend, null);
assert.equal(unavailable.cpuFallbackUsed, false);
