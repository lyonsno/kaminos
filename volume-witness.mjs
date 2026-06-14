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
const expectedSceneBoundsProbe = routeParams.get('volume_scene_bounds_probe') === '1';
const expectedSceneSourceProbe = routeParams.get('volume_scene_source_probe') === '1';
const expectedScenePlacementProbe = expectedSceneBoundsProbe || expectedSceneSourceProbe;
const expectedSceneBoundsOnlyProbe = expectedSceneBoundsProbe && !expectedSceneSourceProbe;
const expectedAuthoredPrimitiveId = 'authored-fire-smoke-witness';
const expectedSecondPrimitiveId = 'authored-fire-smoke-witness-b';
const expectedAuthoredMovedPosition = [0.32, -0.52, 0.18];
const expectedAuthoredSceneBoundsPosition = [0.62, -0.9, 0.0];
const expectedAuthoredEffectivePosition = expectedScenePlacementProbe ? expectedAuthoredSceneBoundsPosition : expectedAuthoredMovedPosition;
const expectedAuthoredNativeSourcePosition = expectedSceneSourceProbe ? [0.62, -0.58, 0.0] : expectedAuthoredEffectivePosition;
const expectedSourceMappingIdentity = 'volume-primitive-scene-to-native-source-clamp-v0';
const expectedSecondPrimitivePosition = [-0.24, -0.52, -0.18];
const expectedPrimitiveId = expectedLamellarHookFixture
  ? 'fixture-lamellar-hook-selected'
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
    if (expectedAuthoringProbe) {
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
          const primitive = authoring.placeAt([0.24, -0.58, 0.12], {
            id: '${expectedAuthoredPrimitiveId}',
            radius: 0.18,
            flowRate: 0.35,
            radiance: 2.1,
          });
          authoring.select('${expectedAuthoredPrimitiveId}');
          authoring.updateSelected({ radius: 0.18, flowRate: 0.35, radiance: 2.1 });
          const moved = authoring.moveSelectedTo([${expectedAuthoredEffectivePosition.join(', ')}]);
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
            authoring.updateSelected({ radius: 0.16, flowRate: 0.32, radiance: 1.9 });
          }
          const roundTrip = ${expectedSaveLoadProbe
            ? "await window.__kaminosScenePersistence.saveLoadRoundTrip(null)"
            : "null"};
          return { ok: true, primitive: moved || primitive, state: authoring.debugState(), roundTrip };
        })()`,
        returnByValue: true,
        awaitPromise: true,
      });
      const authoringProbe = authoringEval.result.value;
      assert.equal(authoringProbe?.ok, true, 'authored volume primitive probe did not run');
      volumeAuthoring = authoringProbe.state;
      saveLoadRoundTrip = authoringProbe.roundTrip || null;
      const expectedProbeSelection = expectedMultiPrimitiveProbe ? expectedSecondPrimitiveId : expectedAuthoredPrimitiveId;
      assert.equal(volumeAuthoring?.selectedVolumePrimitiveId, expectedProbeSelection, 'authored volume primitive was not selected');
      assert.equal(volumeAuthoring?.transformTargetPrimitiveId, expectedProbeSelection, 'authored volume primitive did not attach to the transform target');
      assert.equal(volumeAuthoring?.transformTargetIdentity, 'volume-primitive-transform-target-v0', 'authored volume primitive target identity regressed');
      assert.ok(volumeAuthoring?.markerIds?.includes(expectedAuthoredPrimitiveId), 'authored volume primitive marker was not created');
      assert.equal(volumeAuthoring?.markerAffordance, 'volume-primitive-marker-wire-halo-v0', 'authored volume primitive marker regressed to a solid affordance');
      assert.equal(volumeAuthoring?.markerSemantic, 'volume-primitive-source-handle-not-raymarch-bounds-v0', 'authored volume primitive marker must not claim full raymarch bounds');
      assert.ok((volumeAuthoring?.markerOpacity ?? 1) <= 0.2, 'authored volume primitive marker opacity is too visually dominant');
      assert.equal(volumeAuthoring?.solidMarkerCount, 0, 'authored volume primitive marker must not be a solid filled body');
      if (expectedMultiPrimitiveProbe) {
        assert.equal(volumeAuthoring?.volumePrimitiveCount, 2, 'multi-primitive probe did not create two authored primitives');
        assert.ok(volumeAuthoring?.volumePrimitiveIds?.includes(expectedSecondPrimitiveId), 'second authored primitive marker was not created');
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
        assertVectorClose(saveLoadRoundTrip?.volumeState?.primitiveSource?.position, expectedAuthoredNativeSourcePosition, 'round-tripped primitive source position');
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
    if (expectedPrimitiveFixture || expectedAuthoringProbe) {
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
    if (expectedAuthoringProbe) {
      const authoringStateEval = await wsRequest(ws, 'Runtime.evaluate', {
        expression: 'window.__kaminosVolumeAuthoring?.debugState?.()',
        returnByValue: true,
      });
      volumeAuthoring = authoringStateEval.result.value;
      const primitive = state.volumePrimitives?.find(item => item.id === expectedAuthoredPrimitiveId);
      const authoredPrimitive = volumeAuthoring?.volumePrimitives?.find(item => item.id === expectedAuthoredPrimitiveId);
      const secondPrimitive = state.volumePrimitives?.find(item => item.id === expectedSecondPrimitiveId);
      assert.equal(volumeAuthoring?.identity, 'volume-authoring-loop-v0', 'wrong volume authoring identity');
      const expectedSelectedPrimitiveId = expectedMultiPrimitiveProbe ? expectedSecondPrimitiveId : expectedAuthoredPrimitiveId;
      assert.equal(volumeAuthoring?.selectedVolumePrimitiveId, expectedSelectedPrimitiveId, 'authored primitive selection was not retained');
      assert.equal(volumeAuthoring?.transformTargetPrimitiveId, expectedSelectedPrimitiveId, 'authored primitive transform target was not retained');
      assert.equal(volumeAuthoring?.transformTargetIdentity, 'volume-primitive-transform-target-v0', 'authored primitive transform target identity was not retained');
      assert.ok(volumeAuthoring?.markerIds?.includes(expectedAuthoredPrimitiveId), 'authored primitive marker id was not retained');
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
        assertVectorClose(state.primitiveSource?.position, expectedAuthoredNativeSourcePosition, 'primary primitive shader source position');
        assert.equal(state.primitiveSource?.sourceMappingIdentity, expectedSourceMappingIdentity, 'primitive source did not publish the scene-to-native source mapping identity');
      }
      if (expectedMultiPrimitiveProbe) {
        assert.equal(state.volumePrimitiveCount, 2, 'renderer did not retain two authored volume primitives');
        assert.equal(state.primitiveSourceCount, 2, 'renderer did not publish two effective primitive sources');
        assert.ok(state.volumePrimitiveIds?.includes(expectedSecondPrimitiveId), 'renderer primitive ids did not include the second authored primitive');
        assert.ok(Array.isArray(state.primitiveSources), 'renderer did not expose primitive source records');
        const firstSource = state.primitiveSources.find(source => source.id === expectedAuthoredPrimitiveId);
        const secondSource = state.primitiveSources.find(source => source.id === expectedSecondPrimitiveId);
        assertVectorClose(firstSource?.position, expectedAuthoredNativeSourcePosition, 'first effective primitive source position');
        assertVectorClose(secondSource?.position, expectedSecondPrimitivePosition, 'second effective primitive source position');
        assert.equal(firstSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'first source did not preserve primitive-centered mode');
        assert.equal(secondSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'second source did not preserve primitive-centered mode');
        assert.equal(secondPrimitive?.couplingSource, 'manual', 'second authored primitive did not preserve manual coupling source');
      }
      if (expectedSaveLoadProbe) {
        assert.equal(saveLoadRoundTrip?.volumeAuthoring?.selectedVolumePrimitiveId, expectedAuthoredPrimitiveId, 'save/load round-trip selection evidence missing from report');
        assert.equal(saveLoadRoundTrip?.volumeState?.primitiveSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'save/load round-trip did not restore primitive-centered body mode');
      }
      assert.equal(primitive?.volumeBodyMode, 'primitive-centered-sphere-volume-v0', 'authored primitive did not request a primitive-centered volume body');
      assert.equal(state.primitiveSource?.bodyMode, 'primitive-centered-sphere-volume-v0', 'fluid renderer did not use the primitive-centered body mode');
      assert.equal(state.primitiveSource?.primitiveCenteredBody, true, 'fluid renderer did not enable primitive-centered source shaping');
      assert.equal(primitive?.coupling?.authoringTool, 'volume-add-fire-smoke', 'authored primitive did not preserve authoring tool identity');
      assert.ok(Math.abs((primitive?.simulation?.sourceRadius ?? 0) - 0.18) < 0.001, 'authored primitive radius setting was not applied');
      assert.ok(Math.abs((primitive?.simulation?.flowRate ?? 0) - 0.35) < 0.001, 'authored primitive flow setting was not applied');
      assert.ok(Math.abs((authoredPrimitive?.render?.radiance ?? 0) - 2.1) < 0.001, 'authored primitive radiance setting was not applied');
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
      ? 0.00005
      : 0.001;
    if (!expectedSceneBoundsProbe) {
      if (sample.simReadback.densityMax <= 0.01 || sample.simReadback.velocityMean <= primitiveCenteredLiveVelocityThreshold || sample.simReadback.liveVoxels < 8) {
        throw new Error(`GPU sim readback does not show live fluid state: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.detailMean) || sample.simReadback.detailMean <= 0.0005) {
        throw new Error(`GPU sim readback does not show transported material detail: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.fireLayerMean) || sample.simReadback.fireLayerMean <= 0.0005) {
        throw new Error(`GPU sim readback does not show a transported fire layer: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.radianceMean) || sample.simReadback.radianceMean <= 0.0005) {
        throw new Error(`GPU sim readback does not show fire radiance evidence: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.extinctionMean) || sample.simReadback.extinctionMean <= 0.0005) {
        throw new Error(`GPU sim readback does not show smoke extinction evidence: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.microdetailMean) || sample.simReadback.microdetailMean <= 0.0005) {
        throw new Error(`GPU sim readback does not show transported microdetail: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.interfaceShredMean) || sample.simReadback.interfaceShredMean <= 0.00025) {
        throw new Error(`GPU sim readback does not show interface shredding: ${JSON.stringify(sample.simReadback)}`);
      }
      if (!Number.isFinite(sample.simReadback.fireLickMean) || sample.simReadback.fireLickMean <= 0.00025) {
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
    if (!expectedSceneBoundsOnlyProbe && (metrics.litPixels < 1500 || metrics.fireLikePixels < 300 || metrics.emissiveLikePixels < 80 || metrics.meanLuma < 8)) {
      throw new Error(`blank frame or missing fire volume: ${JSON.stringify(metrics)}`);
    }
    const mainRendererScreenshot = out.replace(/\.png$/i, '.main-renderer.png');
    const mainRendererMetrics = await captureMainRendererScreenshot(ws, mainRendererScreenshot);
    const primitiveCenteredBodyVisual = state.primitiveSource?.bodyMode === 'primitive-centered-sphere-volume-v0';
    const missingMainRendererVolume = primitiveCenteredBodyVisual
      ? mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.warmEmissivePixels < 500 || mainRendererMetrics.meanLuma < 8
      : mainRendererMetrics.litPixels < 1500 || mainRendererMetrics.fireLikePixels < 80 || mainRendererMetrics.meanLuma < 8;
    if (!expectedSceneBoundsOnlyProbe && missingMainRendererVolume) {
      throw new Error(`main renderer screenshot missing bridged fire volume: ${JSON.stringify(mainRendererMetrics)}`);
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
      volumeAuthoring,
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
