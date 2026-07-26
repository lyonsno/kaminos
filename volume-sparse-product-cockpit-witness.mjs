#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { SPARSE_PRODUCT_APPEARANCE_ATTRACTOR } from './volume-sparse-product-cockpit.mjs';

const args = parseArgs(process.argv.slice(2));
const requestedRouteRaw = String(
  args.get('--url')
  || 'http://127.0.0.1:18825/volume-selective-head-live.html'
    + '?volume_product_cockpit=1'
    + '&volume_resolution=96'
    + '&volume_splat_geometry=historical-round'
    + '&volume_optical_unit_mode=projected-native-cell-area-integral-normalized-v0'
);
const outputDir = resolve(String(args.get('--output-dir') || '/tmp/kaminos-sparse-product-cockpit'));
const reportPath = resolve(outputDir, 'report.json');
const screenshotPath = resolve(outputDir, 'physical-historical-round.png');
const timeoutMs = Number(args.get('--timeout-ms') || 180_000);
const debugPort = Number(args.get('--debug-port') || randomInt(42_000, 62_000));
const browserProfile = `/tmp/kaminos-sparse-product-cockpit-chrome-${process.pid}-${Date.now()}`;
const startedAtMs = performance.now();
let requestedRoute = null;
let route = requestedRouteRaw;
let initialResolution = null;
let initialGeometry = null;
let initialOpticalUnitMode = null;
let transitionResolution = null;
let appearanceTargetRequested = false;
let appearanceSettingsAnchorId = null;
let browserExecutable = null;
let browser = null;
let socket = null;
let failurePhase = 'preflight';
let lastTrustworthyEvidence = { requestedRoute: requestedRouteRaw };
let finalReport = null;
const browserLifecycle = {
  identity: 'headed-owned-cdp-browser-v0',
  requestedMode: 'headed',
  effectiveMode: null,
  executable: null,
  debugPort,
  profilePath: browserProfile,
  launchPid: null,
  processGroupId: null,
  cleanup: { status: 'pending' },
};

class CdpSocket {
  constructor(url, timeout) {
    this.url = url;
    this.timeout = timeout;
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
  }

  open() {
    return new Promise((resolveOpen, reject) => {
      this.socket = new WebSocket(this.url);
      this.socket.addEventListener('open', resolveOpen, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
      this.socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (!message.id) {
          this.events.push(message);
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
        reject(new Error(`CDP call timed out:${method}`));
      }, this.timeout);
      this.pending.set(id, { resolve: resolveCall, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket?.close();
  }
}

try {
  mkdirSync(outputDir, { recursive: true });
  assertOpticalComparisonFalsifiers();
  requestedRoute = new URL(requestedRouteRaw);
  route = requestedRoute.href;
  initialResolution = Number(requestedRoute.searchParams.get('volume_resolution') || 96);
  initialGeometry = requestedRoute.searchParams.get('volume_splat_geometry') || 'historical-round';
  initialOpticalUnitMode = requestedRoute.searchParams.get('volume_optical_unit_mode')
    || 'projected-native-cell-area-integral-normalized-v0';
  appearanceSettingsAnchorId = requestedRoute.searchParams.get('settings_preset');
  appearanceTargetRequested =
    appearanceSettingsAnchorId === SPARSE_PRODUCT_APPEARANCE_ATTRACTOR.settingsAnchorId;
  transitionResolution = initialResolution === 64 ? 96 : 64;
  browserExecutable = args.get('--chrome')
    ? String(args.get('--chrome'))
    : chromeExecutable();
  if (!existsSync(browserExecutable)) {
    throw new Error(`Chrome executable not found:${browserExecutable}`);
  }
  browserLifecycle.executable = browserExecutable;
  assertDebugPortAvailable(debugPort);
  lastTrustworthyEvidence = { requestedRoute: route };
  failurePhase = 'browser-launch';
  browser = spawn(browserExecutable, [
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-extensions',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${browserProfile}`,
    '--window-size=1600,1000',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', detached: true });
  assert.ok(Number.isInteger(browser.pid) && browser.pid > 0, 'headed Chrome did not expose an owned launch pid');
  browserLifecycle.launchPid = browser.pid;
  browserLifecycle.processGroupId = browser.pid;
  const target = await waitForTarget(debugPort, timeoutMs);
  browserLifecycle.connection = bindOwnedCdpEndpoint({
    debugPort,
    processGroupId: browser.pid,
    profilePath: browserProfile,
    target,
  });
  browserLifecycle.effectiveMode = 'headed';
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Emulation.setDeviceMetricsOverride', {
    width: 1600,
    height: 1000,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await socket.call('Page.navigate', { url: route });

  failurePhase = 'cold-load-authority';
  const coldLoad = [];
  for (let index = 0; index < 3; index += 1) {
    const state = await waitForRuntimeState(socket, timeoutMs);
    coldLoad.push(state);
    assertSparseProductState(state, initialResolution, initialGeometry, initialOpticalUnitMode);
    if (index < 2) await delay(500);
  }
  assert.ok(
    coldLoad.at(-1).simStepCount > coldLoad[0].simStepCount,
    `cold-load simulation did not advance:${coldLoad[0].simStepCount}:${coldLoad.at(-1).simStepCount}`,
  );
  assert.deepEqual(
    new Set(coldLoad.map(state => state.sourceAuthority)),
    new Set(['live-baked-sidecar-plus-fluid-material-v0']),
    'cold load changed source authority after first visible state',
  );
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, coldLoad };

  failurePhase = 'cold-load-pixels';
  const coldPixels = await capturePixelSample(socket);
  assertVisible(coldPixels, 'cold-load');
  const coldScreenshotPath = resolve(outputDir, `cold-${initialGeometry}-${initialResolution}.png`);
  await captureScreenshot(socket, coldScreenshotPath);

  failurePhase = 'optical-modes';
  const optics = {};
  const opticalPixelSamples = {};
  await evaluate(socket, `(() => {
    return window.__kaminosSelectiveHeadLive.setCapturePaused(true);
  })()`);
  const opticalHeldState = await runtimeState(socket);
  const opticalRenderTimeMs = await evaluate(
    socket,
    "document.querySelector('#basin')?.contentWindow?.performance.now()",
  );
  assert.ok(Number.isFinite(opticalRenderTimeMs), 'inner renderer did not expose a fixed optical timestamp');
  const opticalSameStateCaptureId =
    `sparse-product-optics-f${opticalHeldState.frameCount}-s${opticalHeldState.simStepCount}`;
  const opticalCaptureAuthority = {
    now: opticalRenderTimeMs,
    sameStateCaptureId: opticalSameStateCaptureId,
    baseFrameCount: opticalHeldState.frameCount,
    baseSimStepCount: opticalHeldState.simStepCount,
  };
  const opticalCanvasSamples = {};
  for (const mode of [
    'legacy-global-path-scale-diagnostic-v0',
    'projected-native-cell-area-integral-normalized-v0',
  ]) {
    const receipt = await evaluate(socket, `(() => {
      return window.__kaminosSelectiveHeadLive.setOpticalUnitMode(${JSON.stringify(mode)});
    })()`);
    assert.equal(receipt.effectiveBoundarySplatOpticalUnitMode, mode);
    await delay(350);
    const state = await waitForRuntimeState(socket, timeoutMs);
    assert.equal(state.opticalUnitMode, mode);
    assertSparseProductState(state, initialResolution, initialGeometry, mode);
    const pixels = await capturePixelSample(socket, opticalCaptureAuthority);
    assertVisible(pixels, mode);
    assert.equal(pixels.sameStateCaptureId, opticalSameStateCaptureId);
    assert.equal(pixels.sampleNowMs, opticalRenderTimeMs);
    assert.equal(pixels.baseFrameCount, opticalHeldState.frameCount);
    assert.equal(pixels.baseSimStepCount, opticalHeldState.simStepCount);
    assert.equal(
      pixels.simStepCount,
      opticalHeldState.simStepCount,
      `${mode} advanced the held simulation during the optical comparison`,
    );
    assert.ok(
      Number.isInteger(pixels.candidateCount) && pixels.candidateCount > 0,
      `${mode} omitted the sampled candidate population`,
    );
    const path = resolve(
      outputDir,
      mode === 'projected-native-cell-area-integral-normalized-v0'
        ? 'physical-historical-round.png'
        : 'legacy-historical-round.png',
    );
    const presentedFrame = await presentHeldFrame(socket, opticalCaptureAuthority);
    assert.equal(presentedFrame.ok, true, `${mode} did not present a held frame`);
    assert.equal(presentedFrame.advanceSim, false);
    assert.equal(presentedFrame.presentToCanvas, true);
    assert.equal(presentedFrame.sameStateCaptureId, opticalSameStateCaptureId);
    assert.equal(presentedFrame.baseFrameCount, opticalHeldState.frameCount);
    assert.equal(presentedFrame.baseSimStepCount, opticalHeldState.simStepCount);
    assert.equal(presentedFrame.sampleNowMs, opticalRenderTimeMs);
    assert.equal(presentedFrame.simStepCount, opticalHeldState.simStepCount);
    await delay(100);
    const canvasPixels = await captureVolumeCanvasScreenshot(socket, path);
    assertVisible(canvasPixels, `${mode}:presented-canvas`);
    optics[mode] = {
      receipt,
      state,
      pixels: stripPixels(pixels),
      presentedFrame,
      canvasPixels: stripPixels(canvasPixels),
      screenshotPath: path,
    };
    opticalPixelSamples[mode] = pixels;
    opticalCanvasSamples[mode] = canvasPixels;
  }
  const opticalFinalState = await runtimeState(socket);
  assert.equal(opticalFinalState.simStepCount, opticalHeldState.simStepCount);
  assert.equal(opticalFinalState.cameraSignature, opticalHeldState.cameraSignature);
  assert.equal(
    opticalPixelSamples['legacy-global-path-scale-diagnostic-v0'].candidateCount,
    opticalPixelSamples['projected-native-cell-area-integral-normalized-v0'].candidateCount,
    'Legacy/Physical optics did not use the same sampled candidate population',
  );
  const opticsComparison = assertOpticalModePixelDelta(
    opticalCanvasSamples['legacy-global-path-scale-diagnostic-v0'],
    opticalCanvasSamples['projected-native-cell-area-integral-normalized-v0'],
  );
  await evaluate(socket, `(() => {
    return window.__kaminosSelectiveHeadLive.setCapturePaused(false);
  })()`);
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    optics,
    opticsComparison,
    opticalHeldState,
    opticalRenderTimeMs,
    opticalSameStateCaptureId,
  };

  let resolutionRequest = null;
  let resolutionState = coldLoad.at(-1);
  let resolutionPixels = null;
  let controlProbe = null;
  let controlState = null;
  const geometry = {};
  const skippedForNamedAppearanceTarget = appearanceTargetRequested
    ? ['resolution-transition', 'semantic-control-coupling', 'geometry-modes']
    : [];
  if (!appearanceTargetRequested) {
    failurePhase = 'resolution-transition';
    resolutionRequest = await evaluate(socket, `(() => {
      return window.__kaminosSelectiveHeadLive.setSparseProductResolution(${transitionResolution});
    })()`);
    assert.equal(resolutionRequest.status, 'effective');
    assert.equal(resolutionRequest.requestedResolution, transitionResolution);
    assert.equal(resolutionRequest.stageIdentity, 'staged-sparse-product-iframe-handover-v0');
    resolutionState = await waitForRuntimeState(socket, timeoutMs, state =>
      state.status === 'running'
        && state.resolution === transitionResolution
        && state.transition?.status === 'effective');
    assertSparseProductState(
      resolutionState,
      transitionResolution,
      initialGeometry,
      initialOpticalUnitMode,
    );
    assert.equal(resolutionState.transition.requestedResolution, transitionResolution);
    assert.equal(resolutionState.transition.effectiveResolution, transitionResolution);
    assert.equal(resolutionState.transition.diagnosticCoefficientsActiveAfter, false);
    resolutionPixels = await capturePixelSample(socket);
    assertVisible(resolutionPixels, 'resolution-transition');
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      resolutionRequest,
      resolutionState,
      resolutionPixels: stripPixels(resolutionPixels),
    };

    failurePhase = 'semantic-control-coupling';
    controlProbe = await evaluate(socket, `(() => {
      const runtime = document.querySelector('#basin')?.contentWindow;
      const input = runtime?.document?.getElementById('volume-reaction-boundary-fire-tip');
      const prototype = runtime?.__kaminosVolumePrototype;
      if (!input || !prototype) throw new Error('semantic-control-surface-missing');
      const before = prototype.debugState();
      const previous = Number(input.value);
      const requested = previous > 1.2 ? 0.82 : 1.8;
      input.value = String(requested);
      input.dispatchEvent(new runtime.Event('input', { bubbles: true }));
      input.dispatchEvent(new runtime.Event('change', { bubbles: true }));
      const after = prototype.debugState();
      return {
        control: 'reactionBoundaryFireTip',
        previous,
        requested,
        effective: after.controls?.reactionBoundaryFireTip,
        simStepBefore: before.simStepCount,
        simStepAfter: after.simStepCount,
        sourceAuthorityBefore: before.boundarySplatSourceAuthority,
        sourceAuthorityAfter: after.boundarySplatSourceAuthority,
      };
    })()`);
    assert.equal(controlProbe.effective, controlProbe.requested);
    assert.equal(controlProbe.sourceAuthorityBefore, 'live-baked-sidecar-plus-fluid-material-v0');
    assert.equal(controlProbe.sourceAuthorityAfter, 'live-baked-sidecar-plus-fluid-material-v0');
    await delay(500);
    controlState = await waitForRuntimeState(socket, timeoutMs);
    assert.ok(controlState.simStepCount > controlProbe.simStepAfter, 'simulation stopped after semantic control update');
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, controlProbe, controlState };

    failurePhase = 'geometry-modes';
    for (const mode of ['flow-tangent', 'learned-tangent', 'historical-round']) {
      await evaluate(socket, `(() => {
        const runtime = document.querySelector('#basin')?.contentWindow;
        const prototype = runtime?.__kaminosVolumePrototype;
        if (!runtime || !prototype) throw new Error('geometry-authority-trace-runtime-missing');
        runtime.__kaminosSparseProductGeometryAuthorityTrace = [];
        if (!prototype.__kaminosSparseProductOriginalSetControls) {
          prototype.__kaminosSparseProductOriginalSetControls = prototype.setControls.bind(prototype);
          prototype.setControls = next => {
            const result = prototype.__kaminosSparseProductOriginalSetControls(next);
            const state = prototype.debugState();
            runtime.__kaminosSparseProductGeometryAuthorityTrace.push({
              atMs: performance.now(),
              requestedBoundarySplatMode: next?.boundarySplatMode ?? null,
              effectiveBoundarySplatMode: state.boundarySplatMode ?? null,
              effectiveFootprintAuthority: state.boundarySplatFootprintAuthority ?? null,
            });
            return result;
          };
        }
        return true;
      })()`);
      const receipt = await evaluate(socket, `(() => {
        return window.__kaminosSelectiveHeadLive.setSparseProductGeometry(${JSON.stringify(mode)});
      })()`);
      assert.ok(
        receipt.status === 'settling' || receipt.status === 'effective',
        `geometry request returned invalid status:${receipt.status}`,
      );
      await delay(350);
      const state = await waitForRuntimeState(socket, timeoutMs);
      const authorityTrace = await evaluate(socket, `(() => {
        const runtime = document.querySelector('#basin')?.contentWindow;
        const prototype = runtime?.__kaminosVolumePrototype;
        const select = runtime?.document?.getElementById('volume-boundary-splat-mode');
        return {
          selectedBoundarySplatMode: select?.value || null,
          effectiveBoundarySplatMode: prototype?.debugState?.()?.boundarySplatMode || null,
          effectiveFootprintAuthority: prototype?.debugState?.()?.boundarySplatFootprintAuthority || null,
          setControls: runtime?.__kaminosSparseProductGeometryAuthorityTrace || [],
        };
      })()`);
      lastTrustworthyEvidence = {
        ...lastTrustworthyEvidence,
        geometryAttempt: { mode, receipt, state, authorityTrace },
      };
      assertSparseProductState(state, transitionResolution, mode, initialOpticalUnitMode);
      const path = resolve(outputDir, `${mode}.png`);
      await captureScreenshot(socket, path);
      geometry[mode] = { receipt, state, authorityTrace, screenshotPath: path };
    }
    lastTrustworthyEvidence = { ...lastTrustworthyEvidence, geometry };
  }

  failurePhase = 'camera-interaction';
  const beforeCamera = await runtimeState(socket);
  const point = await evaluate(socket, `(() => {
    const frame = document.querySelector('#basin');
    const canvas = frame?.contentDocument?.querySelector('#kaminos-host-renderer-canvas');
    if (!frame || !canvas) throw new Error('volume-canvas-missing');
    const outer = frame.getBoundingClientRect();
    const inner = canvas.getBoundingClientRect();
    return { x: outer.left + inner.left + inner.width * 0.5, y: outer.top + inner.top + inner.height * 0.5 };
  })()`);
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1,
  });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mouseMoved', x: point.x + 100, y: point.y + 25, button: 'left', buttons: 1,
  });
  await socket.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: point.x + 100, y: point.y + 25, button: 'left', buttons: 0, clickCount: 1,
  });
  await delay(350);
  const afterCamera = await runtimeState(socket);
  assert.notEqual(beforeCamera.cameraSignature, afterCamera.cameraSignature, 'camera drag did not change the live camera');
  assert.ok(afterCamera.simStepCount >= beforeCamera.simStepCount, 'camera interaction rewound simulation state');
  const cameraProbe = { before: beforeCamera, after: afterCamera };
  const effectiveState = appearanceTargetRequested
    ? await waitForRuntimeState(socket, timeoutMs)
    : resolutionState;
  assertSparseProductState(
    effectiveState,
    appearanceTargetRequested ? initialResolution : transitionResolution,
    appearanceTargetRequested ? initialGeometry : effectiveState.geometry,
    initialOpticalUnitMode,
  );

  failurePhase = 'browser-error-audit';
  const browserErrors = socket.events.filter(event =>
    event.method === 'Runtime.exceptionThrown'
    || (event.method === 'Log.entryAdded' && event.params?.entry?.level === 'error'));
  assert.deepEqual(browserErrors, [], `browser errors observed:${JSON.stringify(browserErrors)}`);

  finalReport = {
    schema: 'kaminos.volume.sparse-live-cockpit-witness.v0',
    status: 'passed',
    failurePhase: null,
    requestedRoute: route,
    effectiveRoute: effectiveState.outerRoute,
    effectiveInnerRoute: effectiveState.innerRoute,
    appearanceContext: appearanceTargetRequested
      ? {
          appearanceTargetRequested,
          settingsAnchorId: appearanceSettingsAnchorId,
          admission: effectiveState.sparseProductAppearanceAdmission,
          attractor: effectiveState.appearanceAttractor,
          exactVisualReplay: false,
          skippedForNamedAppearanceTarget,
        }
      : null,
    coldLoad,
    coldPixels: stripPixels(coldPixels),
    coldScreenshotPath,
    resolution: {
      request: resolutionRequest,
      state: resolutionState,
      pixels: resolutionPixels ? stripPixels(resolutionPixels) : null,
    },
    controlProbe,
    controlState,
    geometry,
    optics,
    opticsComparison,
    opticalHeldState,
    opticalRenderTimeMs,
    opticalSameStateCaptureId,
    cameraProbe,
    screenshotPath,
    browserErrors,
    browserLifecycle,
    elapsedMs: performance.now() - startedAtMs,
  };
  writeReportSafely(reportPath, finalReport);
} catch (error) {
  const failureDiagnostics = socket
    ? await captureRuntimeState(socket).catch(diagnosticError => ({
        status: 'diagnostic-capture-failed',
        error: diagnosticError?.stack || String(diagnosticError),
      }))
    : null;
  const browserEvents = summarizeBrowserEvents(socket?.events || []);
  const failureScreenshotPath = resolve(outputDir, 'failure-screenshot.png');
  let failureScreenshot = null;
  if (socket) {
    try {
      await captureScreenshot(socket, failureScreenshotPath);
      failureScreenshot = failureScreenshotPath;
    } catch (screenshotError) {
      failureScreenshot = {
        status: 'failed',
        error: screenshotError?.stack || String(screenshotError),
      };
    }
  }
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    failureDiagnostics,
    browserEvents: summarizeBrowserEvents(socket?.events || []),
    failureScreenshot,
  };
  finalReport = {
    schema: 'kaminos.volume.sparse-live-cockpit-witness.v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || String(error),
    lastTrustworthyEvidence,
    browserEvents,
    browserLifecycle,
  };
  writeReportSafely(reportPath, finalReport);
  process.exitCode = 1;
} finally {
  socket?.close();
  browserLifecycle.cleanup = await cleanupOwnedBrowserProcessGroup(browser, browserProfile);
  if (browserLifecycle.cleanup.status === 'failed') {
    process.exitCode = 1;
    finalReport = {
      ...(finalReport || {
        schema: 'kaminos.volume.sparse-live-cockpit-witness.v0',
        lastTrustworthyEvidence,
      }),
      status: 'failed',
      failurePhase: 'browser-cleanup',
      error: `browser-cleanup-failed:${JSON.stringify(browserLifecycle.cleanup)}`,
    };
  }
  finalReport.browserLifecycle = browserLifecycle;
  finalReport.elapsedMs = performance.now() - startedAtMs;
  writeReportSafely(reportPath, finalReport);
}

const consoleMethod = finalReport.status === 'passed' ? 'log' : 'error';
console[consoleMethod](JSON.stringify({
  ok: finalReport.status === 'passed',
  status: finalReport.status,
  failurePhase: finalReport.failurePhase,
  reportPath,
  screenshotPath: finalReport.screenshotPath || null,
  requestedRoute: finalReport.requestedRoute || route,
  effectiveRoute: finalReport.effectiveRoute || null,
  browserLifecycle,
  elapsedMs: finalReport.elapsedMs,
}, null, 2));

function assertSparseProductState(state, resolution, geometry, opticalUnitMode) {
  const geometryDefinition = {
    'historical-round': {
      boundarySplatMode: 'learned',
      footprintAuthority: 'learned-camera-facing-billboard-v0',
      boundarySplatRadius: 0.98,
      boundarySplatSharpness: 12,
      rendererIdentity: 'live-boundary-sidecar-learned-attribute-splats-v0',
    },
    'flow-tangent': {
      boundarySplatMode: 'kernel_moment_covariance',
      footprintAuthority: 'base-footprint-plus-flow-kernel-second-moment-tangent-covariance-v0',
      rendererIdentity: 'live-boundary-sidecar-flow-kernel-moment-covariance-splats-v0',
    },
    'learned-tangent': {
      boundarySplatMode: 'world_covariance',
      footprintAuthority: 'world-gradient-tangent-covariance-v0',
      rendererIdentity: 'live-boundary-sidecar-world-tangent-covariance-splats-v0',
    },
  }[geometry];
  assert.equal(state.status, 'running');
  assert.equal(state.routeIdentity, 'kaminos.volume.sparse-live-cockpit.v0');
  assert.equal(state.resolution, resolution);
  assert.equal(state.geometry, geometry);
  assert.equal(state.boundarySplatMode, geometryDefinition.boundarySplatMode);
  assert.equal(state.boundarySplatFootprintAuthority, geometryDefinition.footprintAuthority);
  assert.equal(state.boundarySplatRendererIdentity, geometryDefinition.rendererIdentity);
  assert.equal(
    state.boundarySplatAttributeModelIdentity,
    'sha256:22284e5b930ef893e3c874ed1bd9efd077a16f29f14002155afe072f262ac472',
  );
  if (geometry === 'historical-round') {
    assert.equal(state.boundarySplatRadius, geometryDefinition.boundarySplatRadius);
    assert.equal(state.boundarySplatSharpness, geometryDefinition.boundarySplatSharpness);
  }
  assert.equal(state.opticalUnitMode, opticalUnitMode);
  assert.equal(state.opticalPresentationMode, 'matched-optical-recurrence-v0');
  assert.equal(state.opticalAccumulationIdentity, 'depth-binned-emission-optical-depth-v0');
  assert.equal(state.opticalTransportIdentity, 'depth-binned-exponential-self-transmittance-v0');
  assert.equal(state.sourceAuthority, 'live-baked-sidecar-plus-fluid-material-v0');
  assert.equal(state.populationAuthority, 'ordinary-live-sparse-compaction-v0');
  assert.equal(state.diagnosticCoefficientsActive, false);
  assert.equal(state.persistentCohortActive, false);
  assert.equal(state.boundarySplatOverflowCount, 0);
  assert.equal(state.requestedRole, 'off');
  assert.equal(state.effectiveRole, 'off');
  assert.equal(state.requestedComposition, 'splat-only-v0');
  assert.equal(state.effectiveComposition, 'splat-only-v0');
  assert.equal(state.fallbackReason, null);
  assert.deepEqual(state.visibleDiagnosticControls, []);
  assert.ok(state.candidates > 0, `sparse product has no candidates:${JSON.stringify(state)}`);
  assert.ok(state.candidates < resolution ** 3, `sparse product silently became full-grid:${state.candidates}`);
  if (appearanceTargetRequested) {
    assert.equal(
      state.sourceSettingsPresetId,
      SPARSE_PRODUCT_APPEARANCE_ATTRACTOR.settingsAnchorId,
      'the named appearance target substituted its settings anchor',
    );
    assert.equal(
      state.sourceSettingsPresetAuthority,
      'shared-volume-settings-preset-v2',
      'the named appearance target substituted settings authority',
    );
    assert.equal(state.sparseProductAppearanceAdmission?.ok, true);
    assert.equal(
      state.sparseProductAppearanceAdmission?.settingsAnchorId,
      SPARSE_PRODUCT_APPEARANCE_ATTRACTOR.settingsAnchorId,
    );
    assert.equal(
      state.appearanceAttractor?.identity,
      SPARSE_PRODUCT_APPEARANCE_ATTRACTOR.identity,
    );
    assert.equal(state.sparseProductAppearanceAdmission?.exactVisualReplay, false);
  }
  const outerRoute = new URL(state.outerRoute);
  const innerRoute = new URL(state.innerRoute);
  assert.equal(outerRoute.pathname, requestedRoute.pathname);
  assert.equal(outerRoute.searchParams.get('volume_product_cockpit'), '1');
  assert.equal(Number(outerRoute.searchParams.get('volume_resolution')), resolution);
  assert.equal(outerRoute.searchParams.get('volume_splat_geometry'), geometry);
  assert.equal(outerRoute.searchParams.get('volume_optical_unit_mode'), opticalUnitMode);
  assert.equal(innerRoute.searchParams.get('volume_product_cockpit'), '1');
  assert.equal(Number(innerRoute.searchParams.get('volume_resolution')), resolution);
  assert.equal(innerRoute.searchParams.get('volume_splat_geometry'), geometry);
  assert.equal(innerRoute.searchParams.get('volume_optical_unit_mode'), opticalUnitMode);
  if (geometry === 'historical-round') {
    assert.equal(Number(innerRoute.searchParams.get('volume_boundary_splat_radius')), 0.98);
    assert.equal(Number(innerRoute.searchParams.get('volume_boundary_splat_sharpness')), 12);
  }
}

function assertVisible(sample, label) {
  assert.ok(sample.litFraction > 0.001, `${label} frame was blank:${sample.litFraction}`);
  assert.ok(sample.maximumLuma > 3, `${label} frame had no visible energy:${sample.maximumLuma}`);
}

async function waitForRuntimeState(cdp, timeout, predicate = state => state.status === 'running') {
  const started = performance.now();
  let lastObservedState = null;
  let nullObservationCount = 0;
  while (performance.now() - started < timeout) {
    const state = await captureRuntimeState(cdp);
    if (state) lastObservedState = state;
    else nullObservationCount += 1;
    if (state?.status === 'failed') throw new Error(`sparse-product-runtime-failed:${JSON.stringify(state)}`);
    if (state && predicate(state)) return state;
    await delay(200);
  }
  throw new Error(
    `timed out waiting for sparse product runtime:last=${JSON.stringify(lastObservedState)}`
    + `:nullObservations=${nullObservationCount}`,
  );
}

async function captureRuntimeState(cdp) {
  return evaluate(cdp, `(() => {
    const controls = window.__kaminosSelectiveHeadLive;
    const outer = controls?.debugState?.();
    const frame = document.querySelector('#basin');
    const innerWindow = frame?.contentWindow;
    const prototype = innerWindow?.__kaminosVolumePrototype;
    const inner = prototype?.debugState?.();
    const routeInitReceipt = innerWindow?.__kaminosVolumeRouteInitReceipt || null;
    const partial = {
      status: routeInitReceipt?.ok === false ? 'failed' : 'initializing',
      outerDocumentReadyState: document.readyState,
      outerRuntimePresent: Boolean(outer),
      outerRuntimeStatus: outer?.status || null,
      outerRuntimeError: outer?.error || null,
      outerStatusText: document.getElementById('status')?.textContent || null,
      innerFramePresent: Boolean(frame),
      innerDocumentReadyState: frame?.contentDocument?.readyState || null,
      innerRoute: innerWindow?.location?.href || null,
      innerRouteInitPromisePresent: Boolean(innerWindow?.__kaminosVolumeRouteInitPromise),
      innerRouteInitComplete: innerWindow?.__kaminosVolumeRouteInitComplete === true,
      innerRouteInitReceipt: routeInitReceipt,
      innerRuntimePresent: Boolean(inner),
      innerInfoText: frame?.contentDocument?.getElementById('info')?.textContent || null,
    };
    if (!outer || !inner) return partial;
    const receipt = outer.sparseProductReceipt;
    const diagnosticControlIds = [
      'volume-reaction-live-view',
      'volume-boundary-sidecar-source',
      'volume-boundary-sidecar-view',
      'volume-boundary-sidecar-blur',
      'volume-boundary-sidecar-width',
      'volume-boundary-sidecar-ridge',
      'volume-boundary-splat-mode',
      'volume-boundary-splat-radius',
      'volume-boundary-splat-sharpness',
      'volume-flow-kernel-strength',
      'volume-flow-kernel-radius',
      'volume-flow-kernel-coherence',
      'volume-majorant-grid',
      'volume-grid-overlay',
      'volume-flow-debug',
      'volume-residual-mode',
      'volume-residual-model-url',
      'volume-residual-strength',
      'volume-residual-feature-debug',
    ];
    const visibleDiagnosticControls = diagnosticControlIds.filter(id => {
      const element = frame.contentDocument?.getElementById(id);
      if (!element || element.closest('[hidden]')) return false;
      const style = frame.contentWindow.getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
    return {
      ...partial,
      status: outer.status,
      routeIdentity: receipt?.routeIdentity || null,
      outerRoute: location.href,
      innerRoute: frame.contentWindow.location.href,
      resolution: receipt?.effective?.resolution || null,
      geometry: receipt?.effective?.geometry || null,
      boundarySplatMode: receipt?.effective?.boundarySplatMode || null,
      boundarySplatFootprintAuthority: receipt?.effective?.footprintAuthority || null,
      boundarySplatRadius: receipt?.material?.effective?.boundarySplatRadius ?? null,
      boundarySplatSharpness: receipt?.material?.effective?.boundarySplatSharpness ?? null,
      boundarySplatRendererIdentity: receipt?.material?.effective?.rendererIdentity || null,
      boundarySplatAttributeModelIdentity: receipt?.material?.effective?.attributeModelIdentity || null,
      materialIdentity: receipt?.material || null,
      opticalUnitMode: receipt?.effective?.opticalUnitMode || null,
      opticalPresentationMode: receipt?.effective?.presentationMode || null,
      opticalAccumulationIdentity: receipt?.opticalTransport?.accumulationIdentity || null,
      opticalTransportIdentity: receipt?.opticalTransport?.transportIdentity || null,
      sourceAuthority: receipt?.effective?.sourceAuthority || null,
      populationAuthority: receipt?.population?.authority || null,
      candidates: receipt?.population?.candidates || 0,
      fullGridCells: receipt?.population?.fullGridCells || null,
      boundarySplatOverflowCount: receipt?.population?.overflow ?? null,
      visibleDiagnosticControls,
      simStepCount: receipt?.effective?.simStepCount || inner.simStepCount || 0,
      frameCount: receipt?.effective?.frameCount || inner.frameCount || 0,
      boundarySplatControlGeneration: inner.boundarySplatControlGeneration ?? null,
      appliedPassControlGeneration: inner.selectiveHeadLivePassReceipt?.controlGeneration ?? null,
      diagnosticCoefficientsActive: inner.liveCompleteFlameOpticalCoefficientsEnabled === true,
      persistentCohortActive: Boolean(inner.persistentSparseCohortGpuReceipt),
      fallbackReason: outer.fallbackReason || receipt?.fallbackReason || null,
      runtimeError: outer.error || inner.error || null,
      requestedRole: outer.requestedRole || null,
      effectiveRole: outer.effectiveRole || null,
      requestedComposition: outer.requestedComposition || null,
      effectiveComposition: outer.effectiveComposition || null,
      transition: outer.volumeResolutionTransitionReceipt || null,
      sourceSettingsPresetId: outer.sourceSettingsPresetId || null,
      sourceSettingsPresetAuthority: outer.sourceSettingsPresetAuthority || null,
      sparseProductAppearanceAdmission: outer.sparseProductAppearanceAdmission || null,
      appearanceAttractor: outer.appearanceAttractor || null,
    };
  })()`);
}

function summarizeBrowserEvents(events) {
  return events.filter(event =>
    event.method === 'Runtime.exceptionThrown'
    || event.method === 'Log.entryAdded')
    .map(event => ({
      method: event.method,
      level: event.params?.entry?.level || null,
      text: event.params?.entry?.text
        || event.params?.exceptionDetails?.exception?.description
        || event.params?.exceptionDetails?.text
        || null,
      url: event.params?.entry?.url || event.params?.exceptionDetails?.url || null,
      lineNumber: event.params?.entry?.lineNumber ?? event.params?.exceptionDetails?.lineNumber ?? null,
    }));
}

async function capturePixelSample(cdp, authority = {}) {
  const encodedAuthority = JSON.stringify(authority);
  return evaluate(cdp, `(async () => {
    const prototype = document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
    if (!prototype?.sampleFrame) throw new Error('sparse-product-sample-api-missing');
    const authority = ${encodedAuthority};
    const sample = await prototype.sampleFrame({
      advanceSim: false,
      includeRgba: false,
      now: authority.now,
      sameStateCaptureId: authority.sameStateCaptureId,
      baseFrameCount: authority.baseFrameCount,
      baseSimStepCount: authority.baseSimStepCount,
    });
    if (!sample?.ok || !sample.preview?.rgba?.length) throw new Error('sparse-product-preview-readback-missing');
    let litPixels = 0;
    let lumaSum = 0;
    let maximumLuma = 0;
    for (let index = 0; index < sample.preview.rgba.length; index += 4) {
      const luma = 0.2126 * sample.preview.rgba[index]
        + 0.7152 * sample.preview.rgba[index + 1]
        + 0.0722 * sample.preview.rgba[index + 2];
      if (luma > 3) litPixels += 1;
      lumaSum += luma;
      maximumLuma = Math.max(maximumLuma, luma);
    }
    const pixels = sample.preview.rgba.length / 4;
    return {
      rgba: sample.preview.rgba,
      width: sample.preview.width,
      height: sample.preview.height,
      pixels,
      litPixels,
      litFraction: litPixels / Math.max(1, pixels),
      meanLuma: lumaSum / Math.max(1, pixels),
      maximumLuma,
      simStepCount: prototype.debugState().simStepCount,
      candidateCount: sample.boundarySplatCandidateCount,
      sameStateCaptureId: sample.sameStateCaptureId,
      baseFrameCount: sample.baseFrameCount,
      baseSimStepCount: sample.baseSimStepCount,
      sampleNowMs: sample.sampleNowMs,
      renderPhaseTimeMs: sample.renderPhaseTimeMs,
      renderPhaseFrame: sample.renderPhaseFrame,
      renderPhaseAuthority: sample.renderPhaseAuthority,
    };
  })()`);
}

async function presentHeldFrame(cdp, authority) {
  const encodedAuthority = JSON.stringify(authority);
  return evaluate(cdp, `(async () => {
    const prototype = document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
    if (!prototype?.captureSelectiveHeadLiveFrame) {
      throw new Error('sparse-product-presented-frame-api-missing');
    }
    const authority = ${encodedAuthority};
    return prototype.captureSelectiveHeadLiveFrame({
      advanceSim: false,
      presentToCanvas: true,
      startNow: authority.now,
      frameIndex: 0,
      sameStateCaptureId: authority.sameStateCaptureId,
      baseFrameCount: authority.baseFrameCount,
      baseSimStepCount: authority.baseSimStepCount,
    });
  })()`);
}

function stripPixels(sample) {
  const { rgba: _rgba, ...metrics } = sample;
  return metrics;
}

function assertOpticalModePixelDelta(legacy, physical) {
  assert.equal(legacy.width, physical.width);
  assert.equal(legacy.height, physical.height);
  assert.equal(legacy.rgba.length, physical.rgba.length);
  let changedPixels = 0;
  let absoluteRgbDelta = 0;
  const pixelCount = legacy.rgba.length / 4;
  for (let index = 0; index < legacy.rgba.length; index += 4) {
    const red = Math.abs(legacy.rgba[index] - physical.rgba[index]);
    const green = Math.abs(legacy.rgba[index + 1] - physical.rgba[index + 1]);
    const blue = Math.abs(legacy.rgba[index + 2] - physical.rgba[index + 2]);
    const maximum = Math.max(red, green, blue);
    if (maximum > 2) changedPixels += 1;
    absoluteRgbDelta += red + green + blue;
  }
  const changedPixelFraction = changedPixels / Math.max(1, pixelCount);
  const meanAbsoluteRgbDelta = absoluteRgbDelta / Math.max(1, pixelCount * 3);
  assert.ok(
    changedPixelFraction > 0.01,
    `Legacy/Physical optics changed too few held-state pixels:${changedPixelFraction}`,
  );
  assert.ok(
    meanAbsoluteRgbDelta > 0.25,
    `Legacy/Physical optics produced a presentation-only delta:${meanAbsoluteRgbDelta}`,
  );
  return {
    identity: 'same-state-legacy-physical-pixel-delta-v0',
    threshold: 2,
    pixelCount,
    changedPixels,
    changedPixelFraction,
    meanAbsoluteRgbDelta,
  };
}

function assertOpticalComparisonFalsifiers() {
  const visible = {
    width: 2,
    height: 2,
    rgba: Uint8Array.from([
      64, 32, 16, 255,
      64, 32, 16, 255,
      64, 32, 16, 255,
      64, 32, 16, 255,
    ]),
  };
  assert.throws(
    () => assertOpticalModePixelDelta(visible, visible),
    /changed too few held-state pixels/,
    'identical canvas pixels must not close the optics witness',
  );
  assert.throws(
    () => assertVisible({
      width: 2,
      height: 2,
      rgba: new Uint8Array(16),
      litFraction: 0,
      maximumLuma: 0,
    }, 'blank-canvas-falsifier'),
    /blank-canvas-falsifier frame was blank/,
    'blank canvas pixels must not close the optics witness',
  );
}

function paethPredictor(left, up, upLeft) {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function decodePngRgba(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.subarray(0, 8).compare(signature), 0, 'canvas screenshot is not PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const compressed = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  assert.ok(width > 0 && height > 0, 'canvas screenshot PNG omitted dimensions');
  assert.equal(bitDepth, 8, 'canvas screenshot PNG must be 8-bit');
  assert.ok(colorType === 2 || colorType === 6, `unsupported canvas PNG color type:${colorType}`);
  assert.equal(interlace, 0, 'interlaced canvas screenshot PNG is unsupported');
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const encoded = inflateSync(Buffer.concat(compressed));
  assert.equal(encoded.length, height * (stride + 1), 'canvas screenshot PNG payload is partial');
  const rgba = new Uint8Array(width * height * 4);
  let prior = Buffer.alloc(stride);
  let litPixels = 0;
  let lumaSum = 0;
  let maximumLuma = 0;
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
      else if (filter === 4) value += paethPredictor(left, up, upLeft);
      else assert.equal(filter, 0, `unsupported canvas PNG filter:${filter}`);
      row[x] = value & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const source = x * channels;
      const target = (y * width + x) * 4;
      rgba[target] = row[source];
      rgba[target + 1] = row[source + 1];
      rgba[target + 2] = row[source + 2];
      rgba[target + 3] = channels === 4 ? row[source + 3] : 255;
      const luma = 0.2126 * rgba[target] + 0.7152 * rgba[target + 1] + 0.0722 * rgba[target + 2];
      if (luma > 3) litPixels += 1;
      lumaSum += luma;
      maximumLuma = Math.max(maximumLuma, luma);
    }
    prior = row;
  }
  const pixels = width * height;
  return {
    rgba,
    width,
    height,
    pixels,
    litPixels,
    litFraction: litPixels / Math.max(1, pixels),
    meanLuma: lumaSum / Math.max(1, pixels),
    maximumLuma,
  };
}

async function captureVolumeCanvasScreenshot(cdp, path) {
  const clip = await evaluate(cdp, `(() => {
    const frame = document.querySelector('#basin');
    const canvas = frame?.contentDocument?.querySelector('#kaminos-host-renderer-canvas');
    if (!frame || !canvas) throw new Error('volume-canvas-missing');
    const frameRect = frame.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const toolbarRect = document.getElementById('toolbar')?.getBoundingClientRect() || null;
    const canvasLeft = frameRect.left + canvasRect.left;
    const canvasTop = frameRect.top + canvasRect.top;
    const canvasRight = canvasLeft + canvasRect.width;
    const canvasBottom = canvasTop + canvasRect.height;
    const visibleTop = Math.max(canvasTop, toolbarRect?.bottom ? toolbarRect.bottom + 4 : canvasTop);
    const x = Math.max(0, canvasLeft);
    const y = Math.max(0, visibleTop);
    const right = Math.min(innerWidth, canvasRight);
    const bottom = Math.min(innerHeight, canvasBottom);
    if (!(right > x && bottom > y)) throw new Error('volume-canvas-clip-empty');
    return {
      x,
      y,
      width: right - x,
      height: bottom - y,
      scale: 1,
      authority: 'presented-volume-canvas-below-toolbar-v0',
    };
  })()`);
  const screenshot = await cdp.call('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
    clip: {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height,
      scale: 1,
    },
  });
  const bytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(bytes.length > 1000, `canvas screenshot was partial:${path}`);
  const pixels = decodePngRgba(bytes);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return {
    ...pixels,
    clip,
    byteLength: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

async function captureScreenshot(cdp, path) {
  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', fromSurface: true });
  const bytes = Buffer.from(screenshot.data, 'base64');
  assert.ok(bytes.length > 1000, `screenshot was blank:${path}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

async function runtimeState(cdp) {
  return evaluate(cdp, `(() => {
    const state = document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype?.debugState?.();
    if (!state) throw new Error('sparse-product-runtime-state-missing');
    return {
      simStepCount: state.simStepCount,
      frameCount: state.frameCount,
      cameraSignature: state.cameraSignature,
    };
  })()`);
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

function chromeExecutable() {
  const candidates = [
    process.env.CHROME_BIN,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error('Chrome executable not found');
  return found;
}

function writeReportSafely(path, report) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
    return { status: 'written', path };
  } catch (error) {
    const fallback = {
      schema: 'kaminos.volume.sparse-live-cockpit-witness-report-write-failure.v0',
      status: 'failed',
      requestedPath: path,
      error: error?.stack || String(error),
      report,
    };
    console.error(JSON.stringify(fallback));
    return { status: 'stderr-fallback', path: null, error: fallback.error };
  }
}

function debugPortListeners(port) {
  const result = spawnSync('/usr/sbin/lsof', [
    '-nP',
    `-iTCP:${port}`,
    '-sTCP:LISTEN',
    '-Fp',
  ], { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status === 1) return [];
  if (result.status !== 0) {
    throw new Error(`debug-port-listener-inspection-failed:${port}:${result.stderr || result.status}`);
  }
  return [...new Set(
    String(result.stdout || '')
      .split('\n')
      .filter(line => line.startsWith('p'))
      .map(line => Number(line.slice(1)))
      .filter(Number.isInteger),
  )];
}

function assertDebugPortAvailable(port) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error(`debug-port-invalid:${port}`);
  }
  const listeners = debugPortListeners(port);
  if (listeners.length > 0) {
    throw new Error(`debug-port-already-owned:${port}:${listeners.join(',')}`);
  }
}

function bindOwnedCdpEndpoint({ debugPort: port, processGroupId, profilePath, target }) {
  const ownedProcesses = ownedBrowserProcesses(processGroupId, profilePath);
  const ownedProcessIds = new Set(ownedProcesses.map(process => process.pid));
  const listenerProcessIds = debugPortListeners(port);
  const ownedListeners = listenerProcessIds.filter(pid => ownedProcessIds.has(pid));
  const launchArgumentsBound = ownedProcesses.some(process =>
    process.command.includes(`--remote-debugging-port=${port}`)
    && process.command.includes(`--user-data-dir=${profilePath}`));
  if (ownedListeners.length === 0 || !launchArgumentsBound) {
    throw new Error(
      `cdp-endpoint-not-owned:port=${port}:listeners=${listenerProcessIds.join(',')}`
      + `:owned=${[...ownedProcessIds].join(',')}:profile=${profilePath}`,
    );
  }
  return {
    status: 'bound',
    authority: 'owned-process-group-plus-unique-profile-plus-listening-port-v0',
    debugPort: port,
    processGroupId,
    profilePath,
    listenerProcessIds,
    ownedListenerProcessIds: ownedListeners,
    targetId: target?.id || null,
    targetType: target?.type || null,
    targetUrl: target?.url || null,
  };
}

async function cleanupOwnedBrowserProcessGroup(browserProcess, profilePath) {
  if (!browserProcess?.pid) {
    return {
      status: 'not-launched',
      signalSequence: [],
      before: [],
      remaining: [],
      profilePath,
      profileRemoved: false,
    };
  }
  const processGroupId = browserProcess.pid;
  const signalSequence = [];
  let before = [];
  try {
    before = ownedBrowserProcesses(processGroupId, profilePath);
    signalOwnedBrowserProcessGroup(processGroupId, 'SIGTERM');
    signalSequence.push('SIGTERM');
    let remaining = await waitForOwnedBrowserProcesses(processGroupId, profilePath, 5_000);
    if (remaining.length > 0) {
      signalOwnedBrowserProcessGroup(processGroupId, 'SIGKILL');
      signalSequence.push('SIGKILL');
      remaining = await waitForOwnedBrowserProcesses(processGroupId, profilePath, 2_000);
    }
    const complete = remaining.length === 0;
    if (complete) rmSync(profilePath, { recursive: true, force: true });
    return {
      status: complete ? 'complete' : 'failed',
      signalSequence,
      before,
      remaining,
      profilePath,
      profileRemoved: complete && !existsSync(profilePath),
    };
  } catch (error) {
    return {
      status: 'failed',
      signalSequence,
      before,
      remaining: safeOwnedBrowserProcesses(processGroupId, profilePath),
      profilePath,
      profileRemoved: false,
      error: error?.stack || String(error),
    };
  }
}

function signalOwnedBrowserProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

async function waitForOwnedBrowserProcesses(processGroupId, profilePath, timeout) {
  const started = performance.now();
  let remaining = ownedBrowserProcesses(processGroupId, profilePath);
  while (remaining.length > 0 && performance.now() - started < timeout) {
    await delay(100);
    remaining = ownedBrowserProcesses(processGroupId, profilePath);
  }
  return remaining;
}

function safeOwnedBrowserProcesses(processGroupId, profilePath) {
  try {
    return ownedBrowserProcesses(processGroupId, profilePath);
  } catch {
    return [];
  }
}

function ownedBrowserProcesses(processGroupId, profilePath) {
  return processTable().filter(row =>
    row.processGroupId === processGroupId
    || row.command.includes(`--user-data-dir=${profilePath}`)
    || row.command.includes(profilePath));
}

function processTable() {
  const output = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' });
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      processGroupId: Number(match[3]),
      command: match[4],
    }];
  });
}

async function waitForTarget(debugPortValue, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPortValue}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const target = targets.find(candidate =>
          candidate.type === 'page' && !String(candidate.url).startsWith('chrome-extension://'));
        if (target?.webSocketDebuggerUrl) return target;
      }
    } catch {}
    await delay(100);
  }
  throw new Error('Chrome debugging target did not appear');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'runtime evaluation failed');
  }
  return result.result.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
