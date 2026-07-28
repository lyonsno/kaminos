#!/usr/bin/env node

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  SF3D_LIVE_SMOKE_ROUTE_ID,
  SF3D_LIVE_SMOKE_SOURCE_REVISION,
  resolveSf3dGpuTopologyRequest,
} from '../sf3d-live-smoke-core.js';
import {
  extractRequestedReportPath,
  finalizeWitnessReport,
  requireArgumentValue,
} from './sf3d-live-smoke-witness-core.mjs';

function parseArgs(argv) {
  const values = {
    url: 'http://127.0.0.1:8093/?sf3d_live_smoke=1&sf3d_gpu_topology=shared-device&mesh_root=splat-extra-1&mesh_path=arena-worker.glb',
    sf3dRepo: process.env.SF3D_REPO || '/private/tmp/sf3d-webgpu-wake-portable-tet-origin-0726',
    screenshot: '/tmp/sf3d-live-smoke-firing.png',
    report: '/tmp/sf3d-live-smoke-firing.json',
  };
  for (let index = 0; index < argv.length; index += 2) {
    const argument = argv[index];
    const key = argument?.replace(/^--/, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (!(key in values)) throw new Error(`Unknown or incomplete argument: ${argument}`);
    values[key] = requireArgumentValue(argument, argv[index + 1]);
  }
  return values;
}

async function loadPuppeteer(sf3dRepo) {
  const require = createRequire(import.meta.url);
  const modulePath = require.resolve('puppeteer-core', { paths: [resolve(sf3dRepo)] });
  return (await import(pathToFileURL(modulePath).href)).default;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const argv = process.argv.slice(2);
const defaults = parseArgs([]);
defaults.report = extractRequestedReportPath(argv, defaults.report);
const report = {
  schema: 'kaminos.sf3d-live-smoke-firing-witness.v0',
  ok: false,
  requestedUrl: defaults.url,
  expectedRevision: SF3D_LIVE_SMOKE_SOURCE_REVISION,
  expectedTopology: null,
  startedAt: new Date().toISOString(),
  failurePhase: null,
  lastTrustworthyEvidence: 'report initialized',
  consoleErrors: [],
  pageErrors: [],
  requestFailures: [],
};

let browser;
let options = defaults;
let phase = 'arguments';
try {
  options = parseArgs(argv);
  report.requestedUrl = options.url;
  const routeParams = new URL(options.url).searchParams;
  report.expectedTopology = resolveSf3dGpuTopologyRequest(routeParams);
  report.expectedRenderFps = routeParams.has('sf3d_render_fps')
    ? Number(routeParams.get('sf3d_render_fps'))
    : null;
  report.sourceRepo = resolve(options.sf3dRepo);
  report.lastTrustworthyEvidence = 'arguments parsed';

  phase = 'browser-launch';
  const puppeteer = await loadPuppeteer(options.sf3dRepo);
  browser = await puppeteer.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    protocolTimeout: 0,
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
  page.setDefaultTimeout(0);
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
  await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 0 });
  await page.waitForFunction(
    () => window.kaminosSf3dLiveSmokeController?.debugState?.().attempted === false
      && document.getElementById('sf3d-live-smoke-status')?.textContent === 'Armed',
    { timeout: 0, polling: 250 },
  );
  report.initialState = await page.evaluate(() => window.kaminosSf3dLiveSmokeController.debugState());
  assert(report.initialState.revision === SF3D_LIVE_SMOKE_SOURCE_REVISION, 'SF3D firing source revision mismatch');
  assert(report.initialState.gpuTopology === report.expectedTopology, 'SF3D firing effective topology mismatch');
  assert(
    report.initialState.gpuTopologyReceipt?.requested === report.expectedTopology
      && report.initialState.gpuTopologyReceipt?.effective === report.expectedTopology,
    'SF3D firing topology receipt mismatch',
  );
  assert(report.initialState.gpuTopologyReceipt?.sameDevice === true, 'SF3D firing did not share the renderer GPUDevice');
  assert(report.initialState.gpuTopologyReceipt?.sameQueue === true, 'SF3D firing did not share the renderer GPUQueue');
  assert(report.initialState.renderCadence?.targetFps === report.expectedRenderFps, 'SF3D firing render cadence mismatch');
  report.lastTrustworthyEvidence = 'source-bound shared-device route armed';

  phase = 'route-firing';
  await page.evaluate(() => {
    const controller = window.kaminosSf3dLiveSmokeController;
    window.kaminosSf3dLiveSmokeWitnessPromise = controller.fire().catch(error => {
      window.kaminosSf3dLiveSmokeWitnessError = error.message || String(error);
      return null;
    });
  });
  report.lastTrustworthyEvidence = 'page-owned firing started';
  await page.waitForFunction(
    () => window.kaminosSf3dLiveSmokeLastReport != null,
    { timeout: 0, polling: 100 },
  );
  report.appReport = await page.evaluate(() => window.kaminosSf3dLiveSmokeLastReport);
  report.lastTrustworthyEvidence = 'page-owned terminal report captured';

  phase = 'terminal-identity';
  assert(report.appReport.requestedRouteId === SF3D_LIVE_SMOKE_ROUTE_ID, 'SF3D requested route mismatch');
  assert(report.appReport.effectiveRouteId === SF3D_LIVE_SMOKE_ROUTE_ID, 'SF3D effective route mismatch');
  assert(report.appReport.requestedRevision === SF3D_LIVE_SMOKE_SOURCE_REVISION, 'SF3D requested revision mismatch');
  assert(report.appReport.effectiveRevision === SF3D_LIVE_SMOKE_SOURCE_REVISION, 'SF3D effective revision mismatch');
  assert(report.appReport.gpuTopology === report.expectedTopology, 'SF3D terminal topology mismatch');
  assert(report.appReport.gpuTopologyReceipt?.sameDevice === true, 'SF3D terminal report lost shared device identity');
  assert(report.appReport.gpuTopologyReceipt?.sameQueue === true, 'SF3D terminal report lost shared queue identity');
  assert(report.appReport.renderCadence?.targetFps === report.expectedRenderFps, 'SF3D terminal render cadence mismatch');
  assert(report.appReport.ok === true, report.appReport.error || 'SF3D route failed');
  assert(report.appReport.output?.canonical === true, 'SF3D route did not produce canonical output');

  phase = 'visual-capture';
  await page.screenshot({ path: options.screenshot, fullPage: false });
  report.screenshot = options.screenshot;
  report.lastTrustworthyEvidence = 'terminal frame captured';
  report.ok = true;
} catch (error) {
  report.failurePhase = phase;
  report.error = error.message || String(error);
} finally {
  report.completedAt = new Date().toISOString();
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
