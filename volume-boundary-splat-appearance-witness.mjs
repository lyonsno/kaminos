#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  BOUNDARY_SPLAT_APPEARANCE_AUTHORITY,
  BOUNDARY_SPLAT_APPEARANCE_CONDITIONING_IDENTITY,
  BOUNDARY_SPLAT_APPEARANCE_SCHEMA,
  validateBoundarySplatAppearanceCorpus,
} from './boundary-splat-appearance-corpus.mjs';

const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const cameraManifestPath = resolve(required('--camera-manifest'));
const outDir = resolve(required('--out-dir'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const corpusPath = resolve(String(args.get('--corpus') || `${outDir}/appearance-corpus.json`));
const expectedGrid = positiveInteger('--expected-grid', 160);
const expectedRaySteps = positiveInteger('--expected-ray-steps', 160);
const expectedRenderScale = boundedNumber('--expected-render-scale', 1, 0, 1);
const operationTimeoutMs = positiveNumber('--operation-timeout-ms', 180000);
const settleMs = nonNegativeNumber('--settle-ms', 2500);
const debugPort = positiveInteger('--debug-port', randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-splat-appearance-profile-');
const cameraManifest = JSON.parse(readFileSync(cameraManifestPath, 'utf8'));

let browser = null;
let socket = null;
let failurePhase = 'argument-validation';
let lastTrustworthyEvidence = {
  requestedUrl,
  cameraManifestPath,
  expectedGrid,
  expectedRaySteps,
  expectedRenderScale,
};

mkdirSync(outDir, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
mkdirSync(dirname(corpusPath), { recursive: true });

validateCameraManifest(cameraManifest);

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

try {
  const route = new URL(requestedUrl);
  assert.ok(['http:', 'https:'].includes(route.protocol), 'appearance witness URL must be HTTP(S)');

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
  ], { stdio: 'ignore' });

  const target = await waitForTarget(debugPort, operationTimeoutMs);
  socket = new CdpSocket(target.webSocketDebuggerUrl, operationTimeoutMs);
  await socket.open();
  await socket.call('Page.enable');
  await socket.call('Runtime.enable');
  await socket.call('Log.enable');
  await socket.call('Page.navigate', { url: requestedUrl });

  failurePhase = 'route-admission';
  const admitted = await waitForRuntime(socket, operationTimeoutMs);
  lastTrustworthyEvidence = { ...lastTrustworthyEvidence, admitted };
  assert.equal(admitted.active, true, 'volume renderer did not become active');
  assert.equal(admitted.grid, expectedGrid, `effective simulator grid substituted away from ${expectedGrid}`);
  assert.ok(admitted.backend?.startsWith('WebGPU:'), 'effective backend substituted away from WebGPU');
  assert.equal(admitted.fallbackReason, null, `runtime admitted fallback evidence: ${admitted.fallbackReason}`);
  assert.equal(admitted.hasAppearanceControlApi, true, 'exact appearance control API is missing from the operator wrapper');
  assert.equal(admitted.hasAppearanceCaptureApi, true, 'exact appearance evidence API is missing from the basin runtime');
  await delay(settleMs);

  failurePhase = 'camera-cohort-capture';
  const evidence = await evaluate(socket, `
    (async () => {
      const cameraManifest = ${JSON.stringify(cameraManifest)};
      const expectedGrid = ${JSON.stringify(expectedGrid)};
      const expectedRaySteps = ${JSON.stringify(expectedRaySteps)};
      const expectedRenderScale = ${JSON.stringify(expectedRenderScale)};
      const operator = window.__kaminosSelectiveHeadLive;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = basinWindow.__kaminosVolumePrototype;
      if (!operator?.setAppearanceAssay
        || !prototype?.debugState
        || !prototype?.captureBoundarySplatSupervisionCandidates
        || !prototype?.sampleFrame
        || !prototype?.setSelectiveHeadLiveCapturePaused
        || !prototype?.setVolumePresentationMode
        || typeof basinWindow.kaminosSetCameraDebugPose !== 'function'
        || typeof basinWindow.kaminosCameraDebugState !== 'function') {
        throw new Error('boundary-splat-appearance-runtime-api-missing');
      }
      const digest = async bytes => {
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
      };
      const pngDataUrl = image => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.putImageData(new ImageData(Uint8ClampedArray.from(image.rgba), image.width, image.height), 0, 0);
        return canvas.toDataURL('image/png');
      };
      const pixelMetrics = rgba => {
        let litPixels = 0;
        let alphaPixels = 0;
        let lumaSum = 0;
        for (let index = 0; index < rgba.length; index += 4) {
          const red = rgba[index];
          const green = rgba[index + 1];
          const blue = rgba[index + 2];
          const alpha = rgba[index + 3];
          const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
          if (luma > 8) litPixels += 1;
          if (alpha > 8) alphaPixels += 1;
          lumaSum += luma;
        }
        return {
          litPixels,
          alphaPixels,
          meanLuma: lumaSum / Math.max(1, rgba.length / 4),
          nonblank: litPixels > 64,
        };
      };
      const candidateBytesFromCapture = capture => {
        if (capture.candidates?.packedEncoding !== 'float32-le-base64' || typeof capture.candidates?.packedFloat32Base64 !== 'string') {
          throw new Error('appearance-candidate-packed-payload-missing');
        }
        const binary = atob(capture.candidates.packedFloat32Base64);
        return Uint8Array.from(binary, character => character.charCodeAt(0));
      };
      const before = prototype.debugState();
      if (before.simGrid !== expectedGrid) throw new Error('appearance-grid-mismatch:' + JSON.stringify({ expectedGrid, effective: before.simGrid }));
      const originalCamera = basinWindow.kaminosCameraDebugState();
      const originalPresentationMode = before.volumePresentationModeEffective || before.volumePresentationModeRequested || 'beauty';
      const originalAppearanceMode = before.appearanceDecompositionModeEffective || before.appearanceDecompositionModeRequested || 'off';
      const sameStateCaptureId = 'appearance-f' + before.frameCount + '-s' + before.simStepCount;
      const fixedNow = performance.now();
      prototype.setSelectiveHeadLiveCapturePaused(true);
      const cameras = [];
      let candidateSha256 = null;
      let candidateMetadata = null;
      let candidateLength = null;
      const coefficientBoundary = 'per-sample-pre-tone-map-emission-extinction-v0';
      const broadCarrierIdentity = 'signed-control-minus-structural-a-local-coefficients-v0';
      const opticalRecurrence = 'front-to-back-emission-with-exponential-transmittance-v0';
      const positivePartitionIdentity = 'nonnegative-ridge-owned-plus-non-ridge-complete-flame-v0';
      const completeFlameIdentity = 'smoke-off-complete-flame-local-emission-extinction-v0';
      const ridgeOwnershipIdentity = 'state-derived-direct-flame-candidate-support-allocation-v0';
      const positiveModes = new Set([
        'complete-flame-emission',
        'complete-flame-extinction',
        'ridge-owned-emission',
        'ridge-owned-extinction',
        'non-ridge-emission',
        'non-ridge-extinction',
        'positive-optical-recomposition',
      ]);
      const captureAppearance = async (mode, targetIdentity) => {
        prototype.setVolumePresentationMode('beauty');
        const requestedReceipt = operator.setAppearanceAssay(mode);
        const sample = await prototype.sampleFrame({
          advanceSim: false,
          includeRgba: true,
          now: fixedNow,
          sameStateCaptureId,
          baseFrameCount: before.frameCount,
          baseSimStepCount: before.simStepCount,
        });
        if (!sample?.ok || !Array.isArray(sample.image?.rgba)) {
          throw new Error('appearance-assay-capture-failed:' + mode + ':' + JSON.stringify(sample));
        }
        const receipt = sample.appearanceDecompositionReceipt;
        if (requestedReceipt?.requestedMode !== mode
          || requestedReceipt?.effectiveMode !== mode
          || requestedReceipt?.fallbackReason != null
          || receipt?.requestedMode !== mode
          || receipt?.normalizedRequestedMode !== mode
          || receipt?.effectiveMode !== mode
          || receipt?.fallbackReason != null
          || receipt?.targetIdentity !== targetIdentity
          || receipt?.coefficientBoundary !== coefficientBoundary
          || receipt?.broadCarrierIdentity !== broadCarrierIdentity
          || receipt?.opticalRecurrence !== opticalRecurrence) {
          throw new Error('appearance-assay-receipt-invalid:' + mode + ':' + JSON.stringify({ requestedReceipt, receipt }));
        }
        if (positiveModes.has(mode)
          && (receipt?.positivePartitionIdentity !== positivePartitionIdentity
            || receipt?.completeFlameIdentity !== completeFlameIdentity
            || receipt?.ridgeOwnershipIdentity !== ridgeOwnershipIdentity
            || receipt?.coefficientSigns?.completeFlame !== 'nonnegative'
            || receipt?.coefficientSigns?.ridgeOwned !== 'nonnegative'
            || receipt?.coefficientSigns?.nonRidge !== 'nonnegative')) {
          throw new Error('appearance-positive-partition-receipt-invalid:' + mode + ':' + JSON.stringify(receipt));
        }
        const application = receipt.application;
        if (application?.raymarchEncoded !== true
          || application?.raymarchApplied !== true
          || application?.splatsEncoded !== false
          || application?.splatsApplied !== false
          || application?.residualEncoded !== false
          || application?.residualApplied !== false
          || application?.featureCaptureEncoded !== false
          || application?.featureCaptureApplied !== false
          || application?.smokeApplied !== false) {
          throw new Error('appearance-assay-not-raymarch-only:' + mode + ':' + JSON.stringify(application));
        }
        const metrics = pixelMetrics(sample.image.rgba);
        if (!metrics.nonblank) {
          throw new Error('appearance-assay-blank-target:' + mode + ':' + JSON.stringify(metrics));
        }
        return {
          pngDataUrl: pngDataUrl(sample.image),
          width: sample.image.width,
          height: sample.image.height,
          rgba: sample.image.rgba,
          metrics,
          sampleAuthority: sample.sampleAuthority,
          appearanceDecompositionReceipt: receipt,
        };
      };
      try {
        for (const entry of cameraManifest.cameras) {
          basinWindow.kaminosSetCameraDebugPose(entry.pose);
          const cameraState = basinWindow.kaminosCameraDebugState();
          const beforeView = prototype.debugState();
          if (beforeView.simStepCount !== before.simStepCount) throw new Error('appearance-state-advanced-before-view:' + entry.id);
          const capture = await prototype.captureBoundarySplatSupervisionCandidates({
            renderScale: expectedRenderScale,
            resumeRenderLoop: false,
            now: fixedNow,
            sameStateCaptureId,
          });
          if (!capture?.ok) throw new Error('appearance-candidate-capture-failed:' + entry.id + ':' + JSON.stringify(capture));
          const candidateBytes = candidateBytesFromCapture(capture);
          const viewCandidateSha256 = await digest(candidateBytes);
          if (candidateSha256 == null) {
            candidateSha256 = viewCandidateSha256;
            candidateLength = candidateBytes.length;
            window.__kaminosAppearanceCandidateBytes = candidateBytes;
            const { packedFloat32Base64, ...metadata } = capture.candidates;
            candidateMetadata = metadata;
          } else if (viewCandidateSha256 !== candidateSha256) {
            throw new Error('appearance candidate sha256 drift across camera views:' + JSON.stringify({ expected: candidateSha256, actual: viewCandidateSha256, cameraId: entry.id }));
          }
          const structuralA = await captureAppearance('structural-a', 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0');
          const appearanceBroadCarrierB = await captureAppearance('broad-carrier-b', 'pre-tone-map-signed-broad-carrier-coefficients-v0');
          const appearanceBAppliedToFixedA = await captureAppearance('b-applied-to-fixed-a', 'pre-tone-map-b-optical-effect-on-fixed-structural-a-v0');
          const appearanceAPlusB = await captureAppearance('a-plus-b-recomposition', 'nonlinear-optical-a-plus-b-recomposition-v0');
          const smokeOffBeautyControl = await captureAppearance('smoke-off-beauty-control', 'smoke-off-beauty-optical-control-v0');
          const positiveCompleteEmission = await captureAppearance('complete-flame-emission', 'smoke-off-complete-flame-emission-coefficient-v0');
          const positiveCompleteExtinction = await captureAppearance('complete-flame-extinction', 'smoke-off-complete-flame-extinction-coefficient-v0');
          const positiveRidgeOwnedEmission = await captureAppearance('ridge-owned-emission', 'nonnegative-ridge-owned-flame-emission-coefficient-v0');
          const positiveRidgeOwnedExtinction = await captureAppearance('ridge-owned-extinction', 'nonnegative-ridge-owned-flame-extinction-coefficient-v0');
          const positiveNonRidgeEmission = await captureAppearance('non-ridge-emission', 'nonnegative-non-ridge-flame-emission-coefficient-v0');
          const positiveNonRidgeExtinction = await captureAppearance('non-ridge-extinction', 'nonnegative-non-ridge-flame-extinction-coefficient-v0');
          const positiveOpticalRecomposition = await captureAppearance('positive-optical-recomposition', 'nonnegative-ridge-plus-non-ridge-optical-recomposition-v0');
          const afterView = prototype.debugState();
          if (afterView.simStepCount !== before.simStepCount) {
            throw new Error('appearance-state-advanced-during-view:' + entry.id);
          }
          if (appearanceAPlusB.rgba.length !== smokeOffBeautyControl.rgba.length
            || appearanceAPlusB.rgba.some((value, index) => value !== smokeOffBeautyControl.rgba[index])) {
            throw new Error('appearance-a-plus-b-control-pixel-mismatch:' + entry.id);
          }
          if (positiveOpticalRecomposition.rgba.length !== smokeOffBeautyControl.rgba.length
            || positiveOpticalRecomposition.rgba.some((value, index) => value !== smokeOffBeautyControl.rgba[index])) {
            throw new Error('appearance-positive-recomposition-control-pixel-mismatch:' + entry.id);
          }
          delete structuralA.rgba;
          delete appearanceBroadCarrierB.rgba;
          delete appearanceBAppliedToFixedA.rgba;
          delete appearanceAPlusB.rgba;
          delete smokeOffBeautyControl.rgba;
          delete positiveCompleteEmission.rgba;
          delete positiveCompleteExtinction.rgba;
          delete positiveRidgeOwnedEmission.rgba;
          delete positiveRidgeOwnedExtinction.rgba;
          delete positiveNonRidgeEmission.rgba;
          delete positiveNonRidgeExtinction.rgba;
          delete positiveOpticalRecomposition.rgba;
          const camera = capture.camera;
          cameras.push({
            id: entry.id,
            split: entry.split,
            pose: entry.pose,
            cameraState,
            sameStateCaptureId,
            simStepCount: before.simStepCount,
            camera,
            structuralA,
            appearanceBroadCarrierB,
            appearanceBAppliedToFixedA,
            appearanceAPlusB,
            smokeOffBeautyControl,
            positiveCompleteEmission,
            positiveCompleteExtinction,
            positiveRidgeOwnedEmission,
            positiveRidgeOwnedExtinction,
            positiveNonRidgeEmission,
            positiveNonRidgeExtinction,
            positiveOpticalRecomposition,
          });
        }
      } finally {
        basinWindow.kaminosSetCameraDebugPose(originalCamera);
        operator.setAppearanceAssay(originalAppearanceMode);
        prototype.setVolumePresentationMode(originalPresentationMode);
      }
      const after = prototype.debugState();
      if (after.simStepCount !== before.simStepCount) throw new Error('appearance-state-advanced-after-cohort');
      return {
        ok: true,
        requestedUrl: location.href,
        effectiveRoute: after.effectiveRoute,
        prototypeIdentity: after.prototypeIdentity,
        backend: after.backend,
        fallbackReason: after.error || null,
        sameStateCaptureId,
        simStepCount: before.simStepCount,
        grid: before.simGrid,
        before,
        after,
        originalCamera,
        restorationIdentity: 'camera-manifest-restored',
        restoredCamera: basinWindow.kaminosCameraDebugState(),
        candidateSha256,
        candidateLength,
        candidateMetadata,
        authoredAppearanceControls: {
          reactionBoundaryFireRidge: before.controls?.reactionBoundaryFireRidge,
          reactionBoundaryFireRidgeCut: before.controls?.reactionBoundaryFireRidgeCut,
          reactionBoundaryFireTip: before.controls?.reactionBoundaryFireTip,
          reactionBoundaryFireErosion: before.controls?.reactionBoundaryFireErosion,
          reactionBoundaryFireCleanBlue: before.controls?.reactionBoundaryFireCleanBlue,
          reactionBoundaryFireSoot: before.controls?.reactionBoundaryFireSoot,
          reactionBoundaryFireYellow: before.controls?.reactionBoundaryFireYellow,
          reactionBoundaryFireWarmth: before.controls?.reactionBoundaryFireWarmth,
          reactionBoundaryFireLuma: before.controls?.reactionBoundaryFireLuma,
        },
        cameras,
      };
    })()
  `);
  assert.equal(evidence.ok, true, 'appearance runtime did not return successful evidence');
  assert.equal(evidence.grid, expectedGrid, 'appearance evidence grid drifted');
  assert.ok(evidence.backend?.startsWith('WebGPU:'), 'appearance evidence backend is not WebGPU');
  assert.equal(evidence.fallbackReason, null, 'appearance evidence contains runtime fallback/error evidence');
  assert.equal(evidence.before.simStepCount, evidence.after.simStepCount, 'appearance cohort advanced the simulator');
  assert.equal(evidence.restorationIdentity, 'camera-manifest-restored', 'appearance witness did not restore the operator camera');
  assert.deepEqual(evidence.restoredCamera.position, evidence.originalCamera.position, 'appearance witness restored the wrong camera position');
  assert.deepEqual(evidence.restoredCamera.target, evidence.originalCamera.target, 'appearance witness restored the wrong camera target');
  assert.equal(evidence.cameras.length, cameraManifest.cameras.length, 'appearance witness returned a partial camera cohort');
  lastTrustworthyEvidence = {
    ...lastTrustworthyEvidence,
    effectiveRoute: evidence.effectiveRoute,
    prototypeIdentity: evidence.prototypeIdentity,
    backend: evidence.backend,
    sameStateCaptureId: evidence.sameStateCaptureId,
    simStepCount: evidence.simStepCount,
    candidateSha256: evidence.candidateSha256,
    capturedCameraIds: evidence.cameras.map(camera => camera.id),
  };

  failurePhase = 'candidate-transfer';
  const candidateBytes = await readBrowserBytes(socket, 'window.__kaminosAppearanceCandidateBytes', evidence.candidateLength);
  if (candidateBytes.length !== evidence.candidateMetadata.packedByteLength) {
    throw new Error(`appearance candidate transfer byte-length mismatch: expected ${evidence.candidateMetadata.packedByteLength}, actual ${candidateBytes.length}`);
  }
  if (sha256Buffer(candidateBytes) !== evidence.candidateSha256) {
    throw new Error('appearance candidate transfer hash drifted from the captured camera cohort');
  }
  const candidatePath = resolve(outDir, 'appearance-state.candidates.f32');
  writeFileSync(candidatePath, candidateBytes);

  failurePhase = 'target-write';
  const cameras = [];
  for (const camera of evidence.cameras) {
    const targetSpecs = {
      structuralA: ['structural-a', 'structural-a', 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0'],
      appearanceBroadCarrierB: ['broad-carrier-b', 'broad-carrier-b', 'pre-tone-map-signed-broad-carrier-coefficients-v0'],
      appearanceBAppliedToFixedA: ['b-on-fixed-a', 'b-applied-to-fixed-a', 'pre-tone-map-b-optical-effect-on-fixed-structural-a-v0'],
      appearanceAPlusB: ['a-plus-b', 'a-plus-b-recomposition', 'nonlinear-optical-a-plus-b-recomposition-v0'],
      smokeOffBeautyControl: ['smoke-off-control', 'smoke-off-beauty-control', 'smoke-off-beauty-optical-control-v0'],
      positiveCompleteEmission: ['positive-complete-emission', 'complete-flame-emission', 'smoke-off-complete-flame-emission-coefficient-v0'],
      positiveCompleteExtinction: ['positive-complete-extinction', 'complete-flame-extinction', 'smoke-off-complete-flame-extinction-coefficient-v0'],
      positiveRidgeOwnedEmission: ['positive-ridge-owned-emission', 'ridge-owned-emission', 'nonnegative-ridge-owned-flame-emission-coefficient-v0'],
      positiveRidgeOwnedExtinction: ['positive-ridge-owned-extinction', 'ridge-owned-extinction', 'nonnegative-ridge-owned-flame-extinction-coefficient-v0'],
      positiveNonRidgeEmission: ['positive-non-ridge-emission', 'non-ridge-emission', 'nonnegative-non-ridge-flame-emission-coefficient-v0'],
      positiveNonRidgeExtinction: ['positive-non-ridge-extinction', 'non-ridge-extinction', 'nonnegative-non-ridge-flame-extinction-coefficient-v0'],
      positiveOpticalRecomposition: ['positive-optical-recomposition', 'positive-optical-recomposition', 'nonnegative-ridge-plus-non-ridge-optical-recomposition-v0'],
    };
    const targets = {};
    for (const [key, [fileLabel, mode, targetIdentity]] of Object.entries(targetSpecs)) {
      const targetPath = resolve(outDir, `${camera.id}.${fileLabel}.png`);
      const targetBytes = decodePngDataUrl(camera[key].pngDataUrl);
      writeFileSync(targetPath, targetBytes);
      targets[key] = {
        path: targetPath,
        bytes: targetBytes.length,
        sha256: sha256Buffer(targetBytes),
        authority: 'gpu-rgba8-raymarch-readback-frozen-sim-state',
        rendererIdentity: 'native-3d-compute-fluid-raymarch-v0',
        decomposition: targetIdentity,
        presentationTargetIdentity: targetIdentity,
        sameStateCaptureId: evidence.sameStateCaptureId,
        simStepCount: evidence.simStepCount,
        cameraId: camera.id,
        requestedRaySteps: evidence.before.controls.raySteps,
        effectiveRaySteps: evidence.before.controls.raySteps,
        renderScale: evidence.before.controls.renderScale,
        appearanceDecompositionReceipt: camera[key].appearanceDecompositionReceipt,
      };
      if (mode === 'b-applied-to-fixed-a') {
        targets[key].trainingAuthority = 'diagnostic-only-not-local-b-target';
      }
    }
    cameras.push({
      id: camera.id,
      split: camera.split,
      sameStateCaptureId: evidence.sameStateCaptureId,
      simStepCount: evidence.simStepCount,
      camera: {
        viewProjection: camera.camera.viewProjection,
        cameraRight: camera.camera.cameraRight,
        cameraUp: camera.camera.cameraUp,
        viewport: camera.camera.viewport,
      },
      ...targets,
    });
  }

  failurePhase = 'corpus-write';
  const manifest = {
    schema: BOUNDARY_SPLAT_APPEARANCE_SCHEMA,
    authority: BOUNDARY_SPLAT_APPEARANCE_AUTHORITY,
    cohortIdentity: `appearance-cohort-${evidence.sameStateCaptureId}`,
    sameStateCaptureId: evidence.sameStateCaptureId,
    simStepCount: evidence.simStepCount,
    grid: evidence.grid,
    requestedRoute: requestedUrl,
    effectiveRoute: evidence.effectiveRoute,
    prototypeIdentity: evidence.prototypeIdentity,
    backend: evidence.backend,
    fallbackReason: evidence.fallbackReason,
    authoredAppearanceControls: {
      identity: BOUNDARY_SPLAT_APPEARANCE_CONDITIONING_IDENTITY,
      authority: 'effective-runtime-controls-frozen-sim-state-v0',
      values: evidence.authoredAppearanceControls,
    },
    candidates: {
      path: candidatePath,
      bytes: candidateBytes.length,
      sha256: sha256Buffer(candidateBytes),
      count: evidence.candidateMetadata.rowCount,
      strideFloats: evidence.candidateMetadata.strideFloats,
      dtype: 'float32-le',
      candidateOrder: evidence.candidateMetadata.candidateOrder,
      sameStateCaptureId: evidence.sameStateCaptureId,
      simStepCount: evidence.simStepCount,
    },
    cameras,
  };
  writeFileSync(corpusPath, `${JSON.stringify(manifest, null, 2)}\n`);

  failurePhase = 'corpus-validation';
  const validation = await validateBoundarySplatAppearanceCorpus(corpusPath, {
    expectedGrid,
    expectedRaySteps,
    expectedRenderScale,
    requireWebGpuBackend: true,
  });
  const report = {
    identity: 'kaminos.boundary-splat-appearance-witness.v0',
    status: 'passed',
    requestedUrl,
    effectiveRoute: evidence.effectiveRoute,
    prototypeIdentity: evidence.prototypeIdentity,
    backend: evidence.backend,
    sameStateCaptureId: evidence.sameStateCaptureId,
    simStepCount: evidence.simStepCount,
    cameraManifestPath,
    corpusPath,
    validation,
    restorationIdentity: evidence.restorationIdentity,
    browserEvents: socket.browserEvents,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  if (error?.runtimeEvidence) {
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      routeAdmission: error.runtimeEvidence,
    };
  }
  let failureScreenshot = null;
  if (socket) {
    try {
      const screenshot = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      failureScreenshot = resolve(outDir, 'failure.png');
      writeFileSync(failureScreenshot, Buffer.from(screenshot.data, 'base64'));
    } catch {
      failureScreenshot = null;
    }
  }
  const failure = {
    identity: 'kaminos.boundary-splat-appearance-witness.v0',
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    lastTrustworthyEvidence,
    failureScreenshot,
    browserEvents: socket?.browserEvents || [],
  };
  writeFileSync(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  browser?.kill('SIGTERM');
  rmSync(userDataDir, { recursive: true, force: true });
}

function parseArgs(tokens) {
  const values = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`unexpected positional argument: ${token}`);
    const next = tokens[index + 1];
    if (next == null || next.startsWith('--')) values.set(token, true);
    else {
      values.set(token, next);
      index += 1;
    }
  }
  return values;
}

function required(name) {
  const value = args.get(name);
  if (typeof value !== 'string' || !value) throw new Error(`${name} is required`);
  return value;
}

function positiveInteger(name, fallback) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function positiveNumber(name, fallback) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive and finite`);
  return value;
}

function nonNegativeNumber(name, fallback) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be non-negative and finite`);
  return value;
}

function boundedNumber(name, fallback, lowerExclusive, upperInclusive) {
  const value = Number(args.get(name) ?? fallback);
  if (!Number.isFinite(value) || value <= lowerExclusive || value > upperInclusive) {
    throw new Error(`${name} must be finite within (${lowerExclusive}, ${upperInclusive}]`);
  }
  return value;
}

function validateCameraManifest(manifest) {
  if (manifest?.identity !== 'kaminos-boundary-splat-camera-cohort-v0') throw new Error('camera manifest identity is invalid');
  if (!Array.isArray(manifest.cameras) || manifest.cameras.length < 2) throw new Error('camera manifest must contain multiple cameras');
  const ids = new Set();
  let trainCount = 0;
  let heldoutCount = 0;
  for (const [index, camera] of manifest.cameras.entries()) {
    if (typeof camera?.id !== 'string' || !camera.id || ids.has(camera.id)) throw new Error(`camera manifest entry ${index} identity is missing or duplicated`);
    ids.add(camera.id);
    if (camera.split === 'train') trainCount += 1;
    else if (camera.split === 'heldout') heldoutCount += 1;
    else throw new Error(`camera manifest entry ${index} split must be train or heldout`);
    if (!Array.isArray(camera.pose?.position) || camera.pose.position.length !== 3 || camera.pose.position.some(value => !Number.isFinite(value))) {
      throw new Error(`camera manifest entry ${index} position must contain three finite values`);
    }
    if (!Array.isArray(camera.pose?.target) || camera.pose.target.length !== 3 || camera.pose.target.some(value => !Number.isFinite(value))) {
      throw new Error(`camera manifest entry ${index} target must contain three finite values`);
    }
  }
  if (trainCount === 0 || heldoutCount === 0) throw new Error('camera manifest must contain both train and heldout cameras');
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
  throw new Error(`Chrome CDP page target did not become available: ${lastError?.message || 'timeout'}`);
}

async function waitForRuntime(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      last = await evaluate(cdp, `(() => {
        const operator = window.__kaminosSelectiveHeadLive;
        const basinWindow = document.querySelector('#basin')?.contentWindow || window;
        const prototype = basinWindow.__kaminosVolumePrototype;
        const state = prototype?.debugState?.() || null;
        const wrapper = operator?.debugState?.() || null;
        return {
          href: location.href,
          readyState: document.readyState,
          title: document.title,
          bodyText: document.body?.innerText?.slice(0, 1000) || '',
          basinPresent: Boolean(document.querySelector('#basin')),
          basinSrc: document.querySelector('#basin')?.src || null,
          basinReadyState: basinWindow.document?.readyState || null,
          basinHref: basinWindow.location?.href || null,
          wrapper,
          active: state?.active === true,
          grid: state?.simGrid ?? null,
          backend: state?.backend ?? null,
          effectiveRoute: state?.effectiveRoute ?? null,
          prototypeIdentity: state?.prototypeIdentity ?? null,
          fallbackReason: state?.error ?? null,
          frameCount: state?.frameCount ?? null,
          simStepCount: state?.simStepCount ?? null,
          hasAppearanceControlApi: Boolean(operator?.setAppearanceAssay),
          hasAppearanceCaptureApi: Boolean(
            prototype?.captureBoundarySplatSupervisionCandidates
            && prototype?.sampleFrame
            && prototype?.setSelectiveHeadLiveCapturePaused
            && prototype?.setVolumePresentationMode
            && basinWindow.kaminosSetCameraDebugPose
            && basinWindow.kaminosCameraDebugState
          ),
        };
      })()`);
      if (last.active && last.frameCount > 2) return last;
    } catch {
      last = null;
    }
    await delay(100);
  }
  const error = new Error(`volume runtime did not become admissible: ${JSON.stringify(last)}`);
  error.runtimeEvidence = last;
  throw error;
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser runtime exception');
  return result.result.value;
}

async function readBrowserBytes(cdp, expression, expectedLength) {
  if (!Number.isInteger(expectedLength) || expectedLength <= 0) throw new Error('browser byte transfer expected length must be positive');
  const chunkSize = 256 * 1024;
  const chunks = [];
  for (let offset = 0; offset < expectedLength; offset += chunkSize) {
    const length = Math.min(chunkSize, expectedLength - offset);
    const base64 = await evaluate(cdp, `(() => {
      const source = ${expression};
      if (!(source instanceof Uint8Array)) throw new Error('appearance-browser-byte-source-missing');
      const slice = source.subarray(${offset}, ${offset + length});
      let binary = '';
      for (let index = 0; index < slice.length; index += 32768) {
        binary += String.fromCharCode(...slice.subarray(index, Math.min(slice.length, index + 32768)));
      }
      return btoa(binary);
    })()`);
    chunks.push(Buffer.from(base64, 'base64'));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.length !== expectedLength) throw new Error(`browser byte transfer length mismatch: expected ${expectedLength}, actual ${bytes.length}`);
  return bytes;
}

function decodePngDataUrl(value) {
  if (typeof value !== 'string' || !value.startsWith('data:image/png;base64,')) throw new Error('PNG data URL is missing or invalid');
  const bytes = Buffer.from(value.slice('data:image/png;base64,'.length), 'base64');
  if (bytes.length === 0) throw new Error('PNG data URL decoded to a blank artifact');
  return bytes;
}

function sha256Buffer(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
