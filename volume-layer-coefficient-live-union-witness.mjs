#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
import { inflateSync } from 'node:zlib';

const SCHEMA = 'kaminos.volume.layer-coefficient-live-union-witness.v0';
const EFFECTIVE_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const PROTOTYPE_IDENTITY = 'kaminos-volume-prototype-v0';
const UNION_MODE = 'kernel_moment_full_flame_union';
const UNION_RENDERER = 'live-ridge-nonridge-union-kernel-moment-covariance-splats-v0';
const FIELD_LAYOUT_IDENTITY = 'fluid-front-grid-x-fastest-y-then-z-f32-v0';
const IMPORT_AUTHORITY = 'checksum-addressed-live-replay-resume-v0';
const IMPORT_FILTER = 'exact-field-live-replay-application-v0';
const VOLUME_PROTOTYPE_EXPRESSION = `(window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype)`;
const FRONT_LEFT_CAMERA = Object.freeze({
  position: [-2.9303392321261956, 0.345224002268194, 2.115477025708465],
  target: [0.010667493255923342, -0.0050203846009383, 0.1098700760228956],
});
const FIXED_NOW_MS = 12983.333333333334;
const FLOW_KERNEL_CONTROLS = Object.freeze({
  flowKernelStrength: 0.6,
  flowKernelRadius: 0.018,
  flowKernelCoherence: 0.7,
});

const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(String(args.get('--repo-root') || import.meta.dirname));
const sourceFieldManifestPath = requiredPath('--source-field-manifest');
const sourceCaptureReportPath = requiredPath('--source-capture-report');
const baselineOverlayManifestPath = requiredPath('--baseline-overlay-manifest');
const flowOverlayManifestPath = requiredPath('--flow-overlay-manifest');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-layer-coefficient-live-union-witness'));
const reportPath = resolve(String(args.get('--report') || join(outDir, 'witness-report.json')));
const timeoutMs = Number(args.get('--timeout-ms') || 900000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const viewportWidth = Number(args.get('--viewport-width') || 1280);
const viewportHeight = Number(args.get('--viewport-height') || 960);
const chunkBytes = Number(args.get('--chunk-bytes') || 4 * 1024 * 1024);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const projectedWorkTargetPixels = normalizeProjectedWorkTargetPixels(args.get('--projected-work-target-pixels'));

const sourceFieldManifest = readJson(sourceFieldManifestPath);
const sourceCaptureReport = readJson(sourceCaptureReportPath);
const baselineOverlayManifest = readJson(baselineOverlayManifestPath);
const flowOverlayManifest = readJson(flowOverlayManifestPath);
const sourceManifestSha256 = sha256(readFileSync(sourceFieldManifestPath));
const sourceHashes = sourceHashesFromManifest(sourceFieldManifest);
const expectedSource = {
  grid: sourceFieldManifest.grid,
  admissionIndexSha256: baselineOverlayManifest.source?.state?.admissionIndexSha256,
  sourceHashes,
};
const baselineOverlayRoot = dirname(baselineOverlayManifestPath);
const flowOverlayRoot = dirname(flowOverlayManifestPath);
const mounts = Object.freeze([
  { prefix: '/__witness__/baseline/', root: baselineOverlayRoot },
  { prefix: '/__witness__/flow/', root: flowOverlayRoot },
  { prefix: '/', root: repoRoot },
]);
const effectiveServerRoots = Object.freeze({
  app: repoRoot,
  baselineOverlay: baselineOverlayRoot,
  flowOverlay: flowOverlayRoot,
});

let browser = null;
let socket = null;
let server = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {
  schema: SCHEMA,
  sourceFieldManifestPath,
  sourceManifestSha256,
  sourceHashes,
  effectiveServerRoots,
};

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

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

try {
  validateInputs();
  failurePhase = 'same-origin-server';
  server = await startServer();
  const address = server.address();
  const serverOrigin = `http://127.0.0.1:${address.port}`;
  const sourceRoute = new URL(sourceCaptureReport.requestedRoute);
  const requestedUrl = new URL(`${sourceRoute.pathname}${sourceRoute.search}`, serverOrigin).href;
  const baselineManifestUrl = new URL('/__witness__/baseline/runtime-overlay.json', serverOrigin).href;
  const flowManifestUrl = new URL('/__witness__/flow/runtime-overlay.json', serverOrigin).href;
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    serverOrigin,
    requestedUrl,
    baselineManifestUrl,
    flowManifestUrl,
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=/tmp/kaminos-live-union-witness-${process.pid}-${Date.now()}`,
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
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admission = await waitForRuntime(socket, timeoutMs);
  assert.equal(admission.active, true, 'runtime did not become active');
  assert.equal(admission.effectiveRoute, EFFECTIVE_ROUTE, 'effective route was substituted');
  assert.equal(admission.prototypeIdentity, PROTOTYPE_IDENTITY, 'prototype identity was substituted');
  assert.ok(String(admission.backend).startsWith('WebGPU'), 'backend was substituted away from WebGPU');
  assert.equal(admission.grid, sourceFieldManifest.grid, 'runtime grid differs from imported field grid');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admission };
  await delay(settleMs);

  failurePhase = 'camera-and-render-contract';
  const presentation = await evaluate(socket, `(async () => {
    const basin = document.querySelector('#basin');
    if (!basin) throw new Error('operator-visible-basin-iframe-missing');
    const basinWindow = basin?.contentWindow || window;
    const setPose = basinWindow.kaminosSetCameraDebugPose || window.kaminosSetCameraDebugPose;
    if (typeof setPose !== 'function') throw new Error('camera-debug-pose-api-missing');
    const camera = setPose(${JSON.stringify(FRONT_LEFT_CAMERA)});
    const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
    prototype.setSelectiveHeadLiveCapturePaused?.(true);
    prototype.setRaymarchSmokePresentationMode?.('off');
    prototype.setVolumePresentationMode?.('beauty');
    await prototype.setActive(false);
    const state = prototype.debugState();
    return { camera, state: {
      active: state.active,
      frameCount: state.frameCount,
      simStepCount: state.simStepCount,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      raymarchSmokePresentationReceipt: state.raymarchSmokePresentationReceipt,
    } };
  })()`);
  assert.equal(presentation.state.active, false, 'runtime did not freeze before field import');
  assert.equal(presentation.state.raymarchSmokePresentationReceipt?.effectiveMode, 'off', 'raymarch smoke was not suppressed for the Full Flame target');

  failurePhase = 'full-field-import-begin';
  const importBegin = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.beginDebugFullFieldImport(${JSON.stringify({
    grid: sourceFieldManifest.grid,
    initializationAuthority: IMPORT_AUTHORITY,
    filterIdentity: IMPORT_FILTER,
    layoutIdentity: FIELD_LAYOUT_IDENTITY,
    sourceManifestPath: sourceFieldManifestPath,
    sourceManifestSha256,
    source: { identity: 'coefficient-state-120', authority: 'checksum-addressed-held-out-coefficient-state-v0' },
    receiverInitialSimStepCount: 120,
    fluid: sourceFieldManifest.sidecars.fluid,
    front: sourceFieldManifest.sidecars.front,
  })})`);
  assert.equal(importBegin?.ok, true, `full-field import did not begin: ${JSON.stringify(importBegin)}`);
  await uploadField(importBegin.sessionId, 'fluid', sourceFieldManifest.sidecars.fluid);
  await uploadField(importBegin.sessionId, 'front', sourceFieldManifest.sidecars.front);

  failurePhase = 'full-field-import-finish';
  const importReceipt = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.finishDebugFullFieldImport(${JSON.stringify({ sessionId: importBegin.sessionId })})`);
  assert.equal(importReceipt?.ok, true, `full-field import failed: ${JSON.stringify(importReceipt)}`);
  assert.equal(importReceipt.status, 'applied', 'full-field import was not applied');
  assert.equal(importReceipt.fluidSha256, sourceHashes.fluidSha256, 'fluid checksum drifted during import');
  assert.equal(importReceipt.frontSha256, sourceHashes.frontSha256, 'front checksum drifted during import');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, presentation, importReceipt };

  const sourceState = await evaluate(socket, `(() => {
    const state = ${VOLUME_PROTOTYPE_EXPRESSION}.debugState();
    return { frameCount: state.frameCount, simStepCount: state.simStepCount, backend: state.backend, effectiveRoute: state.effectiveRoute };
  })()`);
  const sameStateCaptureId = `coefficient-state-120-f${sourceState.frameCount}-s${sourceState.simStepCount}`;
  const captureContext = {
    fullFieldImportSessionId: importReceipt.sessionId,
    sameStateCaptureId,
    sourceFrameCount: sourceState.frameCount,
    sourceSimStepCount: sourceState.simStepCount,
  };

  failurePhase = 'analytical-exact';
  const analytical = await captureCondition({
    label: 'analytical-exact',
    captureContext,
    overlay: null,
  });

  failurePhase = 'source-hash-audit';
  const sourceHashAudit = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.auditBoundarySplatLiveUnionSourceHashes(${JSON.stringify({ expectedSourceHashes: sourceHashes })})`);
  if (sourceHashAudit?.ok !== true) throw new Error(`source-hash-audit-mismatch:${JSON.stringify(sourceHashAudit)}`);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, sourceHashAudit, analytical: compactCondition(analytical) };

  failurePhase = 'learned-baseline';
  const learnedBaseline = await captureCondition({
    label: 'learned-baseline',
    captureContext,
    overlay: {
      manifestUrl: baselineManifestUrl,
      identity: baselineOverlayManifest.identity,
      expectedSource,
    },
  });

  failurePhase = 'learned-flow';
  const learnedFlow = await captureCondition({
    label: 'learned-flow',
    captureContext,
    overlay: {
      manifestUrl: flowManifestUrl,
      identity: flowOverlayManifest.identity,
      expectedSource,
    },
  });

  failurePhase = 'matched-raymarch';
  const matchedRaymarch = await captureCondition({
    label: 'matched-raymarch',
    captureContext,
    raymarch: true,
    overlay: null,
  });

  const conditions = [analytical, learnedBaseline, learnedFlow, matchedRaymarch];
  for (const condition of conditions) {
    if (condition.render.frameCount !== sourceState.frameCount || condition.render.simStepCount !== sourceState.simStepCount) {
      throw new Error(`same-state-drift:${condition.label}:${condition.render.frameCount}:${condition.render.simStepCount}:${sourceState.frameCount}:${sourceState.simStepCount}`);
    }
    if (condition.metrics.nonblank !== true) throw new Error(`blank-capture:${condition.label}`);
  }
  for (const condition of [analytical, learnedBaseline, learnedFlow]) {
    assert.equal(condition.render.controlOverrides.boundarySplatMode, UNION_MODE, `${condition.label} union mode drifted`);
    assert.equal(condition.render.boundarySplatRendererIdentity, UNION_RENDERER, `${condition.label} renderer drifted`);
    assert.equal(condition.render.boundarySplatOverflowCount, 0, `${condition.label} overflowed`);
    const unionReceipt = condition.overlay?.unionReceipt || condition.populationAudit?.unionReceipt;
    assert.equal(unionReceipt?.effectiveMode, UNION_MODE, `${condition.label} union receipt drifted`);
    const selectorActive = projectedWorkTargetPixels > 0;
    if (selectorActive) {
      assert.equal(condition.populationAudit.selectorPolicyIdentity, 'boundary-splat-live-union-projected-footprint-hash-thinning-v0', `${condition.label} selector identity drifted`);
      assert.equal(condition.populationAudit.requestedProjectedWorkTargetPixels, projectedWorkTargetPixels, `${condition.label} requested selector target drifted`);
      assert.equal(condition.populationAudit.effectiveProjectedWorkTargetPixels, projectedWorkTargetPixels, `${condition.label} effective selector target drifted`);
      assert.ok(Number(condition.populationAudit.projectedWorkRejectedCount) > 0, `${condition.label} selector rejected no projected work`);
      const receiptFullUnionCount = Number(unionReceipt?.counts?.union ?? unionReceipt?.unionCount ?? unionReceipt?.union);
      const auditFullUnionCount = Number(condition.populationAudit.fullUnionCount ?? condition.populationAudit.unionReceipt?.counts?.union ?? condition.populationAudit.initialDraw?.unionCount);
      assert.equal(
        receiptFullUnionCount,
        auditFullUnionCount,
        `${condition.label} selector changed full-union source count`,
      );
    } else {
      assert.equal(condition.populationAudit.stableNativeCellIdSha256, expectedSource.admissionIndexSha256, `${condition.label} stable native-cell population drifted`);
    }
  }
  assert.equal(learnedBaseline.overlay.effectiveOverlayIdentity, baselineOverlayManifest.identity, 'baseline overlay did not become effective');
  assert.equal(learnedFlow.overlay.effectiveOverlayIdentity, flowOverlayManifest.identity, 'flow overlay did not become effective');

  failurePhase = 'boundary-splat-gpu-profile';
  const boundarySplatGpuProfile = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.sampleBoundarySplatGpuProfile()`);
  analytical.populationAudit.boundarySplatGpuProfile = boundarySplatGpuProfile;

  failurePhase = 'gpu-validation';
  const browserEvents = socket.browserEvents.map(summarizeBrowserEvent);
  const gpuValidationErrors = browserEvents.filter(event => /GPUValidationError|Invalid CommandBuffer|does not fit in \[Buffer/.test(
    `${event.text || ''} ${(event.args || []).join(' ')}`,
  ));
  if (gpuValidationErrors.length > 0) throw new Error(`gpu-validation-error:${JSON.stringify(gpuValidationErrors)}`);

  failurePhase = 'report';
  const report = {
    schema: SCHEMA,
    status: 'captured',
    failurePhase: null,
    requestedUrl,
    effectiveServerRoots,
    source: {
      fieldManifest: artifact(sourceFieldManifestPath),
      captureReport: artifact(sourceCaptureReportPath),
      sourceHashes,
      importReceipt,
      sourceHashAudit,
      state: sourceState,
      sameStateCaptureId,
      camera: FRONT_LEFT_CAMERA,
    },
    selector: {
      requestedProjectedWorkTargetPixels: projectedWorkTargetPixels,
      selectorActive: projectedWorkTargetPixels > 0,
      requestedSelectorIdentity: projectedWorkTargetPixels > 0
        ? 'boundary-splat-live-union-projected-footprint-hash-thinning-v0'
        : 'boundary-splat-live-union-source-preserving-v0',
      authority: '--projected-work-target-pixels explicit witness argument',
    },
    route: admission,
    presentation,
    overlays: {
      baseline: { manifest: artifact(baselineOverlayManifestPath), identity: baselineOverlayManifest.identity },
      flow: { manifest: artifact(flowOverlayManifestPath), identity: flowOverlayManifest.identity },
    },
    conditions,
    browserEvents,
    lastTrustworthyEvidence: 'all four operator-visible same-state captures passed source, population, route, and nonblank gates',
  };
  writeReport(report);
  console.log(JSON.stringify({
    ok: true,
    report: reportPath,
    sameStateCaptureId,
    sourceHashAudit,
    conditions: conditions.map(compactCondition),
  }, null, 2));
} catch (error) {
  writeReport({
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    effectiveServerRoots,
    lastTrustworthyEvidence,
    browserEvents: socket?.browserEvents?.map(summarizeBrowserEvent) || [],
  });
  console.error(JSON.stringify({ ok: false, report: reportPath, failurePhase, error: error?.message || String(error) }, null, 2));
  process.exitCode = 1;
} finally {
  try { socket?.close(); } catch {}
  try { browser?.kill('SIGTERM'); } catch {}
  try { server?.close(); } catch {}
}

async function captureCondition({ label, captureContext, overlay, raymarch = false }) {
  if (overlay) {
    const loadReceipt = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.loadBoundarySplatLiveUnionCoefficientOverlay(${JSON.stringify({
      manifestUrl: overlay.manifestUrl,
      overlayIdentity: overlay.identity,
      expectedSource: overlay.expectedSource,
    })})`);
    assert.equal(loadReceipt.status, 'awaiting-population-audit', `${label} overlay load failed: ${JSON.stringify(loadReceipt)}`);
  } else {
    await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.clearBoundarySplatLiveUnionCoefficientOverlay(${JSON.stringify({ reason: `${label}-analytical-authority` })})`);
  }

  const renderOptions = {
    fullFieldImportSessionId: captureContext.fullFieldImportSessionId,
    renderScale: 1,
    boundarySplatComposition: raymarch ? 'raymarch-only-v0' : 'splat-only-v0',
    controlOverrides: {
      boundarySplatMode: UNION_MODE,
      boundarySplatProjectedWorkTargetPixels: projectedWorkTargetPixels,
      ...FLOW_KERNEL_CONTROLS,
    },
    now: FIXED_NOW_MS,
    sameStateCaptureId: captureContext.sameStateCaptureId,
    baseFrameCount: captureContext.sourceFrameCount,
    baseSimStepCount: captureContext.sourceSimStepCount,
    includeRgba: !overlay,
    restoreControls: false,
    resumeRenderLoop: false,
  };
  let render = await evaluate(socket, compactFrozenRenderExpression(renderOptions));
  assert.equal(render?.ok, true, `${label} render failed: ${JSON.stringify(render)}`);

  let overlayReceipt = null;
  let populationAudit = null;
  if (overlay) {
    overlayReceipt = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.auditBoundarySplatLiveUnionCoefficientOverlayPopulation(${JSON.stringify({ now: FIXED_NOW_MS })})`);
    if (overlayReceipt.status !== 'effective') throw new Error(`population-audit:${label}:${JSON.stringify(overlayReceipt)}`);
    render = await evaluate(socket, compactFrozenRenderExpression({ ...renderOptions, includeRgba: true }));
    assert.equal(render?.ok, true, `${label} post-audit render failed: ${JSON.stringify(render)}`);
    populationAudit = overlayReceipt.populationAudit;
  } else if (!raymarch) {
    populationAudit = await evaluate(socket, `(async () => {
      const audit = await ${VOLUME_PROTOTYPE_EXPRESSION}.sampleBoundarySplatFootprintAudit({ now: ${FIXED_NOW_MS} });
      return {
        status: audit.ok ? 'effective' : 'failed',
        authority: audit.authority,
        footprintAuthority: audit.footprintAuthority,
        candidatePayloadAuthority: audit.candidatePayloadAuthority,
        candidatePayloadSha256: audit.candidatePayloadSha256,
        attributePayloadAuthority: audit.attributePayloadAuthority,
        attributePayloadSha256: audit.attributePayloadSha256,
        stateWitnessAuthority: audit.stateWitnessAuthority,
        stateWitnessSha256: audit.stateWitnessSha256,
        controlAuthority: audit.controlAuthority,
        controlSha256: audit.controlSha256,
        stableNativeCellIdAuthority: audit.stableNativeCellIdAuthority,
        stableNativeCellIdSha256: audit.stableNativeCellIdSha256,
        candidateCount: audit.candidateCount,
        instanceCount: audit.instanceCount,
        overflowCount: audit.overflowCount,
        projectedWorkRejectedCount: audit.projectedWorkRejectedCount,
        selectorPolicyId: audit.selectorPolicyId,
        selectorPolicyIdentity: audit.selectorPolicyIdentity,
        requestedProjectedWorkTargetPixels: audit.requestedProjectedWorkTargetPixels,
        effectiveProjectedWorkTargetPixels: audit.effectiveProjectedWorkTargetPixels,
        selectedCandidateCount: audit.selectedCandidateCount,
        boundarySplatProjectedWorkRejectedCount: audit.projectedWorkRejectedCount,
        boundarySplatSelectorPolicyId: audit.selectorPolicyId,
        boundarySplatSelectorPolicyIdentity: audit.selectorPolicyIdentity,
        boundarySplatRequestedProjectedWorkTargetPixels: audit.requestedProjectedWorkTargetPixels,
        boundarySplatEffectiveProjectedWorkTargetPixels: audit.effectiveProjectedWorkTargetPixels,
        boundarySplatSelectedCandidateCount: audit.selectedCandidateCount,
        initialDraw: audit.initialDraw,
        capacityRetryCount: audit.capacityRetryCount,
        capacityAfterRetry: audit.capacityAfterRetry,
        descriptorFrameMetrics: audit.descriptorFrameMetrics,
        projectionMetrics: audit.projectionMetrics,
        decodedMembershipCounts: audit.decodedMembershipCounts,
        unionReceipt: audit.unionReceipt,
      };
    })()`);
    if (populationAudit.status !== 'effective') throw new Error(`population-audit:${label}:${JSON.stringify(populationAudit)}`);
  }

  const rgbaCapture = render.rgbaCapture;
  assert.ok(rgbaCapture?.width >= 64 && rgbaCapture?.height >= 64, `${label} exact RGBA readback is missing`);
  assert.equal(rgbaCapture.imageAuthority, 'gpu-rgba8-readback-frozen-sim-state-v0', `${label} image authority drifted`);
  assert.equal(rgbaCapture.rgbaByteLength, rgbaCapture.width * rgbaCapture.height * 4, `${label} RGBA payload is partial`);
  assert.ok(typeof rgbaCapture.pngBase64 === 'string' && rgbaCapture.pngBase64.length > 64, `${label} compact PNG transport is missing`);
  const imagePath = join(outDir, `${label}.png`);
  const imageBytes = Buffer.from(rgbaCapture.pngBase64, 'base64');
  writeFileSync(imagePath, imageBytes);
  const metrics = pngPixelMetrics(imageBytes);
  if (!metrics.nonblank) throw new Error(`blank-capture:${label}`);
  const { pngBase64: _pngBase64, ...rgbaCaptureReceipt } = rgbaCapture;
  return {
    label,
    requestedAuthority: raymarch ? 'matched-raymarch' : overlay ? overlay.identity : 'analytical-exact',
    render: { ...render, rgbaCapture: rgbaCaptureReceipt },
    overlay: overlayReceipt,
    populationAudit,
    metrics,
    capture: {
      authority: 'gpu-rgba8-readback-frozen-sim-state-v0',
      width: rgbaCapture.width,
      height: rgbaCapture.height,
      rgbaByteLength: rgbaCapture.rgbaByteLength,
      pngByteLength: imageBytes.byteLength,
    },
    image: artifact(imagePath),
  };
}

async function uploadField(sessionId, kind, sidecar) {
  const bytes = readFileSync(sidecar.path);
  let byteOffset = 0;
  while (byteOffset < bytes.byteLength) {
    const chunk = bytes.subarray(byteOffset, Math.min(bytes.byteLength, byteOffset + chunkBytes));
    const receipt = await evaluate(socket, `${VOLUME_PROTOTYPE_EXPRESSION}.writeDebugFullFieldImportChunk(${JSON.stringify({
      sessionId,
      kind,
      byteOffset,
      base64: chunk.toString('base64'),
    })})`);
    assert.equal(receipt?.ok, true, `${kind} field upload failed at ${byteOffset}`);
    assert.equal(receipt.byteOffset, byteOffset, `${kind} field upload offset drifted`);
    byteOffset += chunk.byteLength;
  }
}

function validateInputs() {
  assert.equal(sourceFieldManifest.schema, 'kaminos.volume.full-grid-field-export.v0', 'source field manifest schema drifted');
  assert.equal(sourceFieldManifest.status, 'captured', 'source field manifest is incomplete');
  assert.equal(sourceFieldManifest.completeFieldCoverage, true, 'source field manifest is partial');
  assert.equal(sourceFieldManifest.grid, 160, 'source field grid differs from required 160^3 contract');
  assert.equal(sourceManifestSha256, baselineOverlayManifest.source?.state?.sourceManifestSha256, 'baseline overlay source manifest differs');
  assert.equal(sourceManifestSha256, flowOverlayManifest.source?.state?.sourceManifestSha256, 'flow overlay source manifest differs');
  assert.deepEqual(baselineOverlayManifest.source?.state?.sourceHashes, sourceHashes, 'baseline overlay source hashes differ');
  assert.deepEqual(flowOverlayManifest.source?.state?.sourceHashes, sourceHashes, 'flow overlay source hashes differ');
  assert.equal(baselineOverlayManifest.source?.state?.admissionIndexSha256, flowOverlayManifest.source?.state?.admissionIndexSha256, 'overlay populations differ');
  assert.match(expectedSource.admissionIndexSha256 || '', /^[0-9a-f]{64}$/, 'overlay admission population checksum is missing');
  for (const path of [
    sourceFieldManifest.sidecars?.fluid?.path,
    sourceFieldManifest.sidecars?.front?.path,
    sourceFieldManifest.boundarySidecar?.sidecars?.boundary?.path,
    sourceFieldManifest.sidecars?.majorant?.path,
  ]) assert.ok(path && existsSync(path), `source sidecar is missing: ${path}`);
}

function sourceHashesFromManifest(manifest) {
  return {
    fluidSha256: manifest.sidecars.fluid.sha256,
    frontSha256: manifest.sidecars.front.sha256,
    boundarySidecarSha256: manifest.boundarySidecar.sidecars.boundary.sha256,
    majorantSha256: manifest.sidecars.majorant.sha256,
  };
}

function requiredPath(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`missing ${name}`);
  const path = resolve(String(value));
  if (!existsSync(path)) throw new Error(`missing ${name} file: ${path}`);
  return path;
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) values.set(key, true);
    else {
      values.set(key, next);
      index += 1;
    }
  }
  return values;
}

function normalizeProjectedWorkTargetPixels(value) {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error(`invalid --projected-work-target-pixels: ${value}`);
  if (numeric === 0) return 0;
  return Math.max(1, Math.min(1_000_000, Math.round(numeric)));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function chromeExecutable() {
  const candidates = [
    process.env.KAMINOS_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

async function startServer() {
  const httpServer = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const mount = mounts.find(candidate => pathname.startsWith(candidate.prefix));
      if (!mount) return send(response, 404, 'mount not found');
      let suffix = pathname.slice(mount.prefix.length);
      if (!suffix || suffix.endsWith('/')) suffix += 'index.html';
      const path = resolve(mount.root, suffix);
      const root = resolve(mount.root);
      if (path !== root && !path.startsWith(`${root}${sep}`)) return send(response, 403, 'path traversal rejected');
      if (!existsSync(path) || !statSync(path).isFile()) return send(response, 404, 'file not found');
      response.writeHead(200, {
        'Content-Type': contentType(path),
        'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      });
      createReadStream(path).pipe(response);
    } catch (error) {
      send(response, 500, error?.message || String(error));
    }
  });
  await new Promise((resolveListen, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(0, '127.0.0.1', resolveListen);
  });
  return httpServer;
}

function send(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(`${message}\n`);
}

function contentType(path) {
  return ({
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.wasm': 'application/wasm',
    '.f32': 'application/octet-stream',
    '.u32': 'application/octet-stream',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  })[extname(path).toLowerCase()] || 'application/octet-stream';
}

function compactFrozenRenderExpression(renderOptions) {
  return `(async () => {
    const render = await ${VOLUME_PROTOTYPE_EXPRESSION}.renderFrozenScaleToCanvas(${JSON.stringify(renderOptions)});
    const capture = render?.rgbaCapture;
    if (!capture?.rgba) return render;
    const rgba = Uint8ClampedArray.from(capture.rgba);
    const surface = new OffscreenCanvas(capture.width, capture.height);
    const context = surface.getContext('2d', { alpha: true });
    if (!context) throw new Error('exact-rgba-png-context-unavailable');
    context.putImageData(new ImageData(rgba, capture.width, capture.height), 0, 0);
    const blob = await surface.convertToBlob({ type: 'image/png' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + 32768)));
    }
    return {
      ...render,
      rgbaCapture: {
        ...capture,
        rgba: null,
        rgbaByteLength: rgba.byteLength,
        pngBase64: btoa(binary),
      },
    };
  })()`;
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(entry => entry.type === 'page' && !String(entry.url).startsWith('chrome-extension://'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    try {
      last = await evaluate(cdp, `(() => {
        const prototype = ${VOLUME_PROTOTYPE_EXPRESSION};
        const state = prototype?.debugState?.() || null;
        return state ? {
          active: state.active,
          backend: state.backend,
          error: state.error,
          effectiveRoute: state.effectiveRoute,
          prototypeIdentity: state.prototypeIdentity,
          grid: state.simGrid,
          frameCount: state.frameCount,
          requiredApis: Boolean(
            prototype.beginDebugFullFieldImport
            && prototype.writeDebugFullFieldImportChunk
            && prototype.finishDebugFullFieldImport
            && prototype.renderFrozenScaleToCanvas
            && prototype.auditBoundarySplatLiveUnionSourceHashes
            && prototype.loadBoundarySplatLiveUnionCoefficientOverlay
            && prototype.auditBoundarySplatLiveUnionCoefficientOverlayPopulation
            && prototype.sampleBoundarySplatGpuProfile
          ),
        } : null;
      })()`);
    } catch (error) {
      last = { error: error?.message || String(error) };
      await delay(250);
      continue;
    }
    if (last?.error) throw new Error(`volume runtime reported error: ${last.error}`);
    if (last?.active && last.requiredApis && String(last.backend).startsWith('WebGPU') && last.frameCount > 3) return last;
    await delay(250);
  }
  throw new Error(`volume runtime did not become active: ${JSON.stringify(last)}`);
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    const detail = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || 'runtime evaluation failed';
    throw new Error(`${detail}\nExpression: ${expression}`);
  }
  return result.result.value;
}

function summarizeBrowserEvent(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return { method: event.method, text: details.exception?.description || details.text || null, url: details.url || null };
  }
  if (event.method === 'Log.entryAdded') {
    return { method: event.method, level: event.params?.entry?.level || null, text: event.params?.entry?.text || null, url: event.params?.entry?.url || null };
  }
  return {
    method: event.method,
    type: event.params?.type || null,
    args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null),
  };
}

function artifact(path) {
  const bytes = readFileSync(path);
  return {
    path: relative(process.cwd(), path),
    byteLength: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

function compactCondition(condition) {
  return {
    label: condition.label,
    image: condition.image?.path || null,
    litPixelRatio: condition.metrics?.litPixelRatio ?? null,
    meanLuma: condition.metrics?.meanLuma ?? null,
    effectiveOverlayIdentity: condition.overlay?.effectiveOverlayIdentity ?? null,
    stableNativeCellIdSha256: condition.populationAudit?.stableNativeCellIdSha256 ?? null,
    candidateCount: condition.populationAudit?.candidateCount ?? null,
  };
}

function writeReport(report) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function pngPixelMetrics(png) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.subarray(0, 8).compare(signature), 0, 'capture is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressed = [];
  while (offset + 12 <= png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      assert.equal(data[12], 0, 'interlaced PNG is unsupported');
    } else if (type === 'IDAT') compressed.push(data);
    else if (type === 'IEND') break;
    offset += length + 12;
  }
  assert.equal(bitDepth, 8, 'capture PNG must be 8-bit');
  assert.ok(colorType === 2 || colorType === 6, `unsupported PNG color type: ${colorType}`);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const encoded = inflateSync(Buffer.concat(compressed));
  assert.equal(encoded.length, height * (stride + 1), 'capture PNG is partial');
  let prior = Buffer.alloc(stride);
  let litPixels = 0;
  let lumaSum = 0;
  let maxLuma = 0;
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    const filter = encoded[rowStart];
    const row = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const raw = encoded[rowStart + 1 + x];
      const left = x >= channels ? row[x - channels] : 0;
      const up = prior[x] || 0;
      const upLeft = x >= channels ? prior[x - channels] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paeth(left, up, upLeft);
      else assert.equal(filter, 0, `unsupported PNG filter: ${filter}`);
      row[x] = value & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const luma = 0.2126 * row[x] + 0.7152 * row[x + 1] + 0.0722 * row[x + 2];
      if (luma > 8) litPixels += 1;
      lumaSum += luma;
      maxLuma = Math.max(maxLuma, luma);
    }
    prior = row;
  }
  const pixelCount = width * height;
  return {
    width,
    height,
    pixelCount,
    litPixels,
    litPixelRatio: litPixels / Math.max(1, pixelCount),
    meanLuma: lumaSum / Math.max(1, pixelCount),
    maxLuma,
    nonblank: litPixels > 64,
  };
}

function paeth(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}
