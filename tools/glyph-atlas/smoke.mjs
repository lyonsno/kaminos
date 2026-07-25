#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { ATLAS_SCHEMA, BUILD_REPORT_SCHEMA } from './core.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) throw new Error(`unexpected positional argument: ${key}`);
  args.set(key, process.argv[++index]);
}

const atlasRoot = resolve(args.get('--atlas') || 'scratch/glyph-atlas');
const screenshotPath = resolve(args.get('--out') || join(atlasRoot, 'smoke.png'));
const reportPath = resolve(args.get('--report') || join(atlasRoot, 'smoke-report.json'));
const chromePath = resolve(args.get('--chrome') || process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
let phase = 'manifest-load';
let primaryOutputWritten = false;
let requestedUrl = null;
let effectiveUrl = null;
let manifestIdentity = null;
let profile = null;
let chrome = null;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function report(body) {
  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify({
    schema: 'kaminos.glyph-atlas.smoke-report.v0',
    ...body,
  }, null, 2)}\n`);
}

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

async function waitForDebugPort() {
  const activePortPath = join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const [portText] = (await readFile(activePortPath, 'utf8')).split('\n');
      const port = Number.parseInt(portText, 10);
      if (Number.isFinite(port)) return port;
    } catch {
      // Chrome writes the port file after its profile is initialized.
    }
    await delay(100);
  }
  throw new Error('Chrome launch failed: DevToolsActivePort did not appear');
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0;
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`CDP ${request.method} failed: ${message.error.message}`));
    else request.resolve(message.result);
  });
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('Chrome launch failed: CDP socket error')), { once: true });
  });
  return {
    socket,
    call(method, params = {}) {
      const id = ++sequence;
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { method, resolve: resolveCall, reject: rejectCall });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}

async function waitForSelectedState(cdp) {
  const expression = `(() => ({
    ready: document.readyState === 'complete' && document.fonts.status === 'loaded',
    effectiveUrl: location.href,
    exportVisible: document.querySelector('#export')?.classList.contains('visible') || false,
    selectedGlyph: document.querySelector('.glyph.selected')?.dataset.glyph || null
  }))()`;
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true });
    const state = result.result?.value;
    if (state?.ready && state.exportVisible && state.selectedGlyph === 'K') return state;
    await delay(100);
  }
  throw new Error('deep-linked glyph did not reach loaded selected export state');
}

try {
  const manifestBytes = await readFile(join(atlasRoot, 'manifest.json'));
  manifestIdentity = hash(manifestBytes);
  const manifest = JSON.parse(manifestBytes);
  if (manifest.schema !== ATLAS_SCHEMA) throw new Error(`atlas schema disagreement: ${manifest.schema}`);
  if (!manifest.faces?.length) throw new Error('atlas manifest has no faces');
  const face = manifest.faces.find(candidate => !candidate.family.startsWith('.')) || manifest.faces[0];
  const url = new URL(pathToFileURL(join(atlasRoot, 'index.html')));
  url.searchParams.set('face', face.id);
  url.searchParams.set('glyph', 'K');
  requestedUrl = url.href;
  profile = await mkdtemp(join(tmpdir(), 'kaminos-glyph-atlas-smoke-'));

  const chromeArgs = [
    '--headless=new',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--no-default-browser-check',
    '--no-first-run',
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--window-size=1440,1100',
    requestedUrl,
  ];
  phase = 'dom-route-verification';
  let launchError = null;
  chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore' });
  chrome.once('error', error => { launchError = error; });
  const port = await waitForDebugPort();
  if (launchError) throw new Error(`Chrome launch failed: ${launchError.message}`);
  let pages = null;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    pages = await response.json();
    if (pages.some(page => page.type === 'page')) break;
    await delay(100);
  }
  const page = pages?.find(candidate => candidate.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error('Chrome launch failed: no page target');
  const cdp = await connectCdp(page.webSocketDebuggerUrl);
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  const selectedState = await waitForSelectedState(cdp);
  effectiveUrl = selectedState.effectiveUrl;
  if (effectiveUrl !== requestedUrl) throw new Error(`effective URL mismatch: requested ${requestedUrl}, got ${effectiveUrl}`);

  phase = 'capture-screenshot';
  await mkdir(dirname(screenshotPath), { recursive: true });
  const capture = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(screenshotPath, Buffer.from(capture.data, 'base64'));
  const screenshot = await readFile(screenshotPath);
  if (screenshot.length < 10000 || screenshot.readUInt32BE(0) !== 0x89504e47) {
    throw new Error(`missing-or-blank-output: invalid screenshot (${screenshot.length} bytes)`);
  }
  primaryOutputWritten = true;
  await report({
    status: 'completed',
    failurePhase: null,
    primaryOutputWritten,
    route: {
      requestedUrl,
      effectiveUrl,
      chromePath,
      atlasRoot,
      manifestIdentity,
      selectedFace: face.id,
      selectedGlyph: 'K',
    },
    screenshot: {
      path: screenshotPath,
      bytes: screenshot.length,
      sha256: hash(screenshot),
    },
  });
  await cdp.call('Browser.close').catch(() => {});
  cdp.socket.close();
  console.log(JSON.stringify({ ok: true, report: reportPath, screenshot: screenshotPath, requestedUrl, effectiveUrl }, null, 2));
} catch (error) {
  await report({
    status: 'failed',
    failurePhase: phase,
    primaryOutputWritten,
    error: error instanceof Error ? error.message : String(error),
    route: { requestedUrl, effectiveUrl, chromePath, atlasRoot, manifestIdentity },
    lastTrustworthyEvidence: { phase, manifestIdentity, requestedUrl, effectiveUrl },
  });
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 2;
} finally {
  if (chrome && chrome.exitCode === null) chrome.kill('SIGTERM');
  if (profile) await rm(profile, { recursive: true, force: true });
}
