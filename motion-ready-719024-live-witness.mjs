#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import {
  closeCdpBrowser,
  requestCdp,
} from './motion-ready-719024-cdp.js';
import { assertMotionReady719024EffectiveIdentity } from './motion-ready-719024-live-identity.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}

function boundedNumber(value, fallback, minimum, maximum, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be finite and in [${minimum}, ${maximum}]`);
  }
  return parsed;
}

const contactCoupling = boundedNumber(args.get('--contact-coupling'), 1, 0, 1, '--contact-coupling');

const EXPECTED = Object.freeze({
  castId: args.get('--expected-cast-id') || 'motion-ready-719024',
  castHash: args.get('--expected-cast-hash') || '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e',
  registrationHash: args.get('--expected-registration-hash') || 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6',
  contactAtlasHash: args.get('--expected-contact-atlas-hash') || 'e3007a55f930d709ac8a7bf684ff32ad862e7d55186343220edb3e2ad3635b78',
  contactCoupling,
  hillSource: args.get('--expected-hill-source') || 'lerms:cc/hill-of-hills-live-terrain-server-0702@81c5348',
  routePlanId: 'motion-ready-719024-strict-hill-route',
  locomotionRailId: 'motion-ready-719024-creature-scale-rail',
});
const requestedUrl = new URL(args.get('--url') || 'http://127.0.0.1:18124/motion-ready-719024-witness.html');
requestedUrl.searchParams.set('contact_coupling', String(contactCoupling));
const url = requestedUrl.href;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-motion-ready-719024-witness-${timestamp}`);
const reportPath = resolve(args.get('--report') || `${outDir}/report.json`);
const filmstripPath = resolve(args.get('--filmstrip') || `${outDir}/filmstrip.png`);
const tileWidth = positiveInt(args.get('--tile-width'), 500, '--tile-width');
const columns = positiveInt(args.get('--columns'), 4, '--columns');
const windowWidth = positiveInt(args.get('--window-width'), 1440, '--window-width');
const windowHeight = positiveInt(args.get('--window-height'), 900, '--window-height');
const port = positiveInt(args.get('--debug-port'), 9684, '--debug-port');
const cdpTimeoutMs = positiveInt(args.get('--cdp-timeout-ms'), 15_000, '--cdp-timeout-ms');
const witnessTimeoutMs = positiveInt(args.get('--witness-timeout-ms'), 30_000, '--witness-timeout-ms');
const chrome = process.env.KAMINOS_CHROME || args.get('--chrome') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-ready-719024-profile-${port}-${process.pid}`;
const samples = Object.freeze([
  { label: 'lead-in', at: 0.55 },
  { label: 'contact-start', at: 1.35 },
  { label: 'travel-early', at: 2.25 },
  { label: 'stride-a', at: 3.15 },
  { label: 'travel-quarter', at: 4.25 },
  { label: 'gait-00', at: 5.00 },
  { label: 'gait-01', at: 5.05 },
  { label: 'gait-02', at: 5.10 },
  { label: 'gait-03', at: 5.15 },
  { label: 'gait-04', at: 5.20 },
  { label: 'gait-05', at: 5.25 },
  { label: 'gait-06', at: 5.30 },
  { label: 'gait-07', at: 5.35 },
  { label: 'gait-08', at: 5.40 },
  { label: 'travel-mid', at: 6.35 },
  { label: 'stride-c', at: 7.50 },
  { label: 'travel-late', at: 9.05 },
  { label: 'stride-d', at: 10.40 },
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
let lastTrustworthyEvidence = { phase: 'initializing' };

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
    readinessTimeouts: { cdpTimeoutMs, witnessTimeoutMs },
    chrome,
    userDataDir,
    outDir,
    reportPath,
    filmstripPath,
    phase,
    lastTrustworthyEvidence,
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
  const deadline = Date.now() + cdpTimeoutMs;
  let attempts = 0;
  for (;;) {
    if (chromeProcess?.exitCode != null) throw new Error(`Chrome exited before CDP opened (${chromeProcess.exitCode})`);
    attempts++;
    try {
      const version = await cdpFetch('/json/version');
      lastTrustworthyEvidence = { phase: 'connecting-cdp', attempts, debugPort: port, cdpOpened: true };
      return version;
    } catch (error) {
      lastTrustworthyEvidence = {
        phase: 'connecting-cdp',
        attempts,
        debugPort: port,
        cdpOpened: false,
        browserExitCode: chromeProcess?.exitCode ?? null,
        lastError: error?.message || String(error),
      };
      if (Date.now() >= deadline) throw new Error(`Timed out connecting to CDP after ${cdpTimeoutMs} ms`);
      await delay(150);
    }
  }
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function evaluate(ws, expression) {
  const response = await requestCdp(ws, 'Runtime.evaluate', {
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
  await closeCdpBrowser(ws, chromeProcess, delay);
}

function assertPng(buffer, label) {
  assert.ok(buffer.length > 10_000, `${label} PNG is too small to be credible visual evidence`);
  assert.equal(buffer.readUInt32BE(0), 0x89504e47, `${label} is not a PNG`);
}

async function waitForWitness(ws) {
  const deadline = Date.now() + witnessTimeoutMs;
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
    effectiveUrl = result.href || effectiveUrl;
    lastTrustworthyEvidence = {
      phase: 'loading-witness',
      href: result.href || null,
      status: result.status || null,
      hasDebugState: result.hasDebugState,
      loaded: Boolean(result.debug?.loaded),
      consoleFailures: result.debug?.consoleFailures || [],
    };
    if (result.debug?.consoleFailures?.length) {
      throw new Error(`witness reported console failures: ${JSON.stringify(result.debug.consoleFailures)}`);
    }
    if (result.debug?.loaded) return result;
    if (Date.now() >= deadline) throw new Error(`Timed out loading witness state after ${witnessTimeoutMs} ms`);
    await delay(150);
  }
}

function assertIdentity(debug) {
  effectiveIdentity = assertMotionReady719024EffectiveIdentity(debug, EXPECTED);
}

async function clickReplay(ws) {
  return evaluate(ws, `(() => {
    if (typeof window.kaminosMotionReady719024PrepareDeterministicCapture !== 'function') {
      throw new Error('deterministic capture reset missing');
    }
    return window.kaminosMotionReady719024PrepareDeterministicCapture();
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
  const debug = await evaluate(ws, `window.kaminosMotionReady719024AdvanceToElapsed(${JSON.stringify(sample.at)})`);
  assert.ok(
    Math.abs(debug.motion.elapsedSeconds - sample.at) < 1e-5,
    `frame ${index} effective source time drifted to ${debug.motion.elapsedSeconds}`,
  );
  await delay(50);
  const screenshot = await requestCdp(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
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
      planted: frame.debug.motion.contactLocomotion?.patches?.filter(patch => patch.state === 'stance').length || 0,
      traction: frame.debug.motion.contactLocomotion?.traction || 0,
      meanStanceSlip: frame.debug.motion.contactLocomotion?.metrics?.meanStanceSlip || 0,
      maximumSupportExtension: Math.max(
        0,
        ...frame.debug.motion.contactLocomotion?.patches?.map(patch => patch.metrics?.maximumExtension || 0) || [],
      ),
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
      context.fillText('route ' + frame.progress.toFixed(3) + '  speed ' + frame.speed.toFixed(2) + '  plant ' + frame.planted + '  traction ' + frame.traction.toFixed(2) + '  slip ' + frame.meanStanceSlip.toFixed(3) + '  maxreach ' + frame.maximumSupportExtension.toFixed(3), x + 9, y + 24);
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
  await requestCdp(ws, 'Page.enable');
  await requestCdp(ws, 'Runtime.enable');
  await requestCdp(ws, 'Page.bringToFront').catch(() => null);

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
  assert.equal(last.motion.contactCoupling, contactCoupling, 'effective contact coupling drifted from the requested A/B lane');
  assert.ok(last.motion.contactLocomotion.metrics.plantCount >= 4, 'contact witness recorded too few plant events');
  assert.ok(last.motion.contactLocomotion.metrics.releaseCount >= 4, 'contact witness recorded too few release events');
  assert.ok(last.motion.contactLocomotion.metrics.maximumSwingClearance > 0.01, 'contact witness never recorded swing clearance');
  if (contactCoupling > 0.5) {
    for (const patch of last.motion.contactLocomotion.patches) {
      assert.ok(patch.metrics.plantCount >= 1, `${patch.id} never planted in the live Hill route`);
      assert.ok(patch.metrics.releaseCount >= 1, `${patch.id} never released in the live Hill route`);
    }
    assert.ok(
      last.motion.contactLocomotion.patches.some(patch => patch.metrics.maximumExtension > 0.02),
      'live Hill route never exercised terrain-conditioned support reach',
    );
  }
  assert.ok(
    frames.some(frame => frame.debug.motion.contactLocomotion.patches.some(patch => patch.state === 'stance')),
    'contact witness never captured a planted patch',
  );
  assert.ok(last.performance.smoothedFps >= 30, `motion cadence remained below 30 fps (${last.performance.smoothedFps.toFixed(1)})`);
  assert.ok(last.performance.lastDeformationMs < 20, `batch deformation remained above 20 ms (${last.performance.lastDeformationMs.toFixed(1)} ms)`);
  const initialRoot = frames[0].debug.motion.root;
  const finalRoot = frames.at(-1).debug.motion.root;
  const translationDistance = Math.hypot(
    finalRoot[0] - initialRoot[0],
    finalRoot[1] - initialRoot[1],
    finalRoot[2] - initialRoot[2],
  );
  assert.ok(
    translationDistance > 0.5,
    `cast translated only ${translationDistance.toFixed(3)} world units`,
  );

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
