#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

const requestedUrl = args.get('--url') || 'http://127.0.0.1:8097/stage-atoms-browser.html';
const outputPath = resolve(args.get('--out') || 'artifacts/stage-atoms/browser-witness/stage-atoms-live.png');
const reportPath = resolve(args.get('--report') || outputPath.replace(/\.png$/i, '.json'));
const debugPort = Number(args.get('--debug-port') || 9498);
const viewportWidth = Number(args.get('--viewport-width') || 1600);
const viewportHeight = Number(args.get('--viewport-height') || 980);
const settleMs = Number(args.get('--settle-ms') || 900);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-stage-atoms-witness-${debugPort}-${process.pid}`;

let phase = 'initializing';
let primaryOutputWritten = false;
let effectiveUrl = null;
let browserVersion = null;
let stderr = '';
let debugState = null;
let playbackState = null;
let visualActivity = null;
let controlBounds = null;
let handleEvidence = null;
const networkResponses = [];
const consoleEvents = [];

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

function writeReport(extra = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({
    schema: 'kaminos.stage-atoms-browser-witness.v0',
    requestedUrl,
    effectiveUrl,
    routeIdentity: 'stage-atoms-pulp-shaped-material-spatializer-v0',
    debugPort,
    chrome,
    browserVersion,
    viewport: { width: viewportWidth, height: viewportHeight },
    settleMs,
    phase,
    primaryOutputWritten,
    outputPath,
    reportPath,
    networkResponses,
    visualActivity,
    controlBounds,
    handleEvidence,
    debugState,
    playbackState,
    consoleEvents,
    stderrTail: stderr.slice(-2400),
    ...extra,
  }, null, 2)}\n`);
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(100);
    }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(candidate => candidate.type === 'page');
    if (page) return page;
    await delay(100);
  }
  throw new Error('Chrome page target did not appear');
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      ws.removeEventListener('message', onMessage);
      rejectRequest(new Error(`${method}: CDP request timed out`));
    }, 15000);
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      ws.removeEventListener('message', onMessage);
      if (message.error) rejectRequest(new Error(`${method}: ${message.error.message}`));
      else resolveRequest(message.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

async function evaluate(ws, expression) {
  const result = await wsRequest(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

function attachEventReceipts(ws) {
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Network.responseReceived') {
      const response = message.params.response;
      if (/stage-atoms|coruscate-geppetto/i.test(response.url)) {
        networkResponses.push({
          url: response.url,
          status: response.status,
          mimeType: response.mimeType,
          fromDiskCache: response.fromDiskCache,
          fromServiceWorker: response.fromServiceWorker,
        });
      }
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        type: message.params.type,
        text: (message.params.args || []).map(value => value.value || value.description || '').join(' '),
      });
    }
    if (message.method === 'Runtime.exceptionThrown') {
      consoleEvents.push({
        type: 'exception',
        text: message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'runtime exception',
      });
    }
  });
}

function verifyDebugState(state) {
  if (!state) throw new Error('missing window.kaminosStageAtomsDebugState');
  if (state.status !== 'live') throw new Error(`Stage Atoms route is not live: ${state.status}`);
  if (state.effectiveRoute !== 'stage-atoms-pulp-shaped-material-spatializer-v0') throw new Error(`effective route mismatch: ${state.effectiveRoute}`);
  if (state.fallbackAuthority !== 'none') throw new Error(`fallbackAuthority is not none: ${state.fallbackAuthority}`);
  if (!state.decodedSha256 || state.decodedSha256 !== state.downloadSha256) throw new Error('download/decode hashes are absent or unequal');
  if (state.featureFrame?.index === undefined) throw new Error('decoded audio feature frame missing');
  if (state.materialFrame?.featureAuthority !== 'decoded-audio-clock-frame-v0') throw new Error(`material feature authority mismatch: ${state.materialFrame?.featureAuthority}`);
  if (state.spatialization?.spatializationAuthority !== 'material-stage-atoms-v0') throw new Error(`spatialization authority mismatch: ${state.spatialization?.spatializationAuthority}`);
}

async function main() {
  const chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--autoplay-policy=no-user-gesture-required',
    `--window-size=${viewportWidth},${viewportHeight}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    phase = 'connect_cdp';
    browserVersion = await waitForCdp();
    const target = await waitForTarget();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    attachEventReceipts(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    await wsRequest(ws, 'Network.enable');
    await wsRequest(ws, 'Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });

    phase = 'navigate';
    await wsRequest(ws, 'Page.navigate', { url: requestedUrl });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      debugState = await evaluate(ws, 'window.kaminosStageAtomsDebugState || null');
      if (debugState?.status === 'live' || debugState?.status === 'failed') break;
      await delay(200);
    }
    effectiveUrl = await evaluate(ws, 'window.location.href');
    verifyDebugState(debugState);
    const selectedTime = debugState.representativeSelection?.effectiveTimeSeconds;
    if (!Number.isFinite(selectedTime) || Math.abs(debugState.audioClock.timeSeconds - selectedTime) > 0.15) {
      throw new Error(`representative seek not settled: selected=${selectedTime} audio=${debugState.audioClock.timeSeconds}`);
    }
    await delay(settleMs);

    phase = 'inspect_pixels';
    visualActivity = await evaluate(ws, `(() => {
      const canvas = document.querySelector('#stage-atoms-canvas');
      if (!canvas || !canvas.width || !canvas.height) return { activePixels: 0, reason: 'missing_canvas' };
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let activePixels = 0;
      let coloredPixels = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        const max = Math.max(pixels[index], pixels[index + 1], pixels[index + 2]);
        const min = Math.min(pixels[index], pixels[index + 1], pixels[index + 2]);
        if (max > 48) activePixels += 1;
        if (max > 78 && max - min > 20) coloredPixels += 1;
      }
      return { width: canvas.width, height: canvas.height, activePixels, coloredPixels };
    })()`);
    if (visualActivity.activePixels < 1000 || visualActivity.coloredPixels < 200) {
      throw new Error(`material canvas failed pixel activity check: ${JSON.stringify(visualActivity)}`);
    }

    phase = 'inspect_control_bounds';
    controlBounds = await evaluate(ws, `(() => {
      const rail = document.querySelector('.instrument-rail').getBoundingClientRect();
      const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
      const controls = ['stage-atoms-coupling', 'stage-atoms-memory', 'stage-atoms-depth', 'stage-atoms-play', 'stage-atoms-seek'].map(id => {
        const rect = document.getElementById(id).getBoundingClientRect();
        const inViewport = rect.left >= viewport.left && rect.top >= viewport.top && rect.right <= viewport.right && rect.bottom <= viewport.bottom;
        const inRail = id === 'stage-atoms-play' || id === 'stage-atoms-seek'
          ? true
          : rect.left >= rail.left && rect.top >= rail.top && rect.right <= rail.right && rect.bottom <= rail.bottom;
        return { id, rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, inViewport, inRail };
      });
      return { rail: { left: rail.left, top: rail.top, right: rail.right, bottom: rail.bottom }, controls, outOfBounds: controls.filter(control => !control.inViewport || !control.inRail).map(control => control.id) };
    })()`);
    if (controlBounds.outOfBounds.length) throw new Error(`controls clipped or outside viewport: ${JSON.stringify(controlBounds)}`);

    phase = 'exercise_material_handles';
    const handleBefore = await evaluate(ws, `(() => ({
      controls: window.kaminosStageAtomsDebugState.controls,
      materialAtoms: window.kaminosStageAtomsDebugState.materialFrame.materialAtoms,
      emitters: window.kaminosStageAtomsDebugState.spatialization.emitters,
    }))()`);
    await evaluate(ws, `(() => {
      const values = { coupling: 0.35, memory: 0.4, depth: 0.5 };
      for (const [name, value] of Object.entries(values)) {
        const input = document.getElementById('stage-atoms-' + name);
        input.value = String(value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await delay(160);
    const handleAfter = await evaluate(ws, `(() => ({
      controls: window.kaminosStageAtomsDebugState.controls,
      materialAtoms: window.kaminosStageAtomsDebugState.materialFrame.materialAtoms,
      emitters: window.kaminosStageAtomsDebugState.spatialization.emitters,
    }))()`);
    const beforeHeat = handleBefore.materialAtoms.reduce((sum, atom) => sum + atom.field.heat, 0);
    const afterHeat = handleAfter.materialAtoms.reduce((sum, atom) => sum + atom.field.heat, 0);
    const beforeMemory = handleBefore.materialAtoms.reduce((sum, atom) => sum + atom.field.feedbackMemory, 0);
    const afterMemory = handleAfter.materialAtoms.reduce((sum, atom) => sum + atom.field.feedbackMemory, 0);
    const beforePan = handleBefore.emitters.map(emitter => emitter.send.pan);
    const afterPan = handleAfter.emitters.map(emitter => emitter.send.pan);
    handleEvidence = {
      before: { controls: handleBefore.controls, totalHeat: beforeHeat, totalFeedbackMemory: beforeMemory, emitterPan: beforePan },
      after: { controls: handleAfter.controls, totalHeat: afterHeat, totalFeedbackMemory: afterMemory, emitterPan: afterPan },
      materialChanged: Math.abs(beforeHeat - afterHeat) > 0.001 || Math.abs(beforeMemory - afterMemory) > 0.001,
      spatializationChanged: JSON.stringify(beforePan) !== JSON.stringify(afterPan),
    };
    if (!handleEvidence.materialChanged || !handleEvidence.spatializationChanged) {
      throw new Error(`live handles did not change material and spatial state: ${JSON.stringify(handleEvidence)}`);
    }
    await evaluate(ws, `(() => {
      for (const name of ['coupling', 'memory', 'depth']) {
        const input = document.getElementById('stage-atoms-' + name);
        input.value = '1';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    })()`);
    await delay(160);

    phase = 'exercise_audio_handle';
    const playRect = await evaluate(ws, `(() => {
      const rect = document.querySelector('#stage-atoms-play').getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: playRect.x, y: playRect.y, button: 'left', clickCount: 1 });
    await wsRequest(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: playRect.x, y: playRect.y, button: 'left', clickCount: 1 });
    const playbackStart = debugState.audioClock.timeSeconds;
    await delay(1200);
    playbackState = await evaluate(ws, 'window.kaminosStageAtomsDebugState');
    verifyDebugState(playbackState);
    if (playbackState.audioClock.paused) throw new Error('play handle did not start verified source audio');
    if (playbackState.audioClock.timeSeconds <= playbackStart + 0.4) throw new Error('audio clock did not advance after play handle');
    if (playbackState.audioGraph?.sendCount <= 0) throw new Error('material spatialization created no audio sends');
    if (playbackState.audioGraph?.outputRms <= 0.0001 || playbackState.audioGraph?.outputPeak <= 0.0001) {
      throw new Error(`post-spatialization audio output is silent: ${JSON.stringify(playbackState.audioGraph)}`);
    }

    phase = 'verify_network';
    const reportResponse = networkResponses.find(response => response.url.includes('ccmixter-geppetto-decoded-stage-atoms-witness.json'));
    const audioResponse = networkResponses.find(response => response.url.includes('coruscate-geppetto-dry-main.mp3'));
    if (!reportResponse || reportResponse.status !== 200) throw new Error('decoded report network response missing');
    if (!audioResponse || audioResponse.status !== 200 || !audioResponse.mimeType.startsWith('audio/')) throw new Error('verified audio network response missing');

    phase = 'capture_screenshot';
    const screenshot = await wsRequest(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const png = Buffer.from(screenshot.data, 'base64');
    if (png.byteLength < 4096 || png.readUInt32BE(0) !== 0x89504e47) throw new Error('captured screenshot is not credible PNG evidence');
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, png);
    primaryOutputWritten = true;
    phase = null;
    writeReport({ ok: true });
    ws.close();
  } finally {
    chromeProcess.kill('SIGTERM');
  }
}

main().catch(error => {
  writeReport({ ok: false, error: String(error?.message || error) });
  console.error(error);
  process.exitCode = 1;
});
