import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SF3D_LIVE_SMOKE_ROUTE_ID,
  SF3D_LIVE_SMOKE_SOURCE_REVISION,
  SF3D_LIVE_SMOKE_OPTIONS,
  progressFromSf3dMessage,
  summarizeSf3dFrameGaps,
  validateSf3dLiveSmokeConfig,
} from '../sf3d-live-smoke-core.js';

assert.equal(SF3D_LIVE_SMOKE_ROUTE_ID, 'sf3d.image-to-mesh.webgpu-local.v0');
assert.equal(SF3D_LIVE_SMOKE_SOURCE_REVISION, '35eb1b003072dd5adbda9e001d5ede4ca3cfe09a');
assert.deepEqual(SF3D_LIVE_SMOKE_OPTIONS, {
  cooperativeDino: false,
  cooperativeBake: true,
  bakeSchedulingMode: 'cooperative',
  bakeBatchTexels: 4096,
  decoderArena: true,
  materializeWorker: true,
});

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
assert.match(indexSource, /device: sf3dLiveSmokePrepared\.device/, 'Kaminos renderer must consume the SF3D max-limit device');
assert.match(indexSource, /noteRenderedFrame\(performance\.now\(\), frameMs\)/, 'the live route must measure actual renderer-loop completions');
assert.match(indexSource, /sf3dLiveSmokeRouteActive \|\| idleFrames/, 'the live route must prevent renderer idle retirement');
assert.match(serverSource, /effective_revision != requested_revision/, 'the config endpoint must reject a stale effective source');
assert.match(serverSource, /handle_sf3d_live_smoke_report/, 'the route must persist success and pre-output failure reports');
assert.match(launcherSource, /mesh_path.*meshFile/, 'the launcher must mount the accepted foreground mesh');
