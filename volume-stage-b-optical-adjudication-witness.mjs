#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
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
          if (['Runtime.exceptionThrown', 'Runtime.consoleAPICalled', 'Log.entryAdded'].includes(message.method)) this.browserEvents.push(message);
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
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
  close() { this.socket?.close(); }
}

const SCHEMA = 'kaminos.pyro.stage-b-optical-adjudication-witness.v0';
const EXPECTED_SOURCE = 'analytical-exact';
const EXPECTED_ROWS = 1_899_742;
const args = parseArgs(process.argv.slice(2));
const routeReceiptPath = requiredPath('--route-receipt');
const reportPath = resolve(String(args.get('--report') || '/tmp/kaminos-stage-b-optical-adjudication/report.json'));
const screenshotPath = resolve(String(args.get('--screenshot') || '/tmp/kaminos-stage-b-optical-adjudication/frame.png'));
const timeoutMs = Number(args.get('--timeout-ms') || 900_000);
const viewportWidth = Number(args.get('--viewport-width') || 1280);
const viewportHeight = Number(args.get('--viewport-height') || 720);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const routeReceipt = readJson(routeReceiptPath);
const stageBArtifact = routeReceipt.artifacts?.stageBManifest;
const manifest = stageBArtifact?.path ? readJson(stageBArtifact.path) : null;
const startedAt = performance.now();

let browser = null;
let socket = null;
let failurePhase = 'route-and-resource-validation';
let lastTrustworthyEvidence = { schema: SCHEMA, routeReceiptPath };
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(screenshotPath), { recursive: true });

try {
  assert.equal(routeReceipt.schema, 'kaminos.pyro.full-support-cockpit-session.v0', 'route receipt schema was substituted');
  assert.equal(routeReceipt.status, 'serving', 'route receipt is not serving');
  assert.ok(stageBArtifact?.path, 'route receipt omitted the Stage B manifest');
  assert.equal(sha256(readFileSync(stageBArtifact.path)), stageBArtifact.sha256, 'local Stage B manifest hash drifted');
  assert.equal(manifest.status, 'complete', 'Stage B manifest is incomplete');
  assert.equal(manifest.acceptance?.authority, 'producer-evidence-unverified', 'provisional producer authority was inflated');
  assert.equal(manifest.acceptance?.scope, 'operator-exploration-only', 'operator-only scope was hidden');
  assert.equal(manifest.acceptance?.decisionBearing, false, 'provisional Stage B became decision-bearing');
  const expectedUrl = new URL(routeReceipt.effectiveRoute).href;
  const authority = buildAuthority(routeReceipt, manifest);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    manifestSha256: stageBArtifact.sha256,
    authority,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/kaminos-stage-b-optical-adjudication-${process.pid}-${Date.now()}`,
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
  const admitted = await waitForValue(socket, timeoutMs, `(() => document.readyState === 'complete'
    ? { href: location.href, hasBasin: Boolean(document.querySelector('#basin')) }
    : null)()`);
  assertRouteContract(expectedUrl, admitted.href);
  assert.equal(admitted.hasBasin, true, 'effective route did not mount the volume viewer');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admitted };

  failurePhase = 'checksum-state-bootstrap';
  const bootstrap = await waitForValue(socket, timeoutMs, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const receipt = runtime.__kaminosFullSupportStageABootstrapReceipt;
    return receipt && receipt.status !== 'loading' ? receipt : null;
  })()`);
  assert.equal(bootstrap.status, 'effective', `Stage A bootstrap failed: ${JSON.stringify(bootstrap)}`);
  assert.equal(bootstrap.presentedState?.simStepCount, 120, 'bootstrap drifted from state 120');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, bootstrap };

  failurePhase = 'exact-source-and-stage-b-application';
  const exactApplication = await evaluate(socket, `(async () => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const sourceSelect = runtime.document.getElementById('volume-full-support-source');
    if (!sourceSelect || typeof runtime.__kaminosApplyFullSupportSource !== 'function') throw new Error('exact-source-api-missing');
    sourceSelect.value = ${JSON.stringify(EXPECTED_SOURCE)};
    const sourceReceipt = await runtime.__kaminosApplyFullSupportSource();
    if (typeof runtime.__kaminosApplyStageBTreatment !== 'function') throw new Error('stage-b-application-api-missing');
    const stageBReceipt = await runtime.__kaminosApplyStageBTreatment(runtime.__kaminosStageBCockpitReceipt);
    return { sourceReceipt, stageBReceipt };
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, exactApplication };
  assert.equal(exactApplication.sourceReceipt?.status, 'effective', 'analytical exact source did not become effective');
  assert.equal(exactApplication.sourceReceipt?.effectiveSource, EXPECTED_SOURCE, 'analytical exact source was substituted');
  assert.equal(exactApplication.sourceReceipt?.rowCount, EXPECTED_ROWS, 'analytical exact source population drifted');
  assert.equal(exactApplication.sourceReceipt?.fallbackUsed, false, 'analytical exact source used fallback');
  assert.equal(exactApplication.stageBReceipt?.status, 'effective', 'Stage B treatment did not become effective');
  assert.equal(exactApplication.stageBReceipt?.passes?.rendererRequested, true, 'Stage B renderer request was unreported');
  assert.equal(exactApplication.stageBReceipt?.passes?.rendererEncoded, true, 'Stage B renderer was not encoded');
  assert.equal(exactApplication.stageBReceipt?.passes?.rendererApplied, true, 'Stage B renderer was not applied');
  assert.equal(exactApplication.stageBReceipt?.fallbackUsed, false, 'Stage B fallback looked authoritative');

  failurePhase = 'gpu-layer-readback-and-independent-recurrence';
  const adjudication = await evaluate(socket, `(async () => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const prototype = runtime.__kaminosVolumePrototype;
    if (typeof prototype?.sampleBoundarySplatOpticalAdjudication !== 'function') throw new Error('stage-b-optical-adjudication-api-missing');
    return prototype.sampleBoundarySplatOpticalAdjudication({ authority: ${JSON.stringify(authority)} });
  })()`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, adjudication };
  assert.equal(adjudication.status, 'completed', 'Stage B optical adjudication was partial');
  assert.equal(adjudication.renderer?.fallbackUsed, false, 'adjudication used renderer fallback');
  assert.equal(adjudication.comparison?.exactWithinTolerance, true,
    `GPU and independent recurrence diverged: ${JSON.stringify(adjudication.comparison)}`);

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
    failurePhase: null,
    requestedRoute: routeReceipt.requestedRoute,
    effectiveRoute: expectedUrl,
    routeReceiptPath,
    stageBManifest: { path: stageBArtifact.path, sha256: stageBArtifact.sha256 },
    authority: {
      evidenceAuthority: manifest.acceptance.authority,
      operatorScope: manifest.acceptance.scope,
      decisionBearing: manifest.acceptance.decisionBearing,
      acceptanceCustodian: manifest.acceptance.custodian,
    },
    bootstrap,
    exactApplication,
    adjudication,
    screenshotPath,
    screenshotSha256: sha256(Buffer.from(screenshot.data, 'base64')),
    elapsedMs: performance.now() - startedAt,
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

function buildAuthority(receipt, value) {
  const source = value.source;
  const renderer = value.renderer;
  return {
    sameStateCaptureId: source.sameStateCaptureId,
    sourceManifestSha256: receipt.artifacts.sourceFieldManifest.sha256,
    manifestSha256: receipt.artifacts.stageBManifest.sha256,
    fluidSha256: source.fluidSha256,
    frontSha256: source.frontSha256,
    supportSha256: source.supportSha256,
    coefficientSha256: source.coefficientSha256,
    covarianceSha256: source.covarianceSha256,
    candidatePayloadSha256: source.candidatePayloadSha256,
    controlsSha256: source.controlsSha256,
    requestedMode: value.identities.treatment,
    effectiveMode: value.identities.treatment,
    requestedTargetFormat: renderer.targetFormat,
    effectiveTargetFormat: renderer.targetFormat,
    layerFormat: renderer.layerFormat,
    outputAttachmentFormat: 'rgba8unorm',
    depthBins: renderer.depthBins.effective,
    candidateCount: value.capacity.candidateCount,
    capacity: value.capacity.capacity,
    overflowCount: value.capacity.overflowCount,
    fallbackUsed: false,
    rendererRequested: true,
    rendererEncoded: true,
    rendererApplied: true,
  };
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
    } catch (error) { lastError = error; }
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
  assert.equal(actual.origin, expected.origin, 'effective origin was substituted');
  assert.equal(actual.pathname, expected.pathname, 'effective route path was substituted');
  for (const key of ['composition', 'full_support_source', 'full_support_stage_b_manifest', 'full_support_stage_b_manifest_sha256']) {
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

function readJson(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function sha256(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function chromeExecutable() { return process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'; }
function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }
