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
const requestedScaleA = Number(args.get('--scale-a') ?? 1);
const requestedScaleB = args.has('--scale-b') ? Number(args.get('--scale-b')) : null;
const scaleArms = requestedScaleB === null
  ? [{ id: 'scale-a', requestedScale: requestedScaleA, screenshotPath, linearHdrPath: resolve(dirname(reportPath), 'linear-hdr-scale-a.f32') }]
  : [
      {
        id: 'scale-a',
        requestedScale: requestedScaleA,
        screenshotPath: resolve(String(args.get('--screenshot-a') || resolve(dirname(reportPath), 'beauty-scale-a.png'))),
        linearHdrPath: resolve(String(args.get('--linear-hdr-a') || resolve(dirname(reportPath), 'linear-hdr-scale-a.f32'))),
      },
      {
        id: 'scale-b',
        requestedScale: requestedScaleB,
        screenshotPath: resolve(String(args.get('--screenshot-b') || resolve(dirname(reportPath), 'beauty-scale-b.png'))),
        linearHdrPath: resolve(String(args.get('--linear-hdr-b') || resolve(dirname(reportPath), 'linear-hdr-scale-b.f32'))),
      },
    ];
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
for (const arm of scaleArms) {
  mkdirSync(dirname(arm.screenshotPath), { recursive: true });
  mkdirSync(dirname(arm.linearHdrPath), { recursive: true });
}

try {
  failurePhase = 'input-admission';
  assert.ok(Number.isFinite(requestedScaleA) && requestedScaleA > 0, '--scale-a must be finite and positive');
  assert.ok(requestedScaleB === null || (Number.isFinite(requestedScaleB) && requestedScaleB > 0), '--scale-b must be finite and positive');
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

  failurePhase = 'operator-visible-canvas-capture';
  const canvas = await evaluate(socket, `(() => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const rect = runtime.__kaminosVolumePrototype.canvasElement().getBoundingClientRect();
    const basin = document.querySelector('#basin')?.getBoundingClientRect() || { x: 0, y: 0 };
    return { x: basin.x + rect.x, y: basin.y + rect.y, width: rect.width, height: rect.height };
  })()`);
  assert.ok(canvas.width > 1 && canvas.height > 1, 'operator canvas dimensions were invalid');
  const sameStateCaptureId = `four-arm-state120-optical-path-scale-${Date.now()}`;
  const armResults = [];
  for (const arm of scaleArms) {
    failurePhase = `optical-path-scale-arm:${arm.id}`;
    const result = await captureScaleArm({ socket, arm, canvas, sameStateCaptureId });
    const capture = result.capture;
    assert.equal(capture.status, 'captured', `held-state capture failed: ${JSON.stringify(capture)}`);
    assert.equal(capture.route.requestedRoute, ROUTE_IDENTITY, 'requested route drifted');
    assert.equal(capture.route.effectiveRoute, ROUTE_IDENTITY, 'effective route was substituted');
    assert.equal(capture.route.backend, 'WebGPU:apple', 'backend was substituted');
    assert.equal(capture.fallbackUsed, false, 'capture fallback looked authoritative');
    assert.equal(capture.capturedSimStepCount, 120, 'capture advanced the held state');
    assert.equal(capture.grid.simulation, 160, 'simulation grid was substituted');
    assert.equal(capture.population.splatCandidates, 481_447, 'splat population drifted');
    assert.equal(capture.population.residualCandidates, 1_444_341, 'residual population drifted');
    assert.equal(capture.depthBins.effective, 16, 'depth-bin count drifted');
    assert.equal(capture.opticalPathScale.requestedOpticalPathScale, arm.requestedScale, 'requested optical path scale drifted');
    assert.equal(capture.opticalPathScale.effectiveOpticalPathScale, Math.fround(arm.requestedScale), 'effective optical path scale drifted');
    assert.ok(capture.litPixels > 0, 'capture was blank');
    assert.equal(capture.finitePixelCount, capture.width * capture.height, 'capture was partial or nonfinite');
    armResults.push(result);
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, arm: arm.id, capture };
  }
  if (armResults.length === 2) {
    const [armA, armB] = armResults;
    assert.equal(armB.capture.sameStateCaptureId, armA.capture.sameStateCaptureId, 'A/B same-state identity drifted');
    assert.equal(armB.capture.capturedSimStepCount, armA.capture.capturedSimStepCount, 'A/B simulation state drifted');
    assert.equal(armB.capture.camera.signature, armA.capture.camera.signature, 'A/B camera drifted');
    assert.equal(
      armB.capture.depositionPayload.sha256,
      armA.capture.depositionPayload.sha256,
      'A/B raw deposited optical bins differ',
    );
    assert.notEqual(armB.capture.hashes.linearHdrSha256, armA.capture.hashes.linearHdrSha256, 'path-scale A/B produced identical linear HDR');
    assert.ok(
      armB.capture.linearHdrStatistics.meanLuma > armA.capture.linearHdrStatistics.meanLuma,
      'calibrated-scale arm did not increase pre-presentation mean luma',
    );
    assert.notEqual(armB.screenshot.sha256, armA.screenshot.sha256, 'path-scale A/B produced identical Beauty pixels');
  }

  failurePhase = 'browser-event-audit';
  const browserEventAudit = auditBrowserEvents(socket.browserEvents);
  const report = {
    schema: armResults.length === 2
      ? 'kaminos.integration.optical-path-scale-ab-witness.v0'
      : SCHEMA,
    status: 'passed',
    failurePhase: null,
    evidenceAuthority: 'operator-exploration-only',
    scaleAuthority: armResults.length === 2
      ? 'grid96-calibrated-mechanism-probe-applied-to-grid160-non-production-v0'
      : 'explicit-request-v0',
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
    sameStateCaptureId,
    invariantControls: {
      coefficientRetune: false,
      exposureRetune: false,
      supportChange: false,
      presentationCompensation: false,
      depositionChange: false,
    },
    arms: armResults,
    ...(armResults.length === 1 ? {
      capture: armResults[0].capture,
      screenshot: armResults[0].screenshot,
    } : {}),
    browserEventAudit,
    elapsedMs: performance.now() - startedAt,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({
    status: report.status,
    reportPath,
    arms: report.arms.map(arm => ({
      id: arm.id,
      requestedScale: arm.requestedScale,
      effectiveScale: arm.capture.opticalPathScale.effectiveOpticalPathScale,
      meanLuma: arm.capture.linearHdrStatistics.meanLuma,
      maxRgb: arm.capture.linearHdrStatistics.maxRgb,
      depositionSha256: arm.capture.depositionPayload.sha256,
      linearHdrSha256: arm.capture.hashes.linearHdrSha256,
      screenshotPath: arm.screenshot.path,
      linearHdrPath: arm.linearHdrArtifact.path,
    })),
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

async function captureScaleArm({ socket: socketValue, arm, canvas, sameStateCaptureId }) {
  const payloadKey = `__kaminosOpticalPathScaleLinearHdr_${arm.id.replaceAll('-', '_')}`;
  const captured = await evaluate(socketValue, `(async () => {
    const runtime = document.querySelector('#basin')?.contentWindow || window;
    const prototype = runtime.__kaminosVolumePrototype;
    const application = window.__kaminosFourArmHeldStateApplication;
    const api = await import('/volume-four-arm-held-state-runtime.mjs');
    const scaleReceipt = prototype.setOpticalPathScale(${JSON.stringify(arm.requestedScale)});
    const receipt = await prototype.sampleFourArmHeldStateLedger({
      sameStateCaptureId: ${JSON.stringify(sameStateCaptureId)},
      captureNonce: ${JSON.stringify(arm.id)} + '-' + crypto.randomUUID(),
    });
    if (receipt?.status !== 'captured') {
      const { payload: failedPayload, ...failedSummary } = receipt || {};
      throw new Error('four-arm-capture-failed:' + JSON.stringify(failedSummary));
    }
    api.validateFourArmHeldStateCaptureReceipt(receipt, application);
    const visibleFrame = await prototype.renderFrozenScaleToCanvas({
      boundarySplatComposition: 'splat-only-v0',
      renderScale: 1,
      includeRgba: false,
      sameStateCaptureId: ${JSON.stringify(sameStateCaptureId)},
    });
    if (!visibleFrame?.ok) {
      throw new Error('operator-visible-frame-failed:' + JSON.stringify({
        reason: visibleFrame?.reason || 'unknown',
        validationError: visibleFrame?.validationError || null,
        fallbackReason: visibleFrame?.boundarySplatFallbackReason || null,
      }));
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { payload, ...summary } = receipt;
    window[${JSON.stringify(payloadKey)}] = new Uint8Array(
      payload.linearHdr.buffer,
      payload.linearHdr.byteOffset,
      payload.linearHdr.byteLength,
    );
    return {
      scaleReceipt,
      capture: summary,
      payloadByteLength: payload.linearHdr.byteLength,
      visibleFrame: {
        ok: visibleFrame.ok,
        frameCount: visibleFrame.frameCount,
        simStepCount: visibleFrame.simStepCount,
        effectiveRoute: visibleFrame.effectiveRoute,
        backend: visibleFrame.backend,
        fallbackReason: visibleFrame.boundarySplatFallbackReason || null,
        presentationFallbackReason: visibleFrame.boundarySplatPresentationReceipt?.fallbackReason || null,
        presentationReceipt: visibleFrame.boundarySplatPresentationReceipt || null,
      },
    };
  })()`);
  assert.equal(captured.scaleReceipt.requestedOpticalPathScale, arm.requestedScale, 'scale setter changed the request');
  assert.equal(captured.scaleReceipt.effectiveOpticalPathScale, Math.fround(arm.requestedScale), 'scale setter changed the effective value');
  assert.equal(captured.visibleFrame.ok, true, 'operator-visible frame was not rendered');
  assert.equal(captured.visibleFrame.fallbackReason, null, 'operator-visible frame used a renderer fallback');
  assert.equal(captured.visibleFrame.presentationFallbackReason, null, 'operator-visible frame used a presentation fallback');
  assert.equal(
    captured.visibleFrame.presentationReceipt?.opticalPathScale?.effective,
    Math.fround(arm.requestedScale),
    'Beauty presentation receipt did not apply the requested optical path scale',
  );

  const linearHdrBytes = await readBrowserBytes(socketValue, payloadKey, captured.payloadByteLength);
  await evaluate(socketValue, `(() => { delete window[${JSON.stringify(payloadKey)}]; return true; })()`);
  assert.equal(linearHdrBytes.length, captured.payloadByteLength, 'linear HDR artifact was partial');
  assert.equal(sha256(linearHdrBytes), captured.capture.hashes.linearHdrSha256, 'linear HDR artifact hash drifted during export');
  writeFileSync(arm.linearHdrPath, linearHdrBytes);

  const screenshot = await socketValue.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: { ...canvas, scale: 1 },
  });
  const screenshotBytes = Buffer.from(screenshot?.data || '', 'base64');
  assert.ok(screenshotBytes.length > 1000, 'operator canvas screenshot was missing or partial');
  writeFileSync(arm.screenshotPath, screenshotBytes);

  return {
    id: arm.id,
    requestedScale: arm.requestedScale,
    effectiveScale: Math.fround(arm.requestedScale),
    scaleReceipt: captured.scaleReceipt,
    capture: captured.capture,
    visibleFrame: captured.visibleFrame,
    linearHdrArtifact: {
      path: arm.linearHdrPath,
      byteLength: linearHdrBytes.length,
      sha256: sha256(linearHdrBytes),
      dtype: 'float32-little-endian',
      shape: [captured.capture.height, captured.capture.width, 4],
      authority: 'exact-gpu-rgba16float-decoded-to-float32-v0',
    },
    screenshot: {
      path: arm.screenshotPath,
      bytes: screenshotBytes.length,
      sha256: sha256(screenshotBytes),
      authority: 'matched-beauty-canvas-after-held-state-resolve-v0',
    },
  };
}

async function readBrowserBytes(socketValue, key, byteLength) {
  const chunkBytes = 512 * 1024;
  const chunks = [];
  for (let offset = 0; offset < byteLength; offset += chunkBytes) {
    const length = Math.min(chunkBytes, byteLength - offset);
    const encoded = await evaluate(socketValue, `(() => {
      const source = window[${JSON.stringify(key)}];
      if (!(source instanceof Uint8Array)) throw new Error('linear-hdr-browser-payload-missing');
      const slice = source.subarray(${offset}, ${offset + length});
      let binary = '';
      for (let cursor = 0; cursor < slice.length; cursor += 32768) {
        binary += String.fromCharCode(...slice.subarray(cursor, Math.min(slice.length, cursor + 32768)));
      }
      return btoa(binary);
    })()`);
    chunks.push(Buffer.from(encoded, 'base64'));
  }
  return Buffer.concat(chunks);
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
