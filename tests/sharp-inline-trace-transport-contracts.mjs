import assert from 'node:assert/strict';

import {
  compactSharpInlineReportDocument,
  persistSharpInlineReportSession,
} from '../lib/sharp-inline-trace-transport.mjs';

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
