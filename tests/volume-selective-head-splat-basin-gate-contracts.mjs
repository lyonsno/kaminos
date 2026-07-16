import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = join(import.meta.dirname, '..');
const witnessPath = join(root, 'volume-selective-head-splat-basin-gate.mjs');
const corePath = join(root, 'volume-core.js');

assert.ok(existsSync(witnessPath), 'same-state splat basin gate witness exists');
const witness = readFileSync(witnessPath, 'utf8');
const core = readFileSync(corePath, 'utf8');

assert.match(witness, /kaminos\.volume\.selective-head-splat-basin-gate\.v0/, 'witness has a stable evidence schema');
assert.match(witness, /const ROLES = \['truthHigh', 'lowPhaseAligned'\]/, 'witness captures only reference and native-low control roles');
assert.doesNotMatch(witness, /const ROLES = [^\n]*selectiveFullResidual/, 'learned residual is excluded from the basin gate');
assert.match(witness, /splat-only-v0/, 'witness pins the splat-only composition');
assert.match(witness, /current-high-field-reference-no-learned-composition-v0/, 'truth role authority is explicit');
assert.match(witness, /phase-aligned-low-field-control-v0/, 'low-control role authority is explicit');
assert.match(witness, /setCapturePaused\(true\)/, 'witness freezes simulator evolution before role comparison');
assert.match(witness, /beforeSimStepCount/, 'witness checks the starting simulation step');
assert.match(witness, /sameStateSimStep/, 'witness records one shared simulator step');
assert.match(witness, /effectiveRole/, 'witness rejects requested/effective role drift');
assert.match(witness, /selectiveHeadLiveCompositionEffective/, 'witness rejects composition drift');
assert.match(witness, /boundarySplatCandidateCount/, 'witness records the effective splat candidate count');
assert.match(witness, /boundarySplatInstanceCount/, 'witness records the effective splat instance count');
assert.match(witness, /boundarySplatOverflowCount/, 'witness rejects splat overflow');
assert.match(witness, /boundarySplatCountAuthority/, 'witness records the post-submit splat count authority');
assert.match(witness, /boundarySplatInitialOverflowCount/, 'witness preserves the first-pass overflow that triggered capacity growth');
assert.match(witness, /boundarySplatCapacityRetryCount/, 'witness records the bounded same-state capacity retry');
assert.match(core, /captureSelectiveHeadLiveFrame[\s\S]*encodeBoundarySplatTelemetry\(encoder, true\)/, 'selective capture samples its own GPU splat population');
assert.match(core, /captureSelectiveHeadLiveFrame[\s\S]*boundarySplatCountAuthority:\s*state\.boundarySplatCountAuthority/, 'selective capture returns the post-submit splat count authority');
assert.match(witness, /candidatePackageApplied:\s*null/, 'witness does not invent unobservable package application state');
assert.match(witness, /basinSettingsSha256/, 'witness records the exact settings authority supplied by the caller');
assert.match(witness, /lastTrustworthyEvidence/, 'witness preserves evidence on pre-output failure');
assert.match(witness, /failurePhase/, 'witness names the failure phase');
assert.match(witness, /Page\.captureScreenshot/, 'witness captures inspectable visual output');
assert.match(witness, /canvasCssRect/, 'witness binds capture to the actual volume canvas');
assert.match(witness, /clip:/, 'witness clips the screenshot to the volume canvas');
assert.match(witness, /analyzePngPixels/, 'witness decodes pixels instead of trusting PNG byte length');
assert.match(witness, /pixelEvidence/, 'witness records foreground pixel evidence');
assert.match(witness, /captureRouteIdentity/, 'capture-time route identity is retained');
assert.match(witness, /captureBackend/, 'capture-time backend identity is retained');
assert.match(witness, /candidatePackageObservation/, 'candidate-package state is recorded as observation rather than assertion');
assert.doesNotMatch(witness, /same-state-package-disabled/, 'unobservable package state must not appear in successful gate authority');
assert.match(witness, /same-state-observed-splat-basin-gate-v0/, 'successful gate identity is limited to observed state');
assert.match(witness, /operator-request-not-runtime-observation-v0/, 'package-disabled request is separated from runtime observation');
assert.match(witness, /const EXPECTED_BACKEND = 'WebGPU:apple'/, 'gate pins the accepted backend');
assert.match(witness, /state\?\.backend === EXPECTED_BACKEND/, 'settle cannot close on an absent or alternate backend');
assert.match(witness, /captureBackend, EXPECTED_BACKEND/, 'each capture rechecks the accepted backend');
assert.match(witness, /caller-provided-settings-hash-not-live-derived-v0/, 'settings hash authority is not overstated');
assert.match(witness, /--camera-position/, 'witness accepts an explicit camera position');
assert.match(witness, /--camera-target/, 'witness accepts an explicit camera target');
assert.match(witness, /kaminosSetCameraDebugPose/, 'witness applies the requested volume camera pose');
assert.match(witness, /kaminosCameraDebugState/, 'witness records the effective volume camera pose');
assert.match(witness, /cameraAuthority/, 'witness names the camera authority instead of treating framing as implicit');
assert.match(witness, /--min-sim-step/, 'witness requires an explicit evolved-state threshold');
assert.match(witness, /minimumSimStep/, 'witness records the effective evolved-state threshold');

const failureRoot = mkdtempSync(join(tmpdir(), 'kaminos-splat-basin-gate-failure-'));
try {
  const failureReport = join(failureRoot, 'report.json');
  const result = spawnSync(process.execPath, [
    witnessPath,
    '--out-dir', failureRoot,
    '--report', failureReport,
  ], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, 'missing required input must fail');
  assert.ok(existsSync(failureReport), 'argument failure must still write a durable report');
  const failure = JSON.parse(readFileSync(failureReport, 'utf8'));
  assert.equal(failure.status, 'failed');
  assert.equal(failure.failurePhase, 'argument-validation');
  assert.match(failure.error, /missing --url/);
} finally {
  rmSync(failureRoot, { recursive: true, force: true });
}

console.log('selective-head splat basin gate contracts passed');
