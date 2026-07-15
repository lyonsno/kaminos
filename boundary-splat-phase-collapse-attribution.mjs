#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  renderBoundarySplatRowsPng,
  worldPositionStableKey,
} from './boundary-splat-phase-render-witness.mjs';
import { addBitmapLabel } from './boundary-splat-moving-phase-witness.mjs';

const SCHEMA = 'kaminos-boundary-splat-phase-collapse-attribution-v0';
const CORPUS_SCHEMA = 'kaminos-boundary-splat-phase-candidate-corpus-v0';
const PREDICTION_SCHEMA = 'kaminos-boundary-splat-phase-transport-predictions-v0';
const REFERENCE_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
const PREDICTION_AUTHORITY = 'learned-local-grid-transport-plus-residual-churn-v0';

export const PHYSICAL_SPLAT_CHANNELS = Object.freeze({
  support: Object.freeze([3]),
  color: Object.freeze([4, 5, 6]),
  opacity: Object.freeze([7]),
  shape: Object.freeze([8, 9]),
  diagnostics: Object.freeze([10, 11]),
});

const VISIBLE_FAMILIES = Object.freeze(['color', 'opacity', 'shape']);
const VARIANT_AUTHORITIES = Object.freeze({
  prediction: 'learned-recurrent-full-splat-state-v0',
  exactSupportPredictedVisible: 'exact-support-with-position-matched-predicted-visible-state-v0',
  predictedSupportExactVisible: 'predicted-support-with-position-matched-exact-visible-state-v0',
  exactColorOnPredictedSupport: 'predicted-support-with-position-matched-exact-color-v0',
  exactOpacityOnPredictedSupport: 'predicted-support-with-position-matched-exact-opacity-v0',
  exactShapeOnPredictedSupport: 'predicted-support-with-position-matched-exact-shape-v0',
  frozenVisibleOnPredictedSupport: 'predicted-support-with-position-matched-frozen-visible-state-v0',
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

function finiteRow(value, label) {
  const result = Array.from(value);
  if (result.length !== 12 || result.some(channel => !Number.isFinite(channel))) {
    throw new Error(`${label} must be one finite physical stride-12 splat row`);
  }
  return result;
}

export function visibleSplatEnergy(value) {
  const row = finiteRow(value, 'visible energy row');
  const luminance = row[4] * 0.2126 + row[5] * 0.7152 + row[6] * 0.0722;
  return Math.max(row[7], 0) * Math.max(luminance, 0);
}

function rowsByWorldPosition(rows, label) {
  const result = new Map();
  for (const [index, value] of rows.entries()) {
    const row = finiteRow(value, `${label} row ${index}`);
    const key = worldPositionStableKey(row);
    if (result.has(key)) throw new Error(`${label} contains duplicate world-position key ${key}`);
    result.set(key, row);
  }
  return result;
}

export function substituteMatchedChannels(recipientRows, donorRows, channelFamilies, options = {}) {
  const families = Array.from(channelFamilies ?? []);
  if (!families.length || families.some(family => !(family in PHYSICAL_SPLAT_CHANNELS))) {
    throw new Error('channel substitution requires known physical channel families');
  }
  const recipients = Array.from(recipientRows, (value, index) => finiteRow(value, `recipient row ${index}`));
  const donors = Array.from(donorRows, (value, index) => finiteRow(value, `donor row ${index}`));
  const donorByKey = rowsByWorldPosition(donors, 'donor');
  let matchedCount = 0;
  const usedDonors = new Set();
  const rows = recipients.map(recipient => {
    const key = worldPositionStableKey(recipient);
    const donor = donorByKey.get(key);
    if (!donor) return Array.from(recipient);
    matchedCount += 1;
    usedDonors.add(key);
    const result = Array.from(recipient);
    for (const family of families) {
      for (const channel of PHYSICAL_SPLAT_CHANNELS[family]) result[channel] = donor[channel];
    }
    return result;
  });
  return {
    rows,
    accounting: {
      authority: 'world-position-exact-channel-substitution-v0',
      donorRole: String(options.donorRole ?? 'donor'),
      channelFamilies: families,
      recipientCount: recipients.length,
      donorCount: donors.length,
      matchedCount,
      unmatchedRecipientCount: recipients.length - matchedCount,
      unusedDonorCount: donors.length - usedDonors.size,
    },
  };
}

function variant(authority, substitution) {
  return { authority, rows: substitution.rows, accounting: substitution.accounting };
}

export function buildCollapseAttributionVariants(predictedRows, exactRows, frozenRows) {
  const predicted = Array.from(predictedRows, value => finiteRow(value, 'prediction row'));
  const exact = Array.from(exactRows, value => finiteRow(value, 'exact row'));
  const frozen = Array.from(frozenRows, value => finiteRow(value, 'frozen row'));
  return {
    prediction: {
      authority: VARIANT_AUTHORITIES.prediction,
      rows: predicted.map(value => Array.from(value)),
      accounting: {
        authority: 'unmodified-learned-recurrent-state-v0',
        recipientCount: predicted.length,
      },
    },
    exactSupportPredictedVisible: variant(
      VARIANT_AUTHORITIES.exactSupportPredictedVisible,
      substituteMatchedChannels(exact, predicted, VISIBLE_FAMILIES, { donorRole: 'prediction' }),
    ),
    predictedSupportExactVisible: variant(
      VARIANT_AUTHORITIES.predictedSupportExactVisible,
      substituteMatchedChannels(predicted, exact, VISIBLE_FAMILIES, { donorRole: 'exact-target' }),
    ),
    exactColorOnPredictedSupport: variant(
      VARIANT_AUTHORITIES.exactColorOnPredictedSupport,
      substituteMatchedChannels(predicted, exact, ['color'], { donorRole: 'exact-target' }),
    ),
    exactOpacityOnPredictedSupport: variant(
      VARIANT_AUTHORITIES.exactOpacityOnPredictedSupport,
      substituteMatchedChannels(predicted, exact, ['opacity'], { donorRole: 'exact-target' }),
    ),
    exactShapeOnPredictedSupport: variant(
      VARIANT_AUTHORITIES.exactShapeOnPredictedSupport,
      substituteMatchedChannels(predicted, exact, ['shape'], { donorRole: 'exact-target' }),
    ),
    frozenVisibleOnPredictedSupport: variant(
      VARIANT_AUTHORITIES.frozenVisibleOnPredictedSupport,
      substituteMatchedChannels(predicted, frozen, VISIBLE_FAMILIES, { donorRole: 'frozen-present' }),
    ),
  };
}

async function loadRows(artifact, label, expectedAuthority = null) {
  if (
    artifact?.dtype !== 'float32-le'
    || artifact?.strideFloats !== 12
    || !Number.isInteger(artifact?.count)
    || artifact.count <= 0
    || (expectedAuthority && artifact.authority !== expectedAuthority)
  ) throw new Error(`${label} artifact contract mismatch`);
  const path = resolve(String(artifact.path));
  const bytes = await readFile(path);
  if (bytes.byteLength !== artifact.bytes || sha256(bytes) !== artifact.sha256) {
    throw new Error(`${label} artifact byte/hash mismatch`);
  }
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
  if (values.length !== artifact.count * 12) throw new Error(`${label} artifact count mismatch`);
  return Array.from({ length: artifact.count }, (_, index) => (
    Array.from(values.subarray(index * 12, (index + 1) * 12))
  ));
}

function renderMetrics(rendered, exactRgba = null) {
  let saturatedPixelCount = 0;
  let whitePixelCount = 0;
  for (let index = 0; index < rendered.rgba.length; index += 4) {
    const red = rendered.rgba[index];
    const green = rendered.rgba[index + 1];
    const blue = rendered.rgba[index + 2];
    if (Math.max(red, green, blue) === 255) saturatedPixelCount += 1;
    if (red >= 250 && green >= 250 && blue >= 250) whitePixelCount += 1;
  }
  let mse = null;
  if (exactRgba) {
    if (exactRgba.length !== rendered.rgba.length) throw new Error('same-raster comparison dimensions mismatch');
    let squared = 0;
    for (let index = 0; index < rendered.rgba.length; index += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = rendered.rgba[index + channel] - exactRgba[index + channel];
        squared += delta * delta;
      }
    }
    mse = squared / (rendered.width * rendered.height * 3);
  }
  return {
    mse,
    saturatedPixelCount,
    saturatedPixelFraction: saturatedPixelCount / (rendered.width * rendered.height),
    whitePixelCount,
    whitePixelFraction: whitePixelCount / (rendered.width * rendered.height),
    nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
    projectedSplatCount: rendered.projectedSplatCount,
    maxLuminance: rendered.maxLuminance,
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
  ], 'phase collapse attribution ffprobe');
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

async function encodeComparison(roleDirs, outputPath, fps, frameCount, ffmpeg, ffprobe) {
  const args = ['-y'];
  for (const directory of roleDirs) args.push('-framerate', String(fps), '-i', resolve(directory, 'frame-%03d.png'));
  const pads = roleDirs.map((_, index) => `[${index}:v]`).join('');
  args.push(
    '-filter_complex', `${pads}hstack=inputs=${roleDirs.length}[out]`,
    '-map', '[out]', '-frames:v', String(frameCount),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    outputPath,
  );
  run(ffmpeg, args, 'phase collapse attribution encode');
  const bytes = await readFile(outputPath);
  const probe = probeVideo(outputPath, ffprobe);
  if (probe.frameCount !== frameCount || Math.abs(probe.fps - fps) > 1e-9) {
    throw new Error('phase collapse attribution encoded frame count/cadence mismatch');
  }
  return { path: outputPath, bytes: bytes.byteLength, sha256: sha256(bytes), probe, command: [ffmpeg, ...args] };
}

function mean(rows, selector) {
  return rows.reduce((sum, row) => sum + selector(row), 0) / Math.max(1, rows.length);
}

function summarizeMetrics(frameMetrics, frameCount) {
  const lateStart = Math.max(0, frameCount - 15);
  const result = {};
  for (const [role, rows] of Object.entries(frameMetrics)) {
    result[role] = {
      allMse: mean(rows, row => row.mse ?? 0),
      lateMse: mean(rows.slice(lateStart), row => row.mse ?? 0),
      terminalMse: rows.at(-1)?.mse ?? null,
      allSaturatedPixelFraction: mean(rows, row => row.saturatedPixelFraction),
      lateSaturatedPixelFraction: mean(rows.slice(lateStart), row => row.saturatedPixelFraction),
      terminalSaturatedPixelFraction: rows.at(-1)?.saturatedPixelFraction ?? null,
      allWhitePixelFraction: mean(rows, row => row.whitePixelFraction),
      lateWhitePixelFraction: mean(rows.slice(lateStart), row => row.whitePixelFraction),
      terminalWhitePixelFraction: rows.at(-1)?.whitePixelFraction ?? null,
    };
  }
  const baseline = result.prediction;
  for (const [role, row] of Object.entries(result)) {
    row.lateMseDeltaFromPrediction = row.lateMse - baseline.lateMse;
    row.lateSaturatedPixelFractionDeltaFromPrediction = row.lateSaturatedPixelFraction - baseline.lateSaturatedPixelFraction;
    row.lateWhitePixelFractionDeltaFromPrediction = row.lateWhitePixelFraction - baseline.lateWhitePixelFraction;
  }
  return result;
}

function guide(report) {
  const labels = [
    ['REFERENCE', 'Exact held-out full splat state at each time.'],
    ['FROZEN', 'One frame-zero present state, pixel-identical at every time.'],
    ['PREDICTED', 'Unmodified response-anchor recurrent state.'],
    ['EXACT SUPPORT', 'Exact target support; matched sites retain predicted color, opacity, and shape.'],
    ['EXACT VISIBLE', 'Predicted support; matched sites receive exact target color, opacity, and shape.'],
    ['EXACT COLOR', 'Predicted support and state except exact target RGB on matched sites.'],
    ['EXACT OPACITY', 'Predicted support and state except exact target opacity on matched sites.'],
    ['EXACT SHAPE', 'Predicted support and state except exact target shape.xy on matched sites.'],
    ['FROZEN VISIBLE', 'Predicted support; retained frame-zero sites receive frozen color, opacity, and shape.'],
  ];
  const metricRows = Object.entries(report.metrics.roles).map(([role, row]) => (
    `<tr><th>${role}</th><td>${row.lateMse.toFixed(3)}</td><td>${row.lateMseDeltaFromPrediction.toFixed(3)}</td><td>${(row.lateSaturatedPixelFraction * 100).toFixed(2)}%</td><td>${(row.lateWhitePixelFraction * 100).toFixed(2)}%</td></tr>`
  )).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Phase Collapse Attribution</title><style>body{margin:0;background:#111;color:#eee;font:14px/1.45 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:22px}video{display:block;width:100%;background:#000;border:1px solid #444}section{margin:24px 0}.roles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}.roles div{padding:8px;border-left:4px solid #777}table{width:100%;border-collapse:collapse}th,td{padding:7px;border-bottom:1px solid #444;text-align:right}th:first-child{text-align:left}code{color:#9ee7ff}</style></head><body><main><h1>What Carries The White-Sheet Collapse?</h1><p>This finite ${report.playback.encodedDurationSeconds.toFixed(2)}-second sequence performs causal offline substitutions on the same 63 response-anchor recurrent states. Every panel uses full opacity with no exact-cohort visibility mask. Oracle substitutions are diagnosis only, not deployable predictions.</p><section><h2>Nine Fixed Roles, Left To Right</h2><div class="roles">${labels.map(([name, description]) => `<div><strong>${name}</strong><br>${description}</div>`).join('')}</div><video controls muted playsinline src="phase-collapse-attribution.mp4"></video></section><section><h2>Late Fifteen Frames</h2><table><thead><tr><th>role</th><th>MSE</th><th>delta vs prediction</th><th>saturated pixels</th><th>white pixels</th></tr></thead><tbody>${metricRows}</tbody></table></section><section><h2>Interpretation Boundary</h2><p>${report.claimBoundary}</p></section></main></body></html>`;
}

export function validateCollapseAttributionReport(report) {
  if (report?.schema !== SCHEMA || report.status !== 'completed') throw new Error('collapse attribution schema/status mismatch');
  if (!isSha256(report.source?.manifest?.sha256) || !isSha256(report.source?.predictions?.sha256)) {
    throw new Error('collapse attribution source identity mismatch');
  }
  if (
    !report.source.requestedRoute
    || report.source.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0'
    || report.source.backend?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(report.source.backend?.device))
    || report.source.backend?.fallbackReason !== null
  ) throw new Error('collapse attribution backend/effective route mismatch');
  const config = report.configuration;
  if (
    config?.authority !== 'raw-full-opacity-physical-splat-channel-attribution-v0'
    || config.staticAttenuation !== 1
    || config.unmatchedAttenuation !== 1
    || config.frameSelection !== 'uncapped-complete-heldout-episode-v0'
    || config.requestedFrameCount !== config.effectiveFrameCount
    || JSON.stringify(config.channelFamilies) !== JSON.stringify(PHYSICAL_SPLAT_CHANNELS)
  ) throw new Error('collapse attribution full opacity/frame count configuration mismatch');
  const frameCount = report.playback?.frameCount;
  if (
    !Number.isInteger(frameCount) || frameCount <= 1
    || frameCount !== config.effectiveFrameCount
    || !Number.isFinite(report.playback.effectiveFps) || report.playback.effectiveFps <= 0
    || !Number.isFinite(report.playback.encodedDurationSeconds) || report.playback.encodedDurationSeconds <= 0
    || report.playback.loops !== false
  ) throw new Error('collapse attribution playback frame count mismatch');
  if (JSON.stringify(report.roles) !== JSON.stringify(VARIANT_AUTHORITIES)) throw new Error('collapse attribution roles mismatch');
  for (const role of Object.keys(VARIANT_AUTHORITIES)) {
    const evidence = report.roleEvidence?.[role];
    if (!Array.isArray(evidence) || evidence.length !== frameCount) throw new Error(`collapse attribution role evidence mismatch for ${role}`);
    if (evidence.some(frame => !isSha256(frame.sha256) || frame.nonBackgroundPixelCount <= 0 || frame.projectedSplatCount <= 0)) {
      throw new Error(`collapse attribution blank role evidence for ${role}`);
    }
  }
  if (new Set(report.roleEvidence.prediction.map(frame => frame.sha256)).size <= 1) {
    throw new Error('collapse attribution prediction is cached or static');
  }
  const control = report.frozenControlEvidence;
  const identity = report.frozenControlIdentity;
  const controlHashes = Array.isArray(control) ? control.map(frame => frame.sha256) : [];
  if (
    controlHashes.length !== frameCount
    || controlHashes.some(hash => !isSha256(hash))
    || new Set(controlHashes).size !== 1
    || identity?.authority !== 'pixel-identical-frozen-control-v0'
    || identity.frameCount !== frameCount
    || identity.uniqueFrameCount !== 1
    || identity.sha256 !== controlHashes[0]
  ) throw new Error('collapse attribution frozen control identity mismatch');
  const probe = report.artifact?.probe;
  if (
    !isSha256(report.artifact?.sha256) || report.artifact.bytes <= 0
    || probe?.frameCount !== frameCount || probe.width <= 0 || probe.height <= 0
    || probe.fps !== report.playback.effectiveFps || probe.duration <= 0
  ) throw new Error('collapse attribution artifact mismatch');
  if (
    report.metrics?.authority !== 'same-raster-full-frame-error-v0'
    || Object.keys(VARIANT_AUTHORITIES).some(role => !Number.isFinite(report.metrics.roles?.[role]?.lateMse))
  ) throw new Error('collapse attribution metrics mismatch');
}

export async function writeCollapseAttribution(manifestPathValue, predictionsPathValue, options = {}) {
  const manifestPath = resolve(manifestPathValue);
  const predictionsPath = resolve(predictionsPathValue);
  const outDir = resolve(options.outDir ?? '/tmp/kaminos-phase-collapse-attribution');
  const reportPath = options.report ? resolve(options.report) : resolve(outDir, 'phase-collapse-attribution.json');
  const width = Math.max(32, Math.floor(Number(options.width ?? 320)));
  const height = Math.max(32, Math.floor(Number(options.height ?? 240)));
  const ffmpeg = String(options.ffmpeg ?? 'ffmpeg');
  const ffprobe = String(options.ffprobe ?? 'ffprobe');
  let failurePhase = 'argument-validation';
  let lastTrustworthyEvidence = { manifestPath, predictionsPath, outDir };
  await mkdir(outDir, { recursive: true });
  try {
    failurePhase = 'source-validation';
    const [manifestBytes, predictionsBytes] = await Promise.all([readFile(manifestPath), readFile(predictionsPath)]);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const predictions = JSON.parse(predictionsBytes.toString('utf8'));
    if (manifest.schema !== CORPUS_SCHEMA || manifest.effectiveRoute !== 'native-3d-compute-fluid-raymarch-v0') {
      throw new Error('collapse attribution corpus schema/effective route mismatch');
    }
    if (predictions.schema !== PREDICTION_SCHEMA || predictions.status !== 'completed') {
      throw new Error('collapse attribution prediction schema/status mismatch');
    }
    if (
      predictions.route?.backend !== 'mlx'
      || !/^Device\(gpu,\s*\d+\)$/i.test(String(predictions.route?.device))
      || predictions.route.fallbackReason !== null
    ) throw new Error('collapse attribution prediction backend mismatch');
    if (predictions.manifest?.sha256 !== sha256(manifestBytes)) throw new Error('collapse attribution stale prediction manifest identity');
    const referenceIds = predictions.temporal?.heldoutReferenceFrameIds;
    const corpusById = new Map(manifest.frames?.map(frame => [frame.id, frame]));
    const references = referenceIds?.map(id => corpusById.get(id));
    if (!Array.isArray(references) || references.length < 3 || references.some(frame => !frame)) {
      throw new Error('collapse attribution heldout reference episode is incomplete');
    }
    if (
      predictions.frames?.length !== references.length
      || predictions.frames.some((frame, index) => frame.referenceFrameId !== referenceIds[index])
    ) throw new Error('collapse attribution prediction/reference order mismatch');
    const cadenceMs = Number(predictions.temporal?.controlledStepDeltaMs);
    if (!Number.isFinite(cadenceMs) || cadenceMs <= 0 || references.some(frame => frame.controlledStepDeltaMs !== cadenceMs)) {
      throw new Error('collapse attribution temporal cadence mismatch');
    }
    const frameCount = references.length - 1;
    const fps = 1000 / cadenceMs;
    lastTrustworthyEvidence = {
      ...lastTrustworthyEvidence,
      manifestSha256: sha256(manifestBytes),
      predictionsSha256: sha256(predictionsBytes),
      effectiveRoute: manifest.effectiveRoute,
      effectiveBackend: predictions.route,
      frameCount,
      fps,
    };

    failurePhase = 'artifact-validation';
    const frozenRows = await loadRows(references[0].splats, 'frozen frame zero', REFERENCE_AUTHORITY);
    const roleOrder = ['reference', 'frozen', ...Object.keys(VARIANT_AUTHORITIES)];
    const labels = ['REFERENCE', 'FROZEN', 'PREDICTED', 'EXACT SUPPORT', 'EXACT VISIBLE', 'EXACT COLOR', 'EXACT OPACITY', 'EXACT SHAPE', 'FROZEN VISIBLE'];
    const roleEvidence = Object.fromEntries(Object.keys(VARIANT_AUTHORITIES).map(role => [role, []]));
    const frozenControlEvidence = [];
    const frameMetrics = Object.fromEntries(['frozen', ...Object.keys(VARIANT_AUTHORITIES)].map(role => [role, []]));
    const substitutionAccounting = Object.fromEntries(Object.keys(VARIANT_AUTHORITIES).map(role => [role, []]));
    for (const role of roleOrder) await mkdir(resolve(outDir, 'frames', role), { recursive: true });
    const renderOptions = { width, height, radiusMultiplier: 1, kernelSharpness: 6.5 };
    const camera = references[0].camera;

    failurePhase = 'causal-raster';
    for (let step = 1; step < references.length; step += 1) {
      const [exactRows, predictedRows] = await Promise.all([
        loadRows(references[step].splats, `exact step ${step}`, REFERENCE_AUTHORITY),
        loadRows(predictions.frames[step].splats, `prediction step ${step}`, PREDICTION_AUTHORITY),
      ]);
      const variants = buildCollapseAttributionVariants(predictedRows, exactRows, frozenRows);
      const rowsByRole = { reference: exactRows, frozen: frozenRows, ...Object.fromEntries(Object.entries(variants).map(([key, value]) => [key, value.rows])) };
      const exactRender = renderBoundarySplatRowsPng(exactRows, camera, renderOptions);
      if (exactRender.nonBackgroundPixelCount <= 0 || exactRender.projectedSplatCount <= 0) throw new Error(`exact step ${step} is blank`);
      const frameIndex = step - 1;
      for (const [roleIndex, role] of roleOrder.entries()) {
        const rendered = role === 'reference' ? exactRender : renderBoundarySplatRowsPng(rowsByRole[role], camera, renderOptions);
        if (rendered.nonBackgroundPixelCount <= 0 || rendered.projectedSplatCount <= 0) throw new Error(`${role} step ${step} is blank`);
        const png = addBitmapLabel(rendered, labels[roleIndex]);
        const path = resolve(outDir, 'frames', role, `frame-${String(frameIndex).padStart(3, '0')}.png`);
        await writeFile(path, png);
        const evidence = {
          step,
          sha256: sha256(png),
          inputSplatCount: rendered.inputSplatCount,
          projectedSplatCount: rendered.projectedSplatCount,
          nonBackgroundPixelCount: rendered.nonBackgroundPixelCount,
          maxLuminance: rendered.maxLuminance,
        };
        if (role === 'frozen') frozenControlEvidence.push(evidence);
        else if (role !== 'reference') roleEvidence[role].push(evidence);
        if (role !== 'reference') frameMetrics[role].push(renderMetrics(rendered, exactRender.rgba));
      }
      for (const [role, value] of Object.entries(variants)) substitutionAccounting[role].push({ step, ...value.accounting });
    }

    const controlHashes = frozenControlEvidence.map(frame => frame.sha256);
    const frozenControlIdentity = {
      authority: 'pixel-identical-frozen-control-v0',
      frameCount,
      uniqueFrameCount: new Set(controlHashes).size,
      sha256: controlHashes[0],
    };
    failurePhase = 'video-encode';
    const artifact = await encodeComparison(
      roleOrder.map(role => resolve(outDir, 'frames', role)),
      resolve(outDir, 'phase-collapse-attribution.mp4'),
      fps,
      frameCount,
      ffmpeg,
      ffprobe,
    );
    const metrics = summarizeMetrics(frameMetrics, frameCount);
    failurePhase = 'report-write';
    const report = {
      schema: SCHEMA,
      status: 'completed',
      source: {
        manifest: { path: manifestPath, bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
        predictions: { path: predictionsPath, bytes: predictionsBytes.byteLength, sha256: sha256(predictionsBytes) },
        model: predictions.destinationStateModel,
        requestedRoute: manifest.requestedRoute,
        effectiveRoute: manifest.effectiveRoute,
        backend: predictions.route,
      },
      configuration: {
        authority: 'raw-full-opacity-physical-splat-channel-attribution-v0',
        requestedFrameCount: frameCount,
        effectiveFrameCount: frameCount,
        frameSelection: 'uncapped-complete-heldout-episode-v0',
        staticAttenuation: 1,
        unmatchedAttenuation: 1,
        channelFamilies: PHYSICAL_SPLAT_CHANNELS,
        physicalRowOrder: ['position.x', 'position.y', 'position.z', 'support', 'color.r', 'color.g', 'color.b', 'opacity', 'shape.x', 'shape.y', 'ridge', 'fireSignal'],
      },
      playback: {
        authority: 'finite-complete-heldout-causal-substitution-sequence-v0',
        frameCount,
        controlledStepDeltaMs: cadenceMs,
        effectiveFps: artifact.probe.fps,
        encodedDurationSeconds: artifact.probe.duration,
        loops: false,
      },
      roles: VARIANT_AUTHORITIES,
      roleEvidence,
      frozenControlEvidence,
      frozenControlIdentity,
      substitutionAccounting,
      artifact,
      metrics: {
        authority: 'same-raster-full-frame-error-v0',
        lateWindow: { firstStep: Math.max(1, frameCount - 14), lastStep: frameCount },
        roles: metrics,
      },
      knownTrainingContractMismatch: {
        authority: 'source-traced-physical-index-mismatch-v0',
        physicalVisibleEnergy: 'splat[7] * rec709(splat[4], splat[5], splat[6])',
        currentTrainerIndices: 'state[22] * rec709(state[19], state[20], state[21])',
        physicalMeaningOfCurrentTrainerIndices: 'shape.y * rec709(color.b, opacity, shape.x)',
        source: 'boundary-splat-phase-state-residual-mlx.py:visible_energy_numpy/visible_energy_mlx',
      },
      claimBoundary: 'These are target-conditioned causal substitutions under the isolated full-splat raster. They can attribute support and visible-state error in this held-out episode, but they are not deployable predictions, analytical-raymarch agreement, multi-basin evidence, or runtime authorization.',
    };
    validateCollapseAttributionReport(report);
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(resolve(outDir, 'inspection-guide.html'), guide(report));
    return report;
  } catch (error) {
    const failure = {
      schema: SCHEMA,
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    };
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(failure, null, 2)}\n`);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.get('--manifest') || !args.get('--predictions')) {
    console.error('Usage: node boundary-splat-phase-collapse-attribution.mjs --manifest <phase-corpus.json> --predictions <transport-predictions.json> --out-dir <dir>');
    process.exitCode = 2;
  } else {
    try {
      const report = await writeCollapseAttribution(args.get('--manifest'), args.get('--predictions'), {
        outDir: args.get('--out-dir'),
        report: args.get('--report'),
        width: args.get('--width'),
        height: args.get('--height'),
        ffmpeg: args.get('--ffmpeg'),
        ffprobe: args.get('--ffprobe'),
      });
      console.log(JSON.stringify({ schema: report.schema, status: report.status, frameCount: report.playback.frameCount }, null, 2));
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
