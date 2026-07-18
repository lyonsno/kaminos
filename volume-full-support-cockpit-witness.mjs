#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.pyro.full-support-cockpit-witness.v0';
const SOURCES = Object.freeze(['analytical-exact', 'learned-baseline', 'learned-flow']);
const EXPECTED_ROW_COUNT = 1_899_742;
const EXPECTED_SIM_STEP = 120;

class CdpSocket {
  constructor(url, timeoutMs) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('close', () => this.rejectPending(new Error('CDP socket closed')));
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) {
            this.browserEvents.push(message);
          }
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
      });
    });
  }

  call(method, params = {}) {
    return new Promise((resolveCall, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.socket?.close();
  }
}

const args = parseArgs(process.argv.slice(2));
const routeReceiptPath = requiredPath('--route-receipt');
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-full-support-cockpit-witness/report.json'));
const screenshotPath = resolve(String(args.get('--screenshot') || '/tmp/kaminos-full-support-cockpit-witness/cockpit.png'));
const timeoutMs = Number(args.get('--timeout-ms') || 900_000);
const viewportWidth = Number(args.get('--viewport-width') || 1800);
const viewportHeight = Number(args.get('--viewport-height') || 1000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const routeReceipt = readJson(routeReceiptPath);
const witnessStartedAt = performance.now();

let browser = null;
let socket = null;
let failurePhase = 'route-receipt-validation';
let lastTrustworthyEvidence = { schema: SCHEMA, routeReceiptPath };
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(screenshotPath), { recursive: true });

try {
  assert.equal(routeReceipt.schema, 'kaminos.pyro.full-support-cockpit-session.v0', 'route receipt schema was substituted');
  assert.equal(routeReceipt.status, 'serving', 'route receipt is not serving');
  assert.ok(routeReceipt.requestedRoute, 'route receipt omitted requested route');
  assert.ok(routeReceipt.effectiveRoute, 'route receipt omitted effective route');
  const expectedUrl = new URL(routeReceipt.effectiveRoute).href;
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    mounts: routeReceipt.mounts,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/kaminos-full-support-cockpit-witness-${process.pid}-${Date.now()}`,
    `--window-size=${viewportWidth},${viewportHeight}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: expectedUrl });

  failurePhase = 'effective-route-admission';
  const admittedRoute = await waitForValue(socket, timeoutMs, `(() => {
    if (document.readyState !== 'complete') return null;
    return { href: location.href, hasBasin: Boolean(document.querySelector('#basin')) };
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admittedRoute };
  assertRouteContract(expectedUrl, admittedRoute.href);
  assert.equal(admittedRoute.hasBasin, true, 'effective route did not mount the volume viewer');

  failurePhase = 'checksum-state-bootstrap';
  const bootstrap = await waitForValue(socket, timeoutMs, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const receipt = runtime.__kaminosFullSupportStageABootstrapReceipt;
    if (!receipt || receipt.status === 'loading') return null;
    return receipt;
  })()`);
  assert.equal(bootstrap.status, 'effective', `bootstrap failed: ${JSON.stringify(bootstrap)}`);
  assert.equal(bootstrap.presentedState?.simStepCount, EXPECTED_SIM_STEP, 'bootstrap drifted from state 120');
  assert.equal(bootstrap.presentedState?.lookFreeze, 1, 'bootstrap did not pin the imported state');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, bootstrap };

  const sourceReceipts = [];
  for (const source of SOURCES) {
    failurePhase = `source-switch:${source}`;
    const receipt = await evaluate(socket, `(async () => {
      const runtime = document.querySelector('#basin')?.contentWindow || window;
      const select = runtime.document.getElementById('volume-full-support-source');
      if (!select) throw new Error('full-support-source-selector-missing');
      if (typeof runtime.__kaminosApplyFullSupportSource !== 'function') throw new Error('full-support-source-api-missing');
      select.value = ${JSON.stringify(source)};
      const sourceReceipt = await runtime.__kaminosApplyFullSupportSource();
      const state = runtime.__kaminosVolumePrototype?.debugState?.();
      return {
        requestedSource: ${JSON.stringify(source)},
        sourceReceipt,
        state: {
          active: state?.active,
          backend: state?.backend,
          effectiveRoute: state?.effectiveRoute,
          simStepCount: state?.simStepCount,
          lookFreeze: state?.lookFreeze,
        },
      };
    })()`);
    assert.equal(receipt.sourceReceipt?.status, 'effective', `${source} did not become effective`);
    assert.equal(receipt.sourceReceipt?.effectiveSource, source, `${source} was silently substituted`);
    assert.equal(receipt.sourceReceipt?.rowCount, EXPECTED_ROW_COUNT, `${source} was partially populated`);
    assert.equal(receipt.sourceReceipt?.overflowCount, 0, `${source} overflowed the live population`);
    assert.equal(receipt.sourceReceipt?.fallbackUsed, false, `${source} used fallback while looking authoritative`);
    assert.equal(receipt.state?.simStepCount, EXPECTED_SIM_STEP, `${source} changed the frozen simulation state`);
    assert.equal(receipt.state?.lookFreeze, 1, `${source} released the frozen simulation state`);
    sourceReceipts.push(receipt);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, sourceReceipts: [...sourceReceipts] };
  }

  failurePhase = 'operator-frame-capture';
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  });
  assert.ok(screenshot?.data, 'operator frame capture was blank');
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'));

  failurePhase = 'browser-event-audit';
  const browserEventAudit = auditBrowserEvents(socket.browserEvents);

  const report = {
    schema: SCHEMA,
    status: 'passed',
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    bootstrap,
    sourceReceipts,
    screenshotPath,
    elapsedMs: performance.now() - witnessStartedAt,
    browserEventAudit,
    browserEvents: socket.browserEvents,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence,
    screenshotPath: null,
    browserEvents: socket?.browserEvents || [],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) continue;
    parsed.set(token, tokens[index + 1]);
    index += 1;
  }
  return parsed;
}

function requiredPath(flag) {
  const value = args.get(flag);
  if (!value) throw new Error(`${flag} is required`);
  return resolve(String(value));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function chromeExecutable() {
  return process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

function auditBrowserEvents(events) {
  const failures = events.filter(event => (
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error')
  ));
  if (failures.length) {
    throw new Error(`browser-event-audit-failed:${JSON.stringify(failures)}`);
  }
  return {
    status: 'clean',
    observedEventCount: events.length,
    rejectedEventCount: 0,
  };
}

function assertRouteContract(expectedHref, admittedHref) {
  const expected = new URL(expectedHref);
  const admitted = new URL(admittedHref);
  assert.equal(admitted.origin, expected.origin, 'browser route origin was substituted');
  assert.equal(admitted.pathname, expected.pathname, 'browser route path was substituted');
  const criticalRouteParameters = [
    'composition',
    'volume_presentation',
    'volume_raymarch_smoke',
    'full_support_source',
    'full_support_source_field_manifest',
    'full_support_source_fluid',
    'full_support_source_front',
    'full_support_exact_manifest',
    'full_support_baseline_manifest',
    'full_support_flow_manifest',
  ];
  for (const parameter of criticalRouteParameters) {
    assert.equal(
      admitted.searchParams.get(parameter),
      expected.searchParams.get(parameter),
      `browser route substituted ${parameter}`,
    );
  }
}

async function waitForTarget(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error;
    }
    await delay(100);
  }
  throw new Error(`Chrome CDP target did not appear: ${lastError?.message || 'timeout'}`);
}

async function waitForValue(cdp, timeoutMs, expression) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(cdp, expression);
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`browser value did not become available: ${lastError?.message || 'timeout'}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
