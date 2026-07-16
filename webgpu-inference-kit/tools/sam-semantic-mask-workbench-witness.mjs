#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'url': { type: 'string' },
    'out': { type: 'string', default: '/tmp/sam3-semantic-mask-workbench.png' },
    'report': { type: 'string', default: '/tmp/sam3-semantic-mask-workbench.json' },
    'debug-port': { type: 'string', default: '9596' },
    'timeout-ms': { type: 'string' },
    'prompt': { type: 'string' },
    'expect-empty': { type: 'boolean', default: false },
    'negative-control': { type: 'boolean', default: false },
    'negative-out': { type: 'string' },
    'chrome': { type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
    'viewport-width': { type: 'string', default: '1500' },
    'viewport-height': { type: 'string', default: '900' },
  },
  strict: true,
});

if (!values.url) throw new Error('--url is required');
const requestedUrl = new URL(values.url);
const outPath = resolve(values.out);
const negativeOutPath = resolve(values['negative-out'] || outPath.replace(/(\.[^.]+)?$/, '-negative$1'));
const reportPath = resolve(values.report);
const debugPort = Number(values['debug-port']);
const timeoutMs = values['timeout-ms'] == null ? null : Number(values['timeout-ms']);
const viewportWidth = Number(values['viewport-width']);
const viewportHeight = Number(values['viewport-height']);
if (timeoutMs !== null && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) throw new Error(`invalid --timeout-ms ${values['timeout-ms']}`);

const report = {
  schema: 'kaminos.sam3-semantic-mask-workbench-witness.v0',
  status: 'running',
  requestedUrl: requestedUrl.href,
  requestedPrompt: values.prompt ?? null,
  expectEmpty: values['expect-empty'],
  effectiveUrl: null,
  routeRegistration: null,
  workbench: null,
  visualEvidence: null,
  negativeControl: null,
  screenshot: null,
  requestedScreenshot: outPath,
  screenshotCompleteness: {
    positive: null,
    negative: null,
  },
  failurePhase: 'route-registration',
  error: null,
  startedAt: new Date().toISOString(),
};

function writeReport() {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
}

async function waitUntil(probe, label) {
  const started = Date.now();
  while (true) {
    const value = await probe();
    if (value) return value;
    if (timeoutMs !== null && Date.now() - started > timeoutMs) throw new Error(`${label} exceeded caller timeout ${timeoutMs}ms`);
    await delay(250);
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch ${url} failed ${response.status}`);
  return response.json();
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed to open')), { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolveRequest, rejectRequest, timer } = pending.get(message.id);
    pending.delete(message.id);
    if (timer) clearTimeout(timer);
    if (message.error) rejectRequest(new Error(`CDP ${message.error.message}`));
    else resolveRequest(message.result);
  });
  const request = (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    const id = ++nextId;
    const timer = timeoutMs === null ? null : setTimeout(() => {
      pending.delete(id);
      rejectRequest(new Error(`CDP ${method} exceeded caller timeout ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(id, { resolveRequest, rejectRequest, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
  return { socket, request };
}

async function evaluate(cdp, expression) {
  const result = await cdp.request('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`browser evaluation failed: ${result.exceptionDetails.text}`);
  return result.result?.value;
}

async function settleForVisualCapture() {
  await evaluate(cdp, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await delay(500);
}

async function forceWorkbenchPresentation(attempt) {
  await cdp.request('Page.bringToFront');
  if (attempt === 2) {
    await evaluate(cdp, `new Promise(resolve => {
      const body = document.body;
      body.style.visibility = 'hidden';
      void body.offsetHeight;
      requestAnimationFrame(() => {
        body.style.visibility = '';
        requestAnimationFrame(resolve);
      });
    })`);
  } else if (attempt === 3) {
    await cdp.request('Emulation.setDeviceMetricsOverride', {
      width: Math.max(1, viewportWidth - 1),
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(100);
    await cdp.request('Emulation.setDeviceMetricsOverride', {
      width: viewportWidth,
      height: viewportHeight,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
}

async function readWorkbenchScreenshotLayout() {
  return evaluate(cdp, `(() => {
    window.scrollTo(0, 0);
    const rect = id => {
      const value = document.getElementById(id).getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom };
    };
    const heading = document.querySelector('h1').getBoundingClientRect();
    const layout = {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      scrollWidth: document.documentElement.scrollWidth,
      source: rect('source-canvas'),
      runButton: rect('run-segmentation'),
      heading: { left: heading.left, top: heading.top, right: heading.right, bottom: heading.bottom },
    };
    layout.layoutPassed = layout.scrollX === 0
      && layout.scrollY === 0
      && layout.scrollWidth <= layout.innerWidth
      && [layout.source, layout.runButton, layout.heading].every(value => value.left >= 0
        && value.top >= 0
        && value.right <= layout.innerWidth
        && value.bottom <= layout.innerHeight);
    return layout;
  })()`);
}

async function inspectWorkbenchScreenshot(pngBase64, layout) {
  return evaluate(cdp, `(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(`data:image/png;base64,${pngBase64}`)};
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const scaleX = canvas.width / ${JSON.stringify(layout.innerWidth)};
    const scaleY = canvas.height / ${JSON.stringify(layout.innerHeight)};
    const fraction = (rect, predicate) => {
      const left = Math.max(0, Math.floor(rect.left * scaleX));
      const top = Math.max(0, Math.floor(rect.top * scaleY));
      const right = Math.min(canvas.width, Math.ceil(rect.right * scaleX));
      const bottom = Math.min(canvas.height, Math.ceil(rect.bottom * scaleY));
      let samples = 0;
      let signals = 0;
      for (let y = top; y < bottom; y += 3) {
        for (let x = left; x < right; x += 3) {
          const offset = (y * canvas.width + x) * 4;
          samples += 1;
          if (predicate(pixels[offset], pixels[offset + 1], pixels[offset + 2])) signals += 1;
        }
      }
      return samples ? signals / samples : 0;
    };
    const sourceSignalFraction = fraction(${JSON.stringify(layout.source)}, (red, green, blue) => red + green + blue > 120);
    const runButtonSignalFraction = fraction(${JSON.stringify(layout.runButton)}, (red, green, blue) => green > 170 && red > 110 && blue < 170);
    const headingSignalFraction = fraction(${JSON.stringify(layout.heading)}, (red, green, blue) => Math.max(red, green, blue) > 170 && red + green + blue > 360);
    return {
      width: canvas.width,
      height: canvas.height,
      sourceSignalFraction,
      runButtonSignalFraction,
      headingSignalFraction,
    };
  })()`);
}

async function captureCompleteWorkbenchScreenshot(kind) {
  const attempts = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await forceWorkbenchPresentation(attempt);
    await settleForVisualCapture();
    const layout = await readWorkbenchScreenshotLayout();
    const screenshot = await cdp.request('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: layout.innerWidth, height: layout.innerHeight, scale: 1 },
    });
    const pixels = await inspectWorkbenchScreenshot(screenshot.data, layout);
    const evidence = {
      attempt,
      layout,
      ...pixels,
      passed: layout.layoutPassed === true
        && pixels.sourceSignalFraction >= 0.15
        && pixels.runButtonSignalFraction >= 0.2
        && pixels.headingSignalFraction >= 0.005,
    };
    attempts.push(evidence);
    report.screenshotCompleteness[kind] = { passed: evidence.passed, attempts };
    if (evidence.passed) return screenshot;
  }
  throw new Error(`${kind} screenshot remained partial after compositor recovery: ${JSON.stringify(report.screenshotCompleteness[kind])}`);
}

function canvasInspectionExpression() {
  return `(() => {
    const summarize = id => {
      const canvas = document.getElementById(id);
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      let nonTransparentPixels = 0;
      let brightPixels = 0;
      let checksum = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const a = pixels[index + 3];
        if (a) nonTransparentPixels += 1;
        if (r + g + b > 180) brightPixels += 1;
        checksum ^= r; checksum = Math.imul(checksum, 16777619);
        checksum ^= g; checksum = Math.imul(checksum, 16777619);
        checksum ^= b; checksum = Math.imul(checksum, 16777619);
        checksum ^= a; checksum = Math.imul(checksum, 16777619);
      }
      return { width: canvas.width, height: canvas.height, nonTransparentPixels, brightPixels, checksum: checksum >>> 0 };
    };
    const runtime = document.getElementById('sam-mask-runtime-frame').contentWindow;
    const output = runtime.samMaskIslandVisualOutput();
    return {
      status: document.getElementById('workbench-status').dataset.state,
      statusText: document.getElementById('status-text').textContent,
      effectiveRouteText: document.getElementById('effective-route').textContent,
      authorityText: document.getElementById('output-authority').textContent,
      candidateText: document.getElementById('candidate-evidence').textContent,
      foregroundText: document.getElementById('foreground-evidence').textContent,
      controlText: document.getElementById('control-evidence').textContent,
      output: output ? {
        invocationId: output.invocationId,
        outputAuthority: output.outputAuthority,
        verificationState: output.verificationState,
        effectiveRouteId: output.effectiveRouteId,
        receiptChain: output.receiptChain,
        imageCache: output.imageCache,
        promptText: output.promptText,
        selectedCandidateCount: output.selectedCandidateCount,
        selectedMaskIndex: output.selectedMaskIndex,
        selectedScore: output.selectedScore,
        foregroundPixelCount: output.foregroundPixelCount,
        width: output.width,
        height: output.height,
      } : null,
      canvases: {
        source: summarize('source-canvas'),
        overlay: summarize('overlay-canvas'),
        mask: summarize('mask-canvas'),
      },
    };
  })()`;
}

let chromeProcess = null;
let cdp = null;
let chromeStderr = '';
try {
  const routeUrl = new URL('/api/sam3-workbench-route', requestedUrl);
  report.routeRegistration = await fetchJson(routeUrl);
  if (report.routeRegistration.registrationState !== 'mounted') throw new Error(`route registration is ${report.routeRegistration.registrationState || 'missing'}`);
  const effectiveRegisteredUrl = new URL(report.routeRegistration.effectiveUrl);
  if (requestedUrl.href !== effectiveRegisteredUrl.href) {
    throw new Error(`requested route does not match registered route: ${requestedUrl.href} != ${effectiveRegisteredUrl.href}`);
  }

  report.failurePhase = 'browser-launch';
  const userDataDir = `/tmp/sam3-semantic-workbench-profile-${debugPort}-${process.pid}`;
  const chromeArgs = [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
    '--headless=new',
    `--window-size=${viewportWidth},${viewportHeight}`,
    requestedUrl.href,
  ];
  chromeProcess = spawn(values.chrome, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { chromeStderr += chunk.toString(); });
  const chromeSpawnError = new Promise((_, rejectSpawn) => {
    chromeProcess.once('error', rejectSpawn);
  });

  const page = await Promise.race([
    waitUntil(async () => {
      try {
        const pages = await fetchJson(`http://127.0.0.1:${debugPort}/json/list`);
        return pages.find(entry => entry.type === 'page' && entry.url.startsWith(requestedUrl.origin));
      } catch {
        return null;
      }
    }, 'Chrome DevTools page'),
    chromeSpawnError,
  ]);
  cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.request('Page.enable');
  await cdp.request('Runtime.enable');
  await waitUntil(async () => evaluate(cdp, `(() => { const button = document.getElementById('run-segmentation'); return document.readyState === 'complete' && button && !button.disabled; })()`), 'workbench initialization');
  report.effectiveUrl = await evaluate(cdp, 'window.location.href');
  if (values.prompt !== undefined) {
    const visiblePrompt = await evaluate(cdp, `(() => {
      const input = document.getElementById('prompt-input');
      input.value = ${JSON.stringify(values.prompt)};
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`);
    if (visiblePrompt !== values.prompt) throw new Error('caller prompt did not reach the visible workbench input');
  }

  report.failurePhase = 'workbench-run';
  const clicked = await evaluate(cdp, `(() => { const button = document.getElementById('run-segmentation'); button.click(); return true; })()`);
  if (!clicked) throw new Error('operator run control was not activated');
  const terminal = await waitUntil(async () => evaluate(cdp, `(() => {
    const root = document.getElementById('workbench-status');
    const button = document.getElementById('run-segmentation');
    return !button.disabled && ['complete', 'warning', 'failed'].includes(root.dataset.state)
      ? { state: root.dataset.state, text: document.getElementById('status-text').textContent }
      : null;
  })()`), 'SAM3 workbench execution');
  if (terminal.state === 'failed') throw new Error(`workbench failed: ${terminal.text}`);

  report.failurePhase = 'visual-inspection';
  await settleForVisualCapture();
  report.workbench = terminal;
  report.visualEvidence = await evaluate(cdp, canvasInspectionExpression());
  const { output, canvases } = report.visualEvidence;
  if (output?.outputAuthority !== 'actual-webgpu-readback') throw new Error(`output authority is ${output?.outputAuthority || 'missing'}`);
  if (output.verificationState !== 'not-attached') throw new Error(`dynamic verification state is ${output.verificationState || 'missing'}`);
  if (values.prompt !== undefined && output.promptText !== values.prompt) throw new Error(`runtime prompt identity drift: ${output.promptText || 'missing'}`);
  if (output.imageCache?.status !== 'miss') throw new Error(`fresh image-cache route is ${output.imageCache?.status || 'missing'}, expected miss`);
  if (values['expect-empty'] && (output.selectedCandidateCount !== 0 || output.foregroundPixelCount !== 0)) {
    throw new Error(`expected empty output retained ${output.selectedCandidateCount} candidates and ${output.foregroundPixelCount} foreground pixels`);
  }
  if (!values['expect-empty'] && (output.selectedCandidateCount <= 0 || output.foregroundPixelCount <= 0)) {
    throw new Error(`positive output is empty: ${output.selectedCandidateCount} candidates and ${output.foregroundPixelCount} foreground pixels`);
  }
  if (!Array.isArray(output.receiptChain) || output.receiptChain.length < 10) throw new Error('composition receipt chain is incomplete');
  if (canvases.source.nonTransparentPixels === 0 || canvases.overlay.nonTransparentPixels === 0 || canvases.mask.nonTransparentPixels === 0) {
    throw new Error('one or more visible canvases are blank');
  }
  if (!values['expect-empty'] && canvases.source.checksum === canvases.overlay.checksum) throw new Error('positive mask did not alter the visible overlay');
  if (!values['expect-empty'] && canvases.mask.brightPixels === 0) throw new Error('positive output produced a blank raw-mask witness');

  report.failurePhase = 'capture';
  const screenshot = await captureCompleteWorkbenchScreenshot('positive');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, Buffer.from(screenshot.data, 'base64'));
  report.screenshot = outPath;

  if (values['negative-control']) {
    report.failurePhase = 'negative-control';
    const negativeClicked = await evaluate(cdp, `(() => {
      const button = document.getElementById('run-negative-control');
      if (button.disabled) return false;
      button.click();
      return true;
    })()`);
    if (!negativeClicked) throw new Error('negative control was unavailable after positive capture');
    const negativeTerminal = await waitUntil(async () => evaluate(cdp, `(() => {
      const root = document.getElementById('workbench-status');
      const button = document.getElementById('run-negative-control');
      return !button.disabled && ['complete', 'warning', 'failed'].includes(root.dataset.state)
        ? { state: root.dataset.state, text: document.getElementById('status-text').textContent }
        : null;
    })()`), 'SAM3 negative-control execution');
    if (negativeTerminal.state === 'failed') throw new Error(`negative control failed: ${negativeTerminal.text}`);
    await settleForVisualCapture();
    const negativeVisualEvidence = await evaluate(cdp, canvasInspectionExpression());
    const negativeOutput = negativeVisualEvidence.output;
    if (negativeOutput?.outputAuthority !== 'actual-webgpu-readback') throw new Error(`negative output authority is ${negativeOutput?.outputAuthority || 'missing'}`);
    if (negativeOutput.verificationState !== 'not-attached') throw new Error(`negative verification state is ${negativeOutput.verificationState || 'missing'}`);
    if (negativeOutput.imageCache?.status !== 'hit') throw new Error(`negative image-cache route is ${negativeOutput.imageCache?.status || 'missing'}, expected hit`);
    if (!['Different from positive', 'Empty as expected'].includes(negativeVisualEvidence.controlText)) {
      throw new Error(`negative control did not falsify mask reuse: ${negativeVisualEvidence.controlText || 'missing'}`);
    }
    const negativeScreenshot = await captureCompleteWorkbenchScreenshot('negative');
    mkdirSync(dirname(negativeOutPath), { recursive: true });
    writeFileSync(negativeOutPath, Buffer.from(negativeScreenshot.data, 'base64'));
    report.negativeControl = {
      workbench: negativeTerminal,
      visualEvidence: negativeVisualEvidence,
      screenshot: negativeOutPath,
    };
  }
  report.status = 'passed';
  report.failurePhase = null;
  report.completedAt = new Date().toISOString();
  writeReport();
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  report.status = 'failed';
  report.error = String(error?.stack || error);
  report.chromeStderr = chromeStderr.slice(-12000);
  report.completedAt = new Date().toISOString();
  writeReport();
  console.error(report.error);
  process.exitCode = 1;
} finally {
  cdp?.socket.close();
  chromeProcess?.kill('SIGTERM');
}
