#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.integration.four-arm-held-state-witness.v0';
const STATE_ID = 'coefficient-state-120';
const ARM_ID = 'sparse-positive-complement';
const ARTIFACT_SHA256 = 'bd398b808c7f796fb26f88817a1270b6aa594793377b0a76cfd06b593cfa031d';
const ROUTE_IDENTITY = 'native-3d-compute-fluid-raymarch-v0';
const ARTIFACT_URL = '/scratch/four-arm-held-state-18789/bailiff/hybrid-artifact.json';
const RESOURCE_ROOTS = Object.freeze({
  bailiff: '/scratch/four-arm-held-state-18789/bailiff/',
  cohort: '/scratch/four-arm-held-state-18789/cohort/',
  source: '/scratch/four-arm-held-state-18789/source/',
});
const COHORT_PATH = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-persistent-sparse-cohort-r1/';
const SOURCE_PATH = '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-exact-bilinear-motion-r4/artifacts/';

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
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-four-arm-held-state/report.json'));
const screenshotPath = resolve(String(args.get('--screenshot') || '/tmp/kaminos-four-arm-held-state/state-120-positive-complement.png'));
const timeoutMs = Number(args.get('--timeout-ms') || 900_000);
const viewportWidth = Number(args.get('--viewport-width') || 1200);
const viewportHeight = Number(args.get('--viewport-height') || 1000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const routeReceipt = readJson(routeReceiptPath);
const startedAt = performance.now();

let browser = null;
let socket = null;
let failurePhase = 'route-and-resource-admission';
let lastTrustworthyEvidence = { schema: SCHEMA, routeReceiptPath };
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(screenshotPath), { recursive: true });

try {
  assert.equal(routeReceipt.status, 'serving', 'source route receipt is not serving');
  const expectedUrl = new URL(routeReceipt.effectiveRoute);
  assert.equal(expectedUrl.origin, 'http://127.0.0.1:18789', 'effective server route was substituted');
  assert.equal(expectedUrl.searchParams.get('full_support_persistent_cohort_state'), STATE_ID, 'routed held state drifted');
  assert.equal(expectedUrl.searchParams.get('composition'), 'splat-only-v0', 'routed composition drifted');
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl.href,
    artifact: { url: ARTIFACT_URL, sha256: ARTIFACT_SHA256 },
    resourceRoots: RESOURCE_ROOTS,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/kaminos-four-arm-held-state-${process.pid}-${Date.now()}`,
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
  await socket.call('Page.navigate', { url: expectedUrl.href });

  failurePhase = 'effective-route-admission';
  const admitted = await waitForValue(socket, timeoutMs, `(() => document.readyState === 'complete'
    ? { href: location.href, hasBasin: Boolean(document.querySelector('#basin')) }
    : null)()`);
  assertRouteContract(expectedUrl.href, admitted.href);
  assert.equal(admitted.hasBasin, true, 'effective route omitted the volume viewer');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admitted };

  failurePhase = 'held-state-bootstrap';
  const bootstrap = await waitForValue(socket, timeoutMs, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const receipt = runtime.__kaminosPersistentSparseCohortReceipt;
    if (!receipt || receipt.status === 'idle' || receipt.status === 'loading') return null;
    return { receipt, state: runtime.__kaminosVolumePrototype?.debugState?.() };
  })()`);
  assert.equal(bootstrap.receipt.status, 'effective', `held-state bootstrap failed: ${JSON.stringify(bootstrap.receipt)}`);
  assert.equal(bootstrap.receipt.stateId, STATE_ID, 'bootstrap state was substituted');
  assert.equal(bootstrap.state?.simStepCount, 120, 'bootstrap did not hold exact step 120');
  assert.equal(bootstrap.receipt.fallbackUsed, false, 'bootstrap fallback looked authoritative');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, bootstrap };

  failurePhase = 'authenticated-four-arm-load-and-application';
  const application = await evaluate(socket, `(async () => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const prototype = runtime.__kaminosVolumePrototype;
    if (!prototype?.applyFourArmHeldStateApplication || !prototype?.sampleFourArmHeldStateLedger) {
      throw new Error('four-arm-runtime-api-missing');
    }
    prototype.setSelectiveHeadLiveCapturePaused?.(true);
    const api = await import('/volume-four-arm-held-state-runtime.mjs');
    const loadedArtifact = await api.loadFourArmHeldStateArtifact({
      artifactUrl: ${JSON.stringify(ARTIFACT_URL)},
      expectedSha256: ${JSON.stringify(ARTIFACT_SHA256)},
    });
    const artifact = loadedArtifact.artifact;
    const state = artifact.states.find(candidate => candidate.stateId === ${JSON.stringify(STATE_ID)});
    const arm = state?.arms.find(candidate => candidate.armId === ${JSON.stringify(ARM_ID)});
    if (!state || !arm) throw new Error('requested-state-or-arm-missing');
    const residualGridIdentity = {
      schema: api.FOUR_ARM_HELD_STATE_RESIDUAL_SCHEMA,
      status: 'authenticated',
      stateId: state.stateId,
      sourceRowIndicesSha256: arm.residualPayload.sourceRowIndices.sha256,
      coefficientSourceSha256: arm.residualPayload.coefficientSource.sha256,
      sourceRowCount: state.population.complement,
      gridSize: 16,
      gridScale: 0.1,
      raySteps: 64,
      targetFormat: 'rgba32float',
      independentlyToneMapped: false,
      postToneMapAddition: false,
    };
    let admittedApplication = api.buildFourArmHeldStateApplication({
      artifact,
      stateId: ${JSON.stringify(STATE_ID)},
      armId: ${JSON.stringify(ARM_ID)},
      residualGrid: residualGridIdentity,
    });
    const resolveDescriptorUrl = descriptor => {
      const path = descriptor.path;
      if (path.startsWith(${JSON.stringify(COHORT_PATH)})) {
        return ${JSON.stringify(RESOURCE_ROOTS.cohort)} + path.slice(${JSON.stringify(COHORT_PATH)}.length);
      }
      if (path.startsWith(${JSON.stringify(SOURCE_PATH)})) {
        return ${JSON.stringify(RESOURCE_ROOTS.source)} + path.slice(${JSON.stringify(SOURCE_PATH)}.length);
      }
      if (!path.startsWith('/') && !path.includes('..')) return ${JSON.stringify(RESOURCE_ROOTS.bailiff)} + path;
      throw new Error('undeclared-resource-root:' + path);
    };
    const loadedArrays = await api.loadFourArmHeldStateArrays({
      application: admittedApplication,
      resolveDescriptorUrl,
    });
    const residualGrid = await api.buildPositiveComplementResidualGrid({
      application: admittedApplication,
      arrays: loadedArrays.arrays,
    });
    admittedApplication = api.buildFourArmHeldStateApplication({
      artifact,
      stateId: ${JSON.stringify(STATE_ID)},
      armId: ${JSON.stringify(ARM_ID)},
      residualGrid,
    });
    const packed = api.packFourArmHeldStateGpuRows({
      application: admittedApplication,
      arrays: loadedArrays.arrays,
    });
    const upload = await prototype.applyFourArmHeldStateApplication({
      application: admittedApplication,
      gpuRows: packed.rows,
      residualGrid,
    });
    const visibleFrame = await prototype.sampleFrame({ advanceSim: false, includeRgba: false });
    if (!visibleFrame?.ok) {
      throw new Error('operator-visible-frame-failed:' + JSON.stringify({
        reason: visibleFrame?.reason || 'unknown',
        validationError: visibleFrame?.validationError || null,
        boundarySplatFallbackReason: visibleFrame?.boundarySplatFallbackReason || null,
        presentationFallbackReason: visibleFrame?.boundarySplatPresentationModeFallbackReason || null,
      }));
    }
    window.__kaminosFourArmHeldStateApplication = admittedApplication;
    return {
      artifact: loadedArtifact.receipt,
      arrays: loadedArrays.receipt,
      pack: packed.receipt,
      residualGrid: {
        schema: residualGrid.schema,
        status: residualGrid.status,
        stateId: residualGrid.stateId,
        sourceRowCount: residualGrid.sourceRowCount,
        gridSize: residualGrid.gridSize,
        raySteps: residualGrid.raySteps,
        dataSha256: residualGrid.dataSha256,
        depositionIdentity: residualGrid.depositionIdentity,
        selectorRerun: residualGrid.selectorRerun,
        residualAwareRetargeting: residualGrid.residualAwareRetargeting,
        fallbackReason: residualGrid.fallbackReason,
      },
      upload,
      visibleFrame: {
        ok: visibleFrame.ok,
        simStepCount: visibleFrame.simStepCount,
        rendererRequested: visibleFrame.persistentSparseCohortGpuReceipt?.rendererRequested,
        rendererEncoded: visibleFrame.persistentSparseCohortGpuReceipt?.rendererEncoded,
        rendererApplied: visibleFrame.persistentSparseCohortGpuReceipt?.rendererApplied,
      },
      debugState: prototype.debugState(),
    };
  })()`);
  assert.equal(application.artifact.status, 'complete', 'artifact load was incomplete');
  assert.equal(application.pack.encodedRowCount, 481_447, 'splat population was capped or substituted');
  assert.equal(application.pack.rowCap, null, 'hidden splat row cap was installed');
  assert.equal(application.residualGrid.sourceRowCount, 1_444_341, 'positive complement population drifted');
  assert.equal(application.residualGrid.selectorRerun, false, 'residual build reran selection');
  assert.equal(application.residualGrid.residualAwareRetargeting, false, 'residual build retargeted the sparse cohort');
  assert.equal(application.residualGrid.fallbackReason, null, 'residual fallback looked authoritative');
  assert.equal(application.upload.fallbackReason, null, 'GPU upload fallback looked authoritative');
  assert.equal(application.debugState?.simStepCount, 120, 'application advanced the held state');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, application };

  failurePhase = 'linear-hdr-tau-transmittance-readback';
  const capture = await evaluate(socket, `(async () => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const prototype = runtime.__kaminosVolumePrototype;
    const application = window.__kaminosFourArmHeldStateApplication;
    const api = await import('/volume-four-arm-held-state-runtime.mjs');
    const receipt = await prototype.sampleFourArmHeldStateLedger({
      sameStateCaptureId: 'four-arm-state120-positive-complement-live-0719',
      captureNonce: 'state120-positive-complement-' + crypto.randomUUID(),
    });
    if (receipt?.status !== 'captured') {
      const { payload: failedPayload, ...failedSummary } = receipt || {};
      throw new Error('four-arm-capture-failed:' + JSON.stringify(failedSummary));
    }
    api.validateFourArmHeldStateCaptureReceipt(receipt, application);
    const { payload, ...summary } = receipt;
    return summary;
  })()`);
  assert.equal(capture.status, 'captured', `held-state capture failed: ${JSON.stringify(capture)}`);
  assert.equal(capture.route.requestedRoute, ROUTE_IDENTITY, 'requested route drifted');
  assert.equal(capture.route.effectiveRoute, ROUTE_IDENTITY, 'effective route was substituted');
  assert.equal(capture.route.backend, 'WebGPU:apple', 'backend was substituted');
  assert.equal(capture.fallbackUsed, false, 'capture fallback looked authoritative');
  assert.equal(capture.capturedSimStepCount, 120, 'capture advanced the held state');
  assert.ok(capture.litPixels > 0, 'capture was blank');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, capture };

  failurePhase = 'operator-visible-canvas-capture';
  const canvas = await evaluate(socket, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const rect = runtime.__kaminosVolumePrototype.canvasElement().getBoundingClientRect();
    const basin = document.querySelector('#basin')?.getBoundingClientRect() || { x: 0, y: 0 };
    return { x: basin.x + rect.x, y: basin.y + rect.y, width: rect.width, height: rect.height };
  })()`);
  assert.ok(canvas.width > 1 && canvas.height > 1, 'operator canvas dimensions were invalid');
  const screenshot = await socket.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { ...canvas, scale: 1 },
  });
  const screenshotBytes = Buffer.from(screenshot?.data || '', 'base64');
  assert.ok(screenshotBytes.length > 1000, 'operator canvas screenshot was missing or partial');
  writeFileSync(screenshotPath, screenshotBytes);

  failurePhase = 'browser-event-audit';
  const browserEventAudit = auditBrowserEvents(socket.browserEvents);
  const report = {
    schema: SCHEMA,
    status: 'passed',
    failurePhase: null,
    stateId: STATE_ID,
    armId: ARM_ID,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl.href,
    rendererRoute: ROUTE_IDENTITY,
    routeReceiptPath,
    artifact: { url: ARTIFACT_URL, sha256: ARTIFACT_SHA256 },
    resourceRoots: RESOURCE_ROOTS,
    bootstrap,
    application,
    capture,
    screenshot: { path: screenshotPath, bytes: screenshotBytes.length, sha256: sha256(screenshotBytes) },
    browserEventAudit,
    elapsedMs: performance.now() - startedAt,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status,
    reportPath,
    screenshotPath,
    capture: report.capture,
    elapsedMs: report.elapsedMs,
  }, null, 2));
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

async function evaluate(socketValue, expression) {
  const result = await socketValue.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`browser evaluation failed: ${JSON.stringify(result.exceptionDetails)}`);
  return result.result?.value;
}

async function waitForValue(socketValue, timeout, expression) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(socketValue, expression);
      if (value !== null && value !== undefined) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw lastError || new Error(`timed out waiting for browser value: ${expression}`);
}

async function waitForTarget(port, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(item => item.type === 'page');
        if (target) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome debug target');
}

function assertRouteContract(expectedHref, actualHref) {
  const expected = new URL(expectedHref);
  const actual = new URL(actualHref);
  assert.equal(actual.origin, expected.origin, 'effective route origin was substituted');
  assert.equal(actual.pathname, expected.pathname, 'effective route path was substituted');
  for (const key of ['composition', 'full_support_source', 'full_support_persistent_cohort_state']) {
    assert.equal(actual.searchParams.get(key), expected.searchParams.get(key), `critical route parameter drifted: ${key}`);
  }
}

function auditBrowserEvents(events) {
  const rejected = events.filter(event => event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'));
  if (rejected.length) throw new Error(`browser-event-audit-failed:${JSON.stringify(rejected)}`);
  return { status: 'clean', observedEventCount: events.length, rejectedEventCount: 0 };
}

function parseArgs(tokens) {
  const parsed = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    if (!tokens[index].startsWith('--')) continue;
    parsed.set(tokens[index], tokens[index + 1]);
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

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function chromeExecutable() {
  return process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
