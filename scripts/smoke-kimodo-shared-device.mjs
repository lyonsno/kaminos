#!/usr/bin/env node
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  boundedCleanup,
  progressFailure,
  validateMountedComposition,
  validateSuccessfulRun,
} from '../kimodo-shared-device-smoke-adjudication.mjs';
import {
  verifyIdentityMap,
  verifyRuntimeKitSource,
} from '../kimodo-shared-device-source-admission.mjs';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    'output-dir': { type: 'string' },
    mode: { type: 'string', default: 'load' },
    prompt: { type: 'string', default: 'a person dances' },
    duration: { type: 'string', default: '6' },
    steps: { type: 'string', default: '100' },
    'total-timeout-ms': { type: 'string', default: '600000' },
    'no-progress-timeout-ms': { type: 'string', default: '120000' },
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
const totalTimeoutMs = Number(values['total-timeout-ms']);
const noProgressTimeoutMs = Number(values['no-progress-timeout-ms']);
if (!Number.isSafeInteger(steps) || steps < 1) throw new Error('--steps must be a positive integer');
if (!Number.isFinite(duration) || duration < 1 || duration > 18) throw new Error('--duration must be between 1 and 18 seconds');
if (!Number.isFinite(totalTimeoutMs) || totalTimeoutMs < 300000 || totalTimeoutMs > 600000) {
  throw new Error('--total-timeout-ms must preserve the operator-approved 5–10 minute witness window');
}
if (!Number.isFinite(noProgressTimeoutMs) || noProgressTimeoutMs < 1000 || noProgressTimeoutMs > 120000) {
  throw new Error('--no-progress-timeout-ms must be between 1 second and 120 seconds');
}
const totalDeadlineMs = Date.now() + totalTimeoutMs;

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
    totalTimeoutMs,
    noProgressTimeoutMs,
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
const hostRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
let embeddingFixture = null;
report.failurePhase = 'source-preflight';
try {
  const sourceManifest = JSON.parse(readFileSync(join(hostRoot, 'artifacts/kimodo-shared-device/manifest.json')));
  const canonicalKit = JSON.parse(readFileSync(join(hostRoot, 'fixtures/webgpu-inference-kit-0.1.52-canonical-source.json')));
  const effectiveHostCommit = git(hostRoot, 'rev-parse', 'HEAD');
  const effectiveKimodoCommit = git(resolve(kimodoCheckout), 'rev-parse', 'HEAD');
  if (git(hostRoot, 'status', '--porcelain', '--untracked-files=no')) throw new Error('Kaminos tracked source is dirty');
  if (git(resolve(kimodoCheckout), 'status', '--porcelain', '--untracked-files=no')) throw new Error('Kimodo tracked source is dirty');
  if (sourceManifest.hostCommit !== effectiveHostCommit || sourceManifest.sourceCommit !== effectiveKimodoCommit) {
    throw new Error('derived source manifest does not match the effective clean host/provider commits');
  }
  if (sourceManifest.kitVersion !== '0.1.52' || sourceManifest.installedKitVersions?.host !== '0.1.52' || sourceManifest.installedKitVersions?.kimodo !== '0.1.52') {
    throw new Error('derived source manifest does not bind exact installed inference kit 0.1.52');
  }
  const servedFiles = verifyIdentityMap({ root: hostRoot, identities: sourceManifest.servedFiles, label: 'served source' });
  const bundles = verifyIdentityMap({
    root: join(hostRoot, 'artifacts/kimodo-shared-device/lib'),
    identities: sourceManifest.bundles,
    label: 'bundle',
  });
  const assets = verifyIdentityMap({
    root: join(hostRoot, 'artifacts/kimodo-shared-device/assets'),
    identities: sourceManifest.assets,
    label: 'asset',
  });
  const runtimeKit = verifyRuntimeKitSource({
    packageRoot: join(hostRoot, 'node_modules/@kaminos/webgpu-inference-kit'),
    runtimeKit: sourceManifest.runtimeKit,
    canonicalKit,
  });
  report.effective = {
    sourcePreflight: {
      hostCommit: effectiveHostCommit,
      kimodoCommit: effectiveKimodoCommit,
      kitVersion: sourceManifest.kitVersion,
      servedFiles,
      bundles,
      assets,
      runtimeKit,
    },
  };
  if (values['embedding-fixture']) {
    report.failurePhase = 'embedding-fixture';
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
  report.failurePhase = null;
  writeReport('starting');
} catch (error) {
  report.error = { name: error?.name || 'Error', message: error?.message || String(error) };
  report.finishedAt = new Date().toISOString();
  writeReport('failed');
  throw error;
}
let browser = null;
let page = null;
let lastTrustworthyComposition = null;
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

async function snapshotPageState() {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => {
    const state = window.__kimodoSharedDevice;
    if (!state) return null;
    return JSON.parse(JSON.stringify(state));
  });
}

async function snapshotComposition() {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => ({
    setup: window.__kaminosCompositionSetup ? JSON.parse(JSON.stringify(window.__kaminosCompositionSetup)) : null,
    state: window.__kimodoSharedDevice ? JSON.parse(JSON.stringify(window.__kimodoSharedDevice)) : null,
    volume: window.__kaminosVolumePrototype?.debugState ? JSON.parse(JSON.stringify(window.__kaminosVolumePrototype.debugState())) : null,
  }));
}

async function waitForProgress(label, predicate) {
  let lastMarker = null;
  let lastProgressAt = Date.now();
  while (true) {
    const snapshotResult = await boundedCleanup(snapshotComposition(), {
      label: `${label} page-state read`,
      timeoutMs: Math.max(1, Math.min(noProgressTimeoutMs, totalDeadlineMs - Date.now())),
    });
    if (snapshotResult.status !== 'succeeded') {
      const error = new Error(snapshotResult.error);
      error.code = Date.now() >= totalDeadlineMs ? 'TIMEOUT' : 'WEDGED';
      throw error;
    }
    const snapshot = snapshotResult.value;
    lastTrustworthyComposition = snapshot;
    if (snapshot?.setup?.status === 'failed') throw new Error(`composition mount failed: ${snapshot.setup.error || 'unknown error'}`);
    if (predicate(snapshot)) return snapshot;
    const marker = JSON.stringify([
      snapshot?.setup?.status,
      snapshot?.setup?.phase,
      snapshot?.state?.progressSequence,
      snapshot?.state?.status,
    ]);
    if (marker !== lastMarker) {
      lastMarker = marker;
      lastProgressAt = Date.now();
    }
    const failure = progressFailure({
      now: Date.now(),
      deadline: totalDeadlineMs,
      lastProgressAt,
      noProgressTimeoutMs,
      label,
      totalTimeoutMs,
    });
    if (failure) throw failure;
    await delay(250);
  }
}

async function captureScreenshot(name) {
  const path = join(outputDir, `${name}.png`);
  const capture = await boundedCleanup(page.screenshot({ path, type: 'png' }), {
    label: `screenshot ${name}`,
    timeoutMs: Math.max(1, Math.min(noProgressTimeoutMs, totalDeadlineMs - Date.now())),
  });
  if (capture.status !== 'succeeded') throw new Error(capture.error);
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
  page.setDefaultTimeout(Math.min(noProgressTimeoutMs, Math.max(1000, totalDeadlineMs - Date.now())));
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
    report.effective = { ...(report.effective ?? {}), embeddingEndpoint: fixtureUrl };
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
  const mounted = await waitForProgress('composition mount', snapshot => snapshot?.setup?.status === 'mounted');
  const initial = validateMountedComposition(mounted);
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
  const loadedSnapshot = await waitForProgress('model load', snapshot => ['loaded', 'failed'].includes(snapshot?.state?.status));
  const loaded = loadedSnapshot.state;
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
    const terminalSnapshot = await waitForProgress('generation', snapshot => ['succeeded', 'failed', 'canceled'].includes(snapshot?.state?.status));
    const terminal = terminalSnapshot.state;
    const lastRun = validateSuccessfulRun(terminal);
    phase('generation-succeeded', {
      runId: lastRun.runId,
      wallMs: lastRun.wallMs,
      pageP95Ms: lastRun.pageP95Ms,
      pageP99Ms: lastRun.pageP99Ms,
      pageMaxMs: lastRun.pageMaxMs,
      frameCount: lastRun.flameAfter?.frameCount,
      simStepCount: lastRun.flameAfter?.simStepCount,
      foregroundReceipts: lastRun.foregroundReceipts.length,
    });
    await captureScreenshot('03-generated');
  }

  const successfulTeardown = await boundedCleanup(
    page.evaluate(() => window.__kimodoSharedDeviceTeardown('smoke-finalize')),
    { label: 'successful page teardown', timeoutMs: 30000 },
  );
  report.teardown = successfulTeardown;
  if (successfulTeardown.status !== 'succeeded') throw new Error(successfulTeardown.error);
  report.failurePhase = null;
  const finalSnapshot = await boundedCleanup(snapshotPageState(), {
    label: 'final page-state read',
    timeoutMs: 30000,
  });
  if (finalSnapshot.status !== 'succeeded') throw new Error(finalSnapshot.error);
  report.pageState = finalSnapshot.value;
  report.finishedAt = new Date().toISOString();
  writeReport('succeeded');
} catch (error) {
  report.pageState = lastTrustworthyComposition?.state ?? null;
  report.error = { name: error?.name || 'Error', code: error?.code || null, message: error?.message || String(error), stack: error?.stack || null };
  report.classification = error?.code === 'WEDGED' ? 'wedged-no-progress' : (error?.code === 'TIMEOUT' ? 'bounded-timeout' : 'failed');
  report.finishedAt = new Date().toISOString();
  writeReport('failed');
  report.teardown = page
    ? await boundedCleanup(
      page.evaluate(() => window.__kimodoSharedDeviceTeardown?.('smoke-failure')),
      { label: 'failure page teardown', timeoutMs: 30000 },
    )
    : null;
  writeReport('failed');
  process.exitCode = 1;
} finally {
  if (browser) {
    const browserClose = await boundedCleanup(browser.close(), { label: 'browser close', timeoutMs: 30000 });
    report.browserClose = browserClose;
    if (browserClose.status !== 'succeeded') {
      browser.process()?.kill('SIGKILL');
      report.console.push({ at: new Date().toISOString(), type: 'browser-close-error', text: browserClose.error });
      if (report.status === 'succeeded') {
        report.failurePhase = 'browser-close';
        report.error = { name: 'Error', code: 'CLEANUP_TIMEOUT', message: browserClose.error, stack: null };
        report.finishedAt = new Date().toISOString();
        report.status = 'failed';
        process.exitCode = 1;
      }
    }
  }
  writeReport(report.status);
}
