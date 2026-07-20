#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

const EXPECTED = Object.freeze({
  castId: args.get('--expected-cast-id') || 'motion-ready-719024',
  castHash: args.get('--expected-cast-hash') || '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  hillSource: args.get('--expected-hill-source') || 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348',
});
const url = args.get('--url') || 'http://127.0.0.1:18124/motion-ready-719024-witness.html';
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-motion-ready-719024-witness-${timestamp}`);
const reportPath = resolve(args.get('--report') || `${outDir}/report.json`);
const filmstripPath = resolve(args.get('--filmstrip') || `${outDir}/filmstrip.png`);
const tileWidth = positiveInt(args.get('--tile-width'), 500, '--tile-width');
const columns = positiveInt(args.get('--columns'), 4, '--columns');
const windowWidth = positiveInt(args.get('--window-width'), 1440, '--window-width');
const windowHeight = positiveInt(args.get('--window-height'), 900, '--window-height');
const port = positiveInt(args.get('--debug-port'), 9684, '--debug-port');
const chrome = process.env.KAMINOS_CHROME || args.get('--chrome') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-ready-719024-profile-${port}-${process.pid}`;
const samples = Object.freeze([
  { label: 'lead-in', at: 0.55 },
  { label: 'travel-early', at: 2.25 },
  { label: 'travel-quarter', at: 4.25 },
  { label: 'travel-mid', at: 6.35 },
  { label: 'travel-late', at: 9.05 },
  { label: 'travel-arrival', at: 11.45 },
  { label: 'settle-early', at: 12.65 },
  { label: 'settle-held', at: 14.45 },
]);

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
let effectiveIdentity = null;
let chromeProcess = null;

function positiveInt(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.motion-ready-719024-live-witness.v0',
    requestedUrl: url,
    effectiveUrl,
    requestedIdentity: EXPECTED,
    effectiveIdentity,
    samples,
    tileWidth,
    columns,
    windowSize: { width: windowWidth, height: windowHeight },
    browserVersion,
    debugPort: port,
    chrome,
    userDataDir,
    outDir,
    reportPath,
    filmstripPath,
    phase,
    stderrTail: stderr.slice(-4000),
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (;;) {
    if (chromeProcess?.exitCode != null) throw new Error(`Chrome exited before CDP opened (${chromeProcess.exitCode})`);
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(150);
    }
  }
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
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

async function evaluate(ws, expression) {
  const response = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result.value;
}

async function closeBrowser(ws) {
  try {
    await wsRequest(ws, 'Browser.close');
  } catch {
    try { ws.close(); } catch {}
  }
  await delay(250);
  if (chromeProcess?.exitCode == null && chromeProcess?.signalCode == null) chromeProcess.kill('SIGTERM');
}

function assertPng(buffer, label) {
  assert.ok(buffer.length > 10_000, `${label} PNG is too small to be credible visual evidence`);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${label} is not a PNG`);
}

async function waitForWitness(ws) {
  for (;;) {
    const result = await evaluate(ws, `(() => {
      const debug = window.kaminosMotionReady719024DebugState?.();
      return {
        href: location.href,
        hasDebugState: typeof window.kaminosMotionReady719024DebugState === 'function',
        status: document.getElementById('status')?.textContent || null,
        debug,
      };
    })()`);
    if (result.debug?.consoleFailures?.length) {
      throw new Error(`witness reported console failures: ${JSON.stringify(result.debug.consoleFailures)}`);
    }
    if (result.debug?.loaded) return result;
    await delay(150);
  }
}

function assertIdentity(debug) {
  effectiveIdentity = {
    castId: debug.effective.castId,
    castHash: debug.effective.castHash,
    registrationHash: debug.effective.registrationHash,
    deformationMode: debug.effective.deformationMode,
    hillSource: debug.effective.hillSourceRef,
    hillAuthority: debug.effective.hillAuthority,
    hillIdentityProjection: debug.effective.hillIdentityProjection,
    hillChecksums: debug.effective.hillChecksums,
    routePlanId: debug.effective.routePlanId,
    routeProfile: debug.effective.routeProfile,
  };
  assert.equal(effectiveIdentity.castId, EXPECTED.castId, 'effective cast ID does not match requested cast ID');
  assert.equal(effectiveIdentity.castHash, EXPECTED.castHash, 'effective cast hash does not match requested cast hash');
  assert.equal(effectiveIdentity.hillSource, EXPECTED.hillSource, 'effective Hill source does not match requested Hill source');
  assert.equal(effectiveIdentity.deformationMode, 'axial-parallel-transport-wave-v1', 'unexpected deformation mode');
  assert.equal(effectiveIdentity.hillAuthority, 'live_simulation', 'Hill packet is not source-owned live-simulation evidence');
  assert.equal(effectiveIdentity.hillIdentityProjection, 'public-surface-identifiers-v0', 'Hill packet does not declare its public identity projection');
  assert.equal(debug.effective.dynamicContinuity, 'not-claimed', 'static Hill packet must explicitly decline dynamic continuity');
  assert.ok(debug.effective.routePointCount >= 8, 'route is too sparse to establish terrain traversal');
}

async function clickReplay(ws) {
  return evaluate(ws, `(() => {
    const button = document.getElementById('replay');
    if (!button) throw new Error('Replay control missing');
    button.click();
    return window.kaminosMotionReady719024DebugState();
  })()`);
}

async function waitForElapsed(ws, target) {
  for (;;) {
    const debug = await evaluate(ws, 'window.kaminosMotionReady719024DebugState()');
    if (debug.consoleFailures?.length) throw new Error(`console failures during playback: ${JSON.stringify(debug.consoleFailures)}`);
    if (debug.motion.elapsedSeconds >= target) return debug;
    await delay(30);
  }
}

async function captureFrame(ws, sample, index) {
  const debug = await waitForElapsed(ws, sample.at);
  const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(screenshot.data, 'base64');
  assertPng(png, `frame ${index}`);
  const path = `${outDir}/frame-${String(index).padStart(2, '0')}-${sample.label}.png`;
  writeFileSync(path, png);
  return {
    schema: 'kaminos.motion-ready-719024-live-frame.v0',
    index,
    label: sample.label,
    requestedElapsedSeconds: sample.at,
    path,
    bytes: png.length,
    screenshotDataUrl: `data:image/png;base64,${screenshot.data}`,
    debug,
  };
}

async function composeFilmstrip(ws, frames) {
  const payload = {
    tileWidth,
    columns,
    frames: frames.map(frame => ({
      index: frame.index,
      label: frame.label,
      dataUrl: frame.screenshotDataUrl,
      elapsed: frame.debug.motion.elapsedSeconds,
      progress: frame.debug.motion.routeProgress,
      speed: frame.debug.motion.routeSpeed,
      amplitude: frame.debug.motion.controller.amplitude,
    })),
  };
  const result = await evaluate(ws, `(async () => {
    const payload = ${JSON.stringify(payload)};
    const images = await Promise.all(payload.frames.map(frame => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('failed to decode frame ' + frame.index));
      image.src = frame.dataUrl;
    })));
    if (!images.length) throw new Error('no frames supplied');
    const labelHeight = 44;
    const tileHeight = Math.round(payload.tileWidth * images[0].naturalHeight / images[0].naturalWidth);
    const rows = Math.ceil(images.length / payload.columns);
    const canvas = document.createElement('canvas');
    canvas.width = payload.tileWidth * payload.columns;
    canvas.height = (tileHeight + labelHeight) * rows;
    const context = canvas.getContext('2d');
    context.fillStyle = '#050606';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '600 12px ui-monospace, SFMono-Regular, Menlo, monospace';
    context.textBaseline = 'top';
    images.forEach((image, index) => {
      const frame = payload.frames[index];
      const x = (index % payload.columns) * payload.tileWidth;
      const y = Math.floor(index / payload.columns) * (tileHeight + labelHeight);
      context.fillStyle = '#090b0d';
      context.fillRect(x, y, payload.tileWidth, labelHeight);
      context.fillStyle = '#efd58b';
      context.fillText(String(index + 1).padStart(2, '0') + ' ' + frame.label + '  t=' + frame.elapsed.toFixed(2), x + 9, y + 7);
      context.fillStyle = '#bdc8c0';
      context.fillText('route ' + frame.progress.toFixed(3) + '  speed ' + frame.speed.toFixed(2) + '  wave ' + frame.amplitude.toFixed(3), x + 9, y + 24);
      context.drawImage(image, x, y + labelHeight, payload.tileWidth, tileHeight);
    });
    return {
      width: canvas.width,
      height: canvas.height,
      rows,
      tileHeight,
      dataUrl: canvas.toDataURL('image/png'),
    };
  })()`);
  const png = Buffer.from(result.dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
  assertPng(png, 'filmstrip.png');
  writeFileSync(filmstripPath, png);
  return {
    schema: 'kaminos.motion-ready-719024-live-filmstrip.v0',
    path: filmstripPath,
    bytes: png.length,
    width: result.width,
    height: result.height,
    columns,
    rows: result.rows,
    tileWidth,
    tileHeight: result.tileHeight,
  };
}

try {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    `--window-size=${windowWidth},${windowHeight}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });

  phase = 'connecting-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find(entry => entry.type === 'page' && entry.url.includes('motion-ready-719024-witness'))
    || pages.find(entry => entry.type === 'page')
    || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable Chrome page found');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest(ws, 'Page.enable');
  await wsRequest(ws, 'Runtime.enable');
  await wsRequest(ws, 'Page.bringToFront').catch(() => null);

  phase = 'loading-witness';
  const loaded = await waitForWitness(ws);
  effectiveUrl = loaded.href;
  assertIdentity(loaded.debug);

  phase = 'capturing-lead-in-travel-settle';
  await clickReplay(ws);
  const capturedFrames = [];
  for (let index = 0; index < samples.length; index++) {
    capturedFrames.push(await captureFrame(ws, samples[index], index));
  }

  phase = 'composing-filmstrip';
  const filmstrip = await composeFilmstrip(ws, capturedFrames);
  const frames = capturedFrames.map(({ screenshotDataUrl, ...frame }) => frame);
  const last = frames.at(-1).debug;
  assert.equal(last.completed, false, 'settle sample should precede completion status edge');
  assert.ok(last.motion.routeProgress > 0.999, 'settle frame did not reach route destination');
  assert.ok(last.motion.routeSpeed < 0.02, 'settle frame retained material route velocity');
  assert.ok(last.motion.controller.amplitude < 0.04, 'settle frame retained material squirm amplitude');
  assert.ok(frames.some(frame => frame.debug.motion.controller.amplitude > 0.08), 'travel never produced a legible axial wave');
  assert.ok(last.performance.smoothedFps >= 30, `motion cadence remained below 30 fps (${last.performance.smoothedFps.toFixed(1)})`);
  assert.ok(last.performance.lastDeformationMs < 20, `batch deformation remained above 20 ms (${last.performance.lastDeformationMs.toFixed(1)} ms)`);
  assert.ok(frames.at(-1).debug.motion.root[2] < frames[0].debug.motion.root[2] || frames.at(-1).debug.motion.root[0] !== frames[0].debug.motion.root[0], 'cast did not translate through world space');

  phase = 'writing-report';
  writeReport({ ok: true, frames, filmstrip, finalDebugState: last });
  await closeBrowser(ws);
} catch (error) {
  writeReport({
    ok: false,
    error: error?.stack || String(error),
  });
  if (chromeProcess?.exitCode == null && chromeProcess?.signalCode == null) chromeProcess.kill('SIGTERM');
  throw error;
}
