import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { buildFixturePerceptasiaHandPacket } from '../hand-surface-compositor-core.mjs';

const root = new URL('..', import.meta.url).pathname;
const port = 19731 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;

function startServer() {
  const child = spawn('python3', ['serve.py', String(port)], {
    cwd: root,
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
