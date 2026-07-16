import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scriptUrl = new URL('../scripts/capture-smoke-oracle-teacher-sequence.mjs', import.meta.url);
const source = await readFile(scriptUrl, 'utf8');
const volumeCoreSource = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const viewerSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');

assert.match(
  source,
  /--reuse-browser/,
  'teacher capture CLI must be able to attach to an already-proven headful CDP browser',
);

assert.match(
  source,
  /cdpStartupTimeoutMs/,
  'teacher capture CLI must bound CDP startup separately from long GPU readback calls',
);

assert.match(
  source,
  /recordFailureReport/,
  'teacher capture CLI must write a durable failure report from every pre-frame failure path',
);

assert.match(
  source,
  /SIGINT/,
  'teacher capture CLI must mark interrupted reports failed instead of leaving status=running',
);

assert.match(
  source,
  /controlledStepFrame/,
  'teacher capture CLI must use frame-locked controlledStepFrame sampling before dense export',
);

assert.match(
  source,
  /frame-locked-render-scale-set-v0/,
  'teacher capture CLI must validate controlled-step sample-set authority before accepting a teacher frame',
);

assert.match(
  source,
  /cdp-chunked-full-grid-readback-no-total-cap-v1/,
  'teacher capture CLI must record chunking as an uncapped transport policy, not a hidden dense-field cap',
);

assert.match(
  source,
  /uncapped-contiguous-chunks-until-runtime-complete/,
  'teacher capture CLI must keep exporting chunks until the runtime reports complete coverage',
);

assert.doesNotMatch(
  source,
  /for \(let attempt = 0; attempt < 120; attempt \+= 1\)[^]*cdpFetch\(port, '\/json\/version'\)/,
  'CDP startup polling must not multiply the long GPU readback timeout into a hidden multi-hour startup wait',
);

assert.match(
  source,
  /--held-manifest/,
  'minimum-radius teacher capture must bind the exact held r160 source manifest',
);

assert.match(
  source,
  /--candidate-radius/,
  'radius-bracket capture must receive the candidate radius as an invocation-scoped input',
);

assert.match(
  source,
  /buildRadiusCandidateTeacherContract/,
  'an intermediate-radius run must use the exact one-field candidate contract rather than impersonating the minimum-radius receipt',
);

assert.match(
  source,
  /--temporal-ceiling-source/,
  'the competent temporal teacher must have an explicit accepted-source invocation mode',
);

assert.match(
  source,
  /buildTemporalCeilingTeacherContract/,
  'the accepted source route must be validated before browser or GPU work begins',
);

const invalidTemporalSourceDir = mkdtempSync(join(tmpdir(), 'kaminos-teacher-invalid-temporal-source-'));
try {
  const invalidTemporalSource = spawnSync(process.execPath, [
    scriptUrl.pathname,
    '--out-dir', invalidTemporalSourceDir,
    '--temporal-ceiling-source',
    '--url', 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_input_radius=0.08&volume_flow_rate=0.35&volume_resolution=160',
  ], { encoding: 'utf8' });
  assert.notEqual(invalidTemporalSource.status, 0, 'the floor-radius source must fail temporal-ceiling preflight');
  const failureReport = JSON.parse(readFileSync(join(invalidTemporalSourceDir, 'teacher-capture-report.json'), 'utf8'));
  assert.equal(failureReport.status, 'failed');
  assert.equal(failureReport.failurePhase, 'contract-preflight');
  assert.match(failureReport.failures.at(-1)?.message || '', /volume_input_radius=0.12/);
} finally {
  rmSync(invalidTemporalSourceDir, { recursive: true, force: true });
}

assert.match(
  source,
  /candidateInputRadius/,
  'the capture report must preserve the requested radius independently of the held manifest',
);

assert.match(
  source,
  /isTeacherCaptureRouteReady/,
  'route startup must delegate null-safe readiness decisions to the tested contract helper',
);

const invalidPreflightDir = mkdtempSync(join(tmpdir(), 'kaminos-teacher-invalid-preflight-'));
try {
  const invalidPreflight = spawnSync(process.execPath, [
    scriptUrl.pathname,
    '--out-dir', invalidPreflightDir,
    '--probe-until-mature',
  ], { encoding: 'utf8' });
  assert.notEqual(invalidPreflight.status, 0, 'an authority-detached maturity probe must fail');
  const failureReport = JSON.parse(readFileSync(join(invalidPreflightDir, 'teacher-capture-report.json'), 'utf8'));
  assert.equal(failureReport.status, 'failed', 'invalid invocation must not strand a durable report at status=running');
  assert.equal(failureReport.failurePhase, 'contract-preflight');
  assert.match(failureReport.failures.at(-1)?.message || '', /requires --held-manifest/);
} finally {
  rmSync(invalidPreflightDir, { recursive: true, force: true });
}

const invalidRouteDir = mkdtempSync(join(tmpdir(), 'kaminos-teacher-invalid-route-'));
try {
  const invalidRoute = spawnSync(process.execPath, [
    scriptUrl.pathname,
    '--out-dir', invalidRouteDir,
    '--url', 'not-a-url',
  ], { encoding: 'utf8' });
  assert.notEqual(invalidRoute.status, 0, 'a malformed requested route must fail');
  const failureReport = JSON.parse(readFileSync(join(invalidRouteDir, 'teacher-capture-report.json'), 'utf8'));
  assert.equal(failureReport.status, 'failed', 'route parsing must happen inside durable preflight reporting');
  assert.equal(failureReport.failurePhase, 'contract-preflight');
  assert.match(failureReport.failures.at(-1)?.message || '', /Invalid URL/);
} finally {
  rmSync(invalidRouteDir, { recursive: true, force: true });
}

assert.match(
  source,
  /validateMinimumRadiusEffectiveState/,
  'minimum-radius teacher capture must reject a second effective control change or camera drift',
);

assert.match(
  source,
  /--probe-until-mature/,
  'teacher capture must evolve to a measured maturity candidate instead of forcing a predetermined step',
);

assert.match(
  source,
  /assessMinimumRadiusMaturityCandidate/,
  'machine maturity probes must remain candidate evidence pending original-resolution visual inspection',
);

assert.match(
  source,
  /captureRenderer:\s*'native-raymarch'/,
  'minimum-radius probes must explicitly request the native raymarch control instead of inheriting boundary-splat composition',
);

assert.match(
  source,
  /includeSimReadback:\s*false/,
  'maturity probes must not pay for a full 160-cubed simulator diagnostic readback before every image',
);

assert.match(
  volumeCoreSource,
  /native-raymarch-teacher-capture-v0/,
  'runtime samples must report the explicit native-raymarch teacher capture authority',
);

assert.match(
  source,
  /volume_capture_hold/,
  'held teacher capture must request explicit-step initialization before the page can enqueue autonomous r160 frames',
);

assert.match(
  volumeCoreSource,
  /capture-hold-explicit-step-v0/,
  'runtime state must expose that capture owns frame submission instead of hiding the stopped render loop',
);

assert.match(
  volumeCoreSource,
  /if \(!forceNativeRaymarchCapture\) \{\s*encodeBoundarySidecar\(encoder\);\s*encodeBoundarySplats\(encoder\);\s*\}/,
  'native raymarch capture must bypass sidecar and splat compute instead of only replacing their final draw pass',
);

assert.match(
  viewerSource,
  /volume_capture_hold/,
  'the viewer route must consume the explicit capture-hold request during initial activation',
);

assert.match(
  volumeCoreSource,
  /native-raymarch-canvas-submission-v0/,
  'runtime must expose a native canvas submission path that does not depend on the hanging texture-to-buffer map',
);

assert.match(
  source,
  /Page\.captureScreenshot/,
  'held teacher capture must preserve compositor-presented native canvas pixels when direct GPU buffer mapping stalls',
);

assert.match(
  source,
  /cdp-native-canvas-clip-after-explicit-raymarch-submission-v0/,
  'canvas witness authority must be explicit rather than impersonating direct texture readback',
);

assert.match(
  source,
  /ArrayBuffer\.isView\(sample\.image\.rgba\)/,
  'complete host-decoded RGBA typed arrays must not be rejected merely because CDP pixels formerly arrived as JSON arrays',
);

assert.match(
  source,
  /--attach-without-navigate/,
  'a visually rejected maturity candidate must continue from the same proven browser state instead of resetting the simulator',
);

assert.match(
  source,
  /same-browser-no-navigation-continuation-v0/,
  'continued maturity search must record explicit non-navigation state authority',
);

console.log('smoke oracle teacher capture CLI contracts passed');
