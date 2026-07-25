import assert from 'node:assert/strict';

import {
  compactSharpInlineReportDocument,
  persistSharpInlineReportSession,
  startSharpInlineLiveTelemetrySession,
} from '../lib/sharp-inline-trace-transport.mjs';

const liveRequests = [];
const liveRows = [];
const liveTelemetry = await startSharpInlineLiveTelemetrySession({
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    liveRequests.push({ url, payload });
    if (url.endsWith('/start')) {
      return response({
        schema: 'kaminos.sharp-inline-run-report-session.v0',
        status: 'receiving',
        sessionId: 'live-session-test',
        outputRoot: '/tmp/live-session-test',
        statePath: '/tmp/live-session-test/sharp-inline-report-state.json',
        stateReadUrl: '/api/read?root=pipeline-runs&path=live-session-test%2Fsharp-inline-report-state.json',
      });
    }
    if (url.endsWith('/chunk')) {
      assert.equal(payload.expectedStart, liveRows.length);
      liveRows.push(...payload.rows);
      return response({
        schema: 'kaminos.sharp-inline-run-report-chunk-receipt.v0',
        status: 'receiving',
        sessionId: payload.sessionId,
        collectionId: payload.collectionId,
        receivedCount: liveRows.length,
      });
    }
    if (url.endsWith('/finish')) {
      assert.deepEqual(payload.expectedCounts, { 'progress-events': liveRows.length });
      assert.deepEqual(payload.documentPatch, {
        status: 'complete',
        phase: 'sharp-inference-complete',
      });
      return response({
        schema: 'kaminos.sharp-inline-run-report-receipt.v0',
        status: 'complete',
        sessionId: payload.sessionId,
        path: '/tmp/live-session-test/sharp-inline-report.json',
        outputRoot: '/tmp/live-session-test',
        readUrl: '/api/read?root=pipeline-runs&path=live-session-test%2Fsharp-inline-report.json',
        traceArtifacts: {
          'progress-events': {
            count: liveRows.length,
            path: '/tmp/live-session-test/traces/progress-events.ndjson',
          },
        },
      });
    }
    throw new Error(`Unexpected live telemetry request: ${url}`);
  },
  pipelineId: 'sharp-image-to-splat-live-v0',
  firingId: 'live-firing-test',
  routeIdentity: {
    requestedRoute: 'sharp-image-to-splat-live-v0',
    effectiveRoute: 'same-browser-product-realm-shared-device',
    sharpRevision: 'sharp-live-revision',
    schedulerProfile: 'cooperative-spn-gaussian',
  },
});
assert.equal(liveTelemetry.status, 'receiving');
assert.equal(liveTelemetry.sessionId, 'live-session-test');
assert.match(liveTelemetry.stateReadUrl, /sharp-inline-report-state/);
const liveStart = liveRequests[0];
assert.ok(liveStart.url.endsWith('/start'), 'live telemetry must durably start before any progress row');
assert.equal(liveStart.payload.document.status, 'running');
assert.equal(
  liveStart.payload.document.liveTelemetry.progressEventsRef,
  '#/traceArtifacts/progress-events',
  'ordinary v0 live telemetry must retain its legacy progress trace pointer',
);
assert.equal(
  liveStart.payload.document.routeIdentity.effectiveRoute,
  'same-browser-product-realm-shared-device',
);
assert.deepEqual(liveStart.payload.collections, [{
  id: 'progress-events',
  jsonPointer: '#/liveTelemetry/progressEvents',
  expectedCount: null,
  liveAppend: true,
  retention: 'uncapped',
  mediaType: 'application/x-ndjson',
}]);
liveTelemetry.append({ ordinal: 0, progress: 0.03, message: 'loading source' });
liveTelemetry.append({ ordinal: 1, progress: 0.925, message: 'gaussian stage' });
const liveReceipt = await liveTelemetry.finish({
  status: 'complete',
  phase: 'sharp-inference-complete',
});
assert.deepEqual(
  liveRows,
  [
    { ordinal: 0, progress: 0.03, message: 'loading source' },
    { ordinal: 1, progress: 0.925, message: 'gaussian stage' },
  ],
  'live progress must append in exact order without a client-side retention cap',
);
assert.equal(liveReceipt.traceArtifacts['progress-events'].count, 2);
assert.equal(
  liveRequests.filter(request => request.url.endsWith('/finish')).length,
  1,
  'live telemetry must seal only after every queued append is durable',
);

let liveFailureAbort = null;
let liveFailureFinishAttempts = 0;
const failingLiveTelemetry = await startSharpInlineLiveTelemetrySession({
  fetchImpl: async (url, options) => {
    const payload = JSON.parse(options.body);
    if (url.endsWith('/start')) {
      return response({
        status: 'receiving',
        sessionId: 'live-session-failure',
        outputRoot: '/tmp/live-session-failure',
        statePath: '/tmp/live-session-failure/sharp-inline-report-state.json',
        stateReadUrl: '/api/read?root=pipeline-runs&path=live-session-failure%2Fsharp-inline-report-state.json',
      });
    }
    if (url.endsWith('/chunk')) {
      return response({ error: 'injected live telemetry append failure' }, 500);
    }
    if (url.endsWith('/abort')) {
      liveFailureAbort = payload;
      return response({
        status: 'failed',
        failureReportPath: '/tmp/live-session-failure/sharp-inline-report-failure.json',
      });
    }
    if (url.endsWith('/finish')) {
      liveFailureFinishAttempts += 1;
      return response({ status: 'complete' });
    }
    throw new Error(`Unexpected failing live telemetry request: ${url}`);
  },
  firingId: 'live-firing-failure',
  routeIdentity: {
    requestedRoute: 'sharp-image-to-splat-live-v0',
    effectiveRoute: 'same-browser-product-realm-shared-device',
  },
});
failingLiveTelemetry.append({ ordinal: 0, progress: 0.4 });
await assert.rejects(
  failingLiveTelemetry.finish(),
  /injected live telemetry append failure/,
  'a failed append must not be laundered into a complete telemetry receipt',
);
assert.equal(liveFailureFinishAttempts, 0);
assert.deepEqual(liveFailureAbort, {
  sessionId: 'live-session-failure',
  phase: 'live-telemetry-upload',
  error: 'injected live telemetry append failure',
  lastTrustworthyCounts: { 'progress-events': 0 },
});

const events = [
  {
    kind: 'spn-fusion',
    phase: 'spn-fusion',
    tMs: 10,
    details: { block: 'fuse-lowres' },
  },
  {
    kind: 'monodepth-phase',
    boundary: 'monodepth-phase',
    tMs: 25,
    details: { phase: 'project-feature' },
  },
  ...Array.from({ length: 5 }, (_, index) => ({
    kind: `event-${index + 2}`,
    ordinal: index + 2,
    tMs: 40 + index,
  })),
];
const document = {
  schema: 'kaminos.sharp-inline-pipeline-report.v0',
  status: 'real',
  authoritativeTrace: {
    sharpRunDebug: {
      progressEvents: [{ progress: 0.5, marker: 'progress-row' }],
      schedulerTelemetry: {
        events,
        eventTrace: { schema: 'trace.v0', events },
      },
      schedulerApplication: {
        boundaries: [{ marker: 'boundary-row' }],
      },
      commandDutyReport: {
        submissions: [{ marker: 'submission-row' }],
      },
      hostPhaseReport: {
        intervals: [{ marker: 'host-row' }],
      },
      foregroundOpportunityReport: {
        receipts: [{ marker: 'receipt-row' }],
        services: [{ marker: 'service-row' }],
      },
    },
    backgroundHeartbeat: {
      gpuDutyIntervals: {
        intervals: [{ marker: 'gpu-row' }],
      },
      worstFrameGaps: [{ marker: 'gap-row' }],
      overlapReferenceSpace: {
        eventSource: '#/authoritativeTrace/sharpRunDebug/schedulerTelemetry/eventTrace/events',
        intervalSource: '#/authoritativeTrace/backgroundHeartbeat/gpuDutyIntervals/intervals',
      },
    },
  },
};
const schedulerTelemetryArchive = {
  schema: 'sharp-webgpu.scheduler-event-archive.v0',
  status: 'sealed',
  retention: 'uncapped',
  runId: 'run-test',
  clockId: 'clock-test',
  eventCount: events.length,
  events,
};

const compacted = compactSharpInlineReportDocument(document, { schedulerTelemetryArchive });
assert.equal(compacted.collections.length, 9, 'every uncapped trace collection must be externalized');
assert.equal(
  compacted.collections.find(collection => collection.id === 'scheduler-events')?.values,
  schedulerTelemetryArchive.events,
  'the exact sealed scheduler archive array must be transported without copying',
);
assert.equal(
  compacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventsRef.collectionId,
  'scheduler-events',
  'the compatibility scheduler event projection must resolve to the authoritative collection',
);
assert.equal(
  compacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventTrace.eventsRef.collectionId,
  'scheduler-events',
  'the event trace must resolve to the same authoritative collection',
);
assert.deepEqual(
  compacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventSummary,
  {
    schema: 'kaminos.scheduler-event-summary.v0',
    count: 7,
    firstTMs: 10,
    lastTMs: 44,
    spnFusionBlocks: ['fuse-lowres'],
    monodepthPhaseLabels: ['project-feature'],
  },
  'the compact envelope must retain the exact scheduler facts consumed synchronously by comparison UI',
);
assert.equal(
  compacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventArchive.traceArtifactRef,
  '#/traceArtifacts/scheduler-events',
  'the compact SHARP archive descriptor must resolve to the exact uncapped trace artifact',
);
assert.throws(
  () => compactSharpInlineReportDocument(document, {
    schedulerTelemetryArchive: {
      ...schedulerTelemetryArchive,
      events: [...events],
    },
  }),
  /exact scheduler telemetry source array/,
  'Kaminos must reject a copied or substituted archive array',
);
assert.deepEqual(
  compacted.document.authoritativeTrace.backgroundHeartbeat.overlapReferenceSpace,
  {
    eventSource: '#/traceArtifacts/scheduler-events',
    intervalSource: '#/traceArtifacts/gpu-duty-intervals',
  },
  'foreground gap references must resolve through the externalized trace artifacts',
);
assert.doesNotMatch(
  JSON.stringify(compacted.document),
  /event-6|progress-row|boundary-row|submission-row|host-row|receipt-row|service-row|gpu-row|gap-row/,
  'the compact report document must not retain externalized rows',
);
assert.equal(
  compacted.collections.reduce((sum, collection) => sum + collection.values.length, 0),
  15,
  'externalization must preserve the exact uncapped row count',
);

const correlationFailure = compactSharpInlineReportDocument({
  schema: 'kaminos.sharp-inline-failure-report.v0',
  status: 'failed',
  phase: 'foreground-heartbeat-correlation',
  artifacts: {
    splat: {
      path: '/tmp/correlation-failure.ply',
      sha256: 'c'.repeat(64),
      bytes: 66_060_836,
    },
  },
  sharpRunDebug: document.authoritativeTrace.sharpRunDebug,
}, { schedulerTelemetryArchive });
assert.equal(
  correlationFailure.collections.find(collection => collection.id === 'scheduler-events')?.values,
  schedulerTelemetryArchive.events,
  'a post-ingest correlation failure must retain the exact scheduler trace for durable diagnosis',
);
assert.equal(correlationFailure.document.phase, 'foreground-heartbeat-correlation');
assert.equal(correlationFailure.document.artifacts.splat.path, '/tmp/correlation-failure.ply');

const scaleEvents = Array.from({ length: 189_000 }, (_, index) => ({ tMs: index }));
const scaleCompacted = compactSharpInlineReportDocument({
  authoritativeTrace: {
    sharpRunDebug: {
      schedulerTelemetry: {
        eventTrace: { events: scaleEvents },
      },
    },
  },
});
assert.deepEqual(
  {
    count: scaleCompacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventSummary.count,
    firstTMs: scaleCompacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventSummary.firstTMs,
    lastTMs: scaleCompacted.document.authoritativeTrace.sharpRunDebug.schedulerTelemetry.eventSummary.lastTMs,
  },
  { count: 189_000, firstTMs: 0, lastTMs: 188_999 },
  'summary bounds must remain stack-safe at the observed production trace scale',
);

const requests = [];
const received = new Map();
const fetchImpl = async (url, options) => {
  const payload = JSON.parse(options.body);
  requests.push({ url, payload });
  if (url.endsWith('/start')) {
    for (const collection of payload.collections) received.set(collection.id, []);
    return response({
      schema: 'kaminos.sharp-inline-run-report-session.v0',
      sessionId: 'session-test',
    });
  }
  if (url.endsWith('/chunk')) {
    const values = received.get(payload.collectionId);
    assert.equal(payload.expectedStart, values.length, 'each chunk must start at the next exact row');
    values.push(...payload.rows);
    return response({
      schema: 'kaminos.sharp-inline-run-report-chunk-receipt.v0',
      collectionId: payload.collectionId,
      receivedCount: values.length,
    });
  }
  if (url.endsWith('/finish')) {
    for (const collection of compacted.collections) {
      assert.equal(
        received.get(collection.id).length,
        collection.values.length,
        `finish must observe every ${collection.id} row`,
      );
    }
    return response({
      schema: 'kaminos.sharp-inline-run-report-receipt.v0',
      path: '/tmp/run/sharp-inline-report.json',
      outputRoot: '/tmp/run',
      readUrl: '/api/read?root=pipeline-runs&path=run%2Fsharp-inline-report.json',
      traceArtifacts: Object.fromEntries(
        compacted.collections.map(collection => [collection.id, {
          count: collection.values.length,
          path: `/tmp/run/traces/${collection.id}.ndjson`,
        }]),
      ),
    });
  }
  throw new Error(`Unexpected request: ${url}`);
};

let yieldCount = 0;
const receipt = await persistSharpInlineReportSession({
  fetchImpl,
  pipelineId: 'sharp-image-to-splat-live-v0',
  firingId: 'firing-test',
  document,
  schedulerTelemetryArchive,
  lastTrustworthyOutput: {
    path: '/tmp/splat.ply',
    sha256: 'a'.repeat(64),
    bytes: 66060836,
  },
  chunkRows: 3,
  taskYield: async () => {
    yieldCount += 1;
  },
});
assert.equal(receipt.path, '/tmp/run/sharp-inline-report.json');
assert.equal(receipt.document.reportPath, receipt.path);
assert.equal(receipt.document.outputRoot, receipt.outputRoot);
assert.equal(receipt.document.traceArtifacts['scheduler-events'].count, events.length);
assert.ok(
  requests.filter(request => request.url.endsWith('/chunk')).length > compacted.collections.length,
  'large collections must be split into bounded transport chunks',
);
assert.equal(
  yieldCount,
  requests.filter(request => request.url.endsWith('/chunk')).length,
  'the browser must yield after every trace chunk',
);
assert.doesNotMatch(
  JSON.stringify(requests.find(request => request.url.endsWith('/start'))?.payload),
  /event-6|progress-row/,
  'session start must not contain externalized trace rows',
);
assert.deepEqual(
  requests.find(request => request.url.endsWith('/start'))?.payload.lastTrustworthyOutput,
  {
    path: '/tmp/splat.ply',
    sha256: 'a'.repeat(64),
    bytes: 66060836,
  },
  'report session start must durably receive the already-ingested PLY identity',
);

let abortPayload = null;
let chunkAttempts = 0;
await assert.rejects(
  persistSharpInlineReportSession({
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      if (url.endsWith('/start')) return response({ sessionId: 'session-failure' });
      if (url.endsWith('/chunk')) {
        chunkAttempts += 1;
        return response({ error: 'injected chunk failure' }, 500);
      }
      if (url.endsWith('/abort')) {
        abortPayload = payload;
        return response({ status: 'failed' });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'firing-failure',
    document,
    schedulerTelemetryArchive,
    lastTrustworthyOutput: {
      path: '/tmp/failure-splat.ply',
      sha256: 'b'.repeat(64),
      bytes: 42,
    },
    chunkRows: 3,
    taskYield: async () => {},
  }),
  /injected chunk failure/,
);
assert.equal(chunkAttempts, 1);
assert.equal(abortPayload?.sessionId, 'session-failure');
assert.equal(abortPayload?.phase, 'trace-chunk-upload');
assert.equal(abortPayload?.lastTrustworthyCounts['scheduler-events'], 0);
assert.deepEqual(abortPayload?.lastTrustworthyOutput, {
  path: '/tmp/failure-splat.ply',
  sha256: 'b'.repeat(64),
  bytes: 42,
});

let finishAttempts = 0;
let abortAttempts = 0;
const recoveredReceipt = await persistSharpInlineReportSession({
  fetchImpl: async (url) => {
    if (url.endsWith('/start')) return response({ sessionId: 'session-finish-retry' });
    if (url.endsWith('/finish')) {
      finishAttempts += 1;
      if (finishAttempts === 1) throw new Error('injected lost finish response');
      return response({
        schema: 'kaminos.sharp-inline-run-report-receipt.v0',
        status: 'complete',
        path: '/tmp/recovered/sharp-inline-report.json',
        outputRoot: '/tmp/recovered',
        readUrl: '/api/read?root=pipeline-runs&path=recovered%2Fsharp-inline-report.json',
        traceArtifacts: {},
      });
    }
    if (url.endsWith('/abort')) {
      abortAttempts += 1;
      return response({ status: 'failed' });
    }
    throw new Error(`Unexpected request: ${url}`);
  },
  document: { schema: 'finish-retry.v0' },
  taskYield: async () => {},
});
assert.equal(recoveredReceipt.status, 'complete');
assert.equal(finishAttempts, 2, 'a lost finish response must be retried idempotently');
assert.equal(abortAttempts, 0, 'recovered completion must not be overwritten by abort cleanup');

console.log('SHARP inline trace transport contracts passed');

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}
