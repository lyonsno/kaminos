#!/usr/bin/env node
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8098/?kaminos_clay_sim=1&clay_cube=1&clay_cube_grid=10x10x10&clay_steps=7&clay_debug_colliders=0&clay_benchmark_shadow=0&clay_normal_cadence=every_3&clay_colliders=clay_fixture_hand';
const out = resolve(args.get('--out') || '/tmp/kaminos-clay-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9444);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-clay-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1600);
const windowSize = args.get('--window-size') || '1280,900';
const expectedGrid = args.get('--expected-grid') || null;
const handPosePayloadPath = args.get('--hand-pose-payload') || null;
const handPosePayloadReplay = args.get('--hand-pose-payload-replay') || null;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function screenshotMetricsFromPng(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, 'only 8-bit screenshots are supported');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      assert.ok(channels, `unsupported screenshot color type ${data[9]}`);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let p = 0;
  let prev = Buffer.alloc(stride);
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[p];
    p += 1;
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) row[x] = (row[x] + paeth(left, up, upLeft)) & 255;
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    }
    row.copy(pixels, y * stride);
    prev = row;
  }
  let clayColorPixels = 0;
  let brightOrangePixels = 0;
  let litPixels = 0;
  for (let i = 0; i < pixels.length; i += channels) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const luma = (r + g + b) / 3;
    if (luma > 18) litPixels += 1;
    if (r > 90 && r < 210 && g > 65 && g < 175 && b > 35 && b < 140 && r >= g && g >= b * 0.75) {
      clayColorPixels += 1;
    }
    if (r > 190 && g > 90 && b < 60) brightOrangePixels += 1;
  }
  return { width, height, clayColorPixels, brightOrangePixels, litPixels };
}

function expectedGridTopology(grid) {
  const match = /^(\d+)x(\d+)$/.exec(String(grid || ''));
  if (!match) return null;
  const gridX = Number(match[1]);
  const gridZ = Number(match[2]);
  if (!Number.isInteger(gridX) || !Number.isInteger(gridZ) || gridX < 2 || gridZ < 2) return null;
  return {
    grid,
    vertexCount: gridX * gridZ,
    triangleCount: (gridX - 1) * (gridZ - 1) * 2,
  };
}

function parseLooseJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8')
    .replace(/:\s*Infinity\b/g, ': null')
    .replace(/:\s*-Infinity\b/g, ': null')
    .replace(/:\s*NaN\b/g, ': null'));
}

function pickClayHandPosePayload(json) {
  return json?.witness?.clay_hand_pose_frame
    || json?.clay_hand_pose_frame
    || json?.clay?.hand_pose_frame
    || json?.hand_pose_frame
    || json?.witness?.hand_pose_frame_update?.payload
    || null;
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });
  let phase = 'launch';
  const [width, height] = windowSize.split(',').map(v => Number(v.trim()) || 0);
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    `--window-size=${width || 1280},${height || 900}`,
    url,
  ], { stdio: 'ignore' });
  let ws = null;

  try {
    phase = 'cdp';
    await waitForCdp();
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_clay_sim=1')) || targets.find(t => t.type === 'page');
    assert.ok(page?.webSocketDebuggerUrl, 'missing clay page websocket');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'settle';
    await delay(settleMs);
    let injectedHandPosePayload = null;
    if (handPosePayloadPath) {
      phase = 'hand-pose-payload';
      injectedHandPosePayload = pickClayHandPosePayload(parseLooseJsonFile(handPosePayloadPath));
      assert.ok(injectedHandPosePayload, `missing clay hand-pose payload in ${handPosePayloadPath}`);
      if (handPosePayloadReplay === 'captured') {
        injectedHandPosePayload = {
          ...injectedHandPosePayload,
          originalEvidenceKind: injectedHandPosePayload.evidenceKind,
          evidenceKind: 'captured',
          timestampMs: 0,
        };
      }
      const payloadLiteral = JSON.stringify(injectedHandPosePayload);
      const injectEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(async () => {
          const substrate = window.PerceptasiaClaySubstrate || window.__kaminosClayPrototype;
          if (!substrate?.setHandPoseFrame) return { ok: false, reason: 'missing setHandPoseFrame substrate' };
          const payload = ${payloadLiteral};
          if (${JSON.stringify(handPosePayloadReplay)} === 'captured') payload.timestampMs = performance.now();
          const accepted = await substrate.setHandPoseFrame(payload);
          return { ok: true, accepted };
        })()`,
        awaitPromise: true,
        returnByValue: true,
      });
      if (injectEval.exceptionDetails) {
        throw new Error(`hand-pose-payload injection failed: ${injectEval.exceptionDetails.text || 'unknown exception'}`);
      }
      assert.ok(injectEval.result?.value?.ok, injectEval.result?.value?.reason || 'hand-pose-payload injection did not reach substrate');
      await delay(350);
    }

    if (url.includes('clay_interactive=1')) {
      phase = 'pointer-drag-geometry';
      let drag = null;
      let dragFailure = 'missing clay canvas bounds';
      for (let i = 0; i < 30; i += 1) {
        const dragEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: `(() => {
            const canvas = document.querySelector('canvas');
            const pointerInteraction = window.__kaminosClayPointerInteraction;
            if (!canvas) return { ok: false, reason: 'missing clay canvas' };
            const rect = canvas.getBoundingClientRect();
            if (!pointerInteraction) return { ok: false, reason: 'missing pointer interaction' };
            if (!(rect.width > 16 && rect.height > 16)) {
              return { ok: false, reason: 'missing clay canvas bounds', rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
            }
            return {
              ok: true,
              startX: rect.left + rect.width * 0.43,
              startY: rect.top + rect.height * 0.50,
              midX: rect.left + rect.width * 0.46,
              midY: rect.top + rect.height * 0.50,
              endX: rect.left + rect.width * 0.50,
              endY: rect.top + rect.height * 0.51,
              rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            };
          })()`,
          returnByValue: true,
        });
        if (dragEval.exceptionDetails) {
          throw new Error(`pointer-drag-geometry evaluation failed: ${dragEval.exceptionDetails.text || 'unknown exception'}`);
        }
        const candidate = dragEval.result?.value;
        if (candidate?.ok) {
          drag = candidate;
          break;
        }
        dragFailure = candidate?.reason || dragFailure;
        await delay(100);
      }
      assert.ok(drag, `missing clay canvas bounds for pointer drag geometry: ${dragFailure}`);
      phase = 'pointer-drag';
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: drag.startX, y: drag.startY });
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: drag.startX, y: drag.startY, button: 'left', buttons: 1, clickCount: 1 });
      for (const [x, y] of [
        [drag.midX, drag.midY],
        [drag.endX, drag.endY],
        [drag.endX + 18, drag.endY - 4],
        [drag.endX + 36, drag.endY + 6],
        [drag.endX + 54, drag.endY + 2],
        [drag.endX + 72, drag.endY + 8],
      ]) {
        await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
        await delay(80);
      }
      await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: drag.endX + 36, y: drag.endY + 6, button: 'left', buttons: 0, clickCount: 1 });
      await delay(600);
    }

    phase = 'state';
    let state = null;
    for (let i = 0; i < 30; i += 1) {
      const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosClayPrototype?.debugState?.()',
        returnByValue: true,
      });
      state = stateEval.result.value;
      if (
        (state?.persistentClayStepCount ?? 0) >= 6
        && (state?.persistentClayDeltaHistory?.length ?? 0) >= 3
        && (state?.clayStepSampleCount ?? 0) >= 6
        && (!url.includes('clay_interactive=1') || (state?.clayPointerDragStepCount ?? 0) >= 3)
        && state?.clayDeformationCount > 0
      ) break;
      await delay(180);
    }
    assert.ok(state, 'missing clay debug state');
    assert.equal(state.effectiveRoute, 'kaminos-clay-sim-route-v0');
    assert.equal(state.prototypeIdentity, 'kaminos-clay-prototype-v0');
    assert.equal(state.solverIdentity, 'webgpu-clay-surface-lattice-scaffold-v0');
    assert.equal(state.effectiveBackend, 'WebGPU');
    assert.equal(state.substrateEvidenceKind, 'webgpu-compute-readback');
    assert.equal(state.runtimeCpuFallback, false);
    assert.equal(state.packagePrimitiveSourceContract, 'kaolin-kpm-001-forward-distance-feature-codes');
    assert.equal(state.packagePrimitiveImportPath, './vendor/webgpu-geometry-primitives/point-triangle.js');
    assert.equal(state.packagePrimitiveCommit, '3a8441b');
    assert.equal(state.pointTriangleJobFloats, 16);
    assert.equal(state.pointTriangleResultBytes, 16);
    assert.equal(state.sharedPrimitiveProbeStatus, 'pass');
    assert.equal(state.sharedPrimitiveProbeFeature, 0);
    assert.equal(state.sharedPrimitiveProbeTriangleIndex, 77);
    assert.ok(
      Math.abs((state.sharedPrimitiveProbeDistanceSq ?? Number.NaN) - 0.25) <= 1e-5,
      `shared primitive probe distance mismatch: ${state.sharedPrimitiveProbeDistanceSq}`,
    );
    const isInteractiveRoute = url.includes('clay_interactive=1');
    const isCubeRoute = url.includes('clay_cube=1');
    assert.equal(state.primitiveContactPassStatus, 'pass');
    const expectedPrimitiveContacts = isInteractiveRoute
      ? 1
      : url.includes('clay_colliders=clay_edge_fixture')
        ? 2
        : 5;
    if (isInteractiveRoute && (state.clayPointerDragStepCount ?? 0) >= 3) {
      assert.ok((state.primitiveContactJobCount ?? 0) >= 0, 'interactive primitive contact job count missing');
      if ((state.primitiveContactActiveCount ?? 0) > 0) {
        assert.ok(Number.isFinite(state.primitiveContactMinDistance), 'interactive primitive contact distance missing while contacts are active');
        assert.ok((state.primitiveContactForceSum ?? 0) > 0, 'interactive primitive contact force missing while contacts are active');
      }
    } else {
      assert.ok((state.primitiveContactJobCount ?? 0) >= expectedPrimitiveContacts, 'primitive contact pass did not process expected colliders');
      assert.ok((state.primitiveContactActiveCount ?? 0) >= expectedPrimitiveContacts, 'primitive contact pass did not report active contacts');
      assert.ok(Number.isFinite(state.primitiveContactMinDistance), 'primitive contact pass did not record a minimum distance');
      assert.ok((state.primitiveContactForceSum ?? 0) > 0, 'primitive contact pass did not derive positive force');
    }
    assert.equal(state.persistentClayStateStatus, 'persistent');
    assert.ok((state.persistentClayStepCount ?? 0) >= 6, 'persistent clay state did not survive the multi-step relaxation route');
    assert.ok((state.persistentClayMaxDelta ?? 0) > 0, 'persistent clay state did not report step delta');
    assert.ok(
      Array.isArray(state.persistentClayDeltaHistory) && state.persistentClayDeltaHistory.length >= 3,
      'persistent clay state did not report a multi-step delta history',
    );
    assert.ok((state.persistentClayInitialDelta ?? 0) > 0, 'persistent clay state did not record initial relaxation delta');
    assert.ok((state.persistentClayLatestDelta ?? 0) > 0, 'persistent clay state did not record latest relaxation delta');
    assert.ok(Number.isFinite(state.persistentClaySettlingRatio), 'persistent clay state did not record settling ratio');
    if (!url.includes('clay_interactive=1') && !handPosePayloadPath) {
      assert.ok(state.persistentClaySettlingRatio < 1, `persistent clay did not settle: ${state.persistentClaySettlingRatio}`);
    }
    assert.equal(state.clayCubeEnabled, isCubeRoute, 'cube witness enablement did not match clay_cube route parameter');
    if (isCubeRoute) {
      assert.equal(state.clayCubeSolverIdentity, 'webgpu-clay-material-point-cube-first-loop-v0', 'cube solver identity missing');
      assert.equal(state.clayCubeStepStatus, 'pass', 'cube first-loop step did not pass');
      assert.equal(state.clayCubeEvidenceKind, 'webgpu-material-point-readback', 'cube evidence did not come from WebGPU readback');
      assert.equal(state.clayCubeOracleEvidenceKind, 'deterministic-js-oracle-not-runtime-fallback', 'cube oracle evidence kind missing');
      assert.equal(state.clayCubeSurfaceVisible, false, 'cube route should hide the old heightfield surface in the current witness');
      assert.equal(state.clayCubeDiagnosticColorMode, 'cube-diagnostic-contact-displacement-colors-v0', 'cube diagnostic color mode missing');
      assert.equal(state.clayCubeBoundingBoxVisible, true, 'cube diagnostic bounding box missing');
      assert.equal(state.clayCubeBoundingBoxContract, 'cube-diagnostic-bounding-box-v0', 'cube diagnostic bounding-box contract missing');
      assert.ok((state.clayCubeParticleCount ?? 0) >= 216, 'cube material-point count too small for first-loop witness');
      assert.ok((state.clayCubeGridDimension ?? 0) >= 12, 'cube grid dimension missing');
      assert.ok((state.clayCubeActiveGridCellCount ?? 0) > 0, 'cube active grid-cell count missing');
      assert.ok((state.clayCubeDeformedParticleCount ?? 0) > 0, 'cube deformation count missing');
      assert.ok((state.clayCubeContactParticleCount ?? 0) > 0, 'cube contact count missing');
      assert.ok((state.clayCubeDiagnosticColoredParticleCount ?? 0) > 0, 'cube diagnostic colored particle count missing');
      assert.ok((state.clayCubeDiagnosticHotParticleCount ?? 0) > 0, 'cube hot/contact diagnostic particle count missing');
      assert.ok((state.clayCubeMaxDisplacement ?? 0) > 0.005, 'cube max displacement too small to prove hand influence');
      assert.ok((state.clayCubeHeightRange ?? 0) > 0.25, 'cube height range too small for volumetric witness');
      assert.ok(Number.isFinite(state.clayCubeReadbackWallMs) && state.clayCubeReadbackWallMs > 0, 'cube readback timing missing');
      assert.ok((state.clayCubeDispatchWorkgroups ?? 0) > 0, 'cube dispatch workgroup count missing');
    }
    assert.equal(state.clayTimingEvidenceSource, 'webgpu-step-readback-wall-time', 'clay timing evidence source did not reach debug state');
    assert.equal(
      state.clayTimingDisclaimer,
      'includes primitive-contact and clay readback; not gpu-exclusive-or-present-latency',
      'clay timing disclaimer did not reach debug state',
    );
    assert.ok(Array.isArray(state.clayStepDurationHistory) && state.clayStepDurationHistory.length >= 6, 'clay timing history did not record route steps');
    assert.ok(Number.isFinite(state.clayStepLatestMs) && state.clayStepLatestMs > 0, 'clay latest step timing missing');
    assert.ok(Number.isFinite(state.clayStepP95Ms) && state.clayStepP95Ms > 0, 'clay p95 step timing missing');
    assert.ok((state.clayStepSampleCount ?? 0) >= 6, 'clay step timing sample count missing');
    assert.equal(state.clayTimingWarmupPolicy, 'first-three-steps-treated-as-warmup', 'clay timing warmup policy missing');
    assert.equal(state.clayWarmupStepCount, 3, 'clay timing warmup count missing');
    assert.ok(Array.isArray(state.claySteadyStepDurationHistory), 'clay steady timing history missing');
    assert.ok((state.claySteadyStepSampleCount ?? 0) >= 3, 'clay steady timing sample count missing');
    assert.ok(Number.isFinite(state.claySteadyStepP50Ms) && state.claySteadyStepP50Ms > 0, 'clay steady p50 timing missing');
    assert.ok(Number.isFinite(state.claySteadyStepP95Ms) && state.claySteadyStepP95Ms > 0, 'clay steady p95 timing missing');
    assert.ok(
      Number.isFinite(state.clayStepMaxOutlierMs) && state.clayStepMaxOutlierMs >= state.clayStepP95Ms,
      'clay max timing outlier missing',
    );
    assert.match(
      state.clayPhaseTimingDisclaimer || '',
      /not GPU timestamp-query kernel time/,
      'clay phase timing disclaimer did not reach debug state',
    );
    assert.ok(Number.isFinite(state.clayContactWallMs) && state.clayContactWallMs >= 0, 'clay primitive contact wall timing missing');
    assert.ok(Number.isFinite(state.clayColliderPrepWallMs) && state.clayColliderPrepWallMs >= 0, 'clay collider prep timing missing');
    assert.ok(Number.isFinite(state.clayLatticeReadbackWallMs) && state.clayLatticeReadbackWallMs > 0, 'clay lattice dispatch/readback timing missing');
    assert.ok(Number.isFinite(state.clayCpuMeshUpdateMs) && state.clayCpuMeshUpdateMs >= 0, 'clay CPU mesh update timing missing');
    assert.ok(Number.isFinite(state.clayNormalUpdateMs) && state.clayNormalUpdateMs >= 0, 'clay normal recompute timing missing');
    const requestedNormalCadence = new URL(url).searchParams.get('clay_normal_cadence') || 'every_step';
    assert.equal(state.clayNormalCadence, requestedNormalCadence, 'clay normal cadence did not match route');
    assert.ok(Array.isArray(state.clayNormalCadenceWarnings), 'clay normal cadence warnings missing');
    assert.ok(Number.isFinite(state.clayNormalUpdateCount) && state.clayNormalUpdateCount > 0, 'clay normal update count missing');
    assert.ok(Number.isFinite(state.clayNormalSkippedCount) && state.clayNormalSkippedCount >= 0, 'clay normal skipped count missing');
    if (requestedNormalCadence === 'every_3') {
      assert.ok(state.clayNormalSkippedCount > 0, 'clay every-third normal cadence did not skip recomputes');
    } else if (requestedNormalCadence === 'every_step') {
      assert.equal(state.clayNormalSkippedCount, 0, 'clay every-step normal cadence skipped recomputes');
    }
    assert.ok(Number.isFinite(state.clayStepTotalWallMs) && state.clayStepTotalWallMs > 0, 'clay total wall timing missing');
    assert.equal(state.clayCpuShadowEvidenceKind, 'benchmark-only-js-shadow-not-runtime-fallback', 'clay CPU shadow evidence kind is not explicit');
    assert.equal(state.clayCpuShadowBenchmarkEnabled, url.includes('clay_benchmark_shadow=1'), 'clay CPU shadow benchmark enablement does not match route');
    if (url.includes('clay_benchmark_shadow=1')) {
      assert.ok(Number.isFinite(state.clayCpuShadowEstimateMs) && state.clayCpuShadowEstimateMs > 0, 'clay CPU shadow estimate missing');
      assert.ok(Number.isFinite(state.clayCpuShadowRatio) && state.clayCpuShadowRatio >= 0, 'clay CPU shadow ratio missing');
      assert.ok((state.clayCpuShadowSampleCount ?? 0) >= 1, 'clay CPU shadow sample count missing');
      assert.ok(Number.isFinite(state.clayCpuContactShadowEstimateMs) && state.clayCpuContactShadowEstimateMs > 0, 'clay CPU contact shadow estimate missing');
      assert.ok(Number.isFinite(state.clayCpuContactShadowRatio) && state.clayCpuContactShadowRatio >= 0, 'clay CPU contact shadow ratio missing');
      assert.ok((state.clayCpuContactShadowSampleCount ?? 0) >= 1, 'clay CPU contact shadow sample count missing');
    }
    assert.ok((state.claySurfaceVertexCount ?? 0) >= 1000, 'clay surface vertex count is too small for quality witness');
    assert.ok((state.claySurfaceTriangleCount ?? 0) >= 2500, 'clay surface triangle count is too small for quality witness');
    assert.equal(state.clayBrushBoundaryPolicy, 'radius-aware-center-clamp', 'clay brush boundary policy missing');
    assert.equal(state.clayBrushBoundaryEdgeFalloff, 'smoothstep-edge-falloff', 'clay brush boundary edge falloff missing');
    assert.ok(Number.isFinite(state.clayBrushBoundaryClampCount) && state.clayBrushBoundaryClampCount >= 0, 'clay brush boundary clamp count missing');
    assert.ok(Array.isArray(state.clayBrushBoundaryWarnings), 'clay brush boundary warnings missing');
    if (url.includes('clay_colliders=clay_edge_fixture')) {
      assert.ok(state.clayBrushBoundaryClampCount > 0, 'clay edge fixture did not exercise brush boundary clamp');
    }
    assert.ok(state.requestedClayGrid, 'clay route did not report requested grid');
    assert.ok(state.effectiveClayGrid, 'clay route did not report effective grid');
    assert.ok(Array.isArray(state.clayGridConfigWarnings), 'clay route did not report grid config warnings');
    if (expectedGrid) {
      const expected = expectedGridTopology(expectedGrid);
      assert.ok(expected, `invalid --expected-grid ${expectedGrid}`);
      assert.equal(state.effectiveClayGrid, expected.grid, `effective grid did not match expected-grid ${expected.grid}`);
      assert.equal(state.clayGrid, expected.grid, `clay grid did not match expected-grid ${expected.grid}`);
      assert.equal(state.claySurfaceVertexCount, expected.vertexCount, `vertex count did not match expected-grid ${expected.grid}`);
      assert.equal(state.claySurfaceTriangleCount, expected.triangleCount, `triangle count did not match expected-grid ${expected.grid}`);
    }
    assert.ok((state.claySurfaceHeightRange ?? 0) > 0.05, 'clay surface height range did not show readable deformation');
    assert.ok((state.claySurfaceMeanAbsHeight ?? 0) > 0.01, 'clay mean absolute height did not show readable deformation');
    if (url.includes('clay_debug_colliders=0')) {
      assert.equal(state.clayDebugCollidersVisible, false, 'quality witness did not hide debug colliders');
    }
    if (url.includes('clay_interactive=1')) {
      assert.ok((state.clayPointerDragStepCount ?? 0) >= 3, 'interactive clay route did not run pointer-driven steps');
      assert.ok(['pointer_drag', 'pointer_idle'].includes(state.clayInteractionMode), `unexpected clay interaction mode: ${state.clayInteractionMode}`);
      assert.ok(state.clayPointerLastHit, 'interactive clay route did not record a pointer hit');
      assert.ok(Number.isFinite(state.clayPointerLastHit.x), 'pointer hit x did not reach clay debug state');
      assert.ok(Number.isFinite(state.clayPointerLastHit.z), 'pointer hit z did not reach clay debug state');
      const requestedBrushRadius = Number(new URL(url).searchParams.get('clay_brush_radius') || 0.17);
      const requestedBrushStrength = Number(new URL(url).searchParams.get('clay_brush_strength') || 1.18);
      assert.ok(Math.abs(state.clayPointerLastHit.radius - requestedBrushRadius) <= 1e-6, 'pointer hit radius did not match route');
      assert.ok(Math.abs(state.clayPointerLastHit.strength - requestedBrushStrength) <= 1e-6, 'pointer hit strength did not match route');
    }
    if (url.includes('hand_pose_fixture') || handPosePayloadPath) {
      const expectedHandPose = injectedHandPosePayload || {
        requestedBackend: 'mlx',
        effectiveBackend: 'wilor-mlx-fixture',
        evidenceKind: 'synthetic',
      };
      assert.equal(state.requestedHandPoseBackend, expectedHandPose.requestedBackend, 'requested hand-pose backend did not reach clay debug state');
      assert.equal(state.effectiveHandPoseBackend, expectedHandPose.effectiveBackend, 'effective hand-pose backend did not reach clay debug state');
      assert.equal(state.handPoseEvidenceKind, expectedHandPose.evidenceKind, 'hand-pose evidence kind did not reach clay debug state');
      assert.equal(state.handPoseStale, false, 'fresh clay hand-pose fixture was marked stale');
      if (expectedHandPose.evidenceKind === 'stale_visual_only') {
        assert.equal(state.handPoseVisualOnly, true, 'stale visual-only payload did not preserve visual-only evidence flag');
      }
      if (expectedHandPose.source_backend) {
        assert.equal(state.sourceBackend, expectedHandPose.source_backend, 'source backend did not reach clay debug state');
      }
      if (Number.isFinite(expectedHandPose.sample_authority)) {
        assert.equal(state.sampleAuthority, expectedHandPose.sample_authority, 'sample authority did not reach clay debug state');
      }
      assert.equal(state.handPosePressureContract, 'clay_local_y_axis_drives_fingertip_pressure', 'Palm Daddy pressure contract missing from clay debug state');
      if (!handPosePayloadPath) {
        assert.ok(String(state.handPoseFrameId || '').startsWith('hand-pose-fixture-'), 'hand-pose frame id did not reach clay debug state');
      } else {
        assert.equal(String(state.handPoseFrameId), String(expectedHandPose.frameId), 'captured hand-pose frame id did not reach clay debug state');
      }
      assert.equal(state.handPoseHandCount, 1, 'clay hand-pose fixture did not report one hand');
      assert.equal(state.handPoseColliderCount, 5, 'clay hand-pose fixture did not emit fingertip colliders');
      assert.deepEqual(state.handPoseAdapterWarnings, [], 'clay hand-pose fixture emitted adapter warnings');
    }
    assert.ok((state.clayRelaxationFactor ?? 0) > 0, 'clay relaxation factor missing');
    assert.ok((state.clayPlasticityFactor ?? 0) > 0, 'clay plasticity factor missing');
    const expectedClayColliders = url.includes('clay_interactive=1')
      ? 0
      : url.includes('clay_colliders=clay_edge_fixture')
        ? 2
        : 5;
    assert.ok((state.clayColliderCount ?? 0) >= expectedClayColliders, 'clay fixture did not seed expected colliders');
    if (isInteractiveRoute) {
      assert.ok((state.clayPointerDragStepCount ?? 0) >= 3, 'interactive clay route did not preserve pointer contact history');
    } else {
      assert.ok((state.clayContactCount ?? 0) > 0, 'clay route did not report contact');
    }
    assert.ok((state.clayDeformationCount ?? 0) > 0, 'clay route did not report deformation');

    const earlyScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    const screenshotBuffer = Buffer.from(earlyScreenshot.data, 'base64');
    writeFileSync(out, screenshotBuffer);

    phase = 'pixels';
    const metrics = screenshotMetricsFromPng(screenshotBuffer);
    assert.ok(metrics.clayColorPixels > 400, `missing clay-colored visual evidence: ${JSON.stringify(metrics)}`);
    assert.ok(metrics.brightOrangePixels < metrics.clayColorPixels * 0.35, `not fire: output is too orange/fire-like ${JSON.stringify(metrics)}`);

    phase = 'screenshot';
    const report = {
      requestedRoute: url,
      windowSize,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      solverIdentity: state.solverIdentity,
      effectiveBackend: state.effectiveBackend,
      substrateEvidenceKind: state.substrateEvidenceKind,
      runtimeCpuFallback: state.runtimeCpuFallback,
      packagePrimitiveSourceContract: state.packagePrimitiveSourceContract,
      packagePrimitiveImportPath: state.packagePrimitiveImportPath,
      packagePrimitiveCommit: state.packagePrimitiveCommit,
      pointTriangleJobFloats: state.pointTriangleJobFloats,
      pointTriangleResultBytes: state.pointTriangleResultBytes,
      sharedPrimitiveProbeStatus: state.sharedPrimitiveProbeStatus,
      sharedPrimitiveProbeDistanceSq: state.sharedPrimitiveProbeDistanceSq,
      sharedPrimitiveProbeFeature: state.sharedPrimitiveProbeFeature,
      sharedPrimitiveProbeTriangleIndex: state.sharedPrimitiveProbeTriangleIndex,
      primitiveContactPassStatus: state.primitiveContactPassStatus,
      primitiveContactJobCount: state.primitiveContactJobCount,
      primitiveContactActiveCount: state.primitiveContactActiveCount,
      primitiveContactMinDistance: state.primitiveContactMinDistance,
      primitiveContactForceSum: state.primitiveContactForceSum,
      persistentClayStateStatus: state.persistentClayStateStatus,
      persistentClayStepCount: state.persistentClayStepCount,
      persistentClayMaxDelta: state.persistentClayMaxDelta,
      persistentClayDeltaHistory: state.persistentClayDeltaHistory,
      persistentClayInitialDelta: state.persistentClayInitialDelta,
      persistentClayLatestDelta: state.persistentClayLatestDelta,
      persistentClaySettlingRatio: state.persistentClaySettlingRatio,
      clayCubeEnabled: state.clayCubeEnabled,
      clayCubeSolverIdentity: state.clayCubeSolverIdentity,
      clayCubeStepStatus: state.clayCubeStepStatus,
      clayCubeEvidenceKind: state.clayCubeEvidenceKind,
      clayCubeOracleEvidenceKind: state.clayCubeOracleEvidenceKind,
      requestedClayCube: state.requestedClayCube,
      effectiveClayCube: state.effectiveClayCube,
      clayCubeConfigWarnings: state.clayCubeConfigWarnings,
      clayCubeGridDimension: state.clayCubeGridDimension,
      clayCubeParticleCount: state.clayCubeParticleCount,
      clayCubeActiveGridCellCount: state.clayCubeActiveGridCellCount,
      clayCubeDeformedParticleCount: state.clayCubeDeformedParticleCount,
      clayCubeContactParticleCount: state.clayCubeContactParticleCount,
      clayCubeMaxDisplacement: state.clayCubeMaxDisplacement,
      clayCubeMinY: state.clayCubeMinY,
      clayCubeMaxY: state.clayCubeMaxY,
      clayCubeHeightRange: state.clayCubeHeightRange,
      clayCubeReadbackWallMs: state.clayCubeReadbackWallMs,
      clayCubeDispatchWorkgroups: state.clayCubeDispatchWorkgroups,
      clayCubeSurfaceVisible: state.clayCubeSurfaceVisible,
      clayCubeBoundingBoxVisible: state.clayCubeBoundingBoxVisible,
      clayCubeBoundingBoxContract: state.clayCubeBoundingBoxContract,
      clayCubeDiagnosticColorMode: state.clayCubeDiagnosticColorMode,
      clayCubeDiagnosticColoredParticleCount: state.clayCubeDiagnosticColoredParticleCount,
      clayCubeDiagnosticHotParticleCount: state.clayCubeDiagnosticHotParticleCount,
      clayTimingEvidenceSource: state.clayTimingEvidenceSource,
      clayTimingDisclaimer: state.clayTimingDisclaimer,
      clayPhaseTimingDisclaimer: state.clayPhaseTimingDisclaimer,
      clayTimingWarmupPolicy: state.clayTimingWarmupPolicy,
      clayWarmupStepCount: state.clayWarmupStepCount,
      clayStepDurationHistory: state.clayStepDurationHistory,
      claySteadyStepDurationHistory: state.claySteadyStepDurationHistory,
      clayStepLatestMs: state.clayStepLatestMs,
      clayStepP95Ms: state.clayStepP95Ms,
      clayStepSampleCount: state.clayStepSampleCount,
      claySteadyStepP50Ms: state.claySteadyStepP50Ms,
      claySteadyStepP95Ms: state.claySteadyStepP95Ms,
      claySteadyStepSampleCount: state.claySteadyStepSampleCount,
      clayStepMaxOutlierMs: state.clayStepMaxOutlierMs,
      clayContactWallMs: state.clayContactWallMs,
      clayColliderPrepWallMs: state.clayColliderPrepWallMs,
      clayLatticeReadbackWallMs: state.clayLatticeReadbackWallMs,
      clayCpuMeshUpdateMs: state.clayCpuMeshUpdateMs,
      clayNormalUpdateMs: state.clayNormalUpdateMs,
      clayNormalCadence: state.clayNormalCadence,
      clayNormalCadenceWarnings: state.clayNormalCadenceWarnings,
      clayNormalUpdateCount: state.clayNormalUpdateCount,
      clayNormalSkippedCount: state.clayNormalSkippedCount,
      clayNormalsStale: state.clayNormalsStale,
      clayStepTotalWallMs: state.clayStepTotalWallMs,
      clayCpuShadowBenchmarkEnabled: state.clayCpuShadowBenchmarkEnabled,
      clayCpuShadowEvidenceKind: state.clayCpuShadowEvidenceKind,
      clayCpuShadowEstimateMs: state.clayCpuShadowEstimateMs,
      clayCpuShadowRatio: state.clayCpuShadowRatio,
      clayCpuShadowSampleCount: state.clayCpuShadowSampleCount,
      clayCpuShadowChecksum: state.clayCpuShadowChecksum,
      clayCpuContactShadowEstimateMs: state.clayCpuContactShadowEstimateMs,
      clayCpuContactShadowRatio: state.clayCpuContactShadowRatio,
      clayCpuContactShadowSampleCount: state.clayCpuContactShadowSampleCount,
      clayCpuContactShadowChecksum: state.clayCpuContactShadowChecksum,
      claySurfaceMinY: state.claySurfaceMinY,
      claySurfaceMaxY: state.claySurfaceMaxY,
      claySurfaceHeightRange: state.claySurfaceHeightRange,
      claySurfaceMeanAbsHeight: state.claySurfaceMeanAbsHeight,
      clayBrushBoundaryPolicy: state.clayBrushBoundaryPolicy,
      clayBrushBoundaryEdgeFalloff: state.clayBrushBoundaryEdgeFalloff,
      clayBrushBoundaryClampCount: state.clayBrushBoundaryClampCount,
      clayBrushBoundaryWarnings: state.clayBrushBoundaryWarnings,
      claySurfaceVertexCount: state.claySurfaceVertexCount,
      claySurfaceTriangleCount: state.claySurfaceTriangleCount,
      requestedClayGrid: state.requestedClayGrid,
      effectiveClayGrid: state.effectiveClayGrid,
      clayGridConfigWarnings: state.clayGridConfigWarnings,
      clayDebugCollidersVisible: state.clayDebugCollidersVisible,
      clayInteractionMode: state.clayInteractionMode,
      clayPointerActive: state.clayPointerActive,
      clayPointerColliderCount: state.clayPointerColliderCount,
      clayPointerDragStepCount: state.clayPointerDragStepCount,
      clayPointerLastHit: state.clayPointerLastHit,
      requestedHandPoseBackend: state.requestedHandPoseBackend,
      effectiveHandPoseBackend: state.effectiveHandPoseBackend,
      handPoseEvidenceKind: state.handPoseEvidenceKind,
      handPoseStale: state.handPoseStale,
      handPoseVisualOnly: state.handPoseVisualOnly,
      handPoseFrameId: state.handPoseFrameId,
      handPoseHandCount: state.handPoseHandCount,
      handPoseColliderCount: state.handPoseColliderCount,
      handPoseAdapterWarnings: state.handPoseAdapterWarnings,
      sourceBackend: state.sourceBackend,
      sampleAgeMs: state.sampleAgeMs,
      sampleAuthority: state.sampleAuthority,
      handPosePressureContract: state.handPosePressureContract,
      handPosePayloadPath,
      handPosePayloadReplay,
      clayRelaxationFactor: state.clayRelaxationFactor,
      clayPlasticityFactor: state.clayPlasticityFactor,
      clayColliderCount: state.clayColliderCount,
      clayContactCount: state.clayContactCount,
      clayDeformationCount: state.clayDeformationCount,
      clayDeformationMax: state.clayDeformationMax,
      gpuStepCount: state.gpuStepCount,
      clayColorPixels: metrics.clayColorPixels,
      brightOrangePixels: metrics.brightOrangePixels,
      litPixels: metrics.litPixels,
      visualVerdict: isCubeRoute
        ? 'webgpu clay cube material-point witness visible; old surface hidden; not fire'
        : 'webgpu clay surface visible; not fire',
      screenshot: out,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    let failureState = null;
    let failureScreenshotWritten = false;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosClayPrototype?.debugState?.()',
          returnByValue: true,
        });
        failureState = stateEval.result?.value || null;
      } catch {
        failureState = null;
      }
      try {
        const failureScreenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
        writeFileSync(out, Buffer.from(failureScreenshot.data, 'base64'));
        failureScreenshotWritten = true;
      } catch {
        failureScreenshotWritten = false;
      }
      ws.close();
    }
    const report = {
      requestedRoute: url,
      windowSize,
      phase,
      error: err?.message || String(err),
      screenshot: out,
      screenshotWritten: failureScreenshotWritten,
      failureState,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();
