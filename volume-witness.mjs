#!/usr/bin/env node
import assert from 'node:assert/strict';
import { deflateSync, inflateSync as zlibInflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1';
const out = resolve(args.get('--out') || '/tmp/kaminos-volume-witness.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9433);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-volume-witness-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1500);
const routeParams = new URL(url).searchParams;
const requestedGrid = Number(routeParams.get('volume_resolution'));
const expectedGrid = [32, 48, 64, 96].includes(requestedGrid) ? requestedGrid : 96;
const requestedGridOverlay = Number(routeParams.get('volume_grid'));
const expectedGridOverlay = Number.isFinite(requestedGridOverlay)
  ? Math.max(0, Math.min(1, requestedGridOverlay))
  : 0;
const requestedRaySteps = Number(routeParams.get('volume_steps'));
const expectedRaySteps = routeParams.has('volume_steps') && Number.isFinite(requestedRaySteps)
  ? Math.max(24, Math.min(160, requestedRaySteps))
  : 96;
const requestedAdaptiveRays = Number(routeParams.get('volume_adaptive_rays'));
const expectedAdaptiveRays = routeParams.has('volume_adaptive_rays') && Number.isFinite(requestedAdaptiveRays)
  ? Math.max(0, Math.min(1, requestedAdaptiveRays))
  : 0.65;
const expectedPrimitiveFixture = routeParams.get('volume_primitive_fixture');
const expectedLamellarHookFixture = ['lamellar_hook', 'lamellar_selected_hook'].includes(expectedPrimitiveFixture);
const expectedAuthoringProbe = routeParams.get('volume_authoring_probe') === '1';
const expectedSaveLoadProbe = routeParams.get('volume_save_load_probe') === '1';
const expectedMultiPrimitiveProbe = routeParams.get('volume_multi_primitive_probe') === '1';
const expectedThirdSmokeTransformProbe = routeParams.get('volume_third_smoke_transform_probe') === '1';
const expectedSmokeMoveChannelProbe = routeParams.get('volume_smoke_move_channel_probe') === '1';
const requestedSourceTypeProbe = routeParams.get('volume_source_type_probe');
const expectedSourceTypeProbe = requestedSourceTypeProbe === '1';
const expectedSingleSourceTypeProbe = ['fire', 'smoke', 'fire_smoke'].includes(requestedSourceTypeProbe);
const expectedSmokeOnlySourceProbe = requestedSourceTypeProbe === 'smoke';
const expectedFireOnlySourceProbe = requestedSourceTypeProbe === 'fire';
const expectedSmokeOnlyChannelProbe = expectedSmokeOnlySourceProbe || expectedSmokeMoveChannelProbe;
const expectedContextProbe = routeParams.get('volume_context_probe') === '1';
const expectedSceneBoundsProbe = routeParams.get('volume_scene_bounds_probe') === '1';
const expectedSceneSourceProbe = routeParams.get('volume_scene_source_probe') === '1';
const expectedScenePlacementProbe = expectedSceneBoundsProbe || expectedSceneSourceProbe;
const expectedSceneBoundsOnlyProbe = expectedSceneBoundsProbe && !expectedSceneSourceProbe;
const expectedAuthoredPrimitiveId = 'authored-fire-smoke-witness';
const expectedSecondPrimitiveId = 'authored-fire-smoke-witness-b';
const expectedSmokePrimitiveId = 'authored-smoke-source-witness';
const expectedSmokeMovePrimitiveId = 'authored-smoke-move-channel-witness';
const expectedThirdSmokePrimitiveId = 'authored-smoke-source-witness-b';
const expectedFireSmokeSourcePrimitiveId = 'authored-fire-smoke-source-witness';
const expectedAuthoredMovedPosition = [0.32, -0.52, 0.18];
const expectedAuthoredMovedNativeSourcePosition = [0.05504, -0.1048, 0.03096];
const expectedSmokeMovePrimitivePosition = [0.42, -0.50, -0.22];
const expectedSmokeMovePrimitiveNativeSourcePosition = [0.07224, -0.1, -0.03784];
const expectedAuthoredSceneBoundsPosition = [0.62, -0.9, 0.0];
const expectedAuthoredSceneBoundsNativeSourcePosition = [0.10664, -0.196, 0.0];
const expectedAuthoredSourceWallPosition = [0.0, 0.4, 0.9];
const expectedAuthoredEffectivePosition = expectedSmokeMoveChannelProbe ? expectedSmokeMovePrimitivePosition
  : expectedSceneSourceProbe ? expectedAuthoredSourceWallPosition
  : expectedSceneBoundsProbe ? expectedAuthoredSceneBoundsPosition
  : expectedAuthoredMovedPosition;
const expectedAuthoredNativeSourcePosition = expectedSmokeMoveChannelProbe ? expectedSmokeMovePrimitiveNativeSourcePosition
  : expectedSceneSourceProbe ? [0.0, 0.116, 0.1548]
  : expectedSceneBoundsProbe ? expectedAuthoredSceneBoundsNativeSourcePosition
  : expectedAuthoredMovedNativeSourcePosition;
const expectedSourceMappingIdentity = 'volume-primitive-scene-bounds-source-domain-v1';
const expectedSecondPrimitivePosition = [-0.24, -0.52, -0.18];
const expectedSecondPrimitiveNativeSourcePosition = [-0.04128, -0.1048, -0.03096];
const expectedThirdSmokePrimitivePosition = [0.54, -0.48, 0.22];
const expectedThirdSmokePrimitiveNativeSourcePosition = [0.09288, -0.0952, 0.03784];
const expectedRouteSourceProbeId = expectedSingleSourceTypeProbe ? `route-${requestedSourceTypeProbe.replace('_', '-')}-source-probe` : null;
const expectedPrimitiveId = expectedLamellarHookFixture
  ? 'fixture-lamellar-hook-selected'
  : expectedSingleSourceTypeProbe ? expectedRouteSourceProbeId
  : expectedSmokeMoveChannelProbe ? expectedSmokeMovePrimitiveId
  : expectedAuthoringProbe ? expectedAuthoredPrimitiveId
  : expectedPrimitiveFixture ? 'fixture-fire-smoke-sphere' : null;

function assertNoPlaceholderTopologyClaim(primitives = []) {
  for (const primitive of primitives) {
    const placeholderContract = primitive?.placeholderContract || primitive?.coupling?.placeholderContract || primitive?.lamellarHook?.placeholderContract;
    const claimsProduction =
      primitive?.topologyAuthority === 'production' ||
      primitive?.coupling?.topologyAuthority === 'production' ||
      primitive?.claims?.productionLamellarTopology === true;
    if (placeholderContract && claimsProduction) {
      throw new Error(`Volume primitive ${primitive?.id || '(unknown)'} carries placeholderContract=${placeholderContract} but claims production Lamellar topology`);
    }
  }
}

function assertVectorClose(actual = [], expected = [], label = 'vector') {
  assert.equal(actual.length, expected.length, `${label} length mismatch`);
  for (let i = 0; i < expected.length; i++) {
    assert.ok(Math.abs(Number(actual[i]) - expected[i]) < 0.001, `${label}[${i}] expected ${expected[i]}, got ${actual[i]}`);
  }
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetch(path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

async function waitForCdp() {
  for (let i = 0; i < 80; i++) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(125);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
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

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function parsePngRgba(buffer) {
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, 'not a PNG screenshot');
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < buffer.length) {
    const len = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + len);
    offset += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      assert.equal(data[8], 8, 'only 8-bit PNG screenshots are supported');
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  assert.ok(channels, `unsupported PNG color type ${colorType}`);
  const raw = zlibInflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let p = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const row = Buffer.from(raw.subarray(p, p + stride));
    p += stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = prev[x] || 0;
      const upLeft = x >= channels ? prev[x - channels] || 0 : 0;
      if (filter === 1) row[x] = (row[x] + left) & 255;
      else if (filter === 2) row[x] = (row[x] + up) & 255;
      else if (filter === 3) row[x] = (row[x] + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) {
        const pa = Math.abs(up - upLeft);
        const pb = Math.abs(left - upLeft);
        const pc = Math.abs(left + up - 2 * upLeft);
        const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
        row[x] = (row[x] + pr) & 255;
      } else if (filter !== 0) {
        throw new Error(`unsupported PNG filter ${filter}`);
      }
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, channels, rows };
}

function measureScreenshot(buffer) {
  const png = parsePngRgba(buffer);
  let lit = 0;
  let fireLike = 0;
  let warmEmissive = 0;
  let smokeLike = 0;
  let totalLum = 0;
  let samples = 0;
  for (let y = Math.floor(png.height * 0.08); y < Math.floor(png.height * 0.92); y += 2) {
    const row = png.rows[y];
    for (let x = Math.floor(png.width * 0.08); x < Math.floor(png.width * 0.92); x += 2) {
      const i = x * png.channels;
      const r = row[i];
      const g = row[i + 1];
      const b = row[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      totalLum += lum;
      samples++;
      if (lum > 20) lit++;
      if (r > 120 && g > 70 && b < 80) fireLike++;
      if (r > 150 && g > 125 && Math.min(r, g) > b + 18) warmEmissive++;
      if (b > 28 && g > 28 && r < 95 && Math.abs(g - b) < 55) smokeLike++;
    }
  }
  return {
    width: png.width,
    height: png.height,
    meanLuma: totalLum / Math.max(1, samples),
    litPixels: lit,
    fireLikePixels: fireLike,
    warmEmissivePixels: warmEmissive,
    smokeLikePixels: smokeLike,
  };
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  typeBuf.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return out;
}

function writeRgbaPng(path, width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.slice(y * stride, (y + 1) * stride)).copy(raw, y * (stride + 1) + 1);
  }
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

async function captureMainRendererScreenshot(ws, screenshotPath) {
  const pageShot = await wsRequest(ws, 'Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const buffer = Buffer.from(pageShot.data, 'base64');
  writeFileSync(screenshotPath, buffer);
  return measureScreenshot(buffer);
}

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  mkdirSync(dirname(reportPath), { recursive: true });

  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1280,960',
    url,
  ], { stdio: 'ignore' });

  let phase = 'launch';
  try {
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    let volumeAuthoring = null;
    let saveLoadRoundTrip = null;
    let contextActionProbe = null;
    let smokeMoveChannelSamples = null;
    if (expectedAuthoringProbe || expectedSingleSourceTypeProbe || expectedSmokeMoveChannelProbe) {
      phase = 'authoring-probe';
      let authoringReady = false;
      for (let i = 0; i < 40; i++) {
        const readyEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: '!!window.__kaminosVolumeAuthoring?.debugState',
          returnByValue: true,
        });
        authoringReady = readyEval.result.value === true;
        if (authoringReady) break;
        await delay(250);
      }
      assert.equal(authoringReady, true, 'volume authoring debug route did not initialize');
      const authoringEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: `(async () => {
          const authoring = window.__kaminosVolumeAuthoring;
          const primaryId = '${expectedPrimitiveId || expectedAuthoredPrimitiveId}';
          let primitive = null;
          let smokeMoveChannelSamples = null;
          if (${expectedSingleSourceTypeProbe ? 'true' : 'false'}) {
            authoring.select(primaryId);
            primitive = authoring.updateSelected({
              sourceType: '${expectedSingleSourceTypeProbe ? requestedSourceTypeProbe : expectedSourceTypeProbe ? 'fire' : 'fire_smoke'}',
              radius: 0.18,
              flowRate: 0.35,
              density: 1,
              fire: ${expectedSmokeOnlySourceProbe ? '0' : '1'},
              smoke: ${expectedFireOnlySourceProbe ? '0' : '1'},
              radiance: ${expectedSmokeOnlySourceProbe ? '0.35' : '2.1'},
              handleOpacity: 0.12,
              handleVisible: true,
            });
          } else {
            primitive = authoring.placeAt([0.24, -0.58, 0.12], {
              id: primaryId,
              sourceType: '${expectedSmokeMoveChannelProbe ? 'smoke' : expectedSourceTypeProbe ? 'fire' : 'fire_smoke'}',
              radius: 0.18,
              flowRate: 0.35,
              density: 1,
              fire: ${expectedSmokeMoveChannelProbe ? '0' : '1'},
              smoke: ${expectedSmokeMoveChannelProbe ? '1' : expectedSourceTypeProbe ? '0' : '1'},
              radiance: ${expectedSmokeMoveChannelProbe ? '0.35' : '2.1'},
            });
            authoring.select(primaryId);
            authoring.updateSelected({
              sourceType: '${expectedSmokeMoveChannelProbe ? 'smoke' : expectedSourceTypeProbe ? 'fire' : 'fire_smoke'}',
              radius: 0.18,
              flowRate: 0.35,
              density: 1,
              fire: ${expectedSmokeMoveChannelProbe ? '0' : '1'},
              smoke: ${expectedSmokeMoveChannelProbe ? '1' : expectedSourceTypeProbe ? '0' : '1'},
              radiance: ${expectedSmokeMoveChannelProbe ? '0.35' : '2.1'},
              handleOpacity: 0.12,
              handleVisible: true,
            });
          }
          const moved = authoring.moveSelectedTo([${expectedAuthoredEffectivePosition.join(', ')}]);
          if (${expectedSmokeMoveChannelProbe ? 'true' : 'false'}) {
            smokeMoveChannelSamples = [];
            const movePositions = [
              [0.02, -0.52, 0.02],
              [-0.36, -0.49, 0.18],
              [${expectedSmokeMovePrimitivePosition.join(', ')}],
            ];
            for (const movePosition of movePositions) {
              const movedStep = authoring.moveSelectedTo(movePosition);
              await new Promise(resolveFrame => requestAnimationFrame(() => resolveFrame()));
              const sample = await window.__kaminosVolumePrototype.sampleFrame();
              const { preview, ...sampleSummary } = sample || {};
              smokeMoveChannelSamples.push({
                movedPosition: movedStep?.transform?.position || null,
                volumeState: window.__kaminosVolumePrototype?.debugState?.() || null,
                authoringState: authoring.debugState(),
                sample: sampleSummary,
              });
            }
          }
          const second = ${expectedMultiPrimitiveProbe
            ? `authoring.placeAt([${expectedSecondPrimitivePosition.join(', ')}], {
                id: '${expectedSecondPrimitiveId}',
                radius: 0.16,
                flowRate: 0.32,
                radiance: 1.9,
              })`
            : "null"};
          if (second) {
            authoring.select('${expectedSecondPrimitiveId}');
            authoring.updateSelected({ radius: 0.16, flowRate: 0.32, radiance: 1.9, handleOpacity: 0.05, handleVisible: true });
          }
          const smokeSource = ${expectedSourceTypeProbe || expectedThirdSmokeTransformProbe
            ? `authoring.placeAt([-0.30, -0.52, -0.10], {
                id: '${expectedSmokePrimitiveId}',
                sourceType: 'smoke',
                radius: 0.16,
                flowRate: 0.34,
                radiance: 0.4,
              })`
            : "null"};
          if (smokeSource) {
            authoring.select('${expectedSmokePrimitiveId}');
            authoring.updateSelected({ sourceType: 'smoke', radius: 0.16, flowRate: 0.34, fire: 0, smoke: 1, radiance: 0.4, handleOpacity: 0.07, handleVisible: true });
          }
          const thirdSmokeSource = ${expectedThirdSmokeTransformProbe
            ? `authoring.placeAt([0.12, -0.50, 0.04], {
                id: '${expectedThirdSmokePrimitiveId}',
                sourceType: 'smoke',
                radius: 0.14,
                flowRate: 0.29,
                radiance: 0.32,
              })`
            : "null"};
          if (thirdSmokeSource) {
            authoring.select('${expectedThirdSmokePrimitiveId}');
            authoring.updateSelected({ sourceType: 'smoke', radius: 0.14, flowRate: 0.29, fire: 0, smoke: 1, radiance: 0.32, handleOpacity: 0.09, handleVisible: true });
            authoring.moveSelectedTo([${expectedThirdSmokePrimitivePosition.join(', ')}]);
          }
          const fireSmokeSource = ${expectedSourceTypeProbe
            ? `authoring.placeAt([0.04, -0.50, -0.24], {
                id: '${expectedFireSmokeSourcePrimitiveId}',
                sourceType: 'fire_smoke',
                radius: 0.15,
                flowRate: 0.30,
                radiance: 1.8,
              })`
            : "null"};
          if (fireSmokeSource) {
            authoring.select('${expectedFireSmokeSourcePrimitiveId}');
            authoring.updateSelected({ sourceType: 'fire_smoke', radius: 0.15, flowRate: 0.30, radiance: 1.8, handleOpacity: 0.06, handleVisible: true });
          }
          const contextResult = ${expectedContextProbe
            ? `(() => {
                authoring.select('${expectedAuthoredPrimitiveId}');
                const duplicate = authoring.duplicateSelected();
                const duplicateId = duplicate?.id || null;
                authoring.updateSelected({ handleOpacity: 0.07, handleVisible: true });
                const hidden = authoring.toggleSelectedHandle();
                const hiddenState = authoring.debugState();
                const shown = authoring.toggleSelectedHandle();
                const shownState = authoring.debugState();
                const selectedAfterDelete = authoring.deleteSelected();
                return {
                  duplicateId,
                  hiddenVisible: hidden?.authoring?.handleVisible,
                  shownVisible: shown?.authoring?.handleVisible,
                  hiddenMarkerState: hiddenState?.markerStates?.find(item => item.id === duplicateId),
                  shownMarkerState: shownState?.markerStates?.find(item => item.id === duplicateId),
                  selectedAfterDelete: selectedAfterDelete?.id || null,
                };
              })()`
            : "null"};
          const roundTrip = ${expectedSaveLoadProbe
            ? "await window.__kaminosScenePersistence.saveLoadRoundTrip(null)"
            : "null"};
          return { ok: true, primitive: moved || primitive, state: authoring.debugState(), roundTrip, contextResult, smokeMoveChannelSamples };
        })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      const authoringProbe = authoringEval.result.value;
      assert.equal(authoringProbe?.ok, true, 'authored volume primitive probe did not run');
      volumeAuthoring = authoringProbe.state;
      saveLoadRoundTrip = authoringProbe.roundTrip || null;
      const contextResult = authoringProbe.contextResult || null;
      contextActionProbe = contextResult;
      smokeMoveChannelSamples = authoringProbe.smokeMoveChannelSamples || null;
      if (expectedContextProbe) {
        assert.ok(contextResult?.duplicateId, 'context duplicate action did not create a duplicate primitive');
        assert.equal(contextResult?.hiddenVisible, false, `context hide action did not hide the duplicate handle locally: ${JSON.stringify(contextResult)}`);
        assert.equal(contextResult?.hiddenMarkerState?.handleVisible, false, `hidden context marker state was not local to the duplicate: ${JSON.stringify(contextResult)}`);
        assert.equal(contextResult?.shownVisible, true, `context show action did not restore the duplicate handle locally: ${JSON.stringify(contextResult)}`);
        assert.equal(contextResult?.shownMarkerState?.handleVisible, true, `shown context marker state was not local to the duplicate: ${JSON.stringify(contextResult)}`);
        assert.equal(contextResult?.selectedAfterDelete, expectedAuthoredPrimitiveId, 'context delete action did not return selection to the surviving primitive');
      }
      const expectedProbeSelection = expectedThirdSmokeTransformProbe ? expectedThirdSmokePrimitiveId
        : expectedSourceTypeProbe ? expectedFireSmokeSourcePrimitiveId
        : expectedMultiPrimitiveProbe ? expectedSecondPrimitiveId : expectedPrimitiveId;
      assert.equal(volumeAuthoring?.selectedVolumePrimitiveId, expectedProbeSelection, 'authored volume primitive was not selected');
      assert.equal(volumeAuthoring?.transformTargetPrimitiveId, expectedProbeSelection, 'authored volume primitive did not attach to the transform target');
      assert.equal(volumeAuthoring?.transformTargetIdentity, 'volume-primitive-transform-target-v0', 'authored volume primitive target identity regressed');
      assert.ok(volumeAuthoring?.markerIds?.includes(expectedPrimitiveId), 'authored volume primitive marker was not created');
      assert.equal(volumeAuthoring?.markerAffordance, 'volume-primitive-marker-wire-halo-v0', 'authored volume primitive marker regressed to a solid affordance');
      assert.equal(volumeAuthoring?.markerSemantic, 'volume-primitive-source-handle-not-raymarch-bounds-v0', 'authored volume primitive marker must not claim full raymarch bounds');
      assert.ok((volumeAuthoring?.markerOpacity ?? 1) <= 0.2, 'authored volume primitive marker opacity is too visually dominant');
      assert.equal(volumeAuthoring?.solidMarkerCount, 0, 'authored volume primitive marker must not be a solid filled body');
      if (expectedMultiPrimitiveProbe) {
        assert.equal(volumeAuthoring?.volumePrimitiveCount, 2, 'multi-primitive probe did not create two authored primitives');
        assert.ok(volumeAuthoring?.volumePrimitiveIds?.includes(expectedSecondPrimitiveId), 'second authored primitive marker was not created');
      }
      if (expectedThirdSmokeTransformProbe) {
        assert.equal(volumeAuthoring?.volumePrimitiveCount, 3, 'third smoke transform probe did not create three authored primitives');
        assert.ok(volumeAuthoring?.volumePrimitiveIds?.includes(expectedSmokePrimitiveId), 'third smoke transform probe did not create the first smoke primitive marker');
        assert.ok(volumeAuthoring?.volumePrimitiveIds?.includes(expectedThirdSmokePrimitiveId), 'third smoke transform probe did not create the second smoke primitive marker');
      }
      if (expectedSmokeMoveChannelProbe) {
        assert.equal(volumeAuthoring?.volumePrimitiveCount, 1, 'smoke move channel probe should create exactly one authored primitive');
        assert.ok(Array.isArray(smokeMoveChannelSamples), 'smoke move channel probe did not return immediate move samples');
        assert.equal(smokeMoveChannelSamples.length, 3, 'smoke move channel probe did not sample every movement step');
        for (const [index, moveSample] of smokeMoveChannelSamples.entries()) {
          const movedSource = moveSample?.volumeState?.primitiveSources?.find(source => source.id === expectedSmokeMovePrimitiveId);
          assert.equal(movedSource?.sourceType, 'smoke', `smoke move sample ${index} lost source type`);
          assert.equal(movedSource?.fireSourceMix, 0, `smoke move sample ${index} carried fire source mix`);
          assert.equal(movedSource?.fireGain, 0, `smoke move sample ${index} carried primitive-local fire gain`);
          assert.ok((movedSource?.smokeGain ?? 0) > 0.9, `smoke move sample ${index} lost smoke gain`);
          assert.ok((moveSample?.sample?.simReadback?.fireLayerMean ?? 1) <= 0.00018, `smoke move sample ${index} leaked fire layer during movement`);
          assert.ok((moveSample?.sample?.simReadback?.radianceMean ?? 1) <= 0.0008, `smoke move sample ${index} leaked radiance during movement`);
          assert.ok((moveSample?.sample?.simReadback?.fireLickMean ?? 1) <= 0.00012, `smoke move sample ${index} leaked fire licks during movement`);
          assert.equal(moveSample?.sample?.fireLikePixels, 0, `smoke move sample ${index} showed fire-like pixels immediately after movement`);
          assert.equal(moveSample?.sample?.emissiveLikePixels, 0, `smoke move sample ${index} showed emissive pixels immediately after movement`);
          assert.equal(moveSample?.sample?.warmEmissivePixels, 0, `smoke move sample ${index} showed warm emissive pixels immediately after movement`);
        }
      }
      if (expectedSourceTypeProbe) {
        assert.equal(volumeAuthoring?.sourceTypeTaxonomy?.identity, 'volume-source-type-taxonomy-v0', 'source type probe did not expose source taxonomy identity');
        assert.ok(volumeAuthoring?.volumePrimitiveIds?.includes(expectedSmokePrimitiveId), 'source type probe did not create smoke primitive marker');
        assert.ok(volumeAuthoring?.volumePrimitiveIds?.includes(expectedFireSmokeSourcePrimitiveId), 'source type probe did not create Fire+Smoke primitive marker');
      }
      if (expectedSaveLoadProbe) {
        assert.equal(saveLoadRoundTrip?.identity, 'kaminos-volume-save-load-roundtrip-v0', 'save/load round-trip did not report stable identity');
        assert.ok(saveLoadRoundTrip?.savedSceneFile?.endsWith('.kaminos.json'), 'save/load round-trip did not save a Kaminos scene file');
        assert.equal(saveLoadRoundTrip?.cleanup?.deleted, saveLoadRoundTrip?.savedSceneFile, 'save/load round-trip did not clean up its saved scene file');
        const savedPrimitive = saveLoadRoundTrip?.savedSceneData?.volumePrimitives?.primitives?.find(item => item.id === expectedAuthoredPrimitiveId);
        const loadedPrimitive = saveLoadRoundTrip?.loadedSceneData?.volumePrimitives?.primitives?.find(item => item.id === expectedAuthoredPrimitiveId);
        const roundTripPrimitive = saveLoadRoundTrip?.volumeState?.volumePrimitives?.find(item => item.id === expectedAuthoredPrimitiveId);
        assert.equal(saveLoadRoundTrip?.savedSceneData?.volumePrimitives?.selectedVolumePrimitiveId, expectedAuthoredPrimitiveId, 'saved scene did not preserve selected volume primitive id');
        assert.equal(saveLoadRoundTrip?.loadedSceneData?.volumePrimitives?.selectedVolumePrimitiveId, expectedAuthoredPrimitiveId, 'loaded scene did not preserve selected volume primitive id');
        assert.equal(saveLoadRoundTrip?.volumeAuthoring?.selectedVolumePrimitiveId, expectedAuthoredPrimitiveId, 'round-tripped authoring state did not restore selected primitive');
        assert.equal(saveLoadRoundTrip?.volumeAuthoring?.transformTargetPrimitiveId, expectedAuthoredPrimitiveId, 'round-tripped authoring state did not restore transform target');
        assertVectorClose(savedPrimitive?.transform?.position, expectedAuthoredEffectivePosition, 'saved scene primitive transform position');
        assertVectorClose(loadedPrimitive?.transform?.position, expectedAuthoredEffectivePosition, 'loaded scene primitive transform position');
        assertVectorClose(roundTripPrimitive?.transform?.position, expectedAuthoredEffectivePosition, 'round-tripped renderer primitive transform position');
        assertVectorClose(saveLoadRoundTrip?.volumeState?.primitiveSource?.position, expectedAuthoredEffectivePosition, 'round-tripped primitive source position');
        if (expectedSceneSourceProbe) {
          assertVectorClose(saveLoadRoundTrip?.volumeState?.primitiveSource?.scenePosition, expectedAuthoredEffectivePosition, 'round-tripped primitive source scene position');
          assertVectorClose(saveLoadRoundTrip?.volumeState?.primitiveSource?.nativeSourcePosition, expectedAuthoredNativeSourcePosition, 'round-tripped primitive native source position');
          assert.equal(saveLoadRoundTrip?.volumeState?.primitiveSource?.sourceMappingIdentity, expectedSourceMappingIdentity, 'round-tripped primitive source mapping identity missing');
        }
      }
      await delay(Math.max(600, Math.floor(settleMs / 2)));
    }
    phase = 'identity';
    let state = null;
    for (let i = 0; i < 40; i++) {
      const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosVolumePrototype?.debugState?.()',
        returnByValue: true,
      });
      state = stateEval.result.value;
      if (state?.frameCount > 8) break;
      await delay(250);
    }
    assert.ok(state, 'missing volume debug state');
    assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route');
    assert.equal(state.prototypeIdentity, 'kaminos-volume-prototype-v0', 'wrong prototype identity');
    assert.equal(state.active, true, 'volume route is not active');
    const bridgeEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: 'window.__kaminosVolumeBridge?.debugState?.()',
      returnByValue: true,
    });
    const bridge = bridgeEval.result.value;
    assert.equal(bridge?.identity, 'volume-main-renderer-bridge-v0', 'wrong volume main-renderer bridge identity');
    assert.equal(bridge?.textureSource, 'kaminos-volume-texture-canvas', 'volume bridge is not sourcing the CanvasTexture-compatible volume mirror');
    assert.equal(bridge?.depthMode, 'main-renderer-scene-object-depth-bridge-v1', 'wrong volume bridge depth mode');
    if (bridge?.placementMode === 'empty-scene-visible-depth-tested-plane-v0') {
      assert.equal(bridge?.depthTest, false, 'empty volume scenes must not hide the bridge behind the procedural backdrop');
    } else {
      assert.equal(bridge?.depthTest, true, 'volume bridge is not participating in main renderer depth testing with authored scene objects');
    }
    assert.equal(bridge?.depthWrite, false, 'volume bridge must not write depth while still using texture-plane composition');
    assert.ok(state.frameCount > 5, 'volume route did not render enough frames');
    assert.equal(state.simGrid, expectedGrid, `fluid sim is not running on the expected ${expectedGrid}^3 grid`);
    assert.equal(state.simGridLabel, `${expectedGrid}^3 velocity-material-fire-microdetail-storage-buffer`, 'fluid sim label does not match selected grid');
    assert.ok(Math.abs((state.controls?.gridOverlay || 0) - expectedGridOverlay) < 0.001, 'fluid grid overlay did not apply route/debug state');
    assert.ok(Math.abs((state.controls?.raySteps ?? 0) - expectedRaySteps) < 0.001, 'ray-step route/control did not apply');
    assert.ok(Math.abs((state.controls?.adaptiveRays ?? 0) - expectedAdaptiveRays) < 0.001, 'adaptive raymarch route/control did not apply');
    assert.ok(Math.abs((state.adaptiveRaymarch ?? 0) - expectedAdaptiveRays) < 0.001, 'effective adaptive raymarch state did not match route/control');
    if (expectedPrimitiveFixture || expectedAuthoringProbe || expectedSingleSourceTypeProbe) {
      assert.ok(state.volumePrimitiveCount > 0, 'volume primitive fixture was not consumed by the renderer');
      assert.ok(state.volumePrimitiveIds?.includes(expectedPrimitiveId), `volume primitive ids did not include ${expectedPrimitiveId}`);
    }
    assertNoPlaceholderTopologyClaim(state.volumePrimitives);
    if (expectedLamellarHookFixture) {
      const primitive = state.volumePrimitives?.find(item => item.id === expectedPrimitiveId);
      assert.equal(primitive?.couplingSource, 'lamellar', 'Lamellar hook primitive did not preserve coupling source');
      assert.equal(primitive?.targetHookId, 'lamellar-0-0-selected', 'Lamellar hook primitive did not preserve target hook id');
      assert.equal(primitive?.placeholderContract, 'temporary-aesthetic-composition-primitive-not-final-lamellar-topology', 'Lamellar hook primitive did not preserve placeholder topology contract');
      assert.equal(primitive?.coupling?.witnessIdentity, 'kaminos-lamellar-witness-v0', 'Lamellar hook primitive did not preserve witness identity');
      assert.ok(Number.isFinite(primitive?.lamellarHook?.emissiveCatch), 'Lamellar hook primitive did not preserve scalar hook hints');
    }
    if (expectedAuthoringProbe || expectedSingleSourceTypeProbe) {
      const authoringStateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosVolumeAuthoring?.debugState?.()',
        returnByValue: true,
      });
      volumeAuthoring = authoringStateEval.result.value;
      const primitive = state.volumePrimitives?.find(item => item.id === expectedPrimitiveId);
      const authoredPrimitive = volumeAuthoring?.volumePrimitives?.find(item => item.id === expectedPrimitiveId);
      const secondPrimitive = state.volumePrimitives?.find(item => item.id === expectedSecondPrimitiveId);
      assert.equal(volumeAuthoring?.identity, 'volume-authoring-loop-v0', 'wrong volume authoring identity');
      assert.equal(volumeAuthoring?.parameterOwnership?.identity, 'volume-parameter-ownership-taxonomy-v0', 'wrong parameter ownership taxonomy identity');
      assert.equal(volumeAuthoring?.sourceTypeTaxonomy?.identity, 'volume-source-type-taxonomy-v0', 'wrong source type taxonomy identity');
      assert.ok(volumeAuthoring?.sourceTypeTaxonomy?.sourceTypes?.some(type => type.sourceType === 'fire'), 'source taxonomy did not include Fire');
      assert.ok(volumeAuthoring?.sourceTypeTaxonomy?.sourceTypes?.some(type => type.sourceType === 'smoke'), 'source taxonomy did not include Smoke');
      assert.ok(volumeAuthoring?.sourceTypeTaxonomy?.sourceTypes?.some(type => type.sourceType === 'fire_smoke'), 'source taxonomy did not include Fire+Smoke');
      assert.ok(volumeAuthoring?.parameterOwnership?.primitiveAppliedControlIds?.includes('volume-primitive-radius'), 'primitive radius ownership was not marked backend-applied local');
      assert.ok(volumeAuthoring?.parameterOwnership?.primitiveAppliedControlIds?.includes('volume-primitive-flow-rate'), 'primitive flow ownership was not marked backend-applied local');
      assert.ok(volumeAuthoring?.parameterOwnership?.primitiveAppliedControlIds?.includes('volume-primitive-density'), 'primitive density ownership was not marked backend-applied local');
      assert.ok(volumeAuthoring?.parameterOwnership?.primitiveAppliedControlIds?.includes('volume-primitive-fire'), 'primitive fire ownership was not marked backend-applied local');
      assert.ok(volumeAuthoring?.parameterOwnership?.primitiveAppliedControlIds?.includes('volume-primitive-smoke'), 'primitive smoke ownership was not marked backend-applied local');
      assert.ok(volumeAuthoring?.parameterOwnership?.primitiveAuthoredControlIds?.includes('volume-primitive-radiance'), 'primitive radiance was not marked authored-local');
      assert.ok(volumeAuthoring?.parameterOwnership?.rendererGlobalControlIds?.includes('volume-density'), 'density was not marked renderer-global');
      assert.ok(volumeAuthoring?.parameterOwnership?.rendererGlobalControlIds?.includes('volume-smoke'), 'smoke was not marked renderer-global');
      assert.ok(volumeAuthoring?.parameterOwnership?.rendererGlobalControlIds?.includes('volume-steps'), 'ray steps were not marked renderer-global');
      const expectedSelectedPrimitiveId = expectedThirdSmokeTransformProbe ? expectedThirdSmokePrimitiveId
        : expectedSourceTypeProbe ? expectedFireSmokeSourcePrimitiveId
        : expectedMultiPrimitiveProbe ? expectedSecondPrimitiveId : expectedPrimitiveId;
      assert.equal(volumeAuthoring?.selectedVolumePrimitiveId, expectedSelectedPrimitiveId, 'authored primitive selection was not retained');
      assert.equal(volumeAuthoring?.transformTargetPrimitiveId, expectedSelectedPrimitiveId, 'authored primitive transform target was not retained');
      assert.equal(volumeAuthoring?.transformTargetIdentity, 'volume-primitive-transform-target-v0', 'authored primitive transform target identity was not retained');
      assert.ok(volumeAuthoring?.markerIds?.includes(expectedPrimitiveId), 'authored primitive marker id was not retained');
      assert.equal(volumeAuthoring?.markerAffordance, 'volume-primitive-marker-wire-halo-v0', 'authored primitive marker did not preserve wire/halo affordance');
      assert.equal(volumeAuthoring?.markerSemantic, 'volume-primitive-source-handle-not-raymarch-bounds-v0', 'authored primitive marker did not preserve source-handle semantics');
      assert.ok((volumeAuthoring?.markerOpacity ?? 1) <= 0.2, 'authored primitive marker opacity became too visually dominant');
      assert.equal(volumeAuthoring?.solidMarkerCount, 0, 'authored primitive marker became a solid filled body');
      assert.equal(primitive?.couplingSource, 'manual', 'authored primitive did not preserve manual coupling source');
      assertVectorClose(primitive?.transform?.position, expectedAuthoredEffectivePosition, 'renderer authored primitive transform position');
      assertVectorClose(authoredPrimitive?.transform?.position, expectedAuthoredEffectivePosition, 'authoring authored primitive transform position');
      if (expectedSceneBoundsProbe) {
        assert.equal(volumeAuthoring?.movementBoundsIdentity, 'volume-primitive-shared-scene-bounds-v0', 'authored primitive movement did not use shared scene bounds');
        assert.equal(volumeAuthoring?.markerUnderFloorVisibilityMode, 'volume-primitive-wire-visible-through-floor-v0', 'below-floor primitive marker did not stay in wire overlay mode');
        assert.equal(volumeAuthoring?.selectedMarkerBelowGround, true, 'scene-bounds probe did not move the selected marker below the ground disc');
        assert.equal(volumeAuthoring?.selectedMarkerDepthTest, false, 'below-floor wire marker should not be hidden by the ground depth buffer');
      }
      if (expectedSceneSourceProbe) {
        assertVectorClose(state.primitiveSource?.scenePosition, expectedAuthoredEffectivePosition, 'primary primitive source scene position');
        assertVectorClose(state.primitiveSource?.nativeSourcePosition, expectedAuthoredNativeSourcePosition, 'primary primitive native source position');
        assertVectorClose(state.primitiveSource?.position, expectedAuthoredEffectivePosition, 'primary primitive shader source position');
        assert.equal(state.primitiveSource?.sourceMappingIdentity, expectedSourceMappingIdentity, 'primitive source did not publish the scene-to-native source mapping identity');
      }
      if (expectedMultiPrimitiveProbe) {
        assert.equal(state.volumePrimitiveCount, 2, 'renderer did not retain two authored volume primitives');
        assert.equal(state.primitiveSourceCount, 2, 'renderer did not publish two effective primitive sources');
        assert.ok(state.volumePrimitiveIds?.includes(expectedSecondPrimitiveId), 'renderer primitive ids did not include the second authored primitive');
        assert.ok(Array.isArray(state.primitiveSources), 'renderer did not expose primitive source records');
        const firstSource = state.primitiveSources.find(source => source.id === expectedAuthoredPrimitiveId);
        const secondSource = state.primitiveSources.find(source => source.id === expectedSecondPrimitiveId);
        assertVectorClose(firstSource?.position, expectedAuthoredEffectivePosition, 'first effective primitive source position');
        assertVectorClose(firstSource?.nativeSourcePosition, expectedAuthoredNativeSourcePosition, 'first native primitive source position');
        assertVectorClose(secondSource?.position, expectedSecondPrimitivePosition, 'second effective primitive source position');
        assertVectorClose(secondSource?.nativeSourcePosition, expectedSecondPrimitiveNativeSourcePosition, 'second native primitive source position');
        assert.equal(firstSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'first source did not preserve primitive-centered mode');
        assert.equal(secondSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'second source did not preserve primitive-centered mode');
        assert.equal(secondPrimitive?.couplingSource, 'manual', 'second authored primitive did not preserve manual coupling source');
      }
      if (expectedThirdSmokeTransformProbe) {
        assert.equal(state.volumePrimitiveCount, 3, 'renderer did not retain three authored volume primitives');
        assert.equal(state.primitiveSourceCount, 3, 'renderer did not publish three effective primitive sources for the third-smoke probe');
        assert.ok(state.volumePrimitiveIds?.includes(expectedSmokePrimitiveId), 'renderer primitive ids did not include the first Smoke primitive');
        assert.ok(state.volumePrimitiveIds?.includes(expectedThirdSmokePrimitiveId), 'renderer primitive ids did not include the second Smoke primitive');
        assert.ok(volumeAuthoring?.markerIds?.includes(expectedThirdSmokePrimitiveId), 'authoring marker ids did not include the selected second Smoke primitive');
        const firstSmokePrimitive = state.volumePrimitives?.find(item => item.id === expectedSmokePrimitiveId);
        const thirdSmokePrimitive = state.volumePrimitives?.find(item => item.id === expectedThirdSmokePrimitiveId);
        const firstSmokeSource = state.primitiveSources?.find(source => source.id === expectedSmokePrimitiveId);
        const thirdSmokeSource = state.primitiveSources?.find(source => source.id === expectedThirdSmokePrimitiveId);
        const thirdAuthoredPrimitive = volumeAuthoring?.volumePrimitives?.find(item => item.id === expectedThirdSmokePrimitiveId);
        const firstSmokeMarkerState = volumeAuthoring?.markerStates?.find(item => item.id === expectedSmokePrimitiveId);
        const thirdSmokeMarkerState = volumeAuthoring?.markerStates?.find(item => item.id === expectedThirdSmokePrimitiveId);
        assert.equal(firstSmokePrimitive?.sourceType, 'smoke', 'first duplicate Smoke primitive did not preserve source type');
        assert.equal(thirdSmokePrimitive?.sourceType, 'smoke', 'selected duplicate Smoke primitive did not preserve source type');
        assertVectorClose(thirdSmokePrimitive?.transform?.position, expectedThirdSmokePrimitivePosition, 'third Smoke renderer primitive transform position');
        assertVectorClose(thirdAuthoredPrimitive?.transform?.position, expectedThirdSmokePrimitivePosition, 'third Smoke authoring primitive transform position');
        assertVectorClose(thirdSmokeSource?.position, expectedThirdSmokePrimitivePosition, 'third Smoke effective source position');
        assertVectorClose(thirdSmokeSource?.nativeSourcePosition, expectedThirdSmokePrimitiveNativeSourcePosition, 'third Smoke native source position');
        assert.equal(firstSmokeSource?.fireSourceMix, 0, 'first duplicate Smoke source carried fire mix');
        assert.equal(thirdSmokeSource?.fireSourceMix, 0, 'selected duplicate Smoke source carried fire mix');
        assert.ok((firstSmokeSource?.smokeSourceMix ?? 0) > 0.9, 'first duplicate Smoke source did not carry smoke mix');
        assert.ok((thirdSmokeSource?.smokeSourceMix ?? 0) > 0.9, 'selected duplicate Smoke source did not carry smoke mix');
        assert.equal(firstSmokeSource?.fireGain, 0, 'first duplicate Smoke source carried primitive-local fire gain');
        assert.equal(thirdSmokeSource?.fireGain, 0, 'selected duplicate Smoke source carried primitive-local fire gain');
        assert.ok((thirdSmokeSource?.smokeGain ?? 0) > 0.9, 'selected duplicate Smoke source did not carry primitive-local smoke gain');
        assert.ok(Math.abs((thirdAuthoredPrimitive?.authoring?.handleOpacity ?? 0) - 0.09) < 0.001, 'third Smoke primitive handle opacity did not persist locally');
        assert.ok(Math.abs((thirdSmokeMarkerState?.handleOpacity ?? 0) - 0.09) < 0.001, 'third Smoke marker did not use its own local handle opacity');
        assert.notEqual(firstSmokeMarkerState?.handleOpacity, thirdSmokeMarkerState?.handleOpacity, 'duplicate Smoke marker opacity remained global instead of per primitive');
      }
      if (expectedSourceTypeProbe) {
        assert.equal(state.volumePrimitiveCount, 3, 'source type probe did not retain three authored volume primitives');
        assert.equal(state.primitiveSourceCount, 3, 'renderer did not publish three source-typed primitive sources');
        const firePrimitive = state.volumePrimitives?.find(item => item.id === expectedAuthoredPrimitiveId);
        const smokePrimitive = state.volumePrimitives?.find(item => item.id === expectedSmokePrimitiveId);
        const fireSmokePrimitive = state.volumePrimitives?.find(item => item.id === expectedFireSmokeSourcePrimitiveId);
        const fireSource = state.primitiveSources?.find(source => source.id === expectedAuthoredPrimitiveId);
        const smokeSource = state.primitiveSources?.find(source => source.id === expectedSmokePrimitiveId);
        const fireSmokeSource = state.primitiveSources?.find(source => source.id === expectedFireSmokeSourcePrimitiveId);
        assert.equal(firePrimitive?.sourceType, 'fire', 'Fire primitive did not preserve source type');
        assert.equal(smokePrimitive?.sourceType, 'smoke', 'Smoke primitive did not preserve source type');
        assert.equal(fireSmokePrimitive?.sourceType, 'fire_smoke', 'Fire+Smoke primitive did not preserve source type');
        assert.equal(fireSource?.sourceTaxonomyIdentity, 'volume-source-type-taxonomy-v0', 'Fire source did not publish taxonomy identity');
        assert.equal(smokeSource?.sourceTaxonomyIdentity, 'volume-source-type-taxonomy-v0', 'Smoke source did not publish taxonomy identity');
        assert.equal(fireSmokeSource?.sourceTaxonomyIdentity, 'volume-source-type-taxonomy-v0', 'Fire+Smoke source did not publish taxonomy identity');
        assert.ok((fireSource?.fireSourceMix ?? 0) > 0.9, 'Fire source did not carry fire mix');
        assert.equal(fireSource?.smokeSourceMix, 0, 'Fire source carried direct smoke mix');
        assert.equal(smokeSource?.fireSourceMix, 0, 'Smoke source carried fire mix');
        assert.ok((smokeSource?.smokeSourceMix ?? 0) > 0.9, 'Smoke source did not carry smoke mix');
        assert.ok((fireSmokeSource?.fireSourceMix ?? 0) > 0.9, 'Fire+Smoke source did not carry fire mix');
        assert.ok((fireSmokeSource?.smokeSourceMix ?? 0) > 0.9, 'Fire+Smoke source did not carry smoke mix');
      }
      if (expectedSingleSourceTypeProbe) {
        assert.equal(state.volumePrimitiveCount, 1, 'single source type probe did not retain exactly one authored primitive');
        assert.equal(state.primitiveSourceCount, 1, 'single source type probe did not publish exactly one primitive source');
        assert.equal(primitive?.sourceType, requestedSourceTypeProbe, 'single source primitive did not preserve requested source type');
        assert.equal(state.primitiveSource?.sourceType, requestedSourceTypeProbe, 'single source record did not publish requested source type');
        assert.equal(state.primitiveSource?.sourceTaxonomyIdentity, 'volume-source-type-taxonomy-v0', 'single source did not publish taxonomy identity');
        assert.ok(Math.abs((state.primitiveSource?.densityGain ?? 0) - 1) < 0.001, 'single source did not publish primitive-local density gain');
        if (expectedSmokeOnlySourceProbe) {
          assert.equal(state.primitiveSource?.fireSourceMix, 0, 'Smoke-only source carried fire source mix');
          assert.ok((state.primitiveSource?.smokeSourceMix ?? 0) > 0.9, 'Smoke-only source did not carry smoke source mix');
          assert.equal(state.primitiveSource?.fireGain, 0, 'Smoke-only source carried primitive-local fire gain');
          assert.ok((state.primitiveSource?.smokeGain ?? 0) > 0.9, 'Smoke-only source did not carry primitive-local smoke gain');
        }
        if (expectedFireOnlySourceProbe) {
          assert.ok((state.primitiveSource?.fireSourceMix ?? 0) > 0.9, 'Fire-only source did not carry fire source mix');
          assert.equal(state.primitiveSource?.smokeSourceMix, 0, 'Fire-only source carried direct smoke source mix');
          assert.ok((state.primitiveSource?.fireGain ?? 0) > 0.9, 'Fire-only source did not carry primitive-local fire gain');
          assert.equal(state.primitiveSource?.smokeGain, 0, 'Fire-only source carried primitive-local smoke gain');
        }
      }
      if (expectedSmokeMoveChannelProbe) {
        assert.equal(state.volumePrimitiveCount, 1, 'smoke move channel probe did not retain exactly one authored primitive');
        assert.equal(state.primitiveSourceCount, 1, 'smoke move channel probe did not publish exactly one primitive source');
        assert.equal(primitive?.sourceType, 'smoke', 'smoke move primitive did not preserve Smoke source type');
        assert.equal(state.primitiveSource?.sourceType, 'smoke', 'smoke move source record did not publish Smoke source type');
        assertVectorClose(primitive?.transform?.position, expectedSmokeMovePrimitivePosition, 'smoke move primitive final transform position');
        assertVectorClose(state.primitiveSource?.position, expectedSmokeMovePrimitivePosition, 'smoke move effective source final position');
        assertVectorClose(state.primitiveSource?.nativeSourcePosition, expectedSmokeMovePrimitiveNativeSourcePosition, 'smoke move native source final position');
        assert.equal(state.primitiveSource?.fireSourceMix, 0, 'smoke move source carried fire source mix');
        assert.equal(state.primitiveSource?.fireGain, 0, 'smoke move source carried primitive-local fire gain');
        assert.ok((state.primitiveSource?.smokeSourceMix ?? 0) > 0.9, 'smoke move source did not carry smoke source mix');
        assert.ok((state.primitiveSource?.smokeGain ?? 0) > 0.9, 'smoke move source did not carry primitive-local smoke gain');
      }
      if (expectedSaveLoadProbe) {
        assert.equal(saveLoadRoundTrip?.volumeAuthoring?.selectedVolumePrimitiveId, expectedAuthoredPrimitiveId, 'save/load round-trip selection evidence missing from report');
        assert.equal(saveLoadRoundTrip?.volumeState?.primitiveSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'save/load round-trip did not restore primitive-centered body mode');
      }
      assert.equal(primitive?.volumeBodyMode, 'primitive-centered-sphere-volume-v0', 'authored primitive did not request a primitive-centered volume body');
      assert.equal(state.primitiveSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'fluid renderer did not use the primitive-centered body mode');
      assert.equal(state.primitiveSource?.primitiveCenteredBody, true, 'fluid renderer did not enable primitive-centered source shaping');
      const expectedAuthoringTool = expectedSmokeMoveChannelProbe ? 'volume-add-smoke'
        : expectedSingleSourceTypeProbe ? `volume-add-${requestedSourceTypeProbe.replace('_', '-')}`
        : expectedSourceTypeProbe ? 'volume-add-fire' : 'volume-add-fire-smoke';
      assert.equal(primitive?.coupling?.authoringTool, expectedAuthoringTool, 'authored primitive did not preserve authoring tool identity');
      assert.ok(Math.abs((primitive?.simulation?.sourceRadius ?? 0) - 0.18) < 0.001, 'authored primitive radius setting was not applied');
      assert.ok(Math.abs((primitive?.simulation?.flowRate ?? 0) - 0.35) < 0.001, 'authored primitive flow setting was not applied');
      assert.ok(Math.abs((primitive?.channels?.density ?? 0) - 1) < 0.001, 'authored primitive density gain setting was not applied');
      const expectedPrimitiveRadiance = expectedSmokeOnlyChannelProbe ? 0.35 : 2.1;
      assert.ok(Math.abs((authoredPrimitive?.render?.radiance ?? 0) - expectedPrimitiveRadiance) < 0.001, 'authored primitive radiance setting was not applied');
      assert.equal(authoredPrimitive?.authoring?.settingsIdentity, 'volume-primitive-local-settings-v0', 'authored primitive did not preserve local settings identity');
      assert.ok(Math.abs((authoredPrimitive?.authoring?.handleOpacity ?? 0) - 0.12) < 0.001, 'authored primitive handle opacity did not persist locally');
      assert.equal(authoredPrimitive?.authoring?.handleVisible, true, 'authored primitive handle visibility did not persist locally');
      const firstMarkerState = volumeAuthoring?.markerStates?.find(item => item.id === expectedPrimitiveId);
      assert.ok(Math.abs((firstMarkerState?.handleOpacity ?? 0) - 0.12) < 0.001, 'first marker did not use its own local handle opacity');
      assert.equal(firstMarkerState?.handleVisible, true, 'first marker did not use its own local handle visibility');
      assert.equal(state.simulationCostModel?.identity, 'shared-volume-simulation-cost-v0', 'volume state did not publish shared simulation cost model');
      assert.equal(state.simulationCostModel?.fullSimulationPasses, 1, 'volume state claimed more than one full simulation pass');
      assert.equal(state.simulationCostModel?.fullRaymarchPasses, 1, 'volume state claimed more than one full raymarch pass');
      if (expectedMultiPrimitiveProbe) {
        const secondAuthoredPrimitive = volumeAuthoring?.volumePrimitives?.find(item => item.id === expectedSecondPrimitiveId);
        const secondMarkerState = volumeAuthoring?.markerStates?.find(item => item.id === expectedSecondPrimitiveId);
        assert.equal(secondAuthoredPrimitive?.authoring?.settingsIdentity, 'volume-primitive-local-settings-v0', 'second primitive did not preserve local settings identity');
        assert.ok(Math.abs((secondAuthoredPrimitive?.authoring?.handleOpacity ?? 0) - 0.05) < 0.001, 'second primitive handle opacity did not persist locally');
        assert.ok(Math.abs((secondMarkerState?.handleOpacity ?? 0) - 0.05) < 0.001, 'second marker did not use its own local handle opacity');
        assert.notEqual(firstMarkerState?.handleOpacity, secondMarkerState?.handleOpacity, 'marker opacity remained global instead of per primitive');
      }
    }
    if (!expectedSceneBoundsOnlyProbe) {
      for (let i = 0; i < 40 && (state?.simStepCount ?? 0) <= 5; i += 1) {
        await delay(150);
        const simAdvanceEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosVolumePrototype?.debugState?.()',
          returnByValue: true,
        });
        state = simAdvanceEval.result.value || state;
      }
      assert.ok(state.simStepCount > 5, 'fluid sim did not advance enough compute steps');
    }

    phase = 'gpu-readback';
    const sampleEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: 'window.__kaminosVolumePrototype.sampleFrame()',
      awaitPromise: true,
      returnByValue: true,
    });
    const sample = sampleEval.result.value;
    if (sample?.ok !== true) {
      throw new Error(`GPU frame readback failed: ${JSON.stringify(sample)}`);
    }
    if (!sample.simReadback || sample.simReadback.grid !== expectedGrid) {
      throw new Error(`GPU sim readback missing expected grid identity: ${JSON.stringify(sample.simReadback)}`);
    }
    writeRgbaPng(out, sample.preview.width, sample.preview.height, sample.preview.rgba);
    const captureBackend = 'webgpu-copy-src-readback';
    const primitiveCenteredLiveVelocityThreshold = state.primitiveSource?.bodyMode === 'primitive-centered-sphere-volume-v0'
      ? (expectedSceneSourceProbe ? 0.00002 : 0.00005)
      : 0.001;
    const materialDetailReadbackThreshold = expectedSceneSourceProbe ? 0.00025 : 0.0005;
    const extinctionReadbackThreshold = expectedSceneSourceProbe ? 0.00025 : 0.0005;
    const microdetailReadbackThreshold = expectedSceneSourceProbe ? 0.00025 : 0.0005;
    const interfaceShredReadbackThreshold = expectedSceneSourceProbe ? 0.00018 : 0.00025;
    const fireLickReadbackThreshold = expectedSceneSourceProbe ? 0.0001 : 0.00025;
    if (!expectedSceneBoundsProbe) {
      if (sample.simReadback.densityMax <= 0.01 || sample.simReadback.velocityMean <= primitiveCenteredLiveVelocityThreshold || sample.simReadback.liveVoxels < 8) {
        throw new Error(`GPU sim readback does not show live fluid state: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.detailMean) || sample.simReadback.detailMean <= materialDetailReadbackThreshold) {
        throw new Error(`GPU sim readback does not show transported material detail: ${JSON.stringify(sample.simReadback)}`);
      }
      if (expectedSmokeOnlyChannelProbe) {
        if ((sample.simReadback.fireLayerMean ?? 1) > 0.00018 || (sample.simReadback.radianceMean ?? 1) > 0.0008) {
          throw new Error(`Smoke-only source leaked fire/radiance transport: ${JSON.stringify(sample.simReadback)}`);
        }
      } else {
        if (!Number.isFinite(sample.simReadback.fireLayerMean) || sample.simReadback.fireLayerMean <= 0.0005) {
          throw new Error(`GPU sim readback does not show a transported fire layer: ${JSON.stringify(sample.simReadback)}`);
        }
        if (!Number.isFinite(sample.simReadback.radianceMean) || sample.simReadback.radianceMean <= 0.0005) {
          throw new Error(`GPU sim readback does not show fire radiance evidence: ${JSON.stringify(sample.simReadback)}`);
        }
      }
      if (!Number.isFinite(sample.simReadback.extinctionMean) || sample.simReadback.extinctionMean <= extinctionReadbackThreshold) {
        throw new Error(`GPU sim readback does not show smoke extinction evidence: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.microdetailMean) || sample.simReadback.microdetailMean <= microdetailReadbackThreshold) {
        throw new Error(`GPU sim readback does not show transported microdetail: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.interfaceShredMean) || sample.simReadback.interfaceShredMean <= (expectedSmokeOnlyChannelProbe ? 0.00008 : interfaceShredReadbackThreshold)) {
        throw new Error(`GPU sim readback does not show interface shredding: ${JSON.stringify(sample.simReadback)}`);
      }
      if (expectedSmokeOnlyChannelProbe) {
        if ((sample.simReadback.fireLickMean ?? 1) > 0.00012) {
          throw new Error(`Smoke-only source leaked fire-lick transport: ${JSON.stringify(sample.simReadback)}`);
        }
      } else if (!Number.isFinite(sample.simReadback.fireLickMean) || sample.simReadback.fireLickMean <= fireLickReadbackThreshold) {
        throw new Error(`GPU sim readback does not show fire-lick breakup: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.curlMean) || sample.simReadback.curlMax <= 0.0005) {
        throw new Error(`GPU sim readback does not show curl/vorticity evidence: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.divergenceMean) || !Number.isFinite(sample.simReadback.divergenceMax)) {
        throw new Error(`GPU sim readback does not show divergence/projection evidence: ${JSON.stringify(sample.simReadback)}`);
      }
    }
    const metrics = {
      width: sample.width,
      height: sample.height,
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
      fireLikePixels: sample.fireLikePixels,
      emissiveLikePixels: sample.emissiveLikePixels,
      warmEmissivePixels: sample.warmEmissivePixels,
      smokeLikePixels: sample.smokeLikePixels,
    };
    if (expectedSmokeOnlyChannelProbe) {
      if (metrics.litPixels < 1500 || metrics.smokeLikePixels < 800 || metrics.fireLikePixels > 160 || metrics.emissiveLikePixels > 120) {
        throw new Error(`smoke-only source visual leaked fire or lost smoke body: ${JSON.stringify(metrics)}`);
      }
    } else if (!expectedSceneBoundsOnlyProbe && (metrics.litPixels < 1500 || metrics.fireLikePixels < 300 || metrics.emissiveLikePixels < 80 || metrics.meanLuma < 8)) {
      throw new Error(`blank frame or missing fire volume: ${JSON.stringify(metrics)}`);
    }
    const mainRendererScreenshot = out.replace(/\.png$/i, '.main-renderer.png');
    const mainRendererMetrics = await captureMainRendererScreenshot(ws, mainRendererScreenshot);
    const primitiveCenteredBodyVisual = state.primitiveSource?.bodyMode === 'primitive-centered-sphere-volume-v0';
    const missingMainRendererVolume = expectedSmokeOnlyChannelProbe
      ? mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.smokeLikePixels < 800 || mainRendererMetrics.fireLikePixels > 500
      : primitiveCenteredBodyVisual
      ? mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.warmEmissivePixels < 500 || mainRendererMetrics.meanLuma < 8
      : mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.fireLikePixels < 80 || mainRendererMetrics.meanLuma < 8;
    if (!expectedSceneBoundsOnlyProbe && missingMainRendererVolume) {
      throw new Error(`main renderer screenshot missing expected source-typed volume: ${JSON.stringify(mainRendererMetrics)}`);
    }
    const report = {
      requestedRoute: url,
      settleMs,
      effectiveRoute: state.effectiveRoute,
      prototypeIdentity: state.prototypeIdentity,
      volumeBridge: bridge,
      textureMirror: state.textureMirror,
      backend: state.backend,
      captureBackend,
      frameCount: state.frameCount,
      simStepCount: sample.simStepCount,
      simGrid: sample.simGrid,
      simGridLabel: sample.simGridLabel,
      simReadback: sample.simReadback,
      gridOverlay: sample.gridOverlay,
      raySteps: state.controls?.raySteps,
      adaptiveRaymarch: sample.adaptiveRaymarch,
      volumePrimitiveCount: state.volumePrimitiveCount,
      volumePrimitiveIds: state.volumePrimitiveIds,
      volumePrimitives: state.volumePrimitives,
      primitiveSource: state.primitiveSource,
      primitiveSources: state.primitiveSources,
      volumeAuthoring,
      parameterOwnership: volumeAuthoring?.parameterOwnership || null,
      sourceTypeTaxonomy: volumeAuthoring?.sourceTypeTaxonomy || null,
      contextActionProbe,
      smokeMoveChannelSamples,
      saveLoadRoundTrip,
      controls: state.controls,
      screenshot: out,
      metrics,
      mainRendererScreenshot,
      mainRendererCaptureBackend: 'cdp-page-capture',
      mainRendererMetrics,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    let state = null;
    let failureMainRendererScreenshot = null;
    let failureMainRendererMetrics = null;
    try {
      const targets = await cdpFetch('/json/list');
      const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await waitForWebSocketOpen(ws);
        const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosVolumePrototype?.debugState?.()',
          returnByValue: true,
        });
        state = stateEval.result.value || null;
        failureMainRendererScreenshot = out.replace(/\.png$/i, '.failure-main-renderer.png');
        failureMainRendererMetrics = await captureMainRendererScreenshot(ws, failureMainRendererScreenshot);
        ws.close();
      }
    } catch {
      state = null;
    }
    const report = {
      requestedRoute: url,
      phase,
      error: err?.message || String(err),
      state,
      screenshot: out,
      failureMainRendererScreenshot,
      failureMainRendererMetrics,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exit(1);
  }
}

main();
