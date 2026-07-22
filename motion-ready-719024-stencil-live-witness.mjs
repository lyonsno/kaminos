#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { closeCdpBrowser, requestCdp } from './motion-ready-719024-cdp.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index], process.argv[index + 1]);

function positiveInt(value, fallback, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

const requestedUrl = new URL(args.get('--url') || 'http://127.0.0.1:18124/motion-ready-719024-stencil.html');
requestedUrl.searchParams.set('operator_session', args.get('--operator-session') || 'oracle-stencil-live-witness');
const url = requestedUrl.href;
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = resolve(args.get('--out-dir') || `/tmp/kaminos-motion-ready-719024-stencil-witness-${timestamp}`);
const reportPath = resolve(args.get('--report') || `${outDir}/report.json`);
const screenshotPath = resolve(args.get('--screenshot') || `${outDir}/oracle-stencil.png`);
const port = positiveInt(args.get('--debug-port'), 9784, '--debug-port');
const cdpTimeoutMs = positiveInt(args.get('--cdp-timeout-ms'), 15_000, '--cdp-timeout-ms');
const witnessTimeoutMs = positiveInt(args.get('--witness-timeout-ms'), 30_000, '--witness-timeout-ms');
const windowWidth = positiveInt(args.get('--window-width'), 1440, '--window-width');
const windowHeight = positiveInt(args.get('--window-height'), 960, '--window-height');
const chrome = process.env.KAMINOS_CHROME || args.get('--chrome') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = args.get('--user-data-dir') || `/tmp/kaminos-motion-ready-719024-stencil-profile-${port}-${process.pid}`;

let phase = 'initializing';
let stderr = '';
let effectiveUrl = null;
let browserVersion = null;
let chromeProcess = null;
let ws = null;
let lastTrustworthyEvidence = { phase: 'initializing' };

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify({
    schema: 'kaminos.motion-ready-719024.oracle-stencil-live-witness.v0',
    requestedUrl: url,
    effectiveUrl,
    requestedStencilSource: requestedUrl.searchParams.get('stencil_url'),
    syntheticAuthoring: true,
    semanticQualityClaim: 'not-claimed',
    browserVersion,
    chrome,
    debugPort: port,
    userDataDir,
    readinessTimeouts: { cdpTimeoutMs, witnessTimeoutMs },
    outDir,
    reportPath,
    screenshotPath,
    phase,
    lastTrustworthyEvidence,
    stderrTail: stderr.slice(-4000),
    ...report,
  }, null, 2));
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} returned ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  const deadline = Date.now() + cdpTimeoutMs;
  let attempts = 0;
  while (Date.now() < deadline) {
    attempts++;
    if (chromeProcess?.exitCode != null) throw new Error(`Chrome exited before CDP opened (${chromeProcess.exitCode})`);
    try {
      const version = await cdpFetch('/json/version');
      lastTrustworthyEvidence = { phase: 'connecting-cdp', attempts, cdpOpened: true };
      return version;
    } catch (error) {
      lastTrustworthyEvidence = { phase: 'connecting-cdp', attempts, error: error.message };
      await delay(100);
    }
  }
  throw new Error(`CDP did not open within ${cdpTimeoutMs} ms`);
}

async function waitForWebSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) return;
  await new Promise((resolveOpen, rejectOpen) => {
    const cleanup = () => {
      socket.removeEventListener('open', onOpen);
      socket.removeEventListener('error', onError);
    };
    const onOpen = () => { cleanup(); resolveOpen(); };
    const onError = () => { cleanup(); rejectOpen(new Error('CDP WebSocket failed to open')); };
    socket.addEventListener('open', onOpen);
    socket.addEventListener('error', onError);
  });
}

async function evaluate(expression) {
  const response = await requestCdp(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function readDebugState() {
  return evaluate('window.kaminosOracleStencilDebugState?.() || null');
}

async function waitForState(predicate, label) {
  const deadline = Date.now() + witnessTimeoutMs;
  while (Date.now() < deadline) {
    const debug = await readDebugState();
    const status = await evaluate('document.getElementById("status")?.textContent || null');
    lastTrustworthyEvidence = { phase, label, status, debug };
    if (debug && predicate(debug)) return debug;
    if (debug?.consoleFailures?.length) throw new Error(`browser console failure: ${debug.consoleFailures.join('\n')}`);
    await delay(100);
  }
  throw new Error(`${label} did not settle within ${witnessTimeoutMs} ms`);
}

async function setLabel(label) {
  await evaluate(`document.getElementById('region-label').value = ${JSON.stringify(label)}`);
}

async function setSizes(x, y = x, z = x) {
  await evaluate(`(() => {
    const values = ${JSON.stringify([x, y, z])};
    ['x', 'y', 'z'].forEach((axis, index) => {
      const input = document.getElementById('size-' + axis);
      input.value = String(values[index]);
      document.getElementById('size-' + axis + '-value').value = Number(values[index]).toFixed(2);
    });
  })()`);
}

async function authorRegion(mode, label, points, sizes) {
  await evaluate(`window.kaminosOracleStencilSetMode(${JSON.stringify(mode)})`);
  await setLabel(label);
  await setSizes(...sizes);
  for (const point of points) {
    await evaluate(`window.kaminosOracleStencilAddLocalPoint(${JSON.stringify(point)})`);
  }
}

try {
  mkdirSync(outDir, { recursive: true });
  mkdirSync(userDataDir, { recursive: true });
  phase = 'launching-chrome';
  chromeProcess = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-networking',
    '--disable-default-apps',
    `--window-size=${windowWidth},${windowHeight}`,
    url,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', chunk => { stderr += chunk.toString(); });
  chromeProcess.once('error', error => { stderr += `\nChrome launch failed: ${error.message}`; });

  phase = 'connecting-cdp';
  const version = await waitForCdp();
  browserVersion = version.Browser || null;
  const pages = await cdpFetch('/json/list');
  const page = pages.find(entry => entry.type === 'page' && entry.url.includes('motion-ready-719024-stencil'))
    || pages.find(entry => entry.type === 'page') || pages[0];
  if (!page?.webSocketDebuggerUrl) throw new Error('No debuggable stencil page found');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await requestCdp(ws, 'Page.enable');
  await requestCdp(ws, 'Runtime.enable');
  await requestCdp(ws, 'Page.bringToFront').catch(() => null);

  phase = 'loading-blank-rest-space-workbench';
  const blank = await waitForState(debug => debug.loaded && debug.ok, 'blank rest-space workbench');
  effectiveUrl = await evaluate('location.href');
  assert.equal(blank.effective.castHash, '8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e');
  assert.equal(blank.effective.registrationHash, 'cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6');
  assert.equal(blank.requested.requestedStencilSource, null);
  assert.equal(blank.effective.effectiveStencilSource, 'blank operator draft');
  assert.equal(blank.effective.regionCount, 0, 'fresh workbench silently loaded stale/default semantics');
  assert.deepEqual(blank.consoleFailures, []);

  phase = 'authoring-synthetic-oracle-stencil';
  await authorRegion('body-axis', 'Head to tail', [[0, 0, -0.47], [0, 0, 0.47]], [0.12, 0.12, 0.12]);
  await authorRegion('appendage-chain', 'Front left limb', [[0.14, -0.02, -0.22], [0.17, -0.13, -0.25], [0.16, -0.2, -0.27]], [0.07, 0.07, 0.07]);
  await authorRegion('contact-patch', 'Front left contact', [[0.16, -0.2, -0.27]], [0.06, 0.06, 0.06]);
  await authorRegion('preservation-region', 'Trunk volume', [[0, 0, 0.05]], [0.17, 0.18, 0.34]);
  const authored = await waitForState(debug => debug.effective.regionCount === 4, 'four-kind authored stencil');
  assert.deepEqual([...authored.effective.regionKinds].sort(), [
    'appendage-chain', 'body-axis', 'contact-patch', 'preservation-region',
  ]);
  assert.equal(authored.effective.stencilAuthority, 'operator-authored-rest-space-semantics');
  assert.equal(authored.effective.derivedBinding.schema, 'kaminos.oracle-mechanical-stencil-binding.v0');
  assert.equal(authored.effective.derivedBinding.stencilHash, authored.effective.stencilHash);
  assert.ok(authored.effective.derivedBinding.regions.every(region => region.vertexCount > 0), 'an authored region bound to no exact-cast vertices');

  phase = 'save-clear-reload-round-trip';
  const authoredHash = authored.effective.stencilHash;
  await evaluate(`document.getElementById('save-stencil').click()`);
  await waitForState(debug => debug.effective.effectiveStencilSource === 'local saved draft', 'saved semantic draft');
  const storageSnapshot = await evaluate(`localStorage.getItem(${JSON.stringify(`kaminos:oracle-stencil:8fed20d958ef48797c14ad1d3846a50eae05d43e6ae67f8805060b02f1abde8e:cb519913ad863441e88555b3d9fbd588ffef03650475de07c29ee1c71f500ff6`)})`);
  assert.ok(storageSnapshot?.includes('operator-authored-rest-space-semantics'), 'save path did not persist semantic authority');
  await evaluate(`document.getElementById('clear-stencil').click()`);
  await waitForState(debug => debug.effective.regionCount === 0, 'cleared semantic draft');
  await evaluate(`document.getElementById('load-stencil').click()`);
  const reloaded = await waitForState(debug => debug.effective.regionCount === 4, 'reloaded semantic draft');
  assert.equal(reloaded.effective.stencilHash, authoredHash, 'save/reload changed semantic stencil identity');
  assert.equal(reloaded.effective.effectiveStencilSource, 'local saved draft');
  assert.deepEqual(reloaded.consoleFailures, []);

  phase = 'capturing-operator-viewport';
  const screenshot = await requestCdp(ws, 'Page.captureScreenshot', { format: 'png', fromSurface: true });
  const png = Buffer.from(screenshot.data, 'base64');
  assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG', 'captured output is not a PNG');
  assert.ok(png.length > 20_000, 'captured output is suspiciously blank or partial');
  writeFileSync(screenshotPath, png);

  phase = 'writing-report';
  writeReport({
    ok: true,
    effectiveStencilSource: reloaded.effective.effectiveStencilSource,
    stencilHash: reloaded.effective.stencilHash,
    regionCount: reloaded.effective.regionCount,
    regionKinds: reloaded.effective.regionKinds,
    derivedBinding: reloaded.effective.derivedBinding,
    stencilDocument: await evaluate('window.kaminosOracleStencilDocument()'),
    screenshot: { path: screenshotPath, bytes: png.length, width: windowWidth, height: windowHeight },
    finalDebugState: reloaded,
  });
  await closeCdpBrowser(ws, chromeProcess, delay);
  console.log(JSON.stringify({ ok: true, reportPath, screenshotPath, stencilHash: reloaded.effective.stencilHash }));
} catch (error) {
  writeReport({ ok: false, error: String(error.stack || error) });
  if (ws) await closeCdpBrowser(ws, chromeProcess, delay).catch(() => null);
  else if (chromeProcess?.exitCode == null && chromeProcess?.signalCode == null) chromeProcess.kill('SIGTERM');
  console.error(error.stack || error);
  process.exitCode = 1;
}
