#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';

import {
  assertStationaryHillContactWitnessState as assertState,
  EXPECTED_STATIONARY_CONTACT_ROUTE as EXPECTED_ROUTE,
} from './lirm-stationary-hill-contact-witness-core.mjs';

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

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
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result ?? {});
  };
  const opened = new Promise((accept, reject) => {
    socket.onopen = accept;
    socket.onerror = () => reject(new Error('Chrome DevTools websocket failed to open'));
  });
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

async function evaluate(cdp, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
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
    state = await evaluate(cdp, 'window.__LIRM_HILL_CONTACT_STATE__ ?? null');
    if (state?.status === 'error') throw new Error(`viewer failed: ${state.error}`);
    if (state?.status === 'loaded') return state;
    await new Promise(accept => setTimeout(accept, 100));
  }
  throw new Error(`viewer did not settle: ${JSON.stringify(state)}`);
}

async function capture(cdp, path) {
  const response = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  });
  const bytes = Buffer.from(response.data, 'base64');
  if (bytes.length < 4096 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`invalid PNG capture ${path}`);
  }
  await writeFile(path, bytes);
  return bytes;
}

function encodeVideo(frameRoot, outputPath, frameRate) {
  const result = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-framerate', String(frameRate),
    '-i', resolve(frameRoot, 'frame-%03d.png'),
    '-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2',
    '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg video failed: ${result.stderr || result.stdout}`);
}

function encodeContactSheet(frameRoot, outputPath) {
  const result = spawnSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', resolve(frameRoot, 'frame-%03d.png'),
    '-vf', "select='not(mod(n,4))',scale=384:240,tile=4x3",
    '-frames:v', '1', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg sheet failed: ${result.stderr || result.stdout}`);
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
  if (!browser || browser.exitCode !== null || browser.signalCode !== null) return;
  const exited = new Promise(accept => browser.once('exit', accept));
  browser.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise(accept => setTimeout(accept, 5000)),
  ]);
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill('SIGKILL');
    await exited;
  }
}

const options = parseArgs(process.argv.slice(2));
const outputRoot = resolve(options['out-dir']);
const frameRoot = resolve(outputRoot, 'frames');
const reportPath = resolve(outputRoot, 'report.json');
const videoPath = resolve(outputRoot, 'stationary-hill-contact.mp4');
const sheetPath = resolve(outputRoot, 'stationary-hill-contact-sheet.png');
const port = Number(options['debug-port'] || 9471);
const frameCount = Number(options['frame-count'] || 48);
const frameRate = Number(options['frame-rate'] || 12);
const chromePath = options.chrome || DEFAULT_CHROME;
const profile = resolve(outputRoot, 'chrome-profile');
const report = {
  schema: 'kaminos.lirm-stationary-hill-contact-witness.v0',
  status: 'fail',
  failurePhase: 'initialization',
  requestedRoute: EXPECTED_ROUTE,
  effectiveRoute: null,
  requestedUrl: options.url,
  effectiveUrl: null,
  frameCount,
  frameRate,
  states: [],
  outputs: {},
  eventCentered: [],
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
    '--window-size=1280,800',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
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
  assertState(initial);
  report.effectiveUrl = await evaluate(cdp, 'location.href');
  report.effectiveRoute = initial.effectiveRoute;
  const screen = await evaluate(cdp, 'window.__lirmHillContactScreenProbe()');
  if (!(screen?.areaRatio > 0.05)) throw new Error(`creature framing is too small: ${JSON.stringify(screen)}`);

  report.failurePhase = 'dense-capture';
  await evaluate(cdp, "window.__setLirmHillContactView('three-quarter')");
  for (let index = 0; index < frameCount; index += 1) {
    const phase = index / frameCount;
    const state = await evaluate(
      cdp,
      `window.__setLirmHillContactPhase(${JSON.stringify(phase)})`,
    );
    assertState(state);
    report.states.push({
      phase: state.phase,
      contactStates: state.contactStates,
      maximumResidual: state.maximumResidual,
      solveMilliseconds: state.solveMilliseconds,
    });
    await new Promise(accept => setTimeout(accept, 55));
    await capture(cdp, resolve(frameRoot, `frame-${String(index).padStart(3, '0')}.png`));
  }
  const uniqueContactStates = new Set(report.states.map(state => JSON.stringify(state.contactStates)));
  const expectedContactStates = JSON.stringify({
    'front-left': 'stance',
    'front-right': 'swing',
    'rear-left': 'swing',
    'rear-right': 'stance',
  });
  if (uniqueContactStates.size !== 1 || !uniqueContactStates.has(expectedContactStates)) {
    throw new Error('dense cycle did not preserve the exact published contact-state map');
  }
  if (new Set(report.states.map(state => state.phase.toFixed(9))).size !== frameCount) {
    throw new Error('dense cycle did not cover every requested body phase');
  }
  if (report.states.some(state => !Number.isFinite(state.maximumResidual))) {
    throw new Error('dense cycle produced non-finite residuals');
  }

  report.failurePhase = 'event-centered-capture';
  const eventPhase = await evaluate(cdp, 'window.__LIRM_HILL_CONTACT_EVENT_PHASE__');
  if (!Number.isFinite(eventPhase)) throw new Error('published event phase is missing');
  for (const view of ['profile', 'three-quarter']) {
    const camera = await evaluate(
      cdp,
      `window.__setLirmHillContactView(${JSON.stringify(view)})`,
    );
    for (const [index, offset] of [-0.025, 0, 0.025].entries()) {
      const state = await evaluate(
        cdp,
        `window.__setLirmHillContactPhase(${JSON.stringify(eventPhase + offset)})`,
      );
      assertState(state);
      await new Promise(accept => setTimeout(accept, 55));
      const path = resolve(outputRoot, `event-${view}-${String(index).padStart(2, '0')}.png`);
      const bytes = await capture(cdp, path);
      report.eventCentered.push({
        view,
        camera,
        eventPhase,
        offset,
        state: {
          phase: state.phase,
          contactStates: state.contactStates,
          maximumResidual: state.maximumResidual,
          solveMilliseconds: state.solveMilliseconds,
        },
        output: {
          path: relative(outputRoot, path),
          bytes: bytes.length,
          sha256: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
        },
      });
    }
  }

  report.failurePhase = 'encode';
  encodeVideo(frameRoot, videoPath, frameRate);
  encodeContactSheet(frameRoot, sheetPath);
  report.outputs.video = await fileRecord(videoPath, outputRoot);
  report.outputs.contactSheet = await fileRecord(sheetPath, outputRoot);
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
