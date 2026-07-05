import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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

const witnessSource = readFileSync(witnessPath, 'utf8');
assert.match(witnessSource, /recordAdapterSideArtifacts/, 'pipeline witness must ingest adapter side artifacts');
assert.match(witnessSource, /adapterSideArtifactEntries/, 'pipeline witness must preserve adapter-reported side artifacts generically');

const tempRoot = mkdtempSync(join(tmpdir(), 'kaminos-sharp-webgpu-contract-'));
try {
  const input = join(tempRoot, 'source.png');
  const output = join(tempRoot, 'out', 'sharp-output.ply');
  const report = join(tempRoot, 'out', 'adapter-report.json');
  writeFileSync(input, 'fake image bytes\n');

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
