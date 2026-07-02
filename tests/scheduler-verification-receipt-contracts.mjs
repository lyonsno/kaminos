import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
  classifySchedulerVerificationReceipt,
  createSchedulerVerificationReceipt,
  validateSchedulerVerificationReceipt,
} from '../lib/scheduler-verification-receipt.mjs';

const root = new URL('..', import.meta.url).pathname;
const manifestPath = join(root, 'pipelines', 'asset-pipelines.json');
const witnessPath = join(root, 'pipeline-witness.mjs');

function baseReceipt(overrides = {}) {
  return createSchedulerVerificationReceipt({
    route: {
      pipelineId: 'sharp-image-to-splat-live-v0',
      requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
      effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
      backendClass: 'browser-webgpu',
      adapterReport: {
        path: '/tmp/sharp-adapter-report.json',
        sha256: '0'.repeat(64),
      },
    },
    scheduler: {
      schema: 'kaminos.webgpu-route-scheduler.v0',
      requestedScheduler: {
        mode: 'cooperative',
        phaseChunkSize: { spnPatch: 1 },
        waitForSubmittedWorkDone: true,
        yieldMs: 2,
      },
      effectiveScheduler: {
        mode: 'cooperative',
        phaseChunkSize: { spnPatch: 1 },
        waitForSubmittedWorkDone: true,
        yieldMs: 2,
        unsupportedFields: [],
      },
      verificationState: 'verified',
    },
    backpressure: {
      schema: 'kaminos.webgpu-route-backpressure.v0',
      effectiveBudget: 'furnace',
    },
    eventTrace: {
      schema: 'kaminos.webgpu-scheduler-event-trace.v0',
      clock: 'performance.now',
      timingAuthority: 'browser-wall-clock',
      events: [
        { tMs: 1, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'chunk-start', index: 0, source: 'mock' },
        { tMs: 2, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-start', index: 0, source: 'mock' },
        { tMs: 3, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'queue-work-done-end', index: 0, queueDoneMs: 1, source: 'mock' },
        { tMs: 4, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-start', index: 0, source: 'mock' },
        { tMs: 6, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-end', index: 0, yieldMs: 2, source: 'mock' },
      ],
    },
    boundaryAssertions: [
      {
        field: 'phaseChunkSize.spnPatch',
        requested: 1,
        effective: 1,
        status: 'verified',
        observedBoundary: 'spn-patch-chunk',
        observedCount: 1,
        expectedMinimumCount: 1,
        observedQueueWaitCount: 1,
        observedYieldCount: 1,
        unsupportedReason: null,
      },
    ],
    frameTail: {
      evidenceSource: 'browser-wall-clock',
      disclaimer: 'not-gpu-exclusive-or-present-latency',
      rafFps: 8.06,
      frameP95Ms: 124.1,
      queueDoneP95Ms: 473.6,
    },
    ...overrides,
  });
}

const verified = baseReceipt();
assert.equal(verified.schema, 'kaminos.webgpu-scheduler-verification-receipt.v0');
assert.equal(verified.status, 'verified');
assert.equal(verified.classification, 'observed-boundary');
assert.equal(validateSchedulerVerificationReceipt(verified).ok, true);
assert.equal(classifySchedulerVerificationReceipt(verified).status, 'verified');

const noEvents = baseReceipt({
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'browser-wall-clock',
    events: [],
  },
});
assert.equal(noEvents.status, 'scheduler-unverified', 'effective scheduler config without observed events must not become verified');
assert.ok(noEvents.downgrades.includes('event-trace-missing'));
assert.equal(noEvents.falseAuthorityChecks.eventTraceMissing, true);

const droppedRequestedField = baseReceipt({
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { spnPatch: 1 },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      phaseChunkSize: {},
      unsupportedFields: [],
    },
    verificationState: 'verified',
  },
});
assert.equal(droppedRequestedField.status, 'invalid', 'dropped requested scheduler fields must be invalid unless explicitly unsupported');
assert.ok(droppedRequestedField.downgrades.includes('requested-field-dropped-without-unsupported'));
assert.equal(validateSchedulerVerificationReceipt(droppedRequestedField).ok, false);

const missingQueueEvents = baseReceipt({
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'browser-wall-clock',
    events: [
      { tMs: 1, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'chunk-start', index: 0, source: 'mock' },
      { tMs: 4, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-start', index: 0, source: 'mock' },
      { tMs: 6, phase: 'spn', boundary: 'spn-patch-chunk', kind: 'js-yield-end', index: 0, yieldMs: 2, source: 'mock' },
    ],
  },
});
assert.equal(missingQueueEvents.status, 'scheduler-unverified', 'waitForSubmittedWorkDone requires queue wait events before verification');
assert.ok(missingQueueEvents.downgrades.includes('queue-wait-events-missing'));

const proxyOnly = baseReceipt({
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'raf-and-queue-proxy',
    events: [
      { tMs: 1, phase: 'frame', boundary: 'frame-tail', kind: 'raf-sample', source: 'mock' },
      { tMs: 2, phase: 'frame', boundary: 'frame-tail', kind: 'frame-tail-sample', source: 'mock' },
    ],
  },
  boundaryAssertions: [],
});
assert.equal(proxyOnly.status, 'scheduler-unverified', 'rAF/queue proxy evidence alone must not verify scheduler boundaries');
assert.equal(proxyOnly.frameTail.evidenceSource, 'raf-and-queue-proxy');
assert.equal(proxyOnly.falseAuthorityChecks.timingProxyOnly, true);

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-scheduler-verification-'));
try {
  const inputPath = join(tempRoot, 'source.png');
  const outDir = join(tempRoot, 'live-out');
  const reportPath = join(tempRoot, 'reports', 'live.json');
  const mockSharpCommand = join(tempRoot, 'mock-sharp-command.mjs');
  writeFileSync(inputPath, 'fake image bytes\n');
  writeFileSync(mockSharpCommand, `#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const input = args.get('--input');
const output = args.get('--output');
const report = args.get('--report');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, 'ply\\nformat ascii 1.0\\nelement vertex 1\\nproperty float x\\nproperty float y\\nproperty float z\\nend_header\\n0 0 0\\n');
const outputDir = dirname(output);
const depthPath = join(outputDir, 'sharp-webgpu-depth.png');
const metadataPath = join(outputDir, 'sharp-webgpu-metadata.json');
const autoCropPath = join(outputDir, 'sharp-output.splat-autocrop-evidence.json');
writeFileSync(depthPath, 'depth');
writeFileSync(metadataPath, '{}\\n');
writeFileSync(autoCropPath, '{}\\n');
const hash = createHash('sha256').update(readFileSync(input)).digest('hex');
const stat = statSync(output);
mkdirSync(dirname(report), { recursive: true });
writeFileSync(report, JSON.stringify({
  schema: 'mock.sharp-adapter-report.v0',
  ok: true,
  input,
  output,
  inputSha256: hash,
  outputBytes: stat.size,
  breathingRoom: {
    schema: 'kaminos.sharp-webgpu-scheduler-evidence.v0',
    status: 'verified',
    requestedScheduler: { mode: 'cooperative', spnPatchChunkSize: 1, waitForSubmittedWorkDone: true, yieldMs: 2 },
    effectiveScheduler: { mode: 'cooperative', spnPatchChunkSize: 1, waitForSubmittedWorkDone: true, yieldMs: 2 },
    unsupportedFields: [],
    telemetry: { schema: 'sharp-webgpu.scheduler-telemetry.v0', status: 'verified', events: [] }
  },
  sideArtifacts: [
    { id: 'depthMap', role: 'depth-map', path: depthPath },
    { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropPath, schema: 'kaminos.splat-autocrop-evidence.v0' }
  ]
}, null, 2) + '\\n');
`);
  const chmodResult = spawnSync('chmod', ['755', mockSharpCommand], { encoding: 'utf8' });
  assert.equal(chmodResult.status, 0, chmodResult.stderr);

  const run = spawnSync(process.execPath, [
    witnessPath,
    '--manifest', manifestPath,
    '--pipeline-id', 'sharp-image-to-splat-live-v0',
    '--input', inputPath,
    '--out-dir', outDir,
    '--report', reportPath,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_COMMAND: mockSharpCommand,
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const route = report.stages[0].effectiveRoute;
  assert.equal(route.pipelineScheduler.schedulerVerification.schema, 'kaminos.webgpu-scheduler-verification-receipt.v0');
  assert.equal(route.pipelineScheduler.schedulerVerification.status, 'scheduler-unverified');
  assert.deepEqual(route.pipelineScheduler.schedulerVerification.eventTrace.events, []);
  assert.ok(route.pipelineScheduler.schedulerVerification.downgrades.includes('event-trace-missing'));
  assert.deepEqual(route.adapterReport.pipelineScheduler.schedulerVerification, route.pipelineScheduler.schedulerVerification);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
