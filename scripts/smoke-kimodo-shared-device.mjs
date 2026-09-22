#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'output-dir': { type: 'string' },
    mode: { type: 'string', default: 'load' },
    prompt: { type: 'string', default: 'a person dances' },
    duration: { type: 'string', default: '6' },
    steps: { type: 'string', default: '100' },
    'embedding-fixture': { type: 'string' },
    browser: { type: 'string', default: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' },
  },
  strict: true,
});

if (!values.url || !values['output-dir']) {
  throw new Error('Usage: smoke-kimodo-shared-device.mjs --url URL --output-dir DIR [--mode load|generate]');
}
if (!['load', 'generate'].includes(values.mode)) throw new Error(`Unsupported smoke mode: ${values.mode}`);
const steps = Number(values.steps);
const duration = Number(values.duration);
if (!Number.isSafeInteger(steps) || steps < 1) throw new Error('--steps must be a positive integer');
if (!Number.isFinite(duration) || duration < 1 || duration > 18) throw new Error('--duration must be between 1 and 18 seconds');

const outputDir = resolve(values['output-dir']);
mkdirSync(outputDir, { recursive: true });
const reportPath = join(outputDir, 'report.json');
const reportTempPath = `${reportPath}.tmp`;
const report = {
  schema: 'kaminos.kimodo-shared-device-smoke.v0',
  status: 'starting',
  failurePhase: null,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  requested: {
    url: values.url,
    mode: values.mode,
    prompt: values.prompt,
    duration,
    steps,
    browser: values.browser,
    embeddingFixture: values['embedding-fixture'] ?? null,
    route: 'Chrome Metal / one host-owned GPUDevice / exact shared queue',
  },
  effective: null,
  phases: [],
  console: [],
  pageState: null,
  screenshots: [],
  error: null,
};

function writeReport(status = report.status) {
  report.status = status;
  writeFileSync(reportTempPath, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(reportTempPath, reportPath);
}

function phase(name, detail = {}) {
  report.phases.push({ name, at: new Date().toISOString(), ...detail });
  writeReport();
}

writeReport('starting');

const kimodoCheckout = process.env.KIMODO_WEBGPU_CHECKOUT;
if (!kimodoCheckout) {
  report.failurePhase = 'puppeteer-resolution';
  report.error = { message: 'KIMODO_WEBGPU_CHECKOUT must name the exact committed Kimodo checkout used by the build' };
  report.finishedAt = new Date().toISOString();
  writeReport('failed');
  throw new Error(report.error.message);
}

const requireFromKimodo = createRequire(join(resolve(kimodoCheckout), 'package.json'));
const puppeteer = requireFromKimodo('puppeteer-core');
let embeddingFixture = null;
try {
  if (values['embedding-fixture']) {
    const fixturePath = resolve(values['embedding-fixture']);
    const fixtureBytes = readFileSync(fixturePath);
    const fixture = JSON.parse(fixtureBytes);
    const embedding = fixture.text_embedding_full ?? fixture.embedding;
    if (!Array.isArray(embedding) || embedding.length !== 4096 || embedding.some(value => !Number.isFinite(value))) {
      throw new Error('embedding fixture must contain exactly 4096 finite values in text_embedding_full or embedding');
    }
    embeddingFixture = { fixturePath, embedding };
    report.requested.embeddingAuthority = 'replayed-committed-fixture-no-live-text-encoder-claim';
    report.requested.embeddingFixtureSha256 = createHash('sha256').update(fixtureBytes).digest('hex');
  } else {
    report.requested.embeddingAuthority = 'live-external-endpoint';
    report.requested.embeddingFixtureSha256 = null;
  }
  writeReport('starting');
} catch (error) {
  report.failurePhase = 'embedding-fixture';
  report.error = { name: error?.name || 'Error', message: error?.message || String(error) };
  report.finishedAt = new Date().toISOString();
  writeReport('failed');
  throw error;
}
let browser = null;
let page = null;

async function snapshotPageState() {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => {
    const state = window.__kimodoSharedDevice;
    if (!state) return null;
    return JSON.parse(JSON.stringify(state));
  });
}

async function captureScreenshot(name) {
  const path = join(outputDir, `${name}.png`);
  await page.screenshot({ path, type: 'png' });
  const bytes = statSync(path).size;
  if (bytes < 1024) throw new Error(`Screenshot ${name} is implausibly small (${bytes} bytes)`);
  report.screenshots.push({ name, path, bytes });
  writeReport();
}

try {
  report.failurePhase = 'browser-launch';
  browser = await puppeteer.launch({
    executablePath: values.browser,
    headless: false,
    args: [
      '--enable-unsafe-webgpu',
      '--use-angle=metal',
      '--disable-gpu-sandbox',
      '--window-size=1600,1000',
    ],
    defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
  });
  page = await browser.newPage();
  page.setDefaultTimeout(0);
  if (embeddingFixture) {
    const fixtureUrl = 'http://127.0.0.1:65534/embed';
    await page.setRequestInterception(true);
    page.on('request', request => {
      if (request.url() !== fixtureUrl) return request.continue();
      if (request.method() === 'OPTIONS') {
        return request.respond({
          status: 204,
          headers: {
            'access-control-allow-origin': '*',
            'access-control-allow-methods': 'POST, OPTIONS',
            'access-control-allow-headers': 'Content-Type',
          },
          body: '',
        });
      }
      return request.respond({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ embedding: embeddingFixture.embedding, dim: 4096, authority: report.requested.embeddingAuthority }),
      });
    });
    report.effective = { embeddingEndpoint: fixtureUrl };
  }
  page.on('console', message => {
    report.console.push({ at: new Date().toISOString(), type: message.type(), text: message.text() });
  });
  page.on('pageerror', error => {
    report.console.push({ at: new Date().toISOString(), type: 'pageerror', text: error.message });
  });
  report.effective = {
    ...(report.effective ?? {}),
    browserVersion: await browser.version(),
    executablePath: values.browser,
    gpuFlags: ['--enable-unsafe-webgpu', '--use-angle=metal'],
  };
  phase('browser-launched');

  report.failurePhase = 'page-load';
  await page.goto(values.url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__kimodoSharedDevice?.deviceReceipt, { timeout: 0 });
  const initial = await snapshotPageState();
  if (initial.deviceTopology !== 'same-device') throw new Error(`Unexpected device topology: ${initial.deviceTopology}`);
  if (initial.queueTopology !== 'exact-device-queue') throw new Error(`Unexpected queue topology: ${initial.queueTopology}`);
  report.effective.finalUrl = page.url();
  report.effective.deviceReceipt = initial.deviceReceipt;
  report.effective.deviceTopology = initial.deviceTopology;
  report.effective.queueTopology = initial.queueTopology;
  if (embeddingFixture) {
    await page.evaluate(() => {
      document.querySelector('#kimodo-shared-embed').value = 'http://127.0.0.1:65534/embed';
    });
  }
  phase('shared-page-mounted');
  await captureScreenshot('01-mounted');

  report.failurePhase = 'model-load';
  await page.click('#kimodo-shared-load');
  await page.waitForFunction(() => ['loaded', 'failed'].includes(window.__kimodoSharedDevice?.status), { timeout: 0 });
  const loaded = await snapshotPageState();
  if (loaded.status !== 'loaded') throw new Error(loaded.lastError?.message || `Kimodo load ended as ${loaded.status}`);
  const source = loaded.source;
  if (!source || source.status !== 'built') throw new Error('Kimodo source manifest is absent, partial, or not built');
  report.effective.source = source;
  report.effective.producerIdentity = loaded.producerIdentity;
  phase('model-loaded');
  await captureScreenshot('02-loaded');

  if (values.mode === 'generate') {
    report.failurePhase = 'generation';
    await page.evaluate(({ prompt, duration, steps }) => {
      document.querySelector('#kimodo-shared-prompt').value = prompt;
      document.querySelector('#kimodo-shared-duration').value = String(duration);
      document.querySelector('#kimodo-shared-steps').value = String(steps);
    }, { prompt: values.prompt, duration, steps });
    await page.click('#kimodo-shared-run');
    await page.waitForFunction(() => ['succeeded', 'failed', 'canceled'].includes(window.__kimodoSharedDevice?.status), { timeout: 0 });
    const terminal = await snapshotPageState();
    if (terminal.status !== 'succeeded') throw new Error(terminal.lastError?.message || `Generation ended as ${terminal.status}`);
    const lastRun = terminal.runs.at(-1);
    if (!lastRun?.foregroundRunReport) throw new Error('Generation succeeded without a persistent foreground run report');
    if (!terminal.foregroundReceipts?.length) throw new Error('Generation succeeded without any actual foreground frame receipts');
    phase('generation-succeeded', {
      runId: lastRun.runId,
      elapsedMs: lastRun.elapsedMs,
      pageP95Ms: lastRun.pageP95Ms,
      frameCount: lastRun.flameAfter?.frameCount,
      simStepCount: lastRun.flameAfter?.simStepCount,
      foregroundReceipts: terminal.foregroundReceipts.length,
    });
    await captureScreenshot('03-generated');
  }

  report.failurePhase = null;
  report.pageState = await snapshotPageState();
  report.finishedAt = new Date().toISOString();
  writeReport('succeeded');
} catch (error) {
  report.pageState = await snapshotPageState().catch(() => null);
  report.error = { name: error?.name || 'Error', message: error?.message || String(error), stack: error?.stack || null };
  report.finishedAt = new Date().toISOString();
  writeReport('failed');
  process.exitCode = 1;
} finally {
  await browser?.close().catch(error => {
    report.console.push({ at: new Date().toISOString(), type: 'browser-close-error', text: error.message });
  });
  writeReport(report.status);
}
