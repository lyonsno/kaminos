import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SF3D_LIVE_SMOKE_ROUTE_ID,
  SF3D_LIVE_SMOKE_SOURCE_REVISION,
  SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
  SF3D_LIVE_SMOKE_OPTIONS,
  canFireSf3dLiveSmoke,
  progressFromSf3dMessage,
  summarizeSf3dFrameGaps,
  validateSf3dLiveSmokeConfig,
} from '../sf3d-live-smoke-core.js';
import {
  extractRequestedReportPath,
  finalizeWitnessReport,
  requireArgumentValue,
  validateTetWitnessEvidence,
} from '../scripts/sf3d-live-smoke-witness-core.mjs';

assert.equal(SF3D_LIVE_SMOKE_ROUTE_ID, 'sf3d.image-to-mesh.webgpu-local.v0');
assert.equal(SF3D_LIVE_SMOKE_SOURCE_REVISION, '2f79b9b84a19809107f5eb29b5fab806e00e6c6a');
assert.equal(SF3D_LIVE_SMOKE_GPU_TOPOLOGY, 'same-page-dual-device-shared-physical-gpu');
assert.deepEqual(SF3D_LIVE_SMOKE_OPTIONS, {
  cooperativeDino: false,
  cooperativeBake: true,
  bakeSchedulingMode: 'cooperative',
  bakeBatchTexels: 4096,
  decoderArena: true,
  materializeWorker: true,
});
assert.equal(canFireSf3dLiveSmoke({ running: false, deviceLost: false }), true);
assert.equal(canFireSf3dLiveSmoke({ running: true, deviceLost: false }), false);
assert.equal(canFireSf3dLiveSmoke({ running: false, deviceLost: true }), false);
assert.equal(canFireSf3dLiveSmoke({ running: false, deviceLost: false, attempted: true }), false);

const config = validateSf3dLiveSmokeConfig({
  ok: true,
  schema: 'kaminos.sf3d-live-smoke-config.v0',
  routeId: SF3D_LIVE_SMOKE_ROUTE_ID,
  requestedRevision: SF3D_LIVE_SMOKE_SOURCE_REVISION,
  effectiveRevision: SF3D_LIVE_SMOKE_SOURCE_REVISION,
  clean: true,
  origin: 'http://127.0.0.1:5176',
});
assert.equal(config.effectiveRevision, SF3D_LIVE_SMOKE_SOURCE_REVISION);
assert.throws(
  () => validateSf3dLiveSmokeConfig({ ...config, effectiveRevision: 'stale' }),
  /effective revision/i,
);
assert.throws(
  () => validateSf3dLiveSmokeConfig({ ...config, clean: false }),
  /clean source/i,
);
assert.throws(
  () => validateSf3dLiveSmokeConfig({ ...config, routeId: 'fallback.route' }),
  /route identity/i,
);

const expectedRevision = SF3D_LIVE_SMOKE_SOURCE_REVISION;
const expectedRepo = '/private/tmp/sf3d-webgpu-wake-portable-tet-origin-0726';
const witnessConfig = {
  ...config,
  repo: expectedRepo,
};
const tetAssets = {
  sourceOrigin: config.origin,
  moduleUrl: `${config.origin}/src/lib/marching_tet.js`,
  numVertices: 535_882,
  numTets: 2_971_452,
  vertexBytes: 6_430_584,
  indexBytes: 47_543_232,
};
const tetResponses = [
  {
    url: `${config.origin}/tets/_grid_vertices.bin`,
    origin: config.origin,
    status: 200,
    fromCache: false,
    fromServiceWorker: false,
  },
  {
    url: `${config.origin}/tets/indices.bin`,
    origin: config.origin,
    status: 200,
    fromCache: false,
    fromServiceWorker: false,
  },
];
const witnessEvidence = {
  configBefore: witnessConfig,
  configAfter: witnessConfig,
  expectedRevision,
  expectedRepo,
  tetAssets,
  tetResponses,
};
assert.equal(validateTetWitnessEvidence(witnessEvidence).effectiveRevision, expectedRevision);
assert.throws(
  () => validateTetWitnessEvidence({ ...witnessEvidence, expectedRevision: 'stale' }),
  /accepted revision/i,
);
assert.throws(
  () => validateTetWitnessEvidence({
    ...witnessEvidence,
    configAfter: { ...witnessConfig, repo: '/tmp/repointed-source' },
  }),
  /changed during tet probe/i,
);
assert.throws(
  () => validateTetWitnessEvidence({ ...witnessEvidence, tetResponses: tetResponses.slice(0, 1) }),
  /expected 2 tet responses/i,
);
assert.throws(
  () => validateTetWitnessEvidence({ ...witnessEvidence, tetResponses: [...tetResponses, tetResponses[0]] }),
  /expected 2 tet responses/i,
);
for (const [field, value, pattern] of [
  ['status', 404, /HTTP 404/],
  ['origin', 'http://127.0.0.1:8093', /escaped SF3D origin/],
  ['fromCache', true, /browser cache/],
  ['fromServiceWorker', true, /service worker/],
]) {
  assert.throws(
    () => validateTetWitnessEvidence({
      ...witnessEvidence,
      tetResponses: [{ ...tetResponses[0], [field]: value }, tetResponses[1]],
    }),
    pattern,
  );
}

assert.equal(
  extractRequestedReportPath(['--report', '/tmp/requested.json'], '/tmp/default.json'),
  '/tmp/requested.json',
);
assert.equal(
  extractRequestedReportPath(['--report', '--settle-ms', '10'], '/tmp/default.json'),
  '/tmp/default.json',
  'an option token must never become an output filename',
);
assert.equal(
  extractRequestedReportPath(['--report'], '/tmp/default.json'),
  '/tmp/default.json',
);
assert.equal(requireArgumentValue('--report', '/tmp/report.json'), '/tmp/report.json');
assert.throws(() => requireArgumentValue('--report', '--settle-ms'), /incomplete argument.*--report/i);
assert.throws(() => requireArgumentValue('--report', undefined), /incomplete argument.*--report/i);

const cleanupFailureReport = { ok: true, failurePhase: null };
let writtenReport = null;
let disconnected = false;
let killed = false;
await finalizeWitnessReport({
  browser: {
    close: async () => { throw new Error('Chrome disconnected'); },
    disconnect: () => { disconnected = true; },
    process: () => ({ kill: () => { killed = true; } }),
  },
  report: cleanupFailureReport,
  reportPath: '/tmp/activation-witness.json',
  mkdirImpl: async () => {},
  writeFileImpl: async (path, text) => { writtenReport = { path, text }; },
});
assert.equal(cleanupFailureReport.ok, false);
assert.equal(cleanupFailureReport.failurePhase, 'browser-cleanup');
assert.match(cleanupFailureReport.cleanupError, /Chrome disconnected/);
assert.equal(disconnected, true);
assert.equal(killed, true);
assert.equal(writtenReport.path, '/tmp/activation-witness.json');
assert.match(writtenReport.text, /Chrome disconnected/);

const cleanupTimeoutReport = { ok: true, failurePhase: null };
let timeoutKilled = false;
let timeoutReportWritten = false;
await finalizeWitnessReport({
  browser: {
    close: () => new Promise(() => {}),
    disconnect: () => {},
    process: () => ({ kill: () => { timeoutKilled = true; } }),
  },
  report: cleanupTimeoutReport,
  reportPath: '/tmp/activation-witness-timeout.json',
  closeTimeoutMs: 1,
  mkdirImpl: async () => {},
  writeFileImpl: async () => { timeoutReportWritten = true; },
});
assert.equal(cleanupTimeoutReport.ok, false);
assert.equal(cleanupTimeoutReport.failurePhase, 'browser-cleanup');
assert.match(cleanupTimeoutReport.cleanupError, /timed out/);
assert.equal(timeoutKilled, true);
assert.equal(timeoutReportWritten, true);

const malformedRunDir = mkdtempSync(join(tmpdir(), 'sf3d-witness-arguments-'));
const malformedReportPath = join(malformedRunDir, 'report.json');
try {
  const malformedRun = spawnSync(process.execPath, [
    new URL('../scripts/witness-sf3d-live-smoke-activation.mjs', import.meta.url).pathname,
    '--settle-ms',
    'not-a-number',
    '--report',
    malformedReportPath,
  ], { encoding: 'utf8' });
  assert.notEqual(malformedRun.status, 0, 'malformed witness invocation must fail');
  assert.equal(existsSync(malformedReportPath), true, 'malformed invocation must still write its requested report');
  const malformedReport = JSON.parse(readFileSync(malformedReportPath, 'utf8'));
  assert.equal(malformedReport.failurePhase, 'arguments');
  assert.match(malformedReport.error, /settle-ms/);
  assert.equal(malformedReport.lastTrustworthyEvidence, 'report initialized');
} finally {
  rmSync(malformedRunDir, { recursive: true, force: true });
}

assert.deepEqual(progressFromSf3dMessage('Texture bake 12/48 (25%)'), {
  percent: 90,
  label: 'Texture bake 12 / 48',
});
assert.deepEqual(progressFromSf3dMessage('Running two-stream backbone...'), {
  percent: 42,
  label: 'Two-stream backbone',
});

const summary = summarizeSf3dFrameGaps([8, 16, 17, 50, 101, 251]);
assert.equal(summary.samples, 6);
assert.equal(summary.p95Ms, 251);
assert.equal(summary.p99Ms, 251);
assert.equal(summary.maxMs, 251);
assert.deepEqual(summary.thresholdCounts, {
  over50Ms: 3,
  over100Ms: 2,
  over250Ms: 1,
});

const root = new URL('..', import.meta.url);
const indexSource = readFileSync(new URL('index.html', root), 'utf8');
const serverSource = readFileSync(new URL('serve.py', root), 'utf8');
const launcherSource = readFileSync(new URL('scripts/run-sf3d-live-smoke.mjs', root), 'utf8');
const witnessSource = readFileSync(new URL('scripts/witness-sf3d-live-smoke-activation.mjs', root), 'utf8');
assert.doesNotMatch(indexSource, /device: sf3dLiveSmokePrepared\.device/, 'Kaminos must not consume SF3D external-device lifetime');
assert.match(indexSource, /new THREE\.WebGPURenderer\(\{\s*antialias: true,\s*\}\)/, 'Kaminos must retain renderer-owned device creation');
assert.match(indexSource, /id="sf3d-live-smoke-topology"/, 'the operator surface must expose effective GPU topology');
assert.match(indexSource, /noteRenderedFrame\(performance\.now\(\), frameMs\)/, 'the live route must measure actual renderer-loop completions');
assert.match(indexSource, /sf3dLiveSmokeRouteActive \|\| idleFrames/, 'the live route must prevent renderer idle retirement');
assert.match(serverSource, /effective_revision != requested_revision/, 'the config endpoint must reject a stale effective source');
assert.match(serverSource, /handle_sf3d_live_smoke_report/, 'the route must persist success and pre-output failure reports');
assert.match(launcherSource, /mesh_path.*meshFile/, 'the launcher must mount the accepted foreground mesh');
assert.match(witnessSource, /same-page-dual-device-shared-physical-gpu/, 'the witness must reject fallback GPU topology');
assert.match(witnessSource, /FAILED_ALLOCATION_SIZE\s*=\s*3_145_728/, 'the witness must preserve the exact failed allocation size');
assert.match(witnessSource, /size:\s*FAILED_ALLOCATION_SIZE,\s*mappedAtCreation:\s*true/, 'the witness must exercise that allocation with mappedAtCreation');
assert.match(witnessSource, /probeInferenceDevice[\s\S]*setTimeout[\s\S]*probeInferenceDevice/, 'the witness must probe both sides of a renderer/model coexistence window');
assert.doesNotMatch(witnessSource, /\.fire\(/, 'the activation witness must not spend a full inference');
assert.match(witnessSource, /failurePhase/, 'the witness must name the phase of terminal failures');
assert.match(witnessSource, /lastTrustworthyEvidence/, 'the witness must preserve its last trustworthy checkpoint');
assert.match(witnessSource, /Page\.captureScreenshot/, 'the witness must preserve inspectable visual output');
assert.match(witnessSource, /querySelector\(['"]#viewport > canvas['"]\)/, 'the witness must capture the renderer canvas rather than nested utility canvases');
