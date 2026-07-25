import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporaryDirectory = mkdtempSync(path.join(tmpdir(), 'kaminos-sharp-report-session-'));
const pipelineRunsRoot = path.join(temporaryDirectory, 'pipeline-runs');
const port = await reservePort();
const server = spawn('python3', ['serve.py', String(port)], {
  cwd: repoRoot,
  env: {
    ...process.env,
    KAMINOS_PIPELINE_RUNS_DIR: pipelineRunsRoot,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverStderr = '';
server.stderr.on('data', chunk => {
  serverStderr += chunk;
});

try {
  await waitForServer(`http://127.0.0.1:${port}/api/runtime-config`);
  const liveStart = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'live-crash-test',
    document: {
      schema: 'kaminos.sharp-inline-live-telemetry.v0',
      status: 'running',
      phase: 'sharp-inference',
      routeIdentity: {
        requestedRoute: 'sharp-image-to-splat-live-v0',
        effectiveRoute: 'same-browser-product-realm-shared-device',
        sharpRevision: 'sharp-live-revision',
      },
      gateB: {
        schema: 'kaminos.sharp-gate-b-live-journal.v0',
        batching: {
          schema: 'kaminos.sharp-gate-b-batching.v0',
          retention: 'uncapped',
          overflowPolicy: 'none-all-rows-retained',
          flushIntervalMs: 250,
          maxRowsPerFlush: null,
          flushOrdinal: 0,
          lastFlushedAt: null,
          collections: {},
        },
      },
    },
    collections: [
      'progress-events',
      'scheduler-events',
      'resource-snapshots',
      'raf-opportunity-snapshots',
      'host-stats',
      'runtime-errors',
    ].map(id => ({
      id,
      jsonPointer: `#/liveTelemetry/${id}`,
      expectedCount: null,
      liveAppend: true,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
    })),
  });
  assert.equal(liveStart.response.status, 200);
  assert.match(liveStart.body.stateReadUrl, /sharp-inline-report-state/);
  const liveRunDirectory = liveStart.body.outputRoot;
  const liveStatePath = path.join(liveRunDirectory, 'sharp-inline-report-state.json');
  const liveTracePath = path.join(liveRunDirectory, 'traces', 'progress-events.ndjson');
  const firstLiveChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: liveStart.body.sessionId,
    collectionId: 'progress-events',
    expectedStart: 0,
    rows: [
      { ordinal: 0, progress: 0.03, message: 'loading source' },
      { ordinal: 1, progress: 0.925, message: 'gaussian stage' },
    ],
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      overflowPolicy: 'none-all-rows-retained',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      flushOrdinal: 0,
      lastFlushedAt: null,
      collections: {
        'progress-events': {
          queued: 2,
          flushed: 0,
          inFlight: 2,
          unflushed: 2,
        },
      },
    },
  });
  assert.equal(firstLiveChunk.response.status, 200);
  const crashReadableState = JSON.parse(readFileSync(liveStatePath, 'utf8'));
  assert.equal(crashReadableState.status, 'receiving');
  assert.equal(crashReadableState.statePath, liveStatePath);
  assert.equal(crashReadableState.stateReadUrl, liveStart.body.stateReadUrl);
  assert.equal(crashReadableState.document.routeIdentity.sharpRevision, 'sharp-live-revision');
  assert.equal(crashReadableState.collections['progress-events'].expectedCount, null);
  assert.equal(crashReadableState.collections['progress-events'].receivedCount, 2);
  assert.equal(
    crashReadableState.document.gateB.batching.collections['progress-events'].flushed,
    2,
  );
  assert.equal(
    crashReadableState.document.gateB.batching.collections['progress-events'].unflushed,
    0,
  );
  assert.equal(crashReadableState.document.gateB.flushReceipts.length, 1);
  assert.equal(crashReadableState.document.gateB.flushReceipts[0].collectionId, 'progress-events');
  assert.deepEqual(
    readFileSync(liveTracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    [
      { ordinal: 0, progress: 0.03, message: 'loading source' },
      { ordinal: 1, progress: 0.925, message: 'gaussian stage' },
    ],
    'a renderer can disappear here without taking already-fsynced progress with it',
  );
  const falseComplete = await post('/api/sharp-inline-run-report/finish', {
    sessionId: liveStart.body.sessionId,
    expectedCounts: {
      'progress-events': 1,
      'scheduler-events': 0,
      'resource-snapshots': 0,
      'raf-opportunity-snapshots': 0,
      'host-stats': 0,
      'runtime-errors': 0,
    },
    documentPatch: {
      status: 'complete',
      phase: 'sharp-inference-complete',
    },
  });
  assert.equal(falseComplete.response.status, 409);
  assert.match(falseComplete.body.error, /received 2, not final expectedCount 1/);
  assert.equal(
    existsSync(path.join(liveRunDirectory, 'sharp-inline-report.json')),
    false,
    'a stale client count must not seal a partial or contradictory live journal',
  );
  const emptyEvidenceCompletion = await post('/api/sharp-inline-run-report/finish', {
    sessionId: liveStart.body.sessionId,
    expectedCounts: {
      'progress-events': 2,
      'scheduler-events': 0,
      'resource-snapshots': 0,
      'raf-opportunity-snapshots': 0,
      'host-stats': 0,
      'runtime-errors': 0,
    },
    documentPatch: {
      status: 'complete',
      phase: 'sharp-route-complete',
      artifact: {
        path: '/tmp/gate-b-live-crash-test/output.ply',
        sha256: 'a'.repeat(64),
        bytes: 66_060_836,
      },
      gateB: {
        validationFailures: [],
      },
    },
  });
  assert.equal(emptyEvidenceCompletion.response.status, 409);
  assert.match(emptyEvidenceCompletion.body.error, /empty live collections/);
  for (const collectionId of [
    'scheduler-events',
    'resource-snapshots',
    'raf-opportunity-snapshots',
    'host-stats',
  ]) {
    const auxiliaryChunk = await post('/api/sharp-inline-run-report/chunk', {
      sessionId: liveStart.body.sessionId,
      collectionId,
      expectedStart: 0,
      rows: [{ schema: `test.${collectionId}.v0`, ordinal: 0 }],
      batching: {
        schema: 'kaminos.sharp-gate-b-batching.v0',
        retention: 'uncapped',
        overflowPolicy: 'none-all-rows-retained',
        flushIntervalMs: 250,
        maxRowsPerFlush: null,
        flushOrdinal: 1,
        lastFlushedAt: null,
        collections: {
          [collectionId]: {
            queued: 1,
            flushed: 0,
            inFlight: 1,
            unflushed: 1,
          },
        },
      },
    });
    assert.equal(auxiliaryChunk.response.status, 200);
  }
  const forgedNoPly = await post('/api/sharp-inline-run-report/finish', {
    sessionId: liveStart.body.sessionId,
    expectedCounts: {
      'progress-events': 2,
      'scheduler-events': 1,
      'resource-snapshots': 1,
      'raf-opportunity-snapshots': 1,
      'host-stats': 1,
      'runtime-errors': 0,
    },
    documentPatch: {
      status: 'complete',
      phase: 'sharp-route-complete',
      gateB: {
        validationFailures: [],
      },
    },
  });
  assert.equal(forgedNoPly.response.status, 409);
  assert.match(forgedNoPly.body.error, /PLY artifact/);
  const liveFinish = await post('/api/sharp-inline-run-report/finish', {
    sessionId: liveStart.body.sessionId,
    expectedCounts: {
      'progress-events': 2,
      'scheduler-events': 1,
      'resource-snapshots': 1,
      'raf-opportunity-snapshots': 1,
      'host-stats': 1,
      'runtime-errors': 0,
    },
    documentPatch: {
      status: 'complete',
      phase: 'sharp-route-complete',
      artifact: {
        path: '/tmp/gate-b-live-crash-test/output.ply',
        sha256: 'a'.repeat(64),
        bytes: 66_060_836,
      },
      gateB: {
        validationFailures: [],
      },
    },
  });
  assert.equal(liveFinish.response.status, 200);
  assert.equal(liveFinish.body.traceArtifacts['progress-events'].count, 2);
  const liveReport = JSON.parse(readFileSync(liveFinish.body.path, 'utf8'));
  assert.equal(liveReport.status, 'complete');
  assert.equal(liveReport.phase, 'sharp-route-complete');
  assert.equal(liveReport.artifact.sha256, 'a'.repeat(64));

  const start = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'integration-test',
    document: {
      schema: 'kaminos.sharp-inline-pipeline-report.v0',
      status: 'real',
      marker: 'compact-document',
    },
    lastTrustworthyOutput: {
      path: '/tmp/already-ingested.ply',
      sha256: 'c'.repeat(64),
      bytes: 66060836,
    },
    collections: [{
      id: 'scheduler-events',
      jsonPointer: '#/authoritativeTrace/sharpRunDebug/schedulerTelemetry/eventTrace/events',
      expectedCount: 3,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
    }],
  });
  assert.equal(start.response.status, 200);
  assert.equal(start.body.status, 'receiving');
  const runDirectory = start.body.outputRoot;
  const statePath = path.join(runDirectory, 'sharp-inline-report-state.json');
  const tracePath = path.join(runDirectory, 'traces', 'scheduler-events.ndjson');
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).status, 'receiving');
  assert.equal(readFileSync(tracePath, 'utf8'), '');

  const outOfOrder = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 1,
    rows: [{ ordinal: 1 }],
  });
  assert.equal(outOfOrder.response.status, 409);
  assert.match(outOfOrder.body.error, /Non-contiguous/);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).collections['scheduler-events'].receivedCount, 0);

  const firstChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 0,
    rows: [{ ordinal: 0 }, { ordinal: 1 }],
  });
  assert.equal(firstChunk.response.status, 200);
  assert.equal(firstChunk.body.receivedCount, 2);
  appendFileSync(tracePath, '{"ordinal":"uncommitted-crash-tail"}\n');

  const incompleteFinish = await post('/api/sharp-inline-run-report/finish', {
    sessionId: start.body.sessionId,
  });
  assert.equal(incompleteFinish.response.status, 409);
  assert.match(incompleteFinish.body.error, /incomplete/);
  assert.equal(
    existsSync(path.join(runDirectory, 'sharp-inline-report.json')),
    false,
    'a partial trace must not produce the primary report',
  );

  const finalChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 2,
    rows: [{ ordinal: 2 }],
  });
  assert.equal(finalChunk.response.status, 200);
  const finish = await post('/api/sharp-inline-run-report/finish', {
    sessionId: start.body.sessionId,
  });
  assert.equal(finish.response.status, 200);
  assert.equal(finish.body.status, 'complete');
  assert.equal('document' in finish.body, false, 'the server receipt must stay compact');
  assert.equal(finish.body.traceArtifacts['scheduler-events'].count, 3);
  assert.ok(finish.body.traceArtifacts['scheduler-events'].bytes > 0);
  assert.match(finish.body.traceArtifacts['scheduler-events'].sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    [{ ordinal: 0 }, { ordinal: 1 }, { ordinal: 2 }],
  );
  const report = JSON.parse(readFileSync(finish.body.path, 'utf8'));
  assert.equal(report.marker, 'compact-document');
  assert.equal(report.traceArtifacts['scheduler-events'].count, 3);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).status, 'complete');
  const traceResponse = await fetch(`http://127.0.0.1:${port}${finish.body.traceArtifacts['scheduler-events'].readUrl}`);
  assert.match(traceResponse.headers.get('content-type') || '', /^application\/x-ndjson/);
  assert.deepEqual(
    (await traceResponse.text()).trim().split('\n').map(line => JSON.parse(line)),
    [{ ordinal: 0 }, { ordinal: 1 }, { ordinal: 2 }],
    'the advertised NDJSON URL must serve the exact reconciled rows directly',
  );
  const repeatedFinish = await post('/api/sharp-inline-run-report/finish', {
    sessionId: start.body.sessionId,
  });
  assert.equal(repeatedFinish.response.status, 200);
  assert.equal(repeatedFinish.body.status, 'complete');
  const lateAbort = await post('/api/sharp-inline-run-report/abort', {
    sessionId: start.body.sessionId,
    phase: 'report-session-finish',
    error: 'simulated lost finish response',
  });
  assert.equal(lateAbort.response.status, 200);
  assert.equal(lateAbort.body.status, 'complete');
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).status, 'complete');

  const abortStart = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'abort-test',
    document: { schema: 'failure-test.v0' },
    lastTrustworthyOutput: {
      path: '/tmp/failure-output.ply',
      sha256: 'd'.repeat(64),
      bytes: 42,
    },
    collections: [{
      id: 'progress-events',
      jsonPointer: '#/sharpRunDebug/progressEvents',
      expectedCount: 2,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
    }],
  });
  const abort = await post('/api/sharp-inline-run-report/abort', {
    sessionId: abortStart.body.sessionId,
    phase: 'trace-chunk-upload',
    error: 'injected transport failure',
    lastTrustworthyCounts: { 'progress-events': 999 },
  });
  assert.equal(abort.response.status, 200);
  const failure = JSON.parse(readFileSync(abort.body.failureReportPath, 'utf8'));
  assert.equal(failure.phase, 'trace-chunk-upload');
  assert.equal(failure.lastTrustworthyCounts['progress-events'], 0);
  assert.deepEqual(failure.countMismatches['progress-events'], {
    clientClaimed: 999,
    durable: 0,
  });
  assert.deepEqual(failure.lastTrustworthyOutput, {
    path: '/tmp/failure-output.ply',
    sha256: 'd'.repeat(64),
    bytes: 42,
  });
  assert.equal(
    JSON.parse(readFileSync(path.join(abortStart.body.outputRoot, 'sharp-inline-report-state.json'), 'utf8')).status,
    'failed',
  );

  const gateBAbortStart = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'gate-b-abort-test',
    document: {
      schema: 'kaminos.sharp-inline-live-telemetry.v0',
      gateB: {
        schema: 'kaminos.sharp-gate-b-live-journal.v0',
        routeIdentity: { schema: 'kaminos.sharp-gate-b-route-identity.v0' },
        batching: {
          schema: 'kaminos.sharp-gate-b-batching.v0',
          retention: 'uncapped',
          flushIntervalMs: 250,
          maxRowsPerFlush: null,
          collections: {},
        },
      },
    },
    collections: ['progress-events', 'scheduler-events'].map(id => ({
      id,
      jsonPointer: `#/gateB/${id}`,
      expectedCount: null,
      liveAppend: true,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
    })),
  });
  const gateBAbort = await post('/api/sharp-inline-run-report/abort', {
    sessionId: gateBAbortStart.body.sessionId,
    phase: 'renderer-exit',
    error: 'renderer exited before primary output',
    lastTrustworthyCounts: {
      'progress-events': 0,
      'scheduler-events': 0,
    },
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      collections: {
        'scheduler-events': {
          queued: 1,
          flushed: 0,
          inFlight: 0,
          unflushed: 1,
        },
      },
    },
  });
  assert.equal(gateBAbort.response.status, 200);
  const gateBFailure = JSON.parse(readFileSync(gateBAbort.body.failureReportPath, 'utf8'));
  assert.equal(gateBFailure.gateB.clientBatching.collections['scheduler-events'].unflushed, 1);
  assert.deepEqual(gateBFailure.gateB.flushReceipts, []);

  const concurrentGrowthStart = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'gate-b-concurrent-growth-test',
    document: {
      schema: 'kaminos.sharp-inline-live-telemetry.v0',
      gateB: {
        schema: 'kaminos.sharp-gate-b-live-journal.v0',
        batching: {
          schema: 'kaminos.sharp-gate-b-batching.v0',
          retention: 'uncapped',
          overflowPolicy: 'none-all-rows-retained',
          flushIntervalMs: 250,
          maxRowsPerFlush: null,
          flushOrdinal: 0,
          lastFlushedAt: null,
          collections: {},
        },
      },
    },
    collections: [{
      id: 'raf-opportunity-snapshots',
      jsonPointer: '#/gateB/raf-opportunity-snapshots',
      expectedCount: null,
      liveAppend: true,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
    }],
  });
  const concurrentGrowthChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: concurrentGrowthStart.body.sessionId,
    collectionId: 'raf-opportunity-snapshots',
    expectedStart: 0,
    rows: [{ schema: 'test.raf-opportunity.v0', ordinal: 0 }],
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      overflowPolicy: 'none-all-rows-retained',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      flushOrdinal: 0,
      lastFlushedAt: null,
      collections: {
        'raf-opportunity-snapshots': {
          queued: 2,
          flushed: 0,
          inFlight: 1,
          unflushed: 2,
        },
      },
    },
  });
  assert.equal(
    concurrentGrowthChunk.response.status,
    200,
    `legal concurrent queue growth must not kill the live journal: ${JSON.stringify(concurrentGrowthChunk.body)}`,
  );
  const concurrentGrowthState = JSON.parse(readFileSync(
    path.join(concurrentGrowthStart.body.outputRoot, 'sharp-inline-report-state.json'),
    'utf8',
  ));
  assert.equal(concurrentGrowthState.collections['raf-opportunity-snapshots'].receivedCount, 1);
  assert.deepEqual(
    concurrentGrowthState.document.gateB.batching.collections['raf-opportunity-snapshots'],
    {
      queued: 2,
      flushed: 1,
      inFlight: 0,
      unflushed: 1,
    },
  );

  const siblingValidationStart = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'gate-b-sibling-batching-validation-test',
    document: {
      schema: 'kaminos.sharp-inline-live-telemetry.v0',
      gateB: {
        schema: 'kaminos.sharp-gate-b-live-journal.v0',
        batching: {
          schema: 'kaminos.sharp-gate-b-batching.v0',
          retention: 'uncapped',
          overflowPolicy: 'none-all-rows-retained',
          flushIntervalMs: 250,
          maxRowsPerFlush: null,
          flushOrdinal: 0,
          lastFlushedAt: null,
          collections: {},
        },
      },
    },
    collections: ['raf-opportunity-snapshots', 'runtime-errors'].map(id => ({
      id,
      jsonPointer: `#/gateB/${id}`,
      expectedCount: null,
      liveAppend: true,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
    })),
  });
  const validCurrentBatching = {
    queued: 1,
    flushed: 0,
    inFlight: 1,
    unflushed: 1,
  };
  const malformedSiblingChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: siblingValidationStart.body.sessionId,
    collectionId: 'raf-opportunity-snapshots',
    expectedStart: 0,
    rows: [{ schema: 'test.raf-opportunity.v0', ordinal: 0 }],
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      overflowPolicy: 'none-all-rows-retained',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      flushOrdinal: 0,
      lastFlushedAt: null,
      collections: {
        'raf-opportunity-snapshots': validCurrentBatching,
        'runtime-errors': {
          queued: 0,
          flushed: 0,
          inFlight: 0,
          unflushed: -1,
        },
      },
    },
  });
  assert.equal(
    malformedSiblingChunk.response.status,
    409,
    'a valid current chunk must not launder malformed sibling batching into durable state',
  );
  const unknownSiblingChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: siblingValidationStart.body.sessionId,
    collectionId: 'raf-opportunity-snapshots',
    expectedStart: 0,
    rows: [{ schema: 'test.raf-opportunity.v0', ordinal: 0 }],
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      overflowPolicy: 'none-all-rows-retained',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      flushOrdinal: 0,
      lastFlushedAt: null,
      collections: {
        'raf-opportunity-snapshots': validCurrentBatching,
        'unknown-collection': {
          queued: 0,
          flushed: 0,
          inFlight: 0,
          unflushed: 0,
        },
      },
    },
  });
  assert.equal(
    unknownSiblingChunk.response.status,
    409,
    'unknown sibling collection ids must fail before entering durable Gate B accounting',
  );
  const siblingValidationState = JSON.parse(readFileSync(
    path.join(siblingValidationStart.body.outputRoot, 'sharp-inline-report-state.json'),
    'utf8',
  ));
  assert.equal(siblingValidationState.collections['raf-opportunity-snapshots'].receivedCount, 0);
  assert.deepEqual(siblingValidationState.document.gateB.batching.collections, {});
  const committedSiblingChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: siblingValidationStart.body.sessionId,
    collectionId: 'runtime-errors',
    expectedStart: 0,
    rows: [{ schema: 'test.runtime-error.v0', ordinal: 0 }],
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      overflowPolicy: 'none-all-rows-retained',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      flushOrdinal: 0,
      lastFlushedAt: null,
      collections: {
        'runtime-errors': {
          queued: 1,
          flushed: 0,
          inFlight: 1,
          unflushed: 1,
        },
      },
    },
  });
  assert.equal(committedSiblingChunk.response.status, 200);
  const staleSiblingChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: siblingValidationStart.body.sessionId,
    collectionId: 'raf-opportunity-snapshots',
    expectedStart: 0,
    rows: [{ schema: 'test.raf-opportunity.v0', ordinal: 0 }],
    batching: {
      schema: 'kaminos.sharp-gate-b-batching.v0',
      retention: 'uncapped',
      overflowPolicy: 'none-all-rows-retained',
      flushIntervalMs: 250,
      maxRowsPerFlush: null,
      flushOrdinal: 1,
      lastFlushedAt: null,
      collections: {
        'raf-opportunity-snapshots': validCurrentBatching,
        'runtime-errors': {
          queued: 1,
          flushed: 0,
          inFlight: 0,
          unflushed: 1,
        },
      },
    },
  });
  assert.equal(
    staleSiblingChunk.response.status,
    409,
    'a sibling flushed count must match the server-durable collection prefix',
  );
  const staleSiblingState = JSON.parse(readFileSync(
    path.join(siblingValidationStart.body.outputRoot, 'sharp-inline-report-state.json'),
    'utf8',
  ));
  assert.equal(staleSiblingState.collections['raf-opportunity-snapshots'].receivedCount, 0);
  assert.equal(staleSiblingState.collections['runtime-errors'].receivedCount, 1);
  assert.equal(
    staleSiblingState.document.gateB.batching.collections['runtime-errors'].flushed,
    1,
  );

  console.log('SHARP inline report session server integration passed');
} finally {
  server.kill('SIGTERM');
  await new Promise(resolve => {
    if (server.exitCode !== null) {
      resolve();
      return;
    }
    server.once('exit', resolve);
  });
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

async function post(route, body) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, body: await response.json() };
}

async function reservePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  await new Promise(resolve => probe.close(resolve));
  return address.port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Kaminos server exited early: ${serverStderr}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Startup polling owns this transient connection failure.
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`Kaminos server did not start: ${serverStderr}`);
}
