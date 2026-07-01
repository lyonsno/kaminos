#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const FILMSTRIP_WITNESS_IDENTITY = 'kaminos-volume-filmstrip-witness-v0';
const CAPTURE_CADENCE = 'consecutive-requestAnimationFrame-no-intentional-skip';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i], process.argv[i + 1]);
}

const url = args.get('--url') || 'http://127.0.0.1:8095/?kaminos_volume_smoke=1&volume_sim_cadence=4';
const out = resolve(args.get('--out') || '/tmp/kaminos-volume-filmstrip.png');
const reportPath = resolve(args.get('--report') || out.replace(/\.png$/i, '.json'));
const port = Number(args.get('--debug-port') || 9533);
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-volume-filmstrip-profile-${port}`;
const settleMs = Number(args.get('--settle-ms') || 1500);
const windowSize = args.get('--window-size') || '1280,960';
const frameCountRequested = positiveIntegerArg('--frames', 50);
const frameWidth = positiveIntegerArg('--frame-width', 160);
const frameHeight = positiveIntegerArg('--frame-height', 120);
const columns = positiveIntegerArg('--columns', 10);
const mohelAlerts = [];
if (frameCountRequested * frameWidth * frameHeight > 4_000_000) {
  mohelAlerts.push({
    code: 'filmstrip-large-uncapped-flow',
    requestedPixels: frameCountRequested * frameWidth * frameHeight,
    note: 'Filmstrip request is intentionally uncapped; large outputs may stress CDP/base64 transport.',
  });
}
const routeParams = new URL(url).searchParams;
const requestedSimCadence = Number(routeParams.get('volume_sim_cadence') || 1);
const expectedSimCadence = Number.isFinite(requestedSimCadence)
  ? Math.max(1, Math.min(8, Math.round(requestedSimCadence)))
  : 1;

function positiveIntegerArg(name, fallback) {
  const value = Number(args.get(name) || fallback);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.round(value);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cdpFetch(path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!res.ok) throw new Error(`CDP ${path} failed: ${res.status}`);
  return res.json();
}

async function waitForCdp() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(100);
    }
  }
  throw new Error('Timed out waiting for Chrome CDP');
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

function writeFailureReport({ captureFailurePhase, error, state = null, partialCapture = null }) {
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    identity: FILMSTRIP_WITNESS_IDENTITY,
    requestedRoute: url,
    requestedSimCadence: expectedSimCadence,
    mohelAlerts,
    stripImage: out,
    captureCadence: CAPTURE_CADENCE,
    captureFailurePhase,
    error: error?.message || String(error),
    state,
    partialCapture,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  return report;
}

function browserCaptureExpression(options) {
  return `(${async function captureFilmstrip(opts) {
    const prototype = window.__kaminosVolumePrototype;
    if (!prototype?.debugState || !prototype?.canvasElement) {
      throw new Error('volume prototype debug/canvas surface missing');
    }
    const source = prototype.canvasElement();
    if (!source || source.width < 1 || source.height < 1) {
      throw new Error('volume canvas missing or zero-sized');
    }
    const frameCount = opts.frameCountRequested;
    const frameWidth = opts.frameWidth;
    const frameHeight = opts.frameHeight;
    const columns = opts.columns;
    const rows = Math.ceil(frameCount / columns);
    const strip = document.createElement('canvas');
    strip.width = columns * frameWidth;
    strip.height = rows * frameHeight;
    const stripCtx = strip.getContext('2d', { willReadFrequently: true });
    const frameCanvas = document.createElement('canvas');
    frameCanvas.width = frameWidth;
    frameCanvas.height = frameHeight;
    const frameCtx = frameCanvas.getContext('2d', { willReadFrequently: true });
    const frames = [];
    let previousFrameCount = prototype.debugState().frameCount;
    let previousPixels = null;

    function metricsForFrame(image) {
      let litPixels = 0;
      let fireLikePixels = 0;
      let smokeLikePixels = 0;
      let meanLuma = 0;
      let hash = 2166136261;
      let changed = 0;
      let sampled = 0;
      for (let y = 0; y < image.height; y += 2) {
        for (let x = 0; x < image.width; x += 2) {
          const i = (y * image.width + x) * 4;
          const r = image.data[i];
          const g = image.data[i + 1];
          const b = image.data[i + 2];
          const a = image.data[i + 3];
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          meanLuma += lum;
          sampled += 1;
          if (lum > 10 && a > 16) litPixels += 1;
          if (r > 105 && g > 55 && b < 95) fireLikePixels += 1;
          if (b > 18 && g > 18 && r < 110 && Math.abs(g - b) < 65) smokeLikePixels += 1;
          hash ^= r; hash = Math.imul(hash, 16777619);
          hash ^= g; hash = Math.imul(hash, 16777619);
          hash ^= b; hash = Math.imul(hash, 16777619);
          if (previousPixels) {
            const dr = Math.abs(r - previousPixels[i]);
            const dg = Math.abs(g - previousPixels[i + 1]);
            const db = Math.abs(b - previousPixels[i + 2]);
            if (dr + dg + db > 12) changed += 1;
          }
        }
      }
      return {
        meanLuma: meanLuma / Math.max(1, sampled),
        litPixels,
        fireLikePixels,
        smokeLikePixels,
        pixelHash: (hash >>> 0).toString(16).padStart(8, '0'),
        changedPixelRatioFromPrevious: previousPixels ? changed / Math.max(1, sampled) : null,
      };
    }

    async function waitForNextVolumeFrame() {
      const started = performance.now();
      while (performance.now() - started < 3000) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const state = prototype.debugState();
        if (state.frameCount !== previousFrameCount) return state;
      }
      throw new Error('timed out waiting for next volume render frame');
    }

    for (let i = 0; i < frameCount; i += 1) {
      const state = await waitForNextVolumeFrame();
      frameCtx.fillStyle = 'black';
      frameCtx.fillRect(0, 0, frameWidth, frameHeight);
      frameCtx.drawImage(source, 0, 0, frameWidth, frameHeight);
      const image = frameCtx.getImageData(0, 0, frameWidth, frameHeight);
      const metrics = metricsForFrame(image);
      previousPixels = new Uint8ClampedArray(image.data);
      const renderFrameDelta = state.frameCount - previousFrameCount;
      const col = i % columns;
      const row = Math.floor(i / columns);
      stripCtx.drawImage(frameCanvas, col * frameWidth, row * frameHeight);
      stripCtx.fillStyle = 'rgba(0,0,0,0.68)';
      stripCtx.fillRect(col * frameWidth, row * frameHeight, frameWidth, 24);
      stripCtx.fillStyle = expectedVisualAuthority(state) === 'continuation' ? '#67d6ff' : '#ffffff';
      stripCtx.font = '10px monospace';
      stripCtx.fillText(`${i.toString().padStart(2, '0')} f${state.frameCount} s${state.simStepCount}`, col * frameWidth + 4, row * frameHeight + 10);
      stripCtx.fillText(`c${state.simCadence} p${Number(state.cadencePhase || 0).toFixed(2)}`, col * frameWidth + 4, row * frameHeight + 21);
      frames.push({
        index: i,
        captureTimeMs: performance.now(),
        renderFrameDelta,
        frameCount: state.frameCount,
        simStepCount: state.simStepCount,
        simCadence: state.simCadence,
        effectiveVisualAuthority: state.effectiveVisualAuthority,
        continuationAuthority: state.continuationAuthority,
        cadencePhase: state.cadencePhase,
        framesSinceLiveSim: state.framesSinceLiveSim,
        cadenceNativeContinuationIdentity: state.cadenceNativeContinuationIdentity,
        metrics,
      });
      previousFrameCount = state.frameCount;
    }

    function expectedVisualAuthority(state) {
      return state.simCadence > 1 ? 'continuation' : 'live-sim';
    }

    const finalState = prototype.debugState();
    return {
      stripPngBase64: strip.toDataURL('image/png').replace(/^data:image\/png;base64,/, ''),
      sourceCanvas: { width: source.width, height: source.height },
      finalState,
      frames,
    };
  }})(${JSON.stringify(options)})`;
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
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore' });

  let ws = null;
  let phase = 'launch';
  try {
    await waitForCdp();
    phase = 'target';
    const targets = await cdpFetch('/json/list');
    const page = targets.find(t => t.type === 'page' && t.url.includes('kaminos_volume_smoke=1')) || targets.find(t => t.type === 'page');
    if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable page target');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    await waitForWebSocketOpen(ws);
    await wsRequest(ws, 'Runtime.enable');
    await wsRequest(ws, 'Page.enable');
    phase = 'load';
    await wsRequest(ws, 'Page.navigate', { url });
    await wsRequest(ws, 'Page.bringToFront');
    await delay(settleMs);
    phase = 'identity';
    const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: 'window.__kaminosVolumePrototype?.debugState?.()',
      returnByValue: true,
    });
    const state = stateEval.result.value;
    assert.ok(state?.active, 'volume route is not active');
    assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'unexpected effective volume route');
    assert.notEqual(state.backend, 'unavailable', 'volume backend is unavailable');
    assert.equal(state.simCadence, expectedSimCadence, 'effective sim cadence does not match volume_sim_cadence route');
    if (expectedSimCadence > 1) {
      assert.equal(state.effectiveVisualAuthority, 'continuation', 'low-cadence route must expose continuation authority');
      assert.equal(state.cadenceNativeContinuationIdentity, 'cadence-native-field-continuation-v0', 'cadence-native continuation identity is missing');
    }

    phase = 'filmstrip-capture';
    const captureEval = await wsRequest(ws, 'Runtime.evaluate', {
      expression: browserCaptureExpression({ frameCountRequested, frameWidth, frameHeight, columns }),
      awaitPromise: true,
      returnByValue: true,
    });
    if (captureEval.exceptionDetails) {
      throw new Error(captureEval.exceptionDetails.text || 'filmstrip capture threw in page');
    }
    const capture = captureEval.result.value;
    writeFileSync(out, Buffer.from(capture.stripPngBase64, 'base64'));

    phase = 'validate';
    const frames = capture.frames || [];
    assert.equal(frames.length, frameCountRequested, 'filmstrip did not capture requested frame count');
    const frameDeltas = frames.map(frame => frame.renderFrameDelta);
    const skippedRenderFrameCount = frameDeltas.filter(delta => delta !== 1).length;
    const blankFrameCount = frames.filter(frame => (
      frame.metrics.meanLuma < 0.75 &&
      frame.metrics.litPixels < 3 &&
      frame.metrics.fireLikePixels < 1 &&
      frame.metrics.smokeLikePixels < 1
    )).length;
    const duplicatePixelFrameCount = frames.slice(1).filter(frame => frame.metrics.changedPixelRatioFromPrevious === 0).length;
    assert.equal(blankFrameCount, 0, 'filmstrip contains blank frames');
    assert.equal(skippedRenderFrameCount, 0, 'filmstrip skipped or duplicated render frame ids');
    if (expectedSimCadence > 1) {
      assert.ok(frames.some(frame => frame.cadencePhase > 0), 'filmstrip never captured a held continuation phase');
      assert.ok(frames.some(frame => frame.renderFrameDelta === 1 && frame.framesSinceLiveSim > 0), 'filmstrip never captured a frame since live sim');
    }

    const report = {
      identity: FILMSTRIP_WITNESS_IDENTITY,
      requestedRoute: url,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      captureCadence: CAPTURE_CADENCE,
      requestedSimCadence: expectedSimCadence,
      frameCountRequested,
      frameWidth,
      frameHeight,
      columns,
      mohelAlerts,
      sourceCanvas: capture.sourceCanvas,
      stripImage: out,
      finalState: capture.finalState,
      frameDeltas,
      skippedRenderFrameCount,
      blankFrameCount,
      duplicatePixelFrameCount,
      cadenceNativeContinuationIdentity: capture.finalState?.cadenceNativeContinuationIdentity,
      effectiveVisualAuthority: capture.finalState?.effectiveVisualAuthority,
      continuationAuthority: capture.finalState?.continuationAuthority,
      frames,
    };
    writeFileSync(reportPath, JSON.stringify(report, null, 2));
    ws.close();
    proc.kill('SIGTERM');
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    let state = null;
    try {
      if (ws) {
        const stateEval = await wsRequest(ws, 'Runtime.evaluate', {
          expression: 'window.__kaminosVolumePrototype?.debugState?.()',
          returnByValue: true,
        });
        state = stateEval.result.value || null;
      }
    } catch {
      state = null;
    }
    const report = writeFailureReport({
      captureFailurePhase: phase,
      error,
      state,
    });
    if (ws) ws.close();
    proc.kill('SIGTERM');
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
}

await main();
