#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const SCHEMA = 'kaminos.volume.projected-area-optical-unit-witness.v0';
const STATE_ID = 'coefficient-state-120';
const COHORT_SHA256 = '4a93aeefe7eebec06f039dd35bd2947e4e76f292eadd7b7719e02235d062ac20';
const PHYSICAL_MODE = 'projected-native-cell-area-integral-normalized-v0';
const LEGACY_MODE = 'legacy-global-path-scale-diagnostic-v0';
const HISTORICAL_DEPOSITION_MODE = 'flow-kernel-moment-gaussian-raster-v0';
const HISTORICAL_GAUSSIAN_GEOMETRY_IDENTITY = 'persistent-cohort-historical-round-base-radius-v0';
const HISTORICAL_SPLAT_MODE = 'learned';
const HISTORICAL_SPLAT_RADIUS = 0.98;
const HISTORICAL_SPLAT_SHARPNESS = 12;
const HISTORICAL_RENDERER_IDENTITY = 'live-boundary-sidecar-learned-attribute-splats-v0';
const HISTORICAL_FOOTPRINT_AUTHORITY = 'learned-camera-facing-billboard-v0';
const HISTORICAL_ATTRIBUTE_MODEL_IDENTITY = 'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472';
const HISTORICAL_OPTICAL_SOURCE_AUTHORITY = 'authenticated-persistent-sparse-cohort-gpu-source-v0';
const RAYMARCH_TARGET_SHA256 = 'c8dc4dc0ab4b324a872989adf112cb5a87cf9e3083115fa5489615b2397e2dc7';
const RAYMARCH_TARGET_RAW_PIXEL_SHA256 = 'f19fbd6489c935dde37bc6c0c82bf1fe9b438a0f0b3a64b8cfa43ed8c221f58f';
const TARGET_PROJECTION_MATRIX = Object.freeze([
  2.9306425807515972, 0, 0, 0,
  0, 2.7474774194546225, 0, 0,
  0, 0, -1.0002000200020003, -1,
  0, 0, -0.020002000200020003, 0,
]);
const CAMERA = Object.freeze({
  position: [1.1799999999999993, 0.28, 2.049999999999998],
  target: [0, 0.02, 0],
});

class CdpSocket {
  constructor(url, callTimeoutMs) {
    this.url = url;
    this.callTimeoutMs = callTimeoutMs;
    this.socket = null;
    this.nextId = 1;
    this.pending = new Map();
    this.browserEvents = [];
  }

  open() {
    return new Promise((resolveOpen, rejectOpen) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', rejectOpen, { once: true });
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
    return new Promise((resolveCall, rejectCall) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rejectCall(new Error(`CDP call timed out: ${method}`));
      }, this.callTimeoutMs);
      this.pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
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
const repoRoot = resolve(String(args.get('--repo-root') || import.meta.dirname));
const origin = String(args.get('--origin') || 'http://127.0.0.1:18823');
const cohortManifestPath = resolve(String(
  args.get('--cohort-manifest')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-persistent-sparse-cohort-r1/cohort-manifest.json',
));
const sourceCaptureReportPath = resolve(String(
  args.get('--source-capture-report')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-layer-coefficient-corpus-r4/capture-report.json',
));
const raymarchTargetPath = resolve(String(
  args.get('--raymarch-target')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-exact-bilinear-motion-r4/render/images/coefficient-state-120-target.png',
));
const raymarchTargetReportPath = resolve(String(
  args.get('--raymarch-target-report')
    || '/Users/noahlyons/.local/state/gpu-greenroom/outputs/kaminos-tiger-exact-bilinear-motion-r4/render-report.json',
));
const outputDirectory = resolve(String(
  args.get('--output')
    || '/tmp/kaminos-projected-area-optical-unit-witness',
));
const reportPath = join(outputDirectory, 'report.json');
const raymarchTargetOutputPath = join(outputDirectory, 'raymarch-target.png');
const timeoutMs = Number(args.get('--timeout-ms') || 900_000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const browserProfilePath = `/tmp/kaminos-projected-area-optical-unit-witness-${process.pid}-${Date.now()}`;
const mountSlug = `projected-area-optical-unit-witness-${process.pid}`;
const mountRoot = join(repoRoot, 'scratch', mountSlug);
const cohortMount = join(mountRoot, 'cohort');

mkdirSync(outputDirectory, { recursive: true });
mkdirSync(mountRoot, { recursive: true });

let failurePhase = 'input-admission';
let browser = null;
let socket = null;
let lastTrustworthyEvidence = {
  schema: SCHEMA,
  stateId: STATE_ID,
  cohortManifestPath,
  sourceCaptureReportPath,
  raymarchTargetPath,
  raymarchTargetReportPath,
};
const startedAt = new Date().toISOString();

try {
  assert.equal(existsSync(cohortManifestPath), true, 'cohort manifest is missing');
  assert.equal(existsSync(sourceCaptureReportPath), true, 'source capture report is missing');
  assert.equal(existsSync(raymarchTargetPath), true, 'Raymarch target image is missing');
  assert.equal(existsSync(raymarchTargetReportPath), true, 'Raymarch target report is missing');
  const cohortSha256 = sha256File(cohortManifestPath);
  assert.equal(cohortSha256, COHORT_SHA256, 'cohort manifest checksum drifted');
  const raymarchTargetSha256 = sha256File(raymarchTargetPath);
  assert.equal(raymarchTargetSha256, RAYMARCH_TARGET_SHA256, 'Raymarch target image checksum drifted');
  const raymarchTargetReport = readJson(raymarchTargetReportPath);
  const raymarchTargetState = raymarchTargetReport.states?.find(state => state.stateId === STATE_ID);
  assert.ok(raymarchTargetState, 'Raymarch target report omitted state 120');
  assert.equal(
    raymarchTargetState.targetPixelSha256,
    RAYMARCH_TARGET_RAW_PIXEL_SHA256,
    'Raymarch target raw-pixel checksum drifted',
  );
  assert.equal(
    resolve(raymarchTargetState.images?.target || ''),
    raymarchTargetPath,
    'Raymarch target report points at a different image',
  );
  copyFileSync(raymarchTargetPath, raymarchTargetOutputPath);
  ensureMount(cohortMount, dirname(cohortManifestPath));

  const route = buildRoute({
    origin,
    sourceCaptureReport: readJson(sourceCaptureReportPath),
    cohortManifestPath: `/scratch/${mountSlug}/cohort/${cohortManifestPath.split('/').pop()}`,
  });
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    requestedRoute: route.href,
    effectiveRoute: null,
    cohortSha256,
    raymarchTarget: {
      sourcePath: raymarchTargetPath,
      screenshotPath: raymarchTargetOutputPath,
      sha256: raymarchTargetSha256,
      rawPixelSha256: raymarchTargetState.targetPixelSha256,
    },
  };

  failurePhase = 'browser-launch';
  browser = spawn(chromeExecutable(), [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfilePath}`,
    '--window-size=1668,960',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, timeoutMs, browser);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: 1668,
    height: 960,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: route.href });

  failurePhase = 'runtime-admission';
  const runtime = await waitForValue(socket, timeoutMs, `(() => {
    const host = document.querySelector('#basin')?.contentWindow || window;
    const prototype = host.__kaminosVolumePrototype;
    const state = prototype?.debugState?.();
    if (!state?.active || !String(state.backend || '').startsWith('WebGPU')) return null;
    return {
      href: location.href,
      effectiveRoute: state.effectiveRoute,
      backend: state.backend,
      grid: state.simGrid,
      prototypeIdentity: state.prototypeIdentity,
    };
  })()`);
  assert.equal(runtime.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0', 'effective renderer route was substituted');
  assert.match(runtime.backend, /^WebGPU:/, 'effective backend was substituted');
  assert.equal(runtime.grid, 160, 'native grid was substituted');
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, effectiveRoute: runtime.effectiveRoute, runtime };

  failurePhase = 'cohort-admission';
  const cohort = await evaluate(socket, `(async () => {
    const host = document.querySelector('#basin')?.contentWindow || window;
    const prototype = host.__kaminosVolumePrototype;
    if (!prototype?.sampleBoundarySplatOpticalUnitProbe) throw new Error('projected-area-optical-unit-probe-api-missing');
    const receipt = await host.__kaminosBootstrapPersistentSparseCohort();
    if (receipt?.status !== 'effective') {
      throw new Error('persistent-cohort-admission-failed:' + JSON.stringify(receipt));
    }
    const HISTORICAL_DEPOSITION_MODE = ${JSON.stringify(HISTORICAL_DEPOSITION_MODE)};
    prototype.setControls({
      boundarySplatMode: ${JSON.stringify(HISTORICAL_SPLAT_MODE)},
      boundarySplatRadius: ${HISTORICAL_SPLAT_RADIUS},
      boundarySplatSharpness: ${HISTORICAL_SPLAT_SHARPNESS},
    });
    const deposition = prototype.setFullSupportDepositionMode(HISTORICAL_DEPOSITION_MODE);
    const camera = host.kaminosSetCameraDebugPose(${JSON.stringify(CAMERA)});
    const composition = prototype.setSelectiveHeadLiveRenderComposition('splat-only-v0');
    const pause = prototype.setSelectiveHeadLiveCapturePaused(true);
    const state = prototype.debugState();
    return { receipt, deposition, camera, composition, pause, state: {
      simStepCount: state.simStepCount,
      frameCount: state.frameCount,
      cameraSignature: state.cameraSignature,
      backend: state.backend,
      effectiveRoute: state.effectiveRoute,
      boundarySplatMode: state.boundarySplatMode,
      boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
      boundarySplatAttributeModelIdentity: state.boundarySplatAttributeModelIdentity,
      boundarySplatSourceAuthority: state.boundarySplatSourceAuthority,
      boundarySplatFootprintAuthority: state.boundarySplatFootprintAuthority,
      boundarySplatRadius: state.boundarySplatRadius,
      boundarySplatSharpness: state.boundarySplatSharpness,
      fullSupportDepositionRequested: state.fullSupportDepositionRequested,
    }};
  })()`);
  assert.equal(cohort.receipt.stateId, STATE_ID, 'persistent cohort state was substituted');
  assert.equal(cohort.receipt.effectiveManifestSha256, COHORT_SHA256, 'persistent cohort checksum was substituted');
  assert.equal(cohort.receipt.fallbackUsed, false, 'persistent cohort fallback looked authoritative');
  assert.equal(cohort.receipt.rendererApplied, true, 'persistent cohort renderer did not apply');
  assert.equal(cohort.pause.paused, true, 'same-state capture pause did not apply');
  assert.equal(cohort.deposition.normalized, HISTORICAL_DEPOSITION_MODE, 'historical deposition request was normalized away');
  assert.equal(cohort.deposition.fallbackReason, null, 'historical deposition request used fallback');
  assert.equal(cohort.state.boundarySplatMode, HISTORICAL_SPLAT_MODE, 'historical splat mode was substituted');
  assert.equal(cohort.state.boundarySplatRendererIdentity, HISTORICAL_RENDERER_IDENTITY, 'historical renderer was substituted');
  assert.equal(cohort.state.boundarySplatAttributeModelIdentity, HISTORICAL_ATTRIBUTE_MODEL_IDENTITY, 'historical attributes were substituted');
  assert.equal(cohort.state.boundarySplatSourceAuthority, HISTORICAL_OPTICAL_SOURCE_AUTHORITY, 'authenticated optical source was substituted');
  assert.equal(cohort.state.boundarySplatFootprintAuthority, HISTORICAL_FOOTPRINT_AUTHORITY, 'historical covariance was substituted');
  assert.equal(cohort.state.boundarySplatRadius, HISTORICAL_SPLAT_RADIUS, 'historical radius was substituted');
  assert.equal(cohort.state.boundarySplatSharpness, HISTORICAL_SPLAT_SHARPNESS, 'historical sharpness was substituted');
  assert.equal(cohort.state.fullSupportDepositionRequested, HISTORICAL_DEPOSITION_MODE, 'historical deposition request did not stick');
  assertArrayNearlyEqual(
    cohort.camera.projectionMatrix,
    TARGET_PROJECTION_MATRIX,
    1e-12,
    'target camera projection was substituted',
  );
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, cohort };

  const sameStateCaptureId = `projected-area-optical-units-${STATE_ID}-${Date.now()}`;
  assert.ok(sameStateCaptureId, 'same-state-capture-id is missing');
  const fixedNow = 1_234_567;
  const armDefinitions = [
    { id: 'legacy-raw-scale-1', opticalUnitMode: LEGACY_MODE, opticalPathScale: 1 },
    { id: 'projected-area-physical', opticalUnitMode: PHYSICAL_MODE, opticalPathScale: 1 },
  ];
  const arms = [];
  for (const definition of armDefinitions) {
    failurePhase = `capture-${definition.id}`;
    const arm = await evaluate(socket, `(async () => {
      const host = document.querySelector('#basin')?.contentWindow || window;
      const prototype = host.__kaminosVolumePrototype;
      const probe = await prototype.sampleBoundarySplatOpticalUnitProbe(${JSON.stringify({
        opticalUnitMode: definition.opticalUnitMode,
        opticalPathScale: definition.opticalPathScale,
        sameStateCaptureId,
        now: fixedNow,
        requestedRoute: route.href,
      })});
      const canvas = await prototype.renderFrozenScaleToCanvas({
        boundarySplatComposition: 'splat-only-v0',
        sameStateCaptureId: ${JSON.stringify(sameStateCaptureId)},
        baseFrameCount: probe.baseFrameCount,
        baseSimStepCount: probe.baseSimStepCount,
        now: ${fixedNow},
        includeRgba: false,
      });
      const state = prototype.debugState();
      const rect = prototype.canvasElement().getBoundingClientRect().toJSON();
      return {
        probe,
        canvas: {
          ok: canvas.ok,
          reason: canvas.reason || null,
          raymarchEncoded: canvas.raymarchEncoded,
          splatEncoded: canvas.splatEncoded,
          raymarchApplied: canvas.raymarchApplied,
          splatApplied: canvas.splatApplied,
          fallbackReason: canvas.boundarySplatFallbackReason || null,
          boundarySplatMode: canvas.boundarySplatMode,
          boundarySplatRendererIdentity: canvas.boundarySplatRendererIdentity,
          boundarySplatAttributeModelIdentity: canvas.boundarySplatAttributeModelIdentity,
          boundarySplatSourceAuthority: canvas.boundarySplatSourceAuthority,
          boundarySplatRadius: canvas.boundarySplatRadius,
          boundarySplatSharpness: canvas.boundarySplatSharpness,
          fullSupportDepositionRequested: canvas.fullSupportDepositionRequested,
          fullSupportDepositionEffective: canvas.fullSupportDepositionEffective,
          fullSupportDepositionFallbackReason: canvas.fullSupportDepositionFallbackReason || null,
          fullSupportGaussianGeometryIdentity: canvas.fullSupportGaussianGeometryIdentity,
          fullSupportSourceCandidateCount: canvas.fullSupportSourceCandidateCount,
          fullSupportRasterDepositCount: canvas.fullSupportRasterDepositCount,
          presentationReceipt: canvas.boundarySplatPresentationReceipt,
        },
        rect,
        finalState: {
          simStepCount: state.simStepCount,
          cameraSignature: state.cameraSignature,
          effectiveRoute: state.effectiveRoute,
          backend: state.backend,
          boundarySplatFootprintAuthority: state.boundarySplatFootprintAuthority,
          boundarySplatAttributeSetId: state.boundarySplatAttributeSetId,
          fullSupportSourceCandidateCount: state.fullSupportSourceCandidateCount,
          fullSupportRasterDepositCount: state.fullSupportRasterDepositCount,
          fullSupportDepositionReceipt: state.fullSupportDepositionReceipt,
        },
      };
    })()`);
    assert.equal(arm.probe.status, 'captured', `${definition.id} probe did not capture`);
    assert.equal(arm.probe.sourceStateId, STATE_ID, `${definition.id} source state drifted`);
    assert.equal(arm.probe.sameStateCaptureId, sameStateCaptureId, `${definition.id} same-state identity drifted`);
    assert.equal(arm.probe.requestedOpticalUnitMode, definition.opticalUnitMode, `${definition.id} request drifted`);
    assert.equal(arm.probe.effectiveOpticalUnitMode, definition.opticalUnitMode, `${definition.id} mode was substituted`);
    assert.equal(arm.probe.fallbackUsed, false, `${definition.id} used fallback`);
    assert.equal(arm.canvas.ok, true, `${definition.id} canvas render failed: ${arm.canvas.reason}`);
    assert.equal(arm.canvas.splatEncoded, true, `${definition.id} splat pass was not encoded`);
    assert.equal(arm.canvas.splatApplied, true, `${definition.id} splat pass was not applied`);
    assert.equal(arm.canvas.fallbackReason, null, `${definition.id} canvas used fallback`);
    assert.equal(arm.canvas.boundarySplatMode, HISTORICAL_SPLAT_MODE, `${definition.id} historical splat mode drifted`);
    assert.equal(
      arm.canvas.boundarySplatRendererIdentity,
      HISTORICAL_RENDERER_IDENTITY,
      `${definition.id} historical renderer identity drifted`,
    );
    assert.equal(
      arm.canvas.boundarySplatAttributeModelIdentity,
      HISTORICAL_ATTRIBUTE_MODEL_IDENTITY,
      `${definition.id} historical attribute identity drifted`,
    );
    assert.equal(
      arm.canvas.boundarySplatSourceAuthority,
      HISTORICAL_OPTICAL_SOURCE_AUTHORITY,
      `${definition.id} authenticated optical source drifted`,
    );
    assert.equal(
      arm.finalState.boundarySplatFootprintAuthority,
      HISTORICAL_FOOTPRINT_AUTHORITY,
      `${definition.id} historical covariance authority drifted`,
    );
    assert.equal(arm.canvas.boundarySplatRadius, HISTORICAL_SPLAT_RADIUS, `${definition.id} historical radius drifted`);
    assert.equal(arm.canvas.boundarySplatSharpness, HISTORICAL_SPLAT_SHARPNESS, `${definition.id} historical sharpness drifted`);
    assert.equal(
      arm.canvas.fullSupportDepositionRequested,
      HISTORICAL_DEPOSITION_MODE,
      `${definition.id} historical deposition request drifted`,
    );
    assert.equal(
      arm.canvas.fullSupportDepositionEffective,
      HISTORICAL_DEPOSITION_MODE,
      `${definition.id} historical deposition was substituted`,
    );
    assert.equal(
      arm.canvas.fullSupportDepositionFallbackReason,
      null,
      `${definition.id} historical deposition used fallback`,
    );
    assert.equal(
      arm.canvas.fullSupportGaussianGeometryIdentity,
      HISTORICAL_GAUSSIAN_GEOMETRY_IDENTITY,
      `${definition.id} historical round Gaussian geometry was substituted`,
    );
    assert.equal(
      arm.canvas.fullSupportSourceCandidateCount,
      arm.probe.population.candidates,
      `${definition.id} source candidate accounting drifted`,
    );
    assert.equal(
      arm.canvas.fullSupportRasterDepositCount,
      arm.probe.population.candidates,
      `${definition.id} raster was not one deposit per candidate`,
    );
    assert.ok(arm.probe.beauty.litPixels > 64, `${definition.id} Beauty output was blank`);
    assert.ok(arm.probe.linearHdr.litPixels > 64, `${definition.id} linear HDR output was blank`);
    assert.ok(arm.probe.emissionOnlyLinearLuma > 0, `${definition.id} emission-only linear luma was blank`);
    assert.ok(arm.probe.extinctionOnlyMeanOpacity > 0, `${definition.id} extinction-only mean opacity was blank`);
    assert.ok(arm.probe.combinedLinearLuma > 0, `${definition.id} combined linear luma was blank`);
    assert.equal(
      arm.probe.kernelIntegral.effectiveDepositionPath,
      HISTORICAL_DEPOSITION_MODE,
      `${definition.id} kernel receipt describes the wrong deposition path`,
    );
    assert.equal(
      arm.probe.kernelIntegral.integralAuthority,
      'analytical-construction-not-gpu-measured-v0',
      `${definition.id} kernel normalization authority was overstated`,
    );
    assert.equal(arm.probe.route.requestedRoute, route.href, `${definition.id} requested route drifted`);
    assert.equal(arm.finalState.simStepCount, cohort.state.simStepCount, `${definition.id} state drifted`);
    assert.equal(arm.finalState.cameraSignature, cohort.state.cameraSignature, `${definition.id} camera-drift`);
    assert.equal(arm.rect.width, 900, `${definition.id} target render width drifted`);
    assert.equal(arm.rect.height, 960, `${definition.id} target render height drifted`);
    await evaluate(socket, `(async () => {
      const toolbar = document.querySelector('#toolbar');
      if (toolbar) {
        toolbar.hidden = true;
        toolbar.style.setProperty('display', 'none', 'important');
        toolbar.style.setProperty('visibility', 'hidden', 'important');
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        toolbarHidden: !toolbar || toolbar.hidden,
        toolbarDisplay: toolbar ? getComputedStyle(toolbar).display : null,
      };
    })()`);
    const screenshotPath = join(outputDirectory, `${definition.id}.png`);
    await captureScreenshot(socket, arm.rect, screenshotPath);
    assert.ok(readFileSync(screenshotPath).byteLength > 1024, `${definition.id} screenshot was blank`);
    const reportedProbe = {
      ...arm.probe,
      population: {
        sourceCandidates: arm.probe.population.candidates,
        sourceManifestAccounting: {
          requestedChargedDeposits: arm.probe.population.requestedDeposits,
          appliedChargedDeposits: arm.probe.population.appliedDeposits,
          rowCap: arm.probe.population.rowCap,
          selectorRerun: arm.probe.population.selectorRerun,
        },
        effectiveRasterAccounting: {
          sourceCandidateCount: arm.canvas.fullSupportSourceCandidateCount,
          rasterDepositCount: arm.canvas.fullSupportRasterDepositCount,
          depositsPerCandidate:
            arm.canvas.fullSupportRasterDepositCount / arm.canvas.fullSupportSourceCandidateCount,
          depositionIdentity: arm.canvas.fullSupportDepositionEffective,
        },
      },
    };
    arms.push({ id: definition.id, screenshotPath, ...arm, probe: reportedProbe });
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, arms };
  }

  failurePhase = 'same-state-comparison';
  assert.equal(arms[0].probe.capturedSimStepCount, arms[1].probe.capturedSimStepCount, 'same-state arms drifted');
  assert.equal(arms[0].probe.cameraSignature, arms[1].probe.cameraSignature, 'same-camera arms drifted');
  assert.equal(
    arms[0].probe.population.sourceCandidates,
    arms[1].probe.population.sourceCandidates,
    'candidate population drifted',
  );
  assert.equal(arms[0].probe.depositionPayload.width, arms[1].probe.depositionPayload.width, 'render width drifted');
  assert.equal(arms[0].probe.depositionPayload.height, arms[1].probe.depositionPayload.height, 'render height drifted');
  const legacyArm = arms.find(arm => arm.id === 'legacy-raw-scale-1');
  const physicalArm = arms.find(arm => arm.id === 'projected-area-physical');
  assert.ok(legacyArm && physicalArm, 'fixed discriminator arms are incomplete');
  const relativeDelta = (left, right) => (
    Math.abs(left - right) / Math.max(Math.abs(left), Math.abs(right), 1e-12)
  );
  const emissionRelativeDelta = relativeDelta(
    physicalArm.probe.emissionOnlyLinearLuma,
    legacyArm.probe.emissionOnlyLinearLuma,
  );
  const extinctionRelativeDelta = relativeDelta(
    physicalArm.probe.extinctionOnlyMeanOpacity,
    legacyArm.probe.extinctionOnlyMeanOpacity,
  );
  const combinedRelativeDelta = relativeDelta(
    physicalArm.probe.combinedLinearLuma,
    legacyArm.probe.combinedLinearLuma,
  );
  const maximumComponentRelativeDelta = Math.max(
    emissionRelativeDelta,
    extinctionRelativeDelta,
  );
  assert.ok(
    maximumComponentRelativeDelta > 0.05,
    'physical and legacy component arms are materially identical',
  );
  assert.ok(
    combinedRelativeDelta > 0.05,
    'physical and legacy combined arms are materially identical',
  );

  const report = {
    schema: SCHEMA,
    status: 'passed',
    failurePhase: null,
    startedAt,
    finishedAt: new Date().toISOString(),
    requestedRoute: route.href,
    effectiveRoute: runtime.effectiveRoute,
    backend: runtime.backend,
    stateId: STATE_ID,
    sameStateCaptureId,
    cohortManifest: {
      path: cohortManifestPath,
      sha256: COHORT_SHA256,
      appliedRows: cohort.receipt.appliedRowCount,
      producerChargedDeposits: cohort.receipt.appliedDepositCount,
    },
    raymarchTarget: {
      stateId: STATE_ID,
      screenshotPath: raymarchTargetOutputPath,
      sourcePath: raymarchTargetPath,
      sourceReportPath: raymarchTargetReportPath,
      sha256: raymarchTargetSha256,
      rawPixelSha256: raymarchTargetState.targetPixelSha256,
      width: 900,
      height: 960,
      meanLinearLuma: raymarchTargetState.metrics?.targetMeanLuma ?? null,
      projectionMatrix: TARGET_PROJECTION_MATRIX,
      authority: 'authenticated-same-state-raymarch-target-v0',
    },
    effectiveGeometry: {
      depositionIdentity: HISTORICAL_DEPOSITION_MODE,
      gaussianGeometryIdentity: arms[0].canvas.fullSupportGaussianGeometryIdentity,
      sourceCandidateCount: arms[0].canvas.fullSupportSourceCandidateCount,
      rasterDepositCount: arms[0].canvas.fullSupportRasterDepositCount,
      depositsPerCandidate: arms[0].canvas.fullSupportRasterDepositCount / arms[0].canvas.fullSupportSourceCandidateCount,
      covarianceAuthority: arms[0].finalState.boundarySplatFootprintAuthority,
      rendererIdentity: arms[0].canvas.boundarySplatRendererIdentity,
      attributeModelIdentity: arms[0].canvas.boundarySplatAttributeModelIdentity,
      opticalSourceAuthority: arms[0].canvas.boundarySplatSourceAuthority,
      attributeSetId: arms[0].finalState.boundarySplatAttributeSetId,
      radius: arms[0].canvas.boundarySplatRadius,
      sharpness: arms[0].canvas.boundarySplatSharpness,
      presentationIdentity: arms[0].canvas.presentationReceipt?.effectiveMode || null,
    },
    camera: cohort.camera,
    arms,
    comparison: {
      stateAndCameraIdentical: true,
      discriminatorThreshold: {
        identity: 'fixed-state-material-relative-delta-v0',
        minimumRelativeDelta: 0.05,
        directionalExpectation: false,
        emissionPassed: emissionRelativeDelta > 0.05,
        extinctionPassed: extinctionRelativeDelta > 0.05,
        componentDiscriminatorPassed: maximumComponentRelativeDelta > 0.05,
        combinedPassed: combinedRelativeDelta > 0.05,
      },
      emissionOnlyLinearLumaRelativeDelta: emissionRelativeDelta,
      extinctionOnlyMeanOpacityRelativeDelta: extinctionRelativeDelta,
      combinedLinearLumaRelativeDelta: combinedRelativeDelta,
      maximumComponentRelativeDelta,
      emissionOnlyLinearLumaRatio: arms[1].probe.emissionOnlyLinearLuma / arms[0].probe.emissionOnlyLinearLuma,
      extinctionOnlyMeanOpacityRatio: arms[1].probe.extinctionOnlyMeanOpacity / arms[0].probe.extinctionOnlyMeanOpacity,
      combinedLinearLumaRatio: arms[1].probe.combinedLinearLuma / arms[0].probe.combinedLinearLuma,
    },
    browserEvents: socket.browserEvents,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, reportPath, arms: report.arms.map(arm => ({
    id: arm.id,
    screenshotPath: arm.screenshotPath,
    emissionOnlyLinearLuma: arm.probe.emissionOnlyLinearLuma,
    extinctionOnlyMeanOpacity: arm.probe.extinctionOnlyMeanOpacity,
    combinedLinearLuma: arm.probe.combinedLinearLuma,
    kernelIntegral: arm.probe.kernelIntegral,
  })) }, null, 2));
} catch (error) {
  const report = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    reason: error?.message || String(error),
    startedAt,
    finishedAt: new Date().toISOString(),
    lastTrustworthyEvidence,
    browserExitCode: browser?.exitCode ?? null,
    browserEvents: socket?.browserEvents || [],
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

function buildRoute({ origin: routeOrigin, sourceCaptureReport, cohortManifestPath: manifestPath }) {
  const source = new URL(sourceCaptureReport.requestedRoute);
  const route = new URL(source.pathname, routeOrigin);
  for (const [key, value] of source.searchParams.entries()) route.searchParams.set(key, value);
  route.searchParams.set('kaminos_volume_smoke', '1');
  route.searchParams.set('volume_resolution', '160');
  route.searchParams.set('volume_render_scale', '1');
  route.searchParams.set('composition', 'splat-only-v0');
  route.searchParams.set('volume_raymarch_smoke', 'off');
  route.searchParams.set('volume_boundary_splat_mode', HISTORICAL_SPLAT_MODE);
  route.searchParams.set('volume_boundary_splat_radius', String(HISTORICAL_SPLAT_RADIUS));
  route.searchParams.set('volume_boundary_splat_sharpness', String(HISTORICAL_SPLAT_SHARPNESS));
  route.searchParams.set('volume_optical_unit_mode', LEGACY_MODE);
  route.searchParams.set('full_support_persistent_cohort_manifest', manifestPath);
  route.searchParams.set('full_support_persistent_cohort_manifest_sha256', COHORT_SHA256);
  route.searchParams.set('full_support_persistent_cohort_state', STATE_ID);
  return route;
}

async function captureScreenshot(cdp, rect, path) {
  const clip = {
    x: Math.max(0, Number(rect.x) || 0),
    y: Math.max(0, Number(rect.y) || 0),
    width: Math.max(1, Number(rect.width) || 1),
    height: Math.max(1, Number(rect.height) || 1),
    scale: 1,
  };
  const screenshot = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  writeFileSync(path, Buffer.from(screenshot.data, 'base64'));
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description
      || result.exceptionDetails.text
      || 'browser evaluation failed');
  }
  return result.result?.value;
}

async function waitForValue(cdp, waitMs, expression) {
  const started = performance.now();
  while (performance.now() - started < waitMs) {
    const value = await evaluate(cdp, expression);
    if (value !== null && value !== undefined && value !== false) return value;
    await delay(100);
  }
  throw new Error(`timed out waiting for browser value: ${expression.slice(0, 120)}`);
}

async function waitForTarget(port, waitMs, child) {
  const started = performance.now();
  while (performance.now() - started < waitMs) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before CDP admission: ${child.exitCode}`);
    try {
      const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome CDP target');
}

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  ].filter(Boolean);
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('Chrome executable is missing');
  return executable;
}

function ensureMount(path, target) {
  const resolvedTarget = resolve(target);
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() && resolve(dirname(path), readlinkSync(path)) === resolvedTarget) return;
    throw new Error(`mount path already exists with different custody: ${path}`);
  }
  symlinkSync(resolvedTarget, path, 'dir');
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

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertArrayNearlyEqual(actual, expected, tolerance, message) {
  assert.equal(Array.isArray(actual), true, `${message}: actual is not an array`);
  assert.equal(actual.length, expected.length, `${message}: length drifted`);
  for (let index = 0; index < expected.length; index += 1) {
    assert.ok(
      Math.abs(Number(actual[index]) - Number(expected[index])) <= tolerance,
      `${message}: index ${index} expected ${expected[index]} got ${actual[index]}`,
    );
  }
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
