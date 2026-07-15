#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE } from './structural-material-3d-webgpu-core.js';

const SCHEMA = 'kaminos.structural-material.webgpu-browser-witness.v0';

function usage() {
  return [
    'Usage: node structural-material-3d-webgpu-witness.mjs',
    '  --url <served structural-material-3d.html URL>',
    '  --out <report.json>',
    '  --screenshot <capture.png>',
    '  [--debug-port 9223] [--width 1280] [--height 820]',
    '  [--device-scale-factor 1] [--load-timeout-ms 30000]',
  ].join('\n');
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--help' || token === '-h') return { help: true };
    if (!token.startsWith('--')) throw new Error(`unexpected argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`missing value for ${token}`);
    values.set(token.slice(2), value);
    index += 1;
  }
  for (const required of ['url', 'out', 'screenshot']) {
    if (!values.has(required)) throw new Error(`missing required --${required}`);
  }
  const number = (name, fallback) => {
    const value = Number(values.get(name) ?? fallback);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`);
    return value;
  };
  return {
    help: false,
    url: values.get('url'),
    out: resolve(values.get('out')),
    screenshot: resolve(values.get('screenshot')),
    debugPort: number('debug-port', 9223),
    width: number('width', 1280),
    height: number('height', 820),
    deviceScaleFactor: number('device-scale-factor', 1),
    loadTimeoutMs: number('load-timeout-ms', 30000),
  };
}

async function connectCdp(debugPort) {
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
  const page = targets.find(target => target.type === 'page');
  if (!page?.webSocketDebuggerUrl) throw new Error(`no page target on CDP port ${debugPort}`);
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', rejectOpen, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const handlers = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handlers.reject(new Error(JSON.stringify(message.error)));
      else handlers.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') {
      runtimeErrors.push(message.params.exceptionDetails.text);
    }
  });

  const send = (method, params = {}) => {
    const id = nextId;
    nextId += 1;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend }));
  };
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  return { socket, send, evaluate, runtimeErrors };
}

function assertCheck(condition, message) {
  if (!condition) throw new Error(message);
}

let config;
try {
  config = parseArgs(process.argv.slice(2));
} catch (error) {
  console.error(`${error.message}\n\n${usage()}`);
  process.exit(2);
}
if (config.help) {
  console.log(usage());
  process.exit(0);
}

const report = {
  schema: SCHEMA,
  status: 'failed',
  failurePhase: 'configuration',
  requestedPageRoute: STRUCTURAL_MATERIAL_3D_ROUTE,
  effectivePageRoute: null,
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE,
  effectiveRoute: null,
  requestedBackend: 'webgpu',
  effectiveBackend: null,
  cpuFallbackUsed: null,
  requestedConfig: {
    url: config.url,
    debugPort: config.debugPort,
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.deviceScaleFactor,
    loadTimeoutMs: config.loadTimeoutMs,
    reportPath: config.out,
    screenshotPath: config.screenshot,
  },
  effectiveConfig: null,
  adapter: null,
  abi: null,
  dispatch: null,
  timingsMs: null,
  parity: null,
  checks: {},
  pixelProbe: null,
  runtimeErrors: [],
  lastTrustworthyEvidence: null,
  error: null,
};

let cdp;
try {
  report.failurePhase = 'cdp-connect';
  cdp = await connectCdp(config.debugPort);
  const { send, evaluate } = cdp;
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: config.width,
    height: config.height,
    deviceScaleFactor: config.deviceScaleFactor,
    mobile: false,
  });
  report.effectiveConfig = {
    url: config.url,
    debugPort: config.debugPort,
    loadTimeoutMs: config.loadTimeoutMs,
    viewport: {
      width: config.width,
      height: config.height,
      deviceScaleFactor: config.deviceScaleFactor,
    },
    reportPath: config.out,
    screenshotPath: config.screenshot,
    browserTarget: 'first-page-target',
  };

  report.failurePhase = 'page-load';
  await send('Page.navigate', { url: config.url });
  const loadDeadline = Date.now() + config.loadTimeoutMs;
  while (Date.now() < loadDeadline) {
    if (await evaluate("typeof window.__structuralMaterial3dRunGpuParity === 'function'")) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assertCheck(
    await evaluate("typeof window.__structuralMaterial3dRunGpuParity === 'function'"),
    `GPU parity route did not load within ${config.loadTimeoutMs} ms`,
  );
  const pageWitness = await evaluate('window.__structuralMaterial3dWitness()');
  report.effectivePageRoute = pageWitness.effectiveRoute;
  report.checks.pageRouteIdentity = pageWitness.effectiveRoute === STRUCTURAL_MATERIAL_3D_ROUTE;
  assertCheck(report.checks.pageRouteIdentity, `effective page route mismatch: ${pageWitness.effectiveRoute}`);
  report.lastTrustworthyEvidence = {
    phase: 'page-load',
    effectivePageRoute: report.effectivePageRoute,
    visualConsumerAuthority: pageWitness.visualConsumerAuthority,
  };

  report.failurePhase = 'gpu-parity-execution';
  const parityReceipt = await evaluate('window.__structuralMaterial3dRunGpuParity()', true);
  report.effectiveRoute = parityReceipt.effectiveRoute;
  report.effectiveBackend = parityReceipt.effectiveBackend;
  report.cpuFallbackUsed = parityReceipt.cpuFallbackUsed;
  report.adapter = parityReceipt.adapter;
  report.abi = parityReceipt.abi;
  report.dispatch = parityReceipt.dispatch;
  report.timingsMs = parityReceipt.timingsMs;
  report.parity = parityReceipt.parity;
  report.checks.gpuStatusPassed = parityReceipt.status === 'passed';
  report.checks.routeIdentity = parityReceipt.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE;
  report.checks.backendIdentity = parityReceipt.effectiveBackend === 'webgpu';
  report.checks.noCpuFallback = parityReceipt.cpuFallbackUsed === false;
  report.checks.parityPassed = parityReceipt.parity?.ok === true;
  report.checks.responseIdentityMatches = parityReceipt.parity?.responseIdentityMatches === true;
  report.checks.breakSetMatches = parityReceipt.parity?.breakSetMatches === true;
  report.checks.eventSetMatches = parityReceipt.parity?.eventSetMatches === true;
  report.checks.eventPayloadMatches = parityReceipt.parity?.eventPayloadMatches === true;
  report.checks.livenessMatches = parityReceipt.parity?.livenessMatches === true;
  report.checks.noEventOverflow = parityReceipt.parity?.eventOverflowCount === 0;
  assertCheck(report.checks.gpuStatusPassed, `GPU parity execution failed in ${parityReceipt.failurePhase}: ${parityReceipt.error?.message || 'unknown error'}`);
  assertCheck(report.checks.routeIdentity, `effective GPU route mismatch: ${parityReceipt.effectiveRoute}`);
  assertCheck(report.checks.backendIdentity, `effective backend mismatch: ${parityReceipt.effectiveBackend}`);
  assertCheck(report.checks.noCpuFallback, 'GPU parity route used a CPU fallback');
  assertCheck(report.checks.parityPassed, 'GPU result did not satisfy CPU parity');
  assertCheck(report.checks.responseIdentityMatches, 'GPU response identities differ from CPU oracle');
  assertCheck(report.checks.breakSetMatches, 'GPU fracture set differs from CPU oracle');
  assertCheck(report.checks.eventSetMatches, 'GPU crack-event set differs from CPU oracle');
  assertCheck(report.checks.eventPayloadMatches, 'GPU crack-event payload differs from CPU oracle');
  assertCheck(report.checks.livenessMatches, 'GPU liveness decisions differ from CPU oracle');
  assertCheck(report.checks.noEventOverflow, 'GPU crack-event append buffer overflowed');
  report.lastTrustworthyEvidence = {
    phase: 'gpu-parity-execution',
    effectiveRoute: report.effectiveRoute,
    effectiveBackend: report.effectiveBackend,
    parity: report.parity,
  };

  report.failurePhase = 'visual-evidence';
  report.pixelProbe = await evaluate('window.__structuralMaterial3dPixelProbe()', true);
  assertCheck(report.pixelProbe?.ok && report.pixelProbe.nonDarkPixels > 0, 'visual pixel probe is blank');
  const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(dirname(config.screenshot), { recursive: true });
  writeFileSync(config.screenshot, Buffer.from(capture.data, 'base64'));
  report.checks.screenshotWritten = true;
  report.checks.routeStatusVisible = await evaluate(`(() => {
    const status = document.querySelector('#gpu-status');
    return status?.textContent.includes('GPU passed 58/58') && status?.title === ${JSON.stringify(STRUCTURAL_MATERIAL_3D_WEBGPU_ROUTE)};
  })()`);
  assertCheck(report.checks.routeStatusVisible, 'operator-visible GPU parity status is missing or lacks effective-route identity');

  report.runtimeErrors = cdp.runtimeErrors.slice();
  report.checks.noRuntimeErrors = report.runtimeErrors.length === 0;
  assertCheck(report.checks.noRuntimeErrors, `browser emitted runtime errors: ${report.runtimeErrors.join('; ')}`);
  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = {
    phase: 'visual-evidence',
    effectiveRoute: report.effectiveRoute,
    pixelProbe: report.pixelProbe,
    screenshotPath: config.screenshot,
  };
} catch (error) {
  report.error = { name: error.name, message: error.message, stack: error.stack };
  if (cdp) report.runtimeErrors = cdp.runtimeErrors.slice();
  process.exitCode = 1;
} finally {
  cdp?.socket.close();
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
