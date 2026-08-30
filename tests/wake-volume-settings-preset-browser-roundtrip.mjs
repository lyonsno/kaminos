#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  loadWakeFirePreset,
  wakeFirePresetControlEntries,
} from '../wake-volume-settings-preset-mount.mjs';
import {
  headlessBrowserRequest,
  resolveHeadlessBrowser,
} from '../lib/headless-browser-resolver.mjs';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const value = process.argv[index + 1];
  if (value && !value.startsWith('--')) {
    args.set(key, value);
    index += 1;
  } else {
    args.set(key, '1');
  }
}

const stableHandle = args.get('--preset') || 'flamebowl-blockout-130r';
const reportPath = resolve(args.get('--report') || 'artifacts/wake-fire-preset-browser-roundtrip/report.json');
const screenshotPath = resolve(args.get('--screenshot') || 'artifacts/wake-fire-preset-browser-roundtrip/wake-mounted.png');
const startedAt = new Date().toISOString();
const startedAtMs = Date.now();
const runtimeExceptions = [];
const consoleEvents = [];
let phase = 'starting';
let lastTrustworthyEvidence = null;
let baseUrl = null;
let route = null;
let callerDeadlineMs = null;
let repoRoot = null;
let requestedSource = null;
let effectiveSource = null;
let browserRequest = null;
let browserResolution = null;
let debugPort = null;
let userDataDir = null;
let browser = null;
let socket = null;
let screenshotWritten = false;

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function remainingMs() {
  return Number.isFinite(callerDeadlineMs)
    ? callerDeadlineMs - (Date.now() - startedAtMs)
    : 0;
}

function writeReport(payload = {}) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify({
    identity: 'kaminos.wake-fire-preset-browser-roundtrip.v1',
    status: payload.status || 'failed',
    requested: {
      route: route?.toString() || args.get('--base-url') || null,
      stableHandle,
      callerDeadlineMs,
      repoRoot: repoRoot || args.get('--repo-root') || null,
      source: requestedSource,
      browser: browserResolution || browserRequest,
    },
    startedAt,
    completedAt: new Date().toISOString(),
    failurePhase: payload.status === 'passed' ? null : phase,
    screenshot: screenshotWritten ? screenshotPath : null,
    runtimeExceptions,
    consoleEvents,
    lastTrustworthyEvidence,
    ...payload,
  }, null, 2)}\n`);
}

function gitSourceIdentity(root) {
  const git = (...gitArgs) => execFileSync('git', ['-C', root, ...gitArgs], { encoding: 'utf8' }).trim();
  return {
    schema: 'kaminos.runtime-source.v1',
    repoRoot: realpathSync(root),
    revision: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    branch: git('branch', '--show-current') || null,
    dirty: Boolean(git('status', '--porcelain', '--untracked-files=normal')),
  };
}

function assertEffectiveSourceIdentity(requested, effective) {
  assert.equal(effective?.schema, 'kaminos.runtime-source.v1', 'server omitted its runtime source schema');
  assert.equal(effective?.status, 'resolved', 'server runtime source identity is unresolved');
  assert.equal(realpathSync(effective.repoRoot), requested.repoRoot, 'server repo root differs from the caller-selected checkout');
  assert.equal(effective.revision, requested.revision, 'server revision differs from the caller-selected checkout');
  assert.equal(effective.tree, requested.tree, 'server tree differs from the caller-selected checkout');
  assert.equal(effective.branch, requested.branch, 'server branch differs from the caller-selected checkout');
  assert.equal(requested.dirty, false, 'caller-selected checkout is dirty');
  assert.equal(effective.dirty, false, 'server reports a dirty serving checkout');
  assert.ok(Number.isInteger(effective.processId) && effective.processId > 0, 'server omitted its process identity');
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  while (remainingMs() > 0) {
    try {
      return await cdpFetch('/json/version');
    } catch {
      await delay(100);
    }
  }
  throw new Error('Caller deadline elapsed before Chrome exposed CDP');
}

async function waitForPage() {
  while (remainingMs() > 0) {
    const targets = await cdpFetch('/json/list');
    const page = targets.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) return page;
    await delay(100);
  }
  throw new Error('Caller deadline elapsed before Chrome exposed a page target');
}

function waitForSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket open failed')), { once: true });
  });
}

function createCdpClient(ws) {
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception');
    }
    if (message.method === 'Runtime.consoleAPICalled') {
      consoleEvents.push({
        source: 'console',
        level: message.params.type,
        text: (message.params.args || []).map(argument => argument.value ?? argument.description ?? '').join(' '),
      });
    }
    if (message.method === 'Log.entryAdded') {
      consoleEvents.push({
        source: message.params.entry?.source || 'log',
        level: message.params.entry?.level || 'unknown',
        text: message.params.entry?.text || '',
      });
    }
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
    else request.resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolveRequest, rejectRequest) => {
    if (remainingMs() <= 0) {
      rejectRequest(new Error(`Caller deadline elapsed before ${method}`));
      return;
    }
    const id = nextId++;
    pending.set(id, { method, resolve: resolveRequest, reject: rejectRequest });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result.value;
}

async function main() {
  phase = 'preflight';
  baseUrl = new URL(args.get('--base-url') || 'http://127.0.0.1:8090/');
  route = new URL(baseUrl);
  route.searchParams.set('kaminos_volume_smoke', '1');
  route.searchParams.set('crucible_workspace', 'operational');
  route.searchParams.set('wake_fire_preset', stableHandle);
  callerDeadlineMs = Number(args.get('--deadline-ms'));
  assert.ok(Number.isFinite(callerDeadlineMs) && callerDeadlineMs > 0, '--deadline-ms must name the caller-owned witness deadline');
  repoRoot = resolve(args.get('--repo-root') || '');
  assert.ok(args.get('--repo-root'), '--repo-root must name the caller-selected serving checkout');
  requestedSource = gitSourceIdentity(repoRoot);
  browserRequest = headlessBrowserRequest({
    cliExecutable: args.get('--chrome'),
    envExecutable: process.env.KAMINOS_CHROME,
  });
  browserResolution = resolveHeadlessBrowser({
    cliExecutable: browserRequest.source === 'cli' ? browserRequest.executable : null,
    envExecutable: browserRequest.source === 'environment' ? browserRequest.executable : null,
  });
  debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
  userDataDir = resolve(args.get('--user-data-dir') || `/tmp/kaminos-wake-fire-preset-browser-${debugPort}-${process.pid}`);

  const fetchImpl = (input, init) => fetch(new URL(input, baseUrl), init);
  const sourceReceipt = await loadWakeFirePreset(stableHandle, { fetchImpl });
  const entries = wakeFirePresetControlEntries(sourceReceipt);
  phase = 'bind-serving-source';
  const runtimeConfigResponse = await fetchImpl('/api/runtime-config', { cache: 'no-store' });
  assert.equal(runtimeConfigResponse.ok, true, `runtime source lookup failed: ${runtimeConfigResponse.status}`);
  const runtimeConfig = await runtimeConfigResponse.json();
  effectiveSource = runtimeConfig.source;
  assertEffectiveSourceIdentity(requestedSource, effectiveSource);
  lastTrustworthyEvidence = {
    phase: 'source-bound',
    presetId: sourceReceipt.presetId,
    contentHash: sourceReceipt.contentHash,
    sourceControlCount: entries.length,
    source: effectiveSource,
  };

  phase = 'launch-browser';
  browser = spawn(browserResolution.effective.executable, [
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1440,1100',
    route.toString(),
  ], { stdio: 'ignore' });
  await waitForCdp();
  const page = await waitForPage();
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await waitForSocketOpen(socket);
  const cdp = createCdpClient(socket);
  await cdp('Runtime.enable');
  await cdp('Log.enable');
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: route.toString() });
  await cdp('Page.bringToFront');

  phase = 'await-mounted-renderer';
  let observed = null;
  while (remainingMs() > 0) {
    observed = await evaluate(cdp, `(() => ({
      mountStatus: document.getElementById('crucible-viewport-fire-preset')?.dataset?.status || null,
      mountText: document.getElementById('crucible-viewport-fire-preset')?.textContent || null,
      mountVisibility: (() => {
        const element = document.getElementById('crucible-viewport-fire-preset');
        const clippingZone = element?.closest('.crucible-viewport-zone');
        if (!element || !clippingZone) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        const textBounds = range.getBoundingClientRect();
        const zoneBounds = clippingZone.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          overflowWrap: style.overflowWrap,
          textBounds: { left: textBounds.left, top: textBounds.top, right: textBounds.right, bottom: textBounds.bottom },
          zoneBounds: { left: zoneBounds.left, top: zoneBounds.top, right: zoneBounds.right, bottom: zoneBounds.bottom },
          fullyVisible: textBounds.width > 0
            && textBounds.height > 0
            && textBounds.left >= zoneBounds.left - 1
            && textBounds.right <= zoneBounds.right + 1
            && textBounds.top >= zoneBounds.top - 1
            && textBounds.bottom <= zoneBounds.bottom + 1
            && textBounds.left >= -1
            && textBounds.right <= innerWidth + 1
            && textBounds.top >= -1
            && textBounds.bottom <= innerHeight + 1,
        };
      })(),
      activeTab: document.querySelector('.tab.active')?.dataset?.tab || null,
      operationalWorkspaceVisible: document.getElementById('crucible-viewport-workspace')?.hidden === false,
      receipt: window.__kaminosWakeFirePresetMountReceipt || null,
      renderer: window.__kaminosVolumePrototype?.debugState?.() || null,
      controls: Object.fromEntries(${JSON.stringify(entries.map(entry => entry.id))}.map(id => {
        const element = document.getElementById(id);
        return [id, element?.type === 'checkbox' ? Boolean(element.checked) : element?.value ?? null];
      })),
    }))()`);
    lastTrustworthyEvidence = observed;
    if (observed?.mountStatus === 'failed') throw new Error(observed.mountText || 'Wake fire preset mount failed');
    if (observed?.receipt && observed?.renderer?.active === true && Number(observed.renderer.frameCount) >= 5) break;
    await delay(200);
  }
  if (!observed?.receipt) throw new Error('Caller deadline elapsed before the Wake mount receipt became visible');
  assert.equal(observed.renderer?.prototypeIdentity, 'kaminos-volume-prototype-v0');
  assert.equal(observed.renderer?.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(observed.renderer?.boundarySplatMode, 'off');
  assert.equal(observed.receipt?.effective?.presetId, sourceReceipt.presetId);
  assert.equal(observed.activeTab, 'generate', 'Wake route did not open the operational Generate surface');
  assert.equal(observed.operationalWorkspaceVisible, true, 'Wake operational Crucible is hidden');
  assert.match(observed.mountText || '', new RegExp(sourceReceipt.presetId), 'visible product identity omitted the exact revision');
  assert.equal(observed.mountVisibility?.overflowWrap, 'anywhere', 'immutable revision is not configured to wrap');
  assert.equal(observed.mountVisibility?.fullyVisible, true, 'immutable revision is clipped on the operational product surface');
  assert.equal(runtimeExceptions.length, 0, `Browser runtime exceptions: ${runtimeExceptions.join(' | ')}`);

  phase = 'capture';
  const screenshot = await cdp('Page.captureScreenshot', { format: 'png', fromSurface: true });
  mkdirSync(dirname(screenshotPath), { recursive: true });
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  screenshotWritten = true;
  phase = 'complete';
  writeReport({
    status: 'passed',
    effective: {
      presetId: sourceReceipt.presetId,
      contentHash: sourceReceipt.contentHash,
      source: effectiveSource,
      mountReceipt: observed.receipt,
      renderer: observed.renderer,
      controls: observed.controls,
      visibility: {
        activeTab: observed.activeTab,
        operationalWorkspaceVisible: observed.operationalWorkspaceVisible,
        mountText: observed.mountText,
        mountVisibility: observed.mountVisibility,
      },
    },
  });
}

main().catch(error => {
  writeReport({ status: 'failed', error: error?.message || String(error) });
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
}).finally(async () => {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolveExit => browser.once('exit', resolveExit));
    browser.kill();
    await exited;
  }
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});
