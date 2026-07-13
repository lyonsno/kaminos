#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA,
  computeBoundarySplatPhaseProof,
  writeBoundarySplatPhaseProofPreview,
} from './boundary-splat-phase-proof.mjs';
import { alignBoundarySplatRowsByWorldPosition } from './boundary-splat-phase-render-witness.mjs';

const SCHEMA = 'kaminos.boundary-splat-phase-corpus-witness.v0';
const FEATURE_ORDER = [
  'sidecar.support',
  'sidecar.coverage',
  'sidecar.ridge',
  'sidecar.footprint',
  'material.density',
  'material.heat',
  'material.fuel',
  'material.detail',
  'fire.energy',
  'fire.temperature',
  'fire.emission',
  'fire.detail',
  'micro.x',
  'micro.y',
  'micro.z',
  'micro.w',
];

const args = parseArgs(process.argv.slice(2));
const captureReplay = args.has('--capture') ? readVolumeCaptureReplay(args.get('--capture')) : null;
const inputUrl = String(captureReplay?.route || args.get('--url') || '');
const outDir = resolve(String(args.get('--out-dir') || '/tmp/kaminos-boundary-splat-phase-corpus'));
const reportPath = resolve(String(args.get('--report') || `${outDir}/phase-corpus-witness-report.json`));
const manifestPath = resolve(String(args.get('--manifest') || `${outDir}/phase-corpus.json`));
const proofPath = resolve(String(args.get('--proof') || `${outDir}/phase-proof.json`));
const previewPath = resolve(String(args.get('--preview') || `${outDir}/phase-preview.png`));
const previewReportPath = resolve(String(args.get('--preview-report') || `${outDir}/phase-preview.json`));
const frames = Math.max(13, Math.floor(Number(args.get('--frames') || 13)));
const stepMs = Math.max(1, Number(args.get('--step-ms') || 180));
const liveSampleIntervalMs = Math.max(0, Number(args.get('--live-sample-interval-ms') || 0));
const featureChunkChars = Math.max(4, Math.floor(Number(args.get('--feature-chunk-chars') || 262144) / 4) * 4);
const settleMs = Math.max(0, Number(args.get('--settle-ms') || 2500));
const port = Math.max(1, Math.floor(Number(args.get('--chrome-port') || 19437)));
const chrome = String(args.get('--chrome') || process.env.CHROME || defaultChromePath());
const windowSize = String(args.get('--window-size') || '1280,960');
const userDataDir = resolve(String(args.get('--user-data-dir') || mkdtempSync(`${tmpdir()}/kaminos-phase-corpus-chrome-`)));
const keepBrowserOpen = args.has('--keep-browser-open');
const requestedOffsets = String(args.get('--offsets') || '-6,-3,-1,1,3,6')
  .split(',')
  .map(value => Number(value.trim()))
  .filter(value => Number.isInteger(value) && value !== 0);

let browser = null;
let ws = null;
let failurePhase = 'startup';
const lastTrustworthyEvidence = {};

try {
  if (!inputUrl) throw new Error('missing --url');
  mkdirSync(outDir, { recursive: true });
  const requestedRoute = phaseUrl(inputUrl);
  browser = await launchBrowser('about:blank');
  failurePhase = 'cdp-connect';
  await waitForCdp();
  const page = await findPage();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Runtime.enable');
  await wsRequest('Page.enable');
  failurePhase = 'splat-buffer-interceptor-install';
  lastTrustworthyEvidence.splatBufferInterceptor = await installBoundarySplatBufferInterceptor(requestedRoute);
  await waitForPrototype();
  let replayedCaptureControls = null;
  let replayedCaptureCamera = null;
  if (captureReplay) {
    failurePhase = 'capture-replay';
    replayedCaptureControls = await replayCaptureControls(captureReplay.capture);
    replayedCaptureCamera = await replayCaptureCamera(captureReplay.capture);
    await forcePhaseFeatureCapture();
    lastTrustworthyEvidence.captureReplay = {
      path: captureReplay.path,
      documentIdentity: captureReplay.documentIdentity,
      controlsApplied: replayedCaptureControls?.applied ?? null,
      controlsSkipped: replayedCaptureControls?.skipped ?? null,
      cameraApplied: replayedCaptureCamera?.applied ?? null,
    };
  }
  await delay(settleMs);
  const initialState = await debugState();
  lastTrustworthyEvidence.initialState = compactState(initialState);

  failurePhase = 'controlled-step-feature-capture';
  const capturedFrames = liveSampleIntervalMs > 0
    ? await captureLiveSampleFeatureFrames(requestedRoute)
    : await captureFeatureFrames(requestedRoute);
  failurePhase = 'manifest-build';
  const temporalAlignment = buildTemporalAlignment(capturedFrames);
  const manifest = {
    schema: BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA,
    authority: liveSampleIntervalMs > 0
      ? 'live-running-sample-sequence-v0'
      : 'live-simulator-controlled-step-selected-candidate-features-v0',
    requestedRoute,
    effectiveRoute: capturedFrames[0]?.effectiveRoute || initialState?.effectiveRoute || null,
    captureReplay: captureReplay ? {
      path: captureReplay.path,
      documentIdentity: captureReplay.documentIdentity,
      captureId: captureReplay.captureId,
      kind: captureReplay.capture?.kind || null,
      route: captureReplay.route,
      controls: replayedCaptureControls,
      camera: replayedCaptureCamera,
      featureCaptureOverride: 'volume_boundary_splat_feature_capture forced on for phase corpus witness after saved control replay',
    } : null,
    featureOrder: FEATURE_ORDER,
    frames: capturedFrames,
    temporalAlignment,
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const manifestBytes = readFileSync(manifestPath);
  failurePhase = 'phase-proof';
  const proof = await computeBoundarySplatPhaseProof(manifestPath, { holdoutModulo: 5 });
  writeFileSync(proofPath, JSON.stringify(proof, null, 2));
  const preview = await writeBoundarySplatPhaseProofPreview(manifestPath, {
    out: previewPath,
    report: previewReportPath,
    holdoutModulo: 5,
  });
  const report = {
    schema: SCHEMA,
    status: 'completed',
    requestedRoute,
    effectiveRoute: manifest.effectiveRoute,
    captureReplay: manifest.captureReplay,
    browser: {
      identity: 'boundary-splat-phase-corpus-single-cdp-browser-v0',
      port,
      userDataDir,
      keepBrowserOpen,
      windowSize,
      pageUrl: page.url,
    },
    frameCount: capturedFrames.length,
    stepMs,
    liveSampleIntervalMs,
    manifest: { path: manifestPath, sha256: sha256(manifestBytes) },
    proof: {
      path: proofPath,
      beatsIdentity: proof.advantage.beatsIdentity,
      identityMse: proof.identityBaseline.mse,
      modelMse: proof.phaseConditionedModel.mse,
      modelToIdentityRatio: proof.advantage.modelToIdentityRatio,
    },
    preview: {
      path: previewPath,
      reportPath: previewReportPath,
      authority: preview.preview.authority,
      sha256: preview.preview.sha256,
      bytes: preview.preview.bytes,
      width: preview.preview.width,
      height: preview.preview.height,
    },
    temporalAlignment,
  };
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const failure = {
    schema: SCHEMA,
    status: 'failed',
    failurePhase,
    error: error?.stack || error?.message || String(error),
    inputUrl,
    captureReplay: captureReplay ? {
      path: captureReplay.path,
      documentIdentity: captureReplay.documentIdentity,
      captureId: captureReplay.captureId,
      kind: captureReplay.capture?.kind || null,
      route: captureReplay.route,
    } : null,
    browser: browser ? { port, userDataDir, keepBrowserOpen, windowSize } : null,
    lastTrustworthyEvidence,
  };
  mkdirSync(outDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(failure, null, 2));
  console.error(JSON.stringify(failure, null, 2));
  process.exitCode = 1;
} finally {
  try { ws?.close?.(); } catch {}
  if (!keepBrowserOpen) browser?.process?.kill('SIGTERM');
}

function parseArgs(argv) {
  const map = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) map.set(item, '1');
    else {
      map.set(item, next);
      index += 1;
    }
  }
  return map;
}

function readVolumeCaptureReplay(capturePath) {
  if (!capturePath || capturePath === '1') throw new Error('--capture requires a saved capture path');
  const resolved = resolve(String(capturePath));
  const document = JSON.parse(readFileSync(resolved, 'utf8'));
  const capture = document.capture || document;
  const route = capture.route || capture.href || document.route;
  if (!route) throw new Error(`Volume capture ${resolved} has no replay route`);
  return {
    path: resolved,
    documentIdentity: document.identity || null,
    captureId: document.captureId || capture.captureId || null,
    capture,
    route,
  };
}

function phaseUrl(value) {
  const url = new URL(value);
  url.searchParams.set('kaminos_volume_smoke', '1');
  url.searchParams.set('volume_boundary_splat_mode', 'learned');
  url.searchParams.set('volume_boundary_splat_feature_capture', '1');
  return url.toString();
}

async function replayCaptureControls(capture = {}) {
  const controls = capture.domControls || {};
  if (!controls || Object.keys(controls).length === 0) {
    return {
      identity: 'kaminos-volume-capture-control-replay-v0',
      total: 0,
      applied: 0,
      skipped: 0,
      reason: 'no-dom-controls',
    };
  }
  const result = await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const controls = ${JSON.stringify(controls)};
      const results = [];
      const idForKey = (key) => 'volume-' + String(key).replace(/[A-Z]/g, (match) => '-' + match.toLowerCase());
      const valueFor = (entry) => entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value') ? entry.value : entry;
      for (const [key, entry] of Object.entries(controls)) {
        const id = entry && typeof entry === 'object' && entry.id ? entry.id : idForKey(key);
        const el = document.getElementById(id);
        if (!el) {
          results.push({ key, id, applied: false, reason: 'missing-element' });
          continue;
        }
        const value = valueFor(entry);
        if (el.type === 'checkbox') el.checked = Boolean(value);
        else el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        results.push({ key, id, applied: true, value });
      }
      if (typeof readVolumeControls === 'function') {
        window.__kaminosVolumePrototype?.setControls?.(readVolumeControls());
      }
      return {
        identity: 'kaminos-volume-capture-control-replay-v0',
        total: results.length,
        applied: results.filter((item) => item.applied).length,
        skipped: results.filter((item) => !item.applied).length,
        results,
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function replayCaptureCamera(capture = {}) {
  const camera = capture.camera || null;
  if (!camera) {
    return {
      identity: 'kaminos-volume-capture-camera-replay-v0',
      applied: false,
      reason: 'no-camera',
    };
  }
  const result = await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const camera = ${JSON.stringify(camera)};
      if (typeof window.kaminosSetCameraDebugPose !== 'function') {
        return {
          identity: 'kaminos-volume-capture-camera-replay-v0',
          applied: false,
          reason: 'missing-kaminosSetCameraDebugPose',
          camera,
        };
      }
      return {
        identity: 'kaminos-volume-capture-camera-replay-v0',
        applied: true,
        camera,
        result: window.kaminosSetCameraDebugPose(camera),
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function forcePhaseFeatureCapture() {
  const result = await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const checkbox = document.getElementById('volume-boundary-splat-feature-capture');
      if (checkbox) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('input', { bubbles: true }));
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const mode = document.getElementById('volume-boundary-splat-mode');
      if (mode) {
        mode.value = 'learned';
        mode.dispatchEvent(new Event('input', { bubbles: true }));
        mode.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (typeof readVolumeControls === 'function') {
        window.__kaminosVolumePrototype?.setControls?.(readVolumeControls());
      }
      const state = window.__kaminosVolumePrototype?.debugState?.();
      return {
        identity: 'phase-corpus-feature-capture-replay-override-v0',
        featureCaptureElementFound: Boolean(checkbox),
        learnedModeElementFound: Boolean(mode),
        boundarySplatFeatureCaptureRequested: state?.boundarySplatFeatureCaptureRequested ?? null,
        boundarySplatFeatureCaptureEffective: state?.boundarySplatFeatureCaptureEffective ?? null,
        boundarySplatMode: state?.boundarySplatMode ?? null,
      };
    })()`,
    returnByValue: true,
  });
  lastTrustworthyEvidence.featureCaptureOverride = result.result.value;
  return result.result.value;
}

function defaultChromePath() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'google-chrome',
  ];
  return candidates.find(candidate => candidate.includes('/') ? existsSync(candidate) : true) || candidates[0];
}

async function launchBrowser(url) {
  const proc = spawn(chrome, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    `--window-size=${windowSize}`,
    url,
  ], { stdio: 'ignore', detached: keepBrowserOpen });
  if (keepBrowserOpen) proc.unref();
  return { process: proc };
}

function boundarySplatBufferInterceptorSource() {
  return `(() => {
    const CAPTURE_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
    const state = {
      device: null,
      splatBuffer: null,
      splatDescriptor: null,
      cameraBuffer: null,
      cameraDescriptor: null,
      cameraValues: null,
      drawBuffer: null,
      featureBuffer: null,
      pendingSameEncoderCaptures: [],
      createdBufferCount: 0,
      bufferDescriptors: new WeakMap(),
      encoderDescriptors: new WeakMap(),
    };
    const originalCreateBuffer = globalThis.GPUDevice?.prototype?.createBuffer;
    if (!originalCreateBuffer) {
      window.__kaminosBoundarySplatInterceptor = {
        installed: false,
        reason: 'GPUDevice.prototype.createBuffer unavailable',
      };
      return;
    }
    if (!originalCreateBuffer.__kaminosBoundarySplatInterceptorOriginal) {
      const interceptedCreateBuffer = function(descriptor) {
        const buffer = originalCreateBuffer.call(this, descriptor);
        const label = String(descriptor?.label || '');
        state.createdBufferCount += 1;
        state.bufferDescriptors.set(buffer, { label, size: Number(descriptor?.size || 0) });
        if (label.includes('live-boundary-sidecar-analytic-splats-v0 candidates')) {
          state.device = this;
          state.splatBuffer = buffer;
          state.splatDescriptor = { label, size: Number(descriptor.size) };
        }
        if (label.includes('live-boundary-sidecar-analytic-splats-v0 camera')) {
          state.device = this;
          state.cameraBuffer = buffer;
          state.cameraDescriptor = { label, size: Number(descriptor.size) };
        }
        return buffer;
      };
      Object.defineProperty(interceptedCreateBuffer, '__kaminosBoundarySplatInterceptorOriginal', {
        value: originalCreateBuffer,
      });
      globalThis.GPUDevice.prototype.createBuffer = interceptedCreateBuffer;
    }
    const originalCreateBindGroup = globalThis.GPUDevice?.prototype?.createBindGroup;
    if (originalCreateBindGroup && !originalCreateBindGroup.__kaminosBoundarySplatInterceptorOriginal) {
      const interceptedCreateBindGroup = function(descriptor) {
        const bindGroup = originalCreateBindGroup.call(this, descriptor);
        const label = String(descriptor?.label || '');
        if (label.includes('live-boundary-sidecar-analytic-splats-v0 compute bind group')) {
          const splatEntry = descriptor.entries?.find(entry => entry.binding === 2);
          const drawEntry = descriptor.entries?.find(entry => entry.binding === 3);
          const cameraEntry = descriptor.entries?.find(entry => entry.binding === 4);
          const featureEntry = descriptor.entries?.find(entry => entry.binding === 6);
          if (splatEntry?.resource?.buffer) {
            state.device = this;
            state.splatBuffer = splatEntry.resource.buffer;
            state.splatDescriptor = state.bufferDescriptors.get(state.splatBuffer) || { label: 'compute-bind-group-binding-2', size: 0 };
          }
          if (drawEntry?.resource?.buffer) state.drawBuffer = drawEntry.resource.buffer;
          if (cameraEntry?.resource?.buffer) {
            state.cameraBuffer = cameraEntry.resource.buffer;
            state.cameraDescriptor = state.bufferDescriptors.get(state.cameraBuffer) || { label: 'compute-bind-group-binding-4', size: 112 };
          }
          if (featureEntry?.resource?.buffer) state.featureBuffer = featureEntry.resource.buffer;
        }
        if (label.includes('live-boundary-sidecar-analytic-splats-v0 render bind group')) {
          const splatEntry = descriptor.entries?.find(entry => entry.binding === 5);
          const cameraEntry = descriptor.entries?.find(entry => entry.binding === 4);
          if (splatEntry?.resource?.buffer) {
            state.device = this;
            state.splatBuffer = splatEntry.resource.buffer;
            state.splatDescriptor = state.bufferDescriptors.get(state.splatBuffer) || { label: 'render-bind-group-binding-5', size: 0 };
          }
          if (cameraEntry?.resource?.buffer) {
            state.device = this;
            state.cameraBuffer = cameraEntry.resource.buffer;
            state.cameraDescriptor = state.bufferDescriptors.get(state.cameraBuffer) || { label: 'render-bind-group-binding-4', size: 112 };
          }
        }
        return bindGroup;
      };
      Object.defineProperty(interceptedCreateBindGroup, '__kaminosBoundarySplatInterceptorOriginal', {
        value: originalCreateBindGroup,
      });
      globalThis.GPUDevice.prototype.createBindGroup = interceptedCreateBindGroup;
    }
    const originalCreateCommandEncoder = globalThis.GPUDevice?.prototype?.createCommandEncoder;
    if (originalCreateCommandEncoder && !originalCreateCommandEncoder.__kaminosBoundarySplatInterceptorOriginal) {
      const interceptedCreateCommandEncoder = function(descriptor = {}) {
        const encoder = originalCreateCommandEncoder.call(this, descriptor);
        state.encoderDescriptors.set(encoder, { label: String(descriptor?.label || '') });
        return encoder;
      };
      Object.defineProperty(interceptedCreateCommandEncoder, '__kaminosBoundarySplatInterceptorOriginal', {
        value: originalCreateCommandEncoder,
      });
      globalThis.GPUDevice.prototype.createCommandEncoder = interceptedCreateCommandEncoder;
    }
    const originalWriteBuffer = globalThis.GPUQueue?.prototype?.writeBuffer;
    if (originalWriteBuffer && !originalWriteBuffer.__kaminosBoundarySplatInterceptorOriginal) {
      const interceptedWriteBuffer = function(buffer, bufferOffset, data, dataOffset = 0, size) {
        const result = originalWriteBuffer.call(this, buffer, bufferOffset, data, dataOffset, size);
        if (buffer === state.cameraBuffer && Number(bufferOffset) === 0) {
          const sourceBytes = ArrayBuffer.isView(data)
            ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
            : new Uint8Array(data);
          const start = Math.max(0, Number(dataOffset) || 0);
          const byteLength = size == null ? sourceBytes.byteLength - start : Number(size);
          const copied = sourceBytes.slice(start, start + byteLength);
          if (copied.byteLength >= 112) {
            state.cameraValues = Array.from(new Float32Array(copied.buffer, copied.byteOffset, 28));
          }
        }
        return result;
      };
      Object.defineProperty(interceptedWriteBuffer, '__kaminosBoundarySplatInterceptorOriginal', {
        value: originalWriteBuffer,
      });
      globalThis.GPUQueue.prototype.writeBuffer = interceptedWriteBuffer;
    }
    const originalCopyBufferToBuffer = globalThis.GPUCommandEncoder?.prototype?.copyBufferToBuffer;
    if (originalCopyBufferToBuffer && !originalCopyBufferToBuffer.__kaminosBoundarySplatInterceptorOriginal) {
      const interceptedCopyBufferToBuffer = function(source, sourceOffset, destination, destinationOffset, size) {
        const result = originalCopyBufferToBuffer.call(this, source, sourceOffset, destination, destinationOffset, size);
        const encoderLabel = state.encoderDescriptors.get(this)?.label || '';
        if (
          source === state.featureBuffer
          && state.splatBuffer
          && state.drawBuffer
          && state.cameraValues
          && encoderLabel.includes('boundary-splat-selected-candidate-features-v0 witness encoder')
        ) {
          const featureBytes = Number(size);
          const rowCount = featureBytes / (16 * 4);
          if (Number.isInteger(rowCount) && rowCount > 0) {
            const splatBytes = rowCount * 12 * 4;
            const splatReadback = state.device.createBuffer({
              label: 'kaminos phase witness same-encoder splat readback',
              size: splatBytes,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            const drawReadback = state.device.createBuffer({
              label: 'kaminos phase witness same-encoder draw-state readback',
              size: 32,
              usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            originalCopyBufferToBuffer.call(this, state.splatBuffer, 0, splatReadback, 0, splatBytes);
            originalCopyBufferToBuffer.call(this, state.drawBuffer, 0, drawReadback, 0, 32);
            state.pendingSameEncoderCaptures.push({
              authority: 'same-encoder-feature-splat-count-v0',
              rowCount,
              splatBytes,
              splatReadback,
              drawReadback,
              cameraValues: state.cameraValues.slice(),
            });
          }
        }
        return result;
      };
      Object.defineProperty(interceptedCopyBufferToBuffer, '__kaminosBoundarySplatInterceptorOriginal', {
        value: originalCopyBufferToBuffer,
      });
      globalThis.GPUCommandEncoder.prototype.copyBufferToBuffer = interceptedCopyBufferToBuffer;
    }
    const bytesToBase64 = (bytes) => {
      const chunks = [];
      for (let start = 0; start < bytes.length; start += 0x8000) {
        chunks.push(String.fromCharCode(...bytes.subarray(start, Math.min(start + 0x8000, bytes.length))));
      }
      return btoa(chunks.join(''));
    };
    window.__kaminosBoundarySplatInterceptor = {
      installed: true,
      authority: CAPTURE_AUTHORITY,
      status() {
        return {
          installed: true,
          authority: CAPTURE_AUTHORITY,
          createdBufferCount: state.createdBufferCount,
          splatDescriptor: state.splatDescriptor,
          cameraDescriptor: state.cameraDescriptor,
          sameEncoderCaptureCount: state.pendingSameEncoderCaptures.length,
        };
      },
      async capture(token, instanceCount) {
        if (!state.device || !state.splatBuffer || !state.cameraBuffer || !state.cameraValues || !state.drawBuffer || !state.featureBuffer) {
          throw new Error('boundary splat interceptor has not observed splat, feature, draw, and camera state');
        }
        if (!Number.isInteger(instanceCount) || instanceCount <= 0) {
          throw new Error('boundary splat interceptor requires a positive instance count');
        }
        const pending = state.pendingSameEncoderCaptures.pop();
        if (!pending) throw new Error('boundary splat interceptor has no same-encoder feature/splat capture');
        while (state.pendingSameEncoderCaptures.length) {
          const stale = state.pendingSameEncoderCaptures.shift();
          stale.splatReadback.destroy();
          stale.drawReadback.destroy();
        }
        const splatBytes = pending.splatBytes;
        if (splatBytes > Number(state.splatDescriptor?.size || 0)) {
          throw new Error('boundary splat capture exceeds intercepted candidate buffer');
        }
        let validationScopeOpen = false;
        try {
          state.device.pushErrorScope('validation');
          validationScopeOpen = true;
          await Promise.all([
            pending.splatReadback.mapAsync(GPUMapMode.READ),
            pending.drawReadback.mapAsync(GPUMapMode.READ),
          ]);
          const validationError = await state.device.popErrorScope();
          validationScopeOpen = false;
          if (validationError) throw new Error('intercepted boundary splat copy validation failed: ' + validationError.message);
          const drawState = new Uint32Array(pending.drawReadback.getMappedRange());
          const capturedInstanceCount = drawState[1];
          if (capturedInstanceCount !== pending.rowCount || capturedInstanceCount !== instanceCount) {
            throw new Error('same-encoder splat count mismatch: expected ' + instanceCount + ', features ' + pending.rowCount + ', draw ' + capturedInstanceCount);
          }
          const splatPayload = new Uint8Array(pending.splatReadback.getMappedRange()).slice();
          const cameraValues = pending.cameraValues;
          pending.splatReadback.unmap();
          pending.drawReadback.unmap();
          window.__kaminosPhaseSplatCaptureStore = window.__kaminosPhaseSplatCaptureStore || {};
          window.__kaminosPhaseSplatCaptureStore[token] = {
            packedFloat32Base64: bytesToBase64(splatPayload),
            meta: {
              status: 'captured',
              authority: CAPTURE_AUTHORITY,
              alignmentAuthority: pending.authority,
              rowCount: capturedInstanceCount,
              strideFloats: 12,
              packedEncoding: 'float32-le-base64',
              camera: {
                viewProjection: cameraValues.slice(0, 16),
                right: cameraValues.slice(16, 19),
                up: cameraValues.slice(20, 23),
                controls: cameraValues.slice(24, 28),
              },
              splatDescriptor: state.splatDescriptor,
              cameraDescriptor: state.cameraDescriptor,
            },
          };
          return window.__kaminosPhaseSplatCaptureStore[token].meta;
        } finally {
          if (validationScopeOpen) {
            try { await state.device.popErrorScope(); } catch {}
          }
          pending.splatReadback.destroy();
          pending.drawReadback.destroy();
        }
      },
    };
  })();`;
}

async function installBoundarySplatBufferInterceptor(requestedRoute) {
  const script = await wsRequest('Page.addScriptToEvaluateOnNewDocument', {
    source: boundarySplatBufferInterceptorSource(),
  });
  await wsRequest('Page.navigate', { url: requestedRoute });
  return {
    identity: 'boundary-splat-buffer-pre-navigation-interceptor-v0',
    scriptIdentifier: script.identifier || null,
    requestedRoute,
  };
}

async function cdpFetch(path) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with ${response.status}`);
  return response.json();
}

async function waitForCdp() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { return await cdpFetch('/json/version'); } catch { await delay(100); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}

async function findPage() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const pages = await cdpFetch('/json/list');
    const page = pages.find(target => target.type === 'page' && target.url.includes('kaminos_volume_smoke=1'))
      || pages.find(target => target.type === 'page');
    if (page?.webSocketDebuggerUrl) return page;
    await delay(125);
  }
  throw new Error('could not find CDP page target');
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true });
    socket.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

function wsRequest(method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  return new Promise((resolveReq, rejectReq) => {
    const cleanup = () => {
      ws.removeEventListener('message', onMessage);
      ws.removeEventListener('close', onClose);
      ws.removeEventListener('error', onError);
    };
    const onMessage = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      cleanup();
      if (message.error) rejectReq(new Error(`${method}: ${message.error.message}`));
      else if (message.result?.exceptionDetails) {
        const details = message.result.exceptionDetails;
        rejectReq(new Error(`${method}: ${details.exception?.description || details.text || 'browser-side exception'}`));
      }
      else resolveReq(message.result);
    };
    const onClose = () => {
      cleanup();
      rejectReq(new Error(`${method}: WebSocket closed before CDP response ${id}`));
    };
    const onError = () => {
      cleanup();
      rejectReq(new Error(`${method}: WebSocket error before CDP response ${id}`));
    };
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', onClose, { once: true });
    ws.addEventListener('error', onError, { once: true });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForPrototype() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const result = await wsRequest('Runtime.evaluate', {
      expression: `(() => {
        const proto = window.__kaminosVolumePrototype;
        if (!proto?.debugState || !proto?.controlledStepFrame) return null;
        return proto.debugState();
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    const state = result.result.value;
    if (state?.active && state?.backend) return state;
    await delay(150);
  }
  throw new Error('volume prototype did not become active');
}

async function debugState() {
  const result = await wsRequest('Runtime.evaluate', {
    expression: 'window.__kaminosVolumePrototype?.debugState?.()',
    returnByValue: true,
    awaitPromise: true,
  });
  return result.result.value || null;
}

function materializeFeatureCapture(capture, outputPath) {
  if (!capture || capture.status !== 'captured') throw new Error(`feature capture status was ${capture?.status || 'missing'}`);
  if (capture.packedEncoding !== 'float32-le-base64' || typeof capture.packedFloat32Base64 !== 'string') {
    throw new Error('feature capture omitted packed float32 payload');
  }
  const bytes = Buffer.from(capture.packedFloat32Base64, 'base64');
  const expectedBytes = Number(capture.rowCount) * Number(capture.strideFloats) * Float32Array.BYTES_PER_ELEMENT;
  if (capture.strideFloats !== 16 || bytes.byteLength !== expectedBytes) {
    throw new Error(`feature capture byte length ${bytes.byteLength} did not equal expected ${expectedBytes}`);
  }
  writeFileSync(outputPath, bytes);
  return {
    path: outputPath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    count: Number(capture.rowCount),
    strideFloats: Number(capture.strideFloats),
    dtype: 'float32-le',
  };
}

async function captureBrowserSideFeatureFrame(options) {
  const result = await wsRequest('Runtime.evaluate', {
    expression: `(async () => {
      const options = ${JSON.stringify(options)};
      const proto = window.__kaminosVolumePrototype;
      if (!proto?.controlledStepFrame) throw new Error('missing controlledStepFrame');
      const frame = await proto.controlledStepFrame(options);
      const sample = frame?.scaleSet?.samples?.[0] || null;
      const capture = sample?.boundarySplatFeatureCapture || null;
      const token = 'phase-feature-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
      window.__kaminosPhaseFeatureCaptureStore = window.__kaminosPhaseFeatureCaptureStore || {};
      window.__kaminosPhaseFeatureCaptureStore[token] = {
        createdAt: Date.now(),
        packedFloat32Base64: capture?.packedFloat32Base64 || '',
        meta: {
          status: capture?.status || 'missing',
          packedEncoding: capture?.packedEncoding || null,
          rowCount: capture?.rowCount ?? null,
          strideFloats: capture?.strideFloats ?? null,
        },
      };
      const splatCapture = await window.__kaminosBoundarySplatInterceptor?.capture?.(
        token,
        Number(sample?.boundarySplatInstanceCount || 0),
      );
      if (!splatCapture || splatCapture.status !== 'captured') {
        throw new Error('intercepted boundary splat capture did not complete');
      }
      return {
        token,
        frame: {
          ok: frame?.ok ?? false,
          sequenceAuthority: frame?.sequenceAuthority ?? null,
          sameBrowserSessionId: frame?.sameBrowserSessionId ?? null,
          sequenceStartNowMs: frame?.sequenceStartNowMs ?? null,
          controlledStepDeltaMs: frame?.controlledStepDeltaMs ?? null,
          controlledStepNowMs: frame?.controlledStepNowMs ?? null,
        },
        sample: sample ? {
          ok: sample.ok ?? false,
          sameStateCaptureId: sample.sameStateCaptureId ?? null,
          simStepCount: sample.simStepCount ?? null,
          frameCount: sample.frameCount ?? null,
          effectiveRoute: sample.effectiveRoute ?? null,
          boundarySplatRendererIdentity: sample.boundarySplatRendererIdentity ?? null,
          boundarySplatAttributeModelIdentity: sample.boundarySplatAttributeModelIdentity ?? null,
          boundarySplatSourceAuthority: sample.boundarySplatSourceAuthority ?? null,
          boundarySplatFallbackReason: sample.boundarySplatFallbackReason ?? null,
          boundarySplatCandidateCount: sample.boundarySplatCandidateCount ?? null,
          boundarySplatInstanceCount: sample.boundarySplatInstanceCount ?? null,
          boundarySplatOverflowCount: sample.boundarySplatOverflowCount ?? null,
          boundarySplatCountAuthority: sample.boundarySplatCountAuthority ?? null,
        } : null,
        capture: window.__kaminosPhaseFeatureCaptureStore[token].meta,
        splatCapture,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  return result.result.value;
}

async function materializeBrowserSideFeatureCapture(token, outputPath) {
  const metaResult = await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const entry = window.__kaminosPhaseFeatureCaptureStore?.[${JSON.stringify(token)}];
      if (!entry) return { status: 'missing-store-entry' };
      return {
        ...entry.meta,
        base64Chars: entry.packedFloat32Base64.length,
      };
    })()`,
    returnByValue: true,
  });
  const capture = metaResult.result.value;
  if (!capture || capture.status !== 'captured') throw new Error(`feature capture status was ${capture?.status || 'missing'}`);
  if (capture.packedEncoding !== 'float32-le-base64') throw new Error('feature capture omitted packed float32 payload');
  const expectedBytes = Number(capture.rowCount) * Number(capture.strideFloats) * Float32Array.BYTES_PER_ELEMENT;
  if (capture.strideFloats !== 16 || !Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    throw new Error(`feature capture metadata was invalid: ${JSON.stringify(capture)}`);
  }

  const chunks = [];
  for (let start = 0; start < Number(capture.base64Chars); start += featureChunkChars) {
    const end = Math.min(start + featureChunkChars, Number(capture.base64Chars));
    const chunkResult = await wsRequest('Runtime.evaluate', {
      expression: `(() => {
        const entry = window.__kaminosPhaseFeatureCaptureStore?.[${JSON.stringify(token)}];
        if (!entry) throw new Error('missing staged feature capture ${token}');
        return entry.packedFloat32Base64.slice(${start}, ${end});
      })()`,
      returnByValue: true,
    });
    chunks.push(Buffer.from(chunkResult.result.value || '', 'base64'));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`feature capture byte length ${bytes.byteLength} did not equal expected ${expectedBytes}`);
  }
  writeFileSync(outputPath, bytes);
  return {
    path: outputPath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    count: Number(capture.rowCount),
    strideFloats: Number(capture.strideFloats),
    dtype: 'float32-le',
    transport: {
      identity: 'browser-side-feature-capture-chunked-cdp-v0',
      chunkChars: featureChunkChars,
      chunkCount: chunks.length,
      base64Chars: Number(capture.base64Chars),
    },
  };
}

async function materializeBrowserSideSplatCapture(token, outputPath) {
  const metaResult = await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const entry = window.__kaminosPhaseSplatCaptureStore?.[${JSON.stringify(token)}];
      if (!entry) return { status: 'missing-store-entry' };
      return {
        ...entry.meta,
        base64Chars: entry.packedFloat32Base64.length,
      };
    })()`,
    returnByValue: true,
  });
  const capture = metaResult.result.value;
  if (!capture || capture.status !== 'captured') throw new Error(`splat capture status was ${capture?.status || 'missing'}`);
  if (capture.authority !== 'intercepted-live-boundary-splat-buffer-post-compaction-v0') throw new Error('splat capture authority mismatch');
  if (capture.packedEncoding !== 'float32-le-base64') throw new Error('splat capture omitted packed float32 payload');
  const expectedBytes = Number(capture.rowCount) * Number(capture.strideFloats) * Float32Array.BYTES_PER_ELEMENT;
  if (capture.strideFloats !== 12 || !Number.isFinite(expectedBytes) || expectedBytes <= 0) {
    throw new Error(`splat capture metadata was invalid: ${JSON.stringify(capture)}`);
  }
  const chunks = [];
  for (let start = 0; start < Number(capture.base64Chars); start += featureChunkChars) {
    const end = Math.min(start + featureChunkChars, Number(capture.base64Chars));
    const chunkResult = await wsRequest('Runtime.evaluate', {
      expression: `(() => {
        const entry = window.__kaminosPhaseSplatCaptureStore?.[${JSON.stringify(token)}];
        if (!entry) throw new Error('missing staged splat capture ${token}');
        return entry.packedFloat32Base64.slice(${start}, ${end});
      })()`,
      returnByValue: true,
    });
    chunks.push(Buffer.from(chunkResult.result.value || '', 'base64'));
  }
  const bytes = Buffer.concat(chunks);
  if (bytes.byteLength !== expectedBytes) {
    throw new Error(`splat capture byte length ${bytes.byteLength} did not equal expected ${expectedBytes}`);
  }
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  if (!values.some(value => Number.isFinite(value) && value !== 0)) {
    throw new Error(`splat capture payload was all-zero: ${JSON.stringify({
      splatDescriptor: capture.splatDescriptor,
      cameraDescriptor: capture.cameraDescriptor,
    })}`);
  }
  writeFileSync(outputPath, bytes);
  return {
    path: outputPath,
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
    count: Number(capture.rowCount),
    strideFloats: Number(capture.strideFloats),
    dtype: 'float32-le',
    authority: capture.authority,
    camera: capture.camera,
    transport: {
      identity: 'browser-side-splat-capture-chunked-cdp-v0',
      chunkChars: featureChunkChars,
      chunkCount: chunks.length,
      base64Chars: Number(capture.base64Chars),
    },
  };
}

async function clearBrowserSideFeatureCapture(token) {
  if (!token) return { cleared: false, reason: 'missing-token' };
  const result = await wsRequest('Runtime.evaluate', {
    expression: `(() => {
      const store = window.__kaminosPhaseFeatureCaptureStore;
      const existed = Boolean(store?.[${JSON.stringify(token)}]);
      if (store) delete store[${JSON.stringify(token)}];
      const splatStore = window.__kaminosPhaseSplatCaptureStore;
      const splatExisted = Boolean(splatStore?.[${JSON.stringify(token)}]);
      if (splatStore) delete splatStore[${JSON.stringify(token)}];
      return {
        identity: 'browser-side-feature-capture-clear-v0',
        token: ${JSON.stringify(token)},
        cleared: existed,
        splatCleared: splatExisted,
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function captureFeatureFrames(requestedRoute) {
  const captured = [];
  let sameBrowserSessionId = null;
  let sequenceStartNowMs = null;
  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    logProgress({ phase: 'frame-start', frameIndex, frames });
    let staged = null;
    try {
      staged = await captureBrowserSideFeatureFrame({
        controlledStepFrameIndex: frameIndex,
        advanceSim: frameIndex > 0,
        sameBrowserSessionId,
        startNow: sequenceStartNowMs,
        stepDeltaMs: stepMs,
        renderScales: [1],
        includeRgba: false,
        compactSamples: false,
        resumeRenderLoop: false,
      });
      const frame = staged.frame;
      if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
        throw new Error(`controlled-step frame ${frameIndex} failed: ${JSON.stringify(frame)}`);
      }
      sameBrowserSessionId = frame.sameBrowserSessionId;
      sequenceStartNowMs = frame.sequenceStartNowMs;
      const sample = staged.sample;
      if (sample?.ok !== true) throw new Error(`frame ${frameIndex} did not return a valid scale sample`);
      const candidatePath = resolve(outDir, `frame-${String(frameIndex).padStart(3, '0')}.features.f32`);
      const candidates = await materializeBrowserSideFeatureCapture(staged.token, candidatePath);
      const splatPath = resolve(outDir, `frame-${String(frameIndex).padStart(3, '0')}.splats.f32`);
      const splats = await materializeBrowserSideSplatCapture(staged.token, splatPath);
      if (splats.count !== candidates.count) throw new Error(`frame ${frameIndex} feature/splat row count mismatch`);
      const fallbackReason = sample.boundarySplatFallbackReason ?? null;
      captured.push({
        id: `frame-${frameIndex}`,
        sameBrowserSessionId,
        sameStateCaptureId: sample.sameStateCaptureId,
        controlledStepFrameIndex: frameIndex,
        controlledStepDeltaMs: frame.controlledStepDeltaMs,
        controlledStepNowMs: frame.controlledStepNowMs,
        simStepCount: sample.simStepCount,
        requestedRoute,
        effectiveRoute: sample.effectiveRoute,
        rendererIdentity: sample.boundarySplatRendererIdentity,
        modelIdentity: sample.boundarySplatAttributeModelIdentity,
        sourceAuthority: sample.boundarySplatSourceAuthority,
        fallbackReason,
        boundarySplatCandidateCount: sample.boundarySplatCandidateCount,
        boundarySplatInstanceCount: sample.boundarySplatInstanceCount,
        boundarySplatOverflowCount: sample.boundarySplatOverflowCount,
        boundarySplatCountAuthority: sample.boundarySplatCountAuthority,
        candidates,
        camera: splats.camera,
        splats: {
          ...splats,
          camera: undefined,
        },
      });
      lastTrustworthyEvidence[`frame-${frameIndex}`] = {
        rowCount: candidates.count,
        simStepCount: sample.simStepCount,
        rendererIdentity: sample.boundarySplatRendererIdentity,
        fallbackReason,
        transport: candidates.transport,
        splatTransport: splats.transport,
      };
      logProgress({
        phase: 'frame-captured',
        frameIndex,
        frames,
        rowCount: candidates.count,
        bytes: candidates.bytes,
        chunkCount: candidates.transport.chunkCount,
        splatChunkCount: splats.transport.chunkCount,
        simStepCount: sample.simStepCount,
        rendererIdentity: sample.boundarySplatRendererIdentity,
        fallbackReason,
      });
    } finally {
      await clearBrowserSideFeatureCapture(staged?.token);
    }
  }
  return captured;
}

async function captureLiveSampleFeatureFrames(requestedRoute) {
  const captured = [];
  const sameBrowserSessionId = `live-sample-${Date.now().toString(36)}`;
  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    if (frameIndex > 0) await delay(liveSampleIntervalMs);
    logProgress({ phase: 'live-sample-start', frameIndex, frames, liveSampleIntervalMs });
    let staged = null;
    try {
      staged = await captureBrowserSideFeatureFrame({
        advanceSim: false,
        controlledStepFrameIndex: frameIndex,
        renderScales: [1],
        includeRgba: false,
        compactSamples: false,
        resumeRenderLoop: true,
      });
      const frame = staged.frame;
      if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
        throw new Error(`live sample frame ${frameIndex} failed: ${JSON.stringify(frame)}`);
      }
      const sample = staged.sample;
      if (sample?.ok !== true) throw new Error(`live sample frame ${frameIndex} did not return a valid scale sample`);
      const candidatePath = resolve(outDir, `frame-${String(frameIndex).padStart(3, '0')}.features.f32`);
      const candidates = await materializeBrowserSideFeatureCapture(staged.token, candidatePath);
      const splatPath = resolve(outDir, `frame-${String(frameIndex).padStart(3, '0')}.splats.f32`);
      const splats = await materializeBrowserSideSplatCapture(staged.token, splatPath);
      if (splats.count !== candidates.count) throw new Error(`live sample frame ${frameIndex} feature/splat row count mismatch`);
      const fallbackReason = sample.boundarySplatFallbackReason ?? null;
      captured.push({
        id: `frame-${frameIndex}`,
        sequenceAuthority: 'live-running-sample-sequence-v0',
        sameBrowserSessionId,
        sameStateCaptureId: sample.sameStateCaptureId,
        liveSampleFrameIndex: frameIndex,
        liveSampleIntervalMs,
        simStepCount: sample.simStepCount,
        frameCount: sample.frameCount,
        requestedRoute,
        effectiveRoute: sample.effectiveRoute,
        rendererIdentity: sample.boundarySplatRendererIdentity,
        modelIdentity: sample.boundarySplatAttributeModelIdentity,
        sourceAuthority: sample.boundarySplatSourceAuthority,
        fallbackReason,
        boundarySplatCandidateCount: sample.boundarySplatCandidateCount,
        boundarySplatInstanceCount: sample.boundarySplatInstanceCount,
        boundarySplatOverflowCount: sample.boundarySplatOverflowCount,
        boundarySplatCountAuthority: sample.boundarySplatCountAuthority,
        candidates,
        camera: splats.camera,
        splats: {
          ...splats,
          camera: undefined,
        },
      });
      lastTrustworthyEvidence[`frame-${frameIndex}`] = {
        sequenceAuthority: 'live-running-sample-sequence-v0',
        rowCount: candidates.count,
        simStepCount: sample.simStepCount,
        frameCount: sample.frameCount,
        rendererIdentity: sample.boundarySplatRendererIdentity,
        fallbackReason,
        transport: candidates.transport,
        splatTransport: splats.transport,
      };
      logProgress({
        phase: 'live-sample-captured',
        frameIndex,
        frames,
        rowCount: candidates.count,
        bytes: candidates.bytes,
        chunkCount: candidates.transport.chunkCount,
        splatChunkCount: splats.transport.chunkCount,
        simStepCount: sample.simStepCount,
        frameCount: sample.frameCount,
        rendererIdentity: sample.boundarySplatRendererIdentity,
        fallbackReason,
      });
    } finally {
      await clearBrowserSideFeatureCapture(staged?.token);
    }
  }
  return captured;
}

function buildTemporalAlignment(capturedFrames) {
  const center = Math.floor(capturedFrames.length / 2);
  const source = capturedFrames[center];
  const sourceBytes = readFileSync(source.splats.path);
  if (sha256(sourceBytes) !== source.splats.sha256) throw new Error(`source splat artifact sha256 mismatch for ${source.id}`);
  const sourceSplats = new Float32Array(sourceBytes.buffer, sourceBytes.byteOffset, sourceBytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const offsets = requestedOffsets.slice().sort((a, b) => a - b);
  const pairs = offsets.map(offset => {
    const targetIndex = center + offset;
    if (targetIndex < 0 || targetIndex >= capturedFrames.length) throw new Error(`offset ${offset} is outside ${capturedFrames.length} captured frames`);
    const target = capturedFrames[targetIndex];
    const targetBytes = readFileSync(target.splats.path);
    if (sha256(targetBytes) !== target.splats.sha256) throw new Error(`target splat artifact sha256 mismatch for ${target.id}`);
    const targetSplats = new Float32Array(targetBytes.buffer, targetBytes.byteOffset, targetBytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
    const alignment = alignBoundarySplatRowsByWorldPosition(sourceSplats, targetSplats, { countsOnly: true });
    return {
      sourceFrameId: source.id,
      targetFrameId: target.id,
      offsetSteps: offset,
      sourceCount: source.candidates.count,
      targetCount: target.candidates.count,
      matchedSlots: alignment.matchedCount,
      births: alignment.birthCount,
      deaths: alignment.deathCount,
      stableSupportCount: alignment.matchedCount,
    };
  });
  return {
    schema: 'kaminos-boundary-splat-temporal-alignment-v0',
    identityKey: 'world-position-stable-key',
    alignmentMethod: 'world-position-stable-key',
    offsetSteps: offsets,
    supportSemantics: {
      matched: 'same quantized live splat world position is present in source and target',
      birth: 'target live splat world position is absent from source support',
      death: 'source live splat world position is absent from target support',
    },
    pairs,
  };
}

function compactState(state) {
  if (!state) return null;
  return {
    active: state.active,
    backend: state.backend,
    effectiveRoute: state.effectiveRoute,
    boundarySplatMode: state.boundarySplatMode,
    boundarySplatRendererIdentity: state.boundarySplatRendererIdentity,
    boundarySplatFeatureCaptureRequested: state.boundarySplatFeatureCaptureRequested,
    boundarySplatFeatureCaptureEffective: state.boundarySplatFeatureCaptureEffective,
    boundarySplatCandidateCount: state.boundarySplatCandidateCount,
    boundarySplatFallbackReason: state.boundarySplatFallbackReason,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function logProgress(event) {
  console.error(JSON.stringify({ schema: `${SCHEMA}.progress`, ...event }));
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}
