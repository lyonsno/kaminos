#!/usr/bin/env node

import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_TOPOLOGY = 'same-page-dual-device-shared-physical-gpu';
const FAILED_ALLOCATION_SIZE = 3_145_728;

function parseArgs(argv) {
  const values = {
    url: 'http://127.0.0.1:8093/?sf3d_live_smoke=1&mesh_root=splat-extra-1&mesh_path=arena-worker.glb',
    sf3dRepo: process.env.SF3D_REPO || '/private/tmp/sf3d-webgpu-slow-cooperative-dino-0724',
    screenshot: '/tmp/sf3d-live-smoke-dual-device-witness.png',
    report: '/tmp/sf3d-live-smoke-dual-device-witness.json',
    settleMs: 30_000,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in values) || argv[index + 1] === undefined) throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    values[key] = key === 'settleMs' ? Number(argv[index + 1]) : argv[index + 1];
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

const options = parseArgs(process.argv.slice(2));
const report = {
  schema: 'kaminos.sf3d-live-smoke-activation-witness.v0',
  ok: false,
  url: options.url,
  expectedTopology: EXPECTED_TOPOLOGY,
  allocation: {
    size: FAILED_ALLOCATION_SIZE,
    mappedAtCreation: true,
  },
  settleMs: options.settleMs,
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
};

let browser;
try {
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
  const page = await browser.newPage();
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

  report.initialState = await page.evaluate(() => window.kaminosSf3dLiveSmokeController.debugState());
  assert(report.initialState.gpuTopology === EXPECTED_TOPOLOGY, `wrong GPU topology: ${report.initialState.gpuTopology}`);
  assert(report.initialState.attempted === false, 'activation witness found a spent route');
  assert(report.initialState.deviceLoss === null, 'inference device was already lost');

  report.initialProbe = await page.evaluate(
    options => window.kaminosSf3dLiveSmokeController.probeInferenceDevice(options),
    { size: FAILED_ALLOCATION_SIZE, mappedAtCreation: true },
  );
  assert(report.initialProbe.usable === true, `initial mapped allocation failed: ${report.initialProbe.error}`);

  await new Promise(resolve => setTimeout(resolve, options.settleMs));

  report.settledProbe = await page.evaluate(
    options => window.kaminosSf3dLiveSmokeController.probeInferenceDevice(options),
    { size: FAILED_ALLOCATION_SIZE, mappedAtCreation: true },
  );
  assert(report.settledProbe.usable === true, `settled mapped allocation failed: ${report.settledProbe.error}`);
  report.settledState = await page.evaluate(() => window.kaminosSf3dLiveSmokeController.debugState());
  assert(report.settledState.deviceLoss === null, `inference device lost during settle: ${JSON.stringify(report.settledState.deviceLoss)}`);
  assert(report.settledState.attempted === false, 'activation witness unexpectedly spent the route');

  report.visual = await captureViewport(page, options.screenshot);
  report.screenshot = options.screenshot;
  report.ok = true;
} catch (error) {
  report.error = error.message || String(error);
} finally {
  await browser?.close();
  await mkdir(dirname(options.report), { recursive: true });
  await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;
