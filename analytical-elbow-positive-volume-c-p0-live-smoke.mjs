#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';

const ROUTE = 'analytical-elbow-positive-volume-c-p0-witness';
const SCHEMA = 'kaminos.analytical-elbow-positive-volume-c-p0-live-smoke.v0';

export function receiptAfterCleanupFailure(receipt, error) {
  return {
    ...receipt,
    status:receipt?.primaryOutput
      ? 'captured_with_cleanup_failure'
      : 'failed',
    failurePhase:'browser-cleanup',
    cleanupError:error?.stack || error?.message || String(error),
  };
}

export function validateCP0SmokeState(state, {
  expectedCamera,
  expectedOverlays,
  expectedSourceSha256,
}) {
  assert.equal(state?.status, 'complete', 'live witness did not complete');
  assert.equal(state?.requestedRoute, ROUTE, 'wrong requested route');
  assert.equal(state?.effectiveRoute, ROUTE, 'wrong effective route');
  assert.equal(state?.fallbackUsed, false, 'live witness used a fallback route');
  assert.equal(
    state?.sourceArtifactSha256,
    expectedSourceSha256,
    'live witness consumed the wrong source artifact',
  );
  assert.equal(state?.paused, true, 'visual admission witness must start paused');
  assert.equal(state?.animationActive, false, 'visual admission witness must remain static');
  assert.equal(state?.cameraPreset, expectedCamera, 'wrong camera preset rendered');
  assert.deepEqual(state?.overlays, expectedOverlays, 'wrong visual overlays rendered');
  assert.equal(state?.panels?.length, 2, 'visual admission requires two rendered panels');
  for (const panel of state.panels) {
    assert.equal(panel.vertexCount, 986, `${panel.id} has the wrong vertex count`);
    assert.equal(panel.triangleCount, 1968, `${panel.id} has the wrong triangle count`);
    assert.ok(panel.drawCount >= 1, `${panel.id} never rendered`);
  }
}

export function validateCP0SmokePixels(panels) {
  assert.equal(panels?.length, 2, 'pixel smoke requires two canvases');
  for (const [index, panel] of panels.entries()) {
    assert.ok(panel.width > 0 && panel.height > 0, `canvas ${index} has no dimensions`);
    assert.ok(
      panel.coloredPixels >= 1000,
      `canvas ${index} is blank or lacks visible witness geometry`,
    );
  }
}

class CdpSocket {
  constructor(url) {
    this.url = url;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
  }
  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once:true });
      this.socket.addEventListener('error', reject, { once:true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id || !this.pending.has(message.id)) return;
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }
  call(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve:resolveCall, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket?.close(); }
}

async function evaluate(socket, expression) {
  const result = await socket.call('Runtime.evaluate', {
    expression,
    awaitPromise:true,
    returnByValue:true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || 'browser evaluation failed');
  }
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function waitForTarget(port, timeoutMs) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = response.ok ? await response.json() : [];
      const target = targets.find(entry =>
        entry.type === 'page' && !String(entry.url).startsWith('chrome-extension://')
      );
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function run() {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (key.startsWith('--') && value && !value.startsWith('--')) {
      args.set(key, value);
      index += 1;
    }
  }
  const url = args.get('--url');
  const screenshotPath = resolve(args.get('--screenshot') || '/tmp/c-p0-smoke.png');
  const reportPath = resolve(args.get('--report') || '/tmp/c-p0-smoke.json');
  const expectedSourceSha256 = args.get('--expected-source-sha');
  const timeoutMs = Number(args.get('--timeout-ms') || 30000);
  if (!url || !expectedSourceSha256) {
    throw new Error('--url and --expected-source-sha are required');
  }
  const expectedCamera = new URL(url).searchParams.get('camera') || 'profile';
  const urlParams = new URL(url).searchParams;
  const expectedOverlays = {
    regions:urlParams.get('regions') !== '0',
    wireframe:urlParams.get('wire') === '1',
    rest:urlParams.get('rest') === '1',
  };
  const port = randomInt(42000, 62000);
  const profileDir = `/tmp/kaminos-c-p0-smoke-${process.pid}-${port}`;
  let browser = null;
  let socket = null;
  let failurePhase = 'browser-launch';
  let lastTrustworthyEvidence = null;
  let runError = null;
  let durableReceipt = null;
  let successSummary = null;
  mkdirSync(dirname(screenshotPath), { recursive:true });
  mkdirSync(dirname(reportPath), { recursive:true });
  try {
    browser = spawn(chromeExecutable(), [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${port}`,
      '--window-size=1440,900',
      'about:blank',
    ], { stdio:'ignore' });
    const target = await waitForTarget(port, timeoutMs);
    socket = new CdpSocket(target.webSocketDebuggerUrl);
    await socket.open();
    await socket.call('Page.enable');
    await socket.call('Runtime.enable');
    failurePhase = 'route-load';
    await socket.call('Page.navigate', { url });
    const started = performance.now();
    let state = null;
    while (performance.now() - started < timeoutMs) {
      state = await evaluate(socket, 'window.__KAMINOS_C_P0_WITNESS__ ?? null');
      lastTrustworthyEvidence = state;
      if (state?.status === 'complete') break;
      await delay(100);
    }
    validateCP0SmokeState(state, {
      expectedCamera,
      expectedOverlays,
      expectedSourceSha256,
    });
    failurePhase = 'canvas-readback';
    const pixels = await evaluate(socket, `Array.from(document.querySelectorAll('canvas')).map(canvas=>{const gl=canvas.getContext('webgl2')||canvas.getContext('webgl');if(!gl)return {width:canvas.width,height:canvas.height,sampledPixels:0,coloredPixels:0};const rgba=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,rgba);let coloredPixels=0;for(let i=0;i<rgba.length;i+=4){const high=Math.max(rgba[i],rgba[i+1],rgba[i+2]);const low=Math.min(rgba[i],rgba[i+1],rgba[i+2]);if(high>45&&high-low>8)coloredPixels++;}return {width:canvas.width,height:canvas.height,sampledPixels:canvas.width*canvas.height,coloredPixels};})`);
    validateCP0SmokePixels(pixels);
    failurePhase = 'screenshot-capture';
    const capture = await socket.call('Page.captureScreenshot', {
      format:'png',
      captureBeyondViewport:false,
    });
    writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
    const screenshotSha256 = createHash('sha256')
      .update(readFileSync(screenshotPath))
      .digest('hex');
    durableReceipt = {
      schema:SCHEMA,
      status:'captured',
      failurePhase:null,
      requestedUrl:url,
      effectiveRoute:state.effectiveRoute,
      fallbackUsed:state.fallbackUsed,
      sourceArtifactSha256:state.sourceArtifactSha256,
      cameraPreset:state.cameraPreset,
      overlays:state.overlays,
      paused:state.paused,
      animationActive:state.animationActive,
      panels:state.panels,
      canvasPixels:pixels,
      screenshot:screenshotPath,
      screenshotSha256,
      primaryOutput:screenshotPath,
      claimCeiling:'route, source, geometry, paused-state, and nonblank-pixel witness only; visual admission remains a human-readable judgment',
    };
    writeFileSync(reportPath, `${JSON.stringify(durableReceipt, null, 2)}\n`);
    successSummary = { ok:true, report:reportPath, screenshot:screenshotPath };
  } catch (error) {
    durableReceipt = {
      schema:SCHEMA,
      status:'failed',
      failurePhase,
      requestedUrl:url,
      error:error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
      primaryOutput:null,
    };
    writeFileSync(reportPath, `${JSON.stringify(durableReceipt, null, 2)}\n`);
    runError = error;
  } finally {
    try { socket?.close(); } catch {}
    browser?.kill('SIGTERM');
    try {
      rmSync(profileDir, {
        recursive:true,
        force:true,
        maxRetries:5,
        retryDelay:100,
      });
    } catch (cleanupError) {
      durableReceipt = receiptAfterCleanupFailure(durableReceipt, cleanupError);
      writeFileSync(reportPath, `${JSON.stringify(durableReceipt, null, 2)}\n`);
      runError ??= cleanupError;
    }
  }
  if (runError) throw runError;
  console.log(JSON.stringify(successSummary, null, 2));
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch(error => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}
