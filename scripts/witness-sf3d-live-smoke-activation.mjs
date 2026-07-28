#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SF3D_LIVE_SMOKE_SOURCE_REVISION,
  resolveSf3dGpuTopologyRequest,
  validateSf3dLiveSmokeConfig,
} from '../sf3d-live-smoke-core.js';
import {
  extractRequestedReportPath,
  finalizeWitnessReport,
  requireArgumentValue,
  validateTetWitnessEvidence,
} from './sf3d-live-smoke-witness-core.mjs';

const FAILED_ALLOCATION_SIZE = 3_145_728;

function parseArgs(argv) {
  const values = {
    url: 'http://127.0.0.1:8093/?sf3d_live_smoke=1&mesh_root=splat-extra-1&mesh_path=arena-worker.glb',
    sf3dRepo: process.env.SF3D_REPO || '/private/tmp/sf3d-webgpu-wake-portable-tet-origin-0726',
    screenshot: '/tmp/sf3d-live-smoke-dual-device-witness.png',
    report: '/tmp/sf3d-live-smoke-dual-device-witness.json',
    settleMs: 30_000,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const key = argument?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in values)) throw new Error(`Unknown or incomplete argument: ${argument}`);
    const value = requireArgumentValue(argument, argv[index + 1]);
    values[key] = key === 'settleMs' ? Number(value) : value;
  }
  if (!Number.isFinite(values.settleMs) || values.settleMs < 0) throw new Error('--settle-ms must be non-negative');
  return values;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function loadPuppeteer(sf3dRepo) {
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve('puppeteer-core', { paths: [resolve(sf3dRepo)] });
  return (await import(pathToFileURL(modulePath).href)).default;
}

async function captureViewport(page, outputPath) {
  const clip = await page.evaluate(() => {
    const canvas = document.querySelector('#viewport > canvas');
    if (!canvas) throw new Error('Kaminos renderer canvas is missing');
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, rect.x),
      y: Math.max(0, rect.y),
      width: Math.max(1, Math.min(rect.width, innerWidth - Math.max(0, rect.x))),
      height: Math.max(1, Math.min(rect.height, innerHeight - Math.max(0, rect.y))),
      scale: 1,
    };
  });
  const cdp = await page.createCDPSession();
  const capture = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(capture.data, 'base64'));
  const pixels = await page.evaluate(async data => {
    const response = await fetch(`data:image/png;base64,${data}`);
    const bitmap = await createImageBitmap(await response.blob());
    const sampleWidth = Math.min(320, bitmap.width);
    const sampleHeight = Math.max(1, Math.round(bitmap.height * sampleWidth / bitmap.width));
    const canvas = new OffscreenCanvas(sampleWidth, sampleHeight);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight);
    const values = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const colors = new Set();
    let luminanceSum = 0;
    let luminanceSquareSum = 0;
    let nonDark = 0;
    const count = values.length / 4;
    for (let index = 0; index < values.length; index += 4) {
      const red = values[index];
      const green = values[index + 1];
      const blue = values[index + 2];
      const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      luminanceSum += luminance;
      luminanceSquareSum += luminance * luminance;
      if (luminance >= 12) nonDark++;
      colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}`);
    }
    const mean = luminanceSum / count;
    return {
      width: bitmap.width,
      height: bitmap.height,
      sampledPixels: count,
      nonDarkRatio: nonDark / count,
      luminanceMean: mean,
      luminanceStdDev: Math.sqrt(Math.max(0, luminanceSquareSum / count - mean * mean)),
      quantizedColors: colors.size,
    };
  }, capture.data);
  assert(pixels.nonDarkRatio > 0.01, `renderer witness is effectively black (${pixels.nonDarkRatio})`);
  assert(pixels.luminanceStdDev > 2, `renderer witness lacks visual variation (${pixels.luminanceStdDev})`);
  assert(pixels.quantizedColors > 20, `renderer witness has too few colors (${pixels.quantizedColors})`);
  return pixels;
}

async function readSmokeConfig(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/sf3d-live-smoke-config', { cache: 'no-store' });
    if (!response.ok) throw new Error(`SF3D config fetch failed: HTTP ${response.status}`);
    return response.json();
  });
}

async function probeTetAssets(page, report, sourceOrigin) {
  report.tetResponses = [];
  const recordResponse = response => {
    const url = new URL(response.url());
    if (!url.pathname.endsWith('/tets/_grid_vertices.bin') && !url.pathname.endsWith('/tets/indices.bin')) return;
    report.tetResponses.push({
      url: response.url(),
      origin: new URL(response.url()).origin,
      status: response.status(),
      fromCache: response.fromCache(),
      fromServiceWorker: response.fromServiceWorker(),
      contentType: response.headers()['content-type'] || null,
      contentLength: response.headers()['content-length'] || null,
    });
  };
  page.on('response', recordResponse);
  try {
    report.tetAssets = await page.evaluate(async origin => {
      const moduleUrl = new URL('/src/lib/marching_tet.js', origin).href;
      const { loadTetData } = await import(moduleUrl);
      const loaded = await loadTetData();
      return {
        sourceOrigin: new URL(origin).origin,
        moduleUrl,
        numVertices: loaded.numVertices,
        numTets: loaded.numTets,
        vertexBytes: loaded.gridVertices.byteLength,
        indexBytes: loaded.indices.byteLength,
      };
    }, sourceOrigin);
  } finally {
    page.off('response', recordResponse);
  }
}

const argv = process.argv.slice(2);
const options = parseArgs([]);
options.report = extractRequestedReportPath(argv, options.report);
const report = {
  schema: 'kaminos.sf3d-live-smoke-activation-witness.v0',
  ok: false,
  url: options.url,
  expectedTopology: null,
  allocation: {
    size: FAILED_ALLOCATION_SIZE,
    mappedAtCreation: true,
  },
  settleMs: options.settleMs,
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
  failurePhase: null,
  lastTrustworthyEvidence: 'report initialized',
};

let browser;
let phase = 'arguments';
try {
  Object.assign(options, parseArgs(argv));
  report.url = options.url;
  const routeParams = new URL(options.url).searchParams;
  report.expectedTopology = resolveSf3dGpuTopologyRequest(routeParams);
  report.expectedRenderFps = routeParams.has('sf3d_render_fps')
    ? Number(routeParams.get('sf3d_render_fps'))
    : null;
  report.settleMs = options.settleMs;
  report.source = {
    expectedRevision: SF3D_LIVE_SMOKE_SOURCE_REVISION,
    expectedRepo: resolve(options.sf3dRepo),
  };
  report.lastTrustworthyEvidence = 'arguments parsed';

  phase = 'browser-launch';
  const puppeteer = await loadPuppeteer(options.sf3dRepo);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--enable-unsafe-webgpu',
      '--use-angle=metal',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  report.lastTrustworthyEvidence = 'browser launched';

  phase = 'route-activation';
  const page = await browser.newPage();
  await page.setCacheEnabled(false);
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
  });
  page.on('pageerror', error => report.pageErrors.push(error.message || String(error)));
  page.on('requestfailed', request => report.requestFailures.push({
    url: request.url(),
    error: request.failure()?.errorText || 'unknown',
  }));

  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(
    () => window.kaminosSf3dLiveSmokeController?.debugState?.().attempted === false
      && document.getElementById('sf3d-live-smoke-status')?.textContent === 'Armed',
    { timeout: 180_000, polling: 250 },
  );
  report.lastTrustworthyEvidence = 'Kaminos route armed';

  phase = 'source-identity-before';
  report.configBefore = await readSmokeConfig(page);
  const configBefore = validateSf3dLiveSmokeConfig(report.configBefore);
  assert(configBefore.effectiveRevision === SF3D_LIVE_SMOKE_SOURCE_REVISION, `wrong SF3D revision: ${configBefore.effectiveRevision}`);
  assert(configBefore.repo === resolve(options.sf3dRepo), `wrong SF3D repo: ${configBefore.repo || 'missing'}`);
  report.initialState = await page.evaluate(() => window.kaminosSf3dLiveSmokeController.debugState());
  assert(report.initialState.gpuTopology === report.expectedTopology, `wrong GPU topology: ${report.initialState.gpuTopology}`);
  assert(
    report.initialState.gpuTopologyReceipt?.requested === report.expectedTopology
      && report.initialState.gpuTopologyReceipt?.effective === report.expectedTopology,
    `GPU topology receipt mismatch: ${JSON.stringify(report.initialState.gpuTopologyReceipt)}`,
  );
  assert(
    report.initialState.gpuTopologyReceipt?.authority === 'exact-browser-object-identity',
    'GPU topology receipt lacks exact object identity authority',
  );
  assert(
    report.initialState.renderCadence?.targetFps === report.expectedRenderFps,
    `render cadence mismatch: ${JSON.stringify(report.initialState.renderCadence)}`,
  );
  assert(report.initialState.revision === SF3D_LIVE_SMOKE_SOURCE_REVISION, `controller revision mismatch: ${report.initialState.revision}`);
  assert(report.initialState.attempted === false, 'activation witness found a spent route');
  assert(report.initialState.deviceLoss === null, 'inference device was already lost');
  report.lastTrustworthyEvidence = 'pinned source identity and armed controller verified';

  phase = 'tet-assets';
  await probeTetAssets(page, report, configBefore.origin);
  report.configAfter = await readSmokeConfig(page);
  report.sourceEvidence = validateTetWitnessEvidence({
    configBefore: report.configBefore,
    configAfter: report.configAfter,
    expectedRevision: SF3D_LIVE_SMOKE_SOURCE_REVISION,
    expectedRepo: options.sf3dRepo,
    tetAssets: report.tetAssets,
    tetResponses: report.tetResponses,
  });
  report.lastTrustworthyEvidence = 'fresh source-owned canonical tet assets verified';

  phase = 'initial-device-probe';
  report.initialProbe = await page.evaluate(
    options => window.kaminosSf3dLiveSmokeController.probeInferenceDevice(options),
    { size: FAILED_ALLOCATION_SIZE, mappedAtCreation: true },
  );
  assert(report.initialProbe.usable === true, `initial mapped allocation failed: ${report.initialProbe.error}`);
  report.lastTrustworthyEvidence = 'initial mapped allocation verified';

  phase = 'settle';
  await new Promise(resolve => setTimeout(resolve, options.settleMs));

  phase = 'settled-device-probe';
  report.settledProbe = await page.evaluate(
    options => window.kaminosSf3dLiveSmokeController.probeInferenceDevice(options),
    { size: FAILED_ALLOCATION_SIZE, mappedAtCreation: true },
  );
  assert(report.settledProbe.usable === true, `settled mapped allocation failed: ${report.settledProbe.error}`);
  report.settledState = await page.evaluate(() => window.kaminosSf3dLiveSmokeController.debugState());
  assert(report.settledState.deviceLoss === null, `inference device lost during settle: ${JSON.stringify(report.settledState.deviceLoss)}`);
  assert(report.settledState.attempted === false, 'activation witness unexpectedly spent the route');
  report.lastTrustworthyEvidence = 'settled mapped allocation and device lifetime verified';

  phase = 'visual-capture';
  report.visual = await captureViewport(page, options.screenshot);
  report.screenshot = options.screenshot;
  report.lastTrustworthyEvidence = 'renderer canvas captured and inspected';
  report.ok = true;
} catch (error) {
  report.failurePhase = phase;
  report.error = error.message || String(error);
} finally {
  try {
    await finalizeWitnessReport({
      browser,
      report,
      reportPath: options.report,
    });
  } catch (error) {
    report.ok = false;
    report.failurePhase ||= 'report-write';
    report.reportWriteError = error.message || String(error);
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
