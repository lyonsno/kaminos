import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

assert.equal(SF3D_LIVE_SMOKE_ROUTE_ID, 'sf3d.image-to-mesh.webgpu-local.v0');
assert.equal(SF3D_LIVE_SMOKE_SOURCE_REVISION, '35eb1b003072dd5adbda9e001d5ede4ca3cfe09a');
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
assert.match(witnessSource, /Page\.captureScreenshot/, 'the witness must preserve inspectable visual output');
assert.match(witnessSource, /querySelector\(['"]#viewport > canvas['"]\)/, 'the witness must capture the renderer canvas rather than nested utility canvases');
