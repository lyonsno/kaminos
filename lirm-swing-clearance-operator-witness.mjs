#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  SWING_CLEARANCE_ASSAY_ROUTE,
  SWING_CLEARANCE_SOURCE_HASH,
  SWING_CLEARANCE_SUPPORT_ID,
} from './lirm-swing-clearance-assay-core.mjs';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CAPTURES = Object.freeze([
  ...['three-quarter', 'profile', 'underside', 'collar-closeup'].map(view => ({
    variant: 'source', overlay: 'masks', view,
  })),
  ...['three-quarter', 'profile', 'underside', 'collar-closeup'].map(view => ({
    variant: 'translation', overlay: 'clearance', view,
  })),
  ...['profile', 'collar-closeup'].map(view => ({
    variant: 'translation', overlay: 'distortion', view,
  })),
  ...['three-quarter', 'profile', 'underside', 'collar-closeup'].map(view => ({
    variant: 'minimum-rotation', overlay: 'clearance', view,
  })),
  ...['profile', 'collar-closeup'].map(view => ({
    variant: 'minimum-rotation', overlay: 'distortion', view,
  })),
  ...['source', 'translation', 'minimum-rotation'].flatMap(variant =>
    ['three-quarter', 'profile'].map(view => ({ variant, overlay: 'textured', view }))),
]);

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) throw new Error(`invalid argument ${name}`);
    options[name.slice(2)] = value;
  }
  if (!options.url || !options['out-dir']) throw new Error('witness requires --url and --out-dir');
  return options;
}

function createCdpClient(url) {
  const socket = new WebSocket(url);
  let nextId = 1;
  const pending = new Map();
  const opened = new Promise((accept, reject) => {
    socket.onopen = accept;
    socket.onerror = () => reject(new Error('Chrome DevTools websocket failed to open'));
  });
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  };
  return {
    opened,
    close: () => socket.close(),
    async send(method, params = {}) {
      await opened;
      const id = nextId++;
      const response = new Promise((accept, reject) => pending.set(id, { resolve: accept, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
  };
}

async function waitForJson(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response.json();
    } catch {}
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error(`Chrome endpoint did not appear at ${url}`);
}

async function evaluate(cdp, expression) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
  }
  return response.result?.value;
}

async function waitForViewer(cdp, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let state = null;
  while (Date.now() < deadline) {
    state = await evaluate(cdp, 'window.__LIRM_SWING_CLEARANCE_STATE__ ?? null');
    if (state?.status === 'error') throw new Error(`viewer failed: ${state.error}`);
    if (state?.status === 'loaded') return state;
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error(`viewer did not settle: ${JSON.stringify(state)}`);
}

async function capture(cdp, path) {
  const probe = await evaluate(cdp, 'window.__lirmSwingClearanceVisualProbe()');
  if (!(probe?.activePixels > 120 && probe.activeRatio > 0.015)) {
    throw new Error(`blank frame rejected: ${JSON.stringify(probe)}`);
  }
  const response = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const bytes = Buffer.from(response.data, 'base64');
  if (bytes.length < 4096 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`blank frame or invalid PNG capture: ${path}`);
  }
  await writeFile(path, bytes);
  return { bytes, probe };
}

function encodeContactSheet(frameRoot, outputPath, count) {
  const columns = 4;
  const rows = Math.ceil(count / columns);
  const result = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-framerate', '1',
    '-i', resolve(frameRoot, 'frame-%03d.png'),
    '-vf', `scale=400:250:force_original_aspect_ratio=decrease,pad=400:250:(ow-iw)/2:(oh-ih)/2:color=black,tile=${columns}x${rows}`,
    '-frames:v', '1',
    outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg contact sheet failed: ${result.stderr || result.stdout}`);
}

async function fileRecord(path, root) {
  const bytes = await readFile(path);
  return {
    path: relative(root, path),
    bytes: bytes.length,
    sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  };
}

async function stopBrowser(browser) {
  if (!browser?.pid || browser.exitCode !== null || browser.signalCode !== null) return;
  const exited = new Promise(accept => browser.once('exit', accept));
  browser.kill('SIGTERM');
  await Promise.race([exited, new Promise(accept => setTimeout(accept, 5000))]);
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGKILL');
    await exited;
  }
}

const options = parseArgs(process.argv.slice(2));
const outputRoot = resolve(options['out-dir']);
const frameRoot = resolve(outputRoot, 'frames');
const reportPath = resolve(outputRoot, 'report.json');
const sheetPath = resolve(outputRoot, 'contact-sheet.png');
const profile = resolve(outputRoot, 'chrome-profile');
const port = Number(options['debug-port'] || 9473);
const chromePath = options.chrome || DEFAULT_CHROME;
const report = {
  schema: 'kaminos.lirm-swing-clearance-operator-witness.v0',
  status: 'fail',
  failurePhase: 'initialization',
  lastTrustworthyEvidence: null,
  requestedRoute: SWING_CLEARANCE_ASSAY_ROUTE,
  effectiveRoute: null,
  requestedUrl: options.url,
  effectiveUrl: null,
  requestedSourceHash: SWING_CLEARANCE_SOURCE_HASH,
  actualSourceHash: null,
  supportId: SWING_CLEARANCE_SUPPORT_ID,
  captures: [],
  outputs: {},
  error: null,
};

await rm(outputRoot, { recursive: true, force: true });
await mkdir(frameRoot, { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

let browser = null;
let cdp = null;
try {
  report.failurePhase = 'browser-launch';
  browser = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu-sandbox',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--window-size=1440,900',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const launchFailure = new Promise((accept, reject) => {
    browser.once('error', error => reject(
      new Error(`Chrome launch failed for ${chromePath}: ${error.message}`, { cause: error }),
    ));
  });
  await Promise.race([
    waitForJson(`http://127.0.0.1:${port}/json/version`),
    launchFailure,
  ]);
  const target = await fetch(
    `http://127.0.0.1:${port}/json/new?${encodeURIComponent(options.url)}`,
    { method: 'PUT' },
  ).then(response => response.json());
  cdp = createCdpClient(target.webSocketDebuggerUrl);
  await cdp.opened;
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  report.failurePhase = 'viewer-admission';
  const initial = await waitForViewer(cdp);
  report.effectiveUrl = await evaluate(cdp, 'location.href');
  report.effectiveRoute = initial.effectiveRoute;
  report.actualSourceHash = initial.actualSourceHash;
  if (initial.effectiveRoute !== SWING_CLEARANCE_ASSAY_ROUTE
      || initial.actualSourceHash !== SWING_CLEARANCE_SOURCE_HASH
      || initial.supportId !== 'rear-left'
      || initial.static !== true) {
    throw new Error(`viewer identity mismatch: ${JSON.stringify(initial)}`);
  }
  report.lastTrustworthyEvidence = {
    phase: 'viewer-admission',
    effectiveRoute: initial.effectiveRoute,
    actualSourceHash: initial.actualSourceHash,
    supportId: initial.supportId,
    static: initial.static,
  };

  report.failurePhase = 'capture';
  for (const [index, spec] of CAPTURES.entries()) {
    const state = await evaluate(
      cdp,
      `(() => {
        window.__setLirmSwingClearanceVariant(${JSON.stringify(spec.variant)});
        window.__setLirmSwingClearanceOverlay(${JSON.stringify(spec.overlay)});
        return window.__setLirmSwingClearanceView(${JSON.stringify(spec.view)});
      })()`,
    );
    if (state.variant !== spec.variant || state.overlay !== spec.overlay || state.view !== spec.view) {
      throw new Error(`capture state mismatch: ${JSON.stringify({ spec, state })}`);
    }
    await new Promise(accept => setTimeout(accept, 80));
    const path = resolve(frameRoot, `frame-${String(index).padStart(3, '0')}.png`);
    const captured = await capture(cdp, path);
    const output = {
      path: relative(outputRoot, path),
      bytes: captured.bytes.length,
      sha256: `sha256:${createHash('sha256').update(captured.bytes).digest('hex')}`,
    };
    report.captures.push({ index, ...spec, probe: captured.probe, output });
    report.lastTrustworthyEvidence = {
      phase: 'capture',
      index,
      ...spec,
      probe: captured.probe,
      output,
    };
  }

  report.failurePhase = 'encode';
  encodeContactSheet(frameRoot, sheetPath, CAPTURES.length);
  report.outputs.contactSheet = await fileRecord(sheetPath, outputRoot);
  report.lastTrustworthyEvidence = {
    phase: 'encode',
    captureCount: report.captures.length,
    contactSheet: report.outputs.contactSheet,
  };
  report.status = 'pass';
  report.failurePhase = null;
} catch (error) {
  report.error = {
    name: error?.name || 'Error',
    message: String(error?.message || error),
    stack: String(error?.stack || ''),
  };
  process.exitCode = 1;
} finally {
  cdp?.close();
  await stopBrowser(browser);
  try {
    await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  } catch (error) {
    if (report.status === 'pass') {
      report.status = 'fail';
      report.failurePhase = 'browser-cleanup';
      report.error = {
        name: error?.name || 'Error',
        message: String(error?.message || error),
        stack: String(error?.stack || ''),
      };
      process.exitCode = 1;
    }
  }
  const temporary = `${reportPath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`);
  await rename(temporary, reportPath);
}

if (report.status === 'pass') console.log(reportPath);
else console.error(`${report.failurePhase}: ${report.error?.message || 'unknown failure'}`);
