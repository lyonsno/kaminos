import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';

const witness = readFileSync(new URL('../crucible-viewport-witness.mjs', import.meta.url), 'utf8');
const witnessPath = new URL('../crucible-viewport-witness.mjs', import.meta.url);
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
  JSON.parse(JSON.stringify(expectedSchedulerForProfile('cooperative-fixed-16ms-donation'))),
  {
    mode: 'cooperative',
    spnPatchChunkSize: 1,
    yieldMs: 16,
    waitForSubmittedWorkDone: true,
    gaussianPhaseYieldMs: 16,
    vitBlockChunkSize: 2,
    cpuChunkItems: 16384,
    routeTailYieldMs: 16,
  },
  'fixed-boundary experiment must not change chunk granularity or silently inherit ordinary Friendly donations',
);
assert.throws(
  () => expectedSchedulerForProfile('cooperative-typo'),
  /Unsupported --scheduler-profile/,
  'unknown scheduler profiles must fail before a GPU run instead of falling back',
);

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
    artifact: replayReport.artifacts.splat,
  },
  'a replay must preserve the exact source report, route, containment root, hash, byte count, and real status',
);
for (const [mutate, expected] of [
  [report => { report.artifacts.splat.status = 'fixture'; }, /status real/],
  [report => { delete report.artifacts.splat.sha256; }, /SHA-256/],
  [report => { report.artifacts.splat.bytes = 0; }, /nonempty/],
  [report => { report.artifacts.splat.path = '/tmp/elsewhere/output.ply'; }, /outside recorded output root/],
]) {
  const invalid = JSON.parse(JSON.stringify(replayReport));
  mutate(invalid);
  assert.throws(() => validatedReplayCastReport(invalid, '/tmp/report.json'), expected);
}
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
  /function validateRequestedFirePresentation\([\s\S]*?\n}\n(?=\nfunction projectFriendlyFiringEvidence)/,
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
  candidateCount: 512,
  candidateCapacity: 2048,
  candidateOverflow: 0,
  candidateCopyBytes: 0,
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
    firingId: 'firing-hybrid-witness',
    expected: { effectiveMode: hybridPresentation.effectiveMode },
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
]) {
  assert.ok(
    validateRequestedFirePresentation({
      requestedPresentation: 'hybrid-smoke-preview',
      firingId: 'firing-hybrid-witness',
      expected: { effectiveMode: hybridPresentation.effectiveMode },
      effective,
    }).includes(expectedFailure),
    `hybrid witness must reject ${expectedFailure}`,
  );
}

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
    expectedFirePresentation: { effectiveMode: hybridPresentation.effectiveMode },
    volumeDebugState: { firePresentation: hybridPresentation },
  },
  __kaminosVolumePrototype: {
    debugState: () => ({ firePresentation: liveHybridPresentation }),
  },
};
vm.runInNewContext(
  buildInFlightHybridSettleMonitorExpression({ settleMs: 30, maxObservationGapMs: 20 }),
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

for (const [pattern, message] of [
  [/crucible-viewport-witness\.v0/, 'Witness must name the Crucible viewport contract it emits'],
  [/--url/, 'Witness must accept an explicit Kaminos URL instead of hardcoding a server'],
  [/--out/, 'Witness must let callers choose the screenshot path'],
  [/--report/, 'Witness must let callers choose the JSON report path'],
  [/--fire-friendly/, 'Witness must expose an explicit opt-in real Friendly firing mode'],
  [/--scheduler-profile/, 'Witness must accept an explicit scheduler profile for adjacent route experiments'],
  [/--source-asset-id/, 'Witness must accept an exact indexed source identity for adjacent route experiments'],
  [/--fire-presentation/, 'Witness must accept an explicit central fire presentation instead of inheriting a UI default'],
  [/--capture-in-flight/, 'Transient visual capture must be explicit so ordinary cadence witnesses remain unperturbed'],
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
  [/window\.runKilnRouteBenchRoute[\s\S]*schedulerProfileId/, 'Witness must invoke the requested hidden profile without adding it to the operator mode selector'],
  [/sharpDutyCorrelation/, 'Full-route witness must preserve the foreground-to-SHARP epoch correlation'],
  [/kaminos\.foreground-sharp-duty-correlation\.v0/, 'Full-route witness must require the correlation schema'],
  [/sampleRetention[\s\S]*uncapped/, 'Full-route witness must reject capped foreground samples'],
  [/foregroundGaps/, 'Full-route witness must preserve every inference-window foreground gap'],
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
  [/samples: undefined, sharpHeartbeat: undefined, sharpDutyCorrelation: undefined/, 'Initial CDP summary must omit duplicated large heartbeat evidence'],
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
