import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

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
  },
  browserIdentity: {
    requested: { source: 'default-candidate' },
    effective: {
      executable: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      product: 'Chrome/140.0.0.0',
      userAgent: 'Mozilla/5.0 Chrome/140.0.0.0',
    },
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
      timeOriginEpochMs: 2000,
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
              timeOriginEpochMs: 2000,
            },
            sequenceEnvelope: eventSequence,
          },
          eventArchive: {
            schema: 'sharp-webgpu.scheduler-event-archive-ref.v0',
            status: 'resident-sealed',
            retention: 'uncapped',
            runId: firingId,
            eventCount: eventSequence.eventCount,
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
};

const evidence = createComposedWorldFireSharpEvidence(fixture);
assert.equal(evidence.schema, COMPOSED_WORLD_EVIDENCE_SCHEMA);
assert.equal(evidence.status, 'verified');
assert.equal(evidence.identity.firingId, firingId);
assert.equal(evidence.identity.kaminosRevision, fixture.kaminosRevision);
assert.equal(evidence.identity.sharpRevision, sharpRevision);
assert.equal(evidence.identity.webgpuInferenceKitVersion, '0.1.38');
assert.equal(evidence.clockJoin.foreground.sampleCount, samples.length);
assert.deepEqual(evidence.clockJoin.foreground.samples, samples);
assert.equal(evidence.terminalOutput.sha256, '6'.repeat(64));
assert.equal(evidence.route.requestedScheduler.mode, 'cooperative');
assert.match(evidence.claimCeiling, /exact named firing/i);
assert.doesNotMatch(evidence.claimCeiling, /under one minute/i);

const traceHtml = renderComposedWorldFireSharpTraceHtml(evidence);
assert.match(traceHtml, /Composed Fire \+ SHARP shared-clock trace/);
assert.match(traceHtml, new RegExp(firingId));
assert.match(traceHtml, /canvas/);
assert.match(traceHtml, /33\.5/);
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
