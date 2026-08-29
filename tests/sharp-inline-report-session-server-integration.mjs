import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
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
  const schedulerRows = [
    { ordinal: 0, ratio: 1e-7, label: 'phase-café' },
    { ordinal: 1, large: 100000000000000000000, label: 'phase-π' },
    { ordinal: 2, negativeZero: -0, label: 'phase-final' },
  ];
  const producerSchedulerBytes = `${schedulerRows.map(row => JSON.stringify(row)).join('\n')}\n`;
  const canonicalSchedulerRows = producerSchedulerBytes
    .trimEnd()
    .split('\n')
    .map(line => JSON.parse(line));
  const producerSchedulerIdentity = {
    schema: 'sharp.webgpu.scheduler-event-archive-identity.v0',
    runId: 'integration-test',
    jsonPointer: '#/authoritativeTrace/sharpRunDebug/schedulerTelemetry/eventTrace/events',
    canonicalization: 'json-stringify-rows-utf8-ndjson-v1',
    encoding: 'utf-8',
    eventCount: schedulerRows.length,
    bytes: Buffer.byteLength(producerSchedulerBytes),
    sha256: createHash('sha256').update(producerSchedulerBytes).digest('hex'),
  };
  const sourceBearingDocument = {
    schema: 'kaminos.sharp-inline-pipeline-report.v0',
    status: 'real',
    marker: 'compact-document',
    authoritativeTrace: {
      sharpRunDebug: {
        route: {
          receipt: {
            metadataPayload: {
              schedulerTrace: {
                archiveIdentity: producerSchedulerIdentity,
              },
            },
          },
        },
      },
    },
  };
  const schedulerCollection = {
    id: 'scheduler-events',
    jsonPointer: producerSchedulerIdentity.jsonPointer,
    expectedCount: producerSchedulerIdentity.eventCount,
    retention: 'uncapped',
    mediaType: 'application/x-ndjson',
    sourceArchiveIdentity: producerSchedulerIdentity,
  };
  for (const [label, transport] of [
    ['omitted', undefined],
    ['empty', ''],
    ['legacy', 'json-rows-v1'],
  ]) {
    const beforeEntries = existingRunEntries();
    const collection = { ...schedulerCollection };
    if (transport !== undefined) collection.transport = transport;
    const downgrade = await post('/api/sharp-inline-run-report/start', {
      pipelineId: 'sharp-image-to-splat-live-v0',
      firingId: 'integration-test',
      document: sourceBearingDocument,
      collections: [collection],
    });
    assert.equal(downgrade.response.status, 400, `${label} scheduler transport must be rejected`);
    assert.match(downgrade.body.error, /scheduler-events.*base64-canonical-utf8-ndjson-v1/);
    assert.equal('sessionId' in downgrade.body, false);
    assert.equal('outputRoot' in downgrade.body, false);
    assert.deepEqual(existingRunEntries(), beforeEntries, `${label} downgrade must not create a session`);
  }
  const start = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'integration-test',
    document: sourceBearingDocument,
    lastTrustworthyOutput: {
      path: '/tmp/already-ingested.ply',
      sha256: 'c'.repeat(64),
      bytes: 66060836,
    },
    collections: [{
      ...schedulerCollection,
      transport: 'base64-canonical-utf8-ndjson-v1',
    }],
  });
  assert.equal(start.response.status, 200);
  assert.equal(start.body.status, 'receiving');
  const runDirectory = start.body.outputRoot;
  const statePath = path.join(runDirectory, 'sharp-inline-report-state.json');
  const tracePath = path.join(runDirectory, 'traces', 'scheduler-events.ndjson');
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).status, 'receiving');
  assert.equal(readFileSync(tracePath, 'utf8'), '');

  const parsedSchedulerChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 0,
    rows: [schedulerRows[0]],
  });
  assert.equal(parsedSchedulerChunk.response.status, 409);
  assert.match(parsedSchedulerChunk.body.error, /scheduler byte chunk is invalid/);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).collections['scheduler-events'].receivedCount, 0);
  assert.equal(readFileSync(tracePath, 'utf8'), '');

  const mixedSchedulerChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 0,
    rows: [schedulerRows[0]],
    rowCount: 1,
    base64Ndjson: canonicalChunk([schedulerRows[0]]),
  });
  assert.equal(mixedSchedulerChunk.response.status, 409);
  assert.match(mixedSchedulerChunk.body.error, /scheduler byte chunk is invalid/);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).collections['scheduler-events'].receivedCount, 0);
  assert.equal(readFileSync(tracePath, 'utf8'), '');

  const outOfOrder = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 1,
    rowCount: 1,
    base64Ndjson: canonicalChunk([schedulerRows[1]]),
  });
  assert.equal(outOfOrder.response.status, 409);
  assert.match(outOfOrder.body.error, /Non-contiguous/);
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).collections['scheduler-events'].receivedCount, 0);

  const firstChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: start.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 0,
    rowCount: 2,
    base64Ndjson: canonicalChunk(schedulerRows.slice(0, 2)),
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
    rowCount: 1,
    base64Ndjson: canonicalChunk(schedulerRows.slice(2)),
  });
  assert.equal(finalChunk.response.status, 200);
  const finish = await post('/api/sharp-inline-run-report/finish', {
    sessionId: start.body.sessionId,
  });
  assert.equal(finish.response.status, 200);
  assert.equal(finish.body.status, 'complete');
  assert.equal('document' in finish.body, false, 'the server receipt must stay compact');
  assert.equal(finish.body.traceArtifacts['scheduler-events'].count, 3);
  assert.equal(finish.body.traceArtifacts['scheduler-events'].bytes, producerSchedulerIdentity.bytes);
  assert.equal(finish.body.traceArtifacts['scheduler-events'].sha256, producerSchedulerIdentity.sha256);
  assert.equal(readFileSync(tracePath, 'utf8'), producerSchedulerBytes);
  assert.deepEqual(
    readFileSync(tracePath, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    canonicalSchedulerRows,
  );
  const report = JSON.parse(readFileSync(finish.body.path, 'utf8'));
  assert.equal(report.marker, 'compact-document');
  assert.equal(report.traceArtifacts['scheduler-events'].count, 3);
  assert.deepEqual(
    report.authoritativeTrace.sharpRunDebug.route.receipt.metadataPayload.schedulerTrace.archiveIdentity,
    producerSchedulerIdentity,
    'the persisted report must retain the producer-authenticated archive identity beside the server descriptor',
  );
  assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).status, 'complete');
  const traceResponse = await fetch(`http://127.0.0.1:${port}${finish.body.traceArtifacts['scheduler-events'].readUrl}`);
  assert.match(traceResponse.headers.get('content-type') || '', /^application\/x-ndjson/);
  const servedTrace = await traceResponse.text();
  assert.equal(servedTrace, producerSchedulerBytes);
  assert.equal(createHash('sha256').update(servedTrace).digest('hex'), producerSchedulerIdentity.sha256);
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

  const mismatchStart = await post('/api/sharp-inline-run-report/start', {
    pipelineId: 'sharp-image-to-splat-live-v0',
    firingId: 'integration-test',
    document: {
      schema: 'kaminos.sharp-inline-pipeline-report.v0',
      authoritativeTrace: {
        sharpRunDebug: {
          route: {
            receipt: {
              metadataPayload: {
                schedulerTrace: {
                  archiveIdentity: producerSchedulerIdentity,
                },
              },
            },
          },
        },
      },
    },
    collections: [{
      id: 'scheduler-events',
      jsonPointer: producerSchedulerIdentity.jsonPointer,
      expectedCount: producerSchedulerIdentity.eventCount,
      retention: 'uncapped',
      mediaType: 'application/x-ndjson',
      transport: 'base64-canonical-utf8-ndjson-v1',
      sourceArchiveIdentity: producerSchedulerIdentity,
    }],
  });
  assert.equal(mismatchStart.response.status, 200);
  const alteredSchedulerRows = canonicalSchedulerRows.map((row, index) => (
    index === 1 ? { ...row, label: 'phase-rewritten' } : row
  ));
  const mismatchChunk = await post('/api/sharp-inline-run-report/chunk', {
    sessionId: mismatchStart.body.sessionId,
    collectionId: 'scheduler-events',
    expectedStart: 0,
    rowCount: alteredSchedulerRows.length,
    base64Ndjson: canonicalChunk(alteredSchedulerRows),
  });
  assert.equal(mismatchChunk.response.status, 200);
  const mismatchFinish = await post('/api/sharp-inline-run-report/finish', {
    sessionId: mismatchStart.body.sessionId,
  });
  assert.equal(mismatchFinish.response.status, 409);
  assert.match(mismatchFinish.body.error, /producer archive identity/);
  assert.ok(mismatchFinish.body.failureReportPath);
  const mismatchFailure = JSON.parse(readFileSync(mismatchFinish.body.failureReportPath, 'utf8'));
  assert.equal(mismatchFailure.status, 'failed');
  assert.equal(mismatchFailure.phase, 'scheduler-archive-identity');
  assert.equal(
    JSON.parse(readFileSync(path.join(
      mismatchStart.body.outputRoot,
      'sharp-inline-report-state.json',
    ), 'utf8')).status,
    'failed',
  );
  assert.equal(
    existsSync(path.join(mismatchStart.body.outputRoot, 'sharp-inline-report.json')),
    false,
    'a producer-digest mismatch must not create the primary report',
  );

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
  assert.equal(abortStart.response.status, 200);
  assert.equal(
    JSON.parse(readFileSync(path.join(
      abortStart.body.outputRoot,
      'sharp-inline-report-state.json',
    ), 'utf8')).collections['progress-events'].transport,
    'json-rows-v1',
    'ordinary collections must retain omitted-transport legacy compatibility',
  );
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

function canonicalChunk(rows) {
  return Buffer.from(`${rows.map(row => JSON.stringify(row)).join('\n')}\n`).toString('base64');
}

function existingRunEntries() {
  return existsSync(pipelineRunsRoot) ? readdirSync(pipelineRunsRoot).sort() : [];
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
