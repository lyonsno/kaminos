import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

import { createSchedulerVerificationReceipt } from '../lib/scheduler-verification-receipt.mjs';

const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
const witnessPath = new URL('../crucible-viewport-witness.mjs', import.meta.url);
assert.match(
  witness,
  /consoleState:\s*workspace\?\.dataset\.crucibleConsoleState/,
  'Visual witness must record whether the Crucible is expanded or tucked',
);
assert.match(
  witness,
  /const viewportWidth\s*=\s*Number\(args\.get\('viewport-width'\)[\s\S]*const viewportHeight\s*=\s*Number\(args\.get\('viewport-height'\)/,
  'Visual witness must exercise workstation layouts narrower than its default capture',
);
assert.match(
  witness,
  /completedWorkroom\.consoleState\s*!==\s*'tucked'/,
  'A completed cast must fail visual acceptance if the caddy did not tuck',
);
assert.match(
  witness,
  /completedWorkroom\.caddyOccupancy\s*>\s*0\.4/,
  'A completed cast must fail visual acceptance when the caddy consumes more than forty percent of its actual scene workspace',
);
assert.match(
  witness,
  /consoleToggleExercise[\s\S]*expandedState[\s\S]*retuckedState[\s\S]*castTargetPreserved/,
  'Visual witness must actuate open and tuck and reject any presentation toggle that loses cast custody',
);
assert.match(
  witness,
  /tuckedSidebarWidth[\s\S]*expandedSidebarWidth[\s\S]*retuckedSidebarWidth/,
  'Visual witness must prove the caddy releases sidebar width and restores navigation with the full bench',
);
assert.match(
  witness,
  /Math\.abs\(state\.(?:replayedCast|fullRoute)\.completedWorkroom\.sceneCanvasWidth\s*-\s*state\.(?:replayedCast|fullRoute)\.completedWorkroom\.sceneViewportWidth\)\s*>\s*2/,
  'Visual witness must reject a renderer canvas that retains the old sidebar-constrained width',
);
assert.match(
  witness,
  /castScreenX\s*<\s*state\.(?:replayedCast|fullRoute)\.completedWorkroom\.stageRight\s*\+\s*24/,
  'Visual witness must reject a selected cast whose projected center remains behind the caddy',
);
assert.match(
  witness,
  /function clickVisibleElementCenter\([\s\S]*document\.elementFromPoint[\s\S]*Input\.dispatchMouseEvent/,
  'Visual witness must actuate the console toggle through a real visible hit target rather than DOM click',
);
assert.doesNotMatch(
  witness,
  /button\?\.click\(\)/,
  'Visual witness must not bypass hit testing for the console toggle',
);
const argumentFailureRoot = mkdtempSync(join(tmpdir(), 'kaminos-crucible-replay-args-'));
try {
  const argumentFailureReport = join(argumentFailureRoot, 'witness.json');
  const argumentFailure = spawnSync(process.execPath, [
    witnessPath.pathname,
    '--replay-cast-report', join(argumentFailureRoot, 'completed-pipeline-witness.json'),
    '--fire-friendly',
    '--report', argumentFailureReport,
    '--out', join(argumentFailureRoot, 'should-not-exist.png'),
  ], { encoding: 'utf8' });
  assert.notEqual(argumentFailure.status, 0, 'replay and live inference flags must conflict');
  assert.equal(existsSync(argumentFailureReport), true, 'replay argument rejection must still write the requested durable witness report');
  const argumentFailureDocument = JSON.parse(readFileSync(argumentFailureReport, 'utf8'));
  assert.equal(argumentFailureDocument.ok, false);
  assert.equal(argumentFailureDocument.phase, 'validating-arguments');
  assert.equal(argumentFailureDocument.primaryOutputWritten, false);
  assert.deepEqual(argumentFailureDocument.requestedInvocation, {
    url: 'http://127.0.0.1:8095/',
    screenshot: join(argumentFailureRoot, 'should-not-exist.png'),
    reportPath: argumentFailureReport,
    fireFriendly: true,
    replayCastReportPath: join(argumentFailureRoot, 'completed-pipeline-witness.json'),
    schedulerProfileId: 'cooperative-spn-gaussian',
    sourceAssetId: null,
    firePresentation: 'full-volume',
    flameContinuity: 'live-every-frame',
    captureInFlight: false,
    requireFrameStageLedger: false,
  });
  assert.deepEqual(argumentFailureDocument.effectiveIdentity, {
    sourceAssetId: null,
    workroomSourceAssetId: null,
    source: null,
    requestedPipelineId: null,
    effectiveRouteId: null,
    scheduler: null,
    fireBudget: null,
    output: null,
  });
  assert.match(argumentFailureDocument.error, /cannot be combined/);
  assert.equal(existsSync(join(argumentFailureRoot, 'should-not-exist.png')), false, 'argument rejection must happen before browser capture');
} finally {
  rmSync(argumentFailureRoot, { recursive: true, force: true });
}
const schedulerExpectationSource = witness.match(
  /function expectedSchedulerForProfile\([\s\S]*?\n}\n(?=\nfunction )/,
);
assert.ok(schedulerExpectationSource, 'witness must expose a testable scheduler expectation for each experimental run profile');
const expectedSchedulerForProfile = vm.runInNewContext(`(${schedulerExpectationSource[0]})`);
assert.deepEqual(
  JSON.parse(JSON.stringify(expectedSchedulerForProfile('cooperative-spn-gaussian'))),
  {
    mode: 'cooperative',
    spnPatchChunkSize: 1,
    yieldMs: 4,
    waitForSubmittedWorkDone: true,
    gaussianPhaseYieldMs: 4,
    vitBlockChunkSize: 1,
    vitMicroduty: true,
    vitMicrodutyMode: 'dispatch-major',
    cpuChunkItems: 16384,
    routeTailYieldMs: 3,
    spnFusionChunkItems: 524288,
    decoderKernelChunkItems: 524288,
    plyAssemblyMode: 'worker',
    retirePostInferenceBuffers: true,
  },
  'ordinary Friendly must exercise reviewed ViT microduties and tiled SPN fusion',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(expectedSchedulerForProfile('cooperative-fixed-16ms-donation'))),
  {
    mode: 'cooperative',
    spnPatchChunkSize: 1,
    yieldMs: 16,
    waitForSubmittedWorkDone: true,
    gaussianPhaseYieldMs: 16,
    vitBlockChunkSize: 1,
    vitMicroduty: true,
    vitMicrodutyMode: 'dispatch-major',
    cpuChunkItems: 16384,
    routeTailYieldMs: 16,
    spnFusionChunkItems: 524288,
    decoderKernelChunkItems: 524288,
    plyAssemblyMode: 'worker',
    retirePostInferenceBuffers: true,
  },
  'fixed-boundary experiment must not change chunk granularity or silently inherit ordinary Friendly donations',
);
assert.deepEqual(
  JSON.parse(JSON.stringify(expectedSchedulerForProfile('cooperative-spn-fusion-tiles-524288'))),
  {
    mode: 'cooperative',
    spnPatchChunkSize: 1,
    yieldMs: 4,
    waitForSubmittedWorkDone: true,
    gaussianPhaseYieldMs: 4,
    vitBlockChunkSize: 1,
    vitMicroduty: true,
    vitMicrodutyMode: 'dispatch-major',
    cpuChunkItems: 16384,
    routeTailYieldMs: 3,
    spnFusionChunkItems: 524288,
    decoderKernelChunkItems: 524288,
    plyAssemblyMode: 'worker',
    retirePostInferenceBuffers: true,
  },
  'SPN fusion tiling experiment must add only the reviewed output tile size to ordinary Friendly',
);
assert.throws(
  () => expectedSchedulerForProfile('cooperative-typo'),
  /Unsupported --scheduler-profile/,
  'unknown scheduler profiles must fail before a GPU run instead of falling back',
);

const spnFusionValidationSource = witness.match(
  /function validateSpnFusionTileEvidence\([\s\S]*?\n}/,
);
assert.ok(spnFusionValidationSource, 'witness must expose a testable SPN fusion tile authority gate');
const validateSpnFusionTileEvidence = vm.runInNewContext(`(${spnFusionValidationSource[0]})`);
const decoderKernelValidationSource = witness.match(
  /function validateDecoderKernelTileEvidence\([\s\S]*?\n}/,
);
assert.ok(decoderKernelValidationSource, 'witness must expose a testable decoder kernel tiling authority gate');
const validateDecoderKernelTileEvidence = vm.runInNewContext(`(${decoderKernelValidationSource[0]})`);
const spnFusionTileEvents = [
  { phase: 'spn-fusion', boundary: 'spn-fusion', kind: 'chunk-start', role: 'spn-fusion-output-chunk', block: 'upsample0.layer-1.output-chunk-0', parentBlock: 'upsample0.layer-1', outputChunkIndex: 0, outputChunkCount: 2, outputStart: 0, outputEnd: 524288, outputCount: 524288, totalOutputItems: 1048576 },
  { phase: 'spn-fusion', boundary: 'spn-fusion', kind: 'chunk-start', chunkRole: 'spn-fusion-output-chunk', block: 'upsample0.layer-1', parentBlock: 'upsample0', outputChunkIndex: 1, outputChunkCount: 2, outputStart: 524288, outputEnd: 1048576, outputCount: 524288, totalOutputItems: 1048576 },
];
const normalizedSpnFusionReceipt = createSchedulerVerificationReceipt({
  route: {
    pipelineId: 'sharp-image-to-splat-live-v0',
    requestedRouteId: 'adapter.sharp-image-to-splat-live.v0',
    effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
    backendClass: 'browser-webgpu',
  },
  scheduler: {
    schema: 'kaminos.webgpu-route-scheduler.v0',
    requestedScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { spnFusionOutputItems: 524288 },
    },
    effectiveScheduler: {
      mode: 'cooperative',
      phaseChunkSize: { spnFusionOutputItems: 524288 },
      unsupportedFields: [],
    },
    verificationState: 'verified',
  },
  backpressure: {
    schema: 'kaminos.webgpu-route-backpressure.v0',
    requestedBudget: 'visible-wait',
    effectiveBudget: 'visible-wait',
  },
  eventTrace: {
    schema: 'kaminos.webgpu-scheduler-event-trace.v0',
    clock: 'performance.now',
    timingAuthority: 'queue-submit-wait',
    events: spnFusionTileEvents,
  },
  boundaryAssertions: [{
    field: 'phaseChunkSize.spnFusionOutputItems',
    requested: 524288,
    effective: 524288,
    status: 'verified',
    observedCount: 2,
    observedBoundary: 'spn-fusion',
  }],
});
assert.equal(normalizedSpnFusionReceipt.status, 'verified', 'event-backed SPN fusion output ranges must remain verified after receipt normalization');
assert.equal(normalizedSpnFusionReceipt.boundaryAssertions[0].status, 'verified');
const validSpnFusionEvidence = {
  schedulerBoundaryAssertions: normalizedSpnFusionReceipt.boundaryAssertions,
  spnFusionTileEvents,
};
assert.deepEqual(
  JSON.parse(JSON.stringify(validateSpnFusionTileEvidence({
    profileId: 'cooperative-spn-gaussian',
    expectedChunkItems: 524288,
    fullRoute: validSpnFusionEvidence,
  }))),
  [],
  'verified requested/effective config and contiguous multi-range events must admit the experiment',
);
assert.ok(validateSpnFusionTileEvidence({
  profileId: 'cooperative-spn-gaussian',
  expectedChunkItems: 524288,
  fullRoute: { schedulerBoundaryAssertions: [], spnFusionTileEvents: [] },
}).includes('boundary-assertion-missing'), 'ordinary Friendly must fail loud when promoted SPN tiling evidence is absent');
for (const [mutate, expectedFailure] of [
  [evidence => { evidence.schedulerBoundaryAssertions = []; }, 'boundary-assertion-missing'],
  [evidence => { evidence.schedulerBoundaryAssertions[0].status = 'unverified'; }, 'boundary-assertion-unverified'],
  [evidence => { evidence.spnFusionTileEvents = evidence.spnFusionTileEvents.slice(0, 1); }, 'multi-range-events-missing'],
  [evidence => { evidence.spnFusionTileEvents[1].outputStart = 500000; }, 'range-coverage-invalid'],
]) {
  const evidence = JSON.parse(JSON.stringify(validSpnFusionEvidence));
  mutate(evidence);
  assert.ok(validateSpnFusionTileEvidence({
    profileId: 'cooperative-spn-fusion-tiles-524288',
    expectedChunkItems: 524288,
    fullRoute: evidence,
  }).includes(expectedFailure), expectedFailure);
}

const decoderKernelTileEvents = [
  { phase: 'decoder.fusion.4.conv1', boundary: 'gaussian-phase', role: 'decoder-kernel-output-tile', configuredChunkItems: 524288, tileIndex: 0, tileTotal: 2, outputStart: 0, outputEnd: 524288, outputCount: 524288, totalOutputItems: 1048576 },
  { phase: 'decoder.fusion.4.conv1', boundary: 'gaussian-phase', role: 'decoder-kernel-output-tile', configuredChunkItems: 524288, tileIndex: 1, tileTotal: 2, outputStart: 524288, outputEnd: 1048576, outputCount: 524288, totalOutputItems: 1048576 },
];
const validDecoderKernelEvidence = {
  schedulerBoundaryAssertions: [{
    field: 'decoderKernelChunkItems',
    requested: 524288,
    effective: 524288,
    status: 'verified',
    observedCount: 2,
    observedKernel: { boundary: 'gaussian-phase', phase: 'decoder.fusion.4.conv1', tileTotal: 2, totalOutputItems: 1048576 },
  }],
  decoderKernelTileEvents,
};
assert.deepEqual(
  JSON.parse(JSON.stringify(validateDecoderKernelTileEvidence({
    expectedChunkItems: 524288,
    fullRoute: validDecoderKernelEvidence,
  }))),
  [],
  'one exact multi-tile decoder kernel and its verified assertion must admit the Friendly witness',
);
for (const [mutate, expectedFailure] of [
  [evidence => { evidence.schedulerBoundaryAssertions = []; }, 'boundary-assertion-missing'],
  [evidence => { evidence.schedulerBoundaryAssertions[0].status = 'unverified'; }, 'boundary-assertion-unverified'],
  [evidence => { evidence.schedulerBoundaryAssertions[0].effective = 1048576; }, 'boundary-assertion-config-mismatch'],
  [evidence => { evidence.decoderKernelTileEvents = evidence.decoderKernelTileEvents.slice(0, 1); }, 'multi-range-events-missing'],
  [evidence => { evidence.decoderKernelTileEvents[1].outputStart = 500000; }, 'range-coverage-invalid'],
]) {
  const evidence = JSON.parse(JSON.stringify(validDecoderKernelEvidence));
  mutate(evidence);
  assert.ok(validateDecoderKernelTileEvidence({
    expectedChunkItems: 524288,
    fullRoute: evidence,
  }).includes(expectedFailure), expectedFailure);
}

const replayValidationSource = witness.match(
  /function validatedReplayCastReport\([\s\S]*?\n}\n(?=\nfunction )/,
);
assert.ok(replayValidationSource, 'witness must expose a testable authority gate for replayed real casts');
const validatedReplayCastReport = vm.runInNewContext(`(${replayValidationSource[0]})`);
const replayReport = {
  schema: 'kaminos.pipeline-witness.v0',
  requestedPipelineId: 'sharp-image-to-splat-live-v0',
  effectiveRouteConfig: {
    routeId: 'adapter.sharp-image-to-splat-live.v0',
    outputRoot: '/tmp/pipeline-runs/run-real',
  },
  artifacts: {
    input: {
      role: 'source-image',
      status: 'requested',
      path: '/tmp/input-assets/s_15_img.png',
      bytes: 2292233,
      sha256: '68e9363e',
    },
    splat: {
      role: 'splat-candidate',
      status: 'real',
      path: '/tmp/pipeline-runs/run-real/artifacts/output.ply',
      bytes: 66060836,
      sha256: 'cd699930',
    },
  },
};
assert.deepEqual(
  JSON.parse(JSON.stringify(validatedReplayCastReport(replayReport, '/tmp/pipeline-runs/run-real/pipeline-witness.json'))),
  {
    authority: 'real-output-replay-not-inference',
    reportPath: '/tmp/pipeline-runs/run-real/pipeline-witness.json',
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
    outputRoot: '/tmp/pipeline-runs/run-real',
    sourceArtifact: replayReport.artifacts.input,
    artifact: replayReport.artifacts.splat,
  },
  'a replay must preserve the exact source report, route, containment root, hash, byte count, and real status',
);
for (const [mutate, expected] of [
  [report => { report.artifacts.splat.status = 'fixture'; }, /status real/],
  [report => { delete report.artifacts.splat.sha256; }, /SHA-256/],
  [report => { report.artifacts.splat.bytes = 0; }, /nonempty/],
  [report => { report.artifacts.splat.path = '/tmp/elsewhere/output.ply'; }, /outside recorded output root/],
  [report => { delete report.artifacts.input.sha256; }, /source.*SHA-256/i],
]) {
  const invalid = JSON.parse(JSON.stringify(replayReport));
  mutate(invalid);
  assert.throws(() => validatedReplayCastReport(invalid, '/tmp/report.json'), expected);
}
const effectiveIdentitySource = witness.match(
  /function bestKnownEffectiveIdentity\(\)[\s\S]*?\n}\n(?=\nfunction )/,
);
assert.ok(effectiveIdentitySource, 'witness must expose a testable compact effective identity projector');
const bestKnownEffectiveIdentity = vm.runInNewContext(
  `((lastTrustworthyEvidence, replayCastEvidence) => (${effectiveIdentitySource[0]})())`,
);
const replayIdentity = JSON.parse(JSON.stringify(bestKnownEffectiveIdentity({
  sourceSelectionExercise: { effectiveAssetId: 'image-inbox:21_img.png' },
  replayedCast: {
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectiveRouteId: 'adapter.sharp-image-to-splat-live.v0',
    sourceArtifact: replayReport.artifacts.input,
    artifact: replayReport.artifacts.splat,
  },
}, null)));
assert.equal(replayIdentity.sourceAssetId, null, 'a replay output must not inherit the unrelated current workroom plate');
assert.equal(replayIdentity.workroomSourceAssetId, 'image-inbox:21_img.png');
assert.deepEqual(replayIdentity.source, {
  authority: 'pipeline-input-artifact',
  role: 'source-image',
  status: 'requested',
  path: '/tmp/input-assets/s_15_img.png',
  bytes: 2292233,
  sha256: '68e9363e',
});
const compactSummarySource = witness.match(
  /function compactWitnessSummary\([\s\S]*?\n}\n(?=\nfunction validateVolumeReleaseEvidence)/,
);
assert.ok(compactSummarySource, 'witness must expose a testable compact terminal summary projector');
const compactWitnessSummary = vm.runInNewContext(`(${compactSummarySource[0]})`);
const compactSummary = compactWitnessSummary({
  state: {
    fullRoute: {
      status: 'complete',
      requestedFirePresentation: 'hybrid-smoke-preview',
      selectedFirePresentation: 'hybrid-smoke-preview',
      output: { path: '/tmp/output.ply', bytes: 64, sha256: 'abc', status: 'real' },
      foregroundKilnHeartbeat: { sampleCount: 2, samples: [{ huge: 'do-not-print' }] },
      sharpDutyCorrelation: { foregroundGaps: [{ huge: 'do-not-print' }] },
      volumeReleased: true,
      volumeReleaseConfirmed: true,
    },
  },
  out: '/tmp/final.png',
  inFlightCapture: {
    status: 'captured',
    path: '/tmp/in-flight.png',
    settleEvidence: { sampleCount: 1, samples: [{ huge: 'do-not-print' }] },
  },
  reportPath: '/tmp/report.json',
});
assert.equal(compactSummary.status, 'complete');
assert.equal(compactSummary.output.sha256, 'abc');
assert.equal(compactSummary.inFlightCapture.status, 'captured');
assert.ok(!JSON.stringify(compactSummary).includes('do-not-print'), 'terminal summary must not replay uncapped sample arrays');
const replaySummary = compactWitnessSummary({
  state: {
    replayedCast: {
      status: 'real-output-replay-not-inference',
      artifact: replayReport.artifacts.splat,
    },
  },
  out: '/tmp/replay.png',
  inFlightCapture: { requested: false, status: 'not-requested' },
  reportPath: '/tmp/replay-report.json',
});
assert.equal(replaySummary.status, 'real-output-replay-not-inference');
assert.equal(replaySummary.output.sha256, 'cd699930');
assert.equal(replaySummary.cadenceAcceptance, null, 'replaying a real cast must never project cadence evidence');

const captureAttemptSource = witness.match(
  /async function attemptInFlightHybridCapture\([\s\S]*?\n}\n(?=\nfunction compactWitnessSummary)/,
);
assert.ok(
  captureAttemptSource,
  'witness must expose a testable in-flight capture attempt that persists authorization before I/O',
);
const attemptInFlightHybridCapture = vm.runInNewContext(`(${captureAttemptSource[0]})`);
const captureReceipts = [];
await assert.rejects(
  attemptInFlightHybridCapture({
    ws: {},
    outputPath: '/tmp/failing-in-flight.png',
    authorization: {
      firingId: 'firing-capture-failure',
      firePhase: 'burning',
      requestedFirePresentation: 'hybrid-smoke-preview',
      expectedFirePresentation: { effectiveMode: 'learned-splat-flame-raymarched-smoke' },
      effectiveFirePresentation: { candidateCount: 512, candidateCapacity: 2048 },
      presentationFailures: [],
    },
    capturePng: async () => { throw new Error('simulated CDP screenshot failure'); },
    persistEvidence: receipt => captureReceipts.push(receipt),
  }),
  /simulated CDP screenshot failure/,
);
assert.deepEqual(
  captureReceipts.map(receipt => receipt.status),
  ['capture-attempting', 'capture-failed'],
  'capture authorization must be durable before screenshot I/O and remain available on failure',
);
assert.equal(captureReceipts[0].firingId, 'firing-capture-failure');
assert.equal(captureReceipts[0].effectiveFirePresentation.candidateCount, 512);
assert.equal(captureReceipts[1].error, 'simulated CDP screenshot failure');

const captureReadinessSource = witness.match(
  /function advanceInFlightCaptureReadiness\([\s\S]*?\n}\n(?=\nfunction buildInFlightHybridSettleMonitorExpression)/,
);
assert.ok(captureReadinessSource, 'witness must expose a testable settled-capture readiness state machine');
const advanceInFlightCaptureReadiness = vm.runInNewContext(`(${captureReadinessSource[0]})`);
const settlingReadiness = advanceInFlightCaptureReadiness({
  admissible: true,
  nowMs: 1000,
  eligibleSinceMs: null,
  settleMs: 3000,
});
assert.equal(settlingReadiness.status, 'settling-effective-hybrid');
assert.equal(settlingReadiness.ready, false);
assert.equal(settlingReadiness.eligibleSinceMs, 1000);
assert.equal(
  advanceInFlightCaptureReadiness({
    admissible: true,
    nowMs: 3999,
    eligibleSinceMs: settlingReadiness.eligibleSinceMs,
    settleMs: 3000,
  }).ready,
  false,
  'transient capture must not occur before the full settle window',
);
assert.equal(
  advanceInFlightCaptureReadiness({
    admissible: true,
    nowMs: 4000,
    eligibleSinceMs: settlingReadiness.eligibleSinceMs,
    settleMs: 3000,
  }).ready,
  true,
);
assert.equal(
  advanceInFlightCaptureReadiness({
    admissible: false,
    nowMs: 2500,
    eligibleSinceMs: settlingReadiness.eligibleSinceMs,
    settleMs: 3000,
  }).eligibleSinceMs,
  null,
  'losing admissible hybrid evidence must reset the settle window',
);
const observationGapReset = advanceInFlightCaptureReadiness({
  admissible: true,
  nowMs: 2500,
  eligibleSinceMs: settlingReadiness.eligibleSinceMs,
  settleMs: 3000,
  observationGapMs: 75,
  maxObservationGapMs: 50,
});
assert.equal(observationGapReset.eligibleSinceMs, null, 'an unobserved frame interval must reset settle eligibility');
assert.equal(observationGapReset.resetReason, 'observation-gap-exceeded');

const cadenceAcceptanceSource = witness.match(
  /function classifyCadenceAcceptance\([\s\S]*?\n}\n(?=\nfunction advanceInFlightCaptureReadiness)/,
);
assert.ok(cadenceAcceptanceSource, 'witness must expose a testable visual-versus-performance acceptance split');
const classifyCadenceAcceptance = vm.runInNewContext(`(${cadenceAcceptanceSource[0]})`);
const cadenceFailures = [{ kind: 'uninstrumented-frame-gap', durationMs: 91.9 }];
const visualCadence = classifyCadenceAcceptance({
  captureInFlight: true,
  failures: cadenceFailures,
});
assert.equal(visualCadence.status, 'excluded-observer-effect');
assert.equal(visualCadence.blocking, false);
assert.equal(visualCadence.failures.length, 1, 'visual runs must retain cadence failures even when they do not block visual acceptance');
const strictCadence = classifyCadenceAcceptance({
  captureInFlight: false,
  failures: cadenceFailures,
});
assert.equal(strictCadence.status, 'failed');
assert.equal(strictCadence.blocking, true, 'uncaptured runs must retain strict cadence acceptance');
const diagnosticCadence = classifyCadenceAcceptance({
  captureInFlight: false,
  diagnoseCadenceFailures: true,
  failures: cadenceFailures,
});
assert.equal(diagnosticCadence.status, 'diagnostic-failures-preserved');
assert.equal(diagnosticCadence.blocking, false, 'explicit diagnostic runs must continue without erasing cadence failures');
assert.deepEqual(
  diagnosticCadence.failures,
  cadenceFailures,
  'diagnostic continuation must retain every strict cadence failure',
);
assert.equal(
  classifyCadenceAcceptance({ captureInFlight: false, failures: [] }).status,
  'accepted',
);
const releaseValidatorSource = witness.match(
  /function validateVolumeReleaseEvidence\([\s\S]*?\n}\n(?=\nfunction validateRequestedFirePresentation)/,
);
assert.ok(
  releaseValidatorSource,
  'witness must expose a testable attempted-versus-confirmed release validator',
);
const validateVolumeReleaseEvidence = vm.runInNewContext(`(${releaseValidatorSource[0]})`);
assert.deepEqual(
  Array.from(validateVolumeReleaseEvidence({ volumeReleased: true, volumeReleaseConfirmed: true })),
  [],
);
assert.ok(
  validateVolumeReleaseEvidence({ volumeReleased: true, volumeReleaseConfirmed: false })
    .includes('furnace-release-unconfirmed'),
  'an attempted but unconfirmed furnace release must fail the witness',
);
assert.ok(
  validateVolumeReleaseEvidence({ volumeReleased: false, volumeReleaseConfirmed: false })
    .includes('furnace-release-not-attempted'),
  'a missing furnace release must retain its distinct failure identity',
);

const projectorSource = witness.match(
  /function projectFriendlyFiringEvidence\([\s\S]*?\n}\n(?=\ntry \{)/,
);
assert.ok(projectorSource, 'witness must expose a testable Node-side firing evidence projector');
const projectFriendlyFiringEvidence = vm.runInNewContext(`(${projectorSource[0]})`);
const presentationValidatorSource = witness.match(
  /function validateRequestedFirePresentation\([\s\S]*?\n}\n(?=\nfunction correlateForegroundGapsWithHostEvents)/,
);
assert.ok(
  presentationValidatorSource,
  'witness must expose a testable requested/effective presentation validator',
);
const validateRequestedFirePresentation = vm.runInNewContext(`(${presentationValidatorSource[0]})`);

const hybridPresentation = {
  firingId: 'firing-hybrid-witness',
  requestedMode: 'learned-splat-flame-raymarched-smoke',
  effectiveMode: 'learned-splat-flame-raymarched-smoke',
  fallbackReason: null,
  hybridSplatSmokeCompositorIdentity: 'splat-depth-conditioned-front-back-smoke-compositor-v1',
  hybridSplatSmokeApproximation: 'splat-depth-conditioned-raymarched-front-back-smoke-intervals',
  splatDepthConditionedSmokeSplit: 'per-pixel-transformed-splat-depth-raymarch-split-v1',
  hybridSmokePhaseAuthority: 'shared-current-single-simulator-no-instance-smoke-history',
  hybridSplatLayer: {
    identity: 'premultiplied-hdr-splat-radiance-alpha-linear-depth-moments-v0',
  },
  hybridSmokeLayer: {
    identity: 'raymarched-smoke-front-back-radiance-transmittance-linear-depth-intervals-v1',
    intervals: ['front-of-splat-depth', 'back-of-splat-depth'],
    opticalComposition: 'front-smoke>splat>back-smoke',
  },
  candidateCount: 512,
  candidateCapacity: 2048,
  candidateOverflow: 0,
  candidateCopyBytes: 0,
  flameContinuityRequested: 'live-every-frame',
  flameContinuityEffective: 'live-every-frame',
  flameContinuityEvidence: {
    schema: 'kaminos.single-flame-continuity-runtime.v0',
    firingId: 'firing-hybrid-witness',
    requested: 'live-every-frame',
    effective: 'live-every-frame',
    mode: 'live',
    counts: { live: 4, holdover: 0, fallback: 0 },
    renderFrameAdvanced: true,
    sourceRenderFrameAdvanced: true,
    simulatorStepAdvanced: true,
  },
  fireEpisodeHooks: {
    identity: 'foreground-kiln-fire-episode-hooks-v0',
    firingId: 'firing-hybrid-witness',
    routeIdentity: {
      compositionRequested: 'hybrid-smoke',
      compositionEffective: 'hybrid-smoke',
      compositionFallbackReason: null,
    },
  },
};
assert.deepEqual(
  Array.from(validateRequestedFirePresentation({
    requestedPresentation: 'hybrid-smoke-preview',
    requestedFlameContinuity: 'live-every-frame',
    firingId: 'firing-hybrid-witness',
    expected: {
      effectiveMode: hybridPresentation.effectiveMode,
      flameContinuityRequested: 'live-every-frame',
    },
    effective: hybridPresentation,
  })),
  [],
);
for (const [effective, expectedFailure] of [
  [null, 'effective-presentation-missing'],
  [{ ...hybridPresentation, effectiveMode: 'raymarched-fire-smoke' }, 'effective-presentation-mode-mismatch'],
  [{ ...hybridPresentation, fallbackReason: 'hybrid-route-unavailable' }, 'effective-presentation-fallback-present'],
  [{ ...hybridPresentation, firingId: 'other-firing' }, 'effective-presentation-firing-id-mismatch'],
  [{ ...hybridPresentation, candidateCount: 0 }, 'effective-presentation-candidate-empty'],
  [{ ...hybridPresentation, candidateOverflow: 1 }, 'effective-presentation-candidate-overflow'],
  [{ ...hybridPresentation, candidateCopyBytes: 4096 }, 'effective-presentation-cpu-copy-present'],
  [{ ...hybridPresentation, hybridSplatSmokeCompositorIdentity: 'single-representative-depth-splat-smoke-compositor-v0' }, 'effective-presentation-compositor-identity-mismatch'],
  [{ ...hybridPresentation, hybridSplatSmokeApproximation: 'single-representative-depth-no-interpenetration-split' }, 'effective-presentation-compositor-approximation-mismatch'],
  [{ ...hybridPresentation, splatDepthConditionedSmokeSplit: 'single-representative-depth-no-interpenetration-split' }, 'effective-presentation-depth-split-mismatch'],
  [{ ...hybridPresentation, hybridSmokePhaseAuthority: 'phase-matched-instance-smoke-history' }, 'effective-presentation-phase-authority-mismatch'],
  [{ ...hybridPresentation, hybridSplatLayer: null }, 'effective-presentation-splat-layer-missing'],
  [{ ...hybridPresentation, hybridSmokeLayer: null }, 'effective-presentation-smoke-layer-missing'],
  [{ ...hybridPresentation, hybridSmokeLayer: { ...hybridPresentation.hybridSmokeLayer, intervals: ['front-of-splat-depth'] } }, 'effective-presentation-smoke-intervals-mismatch'],
  [{ ...hybridPresentation, hybridSmokeLayer: { ...hybridPresentation.hybridSmokeLayer, opticalComposition: 'smoke>splat' } }, 'effective-presentation-optical-composition-mismatch'],
]) {
  assert.ok(
    validateRequestedFirePresentation({
      requestedPresentation: 'hybrid-smoke-preview',
      requestedFlameContinuity: 'live-every-frame',
      firingId: 'firing-hybrid-witness',
      expected: {
        effectiveMode: hybridPresentation.effectiveMode,
        flameContinuityRequested: 'live-every-frame',
      },
      effective,
    }).includes(expectedFailure),
    `hybrid witness must reject ${expectedFailure}`,
  );
}
assert.ok(
  validateRequestedFirePresentation({
    requestedPresentation: 'hybrid-smoke-preview',
    requestedFlameContinuity: 'live-every-frame',
    firingId: 'firing-hybrid-witness',
    expected: {
      effectiveMode: hybridPresentation.effectiveMode,
      flameContinuityRequested: 'live-every-frame',
    },
    effective: {
      ...hybridPresentation,
      flameContinuityEvidence: {
        ...hybridPresentation.flameContinuityEvidence,
        simulatorStepAdvanced: false,
      },
    },
  }).includes('live-continuity-evidence-incomplete'),
  'the visual witness must reject a live continuity frame that did not advance simulation',
);

const settleMonitorBuilderSource = witness.match(
  /function buildInFlightHybridSettleMonitorExpression\([\s\S]*?\n}\n(?=\nasync function attemptInFlightHybridCapture)/,
);
assert.ok(settleMonitorBuilderSource, 'witness must expose an executable browser RAF settle monitor');
const buildInFlightHybridSettleMonitorExpression = vm.runInNewContext(`(() => {
  const validateRequestedFirePresentation = (${presentationValidatorSource[0]});
  const advanceInFlightCaptureReadiness = (${captureReadinessSource[0]});
  return (${settleMonitorBuilderSource[0]});
})()`);
let browserNowMs = 0;
const rafCallbacks = [];
let liveHybridPresentation = hybridPresentation;
const browserWindow = {
  __kaminosSharpBreathingRoomKilnFireState: {
    phase: 'burning',
    firingId: 'firing-hybrid-witness',
    expectedFirePresentation: {
      effectiveMode: hybridPresentation.effectiveMode,
      flameContinuityRequested: 'live-every-frame',
    },
    volumeDebugState: { firePresentation: hybridPresentation },
  },
  __kaminosVolumePrototype: {
    debugState: () => ({ firePresentation: liveHybridPresentation }),
  },
};
vm.runInNewContext(
  buildInFlightHybridSettleMonitorExpression({
    settleMs: 30,
    maxObservationGapMs: 20,
    requestedFlameContinuity: 'live-every-frame',
  }),
  {
    window: browserWindow,
    performance: { now: () => browserNowMs },
    requestAnimationFrame: callback => rafCallbacks.push(callback),
  },
);
const runRafAt = nowMs => {
  browserNowMs = nowMs;
  const callback = rafCallbacks.shift();
  assert.ok(callback, `RAF monitor must schedule a callback for ${nowMs}ms`);
  callback();
};
for (const nowMs of [0, 10, 20, 30]) runRafAt(nowMs);
assert.equal(browserWindow.__kaminosInFlightHybridSettleMonitor.ready, true);
assert.equal(browserWindow.__kaminosInFlightHybridSettleMonitor.sampleRetention, 'uncapped');
assert.equal(browserWindow.__kaminosInFlightHybridSettleMonitor.samples.length, 4);
liveHybridPresentation = {
  ...hybridPresentation,
  fallbackReason: 'simulated-between-frame-fallback',
};
runRafAt(40);
assert.equal(browserWindow.__kaminosInFlightHybridSettleMonitor.ready, false);
assert.equal(browserWindow.__kaminosInFlightHybridSettleMonitor.eligibleSinceMs, null);
assert.equal(browserWindow.__kaminosInFlightHybridSettleMonitor.resetCount, 1);

const projectedEvidence = projectFriendlyFiringEvidence({
  browserFiringEvidence: {
    status: 'complete',
    reportPath: '/tmp/pipeline-witness.json',
    foregroundKilnHeartbeat: { schema: 'kaminos.foreground-kiln-heartbeat.v0', sampleRetention: 'uncapped' },
    sharpDutyCorrelation: { schema: 'kaminos.foreground-sharp-duty-correlation.v0', status: 'verified' },
    volumeReleased: true,
    volumeReleaseConfirmed: true,
    autoOpenedTab: 'assets',
  },
  pipelineReport: {
    requestedPipelineId: 'sharp-image-to-splat-live-v0',
    effectiveRouteConfig: { routeId: 'adapter.sharp-image-to-splat-live.v0' },
    artifacts: { splat: { path: '/tmp/output.ply', bytes: 64, sha256: 'abc', status: 'real' } },
    stages: [{ effectiveRoute: { adapterReport: {
      revision: 'sharp-revision',
      breathingRoom: { requestedScheduler: { mode: 'cooperative' }, effectiveScheduler: { mode: 'cooperative' }, telemetry: { events: [] } },
      backgroundHeartbeat: { schema: 'sharp-webgpu.background-heartbeat.v0', worstFrameGaps: [], gpuDutyIntervals: { intervals: [] } },
    } } }],
  },
});
assert.equal(projectedEvidence.reportPath, '/tmp/pipeline-witness.json');
assert.equal(projectedEvidence.effectiveSharpRevision, 'sharp-revision');
assert.equal(projectedEvidence.output.sha256, 'abc');
assert.equal(projectedEvidence.foregroundKilnHeartbeat.sampleRetention, 'uncapped');
assert.equal(projectedEvidence.sharpDutyCorrelation.status, 'verified');
assert.equal(projectedEvidence.volumeReleased, true);

const hostGapCorrelationSource = witness.match(
  /function correlateForegroundGapsWithHostEvents\([\s\S]*?\n}\n(?=\nfunction )/,
);
assert.ok(hostGapCorrelationSource, 'Witness must expose executable foreground-gap to host-event correlation');
const correlateForegroundGapsWithHostEvents = vm.runInNewContext(`(${hostGapCorrelationSource[0]})`);
const hostGapCorrelation = correlateForegroundGapsWithHostEvents({
  firingId: 'firing-host-authority-a',
  foregroundClock: {
    schema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now',
    timeOriginEpochMs: 1_700_000_000_000,
  },
  hostTelemetry: {
    schema: 'kaminos.foreground-host-telemetry.v0',
    status: 'complete',
    firingId: 'firing-host-authority-a',
    episodeId: 'host-episode-a',
    clock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: 1_700_000_000_000,
    },
    longTaskSource: { identity: 'performance-observer-longtask', status: 'complete' },
    explicitEventSource: { identity: 'explicit-record-event', status: 'available' },
  },
  foregroundGaps: [{
    sampleIndex: 1,
    startEpochMs: 1_700_000_000_100,
    endEpochMs: 1_700_000_000_200,
    durationMs: 100,
    overlaps: [{
      startEpochMs: 1_700_000_000_100,
      endEpochMs: 1_700_000_000_120,
    }],
  }, {
    sampleIndex: 2,
    startEpochMs: 1_700_000_000_200,
    endEpochMs: 1_700_000_000_240,
    durationMs: 40,
    overlaps: [],
  }],
  hostEventRetention: 'uncapped',
  hostEventCount: 1,
  hostEvents: [{
    kind: 'browser-performance',
    phase: 'longtask',
    source: 'performance-observer-longtask',
    firingId: 'firing-host-authority-a',
    episodeId: 'host-episode-a',
    clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now',
    timeOriginEpochMs: 1_700_000_000_000,
    startMs: 140,
    endMs: 160,
    startEpochMs: 1_700_000_000_140,
    endEpochMs: 1_700_000_000_160,
    durationMs: 20,
  }],
});
assert.equal(hostGapCorrelation.schema, 'kaminos.foreground-host-gap-correlation.v0');
assert.equal(hostGapCorrelation.status, 'verified');
assert.equal(hostGapCorrelation.hostEventRetention, 'uncapped');
assert.equal(hostGapCorrelation.hostEventCount, 1);
assert.equal(hostGapCorrelation.foregroundGapCount, 2);
assert.equal(hostGapCorrelation.gaps[0].hostOverlapStatus, 'observed');
assert.equal(hostGapCorrelation.gaps[0].hostOverlapDurationMs, 20);
assert.equal(hostGapCorrelation.gaps[0].evidenceCoveredDurationMs, 40);
assert.equal(hostGapCorrelation.gaps[0].remainingUnknownDurationMs, 60);
assert.equal(hostGapCorrelation.gaps[1].hostOverlapStatus, 'none');
assert.equal(hostGapCorrelation.gaps[1].remainingUnknownDurationMs, 40);
assert.equal(hostGapCorrelation.uncoveredGapCount, 2);
assert.equal(hostGapCorrelation.totals.remainingUnknownDurationMs, 100);
assert.match(hostGapCorrelation.disclaimer, /overlap-not-causal-attribution/);

const partialHostGapCorrelation = correlateForegroundGapsWithHostEvents({
  firingId: 'firing-host-authority-a',
  foregroundClock: {
    schema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now',
    timeOriginEpochMs: 1_700_000_000_000,
  },
  hostTelemetry: {
    schema: 'kaminos.foreground-host-telemetry.v0',
    status: 'complete',
    firingId: 'firing-host-authority-a',
    episodeId: 'host-episode-a',
    clock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: 1_700_000_000_000,
    },
    longTaskSource: { identity: 'performance-observer-longtask', status: 'complete' },
    explicitEventSource: { identity: 'explicit-record-event', status: 'available' },
  },
  foregroundGaps: [],
  hostEventRetention: 'uncapped',
  hostEventCount: 2,
  hostEvents: [{
    kind: 'browser-performance',
    phase: 'longtask',
    source: 'performance-observer-longtask',
    firingId: 'firing-host-authority-a',
    episodeId: 'host-episode-a',
    clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now',
    timeOriginEpochMs: 1_700_000_000_000,
    startMs: 140,
    endMs: 160,
    startEpochMs: 1_700_000_000_140,
    endEpochMs: 1_700_000_000_160,
  }],
});
assert.equal(partialHostGapCorrelation.status, 'invalid');
assert.ok(partialHostGapCorrelation.failures.includes('host-events-capped-or-partial'));

for (const [mutation, expectedFailure] of [
  [{ hostTelemetry: { status: 'unavailable', longTaskSource: { status: 'unavailable' } } }, 'host-telemetry-source-unavailable'],
  [{ hostEvents: [{
    kind: 'browser-performance', phase: 'longtask', source: 'performance-observer-longtask',
    firingId: 'stale-firing', episodeId: 'host-episode-a',
    clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now', timeOriginEpochMs: 1_700_000_000_000,
    startMs: 140, endMs: 160,
    startEpochMs: 1_700_000_000_140, endEpochMs: 1_700_000_000_160,
  }] }, 'host-event-firing-mismatch'],
  [{ hostEvents: [{
    kind: 'browser-performance', phase: 'longtask', source: 'performance-observer-longtask',
    firingId: 'firing-host-authority-a', episodeId: 'host-episode-a',
    clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now', timeOriginEpochMs: 1_700_000_000_000,
    startMs: 140, endMs: 160,
    startEpochMs: 1_700_000_009_140, endEpochMs: 1_700_000_009_160,
  }] }, 'host-event-clock-mismatch'],
  [{ hostEvents: [{
    kind: 'browser-performance', phase: 'longtask', source: 'stale-side-channel',
    firingId: 'firing-host-authority-a', episodeId: 'host-episode-a',
    clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now', timeOriginEpochMs: 1_700_000_000_000,
    startMs: 140, endMs: 160,
    startEpochMs: 1_700_000_000_140, endEpochMs: 1_700_000_000_160,
  }] }, 'host-event-source-unrecognized'],
]) {
  const base = {
    firingId: 'firing-host-authority-a',
    foregroundClock: {
      schema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now',
      timeOriginEpochMs: 1_700_000_000_000,
    },
    hostTelemetry: {
      schema: 'kaminos.foreground-host-telemetry.v0', status: 'complete',
      firingId: 'firing-host-authority-a', episodeId: 'host-episode-a',
      clock: {
        schema: 'kaminos.browser-epoch-monotonic-clock.v0',
        timingAuthority: 'performance-time-origin-plus-now',
        timeOriginEpochMs: 1_700_000_000_000,
      },
      longTaskSource: { identity: 'performance-observer-longtask', status: 'complete' },
      explicitEventSource: { identity: 'explicit-record-event', status: 'available' },
    },
    foregroundGaps: [{
      startEpochMs: 1_700_000_000_100, endEpochMs: 1_700_000_000_200,
      durationMs: 100, overlaps: [],
    }],
    hostEventRetention: 'uncapped',
    hostEventCount: 1,
    hostEvents: [{
      kind: 'browser-performance', phase: 'longtask', source: 'performance-observer-longtask',
      firingId: 'firing-host-authority-a', episodeId: 'host-episode-a',
      clockSchema: 'kaminos.browser-epoch-monotonic-clock.v0',
      timingAuthority: 'performance-time-origin-plus-now', timeOriginEpochMs: 1_700_000_000_000,
      startMs: 140, endMs: 160,
      startEpochMs: 1_700_000_000_140, endEpochMs: 1_700_000_000_160,
    }],
  };
  const result = correlateForegroundGapsWithHostEvents({
    ...base,
    ...mutation,
    hostTelemetry: { ...base.hostTelemetry, ...(mutation.hostTelemetry || {}) },
  });
  assert.equal(result.status, 'invalid');
  assert.ok(result.failures.includes(expectedFailure));
  assert.equal(result.gaps[0].hostOverlapDurationMs, 0);
  assert.equal(result.gaps[0].remainingUnknownDurationMs, 100);
}

for (const [pattern, message] of [
  [/crucible-viewport-witness\.v0/, 'Witness must name the Crucible viewport contract it emits'],
  [/--url/, 'Witness must accept an explicit Kaminos URL instead of hardcoding a server'],
  [/--out/, 'Witness must let callers choose the screenshot path'],
  [/--report/, 'Witness must let callers choose the JSON report path'],
  [/--fire-friendly/, 'Witness must expose an explicit opt-in real Friendly firing mode'],
  [/--scheduler-profile/, 'Witness must accept an explicit scheduler profile for adjacent route experiments'],
  [/--source-asset-id/, 'Witness must accept an exact indexed source identity for adjacent route experiments'],
  [/--fire-presentation/, 'Witness must accept an explicit central fire presentation instead of inheriting a UI default'],
  [/--flame-continuity/, 'Witness must accept an explicit flame continuity policy instead of inheriting a UI default'],
  [/--expected-webgpu-kit-version/, 'Witness must require the effective source-locked WebGPU kit package identity'],
  [/--capture-in-flight/, 'Transient visual capture must be explicit so ordinary cadence witnesses remain unperturbed'],
  [/--diagnose-cadence-failures/, 'Cadence-failure diagnosis must be an explicit non-smoke continuation mode'],
  [/--replay-cast-report/, 'Witness must expose an explicit real-output replay path for terminal layout verification'],
  [/receiptReportPath:\s*replayResult\.receipt\?\.reportPath[\s\S]*receiptReportPath !== state\.replayedCast\.reportPath/, 'Replay witness must verify the persisted Crucible receipt retained the source pipeline report path'],
  [/kaminosCrucibleViewportReplayRealCast[\s\S]*setTimeout\(resolve,\s*240\)[\s\S]*completedWorkroom/, 'Replay geometry must settle past the workroom posture transition before toolbar clearance is judged'],
  [/--in-flight-out/, 'Witness must let callers choose the transient hybrid screenshot path'],
  [/--in-flight-max-observation-gap-ms/, 'Witness must expose the RAF continuity threshold instead of burying it'],
  [/--expected-sharp-revision/, 'Full-route witness must accept the exact expected SHARP source revision'],
  [/openGenerateTabExpression[\s\S]*data-tab="generate"[\s\S]*evaluate\(ws, openGenerateTabExpression\)/, 'Witness must open the real Generate tab path'],
  [/id: 'crucible-viewport-workspace'/, 'Witness report must include the requested workspace selector'],
  [/data-crucible-workroom/, 'Witness must verify workroom identity, not just screenshot nonblankness'],
  [/data-crucible-heat-state/, 'Witness must record heat state from the visible surface'],
  [/data-crucible-route-status/, 'Witness must record the effective route status shown by the workroom'],
  [/data-crucible-room-posture/, 'Witness must record the room posture that determines whether the furnace or cast can be seen'],
  [/crucible-worktable-stage/, 'Witness must verify the worktable stage is actually mounted'],
  [/sourceOptionCount/, 'Witness must prove the plate has real source choices'],
  [/sourceSelectionExercise/, 'Witness must prove changing the plate selector changes the effective shared source'],
  [/requestedSourceAssetId[\s\S]*effectiveAssetId/, 'Witness must fail loud unless the requested source identity becomes effective'],
  [/backgroundHeartbeat/, 'Full-route witness mode must preserve the corrected heartbeat receipt'],
  [/foregroundKilnHeartbeat/, 'Full-route witness must preserve the exact foreground firing-window heartbeat'],
  [/validateRequestedFirePresentation/, 'Full-route witness must validate requested and effective fire presentation truth'],
  [/crucible-viewport-presentation-select/, 'Full-route witness must actuate the real central presentation selector'],
  [/crucible-viewport-flame-continuity-select/, 'Full-route witness must actuate the ordinary-language continuity selector'],
  [/flameContinuityMode:\s*requestedFlameContinuity/, 'Full-route witness must forward the explicit continuity policy into the exact firing'],
  [/requestedFlameContinuity[\s\S]*selectedFlameContinuity[\s\S]*effectiveFlameContinuity/, 'Full-route evidence must preserve requested, selected, and effective continuity identity'],
  [/webgpuInferenceKit[\s\S]*effectiveVersion/, 'Full-route evidence must preserve the package manifest version served by the exercised route'],
  [/window\.runKilnRouteBenchRoute[\s\S]*schedulerProfileId/, 'Witness must invoke the requested hidden profile without adding it to the operator mode selector'],
  [/sharpDutyCorrelation/, 'Full-route witness must preserve the foreground-to-SHARP epoch correlation'],
  [/kaminos\.foreground-sharp-duty-correlation\.v0/, 'Full-route witness must require the correlation schema'],
  [/sampleRetention[\s\S]*uncapped/, 'Full-route witness must reject capped foreground samples'],
  [/foregroundGaps/, 'Full-route witness must preserve every inference-window foreground gap'],
  [/hostEventRetention[\s\S]*uncapped/, 'Full-route witness must require uncapped foreground host events'],
  [/hostEventCount/, 'Full-route witness must preserve the declared foreground host-event count'],
  [/hostGapCorrelation/, 'Full-route witness must preserve host-event overlap and the remaining unknown gap duration'],
  [/remainingUnknownDurationMs/, 'Host overlap must not erase the unexplained remainder of a foreground gap'],
  [/unattributedDurationMs/, 'Full-route witness must preserve delay outside named SHARP duty intervals'],
  [/phaseRankings/, 'Full-route witness must rank named SHARP phase overlap'],
  [/boundaryRankings/, 'Full-route witness must rank named SHARP boundary overlap'],
  [/crossPageClock/, 'Full-route witness must require the shared epoch clock'],
  [/gpuDutyIntervals/, 'Full-route witness must require run-bound submitted-work duty intervals'],
  [/backgroundHeartbeat:\s*backgroundHeartbeat\s*\?\s*\{[\s\S]*gpuDutyIntervals:\s*backgroundHeartbeat\.gpuDutyIntervals/, 'CDP witness must project the complete duty envelope without serializing the entire duplicated adapter report'],
  [/inferenceWindow/, 'Full-route witness mode must fail if the measured inference window is absent'],
  [/worstFrameGaps/, 'Full-route witness mode must fail if scoped gap rows are absent'],
  [/volumeReleased/, 'Full-route witness mode must verify the furnace releases after the cast lands'],
  [/volumeReleaseConfirmed/, 'Full-route witness mode must separately verify confirmed furnace release'],
  [/lastTrustworthyEvidence = \{ \.\.\.lastTrustworthyEvidence, fullRoute: state\.fullRoute \}[\s\S]*validateVolumeReleaseEvidence/, 'Release failure must retain attempted and confirmed state in last trustworthy evidence before validation'],
  [/cpuChunkItems/, 'Full-route witness must verify the effective cooperative CPU chunk size'],
  [/routeTailYieldMs/, 'Full-route witness must verify the effective route-tail yield'],
  [/routeTailCheckpointEvents/, 'Full-route witness must require observed prep and Gaussian compose checkpoints'],
  [/lateTailBlockingIntervals/, 'Full-route witness must preserve the named late-tail blocking intervals'],
  [/intervalStartMs/, 'Late-tail interval evidence must preserve browser-timeline start coordinates'],
  [/intervalEndMs/, 'Late-tail interval evidence must preserve browser-timeline end coordinates'],
  [/ply-blob-assembly/, 'Full-route witness must require PLY Blob assembly interval evidence'],
  [/object-url-create/, 'Full-route witness must require object URL interval evidence'],
  [/output-bind/, 'Full-route witness must require output binding interval evidence'],
  [/gaussianCpuDutyIntervals/, 'Full-route witness must preserve Gaussian CPU duty intervals'],
  [/segmentStartProcessedItems/, 'Gaussian interval evidence must carry actual segment start bounds'],
  [/segmentEndProcessedItems/, 'Gaussian interval evidence must carry actual segment end bounds'],
  [/row-batched/, 'Gaussian interval evidence must identify its truthful row-batched granularity'],
  [/inferenceWindowFinalizeInterval/, 'Full-route witness must preserve the post-bind finalization envelope'],
  [/inference-window-finalize/, 'Full-route witness must require the named inference finalization interval'],
  [/localization-envelope/, 'Finalization interval must remain explicitly non-causal localization evidence'],
  [/preGaussianSetupIntervals/, 'Full-route witness must preserve pre-Gaussian setup intervals'],
  [/composePreparationIntervals/, 'Full-route witness must preserve all six bounded preparation intervals'],
  [/maxGaussianDutyMs/, 'Full-route witness must calculate the maximum observed Gaussian CPU duty'],
  [/maxGaussianDutyMs >= 50/, 'Full-route witness must reject a Gaussian CPU duty that misses the sub-50ms target'],
  [/expectedSchedulerForProfile[\s\S]*cpuChunkItems:\s*16384/, 'Full-route witness must require the effective smaller Gaussian CPU chunk target'],
  [/expectedSchedulerForProfile[\s\S]*effectiveScheduler/, 'Full-route witness must compare every requested scheduler field against effective route evidence'],
  [/ply-data-allocation/, 'Full-route witness must require the PLY data allocation interval'],
  [/gaussian-activation-setup/, 'Full-route witness must require the activation setup interval'],
  [/allocation\.bytes > 0/, 'PLY allocation interval must carry a positive actual byte count'],
  [/uninstrumentedGapsAtOrAbove50Ms/, 'Full-route witness must reject every uninstrumented gap at or above the frame-starvation threshold'],
  [/gap\?\.overlapClassification[\s\S]*uninstrumented-gap/, 'Full-route witness must reject unattributed residual gaps'],
  [/fireButtonDisabled/, 'Witness must record whether the primary firing action can actually run'],
  [/castButtonDisabled/, 'Witness must record whether the cast action truthfully has a target'],
  [/pointerEvents/, 'Witness must prove the workroom is hittable instead of visually clickable only'],
  [/roomPosture[\s\S]*firing/, 'Transient route evidence must prove the room actually entered its compact firing posture'],
  [/completedWorkroom\.roomPosture[\s\S]*cast-held/, 'Completed route evidence must prove the room opened around the loaded cast'],
  [/completedWorkroom\.stageTop[\s\S]*completedWorkroom\.transformBarBottom/, 'Completed route evidence must reject a compact console that sits underneath the scene toolbar'],
  [/real-output-replay-not-inference/, 'Replayed cast evidence must fail loud that it is not a new inference result'],
  [/replayCastReportPath[\s\S]*fireFriendly[\s\S]*cannot be combined/, 'Real-output replay must not masquerade as a live Friendly firing'],
  [/Page\.captureScreenshot/, 'Witness must capture the actual browser viewport'],
  [/buildInFlightHybridSettleMonitorExpression\(\{[\s\S]*routeState\.settleMonitor\?\.ready[\s\S]*sampleNow\('pre-capture'\)[\s\S]*attemptInFlightHybridCapture\(\{[\s\S]*authorization:[\s\S]*effectiveFirePresentation/, 'Transient capture must wait for executable effective hybrid presentation validation'],
  [/candidateCount <= 0/, 'Transient hybrid capture must require a nonempty live candidate set'],
  [/inFlightCapture[\s\S]*requestedFirePresentation[\s\S]*effectiveFirePresentation/, 'Transient capture evidence must preserve requested/effective presentation identity'],
  [/observerEffect[\s\S]*CDP viewport capture may perturb foreground cadence/, 'Transient visual evidence must disclose its cadence observer effect'],
  [/requestAnimationFrame[\s\S]*__kaminosInFlightHybridSettleMonitor/, 'Transient settle authority must be sampled on the browser RAF loop'],
  [/sampleRetention:\s*'uncapped'/, 'Transient settle evidence must retain every RAF sample without a hidden cap'],
  [/sampleNow\('pre-capture'\)[\s\S]*attemptInFlightHybridCapture[\s\S]*sampleNow\('post-capture'\)/, 'Transient capture must verify the same settle epoch immediately before and after screenshot I/O'],
  [/compactWitnessSummary\([\s\S]*console\.log\(JSON\.stringify\(terminalSummary/, 'Successful stdout must emit only the compact locator summary'],
  [/Runtime\.exceptionThrown/, 'Witness must fail loud on browser runtime exceptions'],
  [/primaryOutputWritten/, 'Witness must report whether primary screenshot evidence was written'],
  [/lastTrustworthyEvidence/, 'Witness failures after inference must preserve the last trustworthy route and heartbeat evidence'],
  [/async function evaluate\(ws, expression, timeoutMs[\s\S]*wsRequest\(ws, 'Runtime\.evaluate',[\s\S]*timeoutMs\)[\s\S]*const browserFiringEvidence = await evaluate\(ws,[\s\S]*fireTimeoutMs\)/, 'Post-firing browser evidence collection must inherit the explicit firing budget instead of timing out while the completed cast binds'],
  [/const browserFiringEvidence = await evaluate\(ws,[\s\S]*const reportPath = routeState\.result\?\.report\?\.path[\s\S]*reportPath,/, 'Browser evidence read must return the durable report path instead of projecting the backend report in the busy page'],
  [/JSON\.parse\(readFileSync\(browserFiringEvidence\.reportPath, 'utf8'\)\)/, 'Node witness must read the backend report from its durable filesystem path'],
  [/projectFriendlyFiringEvidence\(\{[\s\S]*browserFiringEvidence,[\s\S]*pipelineReport/, 'Node witness must join browser-owned firing evidence with filesystem-owned backend evidence outside CDP'],
  [/import \{ readBrowserArrayInChunks \} from '.\/lib\/chunked-browser-array-reader\.mjs'/, 'Witness must use the executable lossless browser-array reader'],
  [/__kaminosCrucibleWitnessSnapshot/, 'Witness must pin browser-owned evidence to a completed firing snapshot'],
  [/snapshotIdentity/, 'Witness must carry snapshot identity through every chunk read'],
  [/foregroundKilnHeartbeat\.samples = await readBrowserArrayInChunks/, 'Witness must reconstruct every uncapped foreground sample outside the browser payload'],
  [/sharpDutyCorrelation\.foregroundGaps = await readBrowserArrayInChunks/, 'Witness must reconstruct every correlated foreground gap outside the browser payload'],
  [/foregroundKilnHeartbeat\.hostEvents = await readBrowserArrayInChunks/, 'Witness must reconstruct every uncapped host event outside the browser payload'],
  [/samples: undefined, hostEvents: undefined, sharpHeartbeat: undefined, sharpDutyCorrelation: undefined/, 'Initial CDP summary must omit duplicated large heartbeat and host-event evidence'],
  [/lastTrustworthyEvidence = \{[\s\S]*postFiringSummary:[\s\S]*reportPath: browserFiringEvidence\.reportPath[\s\S]*readBrowserArrayInChunks/, 'Chunk failures must preserve the compact post-firing identity and declared-count evidence'],
]) {
  assert.match(witness, pattern, message);
}

assert.doesNotMatch(
  witness,
  /\n\s*backgroundHeartbeat,\n\s*foregroundKilnHeartbeat,/,
  'CDP witness must not return the raw multi-megabyte background heartbeat shorthand',
);
assert.doesNotMatch(
  witness,
  /state\.fullRoute = await evaluate\(ws,[\s\S]*const report = routeState\.result\?\.report\?\.document/,
  'CDP witness must not traverse the multi-megabyte backend report inside the busy browser page',
);
assert.doesNotMatch(
  witness,
  /console\.log\(JSON\.stringify\(\{ ok: true, out, report: reportPath, state \}/,
  'Successful stdout must not replay the uncapped full witness state',
);
const postFiringSummaryIndex = witness.indexOf('postFiringSummary: {');
const missingReportGateIndex = witness.indexOf("if (!browserFiringEvidence.reportPath)");
assert.ok(postFiringSummaryIndex >= 0 && missingReportGateIndex > postFiringSummaryIndex);
for (const field of [
  'status: browserFiringEvidence.status',
  'message: browserFiringEvidence.message',
  'volumeReleased: browserFiringEvidence.volumeReleased',
  'volumeReleaseConfirmed: browserFiringEvidence.volumeReleaseConfirmed',
]) {
  const fieldIndex = witness.indexOf(field, postFiringSummaryIndex);
  assert.ok(fieldIndex >= postFiringSummaryIndex && fieldIndex < missingReportGateIndex,
    `Missing backend reports must preserve ${field} before failing`);
}
