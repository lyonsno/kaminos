import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const bridgeUrl = new URL('../volume-dense-cue-splat-bridge.mjs', import.meta.url);
const core = await readFile(new URL('../volume-core.js', import.meta.url), 'utf8');
const bridge = await readFile(bridgeUrl, 'utf8');

assert.match(bridge, /kaminos\.volume\.dense-cue-splat-bridge\.v0/, 'bridge publishes a stable evidence schema');
assert.match(bridge, /kaminos\.volume\.dense-cue-splat-bridge-input\.v0/, 'bridge input contract has a distinct schema');
assert.match(bridge, /truthHigh[\s\S]*low160to144[\s\S]*learned160to144[\s\S]*low160to112[\s\S]*learned160to112/, 'bridge fixes truth and gap-matched controls in operator-readable order');
assert.match(bridge, /analytic[\s\S]*learned/, 'bridge requests both analytic and learned-attribute splat receivers');
assert.match(bridge, /requestedRenderer[\s\S]*effectiveRenderer/, 'bridge distinguishes requested and effective renderer identity');
assert.match(bridge, /renderFrozenScaleToCanvas/, 'bridge renders the overridden sidecar to the canvas before taking a screenshot');
assert.match(bridge, /learned-splat-radius/, 'bridge accepts an explicit learned-role splat radius for receiver-basin assays');
assert.match(bridge, /learned-splat-sharpness/, 'bridge accepts an explicit learned-role splat sharpness for receiver-basin assays');
assert.match(bridge, /receiverControls/, 'bridge records effective per-capture receiver controls');
assert.match(bridge, /boundarySplatCandidateCount[\s\S]*boundarySplatOverflowCount[\s\S]*boundarySplatFallbackReason/, 'bridge preserves candidate, overflow, and fallback evidence');
assert.match(bridge, /failurePhase[\s\S]*lastTrustworthyEvidence/, 'bridge writes durable phase-local failure evidence');
assert.match(bridge, /sourceManifestSha256[\s\S]*boundarySidecarSha256/, 'bridge binds every role to source-manifest and sidecar checksums');
assert.match(bridge, /missing-or-blank-output[\s\S]*requested-effective-renderer-disagreement[\s\S]*controls-signature-disagreement[\s\S]*source-substitution[\s\S]*candidate-overflow[\s\S]*fallback-route/, 'bridge names the expected false-closure gates');
assert.doesNotMatch(bridge, /setActive\(false\)[\s\S]{0,240}sampleDeterministicReplayFrame/, 'bridge must not deactivate the prototype before invoking the fixed-step replay hook');

assert.match(core, /EXTERNAL_BOUNDARY_SIDECAR_AUTHORITY\s*=\s*'externally-uploaded-boundary-sidecar-plus-live-fluid-material-v0'/, 'runtime names external sidecar authority without promoting it to field truth');
assert.match(core, /beginDebugBoundarySidecarOverride/, 'runtime exposes an explicit chunked sidecar upload begin phase');
assert.match(core, /writeDebugBoundarySidecarOverrideChunk/, 'runtime exposes chunk writes without terminal transcription');
assert.match(core, /finishDebugBoundarySidecarOverride/, 'runtime exposes an explicit checked application phase');
assert.match(core, /sampleDeterministicReplayFrame/, 'runtime exposes a fixed-step GPU replay reset instead of relying on page reload timing');
assert.match(core, /deterministic-replay-reset/, 'fixed-step replay records its reset phase');
assert.match(core, /completedSteps/, 'fixed-step replay reports the number of GPU simulation steps actually submitted');
assert.match(core, /controlsSignature:\s*effectiveControlsSignature\(controlsSnapshot\)/, 'fixed-step replay exposes the complete effective live control signature without retired temporal coupling');
assert.match(core, /boundarySidecarSourceName\s*===\s*'override'/, 'runtime skips the baked sidecar pass only for an applied override');
assert.match(core, /boundarySidecarOverrideReceipt/, 'runtime surfaces exact external source identity in debug evidence');
assert.match(core, /boundarySplatRendererIdentity:\s*state\.boundarySplatRendererIdentity/, 'frozen canvas receipt exposes the effective splat renderer');
assert.match(core, /boundarySplatAttributeModelIdentity:\s*state\.boundarySplatAttributeModelIdentity/, 'frozen canvas receipt exposes the effective learned attribute model');

const root = await mkdtemp(join(tmpdir(), 'kaminos-dense-cue-splat-bridge-contract-'));
const decoy = join(tmpdir(), `kaminos-dense-cue-splat-bridge-profile-decoy-${process.pid}`);
process.on('exit', code => {
  try { rmSync(decoy, { recursive: true, force: true }); } catch {}
  if (code === 0) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
  else console.error(`keeping fixture root ${root}: the failure reports are there`);
});
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const roleNames = ['truthHigh', 'low160to144', 'learned160to144', 'low160to112', 'learned160to112'];
const roles = {};
for (let index = 0; index < roleNames.length; index += 1) {
  const role = roleNames[index];
  const bytes = Buffer.from(new Float32Array([index + 0.1, index + 0.2, index + 0.3, index + 0.4]).buffer);
  const sidecarPath = join(root, `${role}.f32`);
  const sourcePath = join(root, `${role}.source.json`);
  await writeFile(sidecarPath, bytes);
  await writeFile(sourcePath, `${JSON.stringify({ role })}\n`);
  roles[role] = {
    sourceKind: role.startsWith('learned') ? 'dense-cue-pack' : 'field-sidecar-control',
    sourceManifestPath: sourcePath,
    sourceManifestSha256: sha256(await readFile(sourcePath)),
    packIdentity: role.startsWith('learned') ? `pack-${role}` : null,
    boundarySidecar: {
      path: sidecarPath,
      byteLength: bytes.byteLength,
      sha256: sha256(bytes),
    },
  };
}

const inputPath = join(root, 'input.json');
const outputPath = join(root, 'report.json');
await writeFile(inputPath, `${JSON.stringify({
  schema: 'kaminos.volume.dense-cue-splat-bridge-input.v0',
  frozenState: {
    identity: 'contract-fixture-frozen-state-v0',
    requestedRoute: 'http://127.0.0.1:9999/?kaminos_volume_smoke=1',
    grid: 1,
    replay: { steps: 1, timeStepMs: 16.6667, startTimeMs: 1000, controlsSignature: 'contract-fixture-controls-v0' },
  },
  renderers: ['analytic', 'learned'],
  roles,
})}\n`);

// Every bridge spawn gets a private TMPDIR under the fixture root, and only
// that directory is inspected for profile directories, so nothing another
// process does in the shared temp root can fail this contract.
const privateTmp = join(root, 'tmp');
await mkdir(privateTmp);
const bridgeEnv = (extra = {}) => ({ ...process.env, TMPDIR: privateTmp, ...extra });
const profilePrefix = 'kaminos-dense-cue-splat-bridge-profile-';
const listProfiles = async () => (await readdir(privateTmp)).filter(name => name.startsWith(profilePrefix)).map(name => join(privateTmp, name));
const profilesBefore = await listProfiles();
// The shared temp root has other producers, including a concurrent copy of
// this contract: a profile directory appearing there mid-run must not fail
// this one, which only ever looks at its own private TMPDIR.
mkdirSync(decoy, { recursive: true });

// Validation never launches a browser, so it must not create a browser
// profile directory either. The bridge used to create one at startup, under
// /tmp and never removed, leaving two behind on every run of this test.
const validate = spawnSync(process.execPath, [bridgeUrl.pathname, '--input', inputPath, '--out', outputPath, '--validate-only'], { encoding: 'utf8', env: bridgeEnv() });
assert.equal(validate.status, 0, validate.stderr || validate.stdout);
const report = JSON.parse(await readFile(outputPath, 'utf8'));
assert.equal(report.status, 'validated');
assert.deepEqual(report.roleOrder, roleNames);
assert.deepEqual(report.rendererOrder, ['analytic', 'learned']);
assert.equal(report.roles.learned160to144.boundarySidecarSha256, roles.learned160to144.boundarySidecar.sha256);
assert.equal(report.falseClosureChecks.sourceSubstitution, false);

// A browser that cannot be launched is a failure at the browser-capture phase
// with a written report, not an unhandled error event, and leaves no profile.
const missingOut = join(root, 'missing-browser-report.json');
const missing = spawnSync(process.execPath, [bridgeUrl.pathname, '--input', inputPath, '--out', missingOut],
  { encoding: 'utf8', env: bridgeEnv({ KAMINOS_CHROME: join(root, 'no-such-browser') }) });
assert.equal(missing.status, 2, missing.stderr || missing.stdout);
const missingReport = JSON.parse(await readFile(missingOut, 'utf8'));
assert.equal(missingReport.failurePhase, 'browser-capture');
assert.match(missingReport.error, /browser launch failed/);
assert.match(missingReport.error, /no-such-browser/);
assert.deepEqual((await listProfiles()).filter(dir => !profilesBefore.includes(dir)), [], 'a failed launch leaves no profile directory');

// Removing the profile must never replace the bridge's own error: a stub
// browser leaves an unremovable subdirectory in the profile and never opens
// a DevTools port, and the report must still carry the DevTools failure. The
// bridge is given a port the system just handed out, so it cannot attach to a
// browser some other process opened on a random port, and a short DevTools
// wait, so the case does not sit through the full default wait.
const freePort = await new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.once('error', rejectPort);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolvePort(port)); });
});
const stubRecord = join(root, 'stub-user-data-dir.txt');
const stubBrowser = join(root, 'stub-browser.sh');
await writeFile(stubBrowser, `#!/bin/sh
for arg in "$@"; do case "$arg" in --user-data-dir=*) dir="\${arg#--user-data-dir=}";; --remote-debugging-port=*) port="\${arg#--remote-debugging-port=}";; esac; done
printf '%s' "$dir" > "$KAMINOS_BRIDGE_STUB_RECORD"
printf '%s' "$port" > "$KAMINOS_BRIDGE_STUB_RECORD.port"
mkdir -p "$dir/locked" && : > "$dir/locked/file" && chmod 000 "$dir/locked"
exit 0
`, { mode: 0o755 });
const launchOut = join(root, 'launch-failure-report.json');
const launchStarted = Date.now();
const launch = spawnSync(process.execPath, [bridgeUrl.pathname, '--input', inputPath, '--out', launchOut, '--debug-port', String(freePort), '--devtools-wait-ms', '750'],
  { encoding: 'utf8', env: bridgeEnv({ KAMINOS_CHROME: stubBrowser, KAMINOS_BRIDGE_STUB_RECORD: stubRecord }) });
const launchMs = Date.now() - launchStarted;
const stubProfile = await readFile(stubRecord, 'utf8');
await chmod(join(stubProfile, 'locked'), 0o700);
await rm(stubProfile, { recursive: true, force: true });
assert.equal(launch.status, 2, launch.stderr || launch.stdout);
const launchReport = JSON.parse(await readFile(launchOut, 'utf8'));
assert.equal(launchReport.failurePhase, 'browser-capture');
assert.match(launchReport.error, /Chrome DevTools endpoint did not open/, 'the bridge error survives a failed profile removal');
assert.match(launchReport.error, new RegExp(`port ${freePort} within 750 ms`), 'the DevTools failure names the port and the wait');
assert.equal(await readFile(`${stubRecord}.port`, 'utf8'), String(freePort), 'the browser is launched on the reserved port');
assert.ok(launchMs < 8000, `the stub case waits the requested 750 ms, not the default wait; took ${launchMs} ms`);
assert.ok(stubProfile.startsWith(privateTmp), `the profile is created under the temp root, got ${stubProfile}`);
assert.match(launch.stderr, /could not remove browser profile/, 'a failed removal is reported with its path');

await writeFile(roles.learned160to112.boundarySidecar.path, Buffer.alloc(16, 0xff));
const failedOutputPath = join(root, 'failed-report.json');
const reject = spawnSync(process.execPath, [bridgeUrl.pathname, '--input', inputPath, '--out', failedOutputPath, '--validate-only'], { encoding: 'utf8', env: bridgeEnv() });
assert.equal(reject.status, 2, 'checksum substitution must fail validation');
const failedReport = JSON.parse(await readFile(failedOutputPath, 'utf8'));
assert.equal(failedReport.status, 'failed');
assert.equal(failedReport.failurePhase, 'input-validation');
assert.match(failedReport.error, /sha256 mismatch/);
assert.deepEqual((await listProfiles()).filter(dir => !profilesBefore.includes(dir)), [], 'validation must not create a browser profile directory');

console.log('dense cue splat bridge contracts passed');
