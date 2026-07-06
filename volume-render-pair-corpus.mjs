#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const CORPUS_SCHEMA = 'kaminos.volume.frame-locked-pair-corpus.v0';
const PAIR_AUTHORITY = 'frame-locked-render-scale-set-v0';
const IMAGE_AUTHORITY = 'cdp-canvas-clip-capture-after-render-only-frozen-sim-state';
const SEQUENCE_AUTHORITY = 'ordered-settle-time-sequence-v0';
const CONTROLLED_STEP_SEQUENCE_AUTHORITY = 'controlled-step-sequence-v0';
const HARD_LOW_SCALE_PRESET = 'hard-low-scale-v0';
const DEFAULT_BASE_URL = 'http://127.0.0.1:8097/?kaminos_volume_smoke=1&volume_scene=tall_plume&volume_tall_preset=operator_fire_0622&volume_resolution=128&volume_majorant_grid=48&volume_steps=148&volume_adaptive_rays=0.75&volume_density=3.05&volume_fire=0.50&volume_radiance=3&volume_absorption=0&volume_glow=2.5&volume_smoke=2.8&volume_curl=3.5&volume_microdetail=2.5&volume_interface_shred=0&volume_fire_licks=0&volume_projection=1.5&volume_speed=5&volume_fire_scale=0.59&volume_detail_scale=0.45&volume_plume_height=2.2&volume_wind_strength=0&volume_wind_angle=180&volume_wind_height=-0.8&volume_input_radius=0.11&volume_flow_rate=0.35&volume_reaction_fuel=1&volume_majorant_cadence=1&volume_pressure_iterations=2&volume_pressure_strategy=global&volume_sim_profile=1&volume_temporal_accum=0&volume_temporal_jitter=0&volume_history_clamp=1&volume_occupancy_skip=0.1&volume_majorant_skip=0&volume_majorant_smooth=0.1&volume_majorant_guard=0.3';

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const next = argv[index + 1];
    const value = next && !next.startsWith('--') ? next : true;
    if (parsed.has(key)) {
      const current = parsed.get(key);
      parsed.set(key, Array.isArray(current) ? [...current, value] : [current, value]);
    } else {
      parsed.set(key, value);
    }
    if (value !== true) index += 1;
  }
  return parsed;
}

function numberList(value, fallback) {
  const raw = Array.isArray(value) ? value.join(',') : String(value || fallback);
  const numbers = raw
    .split(',')
    .map(entry => Number(entry.trim()))
    .filter(entry => Number.isFinite(entry));
  return numbers.length ? numbers : String(fallback).split(',').map(Number);
}

function clampRenderScale(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested)) return 0.1;
  return Math.max(0.1, Math.min(1, requested));
}

function scaleSlug(value) {
  return `rs${String(Math.round(clampRenderScale(value) * 100)).padStart(3, '0')}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
}

function padIndex(value) {
  return String(value + 1).padStart(3, '0');
}

function writeJson(path, payload) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

async function cdpFetchForPort(port, path, options) {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`, options);
  if (!resp.ok) throw new Error(`CDP ${path} failed ${resp.status}`);
  return resp.json();
}

function wsRequest(ws, method, params = {}) {
  const id = ws._nextId = (ws._nextId || 0) + 1;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolveReq, rejectReq) => {
    const onMessage = event => {
      const msg = JSON.parse(String(event.data));
      if (msg.id !== id) return;
      ws.removeEventListener('message', onMessage);
      if (msg.error) rejectReq(new Error(`${method}: ${msg.error.message}`));
      else resolveReq(msg.result);
    };
    ws.addEventListener('message', onMessage);
  });
}

function waitForWebSocketOpen(ws) {
  return new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener('open', resolveOpen, { once: true });
    ws.addEventListener('error', () => rejectOpen(new Error('WebSocket open failed')), { once: true });
  });
}

async function closeCdpBrowser(port) {
  const version = await cdpFetchForPort(port, '/json/version');
  if (!version.webSocketDebuggerUrl) return false;
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await waitForWebSocketOpen(ws);
  try {
    await wsRequest(ws, 'Browser.close');
  } finally {
    ws.close();
  }
  return true;
}

async function cleanupCorpusWitnessBrowserSession(corpus) {
  const session = corpus.witnessBrowserSession;
  if (!session?.enabled || corpus.dryRun) {
    corpus.witnessBrowserSession = {
      ...session,
      cleanupStatus: session?.enabled ? 'not-run-dry-run' : 'disabled',
    };
    return;
  }
  let browserCloseSent = false;
  try {
    browserCloseSent = await closeCdpBrowser(session.port);
  } catch {
    browserCloseSent = false;
  }
  corpus.witnessBrowserSession = {
    ...session,
    cleanupStatus: browserCloseSent ? 'closed' : 'not-open-or-already-closed',
    closedAt: new Date().toISOString(),
    browserCloseSent,
  };
}

function gitValue(args, fallback = null) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback;
  } catch {
    return fallback;
  }
}

function builtInVariants(preset, defaultSettleMs) {
  if (preset !== HARD_LOW_SCALE_PRESET) {
    throw new Error(`unknown variant preset: ${preset}`);
  }
  return [
    {
      id: 'state-001-canonical-hot-4300',
      label: 'canonical hot early time slice',
      tags: ['canonical', 'time-slice', 'hot'],
      settleMs: 4300,
      overrides: {},
    },
    {
      id: 'state-002-canonical-hot-5400',
      label: 'canonical hot later time slice',
      tags: ['canonical', 'time-slice', 'hot'],
      settleMs: 5400,
      overrides: {},
    },
    {
      id: 'state-003-thin-licks-curl',
      label: 'thin flame licks and curl-heavy edge texture',
      tags: ['thin-licks', 'curl', 'edge-detail'],
      settleMs: Math.max(defaultSettleMs, 5600),
      overrides: {
        volume_curl: 4.0,
        volume_fire: 0.65,
        volume_smoke: 2.25,
        volume_radiance: 3.0,
        volume_microdetail: 2.5,
        volume_interface_shred: 1.4,
        volume_fire_licks: 2.8,
        volume_input_radius: 0.09,
        volume_flow_rate: 0.25,
        volume_detail_scale: 0.9,
      },
    },
    {
      id: 'state-004-smoke-heavy-gradient',
      label: 'dense smoke gradients with broad occupancy',
      tags: ['smoke-heavy', 'gradient', 'occupancy'],
      settleMs: Math.max(defaultSettleMs, 6000),
      overrides: {
        volume_density: 3.45,
        volume_fire: 0.45,
        volume_smoke: 2.8,
        volume_radiance: 2.65,
        volume_glow: 2.5,
        volume_curl: 4.0,
        volume_microdetail: 2.5,
        volume_fire_licks: 0.8,
      },
    },
    {
      id: 'state-005-snuff-quench-vapor',
      label: 'snuff/quench vapor lifecycle front',
      tags: ['snuff', 'quench', 'lifecycle', 'vapor'],
      settleMs: Math.max(defaultSettleMs, 6200),
      overrides: {
        volume_lifecycle_effect: 'snuff',
        volume_lifecycle_t: 0.48,
        volume_quench_vapor: 1,
        volume_fire: 0.55,
        volume_smoke: 2.8,
        volume_radiance: 2.8,
        volume_glow: 2.5,
        volume_curl: 4.0,
        volume_microdetail: 2.5,
        volume_fire_licks: 1.8,
      },
    },
  ];
}

function normalizeVariant(raw, index, defaultSettleMs) {
  const id = String(raw.id || raw.variantId || `variant-${String(index + 1).padStart(3, '0')}`).replace(/[^a-zA-Z0-9_.-]+/g, '-');
  return {
    id,
    label: String(raw.label || raw.name || id),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String) : [],
    settleMs: Number.isFinite(Number(raw.settleMs)) ? Number(raw.settleMs) : defaultSettleMs,
    overrides: raw.overrides && typeof raw.overrides === 'object' ? raw.overrides : {},
  };
}

function loadVariants(args, defaultSettleMs) {
  const variantFile = args.get('--variant-file');
  if (variantFile) {
    const payload = readJson(resolve(String(variantFile)));
    const variants = Array.isArray(payload) ? payload : payload.variants;
    if (!Array.isArray(variants) || !variants.length) {
      throw new Error(`variant file has no variants: ${variantFile}`);
    }
    return variants.map((variant, index) => normalizeVariant(variant, index, defaultSettleMs));
  }
  const preset = String(args.get('--variant-preset') || HARD_LOW_SCALE_PRESET);
  return builtInVariants(preset, defaultSettleMs).map((variant, index) => normalizeVariant(variant, index, defaultSettleMs));
}

function routeWithOverrides(baseUrl, overrides) {
  const url = new URL(baseUrl);
  url.searchParams.set('kaminos_volume_smoke', '1');
  for (const [key, value] of Object.entries(overrides || {})) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function readDatasetManifest(path) {
  if (!existsSync(path)) return null;
  const payload = readJson(path);
  return payload.dataset || payload;
}

function temporalPairSortKey(pair) {
  const frameIndex = Number(pair.temporalFrameIndex);
  return [
    Number.isFinite(frameIndex) ? frameIndex : Number.MAX_SAFE_INTEGER,
    String(pair.pairId || ''),
  ];
}

function temporalPairGroupKey(pair) {
  const sequenceId = pair.temporalSequenceId || pair.sequenceId || pair.variantId || 'unsequenced';
  return `${sequenceId}::${Number(pair.lowRenderScale).toFixed(3)}`;
}

function summarizeTemporalSequences(corpus) {
  const bySequence = new Map();
  const adjacentPairs = [];
  for (const pair of corpus.pairs) {
    if (!pair.temporalSequenceId || !Number.isFinite(Number(pair.temporalFrameIndex))) continue;
    const sequence = bySequence.get(pair.temporalSequenceId) || {
      temporalSequenceId: pair.temporalSequenceId,
      sequenceAuthority: pair.sequenceAuthority || SEQUENCE_AUTHORITY,
      sequenceLabel: pair.sequenceLabel || pair.variantLabel || pair.temporalSequenceId,
      sequenceTags: pair.sequenceTags || pair.variantTags || [],
      lowRenderScales: new Set(),
      frameIndices: new Set(),
      pairCount: 0,
      temporalAdjacentPairCount: 0,
    };
    sequence.lowRenderScales.add(Number(pair.lowRenderScale));
    sequence.frameIndices.add(Number(pair.temporalFrameIndex));
    sequence.pairCount += 1;
    bySequence.set(pair.temporalSequenceId, sequence);
  }
  const groups = new Map();
  for (const pair of corpus.pairs) {
    if (!pair.temporalSequenceId || !Number.isFinite(Number(pair.temporalFrameIndex))) continue;
    const key = temporalPairGroupKey(pair);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(pair);
  }
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const leftKey = temporalPairSortKey(left);
      const rightKey = temporalPairSortKey(right);
      return leftKey[0] - rightKey[0] || leftKey[1].localeCompare(rightKey[1]);
    });
    for (let index = 1; index < group.length; index += 1) {
      const previous = group[index - 1];
      const current = group[index];
      const sequence = bySequence.get(current.temporalSequenceId);
      if (sequence) sequence.temporalAdjacentPairCount += 1;
      adjacentPairs.push({
        temporalSequenceId: current.temporalSequenceId,
        lowRenderScale: current.lowRenderScale,
        previousPairId: previous.pairId,
        currentPairId: current.pairId,
        previousTemporalFrameIndex: previous.temporalFrameIndex,
        currentTemporalFrameIndex: current.temporalFrameIndex,
      });
    }
  }
  return {
    temporalAdjacentPairCount: adjacentPairs.length,
    temporalAdjacentPairs: adjacentPairs,
    temporalSequences: Array.from(bySequence.values()).map(sequence => ({
      ...sequence,
      lowRenderScales: Array.from(sequence.lowRenderScales).sort((a, b) => a - b),
      frameIndices: Array.from(sequence.frameIndices).sort((a, b) => a - b),
      capturedFrameCount: sequence.frameIndices.size,
    })).sort((left, right) => left.temporalSequenceId.localeCompare(right.temporalSequenceId)),
  };
}

function variantFailureFromDataset(variant, dataset, fallback) {
  const failure = dataset?.failures?.[0] || fallback || {};
  return {
    variantId: variant.id,
    code: failure.code || 'variant-failed',
    failurePhase: failure.failurePhase || 'unknown',
    message: failure.message || 'variant capture failed',
    details: failure.details || {},
  };
}

function renderScaleSetForCorpus(corpus) {
  const seen = new Set();
  return [...corpus.lowRenderScales, corpus.highRenderScale].filter(renderScale => {
    const key = renderScale.toFixed(3);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function captureToPairEndpoint(capture) {
  return {
    path: capture.image,
    featurePath: capture.feature || capture.featurePath || null,
    featureCapture: capture.featureCapture || null,
    featureAuthority: capture.featureCapture?.featureAuthority || capture.featureAuthority || null,
    report: capture.report,
    requestedRenderScale: capture.requestedRenderScale,
    renderScale: capture.renderScale,
    renderPixelRatio: capture.renderPixelRatio,
    renderWidth: capture.renderWidth,
    renderHeight: capture.renderHeight,
    displayWidth: capture.displayWidth,
    displayHeight: capture.displayHeight,
    volumeReconstructionStyle: capture.volumeReconstructionStyle,
    sampleAuthority: capture.sampleAuthority,
    imageAuthority: capture.imageAuthority,
    imageWidth: capture.imageWidth,
    imageHeight: capture.imageHeight,
    canvasCssRect: capture.canvasCssRect,
    screenshotClip: capture.screenshotClip,
    devicePixelRatio: capture.devicePixelRatio,
    hudSuppression: capture.hudSuppression,
    sameStateCaptureId: capture.sameStateCaptureId,
    baseFrameCount: capture.baseFrameCount,
    baseSimStepCount: capture.baseSimStepCount,
    frameCount: capture.frameCount,
    simStepCount: capture.simStepCount,
    sameBrowserSessionId: capture.sameBrowserSessionId,
    sequenceAuthority: capture.sequenceAuthority,
    controlledStepFrameIndex: capture.controlledStepFrameIndex,
    controlledStepDeltaMs: capture.controlledStepDeltaMs,
    controlledStepNowMs: capture.controlledStepNowMs,
    controlledStepCapture: capture.controlledStepCapture,
  };
}

function runControlledStepVariant({ variant, index, corpus, cwd }) {
  const variantDir = resolve(corpus.outRoot, variant.id);
  const route = routeWithOverrides(corpus.baseUrl, variant.overrides);
  const manifestPath = resolve(variantDir, 'controlled-step-witness.json');
  const stdout = resolve(variantDir, 'controlled-step-witness.stdout.log');
  const stderr = resolve(variantDir, 'controlled-step-witness.stderr.log');
  const previewPath = resolve(variantDir, 'controlled-step-witness-preview.png');
  const fullScreenshot = resolve(variantDir, 'controlled-step-witness.full.png');
  const controlledStepDir = resolve(variantDir, 'controlled-step-frames');
  const debugPort = corpus.reuseWitnessBrowser ? corpus.debugPort : corpus.debugPort + index * 32;
  const command = [
    process.execPath,
    'volume-witness.mjs',
    '--url', route,
    '--out', previewPath,
    '--report', manifestPath,
    '--full-screenshot', fullScreenshot,
    '--debug-port', String(debugPort),
    '--settle-ms', String(variant.settleMs),
    '--window-size', corpus.windowSize,
    '--evidence-mode', corpus.evidenceMode,
    '--render-scale-set', renderScaleSetForCorpus(corpus).join(','),
    '--render-scale-set-dir', controlledStepDir,
    '--render-scale-set-prefix', `${variant.id}-initial-scale-set`,
    '--controlled-step-sequence', '1',
    '--controlled-step-frames', String(corpus.framesPerSequence),
    '--controlled-step-delta-ms', String(corpus.controlledStepDeltaMs),
    '--controlled-step-dir', controlledStepDir,
    '--controlled-step-prefix', variant.id,
  ];
  if (corpus.featureCaptures) {
    command.push('--render-scale-feature-captures', '1');
  }
  if (corpus.reuseWitnessBrowser) {
    command.push(
      '--reuse-browser', '1',
      '--keep-browser-open', '1',
      '--user-data-dir', corpus.witnessBrowserSession.userDataDir
    );
  }
  const summary = {
    id: variant.id,
    label: variant.label,
    tags: variant.tags,
    status: 'running',
    settleMs: variant.settleMs,
    overrides: variant.overrides,
    debugPort,
    route,
    manifestPath,
    stdout,
    stderr,
    command,
    pairCount: 0,
    sequenceAuthority: CONTROLLED_STEP_SEQUENCE_AUTHORITY,
    sequenceFrameCount: corpus.framesPerSequence,
    controlledStepDeltaMs: corpus.controlledStepDeltaMs,
    sameBrowserSessionId: null,
    sequenceFrames: [],
  };
  corpus.variants.push(summary);
  writeJson(corpus.manifestPath, corpus);
  mkdirSync(variantDir, { recursive: true });
  if (corpus.dryRun) {
    summary.status = 'dry-run';
    summary.sameBrowserSessionId = `${variant.id}-dry-run-same-browser-session`;
    for (let frameIndex = 0; frameIndex < corpus.framesPerSequence; frameIndex += 1) {
      const frameId = `${variant.id}-frame-${padIndex(frameIndex)}`;
      summary.sequenceFrames.push({
        frameId,
        temporalFrameIndex: frameIndex,
        controlledStepFrameIndex: frameIndex,
        controlledStepDeltaMs: corpus.controlledStepDeltaMs,
        sameBrowserSessionId: summary.sameBrowserSessionId,
        status: 'dry-run',
        pairCount: corpus.lowRenderScales.length,
      });
      for (let lowIndex = 0; lowIndex < corpus.lowRenderScales.length; lowIndex += 1) {
        const lowRenderScale = corpus.lowRenderScales[lowIndex];
        corpus.pairs.push({
          pairId: `${frameId}-pair-${padIndex(lowIndex)}-${scaleSlug(lowRenderScale)}-to-${scaleSlug(corpus.highRenderScale)}`,
          pairAuthority: PAIR_AUTHORITY,
          supervisedResidualTrainingSuitable: false,
          lowRenderScale,
          highRenderScale: corpus.highRenderScale,
          variantId: variant.id,
          variantLabel: variant.label,
          variantTags: variant.tags,
          variantOverrides: variant.overrides,
          sequenceAuthority: CONTROLLED_STEP_SEQUENCE_AUTHORITY,
          sequenceId: variant.id,
          sequenceLabel: variant.label,
          sequenceTags: variant.tags,
          sequenceFrameId: frameId,
          sequenceFrameCount: corpus.framesPerSequence,
          frameStrideMs: corpus.controlledStepDeltaMs,
          temporalSequenceId: variant.id,
          temporalFrameIndex: frameIndex,
          controlledStepFrameIndex: frameIndex,
          controlledStepDeltaMs: corpus.controlledStepDeltaMs,
          sameBrowserSessionId: summary.sameBrowserSessionId,
          controlledStepCapture: { ok: true, sampleAuthority: 'dry-run-controlled-step-capture' },
          status: 'dry-run',
        });
      }
    }
    summary.pairCount = corpus.lowRenderScales.length * corpus.framesPerSequence;
    return summary;
  }
  const started = Date.now();
  const stdoutFd = openSync(stdout, 'w');
  const stderrFd = openSync(stderr, 'w');
  let child;
  try {
    child = spawnSync(command[0], command.slice(1), {
      cwd,
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }
  summary.durationMs = Date.now() - started;
  const witness = readDatasetManifest(manifestPath);
  const controlledStepCapture = witness?.controlledStepSequence || null;
  if (child.status !== 0 || !controlledStepCapture || controlledStepCapture.sequenceAuthority !== CONTROLLED_STEP_SEQUENCE_AUTHORITY || controlledStepCapture.sameBrowserSequenceSuitable !== true) {
    summary.status = 'failed';
    summary.failure = variantFailureFromDataset(variant, null, {
      code: 'controlled-step-witness-failed',
      failurePhase: witness ? 'controlled-step-validation' : 'controlled-step-spawn',
      message: `controlled-step witness failed for ${variant.id}`,
      details: {
        status: child.status,
        signal: child.signal,
        spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
        manifestPath,
        stdout,
        stderr,
      },
    });
    corpus.failures.push({
      ...summary.failure,
      temporalSequenceId: variant.id,
      sequenceAuthority: CONTROLLED_STEP_SEQUENCE_AUTHORITY,
    });
    return summary;
  }
  summary.status = 'captured';
  summary.sameBrowserSessionId = controlledStepCapture.sameBrowserSessionId;
  for (const frame of controlledStepCapture.frames || []) {
    const frameIndex = Number(frame.controlledStepFrameIndex);
    const frameId = `${variant.id}-frame-${padIndex(frameIndex)}`;
    summary.sequenceFrames.push({
      frameId,
      temporalFrameIndex: frameIndex,
      controlledStepFrameIndex: frameIndex,
      controlledStepDeltaMs: frame.controlledStepDeltaMs,
      controlledStepNowMs: frame.controlledStepNowMs,
      sameBrowserSessionId: frame.sameBrowserSessionId,
      sameStateCaptureId: frame.sameStateCaptureId,
      baseFrameCount: frame.baseFrameCount,
      baseSimStepCount: frame.baseSimStepCount,
      controlledStepCapture: frame.controlledStepCapture,
      status: 'captured',
      pairCount: 0,
    });
    const highCapture = (frame.captures || []).find(capture => Number(capture.requestedRenderScale).toFixed(3) === corpus.highRenderScale.toFixed(3));
    const lowCaptures = (frame.captures || []).filter(capture => Number(capture.requestedRenderScale).toFixed(3) !== corpus.highRenderScale.toFixed(3));
    for (let lowIndex = 0; lowIndex < lowCaptures.length; lowIndex += 1) {
      const lowCapture = lowCaptures[lowIndex];
      if (!highCapture) continue;
      const lowRenderScale = clampRenderScale(lowCapture.requestedRenderScale ?? lowCapture.renderScale);
      const pairId = `${frameId}-pair-${padIndex(lowIndex)}-${scaleSlug(lowRenderScale)}-to-${scaleSlug(corpus.highRenderScale)}`;
      const low = captureToPairEndpoint(lowCapture);
      const high = captureToPairEndpoint(highCapture);
      corpus.pairs.push({
        pairId,
        pairAuthority: PAIR_AUTHORITY,
        supervisedResidualTrainingSuitable: true,
        lowRenderScale,
        highRenderScale: corpus.highRenderScale,
        capture: {
          role: 'controlled-step-sequence',
          route,
          report: manifestPath,
          stdout,
          stderr,
          command,
          sequenceAuthority: CONTROLLED_STEP_SEQUENCE_AUTHORITY,
          sameBrowserSessionId: frame.sameBrowserSessionId,
          controlledStepFrameIndex: frameIndex,
          controlledStepDeltaMs: frame.controlledStepDeltaMs,
          controlledStepCapture: frame.controlledStepCapture,
        },
        sameStateCaptureId: frame.sameStateCaptureId,
        sameBrowserSessionId: frame.sameBrowserSessionId,
        controlledStepFrameIndex: frameIndex,
        controlledStepDeltaMs: frame.controlledStepDeltaMs,
        controlledStepNowMs: frame.controlledStepNowMs,
        controlledStepCapture: frame.controlledStepCapture,
        low,
        high,
        witness: {
          preview: previewPath,
          report: manifestPath,
          fullScreenshot,
        },
        effective: {
          pairAuthority: PAIR_AUTHORITY,
          sequenceAuthority: CONTROLLED_STEP_SEQUENCE_AUTHORITY,
          sameBrowserSessionId: frame.sameBrowserSessionId,
          sameStateCaptureId: frame.sameStateCaptureId,
          controlledStepFrameIndex: frameIndex,
          controlledStepDeltaMs: frame.controlledStepDeltaMs,
          controlledStepCapture: frame.controlledStepCapture,
          supervisedResidualTrainingSuitable: true,
          low,
          high,
        },
        variantId: variant.id,
        variantLabel: variant.label,
        variantTags: variant.tags,
        variantOverrides: variant.overrides,
        variantManifestPath: manifestPath,
        sequenceAuthority: CONTROLLED_STEP_SEQUENCE_AUTHORITY,
        sequenceId: variant.id,
        sequenceLabel: variant.label,
        sequenceTags: variant.tags,
        sequenceFrameId: frameId,
        sequenceFrameCount: corpus.framesPerSequence,
        frameStrideMs: frame.controlledStepDeltaMs,
        temporalSequenceId: variant.id,
        temporalFrameIndex: frameIndex,
        sequenceManifestPath: manifestPath,
      });
      summary.pairCount += 1;
      const frameSummary = summary.sequenceFrames[summary.sequenceFrames.length - 1];
      frameSummary.pairCount += 1;
    }
  }
  return summary;
}

function runVariant({ variant, index, args, corpus, cwd }) {
  if (corpus.sequenceMode === 'controlled-step') {
    return runControlledStepVariant({ variant, index, corpus, cwd });
  }
  const variantDir = resolve(corpus.outRoot, variant.id);
  const route = routeWithOverrides(corpus.baseUrl, variant.overrides);

  const summary = {
    id: variant.id,
    label: variant.label,
    tags: variant.tags,
    status: 'running',
    settleMs: variant.settleMs,
    overrides: variant.overrides,
    debugPort: corpus.reuseWitnessBrowser ? corpus.debugPort : corpus.debugPort + index * 32,
    route,
    manifestPath: null,
    stdout: null,
    stderr: null,
    pairCount: 0,
    sequenceAuthority: corpus.temporalSequenceMode ? SEQUENCE_AUTHORITY : null,
    sequenceFrameCount: corpus.temporalSequenceMode ? corpus.framesPerSequence : 1,
    sequenceFrames: [],
  };
  corpus.variants.push(summary);
  writeJson(corpus.manifestPath, corpus);
  mkdirSync(variantDir, { recursive: true });

  for (let frameIndex = 0; frameIndex < summary.sequenceFrameCount; frameIndex += 1) {
    const frameId = corpus.temporalSequenceMode ? `${variant.id}-frame-${padIndex(frameIndex)}` : variant.id;
    const frameDir = corpus.temporalSequenceMode ? resolve(variantDir, `frame-${padIndex(frameIndex)}`) : variantDir;
    const manifestPath = resolve(frameDir, 'manifest.json');
    const stdout = resolve(frameDir, 'dataset.stdout.log');
    const stderr = resolve(frameDir, 'dataset.stderr.log');
    const sequenceSettleMs = variant.settleMs + frameIndex * corpus.frameStrideMs;
    const debugPort = corpus.reuseWitnessBrowser ? corpus.debugPort : corpus.debugPort + index * 32 + frameIndex * 4;
    const command = [
      process.execPath,
      'volume-render-pair-dataset.mjs',
      '--out-dir', frameDir,
      '--manifest', manifestPath,
      '--base-url', route,
      '--low-render-scales', corpus.lowRenderScales.join(','),
      '--high-render-scale', String(corpus.highRenderScale),
      '--debug-port', String(debugPort),
      '--settle-ms', String(sequenceSettleMs),
      '--window-size', corpus.windowSize,
      '--evidence-mode', corpus.evidenceMode,
    ];
    if (corpus.featureCaptures) {
      command.push('--feature-captures', '1');
    }
    if (corpus.reuseWitnessBrowser) {
      command.push(
        '--reuse-witness-browser', '1',
        '--keep-witness-browser-open', '1',
        '--witness-browser-user-data-dir', corpus.witnessBrowserSession.userDataDir
      );
    } else {
      command.push('--no-reuse-witness-browser', '1');
    }
    if (corpus.dryRun) command.push('--dry-run');
    const frameSummary = {
      frameId,
      temporalFrameIndex: frameIndex,
      sequenceSettleMs,
      frameStrideMs: corpus.frameStrideMs,
      debugPort,
      manifestPath,
      stdout,
      stderr,
      command,
      status: 'running',
      pairCount: 0,
    };
    summary.sequenceFrames.push(frameSummary);
    if (frameIndex === 0) {
      summary.manifestPath = manifestPath;
      summary.stdout = stdout;
      summary.stderr = stderr;
      summary.command = command;
    }
    writeJson(corpus.manifestPath, corpus);
    mkdirSync(frameDir, { recursive: true });
    const started = Date.now();
    const stdoutFd = openSync(stdout, 'w');
    const stderrFd = openSync(stderr, 'w');
    let child;
    try {
      child = spawnSync(command[0], command.slice(1), {
        cwd,
        stdio: ['ignore', stdoutFd, stderrFd],
      });
    } finally {
      closeSync(stdoutFd);
      closeSync(stderrFd);
    }
    frameSummary.durationMs = Date.now() - started;
    const dataset = readDatasetManifest(manifestPath);
    if (child.status !== 0 || !dataset || dataset.failures?.length) {
      frameSummary.status = 'failed';
      summary.status = 'failed';
      summary.failure = variantFailureFromDataset(variant, dataset, {
        code: 'dataset-command-failed',
        failurePhase: dataset ? 'dataset-validation' : 'dataset-spawn',
        message: `volume-render-pair-dataset failed for ${variant.id} frame ${frameIndex}`,
        details: {
          status: child.status,
          signal: child.signal,
          spawnError: child.error ? { name: child.error.name, message: child.error.message, code: child.error.code } : null,
          manifestPath,
          stdout,
          stderr,
        },
      });
      corpus.failures.push({
        ...summary.failure,
        temporalSequenceId: variant.id,
        temporalFrameIndex: frameIndex,
        sequenceSettleMs,
      });
      return summary;
    }
    const capturedPairs = Array.isArray(dataset.pairs)
      ? dataset.pairs.filter(pair => pair.status === 'captured' || corpus.dryRun)
      : [];
    for (const pair of capturedPairs) {
      const sequencePairId = corpus.temporalSequenceMode
        ? `${frameId}-${pair.pairId}`
        : pair.pairId;
      corpus.pairs.push({
        ...pair,
        pairId: sequencePairId,
        sourcePairId: pair.pairId,
        variantId: variant.id,
        variantLabel: variant.label,
        variantTags: variant.tags,
        variantOverrides: variant.overrides,
        variantManifestPath: manifestPath,
        sequenceAuthority: corpus.temporalSequenceMode ? SEQUENCE_AUTHORITY : null,
        sequenceId: corpus.temporalSequenceMode ? variant.id : null,
        sequenceLabel: corpus.temporalSequenceMode ? variant.label : null,
        sequenceTags: corpus.temporalSequenceMode ? variant.tags : null,
        sequenceFrameId: corpus.temporalSequenceMode ? frameId : null,
        sequenceFrameCount: corpus.temporalSequenceMode ? corpus.framesPerSequence : null,
        sequenceSettleMs: corpus.temporalSequenceMode ? sequenceSettleMs : null,
        frameStrideMs: corpus.temporalSequenceMode ? corpus.frameStrideMs : null,
        temporalSequenceId: corpus.temporalSequenceMode ? variant.id : null,
        temporalFrameIndex: corpus.temporalSequenceMode ? frameIndex : null,
        sequenceManifestPath: corpus.temporalSequenceMode ? manifestPath : null,
      });
    }
    frameSummary.status = corpus.dryRun ? 'dry-run' : 'captured';
    frameSummary.pairCount = capturedPairs.length;
    frameSummary.datasetStatus = dataset.status;
    summary.pairCount += capturedPairs.length;
    const temporalSummary = summarizeTemporalSequences(corpus);
    corpus.temporalAdjacentPairCount = temporalSummary.temporalAdjacentPairCount;
    corpus.temporalAdjacentPairs = temporalSummary.temporalAdjacentPairs;
    corpus.temporalSequences = temporalSummary.temporalSequences;
    writeJson(corpus.manifestPath, corpus);
  }
  summary.status = corpus.dryRun ? 'dry-run' : 'captured';
  return summary;
}

const args = parseArgs(process.argv.slice(2));
const cwd = new URL('.', import.meta.url).pathname;
const outRoot = resolve(args.get('--out-dir') || '/tmp/kaminos-frame-locked-pair-corpus');
const manifestPath = resolve(args.get('--manifest') || `${outRoot}/corpus-manifest.json`);
const lowRenderScales = numberList(args.get('--low-render-scales') || args.get('--low-render-scale'), '0.10,0.15,0.18,0.25').map(clampRenderScale);
const highRenderScale = clampRenderScale(args.get('--high-render-scale') || 1);
const overlappingLowRenderScale = lowRenderScales.find(renderScale => renderScale.toFixed(3) === highRenderScale.toFixed(3));
if (overlappingLowRenderScale !== undefined) {
  throw new Error(`low/high render-scale overlap: low render scale ${overlappingLowRenderScale.toFixed(3)} matches high render scale ${highRenderScale.toFixed(3)}`);
}
const settleMs = Number(args.get('--settle-ms') || 5200);
const framesPerSequence = positiveInteger(args.get('--frames-per-sequence'), 1);
const frameStrideMs = nonNegativeNumber(args.get('--frame-stride-ms'), 320);
const requestedSequenceMode = String(args.get('--sequence-mode') || '').trim().toLowerCase();
const sequenceMode = requestedSequenceMode || ((framesPerSequence > 1 || args.has('--frames-per-sequence') || args.has('--frame-stride-ms')) ? 'ordered-settle' : 'single');
if (!['single', 'ordered-settle', 'controlled-step'].includes(sequenceMode)) {
  throw new Error(`unknown sequence mode: ${sequenceMode}`);
}
const temporalSequenceMode = sequenceMode !== 'single';
const activeSequenceAuthority = sequenceMode === 'controlled-step'
  ? CONTROLLED_STEP_SEQUENCE_AUTHORITY
  : (temporalSequenceMode ? SEQUENCE_AUTHORITY : null);
const controlledStepDeltaMs = nonNegativeNumber(args.get('--controlled-step-delta-ms'), frameStrideMs);
const variants = loadVariants(args, settleMs);
const featureCaptures = args.has('--feature-captures') || args.has('--render-scale-feature-captures');
const reuseWitnessBrowser = args.has('--reuse-witness-browser') || !args.has('--no-reuse-witness-browser');
const witnessBrowserSession = {
  identity: 'shared-headful-cdp-browser-v0',
  attachIdentity: 'attach-or-launch-shared-cdp-browser-v0',
  enabled: reuseWitnessBrowser,
  mode: reuseWitnessBrowser ? 'corpus-owned-shared-headful-cdp-browser' : 'per-dataset-or-witness-browser',
  port: Number(args.get('--debug-port') || 9800),
  userDataDir: resolve(args.get('--witness-browser-user-data-dir') || `/tmp/kaminos-render-pair-corpus-witness-profile-${Number(args.get('--debug-port') || 9800)}`),
  launchPolicy: reuseWitnessBrowser
    ? 'attach-or-launch-on-first-child-capture-many-cleanup-once'
    : 'child-captures-own-browser',
  focusStealMitigation: reuseWitnessBrowser
    ? 'one-headful-window-per-corpus-run-no-page-bringToFront-during-reused-captures'
    : 'none',
  cleanupStatus: args.has('--dry-run') ? 'not-run-dry-run' : 'pending',
};
const createdAt = new Date().toISOString();
const corpus = {
  schema: CORPUS_SCHEMA,
  status: args.has('--dry-run') ? 'dry-run' : 'running',
  createdAt,
  updatedAt: createdAt,
  generator: 'volume-render-pair-corpus.mjs',
  cwd,
  gitCommit: gitValue(['rev-parse', 'HEAD']),
  gitBranch: gitValue(['branch', '--show-current']),
  gitStatusShort: gitValue(['status', '--short'], ''),
  outRoot,
  manifestPath,
  baseUrl: String(args.get('--base-url') || DEFAULT_BASE_URL),
  variantPreset: args.get('--variant-file') ? null : String(args.get('--variant-preset') || HARD_LOW_SCALE_PRESET),
  variantFile: args.get('--variant-file') ? resolve(String(args.get('--variant-file'))) : null,
  dryRun: args.has('--dry-run'),
  keepGoing: args.has('--keep-going'),
  pairAuthority: PAIR_AUTHORITY,
  featureCaptures,
  featureCapture: featureCaptures ? {
    requested: true,
    featureAuthority: 'shader-material-authority-residual-feature-v0',
    imageAuthority: 'gpu-feature-texture-rgba8-readback-frozen-sim-state',
    inputChannels: 4,
    channelLayout: 'radiance-fire-interface-smoke',
  } : null,
  imageAuthority: IMAGE_AUTHORITY,
  sequenceAuthority: activeSequenceAuthority,
  sequenceMode,
  temporalSequenceMode,
  supervisedResidualTrainingSuitable: !args.has('--dry-run'),
  lowRenderScales,
  highRenderScale,
  debugPort: Number(args.get('--debug-port') || 9800),
  reuseWitnessBrowser,
  witnessBrowserSession,
  settleMs,
  framesPerSequence,
  frameStrideMs,
  controlledStepDeltaMs,
  windowSize: String(args.get('--window-size') || '1280,960'),
  evidenceMode: String(args.get('--evidence-mode') || 'performance'),
  requestedVariantCount: variants.length,
  pairCount: 0,
  temporalAdjacentPairCount: 0,
  temporalAdjacentPairs: [],
  temporalSequences: [],
  variants: [],
  pairs: [],
  failures: [],
};

writeJson(manifestPath, corpus);
for (let index = 0; index < variants.length; index += 1) {
  runVariant({ variant: variants[index], index, args, corpus, cwd });
  corpus.pairCount = corpus.pairs.length;
  const temporalSummary = summarizeTemporalSequences(corpus);
  corpus.temporalAdjacentPairCount = temporalSummary.temporalAdjacentPairCount;
  corpus.temporalAdjacentPairs = temporalSummary.temporalAdjacentPairs;
  corpus.temporalSequences = temporalSummary.temporalSequences;
  corpus.updatedAt = new Date().toISOString();
  corpus.status = corpus.failures.length ? (corpus.keepGoing ? 'partial' : 'failed') : (corpus.dryRun ? 'dry-run' : 'running');
  writeJson(manifestPath, corpus);
  if (corpus.failures.length && !corpus.keepGoing) break;
}
corpus.pairCount = corpus.pairs.length;
corpus.updatedAt = new Date().toISOString();
if (!corpus.failures.length) {
  corpus.status = corpus.dryRun ? 'dry-run' : 'captured';
} else if (corpus.keepGoing && corpus.pairs.length) {
  corpus.status = 'partial';
} else {
  corpus.status = 'failed';
}
await cleanupCorpusWitnessBrowserSession(corpus);
writeJson(manifestPath, corpus);
console.log(JSON.stringify(corpus, null, 2));
if (corpus.failures.length && !corpus.keepGoing) process.exit(1);
