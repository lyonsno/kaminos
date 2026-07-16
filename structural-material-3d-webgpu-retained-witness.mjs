#!/usr/bin/env node

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { STRUCTURAL_MATERIAL_3D_ROUTE } from './structural-material-3d-core.js';
import { STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE } from './structural-material-3d-webgpu-retained.js';

const SCHEMA = 'kaminos.structural-material.webgpu-retained-browser-witness.v0';
const BODY_MARKER = 'Kaminos Layered Structural Sidecar';

function usage() {
  return [
    'Usage: node structural-material-3d-webgpu-retained-witness.mjs',
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
  requestedRoute: STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE,
  effectiveRoute: null,
  requestedBackend: 'webgpu',
  effectiveBackend: null,
  cpuFallbackUsed: null,
  requestedSequenceIdentity: null,
  effectiveSequenceIdentity: null,
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
  browserVersion: null,
  adapter: null,
  abi: null,
  lifecycle: null,
  dispatch: null,
  timingsMs: null,
  cpuOracle: null,
  gpuResult: null,
  parity: null,
  resultFingerprint: null,
  deterministicRerunFingerprint: null,
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
  report.browserVersion = await send('Browser.getVersion');
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
    if (await evaluate("typeof window.__structuralMaterial3dRunGpuRetainedParity === 'function'")) break;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  assertCheck(
    await evaluate("typeof window.__structuralMaterial3dRunGpuRetainedParity === 'function'"),
    `retained GPU route did not load within ${config.loadTimeoutMs} ms`,
  );
  report.checks.bodyIdentity = await evaluate(`document.title === ${JSON.stringify(BODY_MARKER)}`);
  assertCheck(report.checks.bodyIdentity, `effective body identity mismatch: ${await evaluate('document.title')}`);
  const pageWitness = await evaluate('window.__structuralMaterial3dWitness()');
  report.effectivePageRoute = pageWitness.effectiveRoute;
  report.checks.pageRouteIdentity = pageWitness.effectiveRoute === STRUCTURAL_MATERIAL_3D_ROUTE;
  assertCheck(report.checks.pageRouteIdentity, `effective page route mismatch: ${pageWitness.effectiveRoute}`);
  report.lastTrustworthyEvidence = {
    phase: 'page-load',
    bodyIdentity: BODY_MARKER,
    effectivePageRoute: report.effectivePageRoute,
    visualConsumerAuthority: pageWitness.visualConsumerAuthority,
  };

  report.failurePhase = 'retained-gpu-execution';
  const receipt = await evaluate('window.__structuralMaterial3dRunGpuRetainedParity()', true);
  report.effectiveRoute = receipt.effectiveRoute;
  report.effectiveBackend = receipt.effectiveBackend;
  report.cpuFallbackUsed = receipt.cpuFallbackUsed;
  report.requestedSequenceIdentity = receipt.requestedSequenceIdentity;
  report.effectiveSequenceIdentity = receipt.effectiveSequenceIdentity;
  report.adapter = receipt.adapter;
  report.abi = receipt.abi;
  report.lifecycle = receipt.lifecycle;
  report.dispatch = receipt.dispatch;
  report.timingsMs = receipt.timingsMs;
  report.cpuOracle = receipt.cpuOracle;
  report.gpuResult = receipt.gpuResult;
  report.parity = receipt.parity;
  report.resultFingerprint = receipt.resultFingerprint;
  report.checks.gpuStatusPassed = receipt.status === 'passed';
  report.checks.routeIdentity = receipt.effectiveRoute === STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE;
  report.checks.backendIdentity = receipt.effectiveBackend === 'webgpu';
  report.checks.noCpuFallback = receipt.cpuFallbackUsed === false;
  report.checks.noFallbackAdapter = receipt.adapter?.isFallbackAdapter === false;
  report.checks.sequenceIdentity = receipt.requestedSequenceIdentity === receipt.effectiveSequenceIdentity;
  report.checks.lifecycleMatches = receipt.parity?.lifecycleMatches === true;
  report.checks.oneDevice = receipt.lifecycle?.deviceRequestCount === 1;
  report.checks.onePipeline = receipt.lifecycle?.pipelineCreateCount === 1;
  report.checks.dispatchCount = receipt.lifecycle?.dispatchCount === receipt.interactionCount;
  report.checks.noIntermediateReadback = receipt.lifecycle?.intermediateReadbackCount === 0;
  report.checks.oneValidationReadback = receipt.lifecycle?.validationReadbackCount === 1;
  report.checks.exactMappedReadbacks = receipt.lifecycle?.mappedBufferCount === 4;
  report.checks.cleanupMatches = receipt.lifecycle?.cleanupMatches === true &&
    receipt.parity?.cleanupMatches === true;
  report.checks.allBuffersDestroyed = receipt.lifecycle?.bufferAllocationCount === 10 &&
    receipt.lifecycle?.bufferDestroyCount === receipt.lifecycle.bufferAllocationCount &&
    receipt.lifecycle?.bufferDestroyErrorCount === 0;
  report.checks.deviceDestroyed = receipt.lifecycle?.deviceDestroyCount === 1 &&
    receipt.lifecycle?.deviceDestroyErrorCount === 0;
  report.checks.finalLivenessMatches = receipt.parity?.finalLivenessMatches === true;
  report.checks.responseIdentityMatches = receipt.parity?.responseIdentityMatches === true;
  report.checks.responseLivenessMatches = receipt.parity?.responseLivenessMatches === true;
  report.checks.eventSetMatches = receipt.parity?.eventSetMatches === true;
  report.checks.eventPayloadMatches = receipt.parity?.eventPayloadMatches === true;
  report.checks.eventEpochsMatch = receipt.parity?.eventEpochsMatch === true;
  report.checks.noDuplicateEvents = receipt.parity?.noDuplicateEvents === true;
  report.checks.eventCountMatches = receipt.parity?.eventCountMatches === true;
  report.checks.numericParity = receipt.parity?.numericParity === true;
  report.checks.noEventOverflow = receipt.parity?.eventOverflowCount === 0;
  for (const [name, passed] of Object.entries(report.checks)) {
    assertCheck(passed, `retained GPU check failed: ${name}; ${receipt.error?.message || 'no execution error'}`);
  }
  report.lastTrustworthyEvidence = {
    phase: 'retained-gpu-execution',
    effectiveRoute: report.effectiveRoute,
    effectiveBackend: report.effectiveBackend,
    effectiveSequenceIdentity: report.effectiveSequenceIdentity,
    lifecycle: report.lifecycle,
    parity: report.parity,
  };

  report.failurePhase = 'deterministic-rerun';
  const rerun = await evaluate('window.__structuralMaterial3dRunGpuRetainedParity()', true);
  report.deterministicRerunFingerprint = rerun.resultFingerprint;
  report.checks.deterministicRerun = rerun.status === 'passed' &&
    rerun.effectiveSequenceIdentity === report.effectiveSequenceIdentity &&
    rerun.resultFingerprint === report.resultFingerprint;
  assertCheck(report.checks.deterministicRerun, 'retained sequence rerun produced a different final structural fingerprint');

  report.failurePhase = 'visual-evidence';
  report.pixelProbe = await evaluate('window.__structuralMaterial3dPixelProbe()', true);
  assertCheck(report.pixelProbe?.ok && report.pixelProbe.nonDarkPixels > 0, 'visual pixel probe is blank');
  const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  mkdirSync(dirname(config.screenshot), { recursive: true });
  writeFileSync(config.screenshot, Buffer.from(capture.data, 'base64'));
  report.checks.screenshotWritten = true;
  report.checks.routeStatusVisible = await evaluate(`(() => {
    const status = document.querySelector('#gpu-status');
    return status?.textContent.includes('GPU retained passed') && status?.title === ${JSON.stringify(STRUCTURAL_MATERIAL_3D_WEBGPU_RETAINED_ROUTE)};
  })()`);
  assertCheck(report.checks.routeStatusVisible, 'operator-visible retained GPU status is missing or lacks effective-route identity');
  report.runtimeErrors = cdp.runtimeErrors.slice();
  report.checks.noRuntimeErrors = report.runtimeErrors.length === 0;
  assertCheck(report.checks.noRuntimeErrors, `browser emitted runtime errors: ${report.runtimeErrors.join('; ')}`);
  report.status = 'passed';
  report.failurePhase = null;
  report.lastTrustworthyEvidence = {
    phase: 'visual-evidence',
    effectiveRoute: report.effectiveRoute,
    effectiveSequenceIdentity: report.effectiveSequenceIdentity,
    resultFingerprint: report.resultFingerprint,
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
