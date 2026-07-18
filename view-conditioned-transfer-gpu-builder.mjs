#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { createWriteStream } from 'node:fs';
import { mkdir as mkdirAsync, mkdtemp as mkdtempAsync, readFile as readFileAsync, rm as rmAsync, symlink as symlinkAsync, writeFile as writeFileAsync } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeWritable, runCleanupActions } from './view-conditioned-transfer-gpu-cleanup.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SCHEMA = 'kaminos.view-conditioned-transfer-gpu-builder.v0';
const REPORT_NAME = 'gpu-builder-report.json';
const SCREENSHOT_NAME = 'gpu-builder-witness.png';
const EXPECTED_DENSE_SHAPE = [96, 242, 314];
const EXPECTED_REDUCED_SHAPE = [12, 121, 157];
const EXPECTED_OUTPUT_SHAPE = [242, 314];

function parseArgs(argv) {
  const values = {};
  const names = new Map([
    ['--input-manifest', 'inputManifest'],
    ['--treatment-report', 'treatmentReport'],
    ['--treatment-label', 'treatmentLabel'],
    ['--out-dir', 'outDir'],
    ['--samples', 'samples'],
    ['--warmup', 'warmup'],
    ['--cadences', 'cadences'],
    ['--python', 'python'],
    ['--chrome', 'chrome'],
    ['--phase-timeout-ms', 'phaseTimeoutMs'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const name = names.get(key);
    if (!name) throw new Error(`unknown argument: ${key}`);
    if (index + 1 >= argv.length) throw new Error(`missing value for ${key}`);
    values[name] = argv[++index];
  }
  for (const [key, name] of names) {
    if (values[name] === undefined) throw new Error(`${key} is required`);
  }
  if (!/^\d+$/.test(values.samples) || Number(values.samples) < 1) throw new Error('--samples must be a positive integer');
  if (!/^\d+$/.test(values.warmup)) throw new Error('--warmup must be a nonnegative integer');
  if (!/^\d+$/.test(values.phaseTimeoutMs) || Number(values.phaseTimeoutMs) < 1) throw new Error('--phase-timeout-ms must be a positive integer');
  values.samples = Number(values.samples);
  values.warmup = Number(values.warmup);
  values.phaseTimeoutMs = Number(values.phaseTimeoutMs);
  values.cadences = parseCadences(values.cadences);
  return values;
}

function parseCadences(raw) {
  const cadences = raw.split(',').map(value => {
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`--cadences values must be a positive integer: ${value}`);
    return Number(value);
  });
  if (new Set(cadences).size !== cadences.length) throw new Error('--cadences values must be unique');
  return cadences;
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

function phaseTimeout(promise, milliseconds, label) {
  let timeout = null;
  const expired = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} exceeded caller phase timeout ${milliseconds}ms`)), milliseconds);
  });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timeout));
}

function sameShape(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function requireShape(actual, expected, label) {
  if (!sameShape(actual, expected)) throw new Error(`${label} must be [${expected.join(',')}], got ${JSON.stringify(actual)}`);
}

async function sha256File(path) {
  return createHash('sha256').update(await readFileAsync(path)).digest('hex');
}

async function writeJson(path, value) {
  await writeFileAsync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function runProcess(command, args, phaseTimeoutMs, label, options = {}) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  let exit;
  try {
    exit = await phaseTimeout(once(child, 'exit'), phaseTimeoutMs, label);
  } catch (error) {
    child.kill('SIGKILL');
    throw error;
  }
  const [code, signal] = exit;
  if (code !== 0) throw new Error(`${command} exited ${code ?? `by signal ${signal}`}`);
}

async function reservePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolveClose, rejectClose) => socket.close(error => error ? rejectClose(error) : resolveClose()));
  if (!port) throw new Error('could not reserve an HTTP port');
  return port;
}

async function waitForHttp(url, child) {
  while (child.exitCode === null) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server may still be binding.
    }
    await delay(50);
  }
  throw new Error(`HTTP server exited before serving the benchmark: ${child.exitCode}`);
}

async function waitForDevtools(profile, child) {
  const portFile = join(profile, 'DevToolsActivePort');
  while (child.exitCode === null) {
    try {
      const [port] = (await readFileAsync(portFile, 'utf8')).trim().split('\n');
      if (port) return Number(port);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(50);
  }
  throw new Error(`Chrome exited before DevTools became available: ${child.exitCode}`);
}

class CdpSession {
  constructor(url, phaseTimeoutMs) {
    this.socket = new WebSocket(url);
    this.phaseTimeoutMs = phaseTimeoutMs;
    this.nextId = 1;
    this.pending = new Map();
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async open() {
    await new Promise((resolveOpen, rejectOpen) => {
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
    });
    this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed with requests pending')));
    this.socket.addEventListener('error', () => this.rejectPending(new Error('CDP socket failed with requests pending')));
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const response = new Promise((resolveRequest, rejectRequest) => {
      this.pending.set(id, { resolve: resolveRequest, reject: rejectRequest });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
    return phaseTimeout(response, this.phaseTimeoutMs, `CDP ${method}`).finally(() => this.pending.delete(id));
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(session, expression) {
  const response = await session.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || 'browser evaluation failed');
  return response.result?.value;
}

async function waitForPageResult(session, chrome, server) {
  while (chrome.exitCode === null && server.exitCode === null) {
    const state = await evaluate(session, 'window.__TRANSFER_GPU_BUILDER__ ?? null');
    if (state?.status === 'failed') throw new Error(`${state.failurePhase}: ${state.error}`);
    if (state?.status === 'complete') return state;
    await delay(100);
  }
  throw new Error(`benchmark dependency exited early: chrome=${chrome.exitCode}, server=${server.exitCode}`);
}

async function terminate(child, phaseTimeoutMs, label) {
  if (!child || child.exitCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  try {
    await phaseTimeout(exited, phaseTimeoutMs, `${label} termination`);
  } catch (error) {
    child.kill('SIGKILL');
    if (child.exitCode === null) await phaseTimeout(once(child, 'exit'), phaseTimeoutMs, `${label} forced termination`);
    throw error;
  }
}

async function run(args) {
  const outDir = resolve(args.outDir);
  const inputDir = join(outDir, 'gpu-input');
  const reportPath = join(outDir, REPORT_NAME);
  const screenshotPath = join(outDir, SCREENSHOT_NAME);
  await mkdirAsync(outDir, { recursive: true });
  await rmAsync(inputDir, { recursive: true, force: true });
  await rmAsync(screenshotPath, { force: true });
  const report = {
    schema: SCHEMA,
    status: 'running',
    failurePhase: 'argument-validation',
    requested: {
      inputManifest: resolve(args.inputManifest),
      treatmentReport: resolve(args.treatmentReport),
      treatmentLabel: args.treatmentLabel,
      outDir,
      samples: args.samples,
      warmup: args.warmup,
      cadences: args.cadences,
      phaseTimeoutMs: args.phaseTimeoutMs,
      python: resolve(args.python),
      chrome: resolve(args.chrome),
    },
    effective: null,
    browserLaunchCount: 0,
    timestampStatus: 'pending',
    builderOutputValidation: null,
    compositorOutputValidation: null,
    optimizationClaimAllowed: false,
    artifacts: {},
  };
  await writeJson(reportPath, report);

  let chrome = null;
  let server = null;
  let session = null;
  let profile = null;
  let httpRoot = null;
  let browserLog = null;
  let serverLog = null;
  try {
    report.failurePhase = 'input-export';
    await writeJson(reportPath, report);
    await runProcess(resolve(args.python), [
      join(ROOT, 'view-conditioned-transfer-gpu-export.py'),
      '--input-manifest', resolve(args.inputManifest),
      '--treatment-report', resolve(args.treatmentReport),
      '--treatment-label', args.treatmentLabel,
      '--out-dir', inputDir,
    ], args.phaseTimeoutMs, 'authenticated input export', { cwd: ROOT });
    const exportedManifestPath = join(inputDir, 'gpu-input-manifest.json');
    const exportedManifest = JSON.parse(await readFileAsync(exportedManifestPath, 'utf8'));
    if (exportedManifest.status !== 'complete' || exportedManifest.failurePhase !== null) throw new Error('exported GPU input is not complete');
    report.failurePhase = 'export-authority-validation';
    if (args.treatmentLabel !== 'd12-t2' || exportedManifest.treatment.label !== args.treatmentLabel) throw new Error(`effective treatment must be d12-t2, got requested=${args.treatmentLabel} effective=${exportedManifest.treatment.label}`);
    if (exportedManifest.effective.tileSize !== 2) throw new Error(`effective treatment tile size must be 2, got ${exportedManifest.effective.tileSize}`);
    requireShape(exportedManifest.effective.denseShape, EXPECTED_DENSE_SHAPE, 'exportedManifest.effective.denseShape');
    requireShape(exportedManifest.effective.reducedShape, EXPECTED_REDUCED_SHAPE, 'exportedManifest.effective.reducedShape');
    requireShape(exportedManifest.effective.outputShape, EXPECTED_OUTPUT_SHAPE, 'exportedManifest.effective.outputShape');
    requireShape(exportedManifest.artifacts.occluderDepth?.shape, EXPECTED_OUTPUT_SHAPE, 'exportedManifest.artifacts.occluderDepth.shape');

    report.failurePhase = 'source-receipt';
    report.sources = {
      inputManifest: { path: resolve(args.inputManifest), sha256: await sha256File(resolve(args.inputManifest)) },
      treatmentReport: { path: resolve(args.treatmentReport), sha256: await sha256File(resolve(args.treatmentReport)) },
      exportedManifest: { path: exportedManifestPath, sha256: await sha256File(exportedManifestPath) },
      exporter: { path: join(ROOT, 'view-conditioned-transfer-gpu-export.py'), sha256: await sha256File(join(ROOT, 'view-conditioned-transfer-gpu-export.py')) },
      page: { path: join(ROOT, 'view-conditioned-transfer-gpu-builder.html'), sha256: await sha256File(join(ROOT, 'view-conditioned-transfer-gpu-builder.html')) },
      witness: { path: fileURLToPath(import.meta.url), sha256: await sha256File(fileURLToPath(import.meta.url)) },
    };
    await writeJson(reportPath, report);

    report.failurePhase = 'http-server-launch';
    const port = await reservePort();
    httpRoot = await mkdtempAsync(join(tmpdir(), 'kaminos-transfer-gpu-http-'));
    await symlinkAsync(ROOT, join(httpRoot, 'worktree'), 'dir');
    await symlinkAsync(outDir, join(httpRoot, 'output'), 'dir');
    serverLog = createWriteStream(join(outDir, 'http-server.log'));
    server = spawn(resolve(args.python), ['-m', 'http.server', String(port), '--bind', '127.0.0.1', '--directory', httpRoot], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    server.stderr.pipe(serverLog);
    const htmlRoute = `http://127.0.0.1:${port}/worktree/view-conditioned-transfer-gpu-builder.html`;
    await phaseTimeout(waitForHttp(htmlRoute, server), args.phaseTimeoutMs, 'HTTP server startup');
    const manifestRoute = `/output/gpu-input/gpu-input-manifest.json`;
    const requestedRoute = `${htmlRoute}?${new URLSearchParams({ manifest: manifestRoute, samples: String(args.samples), warmup: String(args.warmup), cadences: args.cadences.join(',') })}`;

    report.failurePhase = 'browser-launch';
    profile = await mkdtempAsync(join(tmpdir(), 'kaminos-transfer-gpu-'));
    browserLog = createWriteStream(join(outDir, 'chrome-stderr.log'));
    chrome = spawn(resolve(args.chrome), [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--enable-unsafe-webgpu',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    report.browserLaunchCount = 1;
    await writeJson(reportPath, report);
    chrome.stderr.pipe(browserLog);
    const devtoolsPort = await phaseTimeout(waitForDevtools(profile, chrome), args.phaseTimeoutMs, 'Chrome DevTools startup');

    report.failurePhase = 'cdp-connect';
    const targets = await phaseTimeout(
      fetch(`http://127.0.0.1:${devtoolsPort}/json/list`).then(response => response.json()),
      args.phaseTimeoutMs,
      'Chrome target discovery',
    );
    const pageTarget = targets.find(target => target.type === 'page');
    if (!pageTarget?.webSocketDebuggerUrl) throw new Error('Chrome exposed no page target');
    session = new CdpSession(pageTarget.webSocketDebuggerUrl, args.phaseTimeoutMs);
    await phaseTimeout(session.open(), args.phaseTimeoutMs, 'CDP socket open');
    await session.send('Page.enable');
    await session.send('Runtime.enable');
    await session.send('Emulation.setDeviceMetricsOverride', {
      width: 1180, height: 1400, deviceScaleFactor: 1, mobile: false,
    });

    report.failurePhase = 'benchmark-navigation';
    await session.send('Page.navigate', { url: requestedRoute });
    const pageReport = await phaseTimeout(waitForPageResult(session, chrome, server), args.phaseTimeoutMs, 'GPU builder benchmark page');
    const effectiveRoute = await evaluate(session, 'location.href');

    report.failurePhase = 'authority-validation';
    if (pageReport.timestampStatus !== 'available') throw new Error(`timestamp authority missing: ${pageReport.timestampStatus}`);
    if (pageReport.effectiveSamples?.builder !== args.samples) throw new Error('browser silently changed the builder sample count');
    for (const cadence of args.cadences) {
      const samples = pageReport.effectiveSamples?.schedules?.[String(cadence)];
      if (samples?.dense !== args.samples || samples?.reduced !== args.samples) throw new Error(`browser silently changed cadence ${cadence} sample counts`);
    }
    if (JSON.stringify(pageReport.effectiveCadences) !== JSON.stringify(args.cadences)) throw new Error(`pageReport.effectiveCadences drifted from args.cadences: ${JSON.stringify(pageReport.effectiveCadences)}`);
    if (!Object.values(pageReport.builderOutputValidation || {}).every(result => result?.passed)) throw new Error('GPU builder output did not match persisted d12-t2 buffers');
    if (!Object.values(pageReport.compositorOutputValidation || {}).every(result => result?.passed)) throw new Error('GPU compositor output did not match CPU references');
    if (!pageReport.optimizationClaimAllowed) throw new Error('page withheld optimization claim authority');
    if (pageReport.inputManifest?.sha256 !== report.sources.exportedManifest.sha256) throw new Error('browser measured a different exported manifest');
    if (pageReport.inputManifest?.treatmentLabel !== 'd12-t2') throw new Error(`browser treatment identity drifted: ${pageReport.inputManifest?.treatmentLabel}`);
    if (pageReport.workload?.outputWidth !== 314 || pageReport.workload?.outputHeight !== 242) throw new Error(`browser workload output must be 314x242, got ${pageReport.workload?.outputWidth}x${pageReport.workload?.outputHeight}`);
    if (pageReport.workload?.denseDepthBins !== 96 || pageReport.workload?.reducedDepthGroups !== 12 || pageReport.workload?.reducedTileSize !== 2) throw new Error('browser workload treatment dimensions drifted');

    report.failurePhase = 'visual-capture';
    const capture = await session.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: false, fromSurface: true,
    });
    await writeFileAsync(screenshotPath, Buffer.from(capture.data, 'base64'));
    const screenshotBytes = (await readFileAsync(screenshotPath)).byteLength;
    if (screenshotBytes < 4096) throw new Error(`benchmark screenshot is blank or partial: ${screenshotBytes} bytes`);

    report.status = 'complete';
    report.failurePhase = null;
    report.timestampStatus = pageReport.timestampStatus;
    report.builderOutputValidation = pageReport.builderOutputValidation;
    report.compositorOutputValidation = pageReport.compositorOutputValidation;
    report.optimizationClaimAllowed = true;
    report.effective = {
      route: effectiveRoute,
      browserBackend: 'chrome-headless-webgpu-cdp-v0',
      browserExecutable: resolve(args.chrome),
      browserLaunchCount: 1,
      compositorIdentities: pageReport.compositorIdentities,
      sampleCount: pageReport.effectiveSamples,
      warmupCount: pageReport.effectiveWarmup,
      cadences: pageReport.effectiveCadences,
      fallbackUsed: false,
      ignoredParameters: null,
      caps: null,
    };
    report.page = pageReport;
    report.artifacts = {
      screenshot: { path: screenshotPath, bytes: screenshotBytes, sha256: await sha256File(screenshotPath) },
      inputReport: { path: join(inputDir, 'gpu-input-report.json'), sha256: await sha256File(join(inputDir, 'gpu-input-report.json')) },
      inputManifest: report.sources.exportedManifest,
      chromeLog: { path: join(outDir, 'chrome-stderr.log') },
      serverLog: { path: join(outDir, 'http-server.log') },
    };
    await writeJson(reportPath, report);
    return report;
  } catch (error) {
    Object.assign(report, {
      status: 'failed',
      failurePhase: report.failurePhase,
      error: `${error?.name || 'Error'}: ${error?.message || String(error)}`,
      stack: error?.stack || null,
      timestampStatus: report.timestampStatus === 'pending' ? 'unverified' : report.timestampStatus,
      builderOutputValidation: null,
      compositorOutputValidation: null,
      optimizationClaimAllowed: false,
    });
    await writeJson(reportPath, report);
    throw error;
  } finally {
    const cleanupErrors = await runCleanupActions([
      { label: 'session-close', run: async () => session?.close() },
      { label: 'chrome-termination', run: async () => {
        if (chrome) await terminate(chrome, args.phaseTimeoutMs, 'Chrome'); // chrome.kill is performed inside terminate.
      } },
      { label: 'server-termination', run: async () => {
        if (server) await terminate(server, args.phaseTimeoutMs, 'HTTP server'); // server.kill is performed inside terminate.
      } },
      { label: 'browser-log-close', run: async () => closeWritable(browserLog) },
      { label: 'server-log-close', run: async () => closeWritable(serverLog) },
      { label: 'profile-removal', run: async () => {
        if (profile) await rmAsync(profile, { recursive: true, force: true });
      } },
      { label: 'http-root-removal', run: async () => {
        if (httpRoot) await rmAsync(httpRoot, { recursive: true, force: true });
      } },
    ]);
    if (cleanupErrors.length > 0) {
      const cleanupError = new AggregateError(
        cleanupErrors.map(error => new Error(`${error.label}: ${error.name}: ${error.message}`)),
        `benchmark cleanup failed in ${cleanupErrors.length} action(s)`,
      );
      Object.assign(report, {
        status: 'failed',
        failurePhase: 'cleanup',
        error: `${cleanupError?.name || 'Error'}: ${cleanupError?.message || String(cleanupError)}`,
        stack: cleanupError?.stack || null,
        cleanupErrors,
        optimizationClaimAllowed: false,
      });
      await writeJson(reportPath, report);
      throw cleanupError;
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await run(args);
}

main().catch(error => {
  console.error(`view-conditioned transfer GPU benchmark failed: ${error?.stack || error}`);
  process.exitCode = 1;
});
