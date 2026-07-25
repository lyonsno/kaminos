import assert from 'node:assert/strict';

import {
  GATE_B_COLLECTIONS,
  createGateBBatchingState,
  normalizeGateBAdaptiveRange,
  validateGateBCompletion,
  validateGateBRouteIdentity,
} from '../lib/sharp-gate-b-journal.mjs';

const SOURCE_SHA256 = '134136dd4086cfc1b887ab0a134c4a2b906223762a0d5959a8b90cc68f11f4f0';
const WEIGHTS_SHA256 = '98212168b105c4027aff54c635fe01f547974911deb0c1109d8c05df68a01caf';

assert.deepEqual(
  GATE_B_COLLECTIONS.map(collection => collection.id),
  [
    'progress-events',
    'scheduler-events',
    'resource-snapshots',
    'raf-opportunity-snapshots',
    'host-stats',
    'runtime-errors',
  ],
);
for (const collection of GATE_B_COLLECTIONS) {
  assert.equal(collection.liveAppend, true);
  assert.equal(collection.retention, 'uncapped');
  assert.equal(collection.expectedCount, null);
}

const identity = {
  schema: 'kaminos.sharp-gate-b-route-identity.v0',
  requestedRoute: 'sharp-image-to-splat-live-v0',
  effectiveRoute: 'same-browser-product-realm-shared-device',
  source: {
    assetId: 'image-inbox:17_img.png',
    path: '17_img.png',
    sha256: SOURCE_SHA256,
  },
  browser: {
    executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    version: 'Chrome/149.0.7827.114',
    headed: true,
  },
  adapter: {
    vendor: 'apple',
    architecture: 'metal-3',
    deviceLimits: {
      maxBufferSize: 4_294_967_292,
      maxStorageBufferBindingSize: 4_294_967_292,
    },
  },
  model: {
    name: 'SHARP',
    baseRevision: 'b689f485d5d6f6c8868f21ad3d56d17e81cba44a',
    instrumentationRevision: 'instrumentation-revision',
  },
  weights: {
    sha256: WEIGHTS_SHA256,
  },
  kitRuntime: {
    embedded: {
      package: '@kaminos/webgpu-inference-kit',
      version: '0.1.38',
      source: 'sharp-runtime',
    },
    host: {
      package: '@kaminos/webgpu-inference-kit',
      version: '0.1.35',
      source: 'kaminos-runtime',
    },
  },
  scheduler: {
    profileId: 'cooperative-spn-gaussian',
    effective: {
      decoderKernelChunkItems: 262_144,
      decoderKernelMinChunkItems: 65_536,
      decoderKernelMaxChunkItems: 8_388_608,
      decoderKernelTargetDurationMs: 12,
      decoderKernelAdjustmentGain: 0.375,
      waitForSubmittedWorkDone: true,
    },
  },
  presentationIsolation: {
    mode: 'foreground-opportunity-no-render',
    foregroundRafLease: true,
    simulationQuiesced: true,
    raymarchSubmissionQuiesced: true,
  },
  processes: {
    witnessPid: 400,
    browserPid: 401,
    gpuProcessPid: 402,
    rendererPids: [403],
  },
};

assert.deepEqual(validateGateBRouteIdentity(identity), []);
assert.match(
  validateGateBRouteIdentity({
    ...identity,
    source: { ...identity.source, sha256: '0'.repeat(64) },
  }).join('\n'),
  /frozen source hash/,
);
assert.match(
  validateGateBRouteIdentity({
    ...identity,
    scheduler: {
      ...identity.scheduler,
      effective: {
        ...identity.scheduler.effective,
        decoderKernelTargetDurationMs: 8,
      },
    },
  }).join('\n'),
  /stale or substituted adaptive scheduler/,
);
assert.match(
  validateGateBRouteIdentity({
    ...identity,
    kitRuntime: { ...identity.kitRuntime, embedded: null },
  }).join('\n'),
  /embedded kit identity/,
);
assert.match(
  validateGateBRouteIdentity({
    ...identity,
    presentationIsolation: {
      ...identity.presentationIsolation,
      raymarchSubmissionQuiesced: false,
    },
  }).join('\n'),
  /raymarch submission/,
);
assert.match(
  validateGateBRouteIdentity({
    ...identity,
    browser: { ...identity.browser, headed: false },
  }).join('\n'),
  /headed browser/,
);

const adaptiveRange = normalizeGateBAdaptiveRange({
  phase: 'gaussian-phase',
  kind: 'decoder-kernel-range-observed',
  role: 'decoder-kernel-output-tile-observation',
  rangeId: 'sharp:run:gaussian:0:image-encoder:range:3',
  rangeIndex: 3,
  rangeTotal: null,
  rangeCountAuthority: 'terminal-only',
  outputStart: 786_432,
  outputEnd: 1_048_576,
  outputCount: 262_144,
  totalOutputItems: 75_497_472,
  plannedChunkItems: 262_144,
  observedChunkItems: 262_144,
  observedDurationMs: 11.8,
  targetDurationMs: 12,
  requestedAdjustmentGain: 0.375,
  effectiveAdjustmentGain: 0.375,
  fullGainCorrectionRatio: 1.016949,
  effectiveCorrectionRatio: 1.006336,
  rawNextChunkItems: 266_587,
  effectiveRawNextChunkItems: 263_805,
  nextChunkItems: 263_805,
  adjustment: 'increase',
  boundApplication: null,
  bounds: {
    minChunkItems: 65_536,
    maxChunkItems: 8_388_608,
  },
  timingAuthority: 'queue-work-done',
  queueWorkAttribution: 'submitted-range-prefix',
  foregroundServiceStatus: 'served',
  completedItems: 1_048_576,
  progress: 1_048_576 / 75_497_472,
  actualRangeCount: null,
  tMs: 1000,
  epochMs: 2000,
});
assert.equal(adaptiveRange.plannerId, 'sharp:run:gaussian:0:image-encoder');
assert.equal(adaptiveRange.rangeId, 'sharp:run:gaussian:0:image-encoder:range:3');
assert.equal(adaptiveRange.outputEnd - adaptiveRange.outputStart, adaptiveRange.outputCount);
assert.equal(adaptiveRange.retention, 'uncapped');
assert.throws(
  () => normalizeGateBAdaptiveRange({
    ...adaptiveRange,
    timingAuthority: 'browser-yield-only',
  }),
  /queue-work-done/,
);
assert.throws(
  () => normalizeGateBAdaptiveRange({
    ...adaptiveRange,
    outputEnd: adaptiveRange.outputEnd + 1,
  }),
  /discontinuous output range/,
);

const batching = createGateBBatchingState({
  flushIntervalMs: 250,
  collectionCounts: Object.fromEntries(
    GATE_B_COLLECTIONS.map(collection => [
      collection.id,
      { queued: 11, flushed: 8, inFlight: 2 },
    ]),
  ),
  flushOrdinal: 4,
  lastFlushedAt: '2026-07-25T07:30:00.000Z',
});
assert.equal(batching.retention, 'uncapped');
assert.equal(batching.overflowPolicy, 'none-all-rows-retained');
assert.equal(batching.maxRowsPerFlush, null);
assert.equal(batching.collections['scheduler-events'].unflushed, 3);
assert.equal(batching.collections['scheduler-events'].inFlight, 2);
assert.throws(
  () => createGateBBatchingState({
    flushIntervalMs: 250,
    collectionCounts: {
      'scheduler-events': { queued: 7, flushed: 8, inFlight: 0 },
    },
  }),
  /flushed count cannot exceed queued count/,
);

const completeCollections = Object.fromEntries(
  GATE_B_COLLECTIONS.map(collection => [
    collection.id,
    {
      retention: 'uncapped',
      receivedCount: collection.id === 'scheduler-events' ? 29 : 1,
      expectedCount: collection.id === 'scheduler-events' ? 29 : 1,
      partialWrite: false,
    },
  ]),
);
const completeArtifact = {
  path: '/tmp/pipeline-runs/complete/output.ply',
  sha256: 'a'.repeat(64),
  bytes: 66_060_836,
};
assert.deepEqual(validateGateBCompletion({
  status: 'complete',
  routeIdentity: identity,
  collections: completeCollections,
  artifact: completeArtifact,
  browserExit: null,
}), []);
assert.match(
  validateGateBCompletion({
    status: 'complete',
    routeIdentity: identity,
    collections: completeCollections,
    artifact: null,
    browserExit: null,
  }).join('\n'),
  /PLY artifact/,
);
assert.match(
  validateGateBCompletion({
    status: 'complete',
    routeIdentity: identity,
    collections: {
      ...completeCollections,
      'scheduler-events': {
        ...completeCollections['scheduler-events'],
        expectedCount: 30,
        partialWrite: true,
      },
    },
    artifact: completeArtifact,
    browserExit: null,
  }).join('\n'),
  /partial scheduler-events collection/,
);
assert.match(
  validateGateBCompletion({
    status: 'complete',
    routeIdentity: identity,
    collections: completeCollections,
    artifact: completeArtifact,
    browserExit: {
      kind: 'renderer-exit',
      exitCode: 9,
      beforePrimaryOutput: true,
    },
  }).join('\n'),
  /renderer exited before primary output/,
);

console.log('SHARP Gate B journal contracts passed');
