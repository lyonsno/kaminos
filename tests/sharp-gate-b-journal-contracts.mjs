import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  GATE_B_COLLECTIONS,
  appendGateBSchedulerTelemetry,
  bindGateBSourceBlobIdentity,
  createGateBBatchingState,
  gateBSourceAssetId,
  normalizeGateBAdaptiveRange,
  validateGateBCompletion,
  validateGateBRouteIdentity,
} from '../lib/sharp-gate-b-journal.mjs';
import { startSharpInlineLiveTelemetrySession } from '../lib/sharp-inline-trace-transport.mjs';
import { createSharpSameDeviceKilnOpportunityHook } from '../lib/sharp-same-device-kiln-interlock.mjs';

const SOURCE_SHA256 = '134136dd4086cfc1b887ab0a134c4a2b906223762a0d5959a8b90cc68f11f4f0';
const WEIGHTS_SHA256 = '98212168b105c4027aff54c635fe01f547974911deb0c1109d8c05df68a01caf';
const MODULE_SHA256 = 'c'.repeat(64);

const indexedSourceBytes = new TextEncoder().encode('indexed-source-bytes');
const indexedSourceHash = createHash('sha256').update(indexedSourceBytes).digest('hex');
const boundSource = await bindGateBSourceBlobIdentity(
  {
    assetId: 'image-inbox:17_img.png',
    source: '/api/read?root=image-inbox&path=17_img.png',
    sha256: indexedSourceHash,
  },
  new Blob([indexedSourceBytes]),
);
assert.equal(boundSource.sha256, indexedSourceHash);
await assert.rejects(
  bindGateBSourceBlobIdentity(
    {
      assetId: 'image-inbox:17_img.png',
      source: '/api/read?root=image-inbox&path=17_img.png',
      sha256: indexedSourceHash,
    },
    new Blob(['replacement-source-bytes']),
  ),
  /fetched source SHA-256.*registered asset SHA-256/i,
);
assert.equal(gateBSourceAssetId({ assetId: 'image-inbox:17_img.png' }), 'image-inbox:17_img.png');
assert.equal(gateBSourceAssetId({ id: 'legacy-image-id' }), 'legacy-image-id');

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
    instrumentationBundle: {
      expectedSha256: MODULE_SHA256,
      effectiveSha256: MODULE_SHA256,
      identityStatus: 'matched',
    },
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
    model: {
      ...identity.model,
      instrumentationBundle: {
        ...identity.model.instrumentationBundle,
        effectiveSha256: 'd'.repeat(64),
        identityStatus: 'mismatch',
      },
    },
  }).join('\n'),
  /generated SHARP bundle/,
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
  // webgpu-inference-kit 0.1.38 emits `${plannerId}:${rangeIndex}`.
  rangeId: 'sharp:run:gaussian:0:image-encoder:3',
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
assert.equal(adaptiveRange.rangeId, 'sharp:run:gaussian:0:image-encoder:3');
assert.equal(adaptiveRange.outputEnd - adaptiveRange.outputStart, adaptiveRange.outputCount);
assert.equal(adaptiveRange.retention, 'uncapped');

const effectiveEmbeddedKitAdaptiveEvent = {
  phase: 'project-feature',
  boundary: 'monodepth-phase',
  kind: 'decoder-kernel-range-observed',
  index: 1,
  inC: 256,
  outC: 256,
  H: 384,
  W: 384,
  role: 'decoder-kernel-output-tile-observation',
  rangeId: 'sharp:sharp-webgpu-live:monodepth:0:project-feature:0',
  rangeIndex: 0,
  rangeTotal: null,
  rangeCountAuthority: 'open-until-completion',
  outputStart: 0,
  outputEnd: 262_144,
  outputCount: 262_144,
  totalOutputItems: 37_748_736,
  timingAuthority: 'queue-work-done',
  queueWorkAttribution: 'submitted-range-prefix',
  foregroundServiceStatus: 'serviced',
  requestedAdjustmentGain: 0.375,
  effectiveAdjustmentGain: 0.375,
  observedDurationMs: 60.4,
  targetDurationMs: 12,
  fullGainCorrectionRatio: 0.19867549668874174,
  effectiveCorrectionRatio: 0.5455117573027798,
  observedChunkItems: 262_144,
  rawNextChunkItems: 52_081.589403973514,
  effectiveRawNextChunkItems: 143_002.6341063799,
  nextChunkItems: 143_003,
  adjustment: 'decrease',
  boundApplication: null,
  completedItems: 262_144,
  progress: 0.006944444444444444,
  actualRangeCount: null,
  runId: 'sharp-webgpu-live',
  tMs: 311_234.6,
  epochMs: 1_785_028_393_992.6,
};
const normalizedEffectiveAdaptiveEvent = normalizeGateBAdaptiveRange(
  effectiveEmbeddedKitAdaptiveEvent,
);
assert.equal(normalizedEffectiveAdaptiveEvent.plannedChunkItems, null);
assert.equal(
  normalizedEffectiveAdaptiveEvent.plannedChunkItemsAuthority,
  'not-emitted-by-effective-producer',
);
assert.equal(normalizedEffectiveAdaptiveEvent.bounds, null);
assert.equal(
  normalizedEffectiveAdaptiveEvent.boundsAuthority,
  'not-emitted-by-effective-producer',
);
const effectiveAdaptiveRows = [];
assert.equal(
  appendGateBSchedulerTelemetry({
    event: effectiveEmbeddedKitAdaptiveEvent,
    observedAtMs: 311_235,
    append: (collectionId, row) => effectiveAdaptiveRows.push({ collectionId, row }),
  }).status,
  'accepted',
  'a valid effective embedded-kit adaptive observation must not become a runtime diagnostic',
);
assert.deepEqual(
  effectiveAdaptiveRows.map(({ collectionId }) => collectionId),
  ['scheduler-events'],
  'valid observed ranges must remain scheduler evidence without per-range runtime errors',
);

const effectiveEmbeddedKitTerminalAdaptiveEvent = {
  ...effectiveEmbeddedKitAdaptiveEvent,
  rangeId: 'sharp:sharp-webgpu-live:monodepth:0:project-feature:227',
  rangeIndex: 227,
  rangeCountAuthority: 'actual',
  outputStart: 37_597_561,
  outputEnd: 37_748_736,
  outputCount: 151_175,
  observedChunkItems: 151_175,
  observedDurationMs: 10.5,
  fullGainCorrectionRatio: null,
  effectiveCorrectionRatio: null,
  rawNextChunkItems: null,
  effectiveRawNextChunkItems: null,
  nextChunkItems: null,
  adjustment: 'complete',
  completedItems: 37_748_736,
  progress: 1,
  actualRangeCount: 228,
};
const normalizedEffectiveTerminalEvent = normalizeGateBAdaptiveRange(
  effectiveEmbeddedKitTerminalAdaptiveEvent,
);
assert.equal(normalizedEffectiveTerminalEvent.adaptiveRangeStatus, 'complete');
assert.equal(normalizedEffectiveTerminalEvent.nextChunkItems, null);
const effectiveTerminalRows = [];
assert.equal(
  appendGateBSchedulerTelemetry({
    event: effectiveEmbeddedKitTerminalAdaptiveEvent,
    observedAtMs: 319_059,
    append: (collectionId, row) => effectiveTerminalRows.push({ collectionId, row }),
  }).status,
  'accepted',
  'the effective producer terminal range must not become a runtime diagnostic',
);
assert.deepEqual(
  effectiveTerminalRows.map(({ collectionId }) => collectionId),
  ['scheduler-events'],
);

const acceptedSchedulerRows = [];
assert.equal(
  appendGateBSchedulerTelemetry({
    event: adaptiveRange,
    observedAtMs: 1000,
    append: (collectionId, row) => acceptedSchedulerRows.push({ collectionId, row }),
  }).status,
  'accepted',
);
assert.equal(acceptedSchedulerRows[0].collectionId, 'scheduler-events');
const quarantinedSchedulerRows = [];
const quarantinedSchedulerEvent = {
  ...adaptiveRange,
  rangeId: 'not-a-planner-scoped-range',
};
let quarantineDisposition = null;
assert.doesNotThrow(
  () => {
    quarantineDisposition = appendGateBSchedulerTelemetry({
      event: quarantinedSchedulerEvent,
      observedAtMs: 1001,
      append: (collectionId, row) => quarantinedSchedulerRows.push({ collectionId, row }),
    });
  },
  'an observer-side schema disagreement must not terminate SHARP inference',
);
assert.equal(quarantineDisposition.status, 'quarantined');
assert.equal(quarantinedSchedulerRows.at(-1).collectionId, 'runtime-errors');
assert.equal(
  quarantinedSchedulerRows.at(-1).row.kind,
  'scheduler-telemetry-validation-error',
);
assert.equal(
  quarantinedSchedulerRows.at(-1).row.event,
  quarantinedSchedulerEvent,
  'the rejected source event must remain attached to the durable diagnostic',
);
const failedAdaptiveSchedulerRows = [];
const failedAdaptiveSchedulerEvent = {
  kind: 'decoder-kernel-range-observed',
  role: 'decoder-kernel-output-tile-failed',
  rangeId: 'sharp:run:gaussian:0:image-encoder:4',
  rangeIndex: 4,
  failure: {
    name: 'GPUValidationError',
    message: 'injected kernel failure',
  },
};
assert.equal(
  appendGateBSchedulerTelemetry({
    event: failedAdaptiveSchedulerEvent,
    observedAtMs: 1002,
    append: (collectionId, row) => failedAdaptiveSchedulerRows.push({ collectionId, row }),
  }).status,
  'accepted',
  'a producer-authored adaptive failure row must remain scheduler evidence, not become an observer validation error',
);
assert.equal(failedAdaptiveSchedulerRows[0].collectionId, 'scheduler-events');
assert.equal(failedAdaptiveSchedulerRows[0].row, failedAdaptiveSchedulerEvent);
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

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

const transportRequests = [];
const receivedRows = new Map(GATE_B_COLLECTIONS.map(collection => [collection.id, []]));
const transport = await startSharpInlineLiveTelemetrySession({
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    transportRequests.push({ url, payload });
    if (url.endsWith('/start')) {
      assert.deepEqual(
        payload.collections.map(collection => collection.id),
        GATE_B_COLLECTIONS.map(collection => collection.id),
      );
      assert.equal(payload.document.gateB.batching.flushIntervalMs, 250);
      assert.equal(payload.document.gateB.batching.maxRowsPerFlush, null);
      return response({
        status: 'receiving',
        sessionId: 'gate-b-live-session',
        outputRoot: '/tmp/gate-b-live-session',
        statePath: '/tmp/gate-b-live-session/sharp-inline-report-state.json',
        stateReadUrl: '/api/read?root=pipeline-runs&path=gate-b-live-session%2Fsharp-inline-report-state.json',
      });
    }
    if (url.endsWith('/chunk')) {
      const rows = receivedRows.get(payload.collectionId);
      assert.equal(payload.expectedStart, rows.length);
      rows.push(...payload.rows);
      assert.equal(payload.batching.retention, 'uncapped');
      assert.equal(
        payload.batching.collections[payload.collectionId].queued,
        rows.length,
      );
      return response({
        collectionId: payload.collectionId,
        receivedCount: rows.length,
      });
    }
    if (url.endsWith('/finish')) {
      assert.deepEqual(
        payload.expectedCounts,
        Object.fromEntries([...receivedRows].map(([id, rows]) => [id, rows.length])),
      );
      assert.equal(payload.documentPatch.artifact.sha256, 'a'.repeat(64));
      assert.equal(payload.documentPatch.gateB.validationFailures.length, 0);
      return response({
        status: 'complete',
        path: '/tmp/gate-b-live-session/sharp-inline-report.json',
        outputRoot: '/tmp/gate-b-live-session',
        readUrl: '/api/read?root=pipeline-runs&path=gate-b-live-session%2Fsharp-inline-report.json',
        traceArtifacts: Object.fromEntries(
          [...receivedRows].map(([id, rows]) => [id, {
            count: rows.length,
            path: `/tmp/gate-b-live-session/traces/${id}.ndjson`,
          }]),
        ),
      });
    }
    throw new Error(`Unexpected Gate B transport request: ${url}`);
  },
  firingId: 'gate-b-firing',
  routeIdentity: identity,
  sourceIdentity: identity.source,
  flushIntervalMs: 250,
});
transport.append('progress-events', {
  ordinal: 0,
  progress: 0.4,
  phase: 'gaussian-decoder',
});
transport.append('scheduler-events', adaptiveRange);
transport.append('resource-snapshots', {
  knownBufferCount: 41,
  knownDeclaredBytes: 2_000_000_000,
  authority: 'sharp-runtime-known-allocations',
});
transport.append('raf-opportunity-snapshots', {
  raf: { sampleCount: 20, p99Ms: 16.1 },
  opportunities: { requested: 8, served: 8 },
});
transport.append('host-stats', {
  processCpuPercent: 92,
  residentBytes: 1_200_000_000,
  swapUsedBytes: 4_600_000_000,
});
assert.equal(
  transport.batchingSnapshot().collections['scheduler-events'].unflushed,
  1,
);
await transport.flush();
assert.equal(
  transport.batchingSnapshot().collections['scheduler-events'].unflushed,
  0,
);
await assert.rejects(
  transport.finish({
    status: 'complete',
    phase: 'sharp-route-complete',
  }),
  /PLY artifact/,
  'a live journal must not seal a forged completion without a PLY',
);
await assert.rejects(
  transport.finish({
    status: 'complete',
    phase: 'sharp-route-complete',
    artifact: {
      path: '/tmp/gate-b-live-session/output.ply',
      sha256: 'a'.repeat(64),
      bytes: 66_060_836,
    },
    browserExit: {
      kind: 'renderer-exit',
      pid: 4821,
      beforePrimaryOutput: true,
    },
  }),
  /renderer exited before primary output/,
  'a renderer death must prevent a page-side false completion even when a PLY-shaped artifact is present',
);
const transportReceipt = await transport.finish({
  status: 'complete',
  phase: 'sharp-route-complete',
  artifact: {
    path: '/tmp/gate-b-live-session/output.ply',
    sha256: 'a'.repeat(64),
    bytes: 66_060_836,
  },
});
assert.equal(transportReceipt.status, 'complete');
assert.equal(
  transportRequests.filter(request => request.url.endsWith('/chunk')).length,
  5,
  'one timer batch must flush each non-empty collection without capping any rows',
);

let abortedGateBPayload = null;
const abortedTransport = await startSharpInlineLiveTelemetrySession({
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (url.endsWith('/start')) {
      return response({
        status: 'receiving',
        sessionId: 'gate-b-aborted-session',
        outputRoot: '/tmp/gate-b-aborted-session',
        statePath: '/tmp/gate-b-aborted-session/sharp-inline-report-state.json',
        stateReadUrl: '/api/read?root=pipeline-runs&path=gate-b-aborted-session%2Fsharp-inline-report-state.json',
      });
    }
    if (url.endsWith('/abort')) {
      abortedGateBPayload = payload;
      return response({ status: 'failed' });
    }
    throw new Error(`Unexpected aborted Gate B transport request: ${url}`);
  },
  firingId: 'gate-b-aborted-firing',
  routeIdentity: identity,
  sourceIdentity: identity.source,
  flushIntervalMs: 250,
});
abortedTransport.append('scheduler-events', adaptiveRange);
await abortedTransport.abort({
  phase: 'renderer-exit',
  error: 'renderer exited before primary output',
});
assert.equal(
  abortedGateBPayload.batching.collections['scheduler-events'].unflushed,
  1,
  'an abort must report renderer-local queued rows that never became durable',
);
assert.equal(abortedGateBPayload.batching.retention, 'uncapped');

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
    collections: {
      ...completeCollections,
      'resource-snapshots': {
        ...completeCollections['resource-snapshots'],
        receivedCount: 0,
        expectedCount: 0,
      },
    },
    artifact: completeArtifact,
    browserExit: null,
  }).join('\n'),
  /empty resource-snapshots collection/,
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

const fakeDevice = { queue: {} };
let noRenderOpportunity = null;
const noRenderVolume = {
  foregroundGpuContext() {
    return {
      schema: 'kaminos.volume-foreground-gpu-context.v0',
      device: fakeDevice,
      queue: fakeDevice.queue,
      deviceIdentity: 'gate-b-device',
      queueIdentity: 'gate-b-queue',
    };
  },
  async serveForegroundNoRenderOpportunity(options) {
    noRenderOpportunity = options;
    return {
      schema: 'kaminos.volume-foreground-no-render-receipt.v0',
      status: 'opportunity-served',
      firingId: options.firingId,
      frameId: options.frameId,
      requestId: options.requestId,
      commandBufferCount: 0,
      simulationQuiesced: true,
      raymarchSubmissionQuiesced: true,
      serviceMode: 'presented-raf',
      serviceAuthority: 'browser-request-animation-frame',
      presentationObserved: true,
      rafTimestampMs: 100,
      fallbackReason: null,
    };
  },
  async renderForegroundOpportunityFrame() {
    throw new Error('no-render Gate B must not call renderForegroundOpportunityFrame');
  },
};
const noRenderHook = createSharpSameDeviceKilnOpportunityHook({
  volume: noRenderVolume,
  firingId: 'gate-b-no-render',
  nextFrameId: () => 'gate-b-no-render:1',
  presentationIsolation: 'no-render',
});
const noRenderRequest = noRenderHook({
  device: fakeDevice,
  queue: fakeDevice.queue,
  runId: 'gate-b-run',
});
const noRenderReceipt = await noRenderRequest.run({
  device: fakeDevice,
  queue: fakeDevice.queue,
});
assert.equal(noRenderReceipt.status, 'opportunity-served');
assert.equal(noRenderReceipt.commandBufferCount, 0);
assert.equal(noRenderReceipt.simulationQuiesced, true);
assert.equal(noRenderReceipt.raymarchSubmissionQuiesced, true);
assert.equal(noRenderReceipt.serviceMode, 'presented-raf');
assert.equal(noRenderReceipt.presentationObserved, true);
assert.equal(noRenderOpportunity.firingId, 'gate-b-no-render');

const forgedFallbackVolume = {
  ...noRenderVolume,
  async serveForegroundNoRenderOpportunity(options) {
    return {
      schema: 'kaminos.volume-foreground-no-render-receipt.v0',
      status: 'opportunity-served',
      firingId: options.firingId,
      frameId: options.frameId,
      requestId: options.requestId,
      commandBufferCount: 0,
      simulationQuiesced: true,
      raymarchSubmissionQuiesced: true,
      serviceMode: 'non-present-fallback',
      serviceAuthority: 'browser-task-fallback-no-presentation',
      presentationObserved: true,
      rafTimestampMs: 100,
      fallbackReason: 'raf-suspended-or-delayed',
    };
  },
};
const forgedFallbackHook = createSharpSameDeviceKilnOpportunityHook({
  volume: forgedFallbackVolume,
  firingId: 'gate-b-forged-fallback',
  nextFrameId: () => 'gate-b-forged-fallback:1',
  presentationIsolation: 'no-render',
});
const forgedFallbackRequest = forgedFallbackHook({
  device: fakeDevice,
  queue: fakeDevice.queue,
  runId: 'gate-b-forged-run',
});
await assert.rejects(
  () => forgedFallbackRequest.run({
    device: fakeDevice,
    queue: fakeDevice.queue,
  }),
  /did not prove a quiesced opportunity/,
  'a non-present fallback must not forge presented-rAF authority',
);

const [page, volumeCore] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../volume-core.js', import.meta.url), 'utf8'),
]);
assert.match(
  page,
  /globalThis\.__KAMINOS_GATE_B_ASSAY__/,
  'Gate B must remain an explicit witness-injected assay instead of changing ordinary Friendly runs',
);
assert.match(
  page,
  /function pipelineBrowserAssetSource\(entry\)[\s\S]{0,500}sha256:\s*entry\.sha256\s*\|\|\s*null/,
  'the selected live source must preserve the server-computed file SHA-256 for Gate B route validation',
);
assert.match(
  page,
  /bindGateBSourceBlobIdentity\(source,\s*sourceBlob\)/,
  'Gate B must authenticate the exact fetched source Blob before route validation and inference',
);
assert.match(
  page,
  /function sharpGateBRouteIdentity\([\s\S]{0,700}assetId:\s*gateBSourceAssetId\(source\)/,
  'the page-generated route identity must preserve the registered source asset id',
);
assert.match(
  page,
  /sourceIdentity:\s*\{[\s\S]{0,220}id:\s*gateBSourceAssetId\(effectiveSource\)/,
  'the page-generated live telemetry identity must preserve the registered source asset id',
);
assert.match(
  page,
  /onTelemetry:\s*gateBAssay\s*\?\s*reportTelemetry\s*:\s*undefined/,
  'the SHARP caller must stream scheduler events into Gate B during inference',
);
assert.match(
  page,
  /const reportTelemetry = event => \{[\s\S]{0,500}appendGateBSchedulerTelemetry\(\{[\s\S]{0,300}liveTelemetry\.append/,
  'Gate B scheduler observation must quarantine validation failures instead of throwing through SHARP inference',
);
assert.match(
  page,
  /__KAMINOS_GATE_B_JOURNAL__[\s\S]{0,1200}appendHostStats[\s\S]{0,600}appendRuntimeError/,
  'the headed witness must have a CDP-safe bridge for host stats and runtime failures',
);
assert.match(
  page,
  /persistSharpInlineSplat\([\s\S]{0,12000}liveTelemetry\.finish\([\s\S]{0,800}artifact/,
  'Gate B must not seal before the PLY is ingested and hash-bound',
);
const noRenderMethod = volumeCore.match(
  /async function serveForegroundNoRenderOpportunity\([\s\S]*?\n  }\n/,
);
assert.ok(noRenderMethod, 'volume-core must expose an explicit no-render foreground opportunity');
assert.doesNotMatch(
  noRenderMethod[0],
  /renderLiveFrame|createCommandEncoder|queue\.submit/,
  'the no-render opportunity must not encode simulation or raymarch work',
);
assert.match(
  noRenderMethod[0],
  /presentationObserved[\s\S]{0,500}recordPresentationOpportunity/,
  'the frame ledger must only record presentation when the browser actually delivered rAF',
);
assert.match(
  noRenderMethod[0],
  /serviceMode:[\s\S]{0,500}serviceAuthority:[\s\S]{0,500}presentationObserved:/,
  'the product receipt must preserve presented-rAF versus non-present-fallback authority',
);

console.log('SHARP Gate B journal contracts passed');
