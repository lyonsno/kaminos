#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);

const url = args.get('--url') || 'http://127.0.0.1:8137/?kaminos_volume_smoke=1&volume_fire_render_mode=shell';
const out = resolve(args.get('--out') || '/tmp/kaminos-volume-shell-lab.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const expectedMode = (args.get('--expected-mode') || new URL(url).searchParams.get('volume_fire_render_mode') || 'shell').replace(/-/g, '_');
const expectedInspect = (args.get('--expected-inspect') || new URL(url).searchParams.get('volume_shell_inspect') || 'shell').replace(/-/g, '_');
function normalizeDomainInspect(value) {
  const mode = String(value || 'near-render').toLowerCase();
  if (mode === 'far-projection' || mode === 'projection' || mode === 'far-only' || mode === 'far') return 'far-projection';
  if (mode === 'far-volume') return 'far-volume';
  return 'near-render';
}

const expectedDomainInspect = normalizeDomainInspect(args.get('--expected-domain-inspect') || new URL(url).searchParams.get('volume_smoke_domain_inspect'));
const exerciseDomainInspect = ['1', 'true', 'yes', 'on'].includes(String(args.get('--exercise-domain-inspect') || '').toLowerCase());
const minFrames = Number(args.get('--min-frames') || 4);
const settleMs = Number(args.get('--settle-ms') || 2200);
const port = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-volume-shell-lab-profile-${port}-${process.pid}`;
const windowSize = args.get('--window-size') || '1280,960';

let phase = 'initializing';
let primaryOutputWritten = false;
let lastDebugState = null;
let sampleSummary = null;
let cameraResponse = null;
let domainInspectTransitions = null;
const consoleEvents = [];

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.volume-shell-lab-witness.v0',
    requestedRoute: url,
    expectedMode,
    expectedInspect,
    expectedDomainInspect,
    minFrames,
    settleMs,
    debugPort: port,
    chrome,
    userDataDir,
    windowSize,
    failure_phase: phase,
    primary_output_written: primaryOutputWritten,
    screenshot: primaryOutputWritten ? out : null,
    consoleEvents,
    lastDebugState,
    sampleSummary,
    domainInspectTransitions,
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
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

async function waitForPage() {
  for (let i = 0; i < 80; i += 1) {
    const targets = await cdpFetch('/json/list');
    const page = targets.find(item => item.type === 'page' && item.url.includes('kaminos_volume_smoke=1'))
      || targets.find(item => item.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(125);
  }
  throw new Error('No debuggable page target');
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
    const timer = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectReq(new Error(`${method}: CDP request timed out`));
    }, 30000);
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.method === 'Runtime.consoleAPICalled') {
        consoleEvents.push({
          type: msg.params.type,
          text: (msg.params.args || []).map(arg => arg.value || arg.description || '').join(' '),
        });
      }
      if (msg.method === 'Runtime.exceptionThrown') {
        consoleEvents.push({
          type: 'exception',
          text: msg.params.exceptionDetails?.exception?.description || msg.params.exceptionDetails?.text || 'Runtime exception',
        });
      }
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    awaitPromise: true,
    returnByValue: true,
    expression,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const outBuf = Buffer.alloc(12 + data.length);
  outBuf.writeUInt32BE(data.length, 0);
  typeBuf.copy(outBuf, 4);
  data.copy(outBuf, 8);
  outBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 8 + data.length);
  return outBuf;
}

function writeRgbaPng(path, width, height, rgba) {
  mkdirSync(dirname(path), { recursive: true });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
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

function previewPixels(sample) {
  if (!sample?.preview?.rgba || !Number.isFinite(sample.preview.width) || !Number.isFinite(sample.preview.height)) {
    throw new Error(`sampleFrame did not return preview pixels: ${JSON.stringify({
      ok: sample?.ok,
      reason: sample?.reason,
      width: sample?.preview?.width,
      height: sample?.preview?.height,
      rgbaLength: sample?.preview?.rgba?.length,
    })}`);
  }
  return sample.preview;
}

function changedPreviewPixels(before, after) {
  assert.equal(after.rgba.length, before.rgba.length, 'domain inspection comparison previews have different sizes');
  let changedPixels = 0;
  for (let i = 0; i < before.rgba.length; i += 4) {
    const delta = Math.abs(before.rgba[i] - after.rgba[i])
      + Math.abs(before.rgba[i + 1] - after.rgba[i + 1])
      + Math.abs(before.rgba[i + 2] - after.rgba[i + 2]);
    if (delta > 9) changedPixels += 1;
  }
  return changedPixels;
}

function assertFarDomainSubstance(state, mode) {
  if (mode === 'near-render') return;
  assert.ok(state?.smokeDomainFarAdvectedActiveCells > 0, `${mode} has no occupied far-smoke cells beyond the injection band`);
  assert.ok(state?.smokeDomainFarHighestActiveLayer > 0, `${mode} has no occupied far-smoke layer above its base`);
  assert.ok(state?.smokeDomainTransferLastReadbackFrame >= minFrames, `${mode} far-smoke counters are stale relative to the requested frame floor`);
  const farCellCount = state.smokeDomainFarGrid ** 3;
  assert.ok(state.smokeDomainFarInputActiveCells < farCellCount, `${mode} saturated every far-domain cell instead of preserving empty support`);
}

async function exerciseDomainInspectModes(ws) {
  const identities = {
    'near-render': 'near-domain-render-v0',
    'far-volume': 'far-smoke-camera-raymarch-explicit-2x-world-bounds-v1',
    'far-projection': 'far-smoke-only-max-projection-v0',
  };
  const modes = ['near-render', 'far-volume', 'far-projection'];
  const transitions = [];
  const previews = new Map();
  for (const mode of modes) {
    await evaluate(ws, `(() => {
      const select = document.getElementById('volume-smoke-domain-inspect');
      select.value = ${JSON.stringify(mode)};
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return select.value;
    })()`);
    let state = null;
    for (let i = 0; i < 40; i += 1) {
      state = await evaluate(ws, 'window.__kaminosVolumePrototype.debugState()');
      if (state?.smokeDomainInspectMode === mode && state?.smokeDomainInspectIdentity === identities[mode]) break;
      await delay(50);
    }
    assert.equal(state?.smokeDomainInspectMode, mode, `${mode} live selector transition did not apply`);
    assert.equal(state?.smokeDomainInspectIdentity, identities[mode], `${mode} live selector transition reached the wrong identity`);
    assertFarDomainSubstance(state, mode);
    await delay(120);
    const sample = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleFrame()');
    assert.equal(sample?.ok, true, `${mode} transition sampleFrame failed: ${sample?.reason || 'unknown'}`);
    const preview = previewPixels(sample);
    previews.set(mode, preview);
    transitions.push({
      requestedMode: mode,
      effectiveMode: state.smokeDomainInspectMode,
      effectiveIdentity: state.smokeDomainInspectIdentity,
      frameCount: state.frameCount,
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
    });
  }
  const comparisons = [];
  for (const [beforeMode, afterMode] of [['near-render', 'far-volume'], ['far-volume', 'far-projection'], ['near-render', 'far-projection']]) {
    const before = previews.get(beforeMode);
    const after = previews.get(afterMode);
    const changedPixels = changedPreviewPixels(before, after);
    const pixelCount = before.rgba.length / 4;
    assert.ok(changedPixels > Math.max(32, pixelCount * 0.005), `${beforeMode} and ${afterMode} look materially identical (${changedPixels}/${pixelCount} pixels changed)`);
    comparisons.push({ beforeMode, afterMode, changedPixels, pixelCount });
  }
  return { transitions, comparisons };
}

async function main() {
  mkdirSync(dirname(reportPath), { recursive: true });
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });

  try {
    phase = 'launch';
    await waitForCdp();
    phase = 'target';
    const page = await waitForPage();
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);

    phase = 'state';
    for (let i = 0; i < 80; i += 1) {
      lastDebugState = await evaluate(ws, 'window.__kaminosVolumePrototype?.debugState?.()');
      const farInspectSettled = expectedDomainInspect === 'near-render' || (
        (lastDebugState?.smokeDomainFarAdvectedActiveCells || 0) > 0
        && lastDebugState?.smokeDomainTransferLastReadbackFrame >= minFrames
      );
      if (lastDebugState?.frameCount >= minFrames && farInspectSettled) break;
      await delay(250);
    }
    assert.ok(lastDebugState, 'missing volume debug state');
    assert.equal(lastDebugState.prototypeIdentity, 'kaminos-volume-prototype-v0', 'wrong prototype identity');
    assert.equal(lastDebugState.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'wrong effective route');
    assert.equal(lastDebugState.active, true, 'volume route is not active');
    assert.ok(lastDebugState.frameCount >= minFrames, `volume route rendered ${lastDebugState.frameCount || 0} frames`);
    assert.equal(lastDebugState.fireRenderMode, expectedMode, 'shell render mode did not match route');
    assert.equal(lastDebugState.shellInspectMode, expectedInspect, 'shell inspect mode did not match route');
    if (expectedDomainInspect !== 'near-render') {
      assert.equal(lastDebugState.smokeDomainInspectMode, expectedDomainInspect, `${expectedDomainInspect} domain inspect request did not apply`);
      const expectedIdentity = expectedDomainInspect === 'far-projection'
        ? 'far-smoke-only-max-projection-v0'
        : 'far-smoke-camera-raymarch-explicit-2x-world-bounds-v1';
      assert.equal(lastDebugState.smokeDomainInspectIdentity, expectedIdentity, `${expectedDomainInspect} effective identity is wrong`);
      assert.ok(lastDebugState.smokeDomainFarAdvectedActiveCells > 0, 'far-smoke field has no occupied cells beyond the injection band');
      assert.ok(lastDebugState.smokeDomainFarHighestActiveLayer > 0, 'far-smoke field did not report an occupied layer above its base');
      assert.ok(lastDebugState.smokeDomainTransferLastReadbackFrame >= minFrames, 'far-smoke counters are stale relative to the requested frame floor');
      const farCellCount = lastDebugState.smokeDomainFarGrid ** 3;
      assert.ok(lastDebugState.smokeDomainFarInputActiveCells < farCellCount, 'far-smoke field saturated every cell instead of preserving empty support');
    }
    assert.equal(
      lastDebugState.pyroMaterialRendererCoupling?.carrierDebug?.topologyShellIdentity,
      'topology-lab-thin-reaction-shell-v0',
      'topology shell debug identity is missing',
    );
    assert.equal(
      lastDebugState.pyroMaterialRendererCoupling?.carrierDebug?.topologyShellAuthority,
      'shell-controls-visible-fire-render-authority-stock-fire-bypassed-in-shell-mode',
      'topology shell authority did not reach debug state',
    );

    if (expectedDomainInspect === 'far-volume') {
      phase = 'camera-response';
      await evaluate(ws, `(() => {
        const freeze = document.getElementById('volume-look-freeze');
        freeze.value = '1';
        freeze.dispatchEvent(new Event('input', { bubbles: true }));
        freeze.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await delay(150);
      const beforeCamera = await evaluate(ws, 'window.kaminosCameraDebugState()');
      const beforeSample = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleFrame()');
      assert.equal(beforeSample?.ok, true, `pre-orbit sampleFrame failed: ${beforeSample?.reason || 'unknown'}`);
      const afterCamera = await evaluate(ws, `(() => {
        const c = window.kaminosCameraDebugState();
        const dx = c.position[0] - c.target[0];
        const dz = c.position[2] - c.target[2];
        const angle = 0.48;
        return window.kaminosSetCameraDebugPose({
          position: [
            c.target[0] + dx * Math.cos(angle) - dz * Math.sin(angle),
            c.position[1] + 0.18,
            c.target[2] + dx * Math.sin(angle) + dz * Math.cos(angle),
          ],
          target: c.target,
        });
      })()`);
      await delay(180);
      const afterState = await evaluate(ws, 'window.__kaminosVolumePrototype.debugState()');
      assert.equal(afterState.smokeDomainInspectIdentity, 'far-smoke-camera-raymarch-explicit-2x-world-bounds-v1', 'camera orbit fell back from far-volume inspection');
      const afterSample = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleFrame()');
      assert.equal(afterSample?.ok, true, `post-orbit sampleFrame failed: ${afterSample?.reason || 'unknown'}`);
      assert.notDeepEqual(afterCamera.position, beforeCamera.position, 'camera witness pose did not move');
      const beforeRgba = beforeSample.preview?.rgba || [];
      const afterRgba = afterSample.preview?.rgba || [];
      assert.equal(afterRgba.length, beforeRgba.length, 'camera comparison previews have different sizes');
      let changedPixels = 0;
      for (let i = 0; i < beforeRgba.length; i += 4) {
        const delta = Math.abs(beforeRgba[i] - afterRgba[i])
          + Math.abs(beforeRgba[i + 1] - afterRgba[i + 1])
          + Math.abs(beforeRgba[i + 2] - afterRgba[i + 2]);
        if (delta > 9) changedPixels += 1;
      }
      const pixelCount = beforeRgba.length / 4;
      assert.ok(changedPixels > Math.max(32, pixelCount * 0.005), `far-volume image did not respond materially to camera orbit (${changedPixels}/${pixelCount} pixels changed)`);
      cameraResponse = { beforeCamera, afterCamera, changedPixels, pixelCount };
      lastDebugState = afterState;
    }

    if (exerciseDomainInspect) {
      phase = 'domain-inspect-transitions';
      await evaluate(ws, `(() => {
        const freeze = document.getElementById('volume-look-freeze');
        freeze.value = '1';
        freeze.dispatchEvent(new Event('input', { bubbles: true }));
        freeze.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await delay(150);
      domainInspectTransitions = await exerciseDomainInspectModes(ws);
      await evaluate(ws, `(() => {
        const select = document.getElementById('volume-smoke-domain-inspect');
        select.value = ${JSON.stringify(expectedDomainInspect)};
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return select.value;
      })()`);
      await delay(150);
      lastDebugState = await evaluate(ws, 'window.__kaminosVolumePrototype.debugState()');
      assert.equal(lastDebugState.smokeDomainInspectMode, expectedDomainInspect, 'domain inspection witness did not restore the requested mode');
    }

    phase = 'sample-frame';
    const sample = await evaluate(ws, 'window.__kaminosVolumePrototype.sampleFrame()');
    assert.equal(sample?.ok, true, `sampleFrame failed: ${sample?.reason || 'unknown'}`);
    const preview = previewPixels(sample);
    writeRgbaPng(out, preview.width, preview.height, preview.rgba);
    primaryOutputWritten = true;
    sampleSummary = {
      width: sample.width,
      height: sample.height,
      displayWidth: sample.displayWidth,
      displayHeight: sample.displayHeight,
      frameCount: sample.frameCount,
      meanLuma: sample.meanLuma,
      litPixels: sample.litPixels,
      fireLikePixels: sample.fireLikePixels,
      emissiveLikePixels: sample.emissiveLikePixels,
      smokeLikePixels: sample.smokeLikePixels,
      domainInspect: lastDebugState.smokeDomainInspectMode,
      domainInspectIdentity: lastDebugState.smokeDomainInspectIdentity,
      farAdvectedActiveCells: lastDebugState.smokeDomainFarAdvectedActiveCells,
      farHighestActiveLayer: lastDebugState.smokeDomainFarHighestActiveLayer,
      cameraResponse,
      domainInspectTransitions,
      topologyShellControls: lastDebugState.topologyShellControls,
    };
    assert.ok(sample.litPixels > 0 || expectedMode === 'off', 'sampleFrame produced no visible volume signal');
    if (expectedMode === 'off') {
      assert.equal(lastDebugState.topologyShellControls?.amount ?? 0, 0, 'off witness expected shell amount zero');
    }
    phase = 'done';
    writeReport({ ok: true, failure_phase: null, screenshot: out });
  } catch (error) {
    writeReport({ ok: false, error: error?.message || String(error) });
    throw error;
  } finally {
    proc.kill();
  }
}

main().catch(error => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
