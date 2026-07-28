import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SF3D_LIVE_SMOKE_ROUTE_ID,
  SF3D_LIVE_SMOKE_SOURCE_REVISION,
  SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
  SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
  SF3D_LIVE_SMOKE_OPTIONS,
  createSf3dGpuTopologyReceipt,
  createSf3dRenderCadenceGate,
  createSf3dRendererOptions,
  buildSf3dCompletedOutputReceipt,
  buildSf3dFailureEvidence,
  canFireSf3dLiveSmoke,
  freezeSf3dRouteEvidence,
  progressFromSf3dMessage,
  resolveSf3dDinoRequest,
  resolveSf3dGpuTopologyRequest,
  resolveSf3dPostProcessorRequest,
  resolveSf3dRenderTargetFps,
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
assert.equal(SF3D_LIVE_SMOKE_SOURCE_REVISION, '7c35ecdc6bf6ab83d636de77c08c846e9dca0854');
assert.equal(SF3D_LIVE_SMOKE_GPU_TOPOLOGY, 'same-page-dual-device-shared-physical-gpu');
assert.equal(SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY, 'same-page-shared-device-shared-queue');
assert.deepEqual(SF3D_LIVE_SMOKE_OPTIONS, {
  cooperativeDino: false,
  dinoSchedulingMode: 'cooperative',
  dinoChunkBlocks: 1,
  cooperativePostProcessor: false,
  postProcessorSchedulingMode: 'cooperative',
  postProcessorDutyGranularity: 'plane',
  cooperativeBake: true,
  bakeSchedulingMode: 'cooperative',
  bakeBatchTexels: 4096,
  decoderArena: true,
  materializeWorker: true,
});
assert.deepEqual(
  resolveSf3dDinoRequest(new URLSearchParams()),
  {
    requested: 'monolithic',
    effective: 'monolithic',
    cooperativeDino: false,
    dinoSchedulingMode: 'cooperative',
    dinoChunkBlocks: 1,
    authority: 'caller-route-query',
  },
);
assert.deepEqual(
  resolveSf3dDinoRequest(new URLSearchParams('sf3d_dino=cooperative')),
  {
    requested: 'cooperative',
    effective: 'twenty-four-block-cooperative',
    cooperativeDino: true,
    dinoSchedulingMode: 'cooperative',
    dinoChunkBlocks: 1,
    authority: 'caller-route-query',
  },
);
assert.throws(
  () => resolveSf3dDinoRequest(new URLSearchParams('sf3d_dino=claimed-but-unknown')),
  /unsupported SF3D DINO mode/i,
);
assert.deepEqual(
  resolveSf3dPostProcessorRequest(new URLSearchParams()),
  {
    requested: 'monolithic',
    effective: 'monolithic',
    cooperativePostProcessor: false,
    postProcessorSchedulingMode: 'cooperative',
    postProcessorDutyGranularity: 'plane',
    authority: 'caller-route-query',
  },
);
assert.deepEqual(
  resolveSf3dPostProcessorRequest(
    new URLSearchParams('sf3d_post_processor=cooperative'),
  ),
  {
    requested: 'cooperative',
    effective: 'three-plane-cooperative',
    cooperativePostProcessor: true,
    postProcessorSchedulingMode: 'cooperative',
    postProcessorDutyGranularity: 'plane',
    authority: 'caller-route-query',
  },
);
assert.deepEqual(
  resolveSf3dPostProcessorRequest(
    new URLSearchParams('sf3d_post_processor=layer'),
  ),
  {
    requested: 'layer',
    effective: 'eighteen-stage-cooperative',
    cooperativePostProcessor: true,
    postProcessorSchedulingMode: 'cooperative',
    postProcessorDutyGranularity: 'layer',
    authority: 'caller-route-query',
  },
);
assert.throws(
  () => resolveSf3dPostProcessorRequest(
    new URLSearchParams('sf3d_post_processor=claimed-but-unknown'),
  ),
  /unsupported SF3D postprocessor mode/i,
);
assert.equal(canFireSf3dLiveSmoke({ running: false, deviceLost: false }), true);
assert.equal(canFireSf3dLiveSmoke({ running: true, deviceLost: false }), false);
assert.equal(canFireSf3dLiveSmoke({ running: false, deviceLost: true }), false);
assert.equal(canFireSf3dLiveSmoke({ running: false, deviceLost: false, attempted: true }), false);

const inferenceQueue = {};
const inferenceDevice = { queue: inferenceQueue };
const otherQueue = {};
const otherDevice = { queue: otherQueue };
assert.equal(
  resolveSf3dGpuTopologyRequest(new URLSearchParams()),
  SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
);
assert.equal(
  resolveSf3dGpuTopologyRequest(new URLSearchParams('sf3d_gpu_topology=shared-device')),
  SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
);
assert.throws(
  () => resolveSf3dGpuTopologyRequest(new URLSearchParams('sf3d_gpu_topology=claimed-but-unknown')),
  /unsupported SF3D GPU topology/i,
);
assert.deepEqual(
  createSf3dRendererOptions({
    requestedTopology: SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
    inferenceDevice,
  }),
  { antialias: true },
);
const sharedRendererOptions = createSf3dRendererOptions({
  requestedTopology: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
  inferenceDevice,
});
assert.deepEqual(sharedRendererOptions, { antialias: true, device: inferenceDevice });
assert.equal(
  Object.isExtensible(sharedRendererOptions),
  true,
  'Three.js owns and augments the renderer parameters object during initialization',
);
assert.throws(
  () => createSf3dRendererOptions({
    requestedTopology: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
    inferenceDevice: null,
  }),
  /requires the prepared SF3D GPUDevice/i,
);
assert.deepEqual(
  createSf3dGpuTopologyReceipt({
    requestedTopology: SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
    inferenceDevice,
    rendererDevice: otherDevice,
  }),
  {
    requested: SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
    effective: SF3D_LIVE_SMOKE_GPU_TOPOLOGY,
    sameDevice: false,
    sameQueue: false,
    authority: 'exact-browser-object-identity',
  },
);
assert.deepEqual(
  createSf3dGpuTopologyReceipt({
    requestedTopology: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
    inferenceDevice,
    rendererDevice: inferenceDevice,
  }),
  {
    requested: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
    effective: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
    sameDevice: true,
    sameQueue: true,
    authority: 'exact-browser-object-identity',
  },
);
assert.throws(
  () => createSf3dGpuTopologyReceipt({
    requestedTopology: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
    inferenceDevice,
    rendererDevice: otherDevice,
  }),
  /requested shared GPUDevice.*did not initialize/i,
);
assert.throws(
  () => createSf3dGpuTopologyReceipt({
    requestedTopology: SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
    inferenceDevice,
    rendererDevice: { queue: otherQueue },
  }),
  /requested shared GPUDevice.*did not initialize/i,
);

assert.equal(
  resolveSf3dRenderTargetFps(new URLSearchParams(), SF3D_LIVE_SMOKE_GPU_TOPOLOGY),
  null,
);
assert.equal(
  resolveSf3dRenderTargetFps(
    new URLSearchParams('sf3d_render_fps=60'),
    SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
  ),
  60,
);
assert.throws(
  () => resolveSf3dRenderTargetFps(
    new URLSearchParams('sf3d_render_fps=not-a-number'),
    SF3D_LIVE_SMOKE_SHARED_GPU_TOPOLOGY,
  ),
  /positive finite number/i,
);
const cadenceGate = createSf3dRenderCadenceGate({ targetFps: 60 });
assert.equal(cadenceGate.shouldRender(0, { inferenceActive: true }), true);
assert.equal(cadenceGate.shouldRender(8, { inferenceActive: true }), false);
assert.equal(cadenceGate.shouldRender(17, { inferenceActive: true }), true);
assert.equal(cadenceGate.shouldRender(18, { inferenceActive: false }), true);
assert.deepEqual(cadenceGate.snapshot(), {
  targetFps: 60,
  targetFrameMs: 1000 / 60,
  authority: 'caller-owned-rAF-admission',
  admittedFrames: 3,
  skippedFrames: 1,
});

const divergentOutputReceipt = buildSf3dCompletedOutputReceipt({
  output: {
    glb: new ArrayBuffer(12),
    numVertices: 17,
    numFaces: 23,
    stageSpans: [{ name: 'texture-bake', start: 0, end: 81 }],
    cooperativeReports: { 'texture-bake': { status: 'succeeded' } },
    arenaSnapshot: { slotCount: 30 },
  },
  outputSha256: 'a'.repeat(64),
  expectedSha256: 'b'.repeat(64),
  routeWallMs: 81,
  frameTimes: [0, 16, 80],
  frameCpuTimes: [1, 2, 5],
});
assert.equal(divergentOutputReceipt.output.canonical, false);
assert.equal(divergentOutputReceipt.output.sha256, 'a'.repeat(64));
assert.equal(divergentOutputReceipt.output.expectedSha256, 'b'.repeat(64));
assert.equal(divergentOutputReceipt.output.bytes, 12);
assert.equal(divergentOutputReceipt.output.numVertices, 17);
assert.equal(divergentOutputReceipt.renderer.renderedFrames, 3);
assert.equal(divergentOutputReceipt.renderer.maxMs, 64);
assert.equal(divergentOutputReceipt.renderer.cpuFrameP99Ms, 5);
assert.equal(divergentOutputReceipt.stages[0].name, 'texture-bake');
assert.equal(divergentOutputReceipt.stages[0].maxGapMs, 64);
assert.deepEqual(divergentOutputReceipt.cooperativeReports, {
  'texture-bake': { status: 'succeeded' },
});
assert.deepEqual(divergentOutputReceipt.arenaSnapshot, { slotCount: 30 });
assert.throws(
  () => buildSf3dCompletedOutputReceipt({
    output: { glb: new ArrayBuffer(12) },
    outputSha256: 'not-a-sha',
    expectedSha256: 'b'.repeat(64),
    routeWallMs: 1,
    frameTimes: [],
    frameCpuTimes: [],
  }),
  /output SHA-256/i,
);

const mutableFrameTimes = [100, 116, 180];
const mutableCpuTimes = [1, 2, 3];
const frozenRouteEvidence = freezeSf3dRouteEvidence({
  startedAt: 100,
  completedAt: 180,
  frameTimes: mutableFrameTimes,
  frameCpuTimes: mutableCpuTimes,
});
mutableFrameTimes.push(10_000);
mutableCpuTimes.push(10_000);
assert.equal(frozenRouteEvidence.routeWallMs, 80);
assert.deepEqual(frozenRouteEvidence.frameTimes, [100, 116, 180]);
assert.deepEqual(frozenRouteEvidence.frameCpuTimes, [1, 2, 3]);

const circularReport = { status: 'succeeded' };
circularReport.self = circularReport;
const nonJsonArena = {
  allocationBytes: 1n,
  probe: new Uint8Array([1, 2, 3]),
  unavailable: Number.POSITIVE_INFINITY,
};
const jsonSafeReceipt = buildSf3dCompletedOutputReceipt({
  output: {
    glb: new ArrayBuffer(12),
    stageSpans: [],
    cooperativeReports: { 'texture-bake': circularReport },
    arenaSnapshot: nonJsonArena,
  },
  outputSha256: 'a'.repeat(64),
  expectedSha256: 'b'.repeat(64),
  routeWallMs: 1,
  frameTimes: [],
  frameCpuTimes: [],
});
const serializedReceipt = JSON.stringify(jsonSafeReceipt);
const decodedReceipt = JSON.parse(serializedReceipt);
assert.match(serializedReceipt, /circular-reference/);
assert.match(serializedReceipt, /typed-array/);
assert.match(serializedReceipt, /non-finite-number/);
assert.equal(decodedReceipt.arenaSnapshot.allocationBytes.value, '1');
assert.ok(
  decodedReceipt.evidenceWarnings.some(warning => warning.kind === 'circular-reference'),
  'circular evidence normalization must remain visible',
);
const divergentFailureEvidence = buildSf3dFailureEvidence(jsonSafeReceipt);
assert.deepEqual(divergentFailureEvidence.cooperativeReports, decodedReceipt.cooperativeReports);
assert.deepEqual(divergentFailureEvidence.arenaSnapshot, decodedReceipt.arenaSnapshot);
assert.deepEqual(divergentFailureEvidence.evidenceWarnings, decodedReceipt.evidenceWarnings);
assert.ok(
  divergentFailureEvidence.evidenceWarnings.some(warning => warning.kind === 'typed-array'),
  'divergent failure evidence must retain typed-array normalization warnings',
);

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
assert.deepEqual(progressFromSf3dMessage('Post-processor planes 2/3 (67%)'), {
  percent: 65,
  label: 'Post-processor planes 2 / 3',
});
assert.deepEqual(progressFromSf3dMessage('Post-processor duties 11/18 (61%)'), {
  percent: 64,
  label: 'Post-processor duties 11 / 18',
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
const firingWitnessSource = readFileSync(new URL('scripts/witness-sf3d-live-smoke-firing.mjs', root), 'utf8');

function assertSingleSourceRevision(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  assert.equal(matches.length, 1, `${label} must define exactly one accepted SF3D revision`);
  assert.equal(
    matches[0][1],
    SF3D_LIVE_SMOKE_SOURCE_REVISION,
    `${label} must accept the same exact SF3D revision as the browser contract`,
  );
}

const serverRevisionPattern = /^SF3D_LIVE_SMOKE_SOURCE_REVISION = "([0-9a-f]{40})"$/gm;
const launcherRevisionPattern = /^const EXPECTED_REVISION = '([0-9a-f]{40})';$/gm;
assertSingleSourceRevision(serverSource, serverRevisionPattern, 'Kaminos server');
assertSingleSourceRevision(launcherSource, launcherRevisionPattern, 'SF3D smoke launcher');

const staleRevision = '2f79b9b84a19809107f5eb29b5fab806e00e6c6a';
assert.throws(
  () => assertSingleSourceRevision(
    serverSource.replace(SF3D_LIVE_SMOKE_SOURCE_REVISION, staleRevision),
    serverRevisionPattern,
    'Kaminos server',
  ),
  /same exact SF3D revision/,
  'the contract must reject a stale server pin',
);
assert.throws(
  () => assertSingleSourceRevision(
    launcherSource.replace(SF3D_LIVE_SMOKE_SOURCE_REVISION, staleRevision),
    launcherRevisionPattern,
    'SF3D smoke launcher',
  ),
  /same exact SF3D revision/,
  'the contract must reject a stale launcher pin',
);

assert.match(indexSource, /createSf3dRendererOptions\(/, 'Kaminos must select the explicit SF3D topology arm');
assert.match(indexSource, /new THREE\.WebGPURenderer\(sf3dRendererOptions\)/, 'Kaminos must pass the selected device policy into Three');
assert.match(indexSource, /bindSf3dLiveSmokeRenderer\(/, 'Kaminos must verify effective renderer device and queue identity');
assert.match(indexSource, /id="sf3d-live-smoke-topology"/, 'the operator surface must expose effective GPU topology');
assert.match(indexSource, /noteRenderedFrame\(performance\.now\(\), frameMs\)/, 'the live route must measure actual renderer-loop completions');
assert.match(indexSource, /sf3dLiveSmokeRouteActive \|\| idleFrames/, 'the live route must prevent renderer idle retirement');
assert.match(serverSource, /effective_revision != requested_revision/, 'the config endpoint must reject a stale effective source');
assert.match(serverSource, /handle_sf3d_live_smoke_report/, 'the route must persist success and pre-output failure reports');
assert.match(launcherSource, /mesh_path.*meshFile/, 'the launcher must mount the accepted foreground mesh');
assert.match(witnessSource, /resolveSf3dGpuTopologyRequest/, 'the witness must derive expected topology from the requested route');
assert.match(witnessSource, /resolveSf3dPostProcessorRequest/, 'the witness must derive expected postprocessor mode from the requested route');
assert.match(witnessSource, /resolveSf3dDinoRequest/, 'the witness must derive expected DINO mode from the requested route');
assert.match(witnessSource, /gpuTopologyReceipt/, 'the witness must reject requested/effective topology substitution');
assert.match(witnessSource, /FAILED_ALLOCATION_SIZE\s*=\s*3_145_728/, 'the witness must preserve the exact failed allocation size');
assert.match(witnessSource, /size:\s*FAILED_ALLOCATION_SIZE,\s*mappedAtCreation:\s*true/, 'the witness must exercise that allocation with mappedAtCreation');
assert.match(witnessSource, /probeInferenceDevice[\s\S]*setTimeout[\s\S]*probeInferenceDevice/, 'the witness must probe both sides of a renderer/model coexistence window');
assert.doesNotMatch(witnessSource, /\.fire\(/, 'the activation witness must not spend a full inference');
assert.match(witnessSource, /failurePhase/, 'the witness must name the phase of terminal failures');
assert.match(witnessSource, /lastTrustworthyEvidence/, 'the witness must preserve its last trustworthy checkpoint');
assert.match(witnessSource, /Page\.captureScreenshot/, 'the witness must preserve inspectable visual output');
assert.match(witnessSource, /querySelector\(['"]#viewport > canvas['"]\)/, 'the witness must capture the renderer canvas rather than nested utility canvases');
assert.match(firingWitnessSource, /controller\.fire\(\)\.catch/, 'the firing witness must start inference without awaiting it inside one CDP call');
assert.match(firingWitnessSource, /kaminosSf3dLiveSmokeLastReport/, 'the firing witness must wait on page-owned terminal state');
assert.match(firingWitnessSource, /gpuTopologyReceipt/, 'the firing witness must preserve effective topology identity');
assert.match(firingWitnessSource, /expectedPostProcessor/, 'the firing witness must preserve effective postprocessor identity');
assert.match(firingWitnessSource, /finally[\s\S]*finalizeWitnessReport/, 'the firing witness must write a report on every terminal path');
