import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import {
  COMPOSED_WORLD_EVIDENCE_SCHEMA,
  createComposedWorldFireSharpEvidence,
  renderComposedWorldFireSharpTraceHtml,
} from '../lib/composed-world-evidence-spine.mjs';

const firingId = 'firing-composed-world-001';
const sharpRevision = 'b689f485d5d6f6c8868f21ad3d56d17e81cba44a';
const samples = [
  { sampleIndex: 0, timestampMs: 100, epochMs: 1100, frameGapMs: null, active: true },
  { sampleIndex: 1, timestampMs: 116.5, epochMs: 1116.5, frameGapMs: 16.5, active: true },
  { sampleIndex: 2, timestampMs: 150, epochMs: 1150, frameGapMs: 33.5, active: true },
];
const scheduler = {
  mode: 'cooperative',
  spnPatchChunkSize: 1,
  yieldMs: 4,
  gaussianPhaseYieldMs: 4,
  routeTailYieldMs: 3,
};

const schedulerEvents = [
  {
    sequence: 0,
    runId: firingId,
    phase: 'spn-patch-chunk',
    boundary: 'spn-patch-chunk',
    kind: 'queue-work-done-start',
    dutyId: `${firingId}:spn-patch-chunk:0`,
    tMs: 105,
    epochMs: 1105,
  },
  {
    sequence: 1,
    runId: firingId,
    phase: 'spn-patch-chunk',
    boundary: 'spn-patch-chunk',
    kind: 'queue-work-done-end',
    dutyId: `${firingId}:spn-patch-chunk:0`,
    tMs: 140,
    epochMs: 1140,
  },
];
const schedulerNdjson = `${schedulerEvents.map(event => JSON.stringify(event)).join('\n')}\n`;
const schedulerArtifact = {
  schema: 'kaminos.sharp-inline-trace-artifact.v0',
  path: '/durable/pipeline-runs/firing-composed-world-001/traces/scheduler-events.ndjson',
  readUrl: '/api/read?root=pipeline-runs&path=firing-composed-world-001%2Ftraces%2Fscheduler-events.ndjson',
  mediaType: 'application/x-ndjson',
  jsonPointer: '#/authoritativeTrace/sharpRunDebug/schedulerTelemetry/eventTrace/events',
  count: schedulerEvents.length,
  bytes: Buffer.byteLength(schedulerNdjson),
  sha256: createHash('sha256').update(schedulerNdjson).digest('hex'),
  retention: 'uncapped',
};

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const terminalOutput = {
  plySha256: '6'.repeat(64),
  plyByteLength: 66060836,
  numGaussians: 1179648,
  completeness: 'complete',
};
const eventSequence = {
  firstSequence: 0,
  lastSequence: 1,
  nextSequence: 2,
  eventCount: 2,
};
const routeMetadata = {
  schema: 'sharp.webgpu-route-metadata.v0',
  episodeId: firingId,
  terminalOutput,
  schedulerTrace: {
    runId: firingId,
    eventSequence,
    archiveIdentity: {
      schema: 'sharp.webgpu.scheduler-event-archive-identity.v0',
      runId: firingId,
      jsonPointer: '#/authoritativeTrace/sharpRunDebug/schedulerTelemetry/eventTrace/events',
      canonicalization: 'json-stringify-rows-utf8-ndjson-v1',
      encoding: 'utf-8',
      eventCount: schedulerEvents.length,
      bytes: Buffer.byteLength(schedulerNdjson),
      sha256: schedulerArtifact.sha256,
    },
  },
  routeId: 'sharp.image-to-splat.webgpu-local.v0',
};

const fixture = {
  kaminosRevision: 'f733cf63f3bef435194402fb97828098462db140',
  requestedInvocation: {
    url: 'http://127.0.0.1:8095/',
    fireFriendly: true,
    schedulerProfileId: 'cooperative-spn-gaussian',
    sourceAssetId: 'image:evil-orb-sharp-splat-render',
    firePresentation: 'full-volume',
    flameContinuity: 'live-every-frame',
    captureInFlight: false,
  },
  browserIdentity: {
    requested: { source: 'cli', executable: '/opt/playwright/chrome-headless-shell' },
    effective: {
      executable: '/opt/playwright/chrome-headless-shell',
      realPath: '/opt/playwright/chrome-headless-shell',
      kind: 'playwright-chromium-headless-shell',
      playwrightRevision: 1234,
      product: 'HeadlessChrome/140.0.0.0',
      protocolVersion: '1.3',
    },
    resolution: {
      schema: 'kaminos.headless-browser-resolution.v0',
      request: { source: 'cli', executable: '/opt/playwright/chrome-headless-shell' },
      requestedRealPath: '/opt/playwright/chrome-headless-shell',
      effective: {
        executable: '/opt/playwright/chrome-headless-shell',
        realPath: '/opt/playwright/chrome-headless-shell',
        kind: 'playwright-chromium-headless-shell',
        playwrightRevision: 1234,
        installedStableChrome: false,
      },
      fallbackPolicy: 'explicit-override-or-fail',
      rejectedCandidates: [],
    },
    session: {
      attachedBrowserProduct: 'HeadlessChrome/140.0.0.0',
      attachedProtocolVersion: '1.3',
      browserContextId: 'context-composed-world-001',
    },
  },
  kaminosHostIdentity: {
    requestedRevision: 'f733cf63f3bef435194402fb97828098462db140',
    effectiveRevision: 'f733cf63f3bef435194402fb97828098462db140',
    sourceRoot: '/private/tmp/kaminos-wake-composed-world-evidence-0827',
    status: 'matched',
  },
  sourceIdentity: {
    requestedAssetId: 'image:evil-orb-sharp-splat-render',
    effectiveAssetId: 'image:evil-orb-sharp-splat-render',
    source: '/api/read?root=image-assets&path=evil-orb.png',
    bytes: 1258291,
    sha256: '8'.repeat(64),
    postBytes: 1258291,
    postSha256: '8'.repeat(64),
  },
  webgpuInferenceKit: {
    sourceLockedVersion: '0.1.35',
    requestedVersion: '0.1.35',
    effectiveVersion: '0.1.35',
    status: 'matched',
  },
  fireActorProductReceipt: {
    schema: 'kaminos.wake-sharp-fire-actor-product-episode.v1',
    status: 'completed',
    firingId,
    mountId: `firemount-${'1'.repeat(64)}`,
    actorId: 'wake-kiln-flamebowl-hero',
    basinRevision: `basinrev-${'2'.repeat(64)}`,
    packageSha256: '3'.repeat(64),
    policyId: `firepolicy-${'4'.repeat(64)}`,
    sharp: {
      requestedRevision: sharpRevision,
      effectiveRevision: sharpRevision,
      sharedGpuExactObjectIdentityVerified: true,
    },
    carrier: {
      identity: 'kaminos.wake-sharp-promoted-fire-volume-adapter.v1',
      effectiveSha256: '5'.repeat(64),
    },
    effectivePresentation: {
      smokePresentation: 'on',
      fallbackReason: null,
    },
  },
  foregroundHeartbeat: {
    schema: 'kaminos.foreground-kiln-heartbeat.v0',
    status: 'verified',
    firingId,
    routeId: 'sharp-image-to-splat-live-v0',
    profileId: 'cooperative-spn-gaussian',
    pipelineId: 'sharp-image-to-splat-live-v0',
    sampleRetention: 'uncapped',
    sampleCount: samples.length,
    samples,
    startedAtMs: 100,
    finishedAtMs: 150,
    durationMs: 50,
    clock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: 1000,
    },
    requestedFireBudget: { identity: 'firepolicy-test', resolution: 128, renderScale: 0.25, adaptiveRays: 0.5 },
    effectiveFireBudget: { identity: 'firepolicy-test', resolution: 128, renderScale: 0.25, adaptiveRays: 0.5 },
    failures: [],
  },
  sharpDutyCorrelation: {
    schema: 'kaminos.foreground-sharp-duty-correlation.v0',
    status: 'verified',
    firingId,
    runId: firingId,
    timingAuthority: 'performance-time-origin-plus-now-cross-page-join',
    foregroundGapCount: 2,
    foregroundGaps: [
      { sampleIndex: 1, startEpochMs: 1100, endEpochMs: 1116.5, durationMs: 16.5, overlaps: [] },
      { sampleIndex: 2, startEpochMs: 1116.5, endEpochMs: 1150, durationMs: 33.5, overlaps: [] },
    ],
    foregroundClock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: 1000,
    },
    sharpClock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      runId: firingId,
      timeOriginEpochMs: 1000,
      inferenceWindowStartEpochMs: 1100,
      inferenceWindowEndEpochMs: 1150,
    },
    failures: [],
  },
  pipelineReport: {
    schema: 'kaminos.sharp-inline-pipeline-report.v0',
    status: 'real',
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectiveRouteConfig: {
      routeId: 'sharp-image-to-splat-live-v0',
      routeAuthority: 'same-browser-product-realm-shared-device',
    },
    durationMs: 50,
    outputRoot: '/durable/pipeline-runs/firing-composed-world-001',
    reportPath: '/durable/pipeline-runs/firing-composed-world-001/sharp-inline-report.json',
    traceArtifacts: {
      'scheduler-events': schedulerArtifact,
    },
    authoritativeTrace: {
      sharpRunDebug: {
        status: 'real',
        outputs: {
          numGaussians: terminalOutput.numGaussians,
          plyByteLength: terminalOutput.plyByteLength,
        },
        schedulerTelemetry: {
          schema: 'sharp-webgpu.scheduler-telemetry.v0',
          status: 'verified',
          runId: firingId,
          eventTrace: {
            clock: {
              schema: 'kaminos.browser-epoch-monotonic-clock.v0',
              timingAuthority: 'performance-time-origin-plus-now',
              timeOriginEpochMs: 1000,
            },
            sequenceEnvelope: eventSequence,
          },
          eventArchive: {
            schema: 'sharp-webgpu.scheduler-event-archive-ref.v0',
            status: 'resident-sealed',
            retention: 'uncapped',
            runId: firingId,
            eventCount: eventSequence.eventCount,
            traceArtifactRef: '#/traceArtifacts/scheduler-events',
          },
        },
        route: {
          requestedRouteId: 'sharp.image-to-splat.webgpu-local.v0',
          effectiveRouteId: 'sharp.image-to-splat.webgpu-local.v0',
          receiptError: null,
          receipt: {
            requestedRouteId: 'sharp.image-to-splat.webgpu-local.v0',
            effectiveRouteId: 'sharp.image-to-splat.webgpu-local.v0',
            kernel: {
              kitVersion: '0.1.38',
              profile: 'spn-dinov2l16-monodepth-gaussian-ply',
              commit: 'sharp-webgpu-browser-runtime',
            },
            metadataPayload: routeMetadata,
            outputs: [
              {
                role: 'splat-candidate',
                sha256: terminalOutput.plySha256,
                shape: [terminalOutput.numGaussians, 14],
              },
              {
                role: 'sharp-webgpu-metadata',
                sha256: sha256Json(routeMetadata),
                shape: [1],
              },
            ],
          },
        },
      },
    },
    artifacts: {
      splat: {
        status: 'real',
        path: 'sharp-inline-firing-composed-world-001.ply',
        bytes: 66060836,
        sha256: '6'.repeat(64),
      },
    },
    stages: [{
      status: 'real',
      effectiveRoute: {
        adapterReport: {
          schema: 'kaminos.sharp-inline-product-route-report.v0',
          status: 'real',
          firingId,
          revision: sharpRevision,
          effectiveRoute: 'same-browser-product-realm-shared-device',
          sharedGpu: {
            deviceIdentity: 'kaminos-volume-device:test',
            queueIdentity: 'kaminos-volume-queue:test',
            exactObjectIdentityVerified: true,
          },
          webgpuInferenceKit: {
            sourceLockedVersion: '0.1.38',
            requestedVersion: '0.1.38',
            effectiveVersion: '0.1.38',
            status: 'matched',
          },
          requestedScheduler: { ...scheduler },
          effectiveScheduler: { ...scheduler },
        },
      },
    }],
  },
  schedulerArchive: {
    artifact: schedulerArtifact,
    rawNdjson: schedulerNdjson,
    bytes: Buffer.byteLength(schedulerNdjson),
    sha256: schedulerArtifact.sha256,
    rows: schedulerEvents,
  },
};

const fireBudget = fixture.foregroundHeartbeat.requestedFireBudget;
const fireHook = (status, phase, finishedAtMs = null) => ({
  identity: 'foreground-kiln-fire-episode-hooks-v0',
  firingId,
  generation: 1,
  phase,
  status,
  evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
  authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
  routeIdentity: {
    effectiveRoute: 'native-3d-compute-fluid-raymarch-v0',
    prototypeIdentity: 'wake-sharp-promoted-fire-volume-adapter-v1',
    volumeScene: 'crucible-volume-scene',
    flameRendererIdentity: 'fireactor-promoted-volume-v1',
    learnedModelIdentity: 'fireactor-9b70310e',
    fallbackReason: null,
    compositionRequested: 'hybrid-smoke',
    compositionEffective: 'hybrid-smoke',
    compositionFallbackReason: null,
  },
  sampleCount: 3,
  frameAdvanceCount: 2,
  simStepAdvanceCount: 2,
  startedAtMs: 100,
  finishedAtMs,
});
fixture.foregroundHeartbeat.samples = fixture.foregroundHeartbeat.samples.map((sample, index) => ({
  ...sample,
  routeIdentity: 'native-3d-compute-fluid-raymarch-v0',
  prototypeIdentity: 'wake-sharp-promoted-fire-volume-adapter-v1',
  frameCount: 10 + index,
  simStepCount: 20 + index,
  fireBudget,
  firePresentation: { mode: 'learned-splat-flame-raymarched-smoke' },
  fireEpisodeHooks: index === fixture.foregroundHeartbeat.samples.length - 1
    ? fireHook('complete', 'complete', 150)
    : fireHook('recording', 'recording'),
}));
fixture.fireActorProductReceipt.foregroundHookIdentity = {
  identity: 'foreground-kiln-fire-episode-hooks-v0',
  evidenceSource: 'foreground-volume-render-loop-raf-sim-step-and-queue-proxy-v0',
  authority: 'renderer-simulator-hooks-for-wake-foreground-heartbeat',
  generation: 1,
  routeIdentity: structuredClone(fireHook('recording', 'recording').routeIdentity),
};
Object.assign(fixture.foregroundHeartbeat, {
  expectedVolumeRouteIdentity: 'native-3d-compute-fluid-raymarch-v0',
  requireExactFireEpisode: true,
  effectiveFireEpisodeHooks: fireHook('complete', 'complete', 150),
  startedAtEpochMs: 1100,
  finishedAtEpochMs: 1150,
  frameCountStart: 10,
  frameCountEnd: 12,
  frameCountDelta: 2,
  simStepCountStart: 20,
  simStepCountEnd: 22,
  simStepCountDelta: 2,
});
fixture.sharpDutyCorrelation.foregroundGaps = [
  {
    sampleIndex: 1,
    startEpochMs: 1100,
    endEpochMs: 1116.5,
    durationMs: 16.5,
    attributedDurationMs: 11.5,
    unattributedDurationMs: 5,
    overlaps: [{
      runId: firingId,
      dutyId: `${firingId}:spn-patch-chunk:0`,
      phase: 'spn-patch-chunk',
      boundary: 'spn-patch-chunk',
      startEpochMs: 1105,
      endEpochMs: 1116.5,
      overlapDurationMs: 11.5,
    }],
  },
  {
    sampleIndex: 2,
    startEpochMs: 1116.5,
    endEpochMs: 1150,
    durationMs: 33.5,
    attributedDurationMs: 23.5,
    unattributedDurationMs: 10,
    overlaps: [{
      runId: firingId,
      dutyId: `${firingId}:spn-patch-chunk:0`,
      phase: 'spn-patch-chunk',
      boundary: 'spn-patch-chunk',
      startEpochMs: 1116.5,
      endEpochMs: 1140,
      overlapDurationMs: 23.5,
    }],
  },
];
Object.assign(fixture.sharpDutyCorrelation, {
  phaseRankings: [{ phase: 'spn-patch-chunk', overlapDurationMs: 35 }],
  boundaryRankings: [{ boundary: 'spn-patch-chunk', overlapDurationMs: 35 }],
  totals: {
    foregroundGapDurationMs: 50,
    attributedDurationMs: 35,
    unattributedDurationMs: 15,
    attributedFraction: 0.7,
  },
});

const evidence = createComposedWorldFireSharpEvidence(fixture);
assert.equal(evidence.schema, COMPOSED_WORLD_EVIDENCE_SCHEMA);
assert.equal(evidence.status, 'verified');
assert.equal(evidence.identity.firingId, firingId);
assert.equal(evidence.identity.kaminosRevision, fixture.kaminosRevision);
assert.equal(evidence.identity.sharpRevision, sharpRevision);
assert.equal(evidence.identity.webgpuInferenceKitVersion, '0.1.38');
assert.equal(evidence.clockJoin.foreground.sampleCount, samples.length);
assert.deepEqual(evidence.clockJoin.foreground.samples, fixture.foregroundHeartbeat.samples);
assert.equal(evidence.terminalOutput.sha256, '6'.repeat(64));
assert.equal(evidence.route.requestedScheduler.mode, 'cooperative');
assert.match(evidence.claimCeiling, /exact named firing/i);
assert.doesNotMatch(evidence.claimCeiling, /under one minute/i);

const traceHtml = renderComposedWorldFireSharpTraceHtml(evidence);
if (process.env.KAMINOS_COMPOSED_TRACE_OUT) {
  writeFileSync(process.env.KAMINOS_COMPOSED_TRACE_OUT, traceHtml);
}
assert.match(traceHtml, /Composed Fire \+ SHARP shared-clock trace/);
assert.match(traceHtml, new RegExp(firingId));
assert.match(traceHtml, /canvas/);
assert.match(traceHtml, /33\.5/);
assert.match(traceHtml, /SHARP host-await overlap/);
assert.match(traceHtml, /Unattributed remainder/);
assert.match(traceHtml, /"attributedDurationMs":11\.5/);
assert.match(traceHtml, /"unattributedDurationMs":5/);
assert.match(traceHtml, /inferenceWindowStartEpochMs/);
assert.match(traceHtml, /canvas\.clientWidth[\s\S]*devicePixelRatio/);
assert.doesNotMatch(traceHtml, /undefined/);

function rejects(name, mutate, pattern) {
  const candidate = structuredClone(fixture);
  mutate(candidate);
  assert.throws(
    () => createComposedWorldFireSharpEvidence(candidate),
    pattern,
    `${name} must not close the composed-world claim`,
  );
}

function replaceSchedulerRows(value, rows) {
  const rawNdjson = `${rows.map(row => JSON.stringify(row)).join('\n')}\n`;
  const descriptor = {
    ...value.pipelineReport.traceArtifacts['scheduler-events'],
    count: rows.length,
    bytes: Buffer.byteLength(rawNdjson),
    sha256: createHash('sha256').update(rawNdjson).digest('hex'),
  };
  value.schedulerArchive = {
    artifact: structuredClone(descriptor),
    rawNdjson,
    bytes: descriptor.bytes,
    sha256: descriptor.sha256,
    rows: structuredClone(rows),
  };
  value.pipelineReport.traceArtifacts['scheduler-events'] = structuredClone(descriptor);
}

rejects('capped foreground samples', value => {
  value.foregroundHeartbeat.sampleRetention = 'top-100';
}, /uncapped foreground samples/);
rejects('partial foreground samples', value => {
  value.foregroundHeartbeat.samples.pop();
}, /foreground sample count/);
rejects('reordered foreground clock', value => {
  value.foregroundHeartbeat.samples[2].epochMs = 1101;
}, /foreground sample order/);
rejects('foreground epoch drift', value => {
  value.foregroundHeartbeat.samples[1].epochMs += 4;
}, /foreground sample clock/);
rejects('partial correlation gaps', value => {
  value.sharpDutyCorrelation.foregroundGaps.pop();
}, /correlation gap count/);
rejects('stale firing receipt', value => {
  value.fireActorProductReceipt.firingId = 'firing-stale';
}, /FireActor firing identity/);
rejects('substituted FireActor package', value => {
  value.fireActorProductReceipt.packageSha256 = null;
}, /FireActor package identity/);
rejects('presentation fallback', value => {
  value.fireActorProductReceipt.effectivePresentation.fallbackReason = 'research-fallback';
}, /FireActor presentation fallback/);
rejects('SHARP revision drift', value => {
  value.pipelineReport.stages[0].effectiveRoute.adapterReport.revision = '7'.repeat(40);
}, /SHARP revision identity/);
rejects('shared GPU fallback', value => {
  value.pipelineReport.stages[0].effectiveRoute.adapterReport.sharedGpu.exactObjectIdentityVerified = false;
}, /shared GPU identity/);
rejects('scheduler fallback', value => {
  value.pipelineReport.stages[0].effectiveRoute.adapterReport.effectiveScheduler.yieldMs = 16;
}, /requested\/effective scheduler/);
rejects('source selection fallback', value => {
  value.sourceIdentity.effectiveAssetId = 'image:fallback';
}, /source identity/);
rejects('source bytes changed during firing', value => {
  value.sourceIdentity.postSha256 = '9'.repeat(64);
}, /source content identity/);
rejects('runtime package fallback', value => {
  value.webgpuInferenceKit.effectiveVersion = '0.1.34';
}, /WebGPU inference kit identity/);
rejects('SHARP inline runtime package fallback', value => {
  value.pipelineReport.authoritativeTrace.sharpRunDebug.route.receipt.kernel.kitVersion = '0.1.37';
}, /WebGPU inference kit identity|kit/i);
rejects('partial terminal output', value => {
  value.pipelineReport.artifacts.splat.sha256 = null;
}, /terminal output SHA-256/);
rejects('missing terminal bytes', value => {
  value.pipelineReport.artifacts.splat.bytes = null;
}, /terminal output byte count/);
rejects('foreign authenticated SHARP episode', value => {
  const runDebug = value.pipelineReport.authoritativeTrace.sharpRunDebug;
  runDebug.schedulerTelemetry.runId = 'firing-foreign-episode';
  runDebug.schedulerTelemetry.eventArchive.runId = 'firing-foreign-episode';
  runDebug.route.receipt.metadataPayload.episodeId = 'firing-foreign-episode';
  runDebug.route.receipt.metadataPayload.schedulerTrace.runId = 'firing-foreign-episode';
  runDebug.route.receipt.outputs.find(output => output.role === 'sharp-webgpu-metadata').sha256 = sha256Json(
    runDebug.route.receipt.metadataPayload,
  );
}, /episode|run identity/i);
rejects('mutated SHARP metadata payload', value => {
  value.pipelineReport.authoritativeTrace.sharpRunDebug.route.receipt.metadataPayload.terminalOutput.numGaussians -= 1;
}, /metadata.*SHA-256|authenticate/i);
rejects('spliced terminal PLY byte length', value => {
  const runDebug = value.pipelineReport.authoritativeTrace.sharpRunDebug;
  runDebug.route.receipt.metadataPayload.terminalOutput.plyByteLength -= 4;
  runDebug.route.receipt.outputs.find(output => output.role === 'sharp-webgpu-metadata').sha256 = sha256Json(
    runDebug.route.receipt.metadataPayload,
  );
}, /PLY byte|terminal output/i);
rejects('missing retained scheduler archive', value => {
  delete value.pipelineReport.traceArtifacts['scheduler-events'];
}, /scheduler archive|trace artifact/i);
rejects('repaired-count scheduler archive deletion', value => {
  value.schedulerArchive.rows.shift();
  value.schedulerArchive.rows[0].sequence = 0;
  value.schedulerArchive.artifact.count = 1;
  value.schedulerArchive.bytes = Buffer.byteLength(`${JSON.stringify(value.schedulerArchive.rows[0])}\n`);
  value.schedulerArchive.sha256 = createHash('sha256')
    .update(`${JSON.stringify(value.schedulerArchive.rows[0])}\n`)
    .digest('hex');
}, /scheduler archive|event sequence|event count/i);
rejects('fully rehashed scheduler phase rewrite', value => {
  replaceSchedulerRows(value, value.schedulerArchive.rows.map(row => ({
    ...row,
    phase: 'forged-phase',
    boundary: 'forged-boundary',
  })));
  for (const gap of value.sharpDutyCorrelation.foregroundGaps) {
    for (const overlap of gap.overlaps) {
      overlap.phase = 'forged-phase';
      overlap.boundary = 'forged-boundary';
    }
  }
  value.sharpDutyCorrelation.phaseRankings = [{ phase: 'forged-phase', overlapDurationMs: 35 }];
  value.sharpDutyCorrelation.boundaryRankings = [{ boundary: 'forged-boundary', overlapDurationMs: 35 }];
}, /scheduler archive.*identity|authenticated scheduler|source-owned scheduler/i);
rejects('foreign same-origin scheduler artifact path', value => {
  const foreign = {
    ...value.pipelineReport.traceArtifacts['scheduler-events'],
    path: '/durable/pipeline-runs/foreign-run/traces/scheduler-events.ndjson',
    readUrl: '/api/read?root=pipeline-runs&path=foreign-run%2Ftraces%2Fscheduler-events.ndjson',
  };
  value.pipelineReport.traceArtifacts['scheduler-events'] = structuredClone(foreign);
  value.schedulerArchive.artifact = structuredClone(foreign);
}, /scheduler.*path|scheduler.*run|artifact.*identity/i);
rejects('all-inactive foreground samples', value => {
  for (const sample of value.foregroundHeartbeat.samples) sample.active = false;
}, /foreground.*active|FireActor.*live/i);
rejects('forged FireActor hook authority', value => {
  value.foregroundHeartbeat.samples[1].fireEpisodeHooks.authority = 'caller-asserted';
}, /FireActor.*authority|hook.*authority/i);
rejects('substituted FireActor hook route', value => {
  value.foregroundHeartbeat.samples[1].fireEpisodeHooks.routeIdentity.effectiveRoute = 'fallback-volume-route';
}, /FireActor.*route|hook.*route/i);
rejects('self-consistent fallback FireActor prototype', value => {
  for (const sample of value.foregroundHeartbeat.samples) {
    sample.prototypeIdentity = 'fallback-prototype';
    sample.fireEpisodeHooks.routeIdentity.prototypeIdentity = 'fallback-prototype';
  }
  value.foregroundHeartbeat.effectiveFireEpisodeHooks.routeIdentity.prototypeIdentity = 'fallback-prototype';
}, /FireActor.*prototype|promoted.*hook/i);
rejects('missing FireActor hook composition authority', value => {
  for (const sample of value.foregroundHeartbeat.samples) {
    delete sample.fireEpisodeHooks.routeIdentity.compositionRequested;
    delete sample.fireEpisodeHooks.routeIdentity.compositionEffective;
  }
  delete value.foregroundHeartbeat.effectiveFireEpisodeHooks.routeIdentity.compositionRequested;
  delete value.foregroundHeartbeat.effectiveFireEpisodeHooks.routeIdentity.compositionEffective;
  delete value.fireActorProductReceipt.foregroundHookIdentity.routeIdentity.compositionRequested;
  delete value.fireActorProductReceipt.foregroundHookIdentity.routeIdentity.compositionEffective;
}, /FireActor.*composition|hook.*composition/i);
rejects('non-exact FireActor episode', value => {
  value.foregroundHeartbeat.requireExactFireEpisode = false;
}, /exact FireActor|exact.*episode/i);
rejects('fabricated SHARP correlation rows', value => {
  value.sharpDutyCorrelation.foregroundGaps = [{ fabricated: true }, { fabricated: true }];
}, /correlation|foreground gap/i);
rejects('foreign effective Kaminos host', value => {
  value.kaminosHostIdentity.effectiveRevision = '0'.repeat(40);
}, /Kaminos.*revision|host identity/i);
rejects('browser request/effective substitution', value => {
  value.browserIdentity.resolution.effective.realPath = '/opt/substituted/chrome';
  value.browserIdentity.resolution.effective.executable = '/opt/substituted/chrome';
}, /browser.*request|browser.*effective|substitution/i);
rejects('browser effective real-path substitution', value => {
  value.browserIdentity.resolution.effective.realPath = '/opt/substituted/chrome';
  value.browserIdentity.effective.realPath = '/opt/substituted/chrome';
}, /browser.*real path|browser.*substitution/i);
rejects('observer-effect capture enabled', value => {
  value.requestedInvocation.captureInFlight = true;
}, /capture|observer/i);

assert.throws(
  () => createComposedWorldFireSharpEvidence({
    ...structuredClone(fixture),
    failure: {
      phase: null,
      error: 'browser died',
      lastTrustworthyEvidence: null,
    },
  }),
  /failure phase and last trustworthy evidence/,
  'a pre-output failure must remain durably diagnosable',
);

const witnessSource = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
assert.match(
  witnessSource,
  /from '\.\/lib\/composed-world-evidence-spine\.mjs'/,
  'the product witness must consume the validated composed-world evidence module',
);

const pageSource = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.match(
  pageSource,
  /inline\.run\(sourceBlob, \{[\s\S]{0,500}episodeId:\s*firingId/,
  'Kaminos must inject the FireActor firing id as the SHARP scheduler and route-receipt episode id',
);
for (const flag of [
  'composed-world-evidence-out',
  'composed-world-trace-out',
  'expected-kaminos-revision',
]) {
  assert.match(witnessSource, new RegExp(flag), `the exact evidence route must expose --${flag}`);
}
assert.match(
  witnessSource,
  /fireActorProductReceipt:\s*fireActorProductReceipt/,
  'the browser snapshot must preserve the terminal promoted FireActor receipt',
);
assert.match(
  witnessSource,
  /effectiveSource:\s*effectiveSource/,
  'the browser snapshot must preserve the exact selected source route',
);
assert.match(
  witnessSource,
  /createComposedWorldFireSharpEvidence\(\{/,
  'the witness must validate the joined exact-route evidence before publication',
);
assert.match(
  witnessSource,
  /renderComposedWorldFireSharpTraceHtml\(/,
  'the compact plot must derive from the validated evidence document',
);
assert.match(
  witnessSource,
  /COMPOSED_WORLD_EVIDENCE_FAILURE_SCHEMA[\s\S]*lastTrustworthyEvidence/,
  'pre-evidence failures must still persist their phase and last trustworthy evidence',
);

console.log('Composed-world FireActor + SHARP evidence spine contracts passed');
