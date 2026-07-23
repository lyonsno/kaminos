#!/usr/bin/env node

import { createHash, randomInt } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { FIRE_ACTOR_LIVE_PARITY_REBAKE_CONTROLS } from './fire-actor-live-parity-contract.mjs';

const ARMS = ['splats', 'smoke', 'composite'];
const EXPECTED_REVISION = 'basinrev-8e84371fad44c961a68b5d3f8f302c78e564e32263f28719c4d3e062d622db95';
const EXPECTED_MOUNT = 'firemount-50c6c9e5977fd4c1a8bc133bda0bdf30af5ac8ee91f63805abb182ab17cd72b7';
const EXPECTED_PACKAGE = 'f90c67f4f87eeffeb08aa21f467cecfafeb9181394c2aef196015c2aedd576bc';
const EXPECTED_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const EXPECTED_EXPORT_AUTHORITY = 'debug-full-grid-webgpu-copy-buffer-readback';
const EXPECTED_EXPORT_IDENTITY = 'full-grid-fluid-front-boundary-sidecars-v0';
const HEX_64 = /^[a-f0-9]{64}$/;
const EXPECTED_ENGINE = Object.freeze({
  sourceCommit: 'ef85ee89e63fe2276c951e7c401cd719d62bf3ce',
  sha256: 'ab0af0ee9abe11a2495e880a9986179727a6027217ce9768299ec3e43114b7ab',
});

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) values.set(argv[index], argv[index + 1]);
  return values;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function cdpJson(port, path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed: ${response.status}`);
  return response.json();
}

async function waitForCdp(port) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await cdpJson(port, '/json/version');
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`CDP did not open on ${port}`);
}

async function waitForPage(port, route) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const targets = await cdpJson(port, '/json/list');
    const page = targets.find(target => target.type === 'page' && target.url === route && target.webSocketDebuggerUrl);
    if (page) return page;
    await delay(100);
  }
  throw new Error(`No debuggable live parity page for ${route}`);
}

function connect(url) {
  const ws = new WebSocket(url);
  return new Promise((resolveConnect, rejectConnect) => {
    ws.addEventListener('open', () => resolveConnect(ws), { once: true });
    ws.addEventListener('error', () => rejectConnect(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function request(ws, method, params = {}, timeoutMs = 120000) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', receive);
      rejectRequest(new Error(`${method} timed out`));
    }, timeoutMs);
    const receive = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', receive);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', receive);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await request(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
  }
  return result.result.value;
}

async function waitFor(ws, expression, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evaluate(ws, `(() => ({
      matched: Boolean(${expression}),
      failed: document.getElementById('status')?.dataset.state === 'failed',
      status: document.getElementById('status')?.textContent || null,
    }))()`);
    if (state.matched) return;
    if (state.failed) throw new Error(`${label} failed: ${state.status}`);
    await delay(200);
  }
  throw new Error(`${label} did not become effective within ${timeoutMs} ms`);
}

async function waitForControlState(ws, predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const state = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    if (predicate(state)) return state;
    const failure = await evaluate(ws, `document.getElementById('status')?.dataset.state === 'failed'
      ? document.getElementById('status')?.textContent : null`);
    if (failure) throw new Error(`${label} failed: ${failure}`);
    await delay(200);
  }
  throw new Error(`${label} did not become effective within ${timeoutMs} ms`);
}

function paeth(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const distances = [Math.abs(prediction - left), Math.abs(prediction - up), Math.abs(prediction - upLeft)];
  return distances[0] <= distances[1] && distances[0] <= distances[2] ? left : distances[1] <= distances[2] ? up : upLeft;
}

function decodePng(png) {
  let width = 0, height = 0, channels = 0;
  const idat = [];
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || ![2, 6].includes(data[9])) throw new Error('unsupported parity screenshot PNG');
      channels = data[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    offset += length + 12;
  }
  const packed = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (stride + 1);
    const filter = packed[row];
    for (let x = 0; x < stride; x += 1) {
      const target = y * stride + x;
      const left = x >= channels ? pixels[target - channels] : 0;
      const up = y > 0 ? pixels[target - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[target - stride - channels] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upLeft) : null;
      if (predictor === null) throw new Error(`unsupported parity screenshot filter ${filter}`);
      pixels[target] = (packed[row + x + 1] + predictor) & 255;
    }
  }
  return { width, height, channels, pixels };
}

function regionPixels(image, bounds, viewport, verticalInset = 42) {
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x0 = Math.max(0, Math.floor(bounds.left * scaleX));
  const y0 = Math.max(0, Math.floor((bounds.top + verticalInset) * scaleY));
  const x1 = Math.min(image.width, Math.ceil(bounds.right * scaleX));
  const y1 = Math.min(image.height, Math.ceil((bounds.bottom - verticalInset) * scaleY));
  const baseOffset = (y0 * image.width + x0) * image.channels;
  const base = [image.pixels[baseOffset], image.pixels[baseOffset + 1], image.pixels[baseOffset + 2]];
  let changedPixels = 0, litPixels = 0;
  const digest = createHash('sha256');
  const rgbPixels = Buffer.alloc((x1 - x0) * (y1 - y0) * 3);
  let rgbOffset = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const offset = (y * image.width + x) * image.channels;
      const rgb = [image.pixels[offset], image.pixels[offset + 1], image.pixels[offset + 2]];
      digest.update(Buffer.from(rgb));
      rgbPixels.set(rgb, rgbOffset);
      rgbOffset += 3;
      if (Math.abs(rgb[0] - base[0]) + Math.abs(rgb[1] - base[1]) + Math.abs(rgb[2] - base[2]) > 12) changedPixels += 1;
      if (rgb[0] + rgb[1] + rgb[2] > 36) litPixels += 1;
    }
  }
  return {
    pixels: rgbPixels,
    receipt: { width: x1 - x0, height: y1 - y0, changedPixels, litPixels, sha256: digest.digest('hex') },
  };
}

function compareRegionPixels(left, right) {
  if (left.receipt.width !== right.receipt.width || left.receipt.height !== right.receipt.height) {
    throw new Error('parity pixel regions have different dimensions');
  }
  let absoluteChannelDelta = 0;
  let maxChannelDelta = 0;
  let pixelsOverTolerance = 0;
  for (let offset = 0; offset < left.pixels.length; offset += 3) {
    let pixelDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(left.pixels[offset + channel] - right.pixels[offset + channel]);
      absoluteChannelDelta += delta;
      pixelDelta = Math.max(pixelDelta, delta);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
    }
    if (pixelDelta > 12) pixelsOverTolerance += 1;
  }
  const pixelCount = left.receipt.width * left.receipt.height;
  return {
    authority: 'same-screenshot-equal-viewport-direct-rgb-comparison-v0',
    pixelCount,
    meanAbsoluteChannelDelta: absoluteChannelDelta / Math.max(1, pixelCount * 3),
    maxChannelDelta,
    pixelTolerance: 12,
    pixelsOverTolerance,
    pixelsOverToleranceRatio: pixelsOverTolerance / Math.max(1, pixelCount),
  };
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameCamera(left, right) {
  const close = (a, b) => Math.abs(Number(a) - Number(b)) <= 1e-9;
  const closeArray = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && a.every((value, index) => close(value, b[index]));
  return left?.type === right?.type && close(left?.fov, right?.fov)
    && close(left?.near, right?.near) && close(left?.far, right?.far)
    && closeArray(left?.position, right?.position) && closeArray(left?.target, right?.target)
    && closeArray(left?.up, right?.up);
}

export function validateLiveParityWitness(arms, screenshots) {
  for (const arm of ARMS) {
    const pair = arms?.[arm];
    if (!pair?.cockpit || !pair?.kiln) throw new Error(`missing ${arm} parity receipt pair`);
    for (const surface of ['cockpit', 'kiln']) {
      const receipt = pair[surface];
      if (receipt.surface !== surface || receipt.presentation?.arm !== arm) throw new Error(`${arm} ${surface} effective arm mismatch`);
      if (receipt.basin?.revision !== EXPECTED_REVISION || !same(receipt.engine, EXPECTED_ENGINE)) throw new Error(`${arm} ${surface} route identity mismatch`);
      if (receipt.state?.requestedSimStep !== 120 || receipt.state?.effectiveSimStep !== 120
        || receipt.state?.paused !== true || receipt.state?.gpuComplete !== true) {
        throw new Error(`${arm} ${surface} exact state mismatch`);
      }
      if (receipt.fallbackReason !== null) throw new Error(`${arm} ${surface} fallback: ${receipt.fallbackReason}`);
      if (!receipt.timing || typeof receipt.timing !== 'object') throw new Error(`${arm} ${surface} timing receipt missing`);
      if (receipt.gpuStageTiming?.timestampStatus !== 'available'
        || receipt.gpuStageTiming?.stages?.total?.status !== 'sampled') {
        throw new Error(`${arm} ${surface} live GPU stage timing missing`);
      }
      const pixels = screenshots?.[arm]?.[surface];
      if (!pixels || pixels.changedPixels <= 0 || pixels.litPixels <= 0) throw new Error(`${arm} ${surface} screenshot is blank or missing`);
    }
    if (!sameCamera(pair.cockpit.camera, pair.kiln.camera)) throw new Error(`${arm} camera mismatch`);
    if (!same(pair.cockpit.actor, pair.kiln.actor)) throw new Error(`${arm} actor transform mismatch`);
    if (pair.cockpit.descriptorId !== pair.kiln.descriptorId) throw new Error(`${arm} descriptor mismatch`);
    if (!same(pair.cockpit.viewport, pair.kiln.viewport)) throw new Error(`${arm} viewport geometry mismatch`);
    const comparison = screenshots?.[arm]?.comparison;
    if (!comparison || comparison.meanAbsoluteChannelDelta > 1
      || comparison.pixelsOverToleranceRatio > 0.001) {
      throw new Error(`${arm} producer/consumer pixels materially diverged`);
    }
  }
  for (const surface of ['cockpit', 'kiln']) {
    const hashes = new Set(ARMS.map(arm => screenshots[arm][surface].sha256));
    if (hashes.size !== ARMS.length) throw new Error(`${surface} presentation pixels did not change across all three arms`);
  }
  return true;
}

function validateLiveControlExercise(exercise) {
  for (const surface of ['cockpit', 'kiln']) {
    if (exercise?.playing?.[surface]?.simStepCount <= exercise?.initial?.[surface]?.simStepCount) {
      throw new Error(`${surface} play control did not advance simulation`);
    }
    if (exercise?.paused?.[surface]?.paused !== true) throw new Error(`${surface} pause control did not pause`);
    if (exercise?.resettled?.[surface]?.simStepCount !== 120 || exercise?.resettled?.[surface]?.paused !== true) {
      throw new Error(`${surface} exact settle did not restore step 120`);
    }
    if (!sameCamera(exercise?.transferredCamera, exercise?.cameraTransfer?.[surface]?.camera)) {
      throw new Error(`${surface} camera transfer did not become effective`);
    }
  }
  return true;
}

export function validateLiveRebakeExercise(exercise) {
  const receipt = exercise?.result?.receipt;
  if (receipt?.schema !== 'kaminos.fire-actor-control-rebake-receipt.v0' || receipt.status !== 'applied') {
    throw new Error('Wake rebake receipt is missing or unapplied');
  }
  if (receipt.mountId !== EXPECTED_MOUNT || receipt.basinRevision !== EXPECTED_REVISION
    || receipt.packageSha256 !== EXPECTED_PACKAGE) {
    throw new Error('Wake rebake mount identity mismatch');
  }
  const source = receipt.source;
  if (source?.requestedMode !== 'live' || source?.effectiveMode !== 'live' || source?.simStepCount !== 120
    || !/^fireactor-live-[a-f0-9]{64}$/.test(source?.stateId || '')
    || !HEX_64.test(source?.sourceStateIdentity || '')
    || !HEX_64.test(source?.fluidSha256 || '') || !HEX_64.test(source?.frontSha256 || '')
    || !source?.cameraIdentity || source.cameraRole !== 'capture-context-not-analytical-projection'
    || source.routeIdentity !== EXPECTED_ROUTE || source.effectiveRoute !== EXPECTED_ROUTE
    || !String(source.backend || '').startsWith('WebGPU:')
    || source.exportAuthority !== EXPECTED_EXPORT_AUTHORITY
    || source.exportIdentity !== EXPECTED_EXPORT_IDENTITY
    || source.liveCaptureLease?.beforeRelease !== 120 || source.liveCaptureLease?.afterRelease !== 120) {
    throw new Error('Wake rebake live source identity mismatch');
  }
  const engineBefore = exercise.result.engineBefore;
  const engineAfter = exercise.result.engineAfter;
  if (engineBefore?.simStepCount !== 120 || engineAfter?.simStepCount !== 120
    || engineBefore.cameraSignature !== source.cameraIdentity
    || engineAfter.cameraSignature !== source.cameraIdentity) {
    throw new Error('Wake rebake engine capture identity mismatch');
  }
  if (Object.keys(receipt.requestedControls || {}).length !== 14 || Object.keys(receipt.effectiveControls || {}).length !== 14) {
    throw new Error('Wake rebake did not exercise exactly fourteen controls');
  }
  if (!same(receipt.requestedControls, FIRE_ACTOR_LIVE_PARITY_REBAKE_CONTROLS)
    || !same(receipt.effectiveControls, FIRE_ACTOR_LIVE_PARITY_REBAKE_CONTROLS)) {
    throw new Error('Wake rebake treatment controls mismatch');
  }
  if (receipt.boundary?.baseline?.identity !== '33a6943c6a2cb644f244d5edeeb544dbce52d0cef98e3fb9d705abd49b941216'
    || receipt.boundary?.requested !== 'analytical-recomputed'
    || receipt.boundary?.effective !== 'analytical-recomputed') {
    throw new Error('Wake rebake boundary authority mismatch');
  }
  if (receipt.simulatorAdvanced !== false || receipt.fallbackReason !== null
    || !same(receipt.passes?.requested, receipt.passes?.applied)
    || receipt.passes?.encoded?.length !== 0) {
    throw new Error('Wake rebake mutated simulation, fell back, or misreported passes');
  }
  if (!/^[a-f0-9]{64}$/.test(receipt.identities?.pixels || '')
    || exercise.result.pixelByteLength !== receipt.output?.byteLength
    || exercise.result.baselinePixelByteLength !== receipt.output?.byteLength) {
    throw new Error('Wake rebake pixel identity or byte receipt mismatch');
  }
  const treatment = exercise.result.producerReceipts?.treatment;
  if (!treatment || treatment.sourceStateIdentity !== source.sourceStateIdentity
    || treatment.source?.stateId !== source.stateId
    || treatment.source?.fluidSha256 !== source.fluidSha256
    || treatment.source?.frontSha256 !== source.frontSha256
    || treatment.source?.cameraIdentity !== source.cameraIdentity
    || treatment.source?.simStepCount !== source.simStepCount
    || treatment.source?.routeIdentity !== source.routeIdentity
    || treatment.source?.effectiveRoute !== source.effectiveRoute
    || treatment.source?.backend !== source.backend
    || treatment.source?.exportAuthority !== source.exportAuthority
    || treatment.source?.exportIdentity !== source.exportIdentity
    || !same(treatment.effectiveControls, receipt.effectiveControls)
    || treatment.stageBIdentity !== receipt.identities?.treatmentStageB
    || treatment.depositionIdentity !== receipt.identities?.deposition
    || treatment.pixelIdentity !== receipt.identities?.pixels) {
    throw new Error('Wake rebake producer receipt mismatch');
  }
  const stateBasis = {
    mode: treatment.source.mode,
    grid: treatment.source.grid,
    fluidSha256: treatment.source.fluidSha256,
    frontSha256: treatment.source.frontSha256,
    cameraIdentity: treatment.source.cameraIdentity,
    simStepCount: treatment.source.simStepCount,
    routeIdentity: treatment.source.routeIdentity,
    effectiveRoute: treatment.source.effectiveRoute,
    backend: treatment.source.backend,
    exportAuthority: treatment.source.exportAuthority,
    exportIdentity: treatment.source.exportIdentity,
  };
  if (source.stateId !== `fireactor-live-${sha256Json(stateBasis)}`) {
    throw new Error('Wake rebake live state identity is not derived from the captured source');
  }
  const expectedSourceStateIdentity = sha256Json({
    stateId: source.stateId,
    grid: treatment.source.grid,
    fluidSha256: source.fluidSha256,
    frontSha256: source.frontSha256,
    cameraIdentity: source.cameraIdentity,
  });
  if (source.sourceStateIdentity !== expectedSourceStateIdentity) {
    throw new Error('Wake rebake producer source identity is internally inconsistent');
  }
  const expectedStageBIdentity = sha256Json({
    sourceStateIdentity: treatment.sourceStateIdentity,
    controlsIdentity: treatment.controlsIdentity,
    fixedProductionControlsIdentity: treatment.fixedProductionControlsIdentity,
    projectionIdentity: treatment.projectionIdentity,
    candidateIdentity: treatment.candidateIdentity,
    coefficientIdentity: treatment.coefficientIdentity,
    covarianceIdentity: treatment.covarianceIdentity,
    depositionIdentity: treatment.depositionIdentity,
    pixelIdentity: treatment.pixelIdentity,
  });
  if (treatment.stageBIdentity !== expectedStageBIdentity) {
    throw new Error('Wake rebake Stage B identity is internally inconsistent');
  }
  if (receipt.projection?.identity !== 'fixed-stage-b-analytical-camera-v0'
    || treatment.projection?.identity !== receipt.projection.identity) {
    throw new Error('Wake rebake analytical projection identity mismatch');
  }
  if (exercise.result.rawPixelSha256 !== receipt.identities.pixels) {
    throw new Error('Wake rebake raw pixel identity mismatch');
  }
  if (exercise.result.canvasPixelSha256 !== receipt.identities.pixels) {
    throw new Error('Wake rebake canvas pixel identity mismatch');
  }
  if (exercise.beforeStep !== 120 || exercise.afterStep !== 120) {
    throw new Error('Wake rebake advanced the live simulator');
  }
  if (!exercise.pixels || exercise.pixels.changedPixels <= 0 || exercise.pixels.litPixels <= 0) {
    throw new Error('Wake rebake pixel witness is blank');
  }
  return true;
}

const projection = `(() => {
  const read = id => JSON.parse(document.getElementById(id).textContent);
  const bounds = id => {
    const rect = document.getElementById(id).getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  };
  return {
    cockpit: read('cockpit-receipt'),
    kiln: read('kiln-receipt'),
    bounds: { cockpit: bounds('cockpit'), kiln: bounds('kiln') },
    viewport: { width: innerWidth, height: innerHeight },
    status: document.getElementById('status').textContent,
  };
})()`;

export async function runLiveParityWitness(options = {}) {
  const route = options.url || 'http://127.0.0.1:18400/fire-actor-live-parity.html';
  const requestedOutputRoot = options.outputRoot || 'artifacts/fire-actor-live-parity/live';
  const outputRoot = resolve(requestedOutputRoot);
  const reportPath = resolve(options.reportPath || `${outputRoot}/report.json`);
  const port = Number(options.debugPort || randomInt(42000, 62000));
  const timeoutMs = Number(options.timeoutMs || 180000);
  const chrome = options.chrome || process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const userDataDir = options.userDataDir || `/tmp/kaminos-fire-parity-${port}-${process.pid}`;
  let phase = 'launch';
  let browser = null, ws = null, failure = null;
  const arms = {}, screenshots = {}, screenshotPaths = {};
  let liveControlExercise = null;
  let liveRebakeExercise = null;

  const writeReport = () => {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, JSON.stringify({
      schema: 'kaminos.fire-actor-live-parity-witness.v1',
      ok: failure === null && ARMS.every(arm => arms[arm] && screenshots[arm]) && Boolean(liveRebakeExercise),
      requestedRoute: route,
      effectiveRoute: arms.composite ? route : null,
      requested: { revision: EXPECTED_REVISION, engine: EXPECTED_ENGINE, simStep: 120, arms: ARMS },
      phase,
      failure,
      screenshotPaths,
      screenshots,
      arms,
      liveControlExercise,
      liveRebakeExercise,
    }, null, 2));
  };

  try {
    browser = spawn(chrome, [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--window-size=1600,1000',
      route,
    ], { stdio: 'ignore' });
    await waitForCdp(port);
    const page = await waitForPage(port, route);
    ws = await connect(page.webSocketDebuggerUrl);
    await request(ws, 'Runtime.enable');
    await request(ws, 'Page.enable');
    phase = 'exact-settle';
    await waitFor(ws, `document.getElementById('status')?.dataset.state === 'effective' && document.getElementById('status')?.textContent.includes('exact step 120')`, timeoutMs, 'exact parity settle');
    phase = 'live-controls';
    const initial = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    await evaluate(ws, `document.querySelector('[data-command="play"]').click()`);
    await waitFor(ws, `document.getElementById('status')?.textContent === 'both surfaces playing'`, timeoutMs, 'parity play');
    let playing;
    try {
      playing = await waitForControlState(
        ws,
        state => ['cockpit', 'kiln'].every(surface => state[surface].simStepCount > initial[surface].simStepCount),
        timeoutMs,
        'parity simulation advance',
      );
    } catch (error) {
      playing = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
      liveControlExercise = { initial, playing };
      throw new Error(`${error.message}; last control state ${JSON.stringify(playing)}`);
    }
    await evaluate(ws, `document.querySelector('[data-command="pause"]').click()`);
    await waitFor(ws, `document.getElementById('status')?.textContent === 'both surfaces paused'`, timeoutMs, 'parity pause');
    const paused = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    await evaluate(ws, `document.getElementById('settle').click()`);
    await waitFor(ws, `document.getElementById('status')?.textContent.includes('exact step 120')`, timeoutMs, 'parity resettle');
    const resettled = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    const transferredCamera = {
      type: 'PerspectiveCamera', fov: 40, near: 0.01, far: 100,
      position: [1.4, 0.62, 3.25], target: [0.02, 0.12, 0], up: [0, 1, 0],
    };
    await evaluate(ws, `window.kaminosFireActorParityWorkbench.command('cockpit', 'applyCamera', ${JSON.stringify(transferredCamera)})`);
    await evaluate(ws, `document.getElementById('sync-camera').click()`);
    await waitFor(ws, `document.getElementById('status')?.textContent === 'cockpit camera applied to Kiln'`, timeoutMs, 'camera transfer');
    const cameraTransfer = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    const exactCamera = {
      type: 'PerspectiveCamera', fov: 40, near: 0.01, far: 100,
      position: [1.65, 0.42, 3.15], target: [0, 0.08, 0], up: [0, 1, 0],
    };
    await evaluate(ws, `Promise.all(['cockpit', 'kiln'].map(surface => window.kaminosFireActorParityWorkbench.command(surface, 'applyCamera', ${JSON.stringify(exactCamera)})))`);
    liveControlExercise = { initial, playing, paused, resettled, transferredCamera, cameraTransfer, restoredCamera: exactCamera };
    validateLiveControlExercise(liveControlExercise);

    phase = 'live-rebake';
    const beforeRebake = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    await evaluate(ws, `window.kaminosFireActorParityWorkbench.rebakeTreatment()`);
    await waitFor(
      ws,
      `document.getElementById('status')?.textContent === 'Wake rebake effective: 14 controls, live source, no simulation advance'`,
      timeoutMs,
      'Wake live control rebake',
    );
    const rebakeResult = await evaluate(ws, `window.kaminosFireActorParityWorkbench.rebakeReceipt()`);
    const afterRebake = await evaluate(ws, `window.kaminosFireActorParityWorkbench.controlState()`);
    const rebakeBounds = await evaluate(ws, `(() => {
      const rect = document.getElementById('kiln-rebake-canvas').getBoundingClientRect();
      return {
        bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
        viewport: { width: innerWidth, height: innerHeight },
      };
    })()`);
    const rebakeShot = await request(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
    if (!rebakeShot?.data) throw new Error('Wake rebake screenshot was empty');
    const rebakePng = Buffer.from(rebakeShot.data, 'base64');
    const rebakeImage = decodePng(rebakePng);
    mkdirSync(outputRoot, { recursive: true });
    writeFileSync(`${outputRoot}/rebake.png`, rebakePng);
    screenshotPaths.rebake = `${requestedOutputRoot.replace(/\/$/, '')}/rebake.png`;
    liveRebakeExercise = {
      beforeStep: beforeRebake.kiln.simStepCount,
      afterStep: afterRebake.kiln.simStepCount,
      result: rebakeResult,
      pixels: regionPixels(rebakeImage, rebakeBounds.bounds, rebakeBounds.viewport, 0).receipt,
    };
    validateLiveRebakeExercise(liveRebakeExercise);
    await evaluate(ws, `document.getElementById('kiln-rebake-preview').hidden = true`);

    for (const arm of ARMS) {
      phase = `arm-${arm}`;
      await evaluate(ws, `document.querySelector('[data-arm="${arm}"]').click()`);
      await waitFor(ws, `document.getElementById('status')?.dataset.state === 'effective' && document.getElementById('status')?.textContent === 'effective arm: ${arm}'`, timeoutMs, `${arm} parity arm`);
      const state = await evaluate(ws, projection);
      arms[arm] = { cockpit: state.cockpit, kiln: state.kiln };
      const shot = await request(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
      if (!shot?.data) throw new Error(`${arm} screenshot was empty`);
      const png = Buffer.from(shot.data, 'base64');
      const image = decodePng(png);
      mkdirSync(outputRoot, { recursive: true });
      const outputPath = `${outputRoot}/${arm}.png`;
      writeFileSync(outputPath, png);
      screenshotPaths[arm] = `${requestedOutputRoot.replace(/\/$/, '')}/${arm}.png`;
      const cockpitRegion = regionPixels(image, state.bounds.cockpit, state.viewport);
      const kilnRegion = regionPixels(image, state.bounds.kiln, state.viewport);
      screenshots[arm] = {
        cockpit: cockpitRegion.receipt,
        kiln: kilnRegion.receipt,
        comparison: compareRegionPixels(cockpitRegion, kilnRegion),
      };
    }
    phase = 'validation';
    validateLiveParityWitness(arms, screenshots);
    phase = 'complete';
    return { reportPath, screenshotPaths, arms, screenshots };
  } catch (error) {
    failure = { phase, error: error?.message || String(error) };
    throw error;
  } finally {
    writeReport();
    ws?.close();
    browser?.kill('SIGTERM');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  runLiveParityWitness({
    url: args.get('--url'),
    outputRoot: args.get('--out-root'),
    reportPath: args.get('--report'),
    debugPort: args.get('--debug-port'),
    timeoutMs: args.get('--timeout-ms'),
  }).then(result => console.log(JSON.stringify({ ok: true, ...result }, null, 2)))
    .catch(error => {
      console.error(error.stack || error.message || String(error));
      process.exitCode = 1;
    });
}
