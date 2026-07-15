#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { addBitmapLabel } from './boundary-splat-moving-phase-witness.mjs';
import { renderBoundarySplatRowsPng, worldPositionStableKey } from './boundary-splat-phase-render-witness.mjs';
import { visibleSplatEnergy } from './boundary-splat-phase-collapse-attribution.mjs';

const SCHEMA = 'kaminos-boundary-splat-phase-support-envelope-witness-v0';
const CORPUS_SCHEMA = 'kaminos-boundary-splat-phase-candidate-corpus-v0';
const PREDICTION_SCHEMA = 'kaminos-boundary-splat-phase-transport-predictions-v0';
const REFERENCE_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
const PREDICTION_AUTHORITY = 'learned-local-grid-transport-plus-residual-churn-v0';

export const SUPPORT_ENVELOPE_SELECTORS = Object.freeze({
  candidateSupport: (splat, candidate) => candidate[0],
  physicalSupport: splat => splat[3],
  visibleEnergy: splat => visibleSplatEnergy(splat),
});

const ROLE_AUTHORITIES = Object.freeze({
  prediction: 'unmodified-learned-recurrent-full-splat-state-v0',
  candidateSupport: 'training-envelope-top-protected-candidate-support-v0',
  physicalSupport: 'training-envelope-top-physical-splat-support-v0',
  visibleEnergy: 'training-envelope-top-physical-visible-energy-v0',
});

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) result.set(key, '1');
    else {
      result.set(key, value);
      index += 1;
    }
  }
  return result;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isSha256(value) {
  return /^[0-9a-f]{64}$/i.test(String(value));
}

function validateArtifactIdentity(identity, label) {
  if (
    !identity || typeof identity.path !== 'string' || !identity.path
    || !Number.isInteger(identity.bytes) || identity.bytes <= 0
    || !isSha256(identity.sha256)
  ) throw new Error(`support envelope ${label} identity mismatch`);
}

function validateModelIdentity(identity, label, schema) {
  if (
    !identity || typeof identity.path !== 'string' || !identity.path
    || identity.schema !== schema || !isSha256(identity.sha256)
  ) throw new Error(`support envelope ${label} identity mismatch`);
}

export function calibrateSupportCountEnvelope(frameCounts) {
  const counts = Array.from(frameCounts, Number);
  if (counts.length < 2 || counts.some(count => !Number.isInteger(count) || count <= 0)) {
    throw new Error('support envelope requires at least two positive training frame counts');
  }
  const frameZeroCount = counts[0];
  const minimumCount = Math.min(...counts);
  const maximumCount = Math.max(...counts);
  return {
    authority: 'training-episode-frame-zero-relative-support-envelope-v0',
    frameCount: counts.length,
    frameZeroCount,
    minimumCount,
    maximumCount,
    minimumRatio: minimumCount / frameZeroCount,
    maximumRatio: maximumCount / frameZeroCount,
  };
}

export function supportEnvelopeBudget(frameZeroCount, currentCount, oneStepRatio, envelope) {
  if (
    !Number.isInteger(frameZeroCount) || frameZeroCount <= 0
    || !Number.isInteger(currentCount) || currentCount <= 0
    || !Number.isFinite(oneStepRatio) || oneStepRatio <= 0
    || envelope?.authority !== 'training-episode-frame-zero-relative-support-envelope-v0'
    || !Number.isFinite(envelope.minimumRatio) || !Number.isFinite(envelope.maximumRatio)
    || envelope.minimumRatio <= 0 || envelope.maximumRatio < envelope.minimumRatio
  ) throw new Error('support envelope budget contract mismatch');
  const minimum = Math.round(frameZeroCount * envelope.minimumRatio);
  const maximum = Math.round(frameZeroCount * envelope.maximumRatio);
  return Math.max(minimum, Math.min(maximum, Math.round(currentCount * oneStepRatio)));
}

function finiteRows(values, stride, label) {
  const rows = Array.from(values, (value, index) => {
    const row = Array.from(value);
    if (row.length !== stride || row.some(channel => !Number.isFinite(channel))) {
      throw new Error(`${label} row ${index} must contain ${stride} finite values`);
    }
    return row;
  });
  return rows;
}

export function selectSupportEnvelopeRows(splatRows, candidateRows, budget, selectorName) {
  const splats = finiteRows(splatRows, 12, 'support envelope splat');
  const candidates = finiteRows(candidateRows, 16, 'support envelope candidate');
  if (splats.length !== candidates.length) throw new Error('support envelope splat/candidate rows must align');
  if (!Number.isInteger(budget) || budget <= 0 || budget > splats.length) throw new Error('support envelope budget is outside input support');
  const selector = SUPPORT_ENVELOPE_SELECTORS[selectorName];
  if (!selector) throw new Error('support envelope selector mismatch');
  const ranked = splats.map((splat, index) => {
    const score = Number(selector(splat, candidates[index]));
    if (!Number.isFinite(score)) throw new Error(`support envelope selector ${selectorName} produced non-finite score`);
    return { index, score, key: worldPositionStableKey(splat) };
  });
  ranked.sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  const selected = ranked.slice(0, budget);
  const indices = new Set(selected.map(row => row.index));
  return {
    rows: splats.filter((_, index) => indices.has(index)),
    accounting: {
      authority: 'deterministic-state-local-support-envelope-selection-v0',
      selector: selectorName,
      inputCount: splats.length,
      budget,
      selectedCount: selected.length,
      droppedCount: splats.length - selected.length,
      scoreMinimum: Math.min(...selected.map(row => row.score)),
      scoreMaximum: Math.max(...selected.map(row => row.score)),
    },
  };
}

async function loadArtifactRows(artifact, stride, label, expectedAuthority = null) {
  if (
    artifact?.dtype !== 'float32-le'
    || artifact?.strideFloats !== stride
    || !Number.isInteger(artifact?.count)
    || artifact.count <= 0
    || (expectedAuthority && artifact.authority !== expectedAuthority)
  ) throw new Error(`${label} artifact contract mismatch`);
  const path = resolve(String(artifact.path));
  const bytes = await readFile(path);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) throw new Error(`${label} artifact byte/hash mismatch`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (values.length !== artifact.count * stride) throw new Error(`${label} artifact count mismatch`);
  return Array.from({ length: artifact.count }, (_, index) => Array.from(values.subarray(index * stride, (index + 1) * stride)));
}

function renderMetrics(rendered, exactRgba) {
  if (rendered.rgba.length !== exactRgba.length) throw new Error('support envelope raster dimensions mismatch');
  let squared = 0;
  let saturated = 0;
  let white = 0;
  for (let index = 0; index < rendered.rgba.length; index += 4) {
    const red = rendered.rgba[index];
    const green = rendered.rgba[index + 1];
    const blue = rendered.rgba[index + 2];
    if (Math.max(red, green, blue) === 255) saturated += 1;
    if (red >= 250 && green >= 250 && blue >= 250) white += 1;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = rendered.rgba[index + channel] - exactRgba[index + channel];
      squared += delta * delta;
    }
  }
  const pixels = rendered.width * rendered.height;
  return {
    mse: squared / (pixels * 3),
    saturatedPixelFraction: saturated / pixels,
    whitePixelFraction: white / pixels,
    nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
    projectedSplatCount: rendered.projectedSplatCount,
  };
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${label} failed ${result.status}: ${String(result.stderr || result.stdout).slice(-3000)}`);
  return result;
}

function probeVideo(path, ffprobe) {
  const result = run(ffprobe, [
    '-v', 'error', '-count_frames',
    '-show_entries', 'stream=width,height,r_frame_rate,nb_read_frames:format=duration',
    '-of', 'json', path,
  ], 'support envelope ffprobe');
  const document = JSON.parse(result.stdout);
  const stream = document.streams?.[0];
  const [numerator, denominator] = String(stream?.r_frame_rate).split('/').map(Number);
  return {
    width: Number(stream?.width),
    height: Number(stream?.height),
    fps: numerator / denominator,
    frameCount: Number(stream?.nb_read_frames),
    duration: Number(document.format?.duration),
  };
}

async function encodeComparison(roleDirs, path, fps, frameCount, ffmpeg, ffprobe) {
  const args = ['-y'];
  for (const directory of roleDirs) args.push('-framerate', String(fps), '-i', resolve(directory, 'frame-%03d.png'));
  const pads = roleDirs.map((_, index) => `[${index}:v]`).join('');
  args.push(
    '-filter_complex', `${pads}hstack=inputs=${roleDirs.length}[out]`,
    '-map', '[out]', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path,
  );
  run(ffmpeg, args, 'support envelope encode');
  const bytes = await readFile(path);
  const probe = probeVideo(path, ffprobe);
  if (probe.frameCount !== frameCount || Math.abs(probe.fps - fps) > 1e-9) throw new Error('support envelope encoded cadence mismatch');
  return { path, bytes: bytes.byteLength, sha256: sha256(bytes), probe, command: [ffmpeg, ...args] };
}

function mean(rows, field, start = 0) {
  const selected = rows.slice(start);
  return selected.reduce((sum, row) => sum + row[field], 0) / Math.max(1, selected.length);
}

function summarizeMetrics(frameMetrics, frameCount) {
  const lateStart = Math.max(0, frameCount - 15);
  const result = {};
  for (const [role, rows] of Object.entries(frameMetrics)) {
    result[role] = {
      allMse: mean(rows, 'mse'),
      lateMse: mean(rows, 'mse', lateStart),
      terminalMse: rows.at(-1).mse,
      allSaturatedPixelFraction: mean(rows, 'saturatedPixelFraction'),
      lateSaturatedPixelFraction: mean(rows, 'saturatedPixelFraction', lateStart),
      terminalSaturatedPixelFraction: rows.at(-1).saturatedPixelFraction,
      allWhitePixelFraction: mean(rows, 'whitePixelFraction'),
      lateWhitePixelFraction: mean(rows, 'whitePixelFraction', lateStart),
      terminalWhitePixelFraction: rows.at(-1).whitePixelFraction,
    };
  }
  for (const row of Object.values(result)) {
    row.lateMseDeltaFromPrediction = row.lateMse - result.prediction.lateMse;
    row.lateWhitePixelFractionDeltaFromPrediction = row.lateWhitePixelFraction - result.prediction.lateWhitePixelFraction;
  }
  return result;
}

function guide(report) {
  const roles = [
    ['REFERENCE', 'Exact held-out full splat state.'],
    ['FROZEN', 'Pixel-identical frame-zero present state.'],
    ['PREDICTED', 'Unmodified response-anchor recurrent support.'],
    ['CANDIDATE SUPPORT', 'Training-envelope budget ranked by protected candidate support.'],
    ['PHYSICAL SUPPORT', 'The same budget ranked by physical splat support.'],
    ['VISIBLE ENERGY', 'The same budget ranked by physical opacity-weighted RGB luminance.'],
  ];
  const rows = Object.entries(report.metrics.roles).map(([role, metric]) => `<tr><th>${role}</th><td>${metric.lateMse.toFixed(3)}</td><td>${metric.lateMseDeltaFromPrediction.toFixed(3)}</td><td>${(metric.lateWhitePixelFraction * 100).toFixed(2)}%</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Support Envelope Falsifier</title><style>body{margin:0;background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif}main{max-width:1400px;margin:auto;padding:22px}video{display:block;width:100%;background:#000;border:1px solid #444}.roles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.roles div{padding:8px;border-left:4px solid #777}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #444;text-align:right}th:first-child{text-align:left}section{margin:24px 0}</style></head><body><main><h1>Can A Training-Episode Support Envelope Remove The Sheet?</h1><p>This finite ${report.playback.encodedDurationSeconds.toFixed(2)}-second diagnostic filters already-generated recurrent states. It performs no retraining and does not regenerate recurrence. Every role is full-opacity and the sequence does not loop.</p><section><div class="roles">${roles.map(([name, text]) => `<div><strong>${name}</strong><br>${text}</div>`).join('')}</div><video controls muted playsinline src="phase-support-envelope.mp4"></video></section><section><h2>Late Fifteen Frames</h2><table><thead><tr><th>role</th><th>MSE</th><th>delta vs prediction</th><th>white pixels</th></tr></thead><tbody>${rows}</tbody></table></section><section><h2>Claim Boundary</h2><p>${report.claimBoundary}</p></section></main></body></html>`;
}

export function validateSupportEnvelopeReport(report) {
  if (report?.schema !== SCHEMA || report.status !== 'completed') throw new Error('support envelope schema/status mismatch');
  validateArtifactIdentity(report.source?.trainingManifest, 'training manifest');
  validateArtifactIdentity(report.source?.evaluationManifest, 'evaluation manifest');
  validateArtifactIdentity(report.source?.predictions, 'predictions');
  validateModelIdentity(report.source?.occupancyModel, 'occupancy model', 'kaminos-boundary-splat-phase-transport-model-v0');
  validateModelIdentity(report.source?.destinationStateModel, 'destination state model', 'kaminos-boundary-splat-phase-destination-state-model-v0');
  const destinationModel = report.source.destinationStateModel;
  validateArtifactIdentity(destinationModel.trainingManifest, 'destination state model training manifest');
  validateArtifactIdentity(destinationModel.evaluationManifest, 'destination state model evaluation manifest');
  if (
    destinationModel.trainingManifest.path !== report.source.trainingManifest.path
    || destinationModel.trainingManifest.bytes !== report.source.trainingManifest.bytes
    || destinationModel.trainingManifest.sha256 !== report.source.trainingManifest.sha256
  ) throw new Error('support envelope destination state model training identity mismatch');
  if (
    destinationModel.evaluationManifest.path !== report.source.evaluationManifest.path
    || destinationModel.evaluationManifest.bytes !== report.source.evaluationManifest.bytes
    || destinationModel.evaluationManifest.sha256 !== report.source.evaluationManifest.sha256
  ) throw new Error('support envelope destination state model evaluation identity mismatch');
  if (
    !report.source.requestedRoute
    || report.source.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
    || report.source.backend?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(report.source.backend?.device))
    || report.source.backend?.fallbackReason !== null
  ) throw new Error('support envelope backend/effective route mismatch');
  const config = report.configuration;
  if (
    config?.authority !== 'post-composition-zero-training-support-envelope-falsifier-v0'
    || config.staticAttenuation !== 1 || config.unmatchedAttenuation !== 1
    || config.frameSelection !== 'uncapped-complete-heldout-episode-v0'
    || config.requestedFrameCount !== config.effectiveFrameCount
    || JSON.stringify(config.selectors) !== JSON.stringify(Object.keys(SUPPORT_ENVELOPE_SELECTORS))
  ) throw new Error('support envelope full opacity/frame count configuration mismatch');
  if (config.retrained !== false || config.recurrenceRegenerated !== false) throw new Error('support envelope post-composition authority mismatch');
  const envelope = config.envelope;
  if (
    envelope?.authority !== 'training-episode-frame-zero-relative-support-envelope-v0'
    || !Number.isInteger(envelope.frameCount) || envelope.frameCount < 2
    || !Number.isInteger(envelope.frameZeroCount) || envelope.frameZeroCount <= 0
    || !Number.isInteger(envelope.minimumCount) || envelope.minimumCount <= 0
    || !Number.isInteger(envelope.maximumCount) || envelope.maximumCount < envelope.minimumCount
    || envelope.minimumRatio !== envelope.minimumCount / envelope.frameZeroCount
    || envelope.maximumRatio !== envelope.maximumCount / envelope.frameZeroCount
    || !Number.isInteger(config.frameZeroEvaluationCount) || config.frameZeroEvaluationCount <= 0
    || !Number.isFinite(config.oneStepMedianRatio) || config.oneStepMedianRatio <= 0
    || config.ceilingBudget !== Math.round(config.frameZeroEvaluationCount * envelope.maximumRatio)
    || config.counterfactualBudgetAtCeiling !== config.ceilingBudget
  ) throw new Error('support envelope calibration mismatch');
  const frameCount = report.playback?.frameCount;
  if (
    !Number.isInteger(frameCount) || frameCount <= 1 || frameCount !== config.effectiveFrameCount
    || report.playback.loops !== false || report.playback.effectiveFps <= 0 || report.playback.encodedDurationSeconds <= 0
  ) throw new Error('support envelope playback frame count mismatch');
  if (JSON.stringify(report.roles) !== JSON.stringify(ROLE_AUTHORITIES)) throw new Error('support envelope roles mismatch');
  for (const role of Object.keys(ROLE_AUTHORITIES)) {
    const evidence = report.roleEvidence?.[role];
    if (!Array.isArray(evidence) || evidence.length !== frameCount) throw new Error(`support envelope role evidence mismatch for ${role}`);
    if (evidence.some((frame, index) => frame.step !== index + 1)) throw new Error(`support envelope role evidence step mismatch for ${role}`);
    if (evidence.some(frame => !isSha256(frame.sha256) || frame.nonBackgroundPixelCount <= 0 || frame.projectedSplatCount <= 0)) {
      throw new Error(`support envelope blank role evidence for ${role}`);
    }
  }
  if (new Set(report.roleEvidence.prediction.map(frame => frame.sha256)).size <= 1) throw new Error('support envelope prediction is cached or static');
  const controlHashes = report.frozenControlEvidence?.map(frame => frame.sha256) ?? [];
  if (report.frozenControlEvidence?.some((frame, index) => frame.step !== index + 1)) {
    throw new Error('support envelope frozen control step mismatch');
  }
  const identity = report.frozenControlIdentity;
  if (
    controlHashes.length !== frameCount || controlHashes.some(hash => !isSha256(hash)) || new Set(controlHashes).size !== 1
    || identity?.authority !== 'pixel-identical-frozen-control-v0' || identity.frameCount !== frameCount
    || identity.uniqueFrameCount !== 1 || identity.sha256 !== controlHashes[0]
  ) throw new Error('support envelope frozen control identity mismatch');
  for (const selector of Object.keys(SUPPORT_ENVELOPE_SELECTORS)) {
    const rows = report.selectionAccounting?.[selector];
    if (!Array.isArray(rows) || rows.length !== frameCount) throw new Error(`support envelope selection accounting mismatch for ${selector}`);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const expectedBudget = Number.isInteger(row?.inputCount) && row.inputCount > 0
        ? Math.min(row.inputCount, config.ceilingBudget)
        : NaN;
      if (
        row?.step !== index + 1
        || row.ceilingBudget !== config.ceilingBudget
        || row.authority !== 'deterministic-state-local-support-envelope-selection-v0'
        || row.selector !== selector
        || row.budget !== expectedBudget
        || row.selectedCount !== row.budget
        || row.droppedCount !== row.inputCount - row.selectedCount
        || !Number.isFinite(row.scoreMinimum) || !Number.isFinite(row.scoreMaximum)
        || row.scoreMinimum > row.scoreMaximum
      ) throw new Error(`support envelope selection accounting mismatch for ${selector} step ${index + 1}`);
    }
  }
  const probe = report.artifact?.probe;
  if (
    !isSha256(report.artifact?.sha256) || report.artifact.bytes <= 0 || probe?.frameCount !== frameCount
    || probe.width <= 0 || probe.height <= 0 || probe.fps !== report.playback.effectiveFps || probe.duration <= 0
  ) throw new Error('support envelope artifact mismatch');
  if (
    report.metrics?.authority !== 'same-raster-full-frame-error-v0'
    || Object.keys(ROLE_AUTHORITIES).some(role => !Number.isFinite(report.metrics.roles?.[role]?.lateMse))
  ) throw new Error('support envelope metrics mismatch');
  const claimBoundary = String(report.claimBoundary ?? '').trim();
  if (
    !/post-composition/i.test(claimBoundary)
    || !/(?:does not regenerate recurrence|cannot prove (?:recurrent|recurrence) stability)/i.test(claimBoundary)
    || !/(?:does not[^.]*\b(?:establish|prove)[^.]*future occupancy stability|cannot prove (?:recurrent|recurrence) stability)/i.test(claimBoundary)
    || !/(?:does not[^.]*authorize runtime|cannot prove[^.]*runtime|does not[^.]*runtime integration)/i.test(claimBoundary)
    || /\b(?:this|it|evidence|result|witness) proves? (?:recurrent|recurrence) stability|authorizes? runtime integration/i.test(claimBoundary)
  ) throw new Error('support envelope claim boundary mismatch');
}

export async function writeSupportEnvelopeWitness(trainingPathValue, evaluationPathValue, predictionsPathValue, options = {}) {
  const trainingPath = resolve(trainingPathValue);
  const evaluationPath = resolve(evaluationPathValue);
  const predictionsPath = resolve(predictionsPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-phase-support-envelope');
  const reportPath = options.report ? resolve(options.report) : resolve(outDir, 'phase-support-envelope-witness.json');
  const width = Math.max(32, Math.floor(Number(options.width ?? 320)));
  const height = Math.max(32, Math.floor(Number(options.height ?? 240)));
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { trainingPath, evaluationPath, predictionsPath, outDir };
  await mkdir(outDir, { recursive: true });
  try {
    failurePhase = 'source-validation';
    const [trainingBytes, evaluationBytes, predictionsBytes] = await Promise.all([
      readFile(trainingPath), readFile(evaluationPath), readFile(predictionsPath),
    ]);
    const training = JSON.parse(trainingBytes.toString('utf8'));
    const evaluation = JSON.parse(evaluationBytes.toString('utf8'));
    const predictions = JSON.parse(predictionsBytes.toString('utf8'));
    if (
      training.schema !== CORPUS_SCHEMA || evaluation.schema !== CORPUS_SCHEMA
      || training.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
      || evaluation.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
    ) throw new Error('support envelope corpus schema/effective route mismatch');
    if (predictions.schema !== PREDICTION_SCHEMA || predictions.status !== 'completed') throw new Error('support envelope prediction schema/status mismatch');
    if (
      predictions.route?.backend !== 'mlx'
      || !/^Device\(gpu,\s*\d+\)$/i.test(String(predictions.route?.device))
      || predictions.route.fallbackReason !== null
    ) throw new Error('support envelope prediction backend mismatch');
    if (predictions.manifest?.sha256 !== sha256(evaluationBytes)) throw new Error('support envelope stale evaluation prediction identity');
    const modelBytes = await readFile(resolve(predictions.model.path));
    if (sha256(modelBytes) !== predictions.model.sha256) throw new Error('support envelope occupancy model hash mismatch');
    const model = JSON.parse(modelBytes.toString('utf8'));
    const oneStepRatio = Number(model.calibration?.targetSupport?.medianRatio);
    if (!Number.isFinite(oneStepRatio) || oneStepRatio <= 0) throw new Error('support envelope one-step count calibration mismatch');
    const envelope = calibrateSupportCountEnvelope(training.frames.map(frame => frame.splats.count));
    const referenceIds = predictions.temporal?.heldoutReferenceFrameIds;
    const evaluationById = new Map(evaluation.frames.map(frame => [frame.id, frame]));
    const references = referenceIds?.map(id => evaluationById.get(id));
    if (!Array.isArray(references) || references.length < 3 || references.some(frame => !frame)) throw new Error('support envelope heldout episode incomplete');
    if (predictions.frames?.length !== references.length || predictions.frames.some((frame, index) => frame.referenceFrameId !== referenceIds[index])) {
      throw new Error('support envelope prediction/reference order mismatch');
    }
    const cadenceMs = Number(predictions.temporal.controlledStepDeltaMs);
    if (!Number.isFinite(cadenceMs) || cadenceMs <= 0 || references.some(frame => frame.controlledStepDeltaMs !== cadenceMs)) {
      throw new Error('support envelope temporal cadence mismatch');
    }
    const frameCount = references.length - 1;
    const fps = 1000 / cadenceMs;
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      trainingSha256: sha256(trainingBytes), evaluationSha256: sha256(evaluationBytes), predictionsSha256: sha256(predictionsBytes),
      occupancyModelSha256: predictions.model.sha256, effectiveRoute: evaluation.effectiveRoute, effectiveBackend: predictions.route,
      frameCount, fps, envelope, oneStepRatio,
    };

    failurePhase = 'artifact-validation';
    const frozenRows = await loadArtifactRows(references[0].splats, 12, 'frozen frame zero', REFERENCE_AUTHORITY);
    const frameZeroCount = frozenRows.length;
    const ceilingBudget = Math.round(frameZeroCount * envelope.maximumRatio);
    const roleOrder = ['reference', 'frozen', ...Object.keys(ROLE_AUTHORITIES)];
    const labels = ['REFERENCE', 'FROZEN', 'PREDICTED', 'CANDIDATE SUPPORT', 'PHYSICAL SUPPORT', 'VISIBLE ENERGY'];
    const roleEvidence = Object.fromEntries(Object.keys(ROLE_AUTHORITIES).map(role => [role, []]));
    const frozenControlEvidence = [];
    const frameMetrics = Object.fromEntries(['frozen', ...Object.keys(ROLE_AUTHORITIES)].map(role => [role, []]));
    const selectionAccounting = Object.fromEntries(Object.keys(SUPPORT_ENVELOPE_SELECTORS).map(role => [role, []]));
    for (const role of roleOrder) await mkdir(resolve(outDir, 'frames', role), { recursive: true });
    const camera = references[0].camera;
    const renderOptions = { width, height, radiusMultiplier: 1, kernelSharpness: 6.5 };

    failurePhase = 'support-envelope-raster';
    for (let step = 1; step < references.length; step += 1) {
      const [exactRows, predictedRows, candidateRows] = await Promise.all([
        loadArtifactRows(references[step].splats, 12, `exact step ${step}`, REFERENCE_AUTHORITY),
        loadArtifactRows(predictions.frames[step].splats, 12, `prediction splat step ${step}`, PREDICTION_AUTHORITY),
        loadArtifactRows(predictions.frames[step].candidates, 16, `prediction candidate step ${step}`),
      ]);
      if (predictedRows.length !== candidateRows.length) throw new Error(`prediction splat/candidate count mismatch at step ${step}`);
      const budget = Math.min(predictedRows.length, ceilingBudget);
      const selected = Object.fromEntries(Object.keys(SUPPORT_ENVELOPE_SELECTORS).map(selector => [
        selector, selectSupportEnvelopeRows(predictedRows, candidateRows, budget, selector),
      ]));
      const rowsByRole = {
        reference: exactRows,
        frozen: frozenRows,
        prediction: predictedRows,
        ...Object.fromEntries(Object.entries(selected).map(([role, value]) => [role, value.rows])),
      };
      const exactRender = renderBoundarySplatRowsPng(exactRows, camera, renderOptions);
      if (exactRender.nonBackgroundPixelCount <= 0 || exactRender.projectedSplatCount <= 0) throw new Error(`exact step ${step} is blank`);
      const frameIndex = step - 1;
      for (const [roleIndex, role] of roleOrder.entries()) {
        const rendered = role === 'reference' ? exactRender : renderBoundarySplatRowsPng(rowsByRole[role], camera, renderOptions);
        if (rendered.nonBackgroundPixelCount <= 0 || rendered.projectedSplatCount <= 0) throw new Error(`${role} step ${step} is blank`);
        const png = addBitmapLabel(rendered, labels[roleIndex]);
        await writeFile(resolve(outDir, 'frames', role, `frame-${String(frameIndex).padStart(3, '0')}.png`), png);
        const evidence = {
          step, sha256: sha256(png), inputSplatCount: rendered.inputSplatCount,
          projectedSplatCount: rendered.projectedSplatCount, nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
        };
        if (role === 'frozen') frozenControlEvidence.push(evidence);
        else if (role !== 'reference') roleEvidence[role].push(evidence);
        if (role !== 'reference') frameMetrics[role].push(renderMetrics(rendered, exactRender.rgba));
      }
      for (const [selector, value] of Object.entries(selected)) {
        selectionAccounting[selector].push({ step, ceilingBudget, ...value.accounting });
      }
    }

    const controlHashes = frozenControlEvidence.map(frame => frame.sha256);
    const frozenControlIdentity = {
      authority: 'pixel-identical-frozen-control-v0', frameCount,
      uniqueFrameCount: new Set(controlHashes).size, sha256: controlHashes[0],
    };
    failurePhase = 'video-encode';
    const artifact = await encodeComparison(
      roleOrder.map(role => resolve(outDir, 'frames', role)), resolve(outDir, 'phase-support-envelope.mp4'),
      fps, frameCount, ffmpeg, ffprobe,
    );
    const metrics = summarizeMetrics(frameMetrics, frameCount);
    failurePhase = 'report-write';
    const report = {
      schema: SCHEMA,
      status: 'completed',
      source: {
        trainingManifest: { path: trainingPath, bytes: trainingBytes.byteLength, sha256: sha256(trainingBytes) },
        evaluationManifest: { path: evaluationPath, bytes: evaluationBytes.byteLength, sha256: sha256(evaluationBytes) },
        predictions: { path: predictionsPath, bytes: predictionsBytes.byteLength, sha256: sha256(predictionsBytes) },
        occupancyModel: predictions.model,
        destinationStateModel: predictions.destinationStateModel,
        requestedRoute: evaluation.requestedRoute,
        effectiveRoute: evaluation.effectiveRoute,
        backend: predictions.route,
      },
      configuration: {
        authority: 'post-composition-zero-training-support-envelope-falsifier-v0',
        requestedFrameCount: frameCount, effectiveFrameCount: frameCount,
        frameSelection: 'uncapped-complete-heldout-episode-v0',
        staticAttenuation: 1, unmatchedAttenuation: 1,
        envelope, selectors: Object.keys(SUPPORT_ENVELOPE_SELECTORS),
        frameZeroEvaluationCount: frameZeroCount, ceilingBudget,
        oneStepMedianRatio: oneStepRatio,
        counterfactualBudgetAtCeiling: supportEnvelopeBudget(frameZeroCount, ceilingBudget, oneStepRatio, envelope),
        retrained: false, recurrenceRegenerated: false,
      },
      playback: {
        authority: 'finite-complete-heldout-post-composition-support-envelope-sequence-v0',
        frameCount, controlledStepDeltaMs: cadenceMs, effectiveFps: artifact.probe.fps,
        encodedDurationSeconds: artifact.probe.duration, loops: false,
      },
      roles: ROLE_AUTHORITIES,
      roleEvidence,
      frozenControlEvidence,
      frozenControlIdentity,
      selectionAccounting,
      artifact,
      metrics: {
        authority: 'same-raster-full-frame-error-v0',
        lateWindow: { firstStep: Math.max(1, frameCount - 14), lastStep: frameCount },
        roles: metrics,
      },
      claimBoundary: 'This is a zero-training post-composition falsifier over already-generated recurrent states. It tests whether count-bounded state-local selection can remove the visible sheet, but it does not regenerate recurrence, establish future occupancy stability, prove analytical-raymarch agreement, or authorize runtime composition.',
    };
    validateSupportEnvelopeReport(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outDir, 'inspection-guide.html'), guide(report));
    return report;
  } catch (error) {
    const failure = {
      schema: SCHEMA, status: 'failed', failurePhase,
      error: error?.stack || error?.message || String(error), lastTrustworthyEvidence,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.get('--training-manifest') || !args.get('--evaluation-manifest') || !args.get('--predictions')) {
    console.error('Usage: node boundary-splat-phase-support-envelope-witness.mjs --training-manifest <phase-corpus.json> --evaluation-manifest <phase-corpus.json> --predictions <transport-predictions.json> --out-dir <dir>');
    process.exitCode = 2;
  } else {
    try {
      const report = await writeSupportEnvelopeWitness(
        args.get('--training-manifest'), args.get('--evaluation-manifest'), args.get('--predictions'), {
          outDir: args.get('--out-dir'), report: args.get('--report'), width: args.get('--width'), height: args.get('--height'),
          ffmpeg: args.get('--ffmpeg'), ffprobe: args.get('--ffprobe'),
        },
      );
      console.log(JSON.stringify({ schema: report.schema, status: report.status, frameCount: report.playback.frameCount }, null, 2));
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
