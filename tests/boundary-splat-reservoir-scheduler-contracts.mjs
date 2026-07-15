#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as volumeCore from '../volume-core.js';

const planReservoirClock = volumeCore.boundarySplatReservoirClockPlan;
const decideReservoirAuthority = volumeCore.boundarySplatReservoirAuthorityDecision;
const sourceControlSignature = volumeCore.boundarySplatReservoirSourceControlSignature;
const primitiveAuthoritySignature = volumeCore.boundarySplatPrimitiveAuthoritySignature;
const scalarActivityCueAuthoritySignature = volumeCore.boundarySplatScalarActivityCueAuthoritySignature;
const proveArchiveBurst = volumeCore.boundarySplatReservoirArchiveProof;
const decideArchive = volumeCore.boundarySplatHistoryArchiveDecision;

assert.equal(
  typeof planReservoirClock,
  'function',
  'truthful reservoir scheduling must expose a deterministic four-clock plan before runtime wiring',
);
assert.equal(
  typeof decideReservoirAuthority,
  'function',
  'truthful reservoir scheduling must decide source-authority invalidation independently of camera presentation state',
);
assert.equal(typeof sourceControlSignature, 'function', 'reservoir authority must have a source-only control signature');
assert.equal(typeof primitiveAuthoritySignature, 'function', 'primitive invalidation must compare normalized source authority');
assert.equal(typeof scalarActivityCueAuthoritySignature, 'function', 'external scalar activity must participate in source authority');
assert.equal(typeof proveArchiveBurst, 'function', 'archive burst success must be decided from completed GPU slot evidence');

const sourceControls = {
  volumeScene: 'tall_plume',
  speed: 3.4,
  projection: 1.5,
  inputRadius: 0.55,
  flowRate: 1.7,
  pressureStrategy: 'global',
  pressureIterations: 2,
  shellInspectMode: 'boundary_fire',
  reactionBoundaryControls: {
    gradientGain: 1.8,
    supportThermal: 2,
    displayContrast: 1.2,
    displayGamma: 0.9,
    displayOpacity: 1.1,
  },
  reactionBoundaryFireControls: {
    ridgeGain: 1.76,
  },
  boundarySidecarControls: {
    blur: 0.2,
    stepWidth: 0.75,
    ridgeGain: 0.52,
    view: 'support',
  },
  renderScale: 1,
  raySteps: 24,
  gridOverlay: 0,
  flowDebug: 0,
};
assert.equal(
  sourceControlSignature(sourceControls),
  sourceControlSignature({ ...sourceControls, renderScale: 0.1, raySteps: 8, gridOverlay: 1, flowDebug: 1 }),
  'presentation and debug controls must not impersonate source-authority changes',
);
assert.notEqual(
  sourceControlSignature(sourceControls),
  sourceControlSignature({ ...sourceControls, speed: 3.8 }),
  'simulator controls must advance source authority',
);
assert.notEqual(
  sourceControlSignature(sourceControls),
  sourceControlSignature({
    ...sourceControls,
    reactionBoundaryControls: {
      ...sourceControls.reactionBoundaryControls,
      supportThermal: 1.7,
    },
  }),
  'nested boundary controls that feed candidate uniforms must advance source authority',
);
assert.notEqual(
  sourceControlSignature(sourceControls),
  sourceControlSignature({
    ...sourceControls,
    reactionBoundaryFireControls: {
      ...sourceControls.reactionBoundaryFireControls,
      ridgeGain: 1.4,
    },
  }),
  'nested boundary-fire controls that feed candidate uniforms must advance source authority',
);
assert.equal(
  sourceControlSignature(sourceControls),
  sourceControlSignature({
    ...sourceControls,
    reactionBoundaryControls: {
      ...sourceControls.reactionBoundaryControls,
      displayContrast: 4,
      displayGamma: 2.5,
      displayOpacity: 0.1,
    },
    boundarySidecarControls: {
      ...sourceControls.boundarySidecarControls,
      stepWidth: 1.5,
      view: 'ridge',
    },
  }),
  'nested presentation and debug controls must not churn world-space reservoir authority',
);

const primitiveSource = [{
  id: 'fire-source',
  transform: { position: [0, -0.74, 0], rotation: [0, 0, 0], scale: [0.55, 0.55, 0.55] },
  simulation: { sourceRadius: 0.55, flowRate: 1.7 },
}];
assert.equal(
  primitiveAuthoritySignature(primitiveSource),
  primitiveAuthoritySignature(structuredClone(primitiveSource)),
  're-sending an identical primitive payload must preserve reservoir authority',
);
assert.notEqual(
  primitiveAuthoritySignature(primitiveSource),
  primitiveAuthoritySignature([{ ...primitiveSource[0], transform: { ...primitiveSource[0].transform, position: [0.1, -0.74, 0] } }]),
  'moving the active primitive source must invalidate buffered future states',
);

assert.equal(
  scalarActivityCueAuthoritySignature({ grid: 2, values: new Float32Array([0, 0.25, 0.5, 1]) }),
  scalarActivityCueAuthoritySignature({ grid: 2, values: new Float32Array([0, 0.25, 0.5, 1]) }),
  'identical scalar activity uploads must preserve reservoir authority',
);
assert.notEqual(
  scalarActivityCueAuthoritySignature({ grid: 2, values: new Float32Array([0, 0.25, 0.5, 1]) }),
  scalarActivityCueAuthoritySignature({ grid: 2, values: new Float32Array([0, 0.25, 0.75, 1]) }),
  'a changed scalar activity field must invalidate buffered future states',
);

const separatedClocks = planReservoirClock({
  enabled: true,
  nowMs: 1_000,
  lastBurstMs: 900,
  lastPresentationMs: 992,
  lastSelectionMs: 960,
  integrationStepMs: 8,
  burstIntervalMs: 80,
  presentationIntervalMs: 16,
  selectionIntervalMs: 32,
  historyFrameStride: 1,
  reservoirDepth: 64,
  requestedLeadStates: 12,
  bufferedStateCount: 5,
  sourceAuthorityGeneration: 7,
  reservoirAuthorityGeneration: 7,
});
assert.deepEqual(separatedClocks, {
  identity: 'boundary-splat-truthful-reservoir-clock-plan-v0',
  ok: true,
  enabled: true,
  refusalReasons: [],
  integrationStepMs: 8,
  burstDue: true,
  presentationDue: false,
  selectionDue: true,
  integrationSubsteps: 7,
  expectedArchiveStates: 7,
  present: false,
  advanceSelection: false,
  consumeStates: 0,
  bufferedStateCount: 5,
  nextBufferedStateCount: 12,
  requestedLeadStates: 12,
  maximumLeadStates: 63,
  invalidate: false,
  invalidationReason: null,
  exhausted: false,
}, 'burst fill must use ordinary fixed substeps without coupling presentation or selection cadence');

const presentationOnly = planReservoirClock({
  enabled: true,
  nowMs: 1_016,
  lastBurstMs: 1_000,
  lastPresentationMs: 992,
  lastSelectionMs: 960,
  integrationStepMs: 8,
  burstIntervalMs: 80,
  presentationIntervalMs: 16,
  selectionIntervalMs: 32,
  historyFrameStride: 1,
  reservoirDepth: 64,
  requestedLeadStates: 12,
  bufferedStateCount: 12,
  sourceAuthorityGeneration: 7,
  reservoirAuthorityGeneration: 7,
});
assert.equal(presentationOnly.integrationSubsteps, 0, 'presentation must not imply simulation progress');
assert.equal(presentationOnly.present, true);
assert.equal(presentationOnly.advanceSelection, true);
assert.equal(presentationOnly.consumeStates, 1);
assert.equal(presentationOnly.nextBufferedStateCount, 11);

const repeatCurrentSelection = planReservoirClock({
  enabled: true,
  nowMs: 1_016,
  lastBurstMs: 1_000,
  lastPresentationMs: 992,
  lastSelectionMs: 1_008,
  integrationStepMs: 8,
  burstIntervalMs: 80,
  presentationIntervalMs: 16,
  selectionIntervalMs: 32,
  historyFrameStride: 1,
  reservoirDepth: 64,
  requestedLeadStates: 12,
  bufferedStateCount: 12,
  sourceAuthorityGeneration: 7,
  reservoirAuthorityGeneration: 7,
});
assert.equal(repeatCurrentSelection.present, true);
assert.equal(repeatCurrentSelection.advanceSelection, false, 'presentation cadence may redraw one truthful slot without consuming another state');
assert.equal(repeatCurrentSelection.nextBufferedStateCount, 12);

const staleAuthority = planReservoirClock({
  enabled: true,
  nowMs: 1_000,
  lastBurstMs: 0,
  lastPresentationMs: 0,
  lastSelectionMs: 0,
  integrationStepMs: 8,
  burstIntervalMs: 80,
  presentationIntervalMs: 16,
  selectionIntervalMs: 32,
  historyFrameStride: 1,
  reservoirDepth: 64,
  requestedLeadStates: 12,
  bufferedStateCount: 12,
  sourceAuthorityGeneration: 8,
  reservoirAuthorityGeneration: 7,
});
assert.equal(staleAuthority.invalidate, true);
assert.equal(staleAuthority.invalidationReason, 'source-authority-generation-mismatch');
assert.equal(staleAuthority.integrationSubsteps, 0);
assert.equal(staleAuthority.present, false, 'stale buffered states must never masquerade as current live authority');
assert.equal(staleAuthority.nextBufferedStateCount, 0);

const impossibleLead = planReservoirClock({
  enabled: true,
  nowMs: 1_000,
  lastBurstMs: 0,
  lastPresentationMs: 0,
  lastSelectionMs: 0,
  integrationStepMs: 8,
  burstIntervalMs: 80,
  presentationIntervalMs: 16,
  selectionIntervalMs: 32,
  historyFrameStride: 1,
  reservoirDepth: 64,
  requestedLeadStates: 64,
  bufferedStateCount: 0,
  sourceAuthorityGeneration: 7,
  reservoirAuthorityGeneration: 7,
});
assert.equal(impossibleLead.ok, false);
assert.deepEqual(impossibleLead.refusalReasons, ['requested-lead-exceeds-reservoir-depth']);
assert.equal(impossibleLead.integrationSubsteps, 0, 'physical depth pressure must fail loud rather than silently clamp the requested lead');

const stridedArchive = planReservoirClock({
  enabled: true,
  nowMs: 1_000,
  lastBurstMs: 900,
  lastPresentationMs: 992,
  lastSelectionMs: 960,
  integrationStepMs: 8,
  burstIntervalMs: 80,
  presentationIntervalMs: 16,
  selectionIntervalMs: 32,
  historyFrameStride: 8,
  reservoirDepth: 64,
  requestedLeadStates: 12,
  bufferedStateCount: 9,
  sourceCandidateGeneration: 19,
  sourceAuthorityGeneration: 7,
  reservoirAuthorityGeneration: 7,
});
assert.equal(stridedArchive.expectedArchiveStates, 3);
assert.equal(stridedArchive.integrationSubsteps, 22, 'archive fill must advance exactly to three new stride-separated write ticks');

let lastArchivedGeneration = 19;
const liveStridedDecisions = [];
for (let sourceCandidateGeneration = 20; sourceCandidateGeneration <= 41; sourceCandidateGeneration += 1) {
  const decision = decideArchive({
    allocationGeneration: 11,
    sourceCandidateGeneration,
    sourceSimStepCount: sourceCandidateGeneration,
    lastArchivedAllocationGeneration: 11,
    lastArchivedSourceCandidateGeneration: lastArchivedGeneration,
    historyFrameStride: 8,
    historyDepth: 64,
    holdover: false,
  });
  liveStridedDecisions.push({ sourceCandidateGeneration, ...decision });
  if (decision.archive) lastArchivedGeneration = sourceCandidateGeneration;
}
assert.deepEqual(
  liveStridedDecisions.filter(decision => decision.archive).map(decision => decision.sourceCandidateGeneration),
  [25, 33, 41],
  'a live strided burst must submit exactly one archive write per newly entered write tick',
);
assert.deepEqual(
  liveStridedDecisions.filter(decision => decision.archive).map(decision => decision.writeTick),
  [3, 4, 5],
  'the burst must never overwrite its current pre-burst write tick or repeatedly overwrite an entered tick',
);

assert.deepEqual(decideReservoirAuthority({
  previousSourceControlSignature: 'source-a',
  nextSourceControlSignature: 'source-a',
  previousEmitterSignature: 'emitters-a',
  nextEmitterSignature: 'emitters-a',
  previousPrimitiveSignature: 'primitives-a',
  nextPrimitiveSignature: 'primitives-a',
  previousCameraSignature: 'camera-a',
  nextCameraSignature: 'camera-b',
}), {
  invalidate: false,
  reason: null,
}, 'camera movement must not invalidate world-space candidate history');

for (const [field, reason] of [
  ['nextSourceControlSignature', 'source-control-change'],
  ['nextEmitterSignature', 'external-emitter-change'],
  ['nextPrimitiveSignature', 'volume-primitive-change'],
]) {
  const decision = decideReservoirAuthority({
    previousSourceControlSignature: 'source-a',
    nextSourceControlSignature: 'source-a',
    previousEmitterSignature: 'emitters-a',
    nextEmitterSignature: 'emitters-a',
    previousPrimitiveSignature: 'primitives-a',
    nextPrimitiveSignature: 'primitives-a',
    [field]: 'changed',
  });
  assert.deepEqual(decision, { invalidate: true, reason });
}

const archiveMetadata = {
  identity: 'boundary-splat-history-slot-metadata-readback-v0',
  ok: true,
  authority: 'gpu-archive-slot-metadata-post-queue-completion-readback-v0',
  historyAllocationGeneration: 11,
  slots: [
    { slotIndex: 3, initialized: true, writeSubmissionCompleted: true, historyAllocationGeneration: 11, archiveWriteSequence: 4, sourceCandidateGeneration: 25 },
    { slotIndex: 4, initialized: true, writeSubmissionCompleted: true, historyAllocationGeneration: 11, archiveWriteSequence: 12, sourceCandidateGeneration: 33 },
    { slotIndex: 5, initialized: true, writeSubmissionCompleted: true, historyAllocationGeneration: 11, archiveWriteSequence: 20, sourceCandidateGeneration: 41 },
  ],
};
const archiveDecisions = [
  { archive: true, writeTick: 2, writeSlot: 2, historyAllocationGeneration: 11, archiveWriteSequence: 3, sourceCandidateGeneration: 24 },
  { archive: true, writeTick: 3, writeSlot: 3, historyAllocationGeneration: 11, archiveWriteSequence: 4, sourceCandidateGeneration: 25 },
  { archive: true, writeTick: 4, writeSlot: 4, historyAllocationGeneration: 11, archiveWriteSequence: 12, sourceCandidateGeneration: 33 },
  { archive: true, writeTick: 5, writeSlot: 5, historyAllocationGeneration: 11, archiveWriteSequence: 20, sourceCandidateGeneration: 41 },
];
assert.deepEqual(proveArchiveBurst({
  metadata: archiveMetadata,
  historyAllocationGeneration: 11,
  sourceCandidateGenerationBefore: 19,
  historyFrameStride: 8,
  archiveDecisions,
  expectedArchiveStates: 3,
  requestedIntegrationSubsteps: 22,
  submittedIntegrationSubsteps: 22,
}), {
  identity: 'boundary-splat-truthful-reservoir-archive-proof-v0',
  ok: true,
  reasons: [],
  expectedArchiveStates: 3,
  observedDistinctArchiveStates: 3,
  provenArchiveStates: 3,
}, 'current-generation slot metadata must prove every requested distinct archive state');

const staleArchiveProof = proveArchiveBurst({
  metadata: {
    ...archiveMetadata,
    slots: archiveMetadata.slots.map((slot, index) => index === 1
      ? { ...slot, historyAllocationGeneration: 10 }
      : slot),
  },
  historyAllocationGeneration: 11,
  sourceCandidateGenerationBefore: 19,
  historyFrameStride: 8,
  archiveDecisions,
  expectedArchiveStates: 3,
  requestedIntegrationSubsteps: 22,
  submittedIntegrationSubsteps: 22,
});
assert.equal(staleArchiveProof.ok, false);
assert.deepEqual(staleArchiveProof.reasons, ['gpu-metadata-does-not-prove-requested-archives']);

const staleDecisionProof = proveArchiveBurst({
  metadata: archiveMetadata,
  historyAllocationGeneration: 11,
  sourceCandidateGenerationBefore: 19,
  historyFrameStride: 8,
  archiveDecisions: archiveDecisions.map(decision => decision.writeTick === 4
    ? { ...decision, historyAllocationGeneration: 10 }
    : decision),
  expectedArchiveStates: 3,
  requestedIntegrationSubsteps: 22,
  submittedIntegrationSubsteps: 22,
});
assert.equal(staleDecisionProof.ok, false, 'CPU decisions from a stale allocation must not be proven by coincidentally matching GPU slots');
assert.deepEqual(staleDecisionProof.reasons, ['archive-decision-allocation-generation-mismatch']);

const unauthenticatedArchiveProof = proveArchiveBurst({
  metadata: {
    ...archiveMetadata,
    authority: 'cpu-projected-slot-metadata-v0',
  },
  historyAllocationGeneration: 11,
  sourceCandidateGenerationBefore: 19,
  historyFrameStride: 8,
  archiveDecisions,
  expectedArchiveStates: 3,
  requestedIntegrationSubsteps: 22,
  submittedIntegrationSubsteps: 22,
});
assert.equal(unauthenticatedArchiveProof.ok, false, 'matching slot shapes must not substitute for authenticated GPU readback authority');
assert.deepEqual(unauthenticatedArchiveProof.reasons, ['gpu-metadata-authority-unverified']);

const mismatchedMetadataGenerationProof = proveArchiveBurst({
  metadata: {
    ...archiveMetadata,
    historyAllocationGeneration: 10,
  },
  historyAllocationGeneration: 11,
  sourceCandidateGenerationBefore: 19,
  historyFrameStride: 8,
  archiveDecisions,
  expectedArchiveStates: 3,
  requestedIntegrationSubsteps: 22,
  submittedIntegrationSubsteps: 22,
});
assert.equal(mismatchedMetadataGenerationProof.ok, false, 'the readback envelope must bind the same physical history allocation as the proof');
assert.deepEqual(mismatchedMetadataGenerationProof.reasons, ['gpu-metadata-allocation-generation-mismatch']);

const coreSource = readFileSync(new URL('../volume-core.js', import.meta.url), 'utf8');
assert.match(
  coreSource,
  /function encodeBoundarySplatReservoirArchiveSubstep[\s\S]*encodeSim\(encoder\)[\s\S]*encodeBoundarySidecar\(encoder\)[\s\S]*encodeBoundarySplats\(encoder/,
  'each burst substep must advance the ordinary simulator and archive its own freshly baked candidate generation',
);
assert.doesNotMatch(
  coreSource.match(/function encodeBoundarySplatReservoirArchiveSubstep[\s\S]*?\n  function /)?.[0] || '',
  /encodeBoundarySplatDraw|encodeBoundarySplatPbrScene|context\.getCurrentTexture/,
  'archive-only burst work must not spend presentation raster or acquire a swapchain texture',
);
assert.match(
  coreSource,
  /function invalidateBoundarySplatReservoir[\s\S]*boundarySplatValidatedHistorySelection = null[\s\S]*historyAllocationGeneration/,
  'source mutations must clear validated selection and advance physical history authority',
);
assert.match(
  coreSource.match(/setExternalEmitters\(payload = \{\}\)[\s\S]*?\n    \},/)?.[0] || '',
  /invalidateBoundarySplatReservoir\('external-emitter-change'\)/,
  'external emitter changes must invalidate buffered future states immediately',
);
assert.match(
  coreSource.match(/setControls\(next\)[\s\S]*?\n    \},/)?.[0] || '',
  /boundarySplatReservoirSourceControlSignature[\s\S]*invalidateBoundarySplatReservoir\('source-control-change'\)/,
  'runtime control invalidation must use the source-only signature rather than temporal presentation authority',
);
assert.match(
  coreSource.match(/setVolumePrimitives\(next\)[\s\S]*?\n    \},/)?.[0] || '',
  /boundarySplatPrimitiveAuthoritySignature[\s\S]*previousPrimitiveSignature !== nextPrimitiveSignature[\s\S]*invalidateBoundarySplatReservoir\('volume-primitive-change'\)/,
  'identical primitive updates must not churn reservoir authority',
);
assert.match(
  coreSource.match(/setTruthOracleActivityCue\(payload = \{\}\)[\s\S]*?\n    \},/)?.[0] || '',
  /boundarySplatScalarActivityCueAuthoritySignature[\s\S]*previousCueSignature !== nextCueSignature[\s\S]*invalidateBoundarySplatReservoir\('scalar-activity-cue-change'\)/,
  'truth-oracle scalar activity changes must invalidate buffered future states without churning identical uploads',
);
assert.match(
  coreSource.match(/function ensureBoundarySplatBuffers[\s\S]*?\n  function /)?.[0] || '',
  /boundarySplatHistoryAllocation = nextBoundarySplatHistoryAllocation[\s\S]*state\.boundarySplatReservoirAuthorityGeneration = boundarySplatHistoryAllocation\.generation/,
  'initial GPU allocation must synchronize exposed reservoir authority generation',
);
assert.match(
  coreSource.match(/function growBoundarySplatCapacity[\s\S]*?\n  function /)?.[0] || '',
  /boundarySplatHistoryAllocation = nextBoundarySplatHistoryAllocation[\s\S]*state\.boundarySplatReservoirAuthorityGeneration = boundarySplatHistoryAllocation\.generation/,
  'candidate-capacity replacement must synchronize exposed reservoir authority generation',
);
assert.match(
  coreSource,
  /async function runBoundarySplatReservoirArchiveBurst[\s\S]*for \(let substepIndex = 0; substepIndex < integrationSubsteps; substepIndex \+= 1\)[\s\S]*device\.createCommandEncoder[\s\S]*encodeBoundarySplatReservoirArchiveSubstep\(encoder\)[\s\S]*device\.queue\.submit\(\[encoder\.finish\(\)\]\)/,
  'the bounded burst socket must submit every ordinary substep separately so archive-control writes retain per-state authority',
);
assert.match(
  coreSource.match(/async function runBoundarySplatReservoirArchiveBurst[\s\S]*?\n  function /)?.[0] || '',
  /boundarySplatReservoirArchiveProof[\s\S]*ok: archiveProof\.ok[\s\S]*reason: archiveProof\.ok === true \? null : archiveProof\.reasons\[0\]/,
  'burst authority must come from explicit current-generation archive proof, not metadata readability alone',
);
assert.doesNotMatch(
  coreSource.match(/async function runBoundarySplatReservoirArchiveBurst[\s\S]*?\n  function /)?.[0] || '',
  /context\.getCurrentTexture|encodeBoundarySplatDraw|encodeBoundarySplatPbrScene/,
  'the burst socket must not acquire or raster a presentation target',
);
assert.match(
  coreSource.match(/return \{[\s\S]*setControls\(next\)[\s\S]*?\n  \};/)?.[0] || '',
  /runBoundarySplatReservoirArchiveBurst/,
  'the prototype API must expose the bounded truthful archive burst for matched witnesses',
);

console.log('boundary splat truthful reservoir scheduler contracts passed');
