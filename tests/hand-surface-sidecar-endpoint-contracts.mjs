import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildFixturePerceptasiaHandPacket } from '../hand-surface-compositor-core.mjs';

const root = new URL('..', import.meta.url).pathname;
const port = 19731 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const nativeFrameDir = mkdtempSync(join(tmpdir(), 'kaminos-hand-sidecar-contract-'));

function startServer() {
  const child = spawn('python3', ['serve.py', String(port)], {
    cwd: root,
    env: {
      ...process.env,
      KAMINOS_HAND_CONTROL_NATIVE_FRAME_DIR: nativeFrameDir,
      KAMINOS_HAND_CONTROL_SIDECAR_PYTHON: '/bin/echo',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const chunks = [];
  child.stdout.on('data', (chunk) => chunks.push(chunk));
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  return { child, output: chunks };
}

async function waitForServer(base) {
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/api/runtime-config`);
      if (response.ok) return;
    } catch {
      await delay(80);
    }
  }
  throw new Error('server did not answer runtime-config before deadline');
}

async function requestJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { parse_error: text };
  }
  return { response, body };
}

const { child, output } = startServer();
try {
  await waitForServer(baseUrl);

  const frameBytes = new Uint8Array([255, 216, 255, 217]);
  const nativeFrame = await requestJson('/hand-control-native-frame', {
    method: 'POST',
    headers: {
      'Content-Type': 'image/jpeg',
      'X-Kaminos-Hand-Surface-Client-Build': 'kaminos-hand-surface-live-20260629',
      'X-Capture-Timestamp-Ms': '120.5',
      'X-Capture-Epoch-Ms': String(Date.now()),
      'X-Frame-Id': '7',
      'X-Source-Video-Width': '640',
      'X-Source-Video-Height': '480',
      'X-Encoded-Frame-Width': '320',
      'X-Encoded-Frame-Height': '240',
    },
    body: frameBytes,
  });
  assert.equal(nativeFrame.response.status, 200);
  assert.equal(nativeFrame.body.schema, 'kaminos.hand-control-native-frame.v0');
  assert.equal(nativeFrame.body.ok, true);
  assert.equal(nativeFrame.body.frame_path, 'latest.jpg');
  assert.equal(nativeFrame.body.metadata_path, 'latest.json');
  assert.equal(nativeFrame.body.client_build, 'kaminos-hand-surface-live-20260629');

  const sidecarStatus = await requestJson('/hand-control-sidecar-status');
  assert.equal(sidecarStatus.response.status, 200);
  assert.equal(sidecarStatus.body.schema, 'kaminos.hand-control-sidecar-process.v0');
  assert.equal(sidecarStatus.body.frame_dir, nativeFrame.body.frame_dir);
  assert.equal(sidecarStatus.body.event_endpoint, '/hand-control-sidecar-event');
  assert.equal(sidecarStatus.body.native_frame_endpoint, '/hand-control-native-frame');
  assert.equal(sidecarStatus.body.python, '/bin/echo');

  const launchedDefault = await requestJson('/hand-control-sidecar-launch', { method: 'POST' });
  assert.equal(launchedDefault.response.status, 200);
  assert.equal(launchedDefault.body.log_path, `${nativeFrameDir}/wilor-mlx-sidecar.log`);
  assert.equal(launchedDefault.body.effective_config.include_vertices, false);
  assert.equal(launchedDefault.body.effective_config.dense_mano, 'disabled');
  await delay(80);
  const defaultLaunchLog = readFileSync(launchedDefault.body.log_path, 'utf8');
  assert.match(defaultLaunchLog, /kaminos_wilor_mlx_handframe_sidecar\.py/, 'sidecar launch test captures the sidecar command');
  assert.doesNotMatch(defaultLaunchLog, /--include-vertices/, 'dense MANO vertices are opt-in so the live sidecar default stays in the landmark-only latency lane');

  const stoppedDefault = await requestJson('/hand-control-sidecar-stop', { method: 'POST' });
  assert.equal(stoppedDefault.response.status, 200);
  const launchedDense = await requestJson('/hand-control-sidecar-launch?include_vertices=1', { method: 'POST' });
  assert.equal(launchedDense.response.status, 200);
  assert.equal(launchedDense.body.effective_config.include_vertices, true);
  assert.equal(launchedDense.body.effective_config.dense_mano, 'requested');
  await delay(80);
  const denseLaunchLog = readFileSync(launchedDense.body.log_path, 'utf8');
  assert.match(denseLaunchLog, /--include-vertices/, 'dense MANO vertices remain explicitly requestable when a caller accepts the cost');

  const empty = await requestJson('/hand-control-sidecar-event');
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.schema, 'kaminos.hand-control-sidecar-event-cache.v0');
  assert.equal(empty.body.status, 'empty');
  assert.equal(empty.body.event, null);

  const event = buildFixturePerceptasiaHandPacket({
    sourceBackend: 'native_wilor_mini_mlx_detector_sidecar_live',
    effectiveRoute: 'native_wilor_mini_mlx_detector_sidecar_live',
    modelRoute: 'wilor-mlx-mini',
  });
  event.webcam_frame = {
    visible: true,
    synthetic: false,
    width: 640,
    height: 480,
    frame_ref: 'live-camera-frame-001',
  };
  const posted = await requestJson('/hand-control-sidecar-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  assert.equal(posted.response.status, 200);
  assert.equal(posted.body.schema, 'kaminos.hand-control-sidecar-event-cache.v0');
  assert.equal(posted.body.status, 'stored');
  assert.equal(posted.body.event.schema, 'perceptasia.hand-control.v0');
  assert.equal(posted.body.event.source_backend, 'native_wilor_mini_mlx_detector_sidecar_live');
  assert.equal(posted.body.event.debug.evidence_route, 'native_wilor_mini_mlx_detector_sidecar_live');

  const fetched = await requestJson('/hand-control-sidecar-event');
  assert.equal(fetched.response.status, 200);
  assert.equal(fetched.body.status, 'stored');
  assert.equal(fetched.body.event.frame_id, event.frame_id);
  assert.equal(fetched.body.event.webcam_frame.synthetic, false);

  const invalid = await requestJson('/hand-control-sidecar-event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ schema: 'wrong.schema', landmarks_2d: [] }),
  });
  assert.equal(invalid.response.status, 400);
  assert.match(invalid.body.error, /perceptasia\.hand-control\.v0/);

  console.log('ok - hand-surface sidecar endpoint contracts');
} finally {
  child.kill('SIGTERM');
  await delay(100);
  if (!child.killed) child.kill('SIGKILL');
  if (process.env.DEBUG_TEST_SERVER) {
    process.stderr.write(Buffer.concat(output).toString());
  }
}
