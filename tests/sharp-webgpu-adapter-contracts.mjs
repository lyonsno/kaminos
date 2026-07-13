import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

const root = new URL('..', import.meta.url).pathname;
const manifestPath = join(root, 'pipelines', 'asset-pipelines.json');
const witnessPath = join(root, 'pipeline-witness.mjs');
const wrapperPath = join(root, 'scripts', 'run-sharp-webgpu-adapter.mjs');

assert.ok(existsSync(wrapperPath), 'native SHARP-WebGPU wrapper must exist');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const sharpRoute = manifest.pipelines.find(pipeline => pipeline.id === 'sharp-image-to-splat-live-v0');
assert.ok(sharpRoute, 'SHARP live route must remain the graph SHARP route');
assert.equal(sharpRoute.routeId, 'adapter.sharp-image-to-splat-live.v0');
assert.equal(sharpRoute.artifacts.splat.role, 'splat-candidate');
assert.equal(sharpRoute.artifacts.depthMap.role, 'depth-map');
assert.equal(sharpRoute.artifacts.metadata.role, 'sharp-webgpu-metadata');
assert.ok(sharpRoute.artifacts.autoCropEvidence, 'SHARP live route must declare autocrop evidence as a first-class artifact');
assert.equal(sharpRoute.artifacts.autoCropEvidence.role, 'splat-autocrop-evidence');
assert.equal(sharpRoute.artifacts.autoCropEvidence.schema, 'kaminos.splat-autocrop-evidence.v0');
assert.equal(sharpRoute.stages[0].route.tool, 'SHARP-WebGPU');
assert.equal(sharpRoute.stages[0].route.commandDefault, 'scripts/run-sharp-webgpu-adapter.mjs');
assert.equal(sharpRoute.stages[0].route.effectiveBackend, 'browser-webgpu');
assert.deepEqual(sharpRoute.stages[0].requiredSideArtifacts, ['depthMap', 'metadata', 'autoCropEvidence']);

const wrapperSource = readFileSync(wrapperPath, 'utf8');
const timeoutParserSource = wrapperSource.match(
  /function parsePositiveTimeoutMs\([\s\S]*?\n}\n/,
);
assert.ok(timeoutParserSource, 'adapter must expose a testable finite-positive timeout parser');
const parsePositiveTimeoutMs = vm.runInNewContext(`(${timeoutParserSource[0]})`);
assert.equal(parsePositiveTimeoutMs(undefined, 420000), 420000);
assert.equal(parsePositiveTimeoutMs('420000', 1), 420000);
for (const invalid of ['0', '-1', 'NaN', 'Infinity', '12.5']) {
  assert.throws(
    () => parsePositiveTimeoutMs(invalid, 420000),
    /finite positive integer/,
    `adapter must reject unbounded or malformed timeout ${invalid}`,
  );
}
const probeIntegrationValidatorSource = wrapperSource.match(
  /function validateSharpProbeIntegrationSource\([\s\S]*?\n}\n(?=\nfunction preserveInvalidSharpHeartbeatEvidence)/,
);
assert.ok(probeIntegrationValidatorSource, 'adapter must expose a testable SHARP probe-integration source validator');
const validateSharpProbeIntegrationSource = vm.runInNewContext(
  `(${probeIntegrationValidatorSource[0].replace(/^function /, 'function ')})`,
);
assert.doesNotThrow(() => validateSharpProbeIntegrationSource(`
  window.__sharpContentionProbe?.markInferenceStart?.(currentSchedulerTelemetry.runId);
  window.__sharpContentionProbe?.markInferenceEnd?.(currentSchedulerTelemetry.runId);
`));
assert.throws(
  () => validateSharpProbeIntegrationSource(`
    window.__sharpContentionProbe?.markInferenceStart?.(currentSchedulerTelemetry.runId);
  `),
  /markInferenceEnd/,
  'adapter must reject a SHARP source that cannot close its run-bound heartbeat window',
);
const invalidHeartbeatPreserverSource = wrapperSource.match(
  /function preserveInvalidSharpHeartbeatEvidence\([\s\S]*?\n}\n(?=\nfunction validateKaminosSharpHeartbeat)/,
);
assert.ok(invalidHeartbeatPreserverSource, 'adapter must expose a testable invalid-heartbeat evidence preserver');
const preserveInvalidSharpHeartbeatEvidence = vm.runInNewContext(
  `(${invalidHeartbeatPreserverSource[0].replace(/^function /, 'function ')})`,
);
const invalidEvidenceStore = {};
const invalidCandidate = {
  schema: 'sharp-webgpu.background-heartbeat.v0',
  crossPageClock: null,
  gpuDutyIntervals: {
    runId: 'sharp-current',
    pairingFailures: ['stale run sharp-stale did not match sharp-current'],
  },
};
preserveInvalidSharpHeartbeatEvidence({
  evidenceStore: invalidEvidenceStore,
  backgroundHeartbeat: invalidCandidate,
  schedulerTelemetry: { runId: 'sharp-current' },
  error: new Error('SHARP heartbeat evidence invalid: mixed run'),
});
assert.equal(invalidEvidenceStore.backgroundHeartbeatValidation.status, 'invalid');
assert.equal(invalidEvidenceStore.backgroundHeartbeatValidation.candidate, invalidCandidate);
assert.deepEqual(
  JSON.parse(JSON.stringify(invalidEvidenceStore.backgroundHeartbeatValidation.candidate.gpuDutyIntervals.pairingFailures)),
  ['stale run sharp-stale did not match sharp-current'],
);
assert.equal(invalidEvidenceStore.backgroundHeartbeatValidation.schedulerTelemetry.runId, 'sharp-current');
assert.match(invalidEvidenceStore.backgroundHeartbeatValidation.error, /mixed run/);
const heartbeatValidatorSource = wrapperSource.match(
  /function validateKaminosSharpHeartbeat\([\s\S]*?\n}\n(?=\nasync function installSharpHeartbeatProbe)/,
);
assert.ok(heartbeatValidatorSource, 'adapter must expose a testable heartbeat validator');
const validateKaminosSharpHeartbeat = vm.runInNewContext(
  `(${heartbeatValidatorSource[0].replace(/^function /, 'function ')})`,
  {
    SHARP_BACKGROUND_HEARTBEAT_SCHEMA: 'sharp-webgpu.background-heartbeat.v0',
    CROSS_PAGE_CLOCK_SCHEMA: 'kaminos.browser-epoch-monotonic-clock.v0',
    SHARP_GPU_DUTY_INTERVALS_SCHEMA: 'sharp-webgpu.submitted-work-drain-intervals.v0',
  },
);
const zeroDutyHeartbeat = {
  schema: 'sharp-webgpu.background-heartbeat.v0',
  effectiveScheduler: { mode: 'default', waitForSubmittedWorkDone: false },
  inferenceWindow: { runId: 'sharp-default', startMs: 100, endMs: 200 },
  worstFrameGaps: [{
    startMs: 120,
    endMs: 140,
    durationMs: 20,
    overlapClassification: 'uninstrumented-gap',
  }],
  crossPageClock: {
    schema: 'kaminos.browser-epoch-monotonic-clock.v0',
    timingAuthority: 'performance-time-origin-plus-now',
    runId: 'sharp-default',
    timeOriginEpochMs: 1_700_000_000_000,
    inferenceWindowStartEpochMs: 1_700_000_000_100,
    inferenceWindowEndEpochMs: 1_700_000_000_200,
  },
  gpuDutyIntervals: {
    schema: 'sharp-webgpu.submitted-work-drain-intervals.v0',
    timingAuthority: 'queue-on-submitted-work-done-host-await-not-gpu-exclusive',
    runId: 'sharp-default',
    count: 0,
    intervals: [],
    pairingFailures: [],
  },
};
assert.doesNotThrow(
  () => validateKaminosSharpHeartbeat(zeroDutyHeartbeat),
  'default SHARP runs may preserve a valid zero-duty envelope when submitted-work waiting is disabled',
);
assert.throws(
  () => validateKaminosSharpHeartbeat({
    ...zeroDutyHeartbeat,
    effectiveScheduler: { mode: 'cooperative', waitForSubmittedWorkDone: true },
  }),
  /gpuDutyIntervals/,
  'Friendly SHARP runs must fail loud when submitted-work waiting produced no duty intervals',
);
assert.match(wrapperSource, /kaminos\.sharp-webgpu-adapter-report\.v0/, 'wrapper report must name native SHARP-WebGPU schema');
assert.match(wrapperSource, /kaminos\.splat-autocrop-evidence\.v0/, 'wrapper must emit the autocrop evidence schema consumed by Gutterglass');
assert.match(wrapperSource, /--input/, 'wrapper must keep explicit --input CLI contract');
assert.match(wrapperSource, /--output/, 'wrapper must keep explicit --output CLI contract');
assert.match(wrapperSource, /--report/, 'wrapper must keep explicit --report CLI contract');
assert.match(wrapperSource, /#use-spn/, 'wrapper must force the full SHARP SPN path, not the backbone smoke');
assert.match(wrapperSource, /download-ply/, 'wrapper must harvest the generated PLY download');
assert.match(wrapperSource, /depth-canvas/, 'wrapper must preserve the depth side output');
assert.match(wrapperSource, /computePlyBounds/, 'wrapper must derive autocrop evidence from the generated PLY, not from a blind default crop');
assert.match(wrapperSource, /KAMINOS_PIPELINE_AUTOCROP_EVIDENCE/, 'wrapper must accept a caller-owned autocrop evidence path');
assert.match(wrapperSource, /Browser\.setDownloadBehavior|setDownloadBehavior/, 'wrapper must write PLY through browser download behavior instead of stdout copy-paste');
assert.match(wrapperSource, /KAMINOS_SHARP_WEBGPU_SCHEDULER/, 'wrapper must accept explicit SHARP-WebGPU scheduler config');
assert.match(wrapperSource, /KAMINOS_SHARP_WEBGPU_SCHEDULER_MODE/, 'wrapper must accept Wake-friendly named scheduler modes');
assert.match(wrapperSource, /--scheduler-mode/, 'wrapper must expose named scheduler modes through CLI as well as env');
assert.match(wrapperSource, /sharpScheduler/, 'wrapper must pass scheduler config into the SHARP-WebGPU browser route');
assert.match(wrapperSource, /schedulerTelemetry/, 'wrapper must capture browser-reported scheduler telemetry');
assert.match(wrapperSource, /scheduler-unverified/, 'wrapper must fail loud when requested scheduler telemetry is absent');
assert.match(wrapperSource, /pipelineScheduler/, 'wrapper must expose route-neutral pipeline scheduler evidence alongside raw breathingRoom');
assert.match(wrapperSource, /function emitAdapterProgress\(/, 'wrapper must be able to stream adapter progress while SHARP is running');
assert.match(wrapperSource, /function sharpBrowserProgressFromConsole\(/, 'wrapper must translate SHARP browser console milestones into progress events');
assert.match(wrapperSource, /page\.on\('console'[\s\S]*emitSharpBrowserProgress/, 'wrapper must forward browser console milestones before final PLY completion');
assert.match(wrapperSource, /sharp-webgpu-browser-console/, 'forwarded progress must name the SHARP browser console source');
assert.match(wrapperSource, /\[SPN\]\s+Patch \$\{patchDone\}\/35 done/, 'wrapper must preserve SPN patch chunk milestones as visible progress');
assert.match(wrapperSource, /function lastSharpBrowserMilestone\(/, 'wrapper must preserve the last SHARP browser milestone for failed runs');
assert.match(wrapperSource, /function classifySharpWaitFailure\(/, 'wrapper must classify browser wait failures instead of reporting only a generic Puppeteer error');
assert.match(wrapperSource, /model-stalled-after-monodepth/, 'wrapper must classify failures that stop after monodepth before Gaussian or PLY output');
assert.match(wrapperSource, /browserLastMilestone/, 'failure reports must promote the last browser milestone into trustworthy evidence');
assert.match(wrapperSource, /operatorMessage/, 'failure reports must carry operator-facing copy for visible smoke surfaces');
assert.match(wrapperSource, /function serializeErrorDetails\(/, 'wrapper must serialize Puppeteer error name, stack, and nested cause');
assert.match(wrapperSource, /function classifyUnderlyingErrorCause\(/, 'wrapper must classify the underlying wait failure cause when Puppeteer exposes one');
assert.match(wrapperSource, /errorCauseClassification/, 'wrapper failure reports must include the underlying cause classification');
assert.match(wrapperSource, /function detectSharpPageLoadFailure\(/, 'wrapper must detect Vite/module page-load failures before pretending inference is running');
assert.match(wrapperSource, /sharp-webgpu-page-load-failed/, 'wrapper must classify SHARP page-load failures distinctly from model inference failures');
assert.match(wrapperSource, /Failed to resolve import/, 'wrapper must preserve Vite import resolution errors in page-load failure reports');
assert.match(wrapperSource, /does not provide an export/, 'wrapper must treat stale module export page errors as page-load failures before waiting for model output');
assert.match(wrapperSource, /browserLogs[\s\S]*pageerror/, 'wrapper page-load failure detection must inspect browser page errors, not only Vite stderr');
assert.match(wrapperSource, /timed out\|ms exceeded/, 'wrapper timeout classifier must match ProtocolError timeout wording from Puppeteer');
assert.match(wrapperSource, /puppeteer\.launch\(\{[\s\S]*protocolTimeout:\s*timeoutMs/, 'Puppeteer protocol calls must honor the explicit SHARP route timeout instead of dying at the hidden 180-second default');
assert.match(wrapperSource, /browserLifecycleEvents/, 'wrapper reports must preserve browser lifecycle events alongside console logs');
assert.match(wrapperSource, /page\.on\('close'/, 'wrapper must record page close events');
assert.match(wrapperSource, /page\.on\('error'/, 'wrapper must record page crash/error events');
assert.match(wrapperSource, /requestfailed/, 'wrapper must record failed browser requests when the live page fails before output');
assert.match(wrapperSource, /sharp-webgpu\.background-heartbeat\.v0/, 'wrapper must require the reviewed SHARP background heartbeat schema');
assert.match(wrapperSource, /createSharpBackgroundHeartbeatReport/, 'wrapper must classify gaps with SHARP source-owned heartbeat logic');
assert.match(wrapperSource, /function installSharpHeartbeatProbe\(/, 'wrapper must install a RAF probe in the real browser route');
assert.match(wrapperSource, /validateSharpProbeIntegrationSource\(readFileSync\(join\(sharpRepo, 'src', 'main\.js'\)/, 'wrapper must verify that its effective SHARP source owns heartbeat window actuation');
assert.match(
  wrapperSource,
  /markInferenceEnd\(runId\)\s*\{[\s\S]*probe\.inferenceWindow\.runId !== runId[\s\S]*Number\.isFinite\(probe\.inferenceWindow\.endMs\)[\s\S]*return probe\.inferenceWindow\.endMs/,
  'heartbeat inference end must preserve run identity and remain first-write authoritative',
);
assert.match(wrapperSource, /backgroundHeartbeat\.inferenceWindow/, 'wrapper must fail loud when the scoped inference window is absent');
assert.match(wrapperSource, /backgroundHeartbeat\.worstFrameGaps/, 'wrapper must fail loud when scoped worst-gap rows are absent');
assert.match(wrapperSource, /markInferenceStart\(runId\)/, 'adapter probe must bind the inference window to SHARP run identity');
assert.match(wrapperSource, /markInferenceEnd\(runId\)/, 'adapter probe must reject or preserve the source run identity at inference end');
assert.match(wrapperSource, /timeOriginEpochMs/, 'adapter probe must preserve its declared epoch-monotonic clock origin');
assert.match(wrapperSource, /backgroundHeartbeat\.crossPageClock/, 'adapter must fail loud when the shared cross-page clock is absent');
assert.match(wrapperSource, /backgroundHeartbeat\.gpuDutyIntervals/, 'adapter must fail loud when run-bound submitted-work duty intervals are absent');
assert.match(
  wrapperSource,
  /lastTrustworthyEvidence\.backgroundHeartbeatCandidate = backgroundHeartbeat;[\s\S]*try \{[\s\S]*validateKaminosSharpHeartbeat\(backgroundHeartbeat\)[\s\S]*preserveInvalidSharpHeartbeatEvidence/,
  'adapter must preserve the candidate heartbeat before validation can throw',
);
assert.match(wrapperSource, /sharpRepoRevision/, 'wrapper must record the effective SHARP source revision used by the route');

const witnessSource = readFileSync(witnessPath, 'utf8');
assert.match(witnessSource, /recordAdapterSideArtifacts/, 'pipeline witness must ingest adapter side artifacts');
assert.match(witnessSource, /adapterSideArtifactEntries/, 'pipeline witness must preserve adapter-reported side artifacts generically');
assert.match(witnessSource, /backgroundHeartbeat:\s*report\?\.backgroundHeartbeat/, 'pipeline witness must preserve the validated heartbeat in its adapter summary');
assert.match(witnessSource, /revision:\s*report\?\.backend\?\.revision/, 'pipeline witness must preserve the effective SHARP source revision in its adapter summary');

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-sharp-webgpu-contract-'));
try {
  const input = join(tempRoot, 'source.png');
  const output = join(tempRoot, 'out', 'sharp-output.ply');
  const report = join(tempRoot, 'out', 'adapter-report.json');
  writeFileSync(input, 'fake image bytes\n');

  const invalidTimeoutOutput = join(tempRoot, 'out', 'invalid-timeout-output.ply');
  const invalidTimeoutReport = join(tempRoot, 'out', 'invalid-timeout-report.json');
  const invalidTimeout = spawnSync(process.execPath, [
    wrapperPath,
    '--input', input,
    '--output', invalidTimeoutOutput,
    '--report', invalidTimeoutReport,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_WEBGPU_REPO: join(tempRoot, 'missing-sharp-webgpu'),
      KAMINOS_SHARP_WEBGPU_TIMEOUT_MS: '0',
    },
  });

  assert.notEqual(invalidTimeout.status, 0, 'unbounded SHARP timeout must fail loud');
  assert.ok(existsSync(invalidTimeoutReport), 'invalid timeout failure must still write a durable report');
  assert.equal(existsSync(invalidTimeoutOutput), false, 'invalid timeout failure must not write a placeholder PLY');
  const invalidTimeoutEvidence = JSON.parse(readFileSync(invalidTimeoutReport, 'utf8'));
  assert.equal(invalidTimeoutEvidence.ok, false);
  assert.equal(invalidTimeoutEvidence.phase, 'validating-timeout');
  assert.match(invalidTimeoutEvidence.error, /finite positive integer/);

  const proc = spawnSync(process.execPath, [
    wrapperPath,
    '--input', input,
    '--output', output,
    '--report', report,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_WEBGPU_REPO: join(tempRoot, 'missing-sharp-webgpu'),
      KAMINOS_SHARP_WEBGPU_TIMEOUT_MS: '1000',
      KAMINOS_SHARP_WEBGPU_SCHEDULER_MODE: 'friendly',
    },
  });

  assert.notEqual(proc.status, 0, 'missing native SHARP repo must fail loud');
  assert.ok(existsSync(report), 'native SHARP failure must still write a durable report');
  assert.equal(existsSync(output), false, 'native SHARP failure must not write a placeholder PLY');
  const failureReport = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(failureReport.schema, 'kaminos.sharp-webgpu-adapter-report.v0');
  assert.equal(failureReport.ok, false);
  assert.equal(failureReport.backend.modelFamily, 'SHARP-WebGPU');
  assert.equal(failureReport.backend.runtime, 'browser-webgpu');
  assert.equal(failureReport.backend.schedulerMode.requested, 'friendly');
  assert.equal(failureReport.backend.schedulerMode.effective, 'friendly');
  assert.equal(failureReport.backend.schedulerMode.profileId, 'cooperative-spn-gaussian');
  assert.equal(failureReport.breathingRoom.schema, 'kaminos.sharp-webgpu-scheduler-evidence.v0');
  assert.equal(failureReport.breathingRoom.status, 'scheduler-unverified');
  assert.equal(failureReport.breathingRoom.schedulerMode.requested, 'friendly');
  assert.equal(failureReport.breathingRoom.schedulerMode.effective, 'friendly');
  assert.equal(failureReport.breathingRoom.requestedScheduler.spnPatchChunkSize, 1);
  assert.equal(failureReport.breathingRoom.requestedScheduler.vitBlockChunkSize, 2);
  assert.equal(failureReport.breathingRoom.effectiveScheduler, null);
  assert.equal(failureReport.pipelineScheduler.schema, 'kaminos.pipeline-scheduler-composition.v0');
  assert.equal(failureReport.pipelineScheduler.source, 'pipeline-adapter-report');
  assert.equal(failureReport.pipelineScheduler.verificationState, 'scheduler-unverified');
  assert.equal(failureReport.pipelineScheduler.schedulerMode.requested, 'friendly');
  assert.equal(failureReport.pipelineScheduler.schedulerMode.effective, 'friendly');
  assert.equal(failureReport.pipelineScheduler.requestedScheduler.vitBlockChunkSize, 2);
  assert.equal(failureReport.pipelineScheduler.effectiveScheduler, null);
  assert.equal(failureReport.schedulerVerification.status, 'unsupported');
  assert.equal(failureReport.schedulerVerification.classification, 'unsupported');
  assert.equal(failureReport.schedulerVerification.boundaryAssertions.some(assertion => assertion.field === 'phaseChunkSize.vitBlock' && assertion.status === 'unsupported'), true);
  assert.equal(failureReport.schedulerVerification.downgrades.includes('event-trace-missing'), true);
  assert.equal(failureReport.pipelineScheduler.scheduler.schema, 'kaminos.webgpu-route-scheduler.v0');
  assert.equal(failureReport.pipelineScheduler.scheduler.requestedScheduler.phaseChunkSize.vitBlock, 2);
  assert.equal(failureReport.pipelineScheduler.scheduler.effectiveScheduler.unsupportedFields.includes('phaseChunkSize'), true);
  assert.equal(failureReport.pipelineScheduler.scheduler.breathability.spans.length, 5);
  assert.equal(failureReport.pipelineScheduler.scheduler.breathability.checkpoints.length, 5);
  assert.equal(failureReport.pipelineScheduler.scheduler.breathability.spans[0].interruptible, false);
  assert.equal(failureReport.pipelineScheduler.backpressure.schema, 'kaminos.webgpu-route-backpressure.v0');
  assert.equal(failureReport.pipelineScheduler.raw.breathingRoom.status, 'scheduler-unverified');
  assert.deepEqual(failureReport.pipelineScheduler.failureDowngrades, ['effective-scheduler-missing']);
  assert.match(failureReport.phase, /validating|initializing|starting/, 'failure report must preserve failure phase');
  assert.match(failureReport.error, /SHARP-WebGPU repo|weights|package/, 'failure must name the missing native substrate');

  const invalidModeReport = join(tempRoot, 'out', 'invalid-mode-report.json');
  const invalidMode = spawnSync(process.execPath, [
    wrapperPath,
    '--input', input,
    '--output', join(tempRoot, 'out', 'invalid-mode-output.ply'),
    '--report', invalidModeReport,
    '--scheduler-mode', 'bogus-friendly',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KAMINOS_SHARP_WEBGPU_REPO: join(tempRoot, 'missing-sharp-webgpu'),
      KAMINOS_SHARP_WEBGPU_TIMEOUT_MS: '1000',
    },
  });

  assert.notEqual(invalidMode.status, 0, 'unknown named scheduler mode must fail loud');
  assert.ok(existsSync(invalidModeReport), 'unknown named scheduler mode must still write a durable report');
  const invalidReport = JSON.parse(readFileSync(invalidModeReport, 'utf8'));
  assert.equal(invalidReport.ok, false);
  assert.equal(invalidReport.backend.schedulerMode.requested, 'bogus-friendly');
  assert.equal(invalidReport.backend.schedulerMode.effective, null);
  assert.equal(invalidReport.breathingRoom.schedulerMode.requested, 'bogus-friendly');
  assert.equal(invalidReport.breathingRoom.schedulerMode.effective, null);
  assert.match(invalidReport.error, /unknown SHARP breathing-room scheduler mode/);
  assert.equal(existsSync(join(tempRoot, 'out', 'invalid-mode-output.ply')), false, 'unknown mode failure must not write a placeholder PLY');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
