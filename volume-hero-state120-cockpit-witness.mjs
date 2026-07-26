#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';

class CdpSocket {
  constructor(url, callTimeoutMs) {
    this.url = url;
    this.callTimeoutMs = callTimeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`CDP call timed out: ${method}`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.socket?.close();
  }
}

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(String(args.get('--repo-root') || import.meta.dirname));
const routeReceiptPath = resolve(String(
  args.get('--route-receipt')
    || join(repoRoot, 'scratch/hero-state120-cockpit-18831/route-receipt.json'),
));
const outputDirectory = resolve(String(
  args.get('--output') || join(repoRoot, 'artifacts/hero-state120-cockpit-smoke/live'),
));
const timeoutMs = Number(args.get('--timeout-ms') || 300_000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const viewportWidth = Number(args.get('--viewport-width') || 1668);
const viewportHeight = Number(args.get('--viewport-height') || 960);
const profilePath = `/tmp/kaminos-hero-state120-cockpit-${process.pid}-${Date.now()}`;
const screenshotPath = join(outputDirectory, 'comparator.png');
const splatScreenshotPath = join(outputDirectory, 'splat-only.png');
const targetScreenshotPath = join(outputDirectory, 'raymarch-target-only.png');
const reportPath = join(outputDirectory, 'report.json');
const greenroom = '/Users/noahlyons/dev/gpu-greenroom/.venv/bin/gpu-greenroom';
const startedAt = new Date().toISOString();
const authenticatedTargetDecodedPngPixelSha256 =
  'a24f7693046f115b53e1864db0bba5930332f86323ad9773178cd301fffafaef';
const upstreamRenderReportTargetPixelSha256 =
  'f19fbd6489c935dde37bc6c0c82bf1fe9b438a0f0b3a64b8cfa43ed8c221f58f';

mkdirSync(outputDirectory, { recursive: true });

const requestedBrowserViewport = {
  width: viewportWidth,
  height: viewportHeight,
};
const requiredHostViewport = {
  width: 1668,
  height: 960,
};
let failurePhase = 'viewport-admission';
let browser = null;
let socket = null;
let lease = null;
let lastTrustworthyEvidence = {
  routeReceiptPath,
  requestedBrowserViewport,
  requiredHostViewport,
};

try {
  assert.ok(
    Number.isInteger(viewportWidth) && viewportWidth >= requiredHostViewport.width,
    `Hero witness viewport width must contain the authenticated shell:${viewportWidth}`,
  );
  assert.ok(
    Number.isInteger(viewportHeight) && viewportHeight >= requiredHostViewport.height,
    `Hero witness viewport height must contain the authenticated shell:${viewportHeight}`,
  );
  failurePhase = 'route-admission';
  assert.equal(existsSync(routeReceiptPath), true, 'authenticated Hero route receipt is missing');
  const routeReceipt = JSON.parse(readFileSync(routeReceiptPath, 'utf8'));
  assert.equal(routeReceipt.status, 'serving', 'authenticated Hero route is not serving');
  assert.equal(routeReceipt.request?.routeIdentity, 'kaminos.volume.authenticated-hero-state120-cockpit.v0');
  assert.equal(routeReceipt.request?.stateId, 'coefficient-state-120');
  assert.equal(routeReceipt.request?.fixedState, true);
  assert.equal(routeReceipt.request?.cohortSha256, '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20');
  assert.equal(routeReceipt.request?.raymarchTargetSha256, 'c8dc4dc0ab4b324a872989adf112cb5a87cf9e3083115fa5489615b2397e2dc7');
  const targetSourceUrl = new URL(
    routeReceipt.request.raymarchTarget,
    routeReceipt.effectiveRoute,
  ).href;
  const targetSourceResponse = await fetch(targetSourceUrl, { cache: 'no-store' });
  assert.equal(targetSourceResponse.ok, true, `authenticated Hero target fetch failed:${targetSourceResponse.status}`);
  const targetSourceBytes = Buffer.from(await targetSourceResponse.arrayBuffer());
  const actualServedTargetSha256 = createHash('sha256').update(targetSourceBytes).digest('hex');
  assert.equal(
    actualServedTargetSha256,
    routeReceipt.request.raymarchTargetSha256,
    'actual served Hero target bytes do not match the authenticated source',
  );
  const targetSourceDecoded = decodePngRgba(targetSourceBytes);
  const actualServedTargetRawPixelSha256 = createHash('sha256')
    .update(targetSourceDecoded.rgba)
    .digest('hex');
  assert.equal(
    actualServedTargetRawPixelSha256,
    authenticatedTargetDecodedPngPixelSha256,
    'actual served Hero target pixels do not match the authenticated source decoder identity',
  );
  const targetSourceReceipt = {
    requestedTargetUrl: routeReceipt.request.raymarchTarget,
    effectiveTargetUrl: targetSourceResponse.url || targetSourceUrl,
    requestedTargetSha256: routeReceipt.request.raymarchTargetSha256,
    actualServedTargetSha256,
    actualServedTargetRawPixelSha256,
    upstreamRenderReportTargetPixelSha256,
    upstreamRenderReportTargetPixelAuthority:
      'render-report-pre-png-target-buffer-claim-not-decoded-png-v0',
    byteLength: targetSourceBytes.byteLength,
    cacheMode: 'no-store',
  };
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, routeReceipt, targetSourceReceipt };

  failurePhase = 'greenroom-lease';
  lease = JSON.parse(execFileSync(greenroom, [
    'lease', 'claim',
    '--owner', 'pyro-integration',
    '--agent-id', 'pyro-integration',
    '--repo-root', repoRoot,
    '--pid', String(process.pid),
    '--process-group', String(process.pid),
    '--effective-route', 'headless-owned-cdp authenticated-state120-hero-cockpit',
    '--backend', 'webgpu',
    '--device', 'apple-gpu',
    '--profile', 'interactive-render',
    '--supports-checkpoints',
    '--ttl-seconds', '600',
  ], { encoding: 'utf8' }));

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profilePath}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs, browser);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: routeReceipt.effectiveRoute });

  failurePhase = 'runtime-admission';
  const runtime = await waitForValue(socket, timeoutMs, `(() => {
    const state = window.__kaminosSelectiveHeadLive?.debugState?.();
    const receipt = state?.heroState120RuntimeReceipt;
    const visible = getComputedStyle(document.querySelector('#basin')).visibility;
    if (receipt?.status !== 'exact-fixed-pair' || visible !== 'visible') return null;
    return {
      pageStatus: state.status,
      backend: state.backend,
      effectiveRoute: window.location.href,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      receipt,
      visible,
      targetComplete: document.querySelector('#hero-target-image')?.complete === true,
      targetNaturalWidth: document.querySelector('#hero-target-image')?.naturalWidth || 0,
      targetNaturalHeight: document.querySelector('#hero-target-image')?.naturalHeight || 0,
      bodyView: document.body.dataset.heroView || null,
      statusText: document.querySelector('#status')?.textContent || null,
      outerViewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, runtime };
  assert.match(runtime.backend, /^WebGPU:/, 'Hero cockpit used a fallback backend');
  assert.equal(runtime.receipt.fallbackReason, null, 'Hero cockpit fallback looked authoritative');
  assert.equal(runtime.receipt.population.candidates, 481447);
  assert.equal(runtime.receipt.population.rasterDeposits, 481447);
  assert.equal(runtime.receipt.population.depositsPerCandidate, 1);
  assert.equal(runtime.receipt.material.radius, 0.98);
  assert.equal(runtime.receipt.material.sharpness, 12);
  assert.equal(runtime.receipt.optics.depthBins, 16);
  assert.equal(runtime.receipt.viewport.effectiveWidth, 1668);
  assert.equal(runtime.receipt.viewport.effectiveHeight, 960);
  assert.equal(runtime.receipt.viewport.canvasWidth, 900);
  assert.equal(runtime.receipt.viewport.canvasHeight, 960);
  assert.deepEqual(runtime.outerViewport, {
    width: viewportWidth,
    height: viewportHeight,
  });
  assert.equal(
    runtime.receipt.source.actualServedTargetSha256,
    actualServedTargetSha256,
    'browser runtime target source receipt drifted from independently fetched bytes',
  );
  assert.equal(
    runtime.receipt.source.targetPresentationSourceAuthority,
    'verified-fetched-bytes-object-url-v0',
  );
  assert.equal(runtime.visible, 'visible');
  assert.equal(runtime.targetComplete, true);
  assert.ok(runtime.targetNaturalWidth > 64 && runtime.targetNaturalHeight > 64, 'Raymarch target image is blank');
  assert.equal(runtime.bodyView, 'split');

  failurePhase = 'visual-capture';
  const canvasClip = await evaluate(socket, `(() => {
    const frame = document.querySelector('#basin');
    const canvas = frame?.contentWindow?.__kaminosVolumePrototype?.canvasElement?.();
    if (!frame || !canvas) throw new Error('hero-volume-canvas-missing');
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      x: frameRect.left + canvasRect.left,
      y: frameRect.top + canvasRect.top,
      width: canvasRect.width,
      height: canvasRect.height,
      scale: 1,
      authority: 'exact-authenticated-hero-canvas-bounds-v0',
    };
  })()`);
  assert.equal(canvasClip.width, 900);
  assert.equal(canvasClip.height, 960);

  await evaluate(socket, `window.__kaminosSelectiveHeadLive.setHeroView('splat')`);
  await waitForAnimationFrames(socket, 2);
  const splatCapture = await capturePng(socket, splatScreenshotPath, canvasClip);
  assert.ok(splatCapture.litPixels > 10_000, 'physical splat canvas is blank');
  assert.ok(splatCapture.meanLuma > 3, 'physical splat canvas has no credible radiance');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, canvasClip, splatCapture };

  await evaluate(socket, `window.__kaminosSelectiveHeadLive.setHeroView('target')`);
  await waitForAnimationFrames(socket, 2);
  const browserTargetCapture = await capturePng(socket, targetScreenshotPath, canvasClip);
  assert.equal(browserTargetCapture.width, 900, 'Raymarch target presentation width drifted');
  assert.equal(browserTargetCapture.height, 960, 'Raymarch target presentation height drifted');
  assert.ok(browserTargetCapture.litPixels > 10_000, 'Raymarch target presentation is blank');
  const targetCapture = {
    ...browserTargetCapture,
    requestedTargetSha256: routeReceipt.request.raymarchTargetSha256,
    actualServedTargetSha256,
    sourcePngSha256: actualServedTargetSha256,
    sourceRawPixelSha256: actualServedTargetRawPixelSha256,
    browserPresentedRawPixelSha256: browserTargetCapture.rawPixelSha256,
    browserPresentationAuthority: 'chrome-color-managed-image-presentation-v0',
  };
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, targetCapture };

  await evaluate(socket, `window.__kaminosSelectiveHeadLive.setHeroView('split')`);
  await waitForAnimationFrames(socket, 2);
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const screenshotBytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(screenshotBytes.byteLength > 50_000, 'Hero comparator screenshot is blank or partial');
  writeFileSync(screenshotPath, screenshotBytes);
  const comparatorCapture = summarizePng(screenshotBytes, screenshotPath);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, comparatorCapture };

  const report = {
    schema: 'kaminos.volume.authenticated-hero-state120-cockpit-witness.v0',
    status: 'passed',
    failurePhase: null,
    startedAt,
    finishedAt: new Date().toISOString(),
    routeReceiptPath,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: routeReceipt.effectiveRoute,
    requestedBrowserViewport,
    runtime,
    targetSourceReceipt,
    canvasClip,
    splatCapture,
    targetCapture,
    comparatorCapture,
    browserEvents: socket.browserEvents,
    lease,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, reportPath, screenshotPath, runtime }, null, 2));
} catch (error) {
  const report = {
    schema: 'kaminos.volume.authenticated-hero-state120-cockpit-witness.v0',
    status: 'failed',
    failurePhase,
    reason: error?.message || String(error),
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedBrowserViewport,
    requiredHostViewport,
    lastTrustworthyEvidence,
    browserExitCode: browser?.exitCode ?? null,
    browserEvents: socket?.browserEvents || [],
    lease,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
  if (lease?.lease_id) {
    try {
      execFileSync(greenroom, [
        'lease', 'release', lease.lease_id,
        '--released-by', 'pyro-integration',
        '--reason', 'authenticated state120 Hero cockpit witness complete',
      ], { stdio: 'ignore' });
    } catch {}
  }
}

async function waitForAnimationFrames(socket, count) {
  await evaluate(socket, `new Promise(resolve => {
    let remaining = ${Number(count)};
    const next = () => {
      remaining -= 1;
      if (remaining <= 0) resolve(true);
      else requestAnimationFrame(next);
    };
    requestAnimationFrame(next);
  })`);
}

async function capturePng(socket, path, clip) {
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  const bytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(bytes.byteLength > 1_000, `Hero canvas screenshot is blank or partial:${path}`);
  const decoded = decodePngRgba(bytes);
  writeFileSync(path, bytes);
  return summarizeDecodedPng(decoded, bytes, path);
}

function summarizePng(bytes, path) {
  return summarizeDecodedPng(decodePngRgba(bytes), bytes, path);
}

function summarizeDecodedPng(decoded, bytes, path) {
  return {
    path,
    width: decoded.width,
    height: decoded.height,
    litPixels: decoded.litPixels,
    litFraction: decoded.litPixels / Math.max(1, decoded.width * decoded.height),
    meanLuma: decoded.meanLuma,
    maximumLuma: decoded.maximumLuma,
    pngSha256: createHash('sha256').update(bytes).digest('hex'),
    rawPixelSha256: createHash('sha256').update(decoded.rgba).digest('hex'),
    byteLength: bytes.byteLength,
  };
}

function decodePngRgba(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.subarray(0, 8).compare(signature), 0, 'Hero canvas screenshot is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  assert.ok(width > 0 && height > 0, 'Hero canvas screenshot PNG omitted dimensions');
  assert.equal(bitDepth, 8, 'Hero canvas screenshot PNG must be 8-bit');
  assert.ok(colorType === 2 || colorType === 6, `unsupported Hero canvas PNG color type:${colorType}`);
  assert.equal(interlace, 0, 'interlaced Hero canvas screenshot PNG is unsupported');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const encoded = inflateSync(Buffer.concat(compressed));
  assert.equal(encoded.length, height * (stride + 1), 'Hero canvas screenshot PNG payload is partial');
  const rgba = new Uint8Array(width * height * 4);
  let prior = Buffer.alloc(stride);
  let litPixels = 0;
  let lumaSum = 0;
  let maximumLuma = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = encoded[rowStart];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[rowStart + 1 + x];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior[x] || 0;
      const upLeft = x >= channels ? prior[x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paethPredictor(left, up, upLeft);
      else assert.equal(filter, 0, `unsupported Hero canvas PNG filter:${filter}`);
      row[x] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = channels === 4 ? row[source + 3] : 255;
      const luma = 0.2126 * rgba[target] + 0.7152 * rgba[target + 1] + 0.0722 * rgba[target + 2];
      if (luma > 3) litPixels += 1;
      lumaSum += luma;
      maximumLuma = Math.max(maximumLuma, luma);
    }
    prior = row;
  }
  return {
    rgba,
    width,
    height,
    litPixels,
    meanLuma: lumaSum / Math.max(1, width * height),
    maximumLuma,
  };
}

function paethPredictor(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Chrome executable is missing');
  return executable;
}

async function waitForTarget(port, waitMs, child) {
  const started = performance.now();
  while (performance.now() - started < waitMs) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before CDP admission: ${child.exitCode}`);
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome CDP target');
}

async function waitForValue(cdp, waitMs, expression) {
  const started = performance.now();
  while (performance.now() - started < waitMs) {
    const value = await evaluate(cdp, expression);
    if (value !== null && value !== undefined && value !== false) return value;
    await delay(100);
  }
  throw new Error(`timed out waiting for browser value: ${expression.slice(0, 120)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'browser evaluation failed',
    );
  }
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
