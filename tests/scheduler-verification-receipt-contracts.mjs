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

const mismatchedBoundaryAssertion = baseReceipt({
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'browser-wall-clock',
    events: [
      { tMs: 1, phase: 'heartbeat', boundary: 'unrelated-heartbeat', kind: 'heartbeat', source: 'mock' },
      { tMs: 2, phase: 'queue', boundary: 'unrelated-queue', kind: 'queue-work-done-start', source: 'mock' },
      { tMs: 3, phase: 'queue', boundary: 'unrelated-queue', kind: 'queue-work-done-end', queueDoneMs: 1, source: 'mock' },
      { tMs: 4, phase: 'yield', boundary: 'unrelated-yield', kind: 'js-yield-start', source: 'mock' },
      { tMs: 6, phase: 'yield', boundary: 'unrelated-yield', kind: 'js-yield-end', yieldMs: 2, source: 'mock' },
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
});
assert.equal(mismatchedBoundaryAssertion.status, 'scheduler-unverified', 'caller-supplied verified boundary assertions must match eventTrace.events');
assert.ok(mismatchedBoundaryAssertion.downgrades.includes('boundary-assertion-event-mismatch'));
assert.equal(mismatchedBoundaryAssertion.falseAuthorityChecks.boundaryAssertionEventMismatch, true);

const conflictingObservedBoundaryAssertion = baseReceipt({
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'browser-wall-clock',
    events: [
      { tMs: 1, phase: 'heartbeat', boundary: 'unrelated-heartbeat', kind: 'heartbeat', source: 'mock' },
      { tMs: 2, phase: 'queue', boundary: 'unrelated-queue', kind: 'queue-work-done-start', source: 'mock' },
      { tMs: 3, phase: 'queue', boundary: 'unrelated-queue', kind: 'queue-work-done-end', queueDoneMs: 1, source: 'mock' },
      { tMs: 4, phase: 'yield', boundary: 'unrelated-yield', kind: 'js-yield-start', source: 'mock' },
      { tMs: 6, phase: 'yield', boundary: 'unrelated-yield', kind: 'js-yield-end', yieldMs: 2, source: 'mock' },
    ],
  },
  boundaryAssertions: [
    {
      field: 'phaseChunkSize.spnPatch',
      requested: 1,
      effective: 1,
      status: 'verified',
      observedBoundary: 'unrelated-heartbeat',
      observedCount: 1,
      expectedMinimumCount: 1,
      observedQueueWaitCount: 1,
      observedYieldCount: 1,
      unsupportedReason: null,
    },
  ],
});
assert.equal(conflictingObservedBoundaryAssertion.status, 'scheduler-unverified', 'recognized scheduler fields must derive their required boundary from field, not caller-supplied observedBoundary');
assert.ok(conflictingObservedBoundaryAssertion.downgrades.includes('boundary-assertion-event-mismatch'));
assert.equal(conflictingObservedBoundaryAssertion.falseAuthorityChecks.boundaryAssertionEventMismatch, true);

const unknownFieldBoundaryAssertion = baseReceipt({
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'browser-wall-clock',
    events: [
      { tMs: 1, phase: 'heartbeat', boundary: 'unrelated-heartbeat', kind: 'heartbeat', source: 'mock' },
      { tMs: 2, phase: 'queue', boundary: 'unrelated-queue', kind: 'queue-work-done-start', source: 'mock' },
      { tMs: 3, phase: 'queue', boundary: 'unrelated-queue', kind: 'queue-work-done-end', queueDoneMs: 1, source: 'mock' },
      { tMs: 4, phase: 'yield', boundary: 'unrelated-yield', kind: 'js-yield-start', source: 'mock' },
      { tMs: 6, phase: 'yield', boundary: 'unrelated-yield', kind: 'js-yield-end', yieldMs: 2, source: 'mock' },
    ],
  },
  boundaryAssertions: [
    {
      field: 'other.field',
      requested: 1,
      effective: 1,
      status: 'verified',
      observedBoundary: 'unrelated-heartbeat',
      observedCount: 1,
      expectedMinimumCount: 1,
      observedQueueWaitCount: 1,
      observedYieldCount: 1,
      unsupportedReason: null,
    },
  ],
});
assert.equal(unknownFieldBoundaryAssertion.status, 'scheduler-unverified', 'unknown assertion fields must not satisfy requested scheduler boundary verification');
assert.ok(unknownFieldBoundaryAssertion.downgrades.includes('requested-boundary-assertion-missing'));
assert.equal(unknownFieldBoundaryAssertion.falseAuthorityChecks.requestedBoundaryAssertionMissing, true);

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

const mogeReceiptRoot = mkdtempSync(join(tmpdir(), 'kaminos-moge-scheduler-receipt-'));
try {
  const inputPath = join(mogeReceiptRoot, 'source.png');
  const outDir = join(mogeReceiptRoot, 'live-out');
  const reportPath = join(mogeReceiptRoot, 'reports', 'live.json');
  const mockAdapterCommand = join(mogeReceiptRoot, 'mock-route-receipt-command.mjs');
  writeFileSync(inputPath, 'fake image bytes\n');
  writeFileSync(mockAdapterCommand, `#!/usr/bin/env node
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
  receipt: {
    schema: 'kaminos.webgpu-route-receipt.v0',
    requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
    effectiveRouteId: 'moge.depth-normal.webgpu-local.v0',
    status: 'real',
    fallbackReason: null,
    backend: {
      kind: 'webgpu-local',
      runtime: 'browser',
      adapterName: 'Mock MoGE WebGPU',
      browser: 'Chrome Headless',
      features: ['shader-f16', 'timestamp-query'],
      requestedFeatures: ['timestamp-query'],
      limits: { maxBufferSize: 4294967296 },
      timestampQuery: 'requested'
    },
    model: {
      id: 'Ruicheng/moge-2-vitl-normal',
      revision: 'local-vitl-normal',
      weightsHash: 'sha256:mock-moge-weights',
      dtype: 'fp16'
    },
    kernel: {
      kitVersion: '0.1.4',
      profile: 'conv-transpose2d-stride2'
    },
    inputs: [
      { role: 'source-image', artifactId: 'image:mock-source', sha256: hash }
    ],
    outputs: [
      { role: 'depth', artifactId: 'depth:mock-source', sha256: 'sha256:mock-depth', status: 'real', shape: [592, 592] },
      { role: 'normal', artifactId: 'normal:mock-source', sha256: 'sha256:mock-normal', status: 'real', shape: [3, 592, 592] }
    ],
    timings: {
      source: 'queue-submit-wait',
      totalMs: 1888,
      stages: [
        { name: 'backbone', ms: 1000 },
        { name: 'decoder-heads', ms: 850 },
        { name: 'output-readback', ms: 38 }
      ]
    },
    createdAt: new Date(0).toISOString(),
    runtime: {
      scheduler: {
        schema: 'kaminos.webgpu-route-scheduler.v0',
        requestedScheduler: {
          mode: 'cooperative',
          yieldMs: 5,
          waitForSubmittedWorkDone: true,
          phaseChunkSize: { decoderLevel: 1 }
        },
        effectiveScheduler: {
          mode: 'cooperative',
          yieldMs: 5,
          waitForSubmittedWorkDone: true,
          phaseChunkSize: {},
          unsupportedFields: ['phaseChunkSize.decoderLevel']
        },
        verificationState: 'scheduler-unverified'
      },
      backpressure: {
        schema: 'kaminos.webgpu-route-backpressure.v0',
        requestedBudget: 'visible-wait',
        effectiveBudget: 'visible-wait',
        memoryExclusivity: 'shared',
        warmCacheState: 'warm',
        frameTail: {
          sampleWindowMs: 5000,
          longFrameCount: 1,
          maxFrameGapMs: 47.2,
          p95FrameGapMs: 22.1,
          p99FrameGapMs: 47.2
        }
      },
      schedulerVerification: {
        schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
        status: 'scheduler-unverified',
        classification: 'config-only',
        observationClass: 'observed-stage-boundary',
        downgrades: ['yield-events-missing'],
        eventTrace: {
          schema: 'kaminos.webgpu-scheduler-event-trace.v0',
          clock: 'performance.now',
          timingAuthority: 'queue-submit-wait',
          events: []
        },
        boundaryAssertions: [
          { field: 'stage.backbone', status: 'observed', observedBoundary: 'backbone', observedCount: 1 },
          { field: 'stage.decoder-heads', status: 'observed', observedBoundary: 'decoder-heads', observedCount: 1 },
          { field: 'stage.output-readback', status: 'observed', observedBoundary: 'output-readback', observedCount: 1 }
        ]
      }
    }
  },
  sideArtifacts: [
    { id: 'depthMap', role: 'depth-map', path: depthPath },
    { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropPath, schema: 'kaminos.splat-autocrop-evidence.v0' }
  ]
}, null, 2) + '\\n');
`);
  const chmodResult = spawnSync('chmod', ['755', mockAdapterCommand], { encoding: 'utf8' });
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
      KAMINOS_SHARP_COMMAND: mockAdapterCommand,
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const route = report.stages[0].effectiveRoute;
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.status, 'scheduler-unverified');
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.classification, 'config-only');
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.observationClass, 'observed-stage-boundary');
  assert.deepEqual(route.adapterReport.pipelineScheduler.schedulerVerification.downgrades, ['yield-events-missing']);
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.eventTrace.timingAuthority, 'queue-submit-wait');
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.boundaryAssertions.length, 3);
  assert.deepEqual(
    route.pipelineScheduler.schedulerVerification,
    route.adapterReport.pipelineScheduler.schedulerVerification,
  );
} finally {
  rmSync(mogeReceiptRoot, { recursive: true, force: true });
}

const invalidReceiptRoot = mkdtempSync(join(tmpdir(), 'kaminos-invalid-route-receipt-'));
try {
  const inputPath = join(invalidReceiptRoot, 'source.png');
  const outDir = join(invalidReceiptRoot, 'live-out');
  const reportPath = join(invalidReceiptRoot, 'reports', 'live.json');
  const mockAdapterCommand = join(invalidReceiptRoot, 'mock-invalid-route-receipt-command.mjs');
  writeFileSync(inputPath, 'fake image bytes\n');
  writeFileSync(mockAdapterCommand, `#!/usr/bin/env node
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
  receipt: {
    schema: 'kaminos.webgpu-route-receipt.v0',
    requestedRouteId: 'moge.depth-normal.webgpu-local.v0',
    effectiveRouteId: 'moge.depth-normal.webgpu-local.v0',
    runtime: {
      schedulerVerification: {
        schema: 'kaminos.webgpu-scheduler-verification-receipt.v0',
        status: 'verified',
        classification: 'observed-boundary',
        observationClass: 'observed-stage-boundary',
        downgrades: ['yield-events-missing'],
        eventTrace: {
          schema: 'kaminos.webgpu-scheduler-event-trace.v0',
          clock: 'performance.now',
          timingAuthority: 'queue-submit-wait',
          events: []
        },
        boundaryAssertions: [
          { field: 'stage.backbone', status: 'verified', observedBoundary: 'backbone', observedCount: 1 }
        ]
      }
    }
  },
  sideArtifacts: [
    { id: 'depthMap', role: 'depth-map', path: depthPath },
    { id: 'metadata', role: 'sharp-webgpu-metadata', path: metadataPath },
    { id: 'autoCropEvidence', role: 'splat-autocrop-evidence', path: autoCropPath, schema: 'kaminos.splat-autocrop-evidence.v0' }
  ]
}, null, 2) + '\\n');
`);
  const chmodResult = spawnSync('chmod', ['755', mockAdapterCommand], { encoding: 'utf8' });
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
      KAMINOS_SHARP_COMMAND: mockAdapterCommand,
    },
  });

  assert.equal(run.status, 0, run.stderr || run.stdout);
  const report = JSON.parse(readFileSync(reportPath, 'utf8'));
  const route = report.stages[0].effectiveRoute;
  assert.equal(route.adapterReport.pipelineScheduler.source, 'route-receipt-non-authoritative');
  assert.equal(route.adapterReport.pipelineScheduler.routeReceiptClassification.classification, 'invalid');
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.reportedStatus, 'verified');
  assert.equal(route.adapterReport.pipelineScheduler.schedulerVerification.status, 'scheduler-unverified');
  assert.equal(route.adapterReport.pipelineScheduler.verificationState, 'scheduler-unverified');
  assert.ok(route.adapterReport.pipelineScheduler.failureDowngrades.includes('route-receipt-invalid'));
} finally {
  rmSync(invalidReceiptRoot, { recursive: true, force: true });
}
