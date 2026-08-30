#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const TARGET_IDENTITY = 'candidate-support-gated-unit-gain-direct-flame-native-raymarch-v0';
const REPORT_IDENTITY = 'kaminos.volume.intrinsic-presentation-witness.v0';
const FLAMEBOWL_PRESET_ID = 'vsp-03789085b9ba0d8b3fe7c0ba6183583b4ea1cb31e8d00d044634baa935fc0836';
const FLAMEBOWL_PRESET_LABEL = 'big_raymarch_hero_flamebowl';
const REQUIRED_BEAUTY_ROUTE = 'role=truthHigh&composition=raymarch-only-v0';
const RESTORATION_MAX_CHANNEL_DELTA = 1;
const RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA = 1e-6;
const RESTORATION_MAX_CHANGED_PIXEL_RATIO = 1e-5;
const sharedTransportExpectedMasks = Object.freeze({
  'ridge-emission-under-ridge-extinction': Object.freeze({
    emission: Object.freeze({ ridge: true, nonRidge: false }),
    extinction: Object.freeze({ ridge: true, nonRidge: false }),
  }),
  'ridge-emission-under-total-flame-extinction': Object.freeze({
    emission: Object.freeze({ ridge: true, nonRidge: false }),
    extinction: Object.freeze({ ridge: true, nonRidge: true }),
  }),
  'nonridge-emission-under-total-flame-extinction': Object.freeze({
    emission: Object.freeze({ ridge: false, nonRidge: true }),
    extinction: Object.freeze({ ridge: true, nonRidge: true }),
  }),
  'complete-flame-under-total-extinction': Object.freeze({
    emission: Object.freeze({ ridge: true, nonRidge: true }),
    extinction: Object.freeze({ ridge: true, nonRidge: true }),
  }),
});
const args = parseArgs(process.argv.slice(2));
const requestedUrl = required('--url');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-intrinsic-presentation-witness'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/report.json`));
const timeoutMs = Number(args.get('--timeout-ms') || 180000);
const settleMs = Number(args.get('--settle-ms') || 2500);
const debugPort = Number(args.get('--debug-port') || randomInt(42000, 62000));
const chrome = process.env.KAMINOS_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const userDataDir = mkdtempSync('/tmp/kaminos-intrinsic-presentation-profile-');

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
          if (message.method === 'Runtime.exceptionThrown' || message.method === 'Runtime.consoleAPICalled' || message.method === 'Log.entryAdded') {
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
  const route = new URL(requestedUrl);
  assert.equal(route.searchParams.get('settings_preset'), FLAMEBOWL_PRESET_ID, 'witness route requires immutable Flamebowl preset identity');
  assert.equal(route.searchParams.get('settings_preset_authority'), 'shared-volume-settings-preset-v2', 'witness route requires shared preset authority');
  assert.equal(route.pathname, '/volume-selective-head-live.html', 'witness route must use the selective-head operator wrapper');
  assert.ok(route.search.includes('role=truthHigh'), `witness requires ${REQUIRED_BEAUTY_ROUTE}`);
  assert.ok(route.search.includes('composition=raymarch-only-v0'), `witness requires ${REQUIRED_BEAUTY_ROUTE}`);

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
  assert.equal(admitted.active, true, 'volume renderer did not become active');
  assert.ok(admitted.backend?.startsWith('WebGPU'), 'effective backend substituted away from WebGPU');
  assert.equal(admitted.sourceSettingsPreset?.sourcePresetAuthority, 'shared-volume-settings-preset-v2', 'shared preset authority missing');
  assert.equal(admitted.sourceSettingsPreset?.presetId, route.searchParams.get('settings_preset'), 'effective preset id does not match requested preset');
  assert.equal(admitted.sourceSettingsPreset?.controlCount, 192, 'complete 192-control preset identity was not preserved');
  await delay(settleMs);

  failurePhase = 'same-state-capture';
  const evidence = await evaluate(socket, `
    (async () => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const prototype = window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype;
      if (!prototype?.debugState || !prototype?.sampleFrame || !prototype?.setVolumePresentationMode) {
        throw new Error('intrinsic-presentation-runtime-api-missing');
      }
      const digest = async value => {
        const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(JSON.stringify(value));
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
          const r = rgba[index];
          const g = rgba[index + 1];
          const b = rgba[index + 2];
          const a = rgba[index + 3];
          const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          if (luma > 8) litPixels += 1;
          if (a > 8) alphaPixels += 1;
          lumaSum += luma;
        }
        return {
          litPixels,
          alphaPixels,
          meanLuma: lumaSum / Math.max(1, rgba.length / 4),
          nonblank: litPixels > 64,
        };
      };
      function pixelDelta(left, right) {
        if (!left || !right || left.length !== right.length) throw new Error('pixel-delta-shape-mismatch');
        let maxChannelDelta = 0;
        let absChannelDeltaSum = 0;
        let changedPixels = 0;
        for (let index = 0; index < left.length; index += 4) {
          let pixelChanged = false;
          for (let channel = 0; channel < 4; channel += 1) {
            const delta = Math.abs(left[index + channel] - right[index + channel]);
            maxChannelDelta = Math.max(maxChannelDelta, delta);
            absChannelDeltaSum += delta;
            pixelChanged ||= delta !== 0;
          }
          changedPixels += pixelChanged ? 1 : 0;
        }
        return {
          maxChannelDelta,
          meanAbsChannelDelta: absChannelDeltaSum / Math.max(1, left.length),
          changedPixels,
          changedPixelRatio: changedPixels / Math.max(1, left.length / 4),
        };
      }
      const wrapperState = operator?.debugState?.() || null;
      const sourceReceipt = basinWindow?.__kaminosVolumeSettingsPresetReceipt || null;
      const sourceSettingsPreset = wrapperState?.sourceSettingsPresetId ? {
        requestedPresetRef: wrapperState.sourceSettingsPresetRequestedId,
        presetId: wrapperState.sourceSettingsPresetId,
        label: wrapperState.sourceSettingsPresetLabel,
        contentHash: wrapperState.sourceSettingsPresetContentHash,
        storePath: wrapperState.sourceSettingsPresetStorePath,
        schemaIdentity: wrapperState.sourceSettingsPresetSchemaIdentity,
        sourcePresetAuthority: wrapperState.sourceSettingsPresetAuthority,
        controlCount: wrapperState.sourceSettingsPresetControlCount,
      } : (sourceReceipt ? {
        requestedPresetRef: sourceReceipt.requestedPresetRef,
        presetId: sourceReceipt.presetId,
        label: sourceReceipt.label,
        contentHash: sourceReceipt.contentHash,
        storePath: sourceReceipt.storePath,
        schemaIdentity: sourceReceipt.schemaIdentity,
        sourcePresetAuthority: sourceReceipt.sourcePresetAuthority,
        controlCount: Object.keys(sourceReceipt.preset?.domControls || {}).length,
      } : null);
      prototype.setSelectiveHeadLiveCapturePaused(true);
      await new Promise(resolve => setTimeout(resolve, 100));
      const before = prototype.debugState();
      const fixedNow = performance.now();
      const sameStateCaptureId = 'intrinsic-presentation-f' + before.frameCount + '-s' + before.simStepCount;
      const controlsHash = await digest(before.controls);
      const cameraHash = await digest(basinWindow?.kaminosCameraDebugState?.() || null);

      async function captureMode(mode, existingReceipt = null) {
        const receipt = existingReceipt || operator?.setPresentation?.(mode) || prototype.setVolumePresentationMode(mode);
        const captureStarted = performance.now();
        const sample = await prototype.sampleFrame({
          advanceSim: false,
          includeRgba: true,
          now: fixedNow,
          sameStateCaptureId,
          baseFrameCount: before.frameCount,
          baseSimStepCount: before.simStepCount,
        });
        if (!sample.ok || !sample.image?.rgba?.length) {
          throw new Error('presentation-sample-failed:' + mode + ':' + (sample.reason || 'missing-rgba'));
        }
        const rgba = Uint8Array.from(sample.image.rgba);
        return {
          mode,
          receipt,
          durationMs: performance.now() - captureStarted,
          sample: {
            width: sample.image.width,
            height: sample.image.height,
            frameCount: sample.frameCount,
            simStepCount: sample.simStepCount,
            volumeReconstructionStyle: sample.volumeReconstructionStyle,
            effectiveRoute: sample.effectiveRoute,
            prototypeIdentity: sample.prototypeIdentity,
            backend: sample.backend,
            boundarySplatMode: sample.boundarySplatMode,
            boundarySplatFeatureCaptureRequested: sample.boundarySplatFeatureCaptureRequested,
            boundarySplatFeatureCaptureEffective: sample.boundarySplatFeatureCaptureEffective,
            boundarySplatFallbackReason: sample.boundarySplatFallbackReason,
            boundarySplatInstanceCount: sample.boundarySplatInstanceCount,
            boundarySplatCandidateCount: sample.boundarySplatCandidateCount,
            volumePresentationReceipt: sample.volumePresentationReceipt,
            raymarchSmokePresentationReceipt: sample.raymarchSmokePresentationReceipt,
            appearanceDecompositionReceipt: sample.appearanceDecompositionReceipt,
            selectiveHeadLivePassReceipt: sample.selectiveHeadLivePassReceipt,
          },
          pixelHash: await digest(rgba),
          metrics: pixelMetrics(rgba),
          pngDataUrl: pngDataUrl({ width: sample.image.width, height: sample.image.height, rgba }),
          _rgba: rgba,
        };
      }

      async function captureAppearance(mode) {
        const beautyReceipt = prototype.setVolumePresentationMode('beauty');
        const appearanceDecompositionReceipt = operator?.setAppearanceAssay?.(mode)
          || prototype.setAppearanceDecompositionMode(mode);
        const capture = await captureMode('beauty', beautyReceipt);
        return {
          ...capture,
          mode,
          receipt: appearanceDecompositionReceipt,
          appearanceDecompositionReceipt: capture.sample.appearanceDecompositionReceipt,
          couplingTerms: appearanceDecompositionReceipt?.couplingTerms || [],
          passes: appearanceDecompositionReceipt?.passes || {},
        };
      }

      prototype.setRaymarchSmokePresentationMode('on');
      const beautySmokeOn = await captureMode('beauty');
      prototype.setRaymarchSmokePresentationMode('off');
      const beautySmokeOff = await captureMode('beauty');
      const intrinsic = await captureMode('intrinsic');
      const intrinsicCompositionControlState = {
        disabled: [...document.querySelectorAll('[data-composition]')].every(button => button.disabled && button.getAttribute('aria-disabled') === 'true'),
        rejectedReceipt: operator?.setComposition?.('smoke-raymarch-under-splats-v0') || null,
      };
      const appearanceStructuralA = await captureAppearance('structural-a');
      const appearanceBroadCarrierB = await captureAppearance('broad-carrier-b');
      const appearanceBAppliedToFixedA = await captureAppearance('b-applied-to-fixed-a');
      const appearanceRecomposition = await captureAppearance('a-plus-b-recomposition');
      const appearanceControl = await captureAppearance('smoke-off-beauty-control');
      const positiveCompleteEmission = await captureAppearance('complete-flame-emission');
      const positiveCompleteExtinction = await captureAppearance('complete-flame-extinction');
      const positiveRidgeOwnedEmission = await captureAppearance('ridge-owned-emission');
      const positiveRidgeOwnedExtinction = await captureAppearance('ridge-owned-extinction');
      const positiveNonRidgeEmission = await captureAppearance('non-ridge-emission');
      const positiveNonRidgeExtinction = await captureAppearance('non-ridge-extinction');
      const positiveOpticalRecomposition = await captureAppearance('positive-optical-recomposition');
      const ridgeEmissionUnderRidgeExtinction = await captureAppearance('ridge-emission-under-ridge-extinction');
      const ridgeEmissionUnderTotalExtinction = await captureAppearance('ridge-emission-under-total-flame-extinction');
      const nonRidgeEmissionUnderTotalExtinction = await captureAppearance('nonridge-emission-under-total-flame-extinction');
      const completeFlameUnderTotalExtinction = await captureAppearance('complete-flame-under-total-extinction');
      const sharedTransportRecomposition = await prototype.sampleSharedTransmittanceContributions({
        sameStateCaptureId,
        baseFrameCount: before.frameCount,
        baseSimStepCount: before.simStepCount,
        now: fixedNow,
      });
      if (!sharedTransportRecomposition?.ok) {
        throw new Error('shared-transmittance-renderer-recomposition-failed:' + JSON.stringify(sharedTransportRecomposition));
      }
      operator?.setAppearanceAssay?.('off') || prototype.setAppearanceDecompositionMode('off');
      prototype.setRaymarchSmokePresentationMode('on');
      const beautySmokeRestored = await captureMode('beauty');
      const afterPresentation = prototype.debugState();
      const beautyCompositionControlState = {
        enabled: [...document.querySelectorAll('[data-composition]')].every(button => !button.disabled && button.getAttribute('aria-disabled') === 'false'),
        appliedReceipt: operator?.setComposition?.('smoke-raymarch-under-splats-v0') || null,
      };
      const compositionProbe = await prototype.sampleFrame({
        advanceSim: false,
        includeRgba: false,
        now: fixedNow,
        sameStateCaptureId,
        baseFrameCount: before.frameCount,
        baseSimStepCount: before.simStepCount,
      });
      const compositionRestoreReceipt = operator?.setComposition?.('raymarch-only-v0') || null;
      const cameraOriginalPose = basinWindow?.kaminosCameraDebugState?.() || null;
      const cameraOriginalHash = await digest(cameraOriginalPose);
      const cameraHoldoutBefore = prototype.debugState();
      if (!cameraOriginalPose?.position || !cameraOriginalPose?.target || !basinWindow?.kaminosSetCameraDebugPose) {
        throw new Error('camera-holdout-runtime-api-missing');
      }
      const orbitAngle = 0.42;
      const dx = cameraOriginalPose.position[0] - cameraOriginalPose.target[0];
      const dz = cameraOriginalPose.position[2] - cameraOriginalPose.target[2];
      const cameraHoldoutPose = {
        position: [
          cameraOriginalPose.target[0] + dx * Math.cos(orbitAngle) - dz * Math.sin(orbitAngle),
          cameraOriginalPose.position[1],
          cameraOriginalPose.target[2] + dx * Math.sin(orbitAngle) + dz * Math.cos(orbitAngle),
        ],
        target: [...cameraOriginalPose.target],
      };
      basinWindow.kaminosSetCameraDebugPose(cameraHoldoutPose);
      const cameraHoldoutPoseHash = await digest(basinWindow.kaminosCameraDebugState());
      const cameraHoldoutRidgeEmission = await captureAppearance('ridge-owned-emission');
      const cameraHoldoutNonRidgeEmission = await captureAppearance('non-ridge-emission');
      const cameraHoldoutPositiveRecomposition = await captureAppearance('positive-optical-recomposition');
      const cameraHoldoutControl = await captureAppearance('smoke-off-beauty-control');
      const cameraHoldoutAfter = prototype.debugState();
      const cameraHoldoutRecompositionDelta = pixelDelta(cameraHoldoutPositiveRecomposition._rgba, cameraHoldoutControl._rgba);
      basinWindow.kaminosSetCameraDebugPose(cameraOriginalPose);
      const cameraRestoredHash = await digest(basinWindow.kaminosCameraDebugState());
      operator?.setAppearanceAssay?.('off') || prototype.setAppearanceDecompositionMode('off');
      const restorationDelta = pixelDelta(beautySmokeOn._rgba, beautySmokeRestored._rgba);
      const smokeIsolationDelta = pixelDelta(beautySmokeOn._rgba, beautySmokeOff._rgba);
      const structuralAParityDelta = pixelDelta(intrinsic._rgba, appearanceStructuralA._rgba);
      const recompositionDelta = pixelDelta(appearanceRecomposition._rgba, appearanceControl._rgba);
      const positiveRecompositionDelta = pixelDelta(positiveOpticalRecomposition._rgba, appearanceControl._rgba);
      delete beautySmokeOn._rgba;
      delete beautySmokeOff._rgba;
      delete intrinsic._rgba;
      delete appearanceStructuralA._rgba;
      delete appearanceBroadCarrierB._rgba;
      delete appearanceBAppliedToFixedA._rgba;
      delete appearanceRecomposition._rgba;
      delete appearanceControl._rgba;
      delete positiveCompleteEmission._rgba;
      delete positiveCompleteExtinction._rgba;
      delete positiveRidgeOwnedEmission._rgba;
      delete positiveRidgeOwnedExtinction._rgba;
      delete positiveNonRidgeEmission._rgba;
      delete positiveNonRidgeExtinction._rgba;
      delete positiveOpticalRecomposition._rgba;
      delete ridgeEmissionUnderRidgeExtinction._rgba;
      delete ridgeEmissionUnderTotalExtinction._rgba;
      delete nonRidgeEmissionUnderTotalExtinction._rgba;
      delete completeFlameUnderTotalExtinction._rgba;
      delete cameraHoldoutRidgeEmission._rgba;
      delete cameraHoldoutNonRidgeEmission._rgba;
      delete cameraHoldoutPositiveRecomposition._rgba;
      delete cameraHoldoutControl._rgba;
      delete beautySmokeRestored._rgba;
      const afterCompositionProbe = prototype.debugState();
      return {
        sourceSettingsPreset,
        requestedRoute: before.requestedRoute,
        effectiveRoute: before.effectiveRoute,
        wrapperRoute: wrapperState?.routeIdentity || null,
        requestedRole: wrapperState?.requestedRole || null,
        effectiveRole: wrapperState?.effectiveRole || null,
        requestedComposition: wrapperState?.requestedComposition || null,
        effectiveComposition: wrapperState?.effectiveComposition || null,
        prototypeIdentity: before.prototypeIdentity,
        backend: before.backend,
        sameStateCaptureId,
        before: {
          frameCount: before.frameCount,
          simStepCount: before.simStepCount,
          temporalHistoryResetCount: before.temporalHistoryResetCount,
          authoredSmokeControl: before.controls?.smoke,
          raySteps: before.controls?.raySteps,
          adaptiveRays: before.controls?.adaptiveRays,
          temporalAccum: before.controls?.temporalAccum,
          temporalJitter: before.controls?.temporalJitter,
          controlsHash,
          cameraHash,
        },
        after: {
          frameCount: afterPresentation.frameCount,
          simStepCount: afterPresentation.simStepCount,
          temporalHistoryResetCount: afterPresentation.temporalHistoryResetCount,
          authoredSmokeControl: afterPresentation.controls?.smoke,
          controlsHash: await digest(afterPresentation.controls),
          cameraHash: await digest(basinWindow?.kaminosCameraDebugState?.() || null),
        },
        beauty: beautySmokeOn,
        beautySmokeOn,
        beautySmokeOff,
        intrinsic,
        appearanceStructuralA,
        appearanceBroadCarrierB,
        appearanceBAppliedToFixedA,
        appearanceRecomposition,
        appearanceControl,
        positiveCompleteEmission,
        positiveCompleteExtinction,
        positiveRidgeOwnedEmission,
        positiveRidgeOwnedExtinction,
        positiveNonRidgeEmission,
        positiveNonRidgeExtinction,
        positiveOpticalRecomposition,
        ridgeEmissionUnderRidgeExtinction,
        ridgeEmissionUnderTotalExtinction,
        nonRidgeEmissionUnderTotalExtinction,
        completeFlameUnderTotalExtinction,
        sharedTransportRecomposition,
        cameraHoldout: {
          cameraOriginalPose,
          cameraOriginalHash,
          cameraHoldoutPose,
          cameraHoldoutPoseHash,
          cameraRestoredHash,
          cameraHoldoutBefore: {
            frameCount: cameraHoldoutBefore.frameCount,
            simStepCount: cameraHoldoutBefore.simStepCount,
          },
          cameraHoldoutAfter: {
            frameCount: cameraHoldoutAfter.frameCount,
            simStepCount: cameraHoldoutAfter.simStepCount,
          },
          cameraHoldoutRidgeEmission,
          cameraHoldoutNonRidgeEmission,
          cameraHoldoutPositiveRecomposition,
          cameraHoldoutControl,
          cameraHoldoutRecompositionDelta,
        },
        beautyRestored: beautySmokeRestored,
        beautySmokeRestored,
        intrinsicCompositionControlState,
        beautyCompositionControlState,
        compositionProbe: {
          ok: compositionProbe.ok,
          volumePresentationReceipt: compositionProbe.volumePresentationReceipt,
          selectiveHeadLivePassReceipt: compositionProbe.selectiveHeadLivePassReceipt,
        },
        compositionRestoreReceipt,
        afterCompositionProbe: {
          frameCount: afterCompositionProbe.frameCount,
          simStepCount: afterCompositionProbe.simStepCount,
          requestedComposition: afterCompositionProbe.selectiveHeadLiveCompositionRequested,
          effectiveComposition: afterCompositionProbe.selectiveHeadLiveCompositionEffective,
        },
        smokeIsolationDelta,
        structuralAParityDelta,
        recompositionDelta,
        positiveRecompositionDelta,
        restorationDelta,
      };
    })()
  `);
  const restorationAcceptance = {
    thresholds: {
      maxChannelDelta: RESTORATION_MAX_CHANNEL_DELTA,
      maxMeanAbsChannelDelta: RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA,
      maxChangedPixelRatio: RESTORATION_MAX_CHANGED_PIXEL_RATIO,
    },
    observed: evidence.restorationDelta,
    exactPixelHashMatch: evidence.beautySmokeRestored.pixelHash === evidence.beautySmokeOn.pixelHash,
    accepted: evidence.restorationDelta.maxChannelDelta <= RESTORATION_MAX_CHANNEL_DELTA
      && evidence.restorationDelta.meanAbsChannelDelta <= RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA
      && evidence.restorationDelta.changedPixelRatio <= RESTORATION_MAX_CHANGED_PIXEL_RATIO,
  };
  lastTrustworthyEvidence = { admitted, evidence: stripEvidencePngData(evidence), restorationAcceptance };

  failurePhase = 'evidence-validation';
  assert.equal(evidence.before.simStepCount, evidence.after.simStepCount, 'presentation switching advanced simulation');
  assert.equal(evidence.before.frameCount, evidence.after.frameCount, 'presentation switching advanced presented frame state');
  assert.equal(evidence.before.temporalHistoryResetCount, evidence.after.temporalHistoryResetCount, 'presentation switching reset temporal history');
  assert.equal(evidence.before.controlsHash, evidence.after.controlsHash, 'presentation switching mutated authored controls');
  assert.equal(evidence.before.cameraHash, evidence.after.cameraHash, 'presentation switching mutated camera state');
  assert.equal(evidence.sourceSettingsPreset.presetId, FLAMEBOWL_PRESET_ID, 'effective preset substituted away from Flamebowl');
  assert.equal(evidence.sourceSettingsPreset.label, FLAMEBOWL_PRESET_LABEL, 'effective preset label does not identify Flamebowl');
  assert.equal(evidence.before.raySteps, 160, 'Flamebowl witness did not preserve 160 ray steps');
  assert.equal(evidence.before.adaptiveRays, 0, 'Flamebowl witness did not disable adaptive rays');
  assert.equal(evidence.before.temporalAccum, 0, 'Flamebowl witness did not disable temporal accumulation');
  assert.equal(evidence.before.temporalJitter, 0, 'Flamebowl witness did not disable temporal jitter');
  assert.equal(evidence.before.authoredSmokeControl, evidence.after.authoredSmokeControl, 'Smoke Off mutated the authored smoke control');
  assert.equal(evidence.intrinsic.receipt.requestedMode, 'intrinsic');
  assert.equal(evidence.intrinsic.receipt.effectiveMode, 'intrinsic');
  assert.equal(evidence.intrinsic.receipt.fallbackReason, null);
  assert.equal(evidence.intrinsic.receipt.targetIdentity, TARGET_IDENTITY);
  assert.equal(evidence.intrinsic.receipt.passes.splats, 'off');
  assert.equal(evidence.intrinsic.receipt.passes.residual, 'off');
  assert.equal(evidence.intrinsic.receipt.passes.featureCapture, 'off');
  assert.equal(evidence.intrinsic.receipt.passes.smoke, 'suppressed');
  assert.equal(evidence.intrinsic.receipt.authoredControlsMutated, false);
  assert.equal(evidence.intrinsic.receipt.simulationAdvanced, false);
  assert.equal(evidence.intrinsic.receipt.cameraMutated, false);
  assert.equal(evidence.beautySmokeOn.sample.volumePresentationReceipt.application.raymarchApplied, true, 'Beauty Smoke On raymarch pass was not applied');
  assert.equal(evidence.beautySmokeOn.sample.volumePresentationReceipt.application.splatsApplied, false, 'Beauty Smoke On unexpectedly applied splats');
  assert.equal(evidence.beautySmokeOn.sample.raymarchSmokePresentationReceipt.requestedMode, 'on');
  assert.equal(evidence.beautySmokeOn.sample.raymarchSmokePresentationReceipt.effectiveMode, 'on');
  assert.equal(evidence.beautySmokeOn.sample.raymarchSmokePresentationReceipt.fallbackReason, null);
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.requestedMode, 'off');
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.effectiveMode, 'off');
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.fallbackReason, null);
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.contributions.radiance, 'suppressed');
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.contributions.extinction, 'suppressed');
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.contributions.dynamics, 'preserved');
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.authoredSmokeControl, evidence.before.authoredSmokeControl);
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.authoredSmokeControlMutated, false);
  assert.equal(evidence.beautySmokeOff.sample.raymarchSmokePresentationReceipt.smokeProducingDynamicsMutated, false);
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.raymarchApplied, true, 'Intrinsic raymarch pass was not applied');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.splatsApplied, false, 'Intrinsic applied splats');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.residualEncoded, false, 'Intrinsic encoded residual');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.residualApplied, false, 'Intrinsic applied residual');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.featureCaptureEncoded, false, 'Intrinsic encoded feature capture');
  assert.equal(evidence.intrinsic.sample.volumePresentationReceipt.application.featureCaptureApplied, false, 'Intrinsic applied feature capture');
  assert.equal(evidence.beauty.metrics.nonblank, true, 'Beauty output is blank');
  assert.equal(evidence.beautySmokeOff.metrics.nonblank, true, 'Beauty Smoke Off output is blank');
  assert.equal(evidence.intrinsic.metrics.nonblank, true, 'intrinsic output is blank');
  assert.equal(evidence.appearanceStructuralA.metrics.nonblank, true, 'Appearance A output is blank');
  assert.equal(evidence.appearanceBroadCarrierB.metrics.nonblank, true, 'Appearance B coefficient output is blank');
  assert.equal(evidence.appearanceBAppliedToFixedA.metrics.nonblank, true, 'Appearance B-on-A output is blank');
  assert.equal(evidence.appearanceRecomposition.metrics.nonblank, true, 'Appearance A+B output is blank');
  assert.equal(evidence.appearanceControl.metrics.nonblank, true, 'Appearance control output is blank');
  assert.equal(evidence.positiveCompleteEmission.metrics.nonblank, true, 'Complete Flame emission output is blank');
  assert.equal(evidence.positiveCompleteExtinction.metrics.nonblank, true, 'Complete Flame extinction output is blank');
  assert.equal(evidence.positiveRidgeOwnedEmission.metrics.nonblank, true, 'Ridge-Owned emission output is blank');
  assert.equal(evidence.positiveRidgeOwnedExtinction.metrics.nonblank, true, 'Ridge-Owned extinction output is blank');
  assert.equal(evidence.positiveNonRidgeEmission.metrics.nonblank, true, 'Non-Ridge emission output is blank');
  assert.equal(evidence.positiveNonRidgeExtinction.metrics.nonblank, true, 'Non-Ridge extinction output is blank');
  assert.equal(evidence.positiveOpticalRecomposition.metrics.nonblank, true, 'positive optical recomposition output is blank');
  assert.equal(evidence.ridgeEmissionUnderRidgeExtinction.metrics.nonblank, true, 'Ridge emission under Ridge extinction is blank');
  assert.equal(evidence.ridgeEmissionUnderTotalExtinction.metrics.nonblank, true, 'Ridge emission under total extinction is blank');
  assert.equal(evidence.nonRidgeEmissionUnderTotalExtinction.metrics.nonblank, true, 'Non-Ridge emission under total extinction is blank');
  assert.equal(evidence.completeFlameUnderTotalExtinction.metrics.nonblank, true, 'Complete Flame under total extinction is blank');
  assert.equal(evidence.beautyRestored.metrics.nonblank, true, 'restored Beauty output is blank');
  assert.notEqual(evidence.beauty.pixelHash, evidence.intrinsic.pixelHash, 'Intrinsic silently substituted Beauty pixels');
  assert.notEqual(evidence.beautySmokeOn.pixelHash, evidence.beautySmokeOff.pixelHash, 'Smoke Off silently reused Smoke On pixels');
  assert.ok(evidence.smokeIsolationDelta.changedPixelRatio > 0.001, 'Smoke On/Off did not produce a material pixel difference');
  for (const capture of [
    evidence.appearanceStructuralA,
    evidence.appearanceBroadCarrierB,
    evidence.appearanceBAppliedToFixedA,
    evidence.appearanceRecomposition,
    evidence.appearanceControl,
    evidence.positiveCompleteEmission,
    evidence.positiveCompleteExtinction,
    evidence.positiveRidgeOwnedEmission,
    evidence.positiveRidgeOwnedExtinction,
    evidence.positiveNonRidgeEmission,
    evidence.positiveNonRidgeExtinction,
    evidence.positiveOpticalRecomposition,
    evidence.ridgeEmissionUnderRidgeExtinction,
    evidence.ridgeEmissionUnderTotalExtinction,
    evidence.nonRidgeEmissionUnderTotalExtinction,
    evidence.completeFlameUnderTotalExtinction,
    evidence.cameraHoldout.cameraHoldoutRidgeEmission,
    evidence.cameraHoldout.cameraHoldoutNonRidgeEmission,
    evidence.cameraHoldout.cameraHoldoutPositiveRecomposition,
    evidence.cameraHoldout.cameraHoldoutControl,
  ]) {
    assert.equal(capture.receipt.requestedMode, capture.mode, `appearance request identity drifted for ${capture.mode}`);
    assert.equal(capture.receipt.effectiveMode, capture.mode, `appearance effective identity drifted for ${capture.mode}`);
    assert.equal(capture.receipt.fallbackReason, null, `appearance fallback applied for ${capture.mode}`);
    assert.equal(capture.appearanceDecompositionReceipt.effectiveMode, capture.mode, `sampled appearance identity drifted for ${capture.mode}`);
    const applied = capture.appearanceDecompositionReceipt.application;
    assert.equal(applied.raymarchEncoded, true, `appearance raymarch was not encoded for ${capture.mode}`);
    assert.equal(applied.raymarchApplied, true, `appearance raymarch missing for ${capture.mode}`);
    assert.equal(applied.splatsEncoded, false, `appearance splats encoded for ${capture.mode}`);
    assert.equal(applied.splatsApplied, false, `appearance splats applied for ${capture.mode}`);
    assert.equal(applied.residualEncoded, false, `appearance residual encoded for ${capture.mode}`);
    assert.equal(applied.residualApplied, false, `appearance residual applied for ${capture.mode}`);
    assert.equal(applied.smokeApplied, false, `appearance smoke applied for ${capture.mode}`);
    assert.ok(capture.receipt.couplingTerms.length >= 3, `appearance coupling terms missing for ${capture.mode}`);
  }
  const sharedTransportCaptures = [
    evidence.ridgeEmissionUnderRidgeExtinction,
    evidence.ridgeEmissionUnderTotalExtinction,
    evidence.nonRidgeEmissionUnderTotalExtinction,
    evidence.completeFlameUnderTotalExtinction,
  ];
  for (const capture of sharedTransportCaptures) {
    const expectedMasks = sharedTransportExpectedMasks[capture.mode];
    const receipt = capture.appearanceDecompositionReceipt;
    const application = receipt.application;
    assert.deepEqual(receipt.requestedEmissionMask, expectedMasks.emission, `requested emission mask drifted for ${capture.mode}`);
    assert.deepEqual(receipt.effectiveEmissionMask, expectedMasks.emission, `effective emission mask drifted for ${capture.mode}`);
    assert.deepEqual(receipt.requestedExtinctionMask, expectedMasks.extinction, `requested extinction mask drifted for ${capture.mode}`);
    assert.deepEqual(receipt.effectiveExtinctionMask, expectedMasks.extinction, `effective extinction mask drifted for ${capture.mode}`);
    assert.equal(application.sourceState.sameStateCaptureId, evidence.sameStateCaptureId, `source-state capture identity drifted for ${capture.mode}`);
    assert.equal(application.sourceState.frameCount, evidence.before.frameCount, `source frame drifted for ${capture.mode}`);
    assert.equal(application.sourceState.simStepCount, evidence.before.simStepCount, `source simulation step drifted for ${capture.mode}`);
    assert.ok(application.camera.signature && application.camera.position.length === 3, `camera receipt is incomplete for ${capture.mode}`);
    assert.equal(application.route.effective, evidence.effectiveRoute, `effective route drifted for ${capture.mode}`);
    assert.equal(application.backend, evidence.backend, `backend drifted for ${capture.mode}`);
    assert.equal(application.quality.raySteps, 160, `ray quality drifted for ${capture.mode}`);
    assert.equal(application.quality.adaptiveRays, 0, `adaptive rays drifted for ${capture.mode}`);
    assert.equal(application.postprocess.sumDomain, 'pre-tone-map-linear-radiance', `sum domain drifted for ${capture.mode}`);
    assert.equal(application.postprocess.independentlyToneMappedAddition, false, `tone-mapped addition was admitted for ${capture.mode}`);
    assert.equal(application.fallbackReason, null, `applied transport fallback was hidden for ${capture.mode}`);
  }
  const sharedTransportRecomposition = evidence.sharedTransportRecomposition;
  const completeTransportApplication = evidence.completeFlameUnderTotalExtinction.appearanceDecompositionReceipt.application;
  assert.equal(sharedTransportRecomposition.ok, true, 'renderer-derived shared transport recomposition did not pass');
  assert.equal(sharedTransportRecomposition.status, 'captured', 'renderer-derived shared transport readback did not complete');
  assert.equal(sharedTransportRecomposition.mode, 'complete-flame-under-total-extinction', 'renderer readback used the wrong optical mode');
  assert.equal(sharedTransportRecomposition.exactWithinDeclaredPrecision, true, 'renderer pre-tone-map channels did not reconstruct Complete within declared precision');
  assert.equal(sharedTransportRecomposition.violationCount, 0, 'renderer recomposition reported component violations');
  assert.equal(sharedTransportRecomposition.channelsNonblank, true, 'renderer recomposition admitted a blank contribution channel');
  assert.ok(Number.isFinite(sharedTransportRecomposition.maxAbsError), 'renderer recomposition error is not finite');
  assert.ok(sharedTransportRecomposition.channelMax.ridge > 0, 'renderer Ridge contribution readback is blank');
  assert.ok(sharedTransportRecomposition.channelMax.nonRidge > 0, 'renderer Non-Ridge contribution readback is blank');
  assert.ok(sharedTransportRecomposition.channelMax.complete > 0, 'renderer Complete contribution readback is blank');
  assert.deepEqual(sharedTransportRecomposition.effectiveEmissionMask, sharedTransportExpectedMasks['complete-flame-under-total-extinction'].emission, 'renderer readback emission mask drifted');
  assert.deepEqual(sharedTransportRecomposition.effectiveExtinctionMask, sharedTransportExpectedMasks['complete-flame-under-total-extinction'].extinction, 'renderer readback extinction mask drifted');
  assert.equal(sharedTransportRecomposition.sourceState.sameStateCaptureId, evidence.sameStateCaptureId, 'renderer readback source-state identity drifted');
  assert.equal(sharedTransportRecomposition.sourceState.frameCount, evidence.before.frameCount, 'renderer readback source frame drifted');
  assert.equal(sharedTransportRecomposition.sourceState.simStepCount, evidence.before.simStepCount, 'renderer readback simulation step drifted');
  assert.equal(sharedTransportRecomposition.camera.signature, completeTransportApplication.camera.signature, 'renderer readback camera drifted');
  assert.equal(sharedTransportRecomposition.route.requested, evidence.requestedRoute, 'renderer readback requested route drifted');
  assert.equal(sharedTransportRecomposition.route.effective, evidence.effectiveRoute, 'renderer readback route drifted');
  assert.equal(sharedTransportRecomposition.backend, evidence.backend, 'renderer readback backend drifted');
  assert.equal(sharedTransportRecomposition.quality.raySteps, 160, 'renderer readback quality drifted');
  assert.equal(sharedTransportRecomposition.postprocess.sumDomain, 'pre-tone-map-linear-radiance', 'renderer readback left the pre-tone-map domain');
  assert.equal(sharedTransportRecomposition.independentlyToneMappedAddition, false, 'renderer readback admitted independently tone-mapped addition');
  assert.equal(sharedTransportRecomposition.fallbackReason, null, 'renderer readback hid fallback');
  assert.equal(evidence.structuralAParityDelta.maxChannelDelta, 0, 'Appearance A diverged from exact Intrinsic pixels');
  assert.equal(evidence.structuralAParityDelta.changedPixelRatio, 0, 'Appearance A changed pixels relative to exact Intrinsic');
  assert.equal(evidence.recompositionDelta.maxChannelDelta, 0, 'A+B did not exactly reconstruct Smoke-Off control pixels');
  assert.equal(evidence.recompositionDelta.changedPixelRatio, 0, 'A+B/control pixel identity was not exact');
  assert.equal(evidence.positiveRecompositionDelta.maxChannelDelta, 0, 'positive partition did not exactly reconstruct Complete Flame pixels');
  assert.equal(evidence.positiveRecompositionDelta.changedPixelRatio, 0, 'positive partition changed pixels relative to Complete Flame');
  assert.notEqual(evidence.cameraHoldout.cameraOriginalHash, evidence.cameraHoldout.cameraHoldoutPoseHash, 'camera holdout did not change camera identity');
  assert.equal(evidence.cameraHoldout.cameraOriginalHash, evidence.cameraHoldout.cameraRestoredHash, 'camera holdout did not restore the exact camera identity');
  assert.equal(evidence.cameraHoldout.cameraHoldoutBefore.frameCount, evidence.cameraHoldout.cameraHoldoutAfter.frameCount, 'camera holdout advanced presented frame state');
  assert.equal(evidence.cameraHoldout.cameraHoldoutBefore.simStepCount, evidence.cameraHoldout.cameraHoldoutAfter.simStepCount, 'camera holdout advanced simulation');
  assert.equal(evidence.cameraHoldout.cameraHoldoutRidgeEmission.metrics.nonblank, true, 'held-out Ridge-Owned emission is blank');
  assert.equal(evidence.cameraHoldout.cameraHoldoutNonRidgeEmission.metrics.nonblank, true, 'held-out Non-Ridge emission is blank');
  assert.equal(evidence.cameraHoldout.cameraHoldoutRecompositionDelta.maxChannelDelta, 0, 'held-out positive partition did not exactly reconstruct Complete Flame pixels');
  assert.equal(evidence.cameraHoldout.cameraHoldoutRecompositionDelta.changedPixelRatio, 0, 'held-out positive partition changed pixels relative to Complete Flame');
  assert.equal(evidence.intrinsicCompositionControlState.disabled, true, 'Intrinsic did not disable composition controls');
  assert.equal(evidence.intrinsicCompositionControlState.rejectedReceipt?.reason, 'composition-controls-disabled-during-intrinsic', 'Intrinsic composition click was not rejected explicitly');
  assert.equal(evidence.beautyCompositionControlState.enabled, true, 'Beauty did not restore composition controls');
  assert.equal(evidence.beautyCompositionControlState.appliedReceipt?.effectiveComposition, 'smoke-raymarch-under-splats-v0', 'restored Beauty composition control did not apply');
  assert.equal(evidence.compositionProbe.volumePresentationReceipt.application.raymarchApplied, true, 'restored Beauty composition probe missed raymarch pass');
  assert.equal(evidence.compositionProbe.volumePresentationReceipt.application.splatsApplied, true, 'restored Beauty composition probe missed splat pass');
  assert.equal(evidence.compositionRestoreReceipt?.effectiveComposition, 'raymarch-only-v0', 'witness did not restore the Flamebowl raymarch-only composition');
  assert.equal(evidence.afterCompositionProbe.frameCount, evidence.before.frameCount, 'composition probe advanced presented frame state');
  assert.equal(evidence.afterCompositionProbe.simStepCount, evidence.before.simStepCount, 'composition probe advanced simulation');
  assert.ok(evidence.restorationDelta.maxChannelDelta <= RESTORATION_MAX_CHANNEL_DELTA, 'restored Beauty channel drift exceeds measured bound');
  assert.ok(evidence.restorationDelta.meanAbsChannelDelta <= RESTORATION_MAX_MEAN_ABS_CHANNEL_DELTA, 'restored Beauty mean drift exceeds measured bound');
  assert.ok(evidence.restorationDelta.changedPixelRatio <= RESTORATION_MAX_CHANGED_PIXEL_RATIO, 'restored Beauty changed-pixel ratio exceeds measured bound');

  failurePhase = 'artifact-write';
  for (const [name, capture] of [
    ['beauty-smoke-on.png', evidence.beautySmokeOn],
    ['beauty-smoke-off.png', evidence.beautySmokeOff],
    ['intrinsic.png', evidence.intrinsic],
    ['appearance-a-structural.png', evidence.appearanceStructuralA],
    ['appearance-b-coefficients.png', evidence.appearanceBroadCarrierB],
    ['appearance-b-on-fixed-a.png', evidence.appearanceBAppliedToFixedA],
    ['appearance-a-plus-b.png', evidence.appearanceRecomposition],
    ['appearance-smoke-off-control.png', evidence.appearanceControl],
    ['positive-complete-emission.png', evidence.positiveCompleteEmission],
    ['positive-complete-extinction.png', evidence.positiveCompleteExtinction],
    ['positive-ridge-owned-emission.png', evidence.positiveRidgeOwnedEmission],
    ['positive-ridge-owned-extinction.png', evidence.positiveRidgeOwnedExtinction],
    ['positive-non-ridge-emission.png', evidence.positiveNonRidgeEmission],
    ['positive-non-ridge-extinction.png', evidence.positiveNonRidgeExtinction],
    ['positive-optical-recomposition.png', evidence.positiveOpticalRecomposition],
    ['transport-ridge-emission-ridge-extinction.png', evidence.ridgeEmissionUnderRidgeExtinction],
    ['transport-ridge-emission-total-extinction.png', evidence.ridgeEmissionUnderTotalExtinction],
    ['transport-nonridge-emission-total-extinction.png', evidence.nonRidgeEmissionUnderTotalExtinction],
    ['transport-complete-flame-total-extinction.png', evidence.completeFlameUnderTotalExtinction],
    ['holdout-ridge-owned-emission.png', evidence.cameraHoldout.cameraHoldoutRidgeEmission],
    ['holdout-non-ridge-emission.png', evidence.cameraHoldout.cameraHoldoutNonRidgeEmission],
    ['holdout-positive-optical-recomposition.png', evidence.cameraHoldout.cameraHoldoutPositiveRecomposition],
    ['holdout-complete-flame-control.png', evidence.cameraHoldout.cameraHoldoutControl],
    ['beauty-smoke-restored.png', evidence.beautySmokeRestored],
  ]) {
    writeFileSync(resolve(outDir, name), decodePngDataUrl(capture.pngDataUrl));
  }
  const fullScreenshot = await socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(resolve(outDir, 'operator-cockpit-restored-beauty.png'), Buffer.from(fullScreenshot.data, 'base64'));
  const report = {
    identity: REPORT_IDENTITY,
    status: 'passed',
    requestedUrl,
    effectiveUrl: admitted.location,
    sourceSettingsPreset: evidence.sourceSettingsPreset,
    requestedRoute: evidence.requestedRoute,
    effectiveRoute: evidence.effectiveRoute,
    prototypeIdentity: evidence.prototypeIdentity,
    backend: evidence.backend,
    sameStateCaptureId: evidence.sameStateCaptureId,
    before: evidence.before,
    after: evidence.after,
    beauty: stripPngData(evidence.beautySmokeOn),
    beautySmokeOn: stripPngData(evidence.beautySmokeOn),
    beautySmokeOff: stripPngData(evidence.beautySmokeOff),
    intrinsic: stripPngData(evidence.intrinsic),
    appearanceStructuralA: stripPngData(evidence.appearanceStructuralA),
    appearanceBroadCarrierB: stripPngData(evidence.appearanceBroadCarrierB),
    appearanceBAppliedToFixedA: stripPngData(evidence.appearanceBAppliedToFixedA),
    appearanceRecomposition: stripPngData(evidence.appearanceRecomposition),
    appearanceControl: stripPngData(evidence.appearanceControl),
    positiveCompleteEmission: stripPngData(evidence.positiveCompleteEmission),
    positiveCompleteExtinction: stripPngData(evidence.positiveCompleteExtinction),
    positiveRidgeOwnedEmission: stripPngData(evidence.positiveRidgeOwnedEmission),
    positiveRidgeOwnedExtinction: stripPngData(evidence.positiveRidgeOwnedExtinction),
    positiveNonRidgeEmission: stripPngData(evidence.positiveNonRidgeEmission),
    positiveNonRidgeExtinction: stripPngData(evidence.positiveNonRidgeExtinction),
    positiveOpticalRecomposition: stripPngData(evidence.positiveOpticalRecomposition),
    ridgeEmissionUnderRidgeExtinction: stripPngData(evidence.ridgeEmissionUnderRidgeExtinction),
    ridgeEmissionUnderTotalExtinction: stripPngData(evidence.ridgeEmissionUnderTotalExtinction),
    nonRidgeEmissionUnderTotalExtinction: stripPngData(evidence.nonRidgeEmissionUnderTotalExtinction),
    completeFlameUnderTotalExtinction: stripPngData(evidence.completeFlameUnderTotalExtinction),
    sharedTransportRecomposition: evidence.sharedTransportRecomposition,
    positiveRecompositionDelta: evidence.positiveRecompositionDelta,
    cameraHoldout: {
      ...evidence.cameraHoldout,
      cameraHoldoutRidgeEmission: stripPngData(evidence.cameraHoldout.cameraHoldoutRidgeEmission),
      cameraHoldoutNonRidgeEmission: stripPngData(evidence.cameraHoldout.cameraHoldoutNonRidgeEmission),
      cameraHoldoutPositiveRecomposition: stripPngData(evidence.cameraHoldout.cameraHoldoutPositiveRecomposition),
      cameraHoldoutControl: stripPngData(evidence.cameraHoldout.cameraHoldoutControl),
    },
    structuralAParityDelta: evidence.structuralAParityDelta,
    recompositionDelta: evidence.recompositionDelta,
    beautyRestored: stripPngData(evidence.beautySmokeRestored),
    beautySmokeRestored: stripPngData(evidence.beautySmokeRestored),
    smokeIsolationDelta: evidence.smokeIsolationDelta,
    intrinsicCompositionControlState: evidence.intrinsicCompositionControlState,
    beautyCompositionControlState: evidence.beautyCompositionControlState,
    compositionProbe: evidence.compositionProbe,
    compositionRestoreReceipt: evidence.compositionRestoreReceipt,
    restorationAcceptance,
    artifacts: {
      beauty: relative(process.cwd(), resolve(outDir, 'beauty-smoke-on.png')),
      beautySmokeOn: relative(process.cwd(), resolve(outDir, 'beauty-smoke-on.png')),
      beautySmokeOff: relative(process.cwd(), resolve(outDir, 'beauty-smoke-off.png')),
      intrinsic: relative(process.cwd(), resolve(outDir, 'intrinsic.png')),
      appearanceStructuralA: relative(process.cwd(), resolve(outDir, 'appearance-a-structural.png')),
      appearanceBroadCarrierB: relative(process.cwd(), resolve(outDir, 'appearance-b-coefficients.png')),
      appearanceBAppliedToFixedA: relative(process.cwd(), resolve(outDir, 'appearance-b-on-fixed-a.png')),
      appearanceRecomposition: relative(process.cwd(), resolve(outDir, 'appearance-a-plus-b.png')),
      appearanceControl: relative(process.cwd(), resolve(outDir, 'appearance-smoke-off-control.png')),
      positiveCompleteEmission: relative(process.cwd(), resolve(outDir, 'positive-complete-emission.png')),
      positiveCompleteExtinction: relative(process.cwd(), resolve(outDir, 'positive-complete-extinction.png')),
      positiveRidgeOwnedEmission: relative(process.cwd(), resolve(outDir, 'positive-ridge-owned-emission.png')),
      positiveRidgeOwnedExtinction: relative(process.cwd(), resolve(outDir, 'positive-ridge-owned-extinction.png')),
      positiveNonRidgeEmission: relative(process.cwd(), resolve(outDir, 'positive-non-ridge-emission.png')),
      positiveNonRidgeExtinction: relative(process.cwd(), resolve(outDir, 'positive-non-ridge-extinction.png')),
      positiveOpticalRecomposition: relative(process.cwd(), resolve(outDir, 'positive-optical-recomposition.png')),
      ridgeEmissionUnderRidgeExtinction: relative(process.cwd(), resolve(outDir, 'transport-ridge-emission-ridge-extinction.png')),
      ridgeEmissionUnderTotalExtinction: relative(process.cwd(), resolve(outDir, 'transport-ridge-emission-total-extinction.png')),
      nonRidgeEmissionUnderTotalExtinction: relative(process.cwd(), resolve(outDir, 'transport-nonridge-emission-total-extinction.png')),
      completeFlameUnderTotalExtinction: relative(process.cwd(), resolve(outDir, 'transport-complete-flame-total-extinction.png')),
      cameraHoldoutRidgeEmission: relative(process.cwd(), resolve(outDir, 'holdout-ridge-owned-emission.png')),
      cameraHoldoutNonRidgeEmission: relative(process.cwd(), resolve(outDir, 'holdout-non-ridge-emission.png')),
      cameraHoldoutPositiveRecomposition: relative(process.cwd(), resolve(outDir, 'holdout-positive-optical-recomposition.png')),
      cameraHoldoutControl: relative(process.cwd(), resolve(outDir, 'holdout-complete-flame-control.png')),
      beautyRestored: relative(process.cwd(), resolve(outDir, 'beauty-smoke-restored.png')),
      beautySmokeRestored: relative(process.cwd(), resolve(outDir, 'beauty-smoke-restored.png')),
      cockpitRestoredBeauty: relative(process.cwd(), resolve(outDir, 'operator-cockpit-restored-beauty.png')),
    },
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = {
    identity: REPORT_IDENTITY,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    requestedUrl,
    lastTrustworthyEvidence,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) browser.kill('SIGTERM');
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    parsed.set(key, value);
    if (value !== true) index += 1;
  }
  return parsed;
}

function required(name) {
  const value = args.get(name);
  if (!value || value === true) throw new Error(`${name} is required`);
  return String(value);
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

function stripPngData(capture) {
  const { pngDataUrl, ...rest } = capture || {};
  return rest;
}

function stripEvidencePngData(evidence) {
  return {
    ...evidence,
    beauty: stripPngData(evidence?.beauty),
    beautySmokeOn: stripPngData(evidence?.beautySmokeOn),
    beautySmokeOff: stripPngData(evidence?.beautySmokeOff),
    intrinsic: stripPngData(evidence?.intrinsic),
    appearanceStructuralA: stripPngData(evidence?.appearanceStructuralA),
    appearanceBroadCarrierB: stripPngData(evidence?.appearanceBroadCarrierB),
    appearanceBAppliedToFixedA: stripPngData(evidence?.appearanceBAppliedToFixedA),
    appearanceRecomposition: stripPngData(evidence?.appearanceRecomposition),
    appearanceControl: stripPngData(evidence?.appearanceControl),
    positiveCompleteEmission: stripPngData(evidence?.positiveCompleteEmission),
    positiveCompleteExtinction: stripPngData(evidence?.positiveCompleteExtinction),
    positiveRidgeOwnedEmission: stripPngData(evidence?.positiveRidgeOwnedEmission),
    positiveRidgeOwnedExtinction: stripPngData(evidence?.positiveRidgeOwnedExtinction),
    positiveNonRidgeEmission: stripPngData(evidence?.positiveNonRidgeEmission),
    positiveNonRidgeExtinction: stripPngData(evidence?.positiveNonRidgeExtinction),
    positiveOpticalRecomposition: stripPngData(evidence?.positiveOpticalRecomposition),
    ridgeEmissionUnderRidgeExtinction: stripPngData(evidence?.ridgeEmissionUnderRidgeExtinction),
    ridgeEmissionUnderTotalExtinction: stripPngData(evidence?.ridgeEmissionUnderTotalExtinction),
    nonRidgeEmissionUnderTotalExtinction: stripPngData(evidence?.nonRidgeEmissionUnderTotalExtinction),
    completeFlameUnderTotalExtinction: stripPngData(evidence?.completeFlameUnderTotalExtinction),
    cameraHoldout: evidence?.cameraHoldout ? {
      ...evidence.cameraHoldout,
      cameraHoldoutRidgeEmission: stripPngData(evidence.cameraHoldout.cameraHoldoutRidgeEmission),
      cameraHoldoutNonRidgeEmission: stripPngData(evidence.cameraHoldout.cameraHoldoutNonRidgeEmission),
      cameraHoldoutPositiveRecomposition: stripPngData(evidence.cameraHoldout.cameraHoldoutPositiveRecomposition),
      cameraHoldoutControl: stripPngData(evidence.cameraHoldout.cameraHoldoutControl),
    } : null,
    beautyRestored: stripPngData(evidence?.beautyRestored),
    beautySmokeRestored: stripPngData(evidence?.beautySmokeRestored),
  };
}

function decodePngDataUrl(value) {
  const match = /^data:image\/png;base64,(.+)$/.exec(String(value || ''));
  if (!match) throw new Error('capture did not return a PNG data URL');
  return Buffer.from(match[1], 'base64');
}

async function waitForTarget(port, timeout) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const target = targets.find(candidate => candidate.type === 'page');
      if (target?.webSocketDebuggerUrl) return target;
    } catch {}
    await delay(100);
  }
  throw new Error('timed out waiting for Chrome DevTools target');
}

async function waitForRuntime(cdp, timeout) {
  const started = performance.now();
  let last = null;
  while (performance.now() - started < timeout) {
    last = await evaluate(cdp, `(() => {
      const operator = window.__kaminosSelectiveHeadLive || null;
      const wrapper = operator?.debugState?.() || null;
      const basinWindow = document.querySelector('#basin')?.contentWindow || window;
      const state = (window.__kaminosVolumePrototype || document.querySelector('#basin')?.contentWindow?.__kaminosVolumePrototype)?.debugState?.();
      const receipt = basinWindow?.__kaminosVolumeSettingsPresetReceipt || null;
      return {
        location: location.href,
        wrapperRoute: wrapper?.routeIdentity || null,
        wrapperStatus: wrapper?.status || null,
        wrapperError: wrapper?.error || null,
        requestedRole: wrapper?.requestedRole || null,
        effectiveRole: wrapper?.effectiveRole || null,
        requestedComposition: wrapper?.requestedComposition || null,
        effectiveComposition: wrapper?.effectiveComposition || null,
        active: state?.active === true,
        backend: state?.backend || null,
        error: state?.error || null,
        requestedRoute: state?.requestedRoute || null,
        effectiveRoute: state?.effectiveRoute || null,
        prototypeIdentity: state?.prototypeIdentity || null,
        sourceSettingsPreset: wrapper?.sourceSettingsPresetId ? {
          presetId: wrapper.sourceSettingsPresetId,
          sourcePresetAuthority: wrapper.sourceSettingsPresetAuthority,
          controlCount: wrapper.sourceSettingsPresetControlCount,
          schemaIdentity: wrapper.sourceSettingsPresetSchemaIdentity,
          storePath: wrapper.sourceSettingsPresetStorePath,
        } : (receipt ? {
          presetId: receipt.presetId,
          sourcePresetAuthority: receipt.sourcePresetAuthority,
          controlCount: Object.keys(receipt.preset?.domControls || {}).length,
          schemaIdentity: receipt.schemaIdentity,
          storePath: receipt.storePath,
        } : null),
      };
    })()`);
    const browserEvents = cdp.browserEvents.map(summarizeBrowserEvent);
    lastTrustworthyEvidence = { routeProbe: last, browserEvents };
    const exception = browserEvents.find(event => event.method === 'Runtime.exceptionThrown');
    if (exception) throw new Error(`browser runtime exception: ${JSON.stringify(exception)}`);
    const consoleError = browserEvents.find(event => event.method === 'Runtime.consoleAPICalled' && event.type === 'error');
    if (consoleError) throw new Error(`browser console error: ${JSON.stringify(consoleError)}`);
    if (last?.wrapperStatus === 'failed') throw new Error(`operator wrapper admission failed: ${last.wrapperError || 'missing-wrapper-error'}`);
    if (last?.active
      && last?.sourceSettingsPreset
      && last?.effectiveRole === 'truthHigh'
      && last?.effectiveComposition === 'raymarch-only-v0'
      && last?.wrapperStatus === 'running') return last;
    if (last?.error) throw new Error(`renderer route failed: ${last.error}`);
    await delay(250);
  }
  throw new Error(`timed out waiting for admitted volume runtime: ${JSON.stringify(last)}`);
}

function summarizeBrowserEvent(event) {
  if (event.method === 'Runtime.exceptionThrown') {
    const details = event.params?.exceptionDetails || {};
    return {
      method: event.method,
      text: details.exception?.description || details.text || null,
      url: details.url || null,
      lineNumber: details.lineNumber ?? null,
      columnNumber: details.columnNumber ?? null,
    };
  }
  if (event.method === 'Log.entryAdded') {
    return {
      method: event.method,
      level: event.params?.entry?.level || null,
      text: event.params?.entry?.text || null,
      url: event.params?.entry?.url || null,
    };
  }
  return {
    method: event.method,
    type: event.params?.type || null,
    args: (event.params?.args || []).map(argument => argument.value ?? argument.description ?? null),
  };
}

async function evaluate(cdp, expression) {
  const result = await cdp.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'browser evaluation failed');
  }
  return result.result?.value;
}
