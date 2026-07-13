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
  browser = await launchBrowser(requestedRoute);
  failurePhase = 'cdp-connect';
  await waitForCdp();
  const page = await findPage();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  await wsRequest('Runtime.enable');
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

async function captureFeatureFrames(requestedRoute) {
  const captured = [];
  let sameBrowserSessionId = null;
  let sequenceStartNowMs = null;
  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    logProgress({ phase: 'frame-start', frameIndex, frames });
    const result = await wsRequest('Runtime.evaluate', {
      expression: `window.__kaminosVolumePrototype.controlledStepFrame(${JSON.stringify({
        controlledStepFrameIndex: frameIndex,
        advanceSim: frameIndex > 0,
        sameBrowserSessionId,
        startNow: sequenceStartNowMs,
        stepDeltaMs: stepMs,
        renderScales: [1],
        includeRgba: false,
        compactSamples: false,
        resumeRenderLoop: false,
      })})`,
      awaitPromise: true,
      returnByValue: true,
    });
    const frame = result.result.value;
    if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
      throw new Error(`controlled-step frame ${frameIndex} failed: ${JSON.stringify(frame)}`);
    }
    sameBrowserSessionId = frame.sameBrowserSessionId;
    sequenceStartNowMs = frame.sequenceStartNowMs;
    const sample = frame.scaleSet?.samples?.[0];
    if (sample?.ok !== true) throw new Error(`frame ${frameIndex} did not return a valid scale sample`);
    const candidatePath = resolve(outDir, `frame-${String(frameIndex).padStart(3, '0')}.features.f32`);
    const candidates = materializeFeatureCapture(sample.boundarySplatFeatureCapture, candidatePath);
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
    });
    lastTrustworthyEvidence[`frame-${frameIndex}`] = {
      rowCount: candidates.count,
      simStepCount: sample.simStepCount,
      rendererIdentity: sample.boundarySplatRendererIdentity,
      fallbackReason,
    };
    logProgress({
      phase: 'frame-captured',
      frameIndex,
      frames,
      rowCount: candidates.count,
      bytes: candidates.bytes,
      simStepCount: sample.simStepCount,
      rendererIdentity: sample.boundarySplatRendererIdentity,
      fallbackReason,
    });
  }
  return captured;
}

async function captureLiveSampleFeatureFrames(requestedRoute) {
  const captured = [];
  const sameBrowserSessionId = `live-sample-${Date.now().toString(36)}`;
  for (let frameIndex = 0; frameIndex < frames; frameIndex += 1) {
    if (frameIndex > 0) await delay(liveSampleIntervalMs);
    logProgress({ phase: 'live-sample-start', frameIndex, frames, liveSampleIntervalMs });
    const result = await wsRequest('Runtime.evaluate', {
      expression: `window.__kaminosVolumePrototype.controlledStepFrame({
        advanceSim: false,
        controlledStepFrameIndex: ${frameIndex},
        renderScales: [1],
        includeRgba: false,
        compactSamples: false,
        resumeRenderLoop: true
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    const frame = result.result.value;
    if (frame?.ok !== true || frame.sequenceAuthority !== 'controlled-step-sequence-v0') {
      throw new Error(`live sample frame ${frameIndex} failed: ${JSON.stringify(frame)}`);
    }
    const sample = frame.scaleSet?.samples?.[0];
    if (sample?.ok !== true) throw new Error(`live sample frame ${frameIndex} did not return a valid scale sample`);
    const candidatePath = resolve(outDir, `frame-${String(frameIndex).padStart(3, '0')}.features.f32`);
    const candidates = materializeFeatureCapture(sample.boundarySplatFeatureCapture, candidatePath);
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
    });
    lastTrustworthyEvidence[`frame-${frameIndex}`] = {
      sequenceAuthority: 'live-running-sample-sequence-v0',
      rowCount: candidates.count,
      simStepCount: sample.simStepCount,
      frameCount: sample.frameCount,
      rendererIdentity: sample.boundarySplatRendererIdentity,
      fallbackReason,
    };
    logProgress({
      phase: 'live-sample-captured',
      frameIndex,
      frames,
      rowCount: candidates.count,
      bytes: candidates.bytes,
      simStepCount: sample.simStepCount,
      frameCount: sample.frameCount,
      rendererIdentity: sample.boundarySplatRendererIdentity,
      fallbackReason,
    });
  }
  return captured;
}

function buildTemporalAlignment(capturedFrames) {
  const center = Math.floor(capturedFrames.length / 2);
  const source = capturedFrames[center];
  const offsets = requestedOffsets.slice().sort((a, b) => a - b);
  const pairs = offsets.map(offset => {
    const targetIndex = center + offset;
    if (targetIndex < 0 || targetIndex >= capturedFrames.length) throw new Error(`offset ${offset} is outside ${capturedFrames.length} captured frames`);
    const target = capturedFrames[targetIndex];
    const matchedSlots = Math.min(source.candidates.count, target.candidates.count);
    return {
      sourceFrameId: source.id,
      targetFrameId: target.id,
      offsetSteps: offset,
      sourceCount: source.candidates.count,
      targetCount: target.candidates.count,
      matchedSlots,
      births: Math.max(0, target.candidates.count - matchedSlots),
      deaths: Math.max(0, source.candidates.count - matchedSlots),
      stableSupportCount: matchedSlots,
    };
  });
  return {
    schema: 'kaminos-boundary-splat-temporal-alignment-v0',
    identityKey: 'grid-cell-slot',
    alignmentMethod: 'grid-cell-slot',
    offsetSteps: offsets,
    supportSemantics: {
      matched: 'same compacted selected-candidate slot is present in source and target',
      birth: 'target selected-candidate slot exists beyond matched source support',
      death: 'source selected-candidate slot exists beyond matched target support',
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
