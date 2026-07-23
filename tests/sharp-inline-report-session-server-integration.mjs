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
