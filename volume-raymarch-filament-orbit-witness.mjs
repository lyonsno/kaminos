#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { validateCameraHoldoutReport } from './boundary-splat-camera-holdout-oracle.mjs';
import { validateSplatRadianceParityReport } from './volume-splat-radiance-parity-contract.mjs';
import {
  validateSplatOpticalRecurrenceReport,
  writeSplatOpticalRecurrenceFailureReport,
} from './volume-splat-optical-recurrence-contract.mjs';

const SCHEMA = 'kaminos.volume.raymarch-filament-orbit-witness.v0';
const WRAPPER_ROUTE = 'exact-basin-selective-head-live-v0';
const RENDERER_ROUTE = 'native-3d-compute-fluid-raymarch-v0';
const PRESET_ID = 'vsp-5d9fedbab31583860d39a34751ff5cd847116cd6fe6eeee6b4379909ef4bb2a2';
const PRESET_AUTHORITY = 'shared-volume-settings-preset-v2';
const SUPPORT_AUTHORITY = 'state-derived-direct-flame-candidate-support-allocation-v0';
const NON_RIDGE_TARGET = 'nonnegative-non-ridge-flame-emission-coefficient-v0';
const ANALYTIC_SPLAT_RENDERER = 'live-boundary-sidecar-analytic-splats-v0';
const FULL_FLAME_TARGET = 'smoke-off-complete-flame-local-emission-extinction-v0';
const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-raymarch-filament-orbit'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const captureReportPath = resolve(`${outDir}/capture-report.json`);
const holdoutReportPath = resolve(String(args.get('--holdout-report') || `${outDir}/camera-holdout-report.json`));
const radianceParityReportPath = resolve(String(args.get('--radiance-parity-report') || `${outDir}/radiance-parity-report.json`));
const opticalRecurrenceReportPath = resolve(String(args.get('--optical-recurrence-report') || `${outDir}/optical-recurrence-report.json`));
const opticalRecurrenceRequested = args.has('--optical-recurrence-report');
const sparseHybridRequested = args.has('--sparse-hybrid-scales');
const sparseHybridScales = sparseHybridRequested
  ? parseStrictNumberList(args.get('--sparse-hybrid-scales'), '--sparse-hybrid-scales')
  : [];
const rayStepCounts = parseIntegerList(args.get('--ray-steps') || '48,96,160');
const orbitAngles = parseNumberList(args.get('--orbit-angles') || '-0.42,-0.28,-0.14,0,0.14,0.28,0.42');
const expectedFrameCount = optionalInteger('--expected-frame-count');
const expectedSimStepCount = optionalInteger('--expected-sim-step-count');
const expectedControlsHash = args.get('--expected-controls-hash') ? String(args.get('--expected-controls-hash')) : null;
const expectedWarmupAuthority = args.get('--expected-warmup-authority') ? String(args.get('--expected-warmup-authority')) : null;
const expectedWarmupTarget = optionalInteger('--expected-warmup-target');
const expectedAnchorFluidSha256 = optionalSha256('--expected-anchor-fluid-sha256');
const expectedAnchorFrontSha256 = optionalSha256('--expected-anchor-front-sha256');
const timeoutMs = Number(args.get('--timeout-ms') || 240000);
const settleMs = Number(args.get('--settle-ms') || 1800);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const keepBrowserOpen = args.has('--keep-browser-open');
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-raymarch-filament-orbit-profile-');
const runStartedAt = new Date().toISOString();

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {};

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });

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

try {
  if (args.errors.length) throw new Error(args.errors.join('; '));
  if (!requestedUrl) throw new Error('missing --url');
  const route = new URL(requestedUrl);
  const requestedPresetId = route.searchParams.get('settings_preset');
  const replayBridgeRequested = requestedPresetId === null;
  assert.equal(route.pathname, '/volume-selective-head-live.html', 'requested route must use the selective-head live wrapper');
  if (replayBridgeRequested) {
    assert.ok(expectedWarmupAuthority, 'checksum-anchor bridge must request an exact warmup authority');
    assert.ok(expectedWarmupTarget !== null && expectedWarmupTarget > 0, 'checksum-anchor bridge must request a positive exact warmup target');
    assert.ok(expectedAnchorFluidSha256 && expectedAnchorFrontSha256, 'checksum-anchor bridge must request both exact field hashes');
    assert.ok(expectedControlsHash, 'checksum-anchor bridge must request an exact controls hash');
    assert.equal(expectedFrameCount, expectedWarmupTarget, 'checksum-anchor bridge frame authority must equal the warmup target');
    assert.equal(expectedSimStepCount, expectedWarmupTarget, 'checksum-anchor bridge simulation authority must equal the warmup target');
    assert.equal(route.searchParams.get('warmup_steps'), String(expectedWarmupTarget), 'checksum-anchor bridge URL must request the exact warmup target');
    assert.equal(route.searchParams.get('freeze_after_warmup'), '1', 'checksum-anchor bridge must request exact post-warmup freeze');
    assert.equal(route.searchParams.get('settings_preset_authority'), null, 'checksum-anchor bridge cannot impersonate shared-preset visual admission');
  } else {
    assert.equal(requestedPresetId, PRESET_ID, 'requested route must pin the Flamebowl preset');
    assert.equal(route.searchParams.get('settings_preset_authority'), PRESET_AUTHORITY, 'requested route must pin preset authority');
    assert.equal(route.searchParams.get('warmup_steps'), '0', 'shared-preset visual admission must remain fresh-live');
  }
  assert.equal(route.searchParams.get('role'), 'truthHigh', 'requested role must be truthHigh');
  assert.equal(route.searchParams.get('composition'), 'raymarch-only-v0', 'requested initial composition must be raymarch-only-v0');
  assert.ok(rayStepCounts.length >= 2, 'at least two ray-step counts are required');
  assert.ok(orbitAngles.length >= 5, 'at least five orbit poses are required');
  assert.ok(rayStepCounts.every(value => value >= 24 && value <= 160), 'ray-step counts must be inside the live renderer range');
  if (sparseHybridRequested) {
    assert.equal(orbitAngles.length, 21, 'sparse hybrid witness requires the exact 21-camera frozen orbit');
    assert.ok(sparseHybridScales.every(value => value >= 0.05 && value <= 1), 'sparse hybrid scales must remain inside the renderer contract');
    assert.equal(new Set(sparseHybridScales).size, sparseHybridScales.length, 'sparse hybrid scales must be unique');
  }

  failurePhase = 'browser-launch';
  browser = spawn(chrome, [
    '--headless=new',
    '--enable-unsafe-webgpu',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=1440,960',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) browser.unref();

  const browserVersion = await waitForJson(`http://127.0.0.1:${debugPort}/json/version`, timeoutMs);
  const target = await waitForTarget(debugPort, timeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, timeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admitted = await waitForRuntime(socket, timeoutMs);
  lastTrustworthyEvidence = { admitted };
  assert.equal(admitted.routeIdentity, WRAPPER_ROUTE, 'requested/effective route disagreement at wrapper admission');
  assert.equal(admitted.status, 'running', 'wrapper did not settle on the requested route');
  if (replayBridgeRequested) {
    assert.equal(admitted.sourceSettingsPresetId, null, 'checksum-anchor bridge silently acquired a preset identity');
    assert.equal(admitted.sourceSettingsPresetAuthority, null, 'checksum-anchor bridge silently acquired preset authority');
    assert.equal(admitted.warmupAuthority, expectedWarmupAuthority, 'effective replay authority disagrees with requested bridge authority');
    assert.equal(admitted.warmupTarget, expectedWarmupTarget, 'effective replay target disagrees with requested bridge target');
    assert.equal(admitted.warmupComplete, true, 'checksum-anchor bridge did not complete before route admission');
    assert.equal(admitted.warmupReceipt?.ok, true, 'checksum-anchor bridge receipt is missing or failed');
    assert.equal(admitted.warmupReceipt?.authority, expectedWarmupAuthority, 'effective anchor receipt authority disagrees');
    assert.equal(admitted.warmupReceipt?.completedSteps, expectedWarmupTarget, 'effective anchor receipt step disagrees');
    assert.equal(admitted.warmupReceipt?.fluidSha256, expectedAnchorFluidSha256, 'effective fluid anchor hash disagrees');
    assert.equal(admitted.warmupReceipt?.frontSha256, expectedAnchorFrontSha256, 'effective front anchor hash disagrees');
    assert.equal(admitted.freezeAfterWarmupRequested, true, 'effective route dropped the post-warmup freeze request');
    assert.equal(admitted.postWarmupFreezeReceipt?.paused, true, 'effective route did not freeze immediately after anchor import');
    assert.equal(admitted.postWarmupFreezeReceipt?.frameCount, expectedWarmupTarget, 'effective post-warmup freeze frame disagrees');
    assert.equal(admitted.postWarmupFreezeReceipt?.simStepCount, expectedWarmupTarget, 'effective post-warmup freeze simulation step disagrees');
    assert.equal(admitted.configuredRole, 'truthHigh', 'frozen renderer role configuration disagrees');
    assert.equal(admitted.configuredComposition, 'raymarch-only-v0', 'frozen renderer composition configuration disagrees');
  } else {
    assert.equal(admitted.sourceSettingsPresetId, PRESET_ID, 'stale/default preset replaced requested preset');
    assert.equal(admitted.sourceSettingsPresetAuthority, PRESET_AUTHORITY, 'effective preset authority disagreement');
    assert.equal(admitted.effectiveRole, 'truthHigh', 'effective role disagreement');
    assert.equal(admitted.effectiveComposition, 'raymarch-only-v0', 'effective composition disagreement');
  }
  assert.equal(admitted.fallbackReason, null, 'renderer fallback at admission');
  assert.match(admitted.backend || '', /^WebGPU/, 'effective backend substituted away from WebGPU');
  await delay(settleMs);

  failurePhase = 'same-state-initialization';
  const initialization = await evaluate(socket, runtimeInitializationSource({ orbitAngles, rayStepCounts }));
  lastTrustworthyEvidence.initialization = initialization.summary;
  assert.equal(initialization.summary.wrapperRoute, WRAPPER_ROUTE, 'requested/effective route disagreement after pause');
  assert.equal(initialization.summary.effectiveRoute, RENDERER_ROUTE, 'requested/effective route disagreement in renderer');
  assert.equal(initialization.summary.smokeReceipt?.effectiveMode, 'off', 'smoke presentation did not become disabled');
  if (expectedWarmupAuthority !== null) assert.equal(initialization.summary.replayAuthority.warmupAuthority, expectedWarmupAuthority, 'effective replay authority changed after pause');
  if (expectedWarmupTarget !== null) assert.equal(initialization.summary.replayAuthority.warmupReceipt?.completedSteps, expectedWarmupTarget, 'effective replay step changed after pause');
  if (expectedAnchorFluidSha256 !== null) assert.equal(initialization.summary.replayAuthority.warmupReceipt?.fluidSha256, expectedAnchorFluidSha256, 'effective replay fluid hash changed after pause');
  if (expectedAnchorFrontSha256 !== null) assert.equal(initialization.summary.replayAuthority.warmupReceipt?.frontSha256, expectedAnchorFrontSha256, 'effective replay front hash changed after pause');
  if (expectedFrameCount !== null) assert.equal(initialization.summary.frozenState.baseFrameCount, expectedFrameCount, 'effective frozen frame count disagrees with requested authority');
  if (expectedSimStepCount !== null) assert.equal(initialization.summary.frozenState.baseSimStepCount, expectedSimStepCount, 'effective frozen simulation step disagrees with requested authority');
  if (expectedControlsHash !== null) assert.equal(initialization.summary.frozenState.controlsHash, expectedControlsHash, 'effective controls hash disagrees with requested authority');

  const captures = [];
  const maxRaySteps = Math.max(...rayStepCounts);
  if (sparseHybridRequested) {
    for (const camera of initialization.cameras) {
      for (const raymarchScale of sparseHybridScales) {
        failurePhase = `camera-${camera.index}-sparse-hybrid-${raymarchScale}`;
        captures.push(await captureAndPersist(camera, 'sparseHybridPresentation', maxRaySteps, raymarchScale));
      }
    }
  } else for (const camera of initialization.cameras) {
    failurePhase = `camera-${camera.index}-support`;
    captures.push(await captureAndPersist(camera, 'stateDerivedSupport', Math.max(...rayStepCounts)));
    failurePhase = `camera-${camera.index}-non-ridge-filaments`;
    captures.push(await captureAndPersist(camera, 'nonRidgeFilaments', Math.max(...rayStepCounts)));
    failurePhase = `camera-${camera.index}-analytic-splat`;
    captures.push(await captureAndPersist(camera, 'analyticSplat', Math.max(...rayStepCounts)));
    failurePhase = `camera-${camera.index}-analytic-conserved-billboard`;
    captures.push(await captureAndPersist(camera, 'analyticBillboard', Math.max(...rayStepCounts)));
    failurePhase = `camera-${camera.index}-learned-conserved-billboard`;
    captures.push(await captureAndPersist(camera, 'learnedBillboard', Math.max(...rayStepCounts)));
    failurePhase = `camera-${camera.index}-world-tangent-covariance`;
    captures.push(await captureAndPersist(camera, 'worldCovariance', maxRaySteps));
    failurePhase = `camera-${camera.index}-world-covariance-current-additive`;
    captures.push(await captureAndPersist(camera, 'worldCovarianceAdditive', maxRaySteps));
    failurePhase = `camera-${camera.index}-world-covariance-matched-presentation`;
    captures.push(await captureAndPersist(camera, 'worldCovarianceMatchedPresentation', maxRaySteps));
    if (opticalRecurrenceRequested) {
      failurePhase = `camera-${camera.index}-world-covariance-matched-optical-recurrence`;
      captures.push(await captureAndPersist(camera, 'worldCovarianceMatchedOpticalRecurrence', maxRaySteps));
    }
    failurePhase = `camera-${camera.index}-ridge-transport-ridge-extinction`;
    captures.push(await captureAndPersist(camera, 'ridgeTransportRidgeExtinction', maxRaySteps));
    failurePhase = `camera-${camera.index}-ridge-transport-total-extinction`;
    captures.push(await captureAndPersist(camera, 'ridgeTransportTotalExtinction', maxRaySteps));
    failurePhase = `camera-${camera.index}-non-ridge-transport-total-extinction`;
    captures.push(await captureAndPersist(camera, 'nonRidgeTransportTotalExtinction', maxRaySteps));
    failurePhase = `camera-${camera.index}-shared-transmittance-contribution-sum`;
    captures.push(await captureAndPersist(camera, 'sharedTransmittanceContributionSum', maxRaySteps));
    failurePhase = `camera-${camera.index}-positive-optical-recomposition-control`;
    captures.push(await captureAndPersist(camera, 'positiveOpticalRecomposition', maxRaySteps));
    for (const raySteps of rayStepCounts) {
      failurePhase = `camera-${camera.index}-raymarch-${raySteps}`;
      captures.push(await captureAndPersist(camera, 'raymarch', raySteps));
    }
  }

  if (sparseHybridRequested) {
    failurePhase = 'sparse-hybrid-gpu-profiles';
    const centerCamera = initialization.cameras.reduce((best, camera) => Math.abs(camera.angle) < Math.abs(best.angle) ? camera : best);
    const timingProfiles = [];
    for (const raymarchScale of sparseHybridScales) {
      const profile = await evaluate(socket, `window.__kaminosFilamentOrbitWitness.profileSparseHybrid(${JSON.stringify({ camera: centerCamera, raymarchScale })})`);
      assert.equal(profile.status, 'complete', `sparse hybrid GPU profile unavailable at scale ${raymarchScale}: ${profile.reason}`);
      assert.equal(profile.effectiveRaymarchScale, raymarchScale, 'sparse hybrid GPU profile scale substitution');
      timingProfiles.push(profile);
    }
    const firstCapture = captures[0];
    const sparseReport = {
      schema: 'kaminos.volume.sparse-hybrid-orbit-capture.v0',
      status: 'captured-awaiting-personal-inspection',
      conclusionScope: 'presentation-only-no-self-transmittance-claim-v0',
      runStartedAt,
      runCompletedAt: new Date().toISOString(),
      requestedUrl,
      requestedRoute: 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0',
      effectiveWrapperRoute: initialization.summary.wrapperRoute,
      effectiveRendererRoute: initialization.summary.effectiveRoute,
      commit: gitValue(['rev-parse', 'HEAD']),
      branch: gitValue(['branch', '--show-current']),
      worktree: process.cwd(),
      sourceSettingsPreset: initialization.summary.sourceSettingsPreset,
      replayAuthority: initialization.summary.replayAuthority,
      frozenState: initialization.summary.frozenState,
      orbit: {
        identity: '21-camera-frozen-orbit-v0',
        cameraCount: initialization.cameras.length,
        cameras: initialization.cameras,
      },
      scaleLadder: sparseHybridScales,
      raySteps: maxRaySteps,
      candidatePayload: {
        count: firstCapture.footprintAudit?.candidateCount,
        sha256: firstCapture.footprintAudit?.candidatePayloadSha256,
        coefficientSha256: firstCapture.footprintAudit?.coefficientPayloadSha256,
        covarianceSha256: firstCapture.footprintAudit?.covariancePayloadSha256,
      },
      captures: captures.map(({ pngDataUrl, ...capture }) => capture),
      timingProfiles,
      inspection: {
        personallyInspected: false,
        disposition: 'captured-awaiting-personal-inspection',
      },
      browserEvents: socket.browserEvents,
    };
    assert.ok(firstCapture.footprintAudit?.candidatePayloadSha256, 'sparse hybrid source payload hash missing');
    assert.ok(sparseReport.captures.every(capture => capture.sparseHybridPresentationReceipt?.fallbackReason == null), 'sparse hybrid route fallback present');
    assert.ok(sparseReport.captures.every(capture => capture.frameCount === sparseReport.frozenState.baseFrameCount && capture.simStepCount === sparseReport.frozenState.baseSimStepCount), 'sparse hybrid capture advanced simulator state');
    assert.ok(new Set(sparseReport.captures.map(capture => capture.cameraPoseHash)).size === 21, 'sparse hybrid camera orbit is partial or duplicated');
    writeFileSync(captureReportPath, JSON.stringify(sparseReport, null, 2));
    writeFileSync(reportPath, JSON.stringify(sparseReport, null, 2));
    console.log(JSON.stringify({
      status: sparseReport.status,
      report: reportPath,
      captureReport: captureReportPath,
      captureCount: sparseReport.captures.length,
      scaleLadder: sparseHybridScales,
      timingProfiles,
    }, null, 2));
  } else {
  failurePhase = 'frozen-repeat';
  const centerCamera = initialization.cameras.reduce((best, camera) => Math.abs(camera.angle) < Math.abs(best.angle) ? camera : best);
  const frozenRepeat = await captureAndPersist(centerCamera, 'raymarchRepeat', Math.max(...rayStepCounts));
  captures.push(frozenRepeat);

  failurePhase = 'filament-analysis';
  const filamentContinuity = await evaluate(socket, 'window.__kaminosFilamentOrbitWitness.analyze()');
  const covarianceAnalysis = await evaluate(socket, 'window.__kaminosFilamentOrbitWitness.analyzeCovariance()');
  const crossExtinctionAnalysis = await evaluate(socket, 'window.__kaminosFilamentOrbitWitness.analyzeCrossExtinction()');
  lastTrustworthyEvidence.captureCount = captures.length;
  lastTrustworthyEvidence.filamentContinuity = filamentContinuity.summary;

  const frozenDeterminism = await evaluate(socket, 'window.__kaminosFilamentOrbitWitness.frozenRepeat()');
  const finalState = await evaluate(socket, `(() => {
    const basinWindow = document.querySelector('#basin')?.contentWindow || window;
    const prototype = basinWindow.__kaminosVolumePrototype;
    const state = prototype?.debugState?.() || null;
    return {
      frameCount: state?.frameCount,
      simStepCount: state?.simStepCount,
      effectiveRoute: state?.effectiveRoute,
      backend: state?.backend,
      camera: basinWindow.kaminosCameraDebugState?.() || null,
    };
  })()`);

  const report = {
    schema: SCHEMA,
    status: 'completed',
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedUrl,
    requestedRoute: '/volume-selective-head-live.html',
    effectiveWrapperRoute: initialization.summary.wrapperRoute,
    effectiveRendererRoute: initialization.summary.effectiveRoute,
    sourceRouteAuthority: replayBridgeRequested
      ? 'checksum-anchor-bridge-explicit-controls-hash-v0'
      : 'shared-volume-settings-preset-v2',
    sourceSettingsPreset: initialization.summary.sourceSettingsPreset,
    replayAuthority: initialization.summary.replayAuthority,
    sourceAuthority: initialization.summary.sourceAuthority,
    commit: gitValue(['rev-parse', 'HEAD']),
    branch: gitValue(['branch', '--show-current']),
    worktree: process.cwd(),
    browser: {
      identity: 'single-owned-chrome-cdp-browser-v0',
      product: browserVersion.Browser || null,
      userAgent: browserVersion['User-Agent'] || null,
      debugPort,
      userDataDir,
      keptOpen: keepBrowserOpen,
    },
    captureConfig: {
      orbitAngles,
      rayStepCounts,
      smoke: 'off',
      simulatorAdvance: false,
      expectedFrameCount,
      expectedSimStepCount,
      expectedControlsHash,
      expectedWarmupAuthority,
      expectedWarmupTarget,
      expectedAnchorFluidSha256,
      expectedAnchorFrontSha256,
    },
    frozenState: initialization.summary.frozenState,
    finalState,
    captures: captures.map(({ pngDataUrl, ...capture }) => capture),
    frozenDeterminism,
    filamentContinuity,
    covarianceAnalysis,
    crossExtinctionAnalysis,
    inspectedArtifacts: captures.map(capture => capture.imagePath),
    falseClosureChecks: {
      rejectsRouteSubstitution: true,
      rejectsStaleDefaultPreset: true,
      rejectsRayStepDisagreement: true,
      rejectsStateEvolution: true,
      rejectsMissingPartialBlankCapture: true,
      rejectsCachedStaticOutput: true,
      rejectsRendererFallback: true,
    },
    browserEvents: socket.browserEvents,
  };
  rejectFalseClosure(report);
  writeFileSync(captureReportPath, JSON.stringify(report, null, 2));
  const captureMap = new Map(report.captures.map(capture => [capture.key, capture]));
  const familyModes = {
    'analytic-billboard': 'analyticBillboard',
    'learned-billboard': 'learnedBillboard',
    'world-tangent-covariance': 'worldCovariance',
  };
  const firstAudit = report.captures.find(capture => capture.footprintAudit)?.footprintAudit;
  failurePhase = 'radiance-parity-validation';
  const presentationArms = [
    ['current-additive-v0', 'worldCovarianceAdditive'],
    ['matched-presentation-v0', 'worldCovarianceMatchedPresentation'],
  ].map(([id, mode]) => {
    const armCaptures = initialization.cameras.map(camera => captureMap.get(`${camera.index}-${mode}-${maxRaySteps}`));
    const first = armCaptures[0];
    return {
      id,
      requestedRoute: id,
      effectiveRoute: first?.boundarySplatPresentationReceipt?.effectiveMode,
      targetFormat: id === 'current-additive-v0' ? 'rgba8unorm' : first?.boundarySplatPresentationReceipt?.targetFormat,
      resolveIdentity: first?.boundarySplatPresentationReceipt?.resolveIdentity,
      blendIdentity: first?.boundarySplatPresentationReceipt?.blendIdentity,
      intermediateClamped: first?.boundarySplatPresentationReceipt?.intermediateClamped,
      intermediateReadbackStatus: first?.boundarySplatPresentationReceipt?.intermediateReadbackStatus,
      fallbackReason: first?.boundarySplatPresentationReceipt?.fallbackReason ?? null,
      captures: armCaptures.map(capture => ({
        cameraIndex: capture.cameraIndex,
        cameraPoseHash: capture.cameraPoseHash,
        pixelHash: capture.pixelHash,
        candidateCount: capture.boundarySplatCandidateCount,
        candidatePayloadSha256: capture.footprintAudit?.candidatePayloadSha256,
        controlsSha256: initialization.summary.frozenState.controlsHash,
        nonblank: capture.metrics?.nonblank === true,
        imagePath: capture.imagePath,
        metrics: capture.metrics,
        hdrTelemetry: capture.boundarySplatPresentationReceipt?.hdrTelemetry || null,
      })),
    };
  });
  const radianceParityReport = {
    schema: 'kaminos.volume.splat-radiance-parity.v0',
    status: 'completed',
    failurePhase: null,
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute: '/volume-selective-head-live.html',
    effectiveWrapperRoute: report.effectiveWrapperRoute,
    effectiveRendererRoute: report.effectiveRendererRoute,
    backend: report.finalState.backend,
    cameraCount: initialization.cameras.length,
    curve: { exposure: 0.96, vignetteBase: 0.80, vignetteGain: 0.18, power: 0.84 },
    source: {
      commit: report.commit,
      sameStateCaptureId: report.frozenState.sameStateCaptureId,
      controlsSha256: report.frozenState.controlsHash,
      candidatePayloadSha256: firstAudit?.candidatePayloadSha256,
      candidateCount: firstAudit?.candidateCount,
      fluidSha256: report.replayAuthority.warmupReceipt?.fluidSha256,
      frontSha256: report.replayAuthority.warmupReceipt?.frontSha256,
    },
    arms: presentationArms,
  };
  validateSplatRadianceParityReport(radianceParityReport);
  writeFileSync(radianceParityReportPath, JSON.stringify(radianceParityReport, null, 2));
  lastTrustworthyEvidence.radianceParityReport = fileArtifact(radianceParityReportPath);

  if (opticalRecurrenceRequested) {
    failurePhase = 'optical-recurrence-validation';
  const firstCameraIndex = initialization.cameras[0]?.index;
  const opticalSourceAudit = captureMap.get(
    `${firstCameraIndex}-worldCovarianceMatchedPresentation-${maxRaySteps}`,
  )?.footprintAudit;
  const sourceHashes = {
    controlsSha256: report.frozenState.controlsHash,
    candidatePayloadSha256: opticalSourceAudit?.candidatePayloadSha256,
    supportSha256: opticalSourceAudit?.candidatePayloadSha256,
    coefficientSha256: opticalSourceAudit?.coefficientPayloadSha256,
    covarianceSha256: opticalSourceAudit?.covariancePayloadSha256,
  };
  const opticalArmCaptures = initialization.cameras.map(camera => (
    captureMap.get(`${camera.index}-worldCovarianceMatchedOpticalRecurrence-${maxRaySteps}`)
  ));
  const opticalTelemetry = opticalArmCaptures.map(capture => capture?.boundarySplatPresentationReceipt?.hdrTelemetry);
  assert.ok(opticalTelemetry.every(telemetry => telemetry?.status === 'complete'), 'optical recurrence telemetry is partial');
  assert.ok(opticalTelemetry.every(telemetry => telemetry.depthBins === 16), 'optical recurrence depth-bin configuration changed');
  assert.ok(opticalTelemetry.every(telemetry => telemetry.nonFiniteChannels === 0), 'optical recurrence intermediate contains non-finite channels');
  assert.ok(opticalTelemetry.every(telemetry => telemetry.overflowCount === 0), 'optical recurrence overflowed');
  const recurrenceCaptures = (mode) => initialization.cameras.map(camera => {
    const capture = captureMap.get(`${camera.index}-${mode}-${maxRaySteps}`);
    return {
      cameraIndex: capture.cameraIndex,
      cameraPoseHash: capture.cameraPoseHash,
      pixelHash: capture.pixelHash,
      candidateCount: capture.boundarySplatCandidateCount,
      controlsSha256: report.frozenState.controlsHash,
      candidatePayloadSha256: capture.footprintAudit?.candidatePayloadSha256,
      supportSha256: capture.footprintAudit?.candidatePayloadSha256,
      coefficientSha256: capture.footprintAudit?.coefficientPayloadSha256,
      covarianceSha256: capture.footprintAudit?.covariancePayloadSha256,
      nonblank: capture.metrics?.nonblank === true,
      imagePath: capture.imagePath,
      metrics: capture.metrics,
      hdrTelemetry: capture.boundarySplatPresentationReceipt?.hdrTelemetry || null,
    };
  });
  const matchedPresentationReceipt = captureMap.get(`${firstCameraIndex}-worldCovarianceMatchedPresentation-${maxRaySteps}`)?.boundarySplatPresentationReceipt;
  const matchedOpticalReceipt = captureMap.get(`${firstCameraIndex}-worldCovarianceMatchedOpticalRecurrence-${maxRaySteps}`)?.boundarySplatPresentationReceipt;
  const opticalRecurrenceReport = {
    schema: 'kaminos.volume.splat-optical-recurrence.v0',
    status: 'completed',
    failurePhase: null,
    runStartedAt,
    runCompletedAt: new Date().toISOString(),
    requestedRoute: '/volume-selective-head-live.html',
    effectiveWrapperRoute: report.effectiveWrapperRoute,
    effectiveRendererRoute: report.effectiveRendererRoute,
    backend: report.finalState.backend,
    cameraCount: initialization.cameras.length,
    source: {
      commit: report.commit,
      presentationBaselineCommit: '0859abf8d5b06359e4d2708f5b597c327b43c4af',
      sameStateCaptureId: report.frozenState.sameStateCaptureId,
      ...sourceHashes,
      candidateCount: opticalSourceAudit?.candidateCount,
      fluidSha256: report.replayAuthority.warmupReceipt?.fluidSha256,
      frontSha256: report.replayAuthority.warmupReceipt?.frontSha256,
    },
    arms: [
      {
        id: 'matched-presentation-v0',
        requestedRoute: 'matched-presentation-v0',
        effectiveRoute: matchedPresentationReceipt?.effectiveMode,
        targetFormat: matchedPresentationReceipt?.targetFormat,
        accumulationIdentity: matchedPresentationReceipt?.accumulationIdentity,
        transportIdentity: matchedPresentationReceipt?.transportIdentity,
        presentationIdentity: matchedPresentationReceipt?.resolveIdentity,
        fallbackReason: matchedPresentationReceipt?.fallbackReason ?? null,
        intermediateClamped: matchedPresentationReceipt?.intermediateClamped,
        captures: recurrenceCaptures('worldCovarianceMatchedPresentation'),
      },
      {
        id: 'matched-optical-recurrence-v0',
        requestedRoute: 'matched-optical-recurrence-v0',
        effectiveRoute: matchedOpticalReceipt?.effectiveMode,
        targetFormat: matchedOpticalReceipt?.targetFormat,
        layerFormat: matchedOpticalReceipt?.layerFormat,
        accumulationIdentity: matchedOpticalReceipt?.accumulationIdentity,
        transportIdentity: matchedOpticalReceipt?.transportIdentity,
        presentationIdentity: matchedOpticalReceipt?.resolveIdentity,
        depthBins: matchedOpticalReceipt?.depthBins,
        fallbackReason: matchedOpticalReceipt?.fallbackReason ?? null,
        intermediateClamped: matchedOpticalReceipt?.intermediateClamped,
        intermediateReadbackStatus: opticalTelemetry.every(telemetry => telemetry.status === 'complete') ? 'complete' : 'partial',
        telemetry: {
          ...opticalTelemetry[0],
          activeDepthBins: Math.min(...opticalTelemetry.map(telemetry => telemetry.activeDepthBins)),
          capacity: Math.min(...opticalTelemetry.map(telemetry => telemetry.capacity)),
          overflowCount: Math.max(...opticalTelemetry.map(telemetry => telemetry.overflowCount)),
        },
        captures: recurrenceCaptures('worldCovarianceMatchedOpticalRecurrence'),
      },
    ],
  };
  validateSplatOpticalRecurrenceReport(opticalRecurrenceReport);
  writeFileSync(opticalRecurrenceReportPath, JSON.stringify(opticalRecurrenceReport, null, 2));
    lastTrustworthyEvidence.opticalRecurrenceReport = fileArtifact(opticalRecurrenceReportPath);
  }
  const cameraRows = [];
  for (const camera of initialization.cameras) {
    const targetCapture = captureMap.get(`${camera.index}-raymarch-${maxRaySteps}`);
    for (const [family, mode] of Object.entries(familyModes)) {
      const capture = captureMap.get(`${camera.index}-${mode}-${maxRaySteps}`);
      const metrics = covarianceAnalysis.rows.find(row => row.cameraIndex === camera.index && row.mode === mode);
      cameraRows.push({
        cameraIndex: camera.index,
        cameraAngle: camera.angle,
        cameraPoseHash: capture.cameraPoseHash,
        family,
        familyAuthority: capture.footprintAudit.footprintAuthority,
        rendererFootprintAuthority: capture.boundarySplatFootprintAuthority,
        auditFootprintAuthority: capture.footprintAudit.footprintAuthority,
        attributeSetId: capture.footprintAudit.attributeSetId,
        attributePayloadAuthority: capture.footprintAudit.attributePayloadAuthority,
        attributePayloadSha256: capture.footprintAudit.attributePayloadSha256,
        candidateCount: capture.boundarySplatCandidateCount,
        instanceCount: capture.boundarySplatInstanceCount,
        overflowCount: capture.boundarySplatOverflowCount,
        candidatePayloadSha256: capture.footprintAudit.candidatePayloadSha256,
        fallbackReason: capture.boundarySplatFallbackReason,
        targetAuthority: FULL_FLAME_TARGET,
        target: fileArtifact(targetCapture.imagePath),
        image: fileArtifact(capture.imagePath),
        conservation: {
          authority: capture.footprintAudit.authority,
          baseIntegratedAlphaSum: capture.footprintAudit.baseIntegratedAlphaSum,
          effectiveIntegratedAlphaSum: capture.footprintAudit.effectiveIntegratedAlphaSum,
          relativeError: capture.footprintAudit.relativeError,
        },
        metrics,
      });
    }
  }
  const centerCameraIndex = centerCamera.index;
  const holdoutReport = {
    schema: 'kaminos.boundary-splat-camera-holdout-oracle.v0',
    status: 'completed',
    requestedRoute: '/volume-selective-head-live.html',
    effectiveWrapperRoute: initialization.summary.wrapperRoute,
    effectiveRendererRoute: initialization.summary.effectiveRoute,
    backend: report.captures[0]?.backend || null,
    fallbackReason: null,
    sourceSettingsPreset: initialization.summary.sourceSettingsPreset,
    sourceRouteAuthority: report.sourceRouteAuthority,
    replayAuthority: initialization.summary.replayAuthority,
    frozenState: {
      sameStateCaptureId: initialization.summary.frozenState.sameStateCaptureId,
      frameCount: initialization.summary.frozenState.baseFrameCount,
      simStepCount: initialization.summary.frozenState.baseSimStepCount,
      controlsHash: initialization.summary.frozenState.controlsHash,
    },
    candidatePayload: {
      authority: 'gpu-compacted-boundary-splat-candidates-frozen-state-v0',
      count: firstAudit.candidateCount,
      strideFloats: 4,
      sha256: firstAudit.candidatePayloadSha256,
    },
    trainCameraIndices: [centerCameraIndex],
    heldOutCameraIndices: initialization.cameras.map(camera => camera.index).filter(index => index !== centerCameraIndex),
    covarianceCeiling: 'world-gradient-tangent-plane-diagonal-covariance-no-free-3d-rotation-v0',
    supportCeiling: 'current-structural-ridge-owned-candidates-omit-legitimate-non-ridge-full-flame-filaments-v0',
    cameraRows,
    summary: covarianceAnalysis.summary,
    sourceOrbitReport: captureReportPath,
  };
  await validateCameraHoldoutReport(holdoutReport, { expectedCameraCount: initialization.cameras.length });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  writeFileSync(holdoutReportPath, JSON.stringify(holdoutReport, null, 2));
  console.log(JSON.stringify({
    status: report.status,
    report: reportPath,
    holdoutReport: holdoutReportPath,
    radianceParityReport: radianceParityReportPath,
    opticalRecurrenceReport: opticalRecurrenceRequested ? opticalRecurrenceReportPath : null,
    captureCount: report.captures.length,
    frozenDeterminism: report.frozenDeterminism,
    filamentSummary: report.filamentContinuity.summary,
    crossExtinctionSummary: report.crossExtinctionAnalysis.summary,
  }, null, 2));
  }
} catch (error) {
  const failureReport = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    rayStepCounts,
    orbitAngles,
    commit: gitValue(['rev-parse', 'HEAD']),
    worktree: process.cwd(),
    lastTrustworthyEvidence,
  };
  if (existsSync(captureReportPath)) {
    failureReport.lastTrustworthyEvidence.captureReport = fileArtifact(captureReportPath);
  }
  if (args.has('--radiance-parity-report')) {
    writeFileSync(radianceParityReportPath, JSON.stringify({
      schema: 'kaminos.volume.splat-radiance-parity.v0',
      status: 'failed',
      failurePhase,
      error: failureReport.error,
      requestedRoute: '/volume-selective-head-live.html',
      lastTrustworthyEvidence,
    }, null, 2));
  }
  if (opticalRecurrenceRequested) {
    writeSplatOpticalRecurrenceFailureReport(opticalRecurrenceReportPath, {
      schema: 'kaminos.volume.splat-optical-recurrence.v0',
      status: 'failed',
      failurePhase,
      error: failureReport.error,
      requestedRoute: '/volume-selective-head-live.html',
      lastTrustworthyEvidence,
    });
  }
  writeFileSync(reportPath, JSON.stringify(failureReport, null, 2));
  console.error(JSON.stringify(failureReport, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (!keepBrowserOpen) browser?.kill('SIGTERM');
}

async function captureAndPersist(camera, mode, raySteps, raymarchScale = null) {
  const scaleSuffix = raymarchScale === null ? '' : `-scale-${raymarchScale}`;
  const key = `${camera.index}-${mode}-${raySteps}${scaleSuffix}`;
  const capture = await evaluate(socket, `window.__kaminosFilamentOrbitWitness.capture(${JSON.stringify({ key, camera, mode, raySteps, raymarchScale })})`);
  const filename = `camera-${String(camera.index).padStart(2, '0')}-${mode}-${raySteps}${scaleSuffix}.png`;
  const imagePath = resolve(outDir, filename);
  writeDataUrl(imagePath, capture.pngDataUrl);
  const persisted = { ...capture, imagePath };
  delete persisted.pngDataUrl;
  lastTrustworthyEvidence.lastCapture = persisted;
  return { ...persisted, pngDataUrl: capture.pngDataUrl };
}

function runtimeInitializationSource(config) {
  return `
    (async () => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = basinWindow.__kaminosVolumePrototype;
      if (!operator?.debugState || !prototype?.debugState || !prototype?.sampleFrame || !prototype?.renderFrozenScaleToCanvas || !prototype?.sampleSparseHybridPresentationGpuProfile || !basinWindow.kaminosSetCameraDebugPose) {
        throw new Error('filament-orbit-runtime-api-missing');
      }
      const digest = async value => {
        const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      };
      const luma = (rgba, index) => 0.2126 * rgba[index] + 0.7152 * rgba[index + 1] + 0.0722 * rgba[index + 2];
      const pngDataUrl = image => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        canvas.getContext('2d').putImageData(new ImageData(Uint8ClampedArray.from(image.rgba), image.width, image.height), 0, 0);
        return canvas.toDataURL('image/png');
      };
      const pixelMetrics = image => {
        let litPixels = 0;
        let lumaSum = 0;
        let maxLuma = 0;
        for (let index = 0; index < image.rgba.length; index += 4) {
          const value = luma(image.rgba, index);
          if (value > 8) litPixels += 1;
          lumaSum += value;
          maxLuma = Math.max(maxLuma, value);
        }
        return { litPixels, meanLuma: lumaSum / Math.max(1, image.width * image.height), maxLuma, nonblank: litPixels > 64 };
      };
      const pixelDelta = (left, right) => {
        if (!left || !right || left.length !== right.length) throw new Error('pixel-delta-shape-mismatch');
        let maxChannelDelta = 0;
        let absoluteDelta = 0;
        let changedPixels = 0;
        for (let index = 0; index < left.length; index += 4) {
          let changed = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs(left[index + channel] - right[index + channel]);
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            absoluteDelta += delta;
            changed ||= delta !== 0;
          }
          changedPixels += changed ? 1 : 0;
        }
        return {
          maxChannelDelta,
          meanAbsChannelDelta: absoluteDelta / Math.max(1, left.length),
          changedPixels,
          changedFraction: changedPixels / Math.max(1, left.length / 4),
        };
      };
      const maskedPixelDelta = (left, right, mask) => {
        if (!left || !right || !mask || left.length !== right.length || left.length !== mask.length) throw new Error('masked-pixel-delta-shape-mismatch');
        let maxChannelDelta = 0;
        let absoluteDelta = 0;
        let changedPixels = 0;
        let selectedPixels = 0;
        for (let index = 0; index < left.length; index += 4) {
          if (luma(mask, index) <= 8) continue;
          selectedPixels += 1;
          let changed = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs(left[index + channel] - right[index + channel]);
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            absoluteDelta += delta;
            changed ||= delta !== 0;
          }
          changedPixels += changed ? 1 : 0;
        }
        if (selectedPixels === 0) throw new Error('support-aligned-mask-is-empty');
        return {
          maxChannelDelta,
          meanAbsChannelDelta: absoluteDelta / (selectedPixels * 4),
          changedPixels,
          changedFraction: changedPixels / selectedPixels,
          selectedPixels,
        };
      };
      const filamentComponents = (support, raymarch, analytic, stateSupport, cameraIndex, raySteps) => {
        const width = support.width;
        const height = support.height;
        const supportLuma = new Float32Array(width * height);
        const rayLuma = new Float32Array(width * height);
        const analyticLuma = new Float32Array(width * height);
        const stateSupportLuma = new Float32Array(width * height);
        const nonzero = [];
        for (let pixel = 0; pixel < width * height; pixel += 1) {
          supportLuma[pixel] = luma(support.rgba, pixel * 4);
          rayLuma[pixel] = luma(raymarch.rgba, pixel * 4);
          analyticLuma[pixel] = luma(analytic.rgba, pixel * 4);
          stateSupportLuma[pixel] = luma(stateSupport.rgba, pixel * 4);
          if (supportLuma[pixel] > 2) nonzero.push(supportLuma[pixel]);
        }
        nonzero.sort((a, b) => a - b);
        const threshold = Math.max(12, nonzero[Math.floor(nonzero.length * 0.58)] || 12);
        const mask = new Uint8Array(width * height);
        for (let y = 1; y < height - 1; y += 1) {
          for (let x = 1; x < width - 1; x += 1) {
            const pixel = y * width + x;
            let neighborhood = 0;
            for (let oy = -2; oy <= 2; oy += 1) {
              for (let ox = -2; ox <= 2; ox += 1) neighborhood += supportLuma[(y + oy) * width + x + ox];
            }
            const localContrast = supportLuma[pixel] - neighborhood / 25;
            mask[pixel] = supportLuma[pixel] >= threshold && (localContrast >= 2.5 || supportLuma[pixel] >= threshold * 1.45) ? 1 : 0;
          }
        }
        const seen = new Uint8Array(mask.length);
        const components = [];
        const neighbors = [-width - 1, -width, -width + 1, -1, 1, width - 1, width, width + 1];
        for (let seed = 0; seed < mask.length; seed += 1) {
          if (!mask[seed] || seen[seed]) continue;
          const queue = [seed];
          seen[seed] = 1;
          const pixels = [];
          let minX = width;
          let maxX = 0;
          let minY = height;
          let maxY = 0;
          while (queue.length) {
            const pixel = queue.pop();
            pixels.push(pixel);
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            minX = Math.min(minX, x); maxX = Math.max(maxX, x);
            minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            for (const offset of neighbors) {
              const next = pixel + offset;
              if (next < 0 || next >= mask.length || seen[next] || !mask[next]) continue;
              const nx = next % width;
              if (Math.abs(nx - x) > 1) continue;
              seen[next] = 1;
              queue.push(next);
            }
          }
          if (pixels.length < 6) continue;
          const rayThreshold = 12;
          const analyticThreshold = 8;
          const rayPixels = pixels.filter(pixel => rayLuma[pixel] >= rayThreshold).length;
          const analyticPixels = pixels.filter(pixel => analyticLuma[pixel] >= analyticThreshold).length;
          const stateSupportPixels = pixels.filter(pixel => stateSupportLuma[pixel] >= analyticThreshold).length;
          const targetLumaSum = pixels.reduce((sum, pixel) => sum + supportLuma[pixel], 0);
          const raymarchLumaSum = pixels.reduce((sum, pixel) => sum + rayLuma[pixel], 0);
          const analyticLumaSum = pixels.reduce((sum, pixel) => sum + analyticLuma[pixel], 0);
          const stateSupportLumaSum = pixels.reduce((sum, pixel) => sum + stateSupportLuma[pixel], 0);
          const rayCoverage = rayPixels / pixels.length;
          const analyticCoverage = analyticPixels / pixels.length;
          const majorSpan = Math.max(maxX - minX + 1, maxY - minY + 1);
          components.push({
            id: 'camera-' + String(cameraIndex).padStart(2, '0') + '-step-' + raySteps + '-filament-' + String(components.length).padStart(3, '0'),
            bbox: { minX, minY, maxX, maxY },
            supportPixels: pixels.length,
            supportWidthProxy: pixels.length / Math.max(1, majorSpan),
            raymarchPixels: rayPixels,
            raymarchCoverage: rayCoverage,
            raymarchWidthProxy: rayPixels / Math.max(1, majorSpan),
            analyticSplatPixels: analyticPixels,
            analyticSplatCoverage: analyticCoverage,
            stateDerivedSupportPixels: stateSupportPixels,
            stateDerivedSupportCoverage: stateSupportPixels / pixels.length,
            raymarchToTargetIntensityRatio: raymarchLumaSum / Math.max(1, targetLumaSum),
            analyticSplatToTargetIntensityRatio: analyticLumaSum / Math.max(1, targetLumaSum),
            stateDerivedSupportToTargetIntensityRatio: stateSupportLumaSum / Math.max(1, targetLumaSum),
            classification: rayCoverage < 0.25 ? 'omitted' : (rayCoverage < 0.65 ? 'partial' : 'present'),
          });
        }
        components.sort((a, b) => b.supportPixels - a.supportPixels);
        const kept = components.slice(0, 80);
        return {
          supportThreshold: threshold,
          componentCount: kept.length,
          omittedCount: kept.filter(component => component.classification === 'omitted').length,
          partialCount: kept.filter(component => component.classification === 'partial').length,
          presentCount: kept.filter(component => component.classification === 'present').length,
          meanRaymarchCoverage: kept.reduce((sum, component) => sum + component.raymarchCoverage, 0) / Math.max(1, kept.length),
          meanAnalyticSplatCoverage: kept.reduce((sum, component) => sum + component.analyticSplatCoverage, 0) / Math.max(1, kept.length),
          meanStateDerivedSupportCoverage: kept.reduce((sum, component) => sum + component.stateDerivedSupportCoverage, 0) / Math.max(1, kept.length),
          meanRaymarchToTargetIntensityRatio: kept.reduce((sum, component) => sum + component.raymarchToTargetIntensityRatio, 0) / Math.max(1, kept.length),
          meanAnalyticSplatToTargetIntensityRatio: kept.reduce((sum, component) => sum + component.analyticSplatToTargetIntensityRatio, 0) / Math.max(1, kept.length),
          meanStateDerivedSupportToTargetIntensityRatio: kept.reduce((sum, component) => sum + component.stateDerivedSupportToTargetIntensityRatio, 0) / Math.max(1, kept.length),
          meanRaymarchWidthProxy: kept.reduce((sum, component) => sum + component.raymarchWidthProxy, 0) / Math.max(1, kept.length),
          components: kept,
        };
      };

      operator.setCapturePaused(true);
      await new Promise(resolve => setTimeout(resolve, 120));
      operator.setPresentation('beauty');
      operator.setAppearanceAssay('off');
      operator.setComposition('raymarch-only-v0');
      const smokeReceipt = prototype.setRaymarchSmokePresentationMode('off');
      const before = prototype.debugState();
      const wrapperBefore = operator.debugState();
      const originalCamera = basinWindow.kaminosCameraDebugState();
      const baseFrameCount = before.frameCount;
      const baseSimStepCount = before.simStepCount;
      const sameStateCaptureId = 'filament-orbit-f' + baseFrameCount + '-s' + baseSimStepCount;
      const fixedNow = performance.now();
      const controlsHash = await digest(before.controls);
      const sourceSettingsPreset = {
        presetId: wrapperBefore.sourceSettingsPresetId,
        authority: wrapperBefore.sourceSettingsPresetAuthority,
        contentHash: wrapperBefore.sourceSettingsPresetContentHash,
        label: wrapperBefore.sourceSettingsPresetLabel,
        controlCount: wrapperBefore.sourceSettingsPresetControlCount,
      };
      const dx = originalCamera.position[0] - originalCamera.target[0];
      const dz = originalCamera.position[2] - originalCamera.target[2];
      const cameras = ${JSON.stringify(config.orbitAngles)}.map((angle, index) => ({
        index,
        angle,
        pose: {
          position: [
            originalCamera.target[0] + dx * Math.cos(angle) - dz * Math.sin(angle),
            originalCamera.position[1],
            originalCamera.target[2] + dx * Math.sin(angle) + dz * Math.cos(angle),
          ],
          target: [...originalCamera.target],
        },
      }));
      const captures = new Map();
      const expectedTransportMasks = {
        ridgeTransportRidgeExtinction: { mode: 'ridge-transport-ridge-extinction', emissionMask: 'ridge-owned', extinctionMask: 'ridge-owned' },
        ridgeTransportTotalExtinction: { mode: 'ridge-transport-total-extinction', emissionMask: 'ridge-owned', extinctionMask: 'complete-flame' },
        nonRidgeTransportTotalExtinction: { mode: 'non-ridge-transport-total-extinction', emissionMask: 'non-ridge', extinctionMask: 'complete-flame' },
        sharedTransmittanceContributionSum: { mode: 'shared-transmittance-contribution-sum', emissionMask: 'ridge-owned-plus-non-ridge', extinctionMask: 'complete-flame' },
      };

      async function capture(request) {
        basinWindow.kaminosSetCameraDebugPose(request.camera.pose);
        prototype.setControls({ raySteps: request.raySteps });
        let modeAuthority = null;
        if (request.mode === 'stateDerivedSupport') {
          operator.setPresentation('beauty');
          operator.setComposition('raymarch-only-v0');
          const receipt = operator.setAppearanceAssay('ridge-owned-emission');
          modeAuthority = receipt?.ridgeOwnershipIdentity || receipt?.targetIdentity || null;
        } else if (request.mode === 'nonRidgeFilaments') {
          operator.setPresentation('beauty');
          operator.setComposition('raymarch-only-v0');
          const receipt = operator.setAppearanceAssay('non-ridge-emission');
          modeAuthority = receipt?.targetIdentity || null;
        } else if (request.mode === 'analyticSplat') {
          operator.setAppearanceAssay('off');
          operator.setPresentation('beauty');
          prototype.setControls({ boundarySplatMode: 'analytic', raySteps: request.raySteps });
          operator.setComposition('splat-only-v0');
          modeAuthority = '${ANALYTIC_SPLAT_RENDERER}';
        } else if (request.mode === 'analyticBillboard') {
          operator.setAppearanceAssay('off');
          operator.setPresentation('beauty');
          prototype.setControls({ boundarySplatMode: 'analytic_conserved', raySteps: request.raySteps });
          operator.setComposition('splat-only-v0');
          modeAuthority = 'camera-facing-billboard-v0';
        } else if (request.mode === 'learnedBillboard') {
          operator.setAppearanceAssay('off');
          operator.setPresentation('beauty');
          prototype.setControls({ boundarySplatMode: 'learned_conserved', raySteps: request.raySteps });
          operator.setComposition('splat-only-v0');
          modeAuthority = 'learned-camera-facing-billboard-v0';
        } else if (request.mode === 'sparseHybridPresentation') {
          operator.setAppearanceAssay('off');
          operator.setPresentation('beauty');
          prototype.setControls({ boundarySplatMode: 'world_covariance', raySteps: request.raySteps });
          prototype.setBoundarySplatPresentationMode('matched-presentation-v0');
          operator.setComposition('splat-only-v0');
          modeAuthority = 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0';
        } else if (request.mode === 'worldCovariance'
          || request.mode === 'worldCovarianceAdditive'
          || request.mode === 'worldCovarianceMatchedPresentation'
          || request.mode === 'worldCovarianceMatchedOpticalRecurrence') {
          operator.setAppearanceAssay('off');
          operator.setPresentation('beauty');
          prototype.setControls({ boundarySplatMode: 'world_covariance', raySteps: request.raySteps });
          prototype.setBoundarySplatPresentationMode(
            request.mode === 'worldCovarianceMatchedOpticalRecurrence'
              ? 'matched-optical-recurrence-v0'
              : (request.mode === 'worldCovarianceMatchedPresentation' ? 'matched-presentation-v0' : 'current-additive-v0'),
          );
          operator.setComposition('splat-only-v0');
          modeAuthority = 'world-gradient-tangent-covariance-v0';
        } else if (expectedTransportMasks[request.mode]) {
          operator.setPresentation('beauty');
          operator.setComposition('raymarch-only-v0');
          const receipt = operator.setAppearanceAssay(expectedTransportMasks[request.mode].mode);
          modeAuthority = receipt?.targetIdentity || null;
        } else if (request.mode === 'positiveOpticalRecomposition') {
          operator.setPresentation('beauty');
          operator.setComposition('raymarch-only-v0');
          const receipt = operator.setAppearanceAssay('positive-optical-recomposition');
          modeAuthority = receipt?.targetIdentity || null;
        } else {
          operator.setAppearanceAssay('off');
          operator.setPresentation('beauty');
          operator.setComposition('raymarch-only-v0');
          modeAuthority = 'smoke-off-complete-flame-raymarch-v0';
        }
        const smoke = prototype.setRaymarchSmokePresentationMode('off');
        const cameraPose = basinWindow.kaminosCameraDebugState();
        let sample;
        if (request.mode === 'sparseHybridPresentation') {
          const rendered = await prototype.renderFrozenScaleToCanvas({
            boundarySplatComposition: 'coarse-residual-raymarch-under-full-resolution-splats-presentation-assay-v0',
            coarseResidualRaymarchScale: request.raymarchScale,
            coarseResidualRaymarchAuthority: 'non-ridge-contribution-under-complete-flame-transmittance-v0',
            controlOverrides: { raySteps: request.raySteps, temporalAccum: 0, temporalJitter: 0, gridOverlay: 0 },
            now: fixedNow,
            sameStateCaptureId,
            baseFrameCount,
            baseSimStepCount,
            resumeRenderLoop: false,
          });
          if (!rendered.ok) throw new Error('sparse hybrid render failed: ' + (rendered.reason || request.key));
          const sourceCanvas = prototype.canvasElement();
          const canvasPngDataUrl = sourceCanvas.toDataURL('image/png');
          const serializedImage = new Image();
          serializedImage.src = canvasPngDataUrl;
          await serializedImage.decode();
          const readbackCanvas = document.createElement('canvas');
          readbackCanvas.width = sourceCanvas.width;
          readbackCanvas.height = sourceCanvas.height;
          const context2d = readbackCanvas.getContext('2d', { willReadFrequently: true });
          context2d.drawImage(serializedImage, 0, 0);
          const image = context2d.getImageData(0, 0, readbackCanvas.width, readbackCanvas.height);
          const after = prototype.debugState();
          sample = {
            ...after,
            ...rendered,
            ok: true,
            image: { width: image.width, height: image.height, rgba: [...image.data] },
            canvasPngDataUrl,
            controls: after.controls,
            sparseHybridPresentationReceipt: rendered.sparseHybridPresentationReceipt,
          };
        } else {
          sample = await prototype.sampleFrame({
            advanceSim: false,
            includeRgba: true,
            now: fixedNow,
            sameStateCaptureId,
            baseFrameCount,
            baseSimStepCount,
          });
        }
        if (!sample.ok || !sample.image?.rgba?.length) throw new Error('missing, partial, or blank capture: ' + request.key);
        const rgba = Uint8Array.from(sample.image.rgba);
        const metrics = pixelMetrics({ ...sample.image, rgba });
        if (!metrics.nonblank) throw new Error('missing, partial, or blank capture: ' + request.key);
        const effectiveRaySteps = sample.volumePresentationReceipt?.effectiveRayQuality?.raySteps ?? sample.controls?.raySteps ?? null;
        const footprintAudit = ['analyticBillboard', 'learnedBillboard', 'worldCovariance', 'worldCovarianceAdditive', 'worldCovarianceMatchedPresentation', 'worldCovarianceMatchedOpticalRecurrence', 'sparseHybridPresentation'].includes(request.mode)
          ? await prototype.sampleBoundarySplatFootprintAudit()
          : null;
        const record = {
          key: request.key,
          cameraIndex: request.camera.index,
          cameraAngle: request.camera.angle,
          mode: request.mode,
          requestedRaymarchScale: request.raymarchScale,
          requestedRaySteps: request.raySteps,
          effectiveRaySteps,
          sameStateCaptureId,
          frameCount: sample.frameCount,
          simStepCount: sample.simStepCount,
          cameraPose,
          cameraPoseHash: await digest(cameraPose),
          pixelHash: await digest(rgba),
          width: sample.image.width,
          height: sample.image.height,
          metrics,
          requestedRoute: '/volume-selective-head-live.html',
          effectiveRoute: sample.effectiveRoute,
          backend: sample.backend,
          modeAuthority,
          boundarySplatRendererIdentity: sample.boundarySplatRendererIdentity,
          boundarySplatFootprintAuthority: sample.boundarySplatFootprintAuthority,
          boundarySplatAreaOpacityConservationAuthority: sample.boundarySplatAreaOpacityConservationAuthority,
          footprintAudit,
          boundarySplatSourceAuthority: sample.boundarySplatSourceAuthority,
          boundarySplatCandidateCount: sample.boundarySplatCandidateCount,
          boundarySplatInstanceCount: sample.boundarySplatInstanceCount,
          boundarySplatOverflowCount: sample.boundarySplatOverflowCount,
          boundarySplatFallbackReason: sample.boundarySplatFallbackReason,
          boundarySplatPresentationReceipt: sample.boundarySplatPresentationReceipt,
          sparseHybridPresentationReceipt: sample.sparseHybridPresentationReceipt,
          volumePresentationReceipt: sample.volumePresentationReceipt,
          raymarchSmokePresentationReceipt: sample.raymarchSmokePresentationReceipt,
          appearanceDecompositionReceipt: sample.appearanceDecompositionReceipt,
          selectiveHeadLivePassReceipt: sample.selectiveHeadLivePassReceipt,
          pngDataUrl: sample.canvasPngDataUrl || pngDataUrl({ ...sample.image, rgba }),
        };
        const expectedMasks = expectedTransportMasks[request.mode];
        if (expectedMasks) {
          if (record.appearanceDecompositionReceipt?.effectiveMode !== expectedMasks.mode
            || record.appearanceDecompositionReceipt?.emissionMask !== expectedMasks.emissionMask
            || record.appearanceDecompositionReceipt?.extinctionMask !== expectedMasks.extinctionMask) {
            throw new Error('transport coefficient mask substitution: ' + request.key);
          }
        }
        captures.set(request.key, { ...record, rgba });
        return record;
      }

      async function profileSparseHybrid(request) {
        basinWindow.kaminosSetCameraDebugPose(request.camera.pose);
        operator.setAppearanceAssay('off');
        operator.setPresentation('beauty');
        prototype.setControls({ boundarySplatMode: 'world_covariance', raySteps: Math.max(...${JSON.stringify(config.rayStepCounts)}) });
        operator.setComposition('splat-only-v0');
        return prototype.sampleSparseHybridPresentationGpuProfile({
          coarseResidualRaymarchScale: request.raymarchScale,
          coarseResidualRaymarchAuthority: 'non-ridge-contribution-under-complete-flame-transmittance-v0',
          now: fixedNow,
        });
      }

      function analyze() {
        const rows = [];
        for (const camera of cameras) {
          const stateSupport = captures.get(camera.index + '-stateDerivedSupport-' + Math.max(...${JSON.stringify(config.rayStepCounts)}));
          const support = captures.get(camera.index + '-nonRidgeFilaments-' + Math.max(...${JSON.stringify(config.rayStepCounts)}));
          const analytic = captures.get(camera.index + '-analyticSplat-' + Math.max(...${JSON.stringify(config.rayStepCounts)}));
          if (!support || !stateSupport || !analytic) throw new Error('missing comparator capture for camera ' + camera.index);
          for (const raySteps of ${JSON.stringify(config.rayStepCounts)}) {
            const raymarch = captures.get(camera.index + '-raymarch-' + raySteps);
            if (!raymarch) throw new Error('missing raymarch capture for camera ' + camera.index + ' steps ' + raySteps);
            rows.push({
              cameraIndex: camera.index,
              cameraAngle: camera.angle,
              raySteps,
              ...filamentComponents(support, raymarch, analytic, stateSupport, camera.index, raySteps),
              raymarchVsSupportPixelDelta: pixelDelta(raymarch.rgba, support.rgba),
              raymarchVsAnalyticSplatPixelDelta: pixelDelta(raymarch.rgba, analytic.rgba),
            });
          }
        }
        const byRaySteps = ${JSON.stringify(config.rayStepCounts)}.map(raySteps => {
          const selected = rows.filter(row => row.raySteps === raySteps);
          const omissionRatios = selected.map(row => row.omittedCount / Math.max(1, row.componentCount));
          const widthProxies = selected.map(row => row.meanRaymarchWidthProxy);
          return {
            raySteps,
            cameraCount: selected.length,
            meanOmissionRatio: omissionRatios.reduce((sum, value) => sum + value, 0) / selected.length,
            minOmissionRatio: Math.min(...omissionRatios),
            maxOmissionRatio: Math.max(...omissionRatios),
            cameraOmissionSwing: Math.max(...omissionRatios) - Math.min(...omissionRatios),
            minMeanWidthProxy: Math.min(...widthProxies),
            maxMeanWidthProxy: Math.max(...widthProxies),
            cameraWidthSwing: Math.max(...widthProxies) - Math.min(...widthProxies),
            meanRaymarchToTargetIntensityRatio: selected.reduce((sum, row) => sum + row.meanRaymarchToTargetIntensityRatio, 0) / selected.length,
          };
        });
        const maxRaySteps = Math.max(...${JSON.stringify(config.rayStepCounts)});
        const rayStepAppearance = ${JSON.stringify(config.rayStepCounts)}.map(raySteps => {
          const selected = cameras.map(camera => captures.get(camera.index + '-raymarch-' + raySteps));
          const reference = cameras.map(camera => captures.get(camera.index + '-raymarch-' + maxRaySteps));
          const sameCameraDelta = selected.map((capture, index) => pixelDelta(capture.rgba, reference[index].rgba));
          return {
            raySteps,
            meanLuma: selected.reduce((sum, capture) => sum + capture.metrics.meanLuma, 0) / selected.length,
            minMeanLuma: Math.min(...selected.map(capture => capture.metrics.meanLuma)),
            maxMeanLuma: Math.max(...selected.map(capture => capture.metrics.meanLuma)),
            meanChangedFractionVsMaxSteps: sameCameraDelta.reduce((sum, delta) => sum + delta.changedFraction, 0) / sameCameraDelta.length,
            meanAbsChannelDeltaVsMaxSteps: sameCameraDelta.reduce((sum, delta) => sum + delta.meanAbsChannelDelta, 0) / sameCameraDelta.length,
            sameCameraDelta,
          };
        });
        const adjacentCameraDelta = ${JSON.stringify(config.rayStepCounts)}.map(raySteps => {
          const deltas = [];
          for (let index = 1; index < cameras.length; index += 1) {
            const previous = captures.get(cameras[index - 1].index + '-raymarch-' + raySteps);
            const current = captures.get(cameras[index].index + '-raymarch-' + raySteps);
            deltas.push({
              fromCameraIndex: cameras[index - 1].index,
              toCameraIndex: cameras[index].index,
              ...pixelDelta(previous.rgba, current.rgba),
            });
          }
          return {
            raySteps,
            meanChangedFraction: deltas.reduce((sum, delta) => sum + delta.changedFraction, 0) / Math.max(1, deltas.length),
            meanAbsChannelDelta: deltas.reduce((sum, delta) => sum + delta.meanAbsChannelDelta, 0) / Math.max(1, deltas.length),
            maxMeanAbsChannelDelta: Math.max(...deltas.map(delta => delta.meanAbsChannelDelta)),
            deltas,
          };
        });
        return {
          identity: 'view-local-state-support-filament-continuity-v0',
          caveat: 'component ids are view-local projections; camera continuity is measured against state-derived support at each pose, not asserted 3D correspondence',
          rows,
          summary: { byRaySteps, rayStepAppearance, adjacentCameraDelta },
        };
      }

      function edgeLoss(left, right, width, height) {
        let absoluteDelta = 0;
        let samples = 0;
        const edgeAt = (rgba, x0, y0, x1, y1) => {
          const first = (y0 * width + x0) * 4;
          const second = (y1 * width + x1) * 4;
          return Math.abs(luma(rgba, first) - luma(rgba, second));
        };
        for (let y = 1; y < height; y += 1) {
          for (let x = 1; x < width; x += 1) {
            absoluteDelta += Math.abs(edgeAt(left, x - 1, y, x, y) - edgeAt(right, x - 1, y, x, y));
            absoluteDelta += Math.abs(edgeAt(left, x, y - 1, x, y) - edgeAt(right, x, y - 1, x, y));
            samples += 2;
          }
        }
        return absoluteDelta / Math.max(1, samples * 255);
      }

      function analyzeCovariance() {
        const maxRaySteps = Math.max(...${JSON.stringify(config.rayStepCounts)});
        const familyModes = ['analyticBillboard', 'learnedBillboard', 'worldCovariance'];
        const center = cameras.reduce((best, camera) => Math.abs(camera.angle) < Math.abs(best.angle) ? camera : best);
        const rows = [];
        for (const camera of cameras) {
          const fullFlame = captures.get(camera.index + '-raymarch-' + maxRaySteps);
          const support = captures.get(camera.index + '-stateDerivedSupport-' + maxRaySteps);
          const nonRidge = captures.get(camera.index + '-nonRidgeFilaments-' + maxRaySteps);
          for (const mode of familyModes) {
            const capture = captures.get(camera.index + '-' + mode + '-' + maxRaySteps);
            if (!capture || !fullFlame || !support || !nonRidge) throw new Error('missing covariance comparator for camera ' + camera.index + ' mode ' + mode);
            rows.push({
              cameraIndex: camera.index,
              cameraAngle: camera.angle,
              heldOut: camera.index !== center.index,
              mode,
              fullFlamePixelDelta: pixelDelta(capture.rgba, fullFlame.rgba),
              supportAlignedPixelDelta: pixelDelta(capture.rgba, support.rgba),
              nonRidgeResidualPixelDelta: pixelDelta(capture.rgba, nonRidge.rgba),
              fullFlameEdgeLoss: edgeLoss(capture.rgba, fullFlame.rgba, capture.width, capture.height),
              supportAlignedEdgeLoss: edgeLoss(capture.rgba, support.rgba, capture.width, capture.height),
            });
          }
        }
        const summarize = (mode, heldOut) => {
          const selected = rows.filter(row => row.mode === mode && row.heldOut === heldOut);
          return {
            mode,
            split: heldOut ? 'held-out-camera-mean-v0' : 'training-camera-v0',
            cameraCount: selected.length,
            fullFlameMeanAbsChannelDelta: selected.reduce((sum, row) => sum + row.fullFlamePixelDelta.meanAbsChannelDelta, 0) / selected.length,
            fullFlameEdgeLoss: selected.reduce((sum, row) => sum + row.fullFlameEdgeLoss, 0) / selected.length,
            supportAlignedMeanAbsChannelDelta: selected.reduce((sum, row) => sum + row.supportAlignedPixelDelta.meanAbsChannelDelta, 0) / selected.length,
            supportAlignedEdgeLoss: selected.reduce((sum, row) => sum + row.supportAlignedEdgeLoss, 0) / selected.length,
          };
        };
        return {
          identity: 'full-flame-world-covariance-camera-holdout-analysis-v0',
          targetAuthority: '${FULL_FLAME_TARGET}',
          trainingCameraIndex: center.index,
          heldOutCameraIndices: cameras.map(camera => camera.index).filter(index => index !== center.index),
          rows,
          summary: familyModes.flatMap(mode => [summarize(mode, false), summarize(mode, true)]),
        };
      }

      function analyzeCrossExtinction() {
        const maxRaySteps = Math.max(...${JSON.stringify(config.rayStepCounts)});
        const center = cameras.reduce((best, camera) => Math.abs(camera.angle) < Math.abs(best.angle) ? camera : best);
        const rows = [];
        for (const camera of cameras) {
          const world = captures.get(camera.index + '-worldCovariance-' + maxRaySteps);
          const support = captures.get(camera.index + '-stateDerivedSupport-' + maxRaySteps);
          const ridgeOnly = captures.get(camera.index + '-ridgeTransportRidgeExtinction-' + maxRaySteps);
          const ridgeTotal = captures.get(camera.index + '-ridgeTransportTotalExtinction-' + maxRaySteps);
          const nonRidgeTotal = captures.get(camera.index + '-nonRidgeTransportTotalExtinction-' + maxRaySteps);
          const sharedSum = captures.get(camera.index + '-sharedTransmittanceContributionSum-' + maxRaySteps);
          const positiveControl = captures.get(camera.index + '-positiveOpticalRecomposition-' + maxRaySteps);
          const completeControl = captures.get(camera.index + '-raymarch-' + maxRaySteps);
          if (!world || !support || !ridgeOnly || !ridgeTotal || !nonRidgeTotal || !sharedSum || !positiveControl || !completeControl) {
            throw new Error('missing cross-extinction comparator for camera ' + camera.index);
          }
          const worldVsRidgeOnly = pixelDelta(world.rgba, ridgeOnly.rgba);
          const worldVsRidgeTotal = pixelDelta(world.rgba, ridgeTotal.rgba);
          const supportWorldVsRidgeOnly = maskedPixelDelta(world.rgba, ridgeOnly.rgba, support.rgba);
          const supportWorldVsRidgeTotal = maskedPixelDelta(world.rgba, ridgeTotal.rgba, support.rgba);
          rows.push({
            cameraIndex: camera.index,
            cameraAngle: camera.angle,
            heldOut: camera.index !== center.index,
            ridgeOnlyPixelHash: ridgeOnly.pixelHash,
            ridgeTotalPixelHash: ridgeTotal.pixelHash,
            crossExtinctionPixelDelta: pixelDelta(ridgeOnly.rgba, ridgeTotal.rgba),
            crossExtinctionSupportAlignedPixelDelta: maskedPixelDelta(ridgeOnly.rgba, ridgeTotal.rgba, support.rgba),
            worldVsRidgeOnly,
            worldVsRidgeTotal,
            supportWorldVsRidgeOnly,
            supportWorldVsRidgeTotal,
            crossExtinctionResidualReduction: (worldVsRidgeOnly.meanAbsChannelDelta - worldVsRidgeTotal.meanAbsChannelDelta) / Math.max(worldVsRidgeOnly.meanAbsChannelDelta, 1e-9),
            supportAlignedCrossExtinctionResidualReduction: (supportWorldVsRidgeOnly.meanAbsChannelDelta - supportWorldVsRidgeTotal.meanAbsChannelDelta) / Math.max(supportWorldVsRidgeOnly.meanAbsChannelDelta, 1e-9),
            worldVsRidgeOnlyEdgeLoss: edgeLoss(world.rgba, ridgeOnly.rgba, world.width, world.height),
            worldVsRidgeTotalEdgeLoss: edgeLoss(world.rgba, ridgeTotal.rgba, world.width, world.height),
            sharedRecompositionPixelDelta: pixelDelta(sharedSum.rgba, positiveControl.rgba),
            sharedSumVsCompleteControlPixelDelta: pixelDelta(sharedSum.rgba, completeControl.rgba),
            positiveControlVsCompleteControlPixelDelta: pixelDelta(positiveControl.rgba, completeControl.rgba),
            nonRidgeTotalMetrics: nonRidgeTotal.metrics,
          });
        }
        const summarize = heldOut => {
          const selected = rows.filter(row => row.heldOut === heldOut);
          const mean = key => selected.reduce((sum, row) => sum + row[key], 0) / selected.length;
          const meanNested = (key, nested) => selected.reduce((sum, row) => sum + row[key][nested], 0) / selected.length;
          return {
            split: heldOut ? 'held-out-camera-mean-v0' : 'training-camera-v0',
            cameraCount: selected.length,
            worldVsRidgeOnlyMeanAbsChannelDelta: meanNested('worldVsRidgeOnly', 'meanAbsChannelDelta'),
            worldVsRidgeTotalMeanAbsChannelDelta: meanNested('worldVsRidgeTotal', 'meanAbsChannelDelta'),
            supportWorldVsRidgeOnlyMeanAbsChannelDelta: meanNested('supportWorldVsRidgeOnly', 'meanAbsChannelDelta'),
            supportWorldVsRidgeTotalMeanAbsChannelDelta: meanNested('supportWorldVsRidgeTotal', 'meanAbsChannelDelta'),
            crossExtinctionResidualReduction: mean('crossExtinctionResidualReduction'),
            supportAlignedCrossExtinctionResidualReduction: mean('supportAlignedCrossExtinctionResidualReduction'),
            meanCrossExtinctionPixelDelta: meanNested('crossExtinctionPixelDelta', 'meanAbsChannelDelta'),
            meanSharedRecompositionPixelDelta: meanNested('sharedRecompositionPixelDelta', 'meanAbsChannelDelta'),
            maxSharedRecompositionChannelDelta: Math.max(...selected.map(row => row.sharedRecompositionPixelDelta.maxChannelDelta)),
          };
        };
        return {
          identity: 'ridge-cross-layer-extinction-camera-holdout-analysis-v0',
          targetAuthority: 'positive-ridge-owned-and-non-ridge-optical-partition-v0',
          sharedTransmittanceAuthority: 'ridge-plus-non-ridge-extinction-one-running-transmittance-v0',
          trainingCameraIndex: center.index,
          heldOutCameraIndices: cameras.map(camera => camera.index).filter(index => index !== center.index),
          rows,
          summary: [summarize(false), summarize(true)],
        };
      }

      function frozenRepeat() {
        const center = cameras.reduce((best, camera) => Math.abs(camera.angle) < Math.abs(best.angle) ? camera : best);
        const reference = captures.get(center.index + '-raymarch-' + Math.max(...${JSON.stringify(config.rayStepCounts)}));
        const repeat = captures.get(center.index + '-raymarchRepeat-' + Math.max(...${JSON.stringify(config.rayStepCounts)}));
        if (!reference || !repeat) throw new Error('frozen repeat capture missing');
        return {
          referenceKey: reference.key,
          repeatKey: repeat.key,
          referencePixelHash: reference.pixelHash,
          repeatPixelHash: repeat.pixelHash,
          pixelDelta: pixelDelta(reference.rgba, repeat.rgba),
          frameCountStable: reference.frameCount === repeat.frameCount,
          simStepCountStable: reference.simStepCount === repeat.simStepCount,
        };
      }

      window.__kaminosFilamentOrbitWitness = { capture, profileSparseHybrid, analyze, analyzeCovariance, analyzeCrossExtinction, frozenRepeat };
      return {
        summary: {
          wrapperRoute: wrapperBefore.routeIdentity,
          effectiveRoute: before.effectiveRoute,
          backend: before.backend,
          sourceSettingsPreset,
          replayAuthority: {
            warmupAuthority: wrapperBefore.warmupAuthority,
            warmupTarget: wrapperBefore.warmupTarget,
            warmupComplete: wrapperBefore.warmupComplete,
            warmupStarted: wrapperBefore.warmupStarted,
            warmupReceipt: wrapperBefore.warmupReceipt,
            freezeAfterWarmupRequested: wrapperBefore.freezeAfterWarmupRequested,
            postWarmupFreezeReceipt: wrapperBefore.postWarmupFreezeReceipt,
          },
          sourceAuthority: {
            fullFlameTarget: 'smoke-off-complete-flame-local-emission-extinction-v0',
            stateDerivedSupport: '${SUPPORT_AUTHORITY}',
            nonRidgeFilaments: '${NON_RIDGE_TARGET}',
            analyticSplat: '${ANALYTIC_SPLAT_RENDERER}',
          },
          smokeReceipt,
          frozenState: {
            sameStateCaptureId,
            baseFrameCount,
            baseSimStepCount,
            controlsHash,
            originalCamera,
          },
        },
        cameras,
      };
    })()
  `;
}

function rejectFalseClosure(report) {
  if (report.status !== 'completed') throw new Error('partial report cannot close Wave One');
  if (report.effectiveWrapperRoute !== WRAPPER_ROUTE || report.effectiveRendererRoute !== RENDERER_ROUTE) {
    throw new Error('requested/effective route disagreement');
  }
  if (report.captures.some(capture => capture.requestedRaySteps !== capture.effectiveRaySteps)) {
    throw new Error('requested/effective ray-step disagreement');
  }
  if (report.captures.some(capture => capture.frameCount !== report.frozenState.baseFrameCount || capture.simStepCount !== report.frozenState.baseSimStepCount)) {
    throw new Error('simulator state changed during frozen orbit');
  }
  if (report.captures.some(capture => !capture.metrics?.nonblank || !capture.pixelHash || !existsSync(capture.imagePath))) {
    throw new Error('missing, partial, or blank capture');
  }
  if (report.captures.some(capture => capture.boundarySplatFallbackReason || capture.volumePresentationReceipt?.fallbackReason || capture.raymarchSmokePresentationReceipt?.fallbackReason)) {
    throw new Error('renderer fallback');
  }
  if (report.captures.some(capture => capture.raymarchSmokePresentationReceipt?.effectiveMode !== 'off')) {
    throw new Error('smoke-off request was not effective');
  }
  const raymarchCameraHashes = new Set(report.captures.filter(capture => capture.mode === 'raymarch' && capture.requestedRaySteps === Math.max(...rayStepCounts)).map(capture => capture.pixelHash));
  if (raymarchCameraHashes.size < Math.min(3, orbitAngles.length)) throw new Error('cached or static output pretending to be live');
  if (!report.frozenDeterminism.frameCountStable || !report.frozenDeterminism.simStepCountStable || report.frozenDeterminism.pixelDelta.changedFraction !== 0) {
    throw new Error('frozen-state determinism failed');
  }
  if (!report.filamentContinuity?.rows?.length) throw new Error('filament continuity report missing');
  if (report.crossExtinctionAnalysis?.rows?.length !== orbitAngles.length) throw new Error('cross-extinction camera rows are partial');
  if (report.crossExtinctionAnalysis.rows.some(row => row.sharedRecompositionPixelDelta.maxChannelDelta > 1)) {
    throw new Error('shared contribution recomposition exceeds byte-quantization tolerance');
  }
  if (report.captureConfig.expectedWarmupAuthority !== null) {
    const replay = report.replayAuthority;
    if (!replay?.warmupComplete
      || replay.warmupAuthority !== report.captureConfig.expectedWarmupAuthority
      || replay.warmupReceipt?.authority !== report.captureConfig.expectedWarmupAuthority
      || replay.warmupReceipt?.completedSteps !== report.captureConfig.expectedWarmupTarget
      || replay.warmupReceipt?.fluidSha256 !== report.captureConfig.expectedAnchorFluidSha256
      || replay.warmupReceipt?.frontSha256 !== report.captureConfig.expectedAnchorFrontSha256
      || replay.postWarmupFreezeReceipt?.paused !== true
      || replay.postWarmupFreezeReceipt?.frameCount !== report.captureConfig.expectedWarmupTarget
      || replay.postWarmupFreezeReceipt?.simStepCount !== report.captureConfig.expectedWarmupTarget) {
      throw new Error('completed report lost checksum-anchor bridge authority');
    }
  }
}

function parseArgs(argv) {
  const known = new Set([
    '--url',
    '--out-dir',
    '--report',
    '--holdout-report',
    '--radiance-parity-report',
    '--optical-recurrence-report',
    '--sparse-hybrid-scales',
    '--ray-steps',
    '--orbit-angles',
    '--expected-frame-count',
    '--expected-sim-step-count',
    '--expected-controls-hash',
    '--expected-warmup-authority',
    '--expected-warmup-target',
    '--expected-anchor-fluid-sha256',
    '--expected-anchor-front-sha256',
    '--timeout-ms',
    '--settle-ms',
    '--debug-port',
    '--keep-browser-open',
  ]);
  const map = new Map();
  map.errors = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      map.errors.push(`unknown argument: ${item}`);
      continue;
    }
    const equalsIndex = item.indexOf('=');
    const key = equalsIndex >= 0 ? item.slice(0, equalsIndex) : item;
    if (!known.has(key)) {
      map.errors.push(`unknown argument: ${key}`);
      continue;
    }
    if (equalsIndex >= 0) {
      map.set(key, item.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) map.set(key, '1');
    else {
      map.set(key, next);
      index += 1;
    }
  }
  return map;
}

function required(name) {
  const value = args.get(name);
  return value ? String(value) : '';
}

function optionalInteger(name) {
  if (!args.has(name)) return null;
  const value = Number(args.get(name));
  if (!Number.isInteger(value) || value < 0) args.errors.push(`${name} must be a nonnegative integer`);
  return value;
}

function optionalSha256(name) {
  if (!args.has(name)) return null;
  const value = String(args.get(name)).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(value)) args.errors.push(`${name} must be a lowercase SHA-256 hex digest`);
  return value;
}

function parseIntegerList(value) {
  return [...new Set(String(value).split(',').map(item => Math.round(Number(item))).filter(Number.isFinite))].sort((a, b) => a - b);
}

function parseNumberList(value) {
  return String(value).split(',').map(Number).filter(Number.isFinite);
}

function parseStrictNumberList(value, name) {
  const tokens = String(value ?? '').split(',').map(item => item.trim());
  const values = tokens.map(Number);
  if (tokens.length === 0 || tokens.some(token => token === '') || values.some(value => !Number.isFinite(value))) {
    args.errors.push(`${name} must be a comma-separated list of finite numbers`);
    return [];
  }
  return values;
}

function writeDataUrl(path, dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error(`missing, partial, or blank capture: ${path}`);
  writeFileSync(path, Buffer.from(match[1], 'base64'));
}

function fileArtifact(path) {
  const bytes = readFileSync(path);
  return {
    path,
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function gitValue(argv) {
  const result = spawnSync('git', argv, { cwd: process.cwd(), encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

async function waitForJson(url, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function waitForTarget(port, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find(target => target.type === 'page');
      if (page?.webSocketDebuggerUrl) return page;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome target');
}

async function waitForRuntime(cdp, timeout) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await evaluate(cdp, 'window.__kaminosSelectiveHeadLive?.debugState?.() || null');
    if (state) lastTrustworthyEvidence.routeAdmissionProbe = state;
    if (state?.status === 'failed') throw new Error(`route failed: ${state.error || state.fallbackReason || 'unknown'}`);
    if (state?.status === 'running') return state;
    await delay(125);
  }
  throw new Error('timed out waiting for selective-head runtime');
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  return result.result.value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
