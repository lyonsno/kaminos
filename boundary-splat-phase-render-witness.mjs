#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  compileBoundarySplatAttributeModel,
  evaluateBoundarySplatAttributeModel,
} from './boundary-splat-attribute-model.mjs';

export const BOUNDARY_SPLAT_PHASE_RENDER_SCHEMA = 'kaminos-boundary-splat-phase-render-witness-v0';
export const BOUNDARY_SPLAT_CAPTURE_AUTHORITY = 'intercepted-live-boundary-splat-buffer-post-compaction-v0';
const SPLAT_STRIDE_FLOATS = 12;
const BACKGROUND = [0.004, 0.005, 0.006];

export function quotaRankedBirthOpacityScale(rawBirthProbability, calibratedPrecision) {
  if (!Number.isFinite(rawBirthProbability) || !Number.isFinite(calibratedPrecision)) {
    throw new Error('quota-ranked birth opacity requires finite probability and precision');
  }
  return Math.max(0.05, Math.min(rawBirthProbability, calibratedPrecision));
}

export function quotaRankedBirthDecision(rawBirthProbability, diagnosticThreshold, calibratedPrecision) {
  if (!Number.isFinite(diagnosticThreshold)) {
    throw new Error('quota-ranked birth decision requires a finite diagnostic threshold');
  }
  return {
    rawProbability: rawBirthProbability,
    diagnosticThreshold,
    rankingScore: rawBirthProbability - diagnosticThreshold,
    opacityScale: quotaRankedBirthOpacityScale(rawBirthProbability, calibratedPrecision),
  };
}

function finiteArray(values, length, label) {
  if (!Array.isArray(values) || values.length !== length || values.some(value => !Number.isFinite(value))) {
    throw new Error(`${label} must contain ${length} finite numbers`);
  }
  return values;
}

function normalizeSplatRows(rows, label = 'splat rows') {
  if (ArrayBuffer.isView(rows)) {
    if (rows.length % SPLAT_STRIDE_FLOATS !== 0) throw new Error(`${label} length must be divisible by ${SPLAT_STRIDE_FLOATS}`);
    return Array.from({ length: rows.length / SPLAT_STRIDE_FLOATS }, (_, index) => (
      Array.from(rows.slice(index * SPLAT_STRIDE_FLOATS, (index + 1) * SPLAT_STRIDE_FLOATS))
    ));
  }
  if (!Array.isArray(rows)) throw new Error(`${label} must be an array or typed array`);
  return rows.map((row, index) => finiteArray(Array.from(row), SPLAT_STRIDE_FLOATS, `${label} ${index}`));
}

export function worldPositionStableKey(row, precision = 6) {
  const splat = finiteArray(Array.from(row), SPLAT_STRIDE_FLOATS, 'splat row');
  return splat.slice(0, 3).map(value => value.toFixed(precision)).join(',');
}

export function alignBoundarySplatRowsByWorldPosition(sourceRows, targetRows, options = {}) {
  const source = ArrayBuffer.isView(sourceRows) ? sourceRows : normalizeSplatRows(sourceRows, 'source splat rows');
  const target = ArrayBuffer.isView(targetRows) ? targetRows : normalizeSplatRows(targetRows, 'target splat rows');
  if (ArrayBuffer.isView(source) && source.length % SPLAT_STRIDE_FLOATS !== 0) throw new Error('source splat rows length must be divisible by 12');
  if (ArrayBuffer.isView(target) && target.length % SPLAT_STRIDE_FLOATS !== 0) throw new Error('target splat rows length must be divisible by 12');
  const sourceCount = ArrayBuffer.isView(source) ? source.length / SPLAT_STRIDE_FLOATS : source.length;
  const targetCount = ArrayBuffer.isView(target) ? target.length / SPLAT_STRIDE_FLOATS : target.length;
  const sourceRow = index => ArrayBuffer.isView(source)
    ? source.subarray(index * SPLAT_STRIDE_FLOATS, (index + 1) * SPLAT_STRIDE_FLOATS)
    : source[index];
  const targetRow = index => ArrayBuffer.isView(target)
    ? target.subarray(index * SPLAT_STRIDE_FLOATS, (index + 1) * SPLAT_STRIDE_FLOATS)
    : target[index];
  const precision = Math.max(0, Math.floor(Number(options.precision ?? 6)));
  const countsOnly = options.countsOnly === true;
  const sourceByKey = new Map();
  const targetByKey = new Map();
  for (let index = 0; index < sourceCount; index += 1) {
    const key = worldPositionStableKey(sourceRow(index), precision);
    if (sourceByKey.has(key)) throw new Error(`duplicate source world-position key ${key}`);
    sourceByKey.set(key, index);
  }
  for (let index = 0; index < targetCount; index += 1) {
    const key = worldPositionStableKey(targetRow(index), precision);
    if (targetByKey.has(key)) throw new Error(`duplicate target world-position key ${key}`);
    targetByKey.set(key, index);
  }
  const matched = [];
  const deaths = [];
  const births = [];
  let matchedCount = 0;
  let birthCount = 0;
  let deathCount = 0;
  for (const [key, sourceIndex] of sourceByKey) {
    const targetIndex = targetByKey.get(key);
    if (targetIndex == null) {
      deathCount += 1;
      if (!countsOnly) deaths.push({ key, sourceIndex });
    } else {
      matchedCount += 1;
      if (!countsOnly) matched.push({ key, sourceIndex, targetIndex });
    }
  }
  for (const [key, targetIndex] of targetByKey) {
    if (!sourceByKey.has(key)) {
      birthCount += 1;
      if (!countsOnly) births.push({ key, targetIndex });
    }
  }
  return {
    identityKey: 'world-position-stable-key',
    alignmentMethod: 'world-position-stable-key',
    precision,
    sourceCount,
    targetCount,
    matchedCount,
    birthCount,
    deathCount,
    matched,
    births,
    deaths,
  };
}

export function validateBoundarySplatPhaseRenderFrame(frame) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error('render frame must be an object');
  if (typeof frame.id !== 'string' || !frame.id) throw new Error('render frame id must be nonblank');
  if (typeof frame.requestedRoute !== 'string' || !frame.requestedRoute) throw new Error('render frame requested route must be nonblank');
  if (typeof frame.effectiveRoute !== 'string' || !frame.effectiveRoute) throw new Error('render frame effective route must be nonblank');
  if (frame.rendererIdentity !== 'live-boundary-sidecar-learned-attribute-splats-v0') {
    throw new Error('render frame must use the learned boundary splat renderer');
  }
  if (typeof frame.modelIdentity !== 'string' || !frame.modelIdentity) throw new Error('render frame model identity must be nonblank');
  if (frame.sourceAuthority !== 'live-baked-sidecar-plus-fluid-material-v0') throw new Error('render frame source authority mismatch');
  if (frame.fallbackReason != null) throw new Error(`render frame contains fallback evidence: ${frame.fallbackReason}`);
  if (!frame.camera || typeof frame.camera !== 'object') throw new Error('render frame camera is missing');
  finiteArray(frame.camera.viewProjection, 16, 'render frame camera viewProjection');
  finiteArray(frame.camera.right, 3, 'render frame camera right');
  finiteArray(frame.camera.up, 3, 'render frame camera up');
  if (!frame.splats || typeof frame.splats !== 'object') throw new Error('render frame splats artifact is missing');
  if (!Number.isInteger(frame.splats.count) || frame.splats.count <= 0) throw new Error('render frame splats must be positive-count');
  if (frame.splats.strideFloats !== SPLAT_STRIDE_FLOATS || frame.splats.dtype !== 'float32-le') {
    throw new Error('render frame splats must be float32-le stride-12 rows');
  }
  if (frame.splats.authority !== BOUNDARY_SPLAT_CAPTURE_AUTHORITY) throw new Error('render frame splat capture authority mismatch');
  return frame;
}

function transformPoint(matrix, point) {
  const [x, y, z] = point;
  const cx = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const cy = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const cz = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
  const cw = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(cw) || Math.abs(cw) < 1e-9) return null;
  return [cx / cw, cy / cw, cz / cw];
}

function addScaled(point, axis, scale) {
  return [point[0] + axis[0] * scale, point[1] + axis[1] * scale, point[2] + axis[2] * scale];
}

function screenPoint(ndc, width, height) {
  return [(ndc[0] * 0.5 + 0.5) * width, (0.5 - ndc[1] * 0.5) * height];
}

export function renderBoundarySplatRowsPng(rows, camera, options = {}) {
  const splats = normalizeSplatRows(rows);
  const width = Math.max(1, Math.floor(Number(options.width || 640)));
  const height = Math.max(1, Math.floor(Number(options.height || 480)));
  const radiusMultiplier = Math.max(0.01, Number(options.radiusMultiplier ?? 1));
  const kernelSharpness = Math.max(1, Math.min(12, Number(options.kernelSharpness ?? 6.5)));
  const viewProjection = finiteArray(camera?.viewProjection, 16, 'camera viewProjection');
  const right = finiteArray(camera?.right, 3, 'camera right');
  const up = finiteArray(camera?.up, 3, 'camera up');
  const rgb = new Float32Array(width * height * 3);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgb[pixel * 3] = BACKGROUND[0];
    rgb[pixel * 3 + 1] = BACKGROUND[1];
    rgb[pixel * 3 + 2] = BACKGROUND[2];
  }
  const energyRatio = (kernelSharpness / 3.4) / Math.max(radiusMultiplier * radiusMultiplier, 0.1225);
  const energyCompensation = Math.max(0.5, Math.min(2.5, Math.sqrt(energyRatio)));
  let projectedSplatCount = 0;
  for (const row of splats) {
    const centerWorld = row.slice(0, 3);
    const centerNdc = transformPoint(viewProjection, centerWorld);
    const rightNdc = transformPoint(viewProjection, addScaled(centerWorld, right, row[8] * radiusMultiplier));
    const upNdc = transformPoint(viewProjection, addScaled(centerWorld, up, row[9] * radiusMultiplier));
    if (!centerNdc || !rightNdc || !upNdc || centerNdc[2] < -1.5 || centerNdc[2] > 1.5) continue;
    const center = screenPoint(centerNdc, width, height);
    const rightPoint = screenPoint(rightNdc, width, height);
    const upPoint = screenPoint(upNdc, width, height);
    const axisX = [rightPoint[0] - center[0], rightPoint[1] - center[1]];
    const axisY = [upPoint[0] - center[0], upPoint[1] - center[1]];
    const determinant = axisX[0] * axisY[1] - axisX[1] * axisY[0];
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-7) continue;
    const extentX = Math.abs(axisX[0]) + Math.abs(axisY[0]);
    const extentY = Math.abs(axisX[1]) + Math.abs(axisY[1]);
    const minX = Math.max(0, Math.floor(center[0] - extentX));
    const maxX = Math.min(width - 1, Math.ceil(center[0] + extentX));
    const minY = Math.max(0, Math.floor(center[1] - extentY));
    const maxY = Math.min(height - 1, Math.ceil(center[1] + extentY));
    if (minX > maxX || minY > maxY) continue;
    projectedSplatCount += 1;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dx = x + 0.5 - center[0];
        const dy = y + 0.5 - center[1];
        const localX = (dx * axisY[1] - dy * axisY[0]) / determinant;
        const localY = (axisX[0] * dy - axisX[1] * dx) / determinant;
        const radius2 = localX * localX + localY * localY;
        if (radius2 > 1) continue;
        const alpha = Math.max(0, row[7]) * Math.exp(-radius2 * kernelSharpness) * energyCompensation;
        const pixel = (y * width + x) * 3;
        rgb[pixel] += Math.max(0, row[4]) * alpha;
        rgb[pixel + 1] += Math.max(0, row[5]) * alpha;
        rgb[pixel + 2] += Math.max(0, row[6]) * alpha;
      }
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  let nonBackgroundPixelCount = 0;
  let maxLuminance = 0;
  const backgroundLuminance = BACKGROUND[0] * 0.2126 + BACKGROUND[1] * 0.7152 + BACKGROUND[2] * 0.0722;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const r = Math.max(0, Math.min(1, rgb[pixel * 3]));
    const g = Math.max(0, Math.min(1, rgb[pixel * 3 + 1]));
    const b = Math.max(0, Math.min(1, rgb[pixel * 3 + 2]));
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    if (luminance > backgroundLuminance + 1e-5) nonBackgroundPixelCount += 1;
    maxLuminance = Math.max(maxLuminance, luminance);
    rgba[pixel * 4] = Math.round(r * 255);
    rgba[pixel * 4 + 1] = Math.round(g * 255);
    rgba[pixel * 4 + 2] = Math.round(b * 255);
    rgba[pixel * 4 + 3] = 255;
  }
  return {
    authority: 'isolated-cpu-projected-boundary-splat-raster-v0',
    png: writeRgbaPng(width, height, rgba),
    width,
    height,
    inputSplatCount: splats.length,
    projectedSplatCount,
    nonBackgroundPixelCount,
    maxLuminance,
    backgroundLuminance,
    radiusMultiplier,
    kernelSharpness,
    rgba,
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readFloatArtifact(artifact, strideFloats, baseDir, label) {
  if (!artifact || typeof artifact !== 'object') throw new Error(`${label} artifact is missing`);
  if (artifact.dtype !== 'float32-le' || artifact.strideFloats !== strideFloats || !Number.isInteger(artifact.count) || artifact.count <= 0) {
    throw new Error(`${label} artifact must be positive-count float32-le stride-${strideFloats}`);
  }
  const path = resolve(baseDir, artifact.path);
  const bytes = await readFile(path);
  const expectedBytes = artifact.count * strideFloats * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength !== expectedBytes || bytes.byteLength !== artifact.bytes) throw new Error(`${label} artifact byte length mismatch`);
  if (sha256(bytes) !== artifact.sha256) throw new Error(`${label} artifact sha256 mismatch`);
  return {
    path,
    bytes,
    values: new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    count: artifact.count,
  };
}

function featureRow(values, index) {
  return values.subarray(index * 16, (index + 1) * 16);
}

function flatRow(values, index, stride) {
  return values.subarray(index * stride, (index + 1) * stride);
}

function keyToWorldPosition(key) {
  return key.split(',').map(value => Number(value));
}

function worldKeyFromPosition(position, precision = 6) {
  return position.map(value => value.toFixed(precision)).join(',');
}

const LOCAL_GRID_NEIGHBOR_OFFSETS = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

function makeWorldFrameState(loadedFrame, precision = 6) {
  const rows = new Map();
  for (let index = 0; index < loadedFrame.splats.count; index += 1) {
    const splat = flatRow(loadedFrame.splats.values, index, SPLAT_STRIDE_FLOATS);
    const key = worldPositionStableKey(splat, precision);
    if (rows.has(key)) throw new Error(`duplicate world-position key ${key} in ${loadedFrame.frame.id}`);
    rows.set(key, {
      key,
      index,
      position: Array.from(splat.slice(0, 3)),
      candidate: featureRow(loadedFrame.candidates.values, index),
      splat,
    });
  }
  return rows;
}

function offsetWorldKey(position, offset, gridStep) {
  return worldKeyFromPosition([
    position[0] + offset[0] * gridStep,
    position[1] + offset[1] * gridStep,
    position[2] + offset[2] * gridStep,
  ]);
}

function localGridFeatureSummary(sitePosition, sourceRows, gridStep) {
  const neighborMeans = Array(16).fill(0);
  let occupiedNeighborCount = 0;
  for (const offset of LOCAL_GRID_NEIGHBOR_OFFSETS) {
    const neighbor = sourceRows.get(offsetWorldKey(sitePosition, offset, gridStep));
    if (!neighbor) continue;
    occupiedNeighborCount += 1;
    for (let feature = 0; feature < 16; feature += 1) neighborMeans[feature] += neighbor.candidate[feature];
  }
  if (occupiedNeighborCount > 0) {
    for (let feature = 0; feature < 16; feature += 1) neighborMeans[feature] /= occupiedNeighborCount;
  }
  return {
    occupiedNeighborCount,
    occupiedNeighborRatio: occupiedNeighborCount / LOCAL_GRID_NEIGHBOR_OFFSETS.length,
    neighborMeans,
  };
}

function makeSpatialOccupancyInput(sitePosition, sourceRows, offset, maxAbsOffset) {
  const key = sitePosition.map(value => value.toFixed(6)).join(',');
  const direct = sourceRows.get(key);
  const input = [1, offset / maxAbsOffset, sitePosition[0], sitePosition[1], sitePosition[2], direct ? 1 : 0];
  const sourceFeatures = direct ? Array.from(direct.candidate) : Array(16).fill(0);
  const nearestDistance = direct ? 0 : 4;
  const neighborFeatures = direct ? sourceFeatures : Array(16).fill(0);
  input.push(Math.min(4, nearestDistance), ...sourceFeatures, ...neighborFeatures);
  return input;
}

function makeLocalGridOccupancyInput(sitePosition, sourceRows, siteStats, offset, maxAbsOffset, gridStep) {
  const key = worldKeyFromPosition(sitePosition);
  const direct = sourceRows.get(key);
  const stat = siteStats.get(key);
  const signedTargetCount = stat ? (offset >= 0 ? stat.targetPositive : stat.targetNegative) : 0;
  const signedTargetPrior = signedTargetCount / Math.max(1, stat?.sampleCount ?? 1);
  const anyTargetPrior = (stat?.targetOccupancy ?? 0) / Math.max(1, stat?.sampleCount ?? 1);
  const sourcePrior = (stat?.sourceOccupancy ?? 0) / Math.max(1, stat?.sampleCount ?? 1);
  const sourceFeatures = direct ? Array.from(direct.candidate) : Array(16).fill(0);
  const local = localGridFeatureSummary(sitePosition, sourceRows, gridStep);
  return [
    1,
    offset / maxAbsOffset,
    sitePosition[0],
    sitePosition[1],
    sitePosition[2],
    direct ? 1 : 0,
    signedTargetPrior,
    anyTargetPrior,
    sourcePrior,
    local.occupiedNeighborRatio,
    ...sourceFeatures,
    ...local.neighborMeans,
  ];
}

function makeSpatialPredictionSites(sourceRows, siteStats, options = {}) {
  const offsetSign = Math.sign(Number(options.offset ?? 1)) || 1;
  const sites = new Map();
  for (const [key, row] of sourceRows) sites.set(key, { key, position: row.position, sourceOccupied: true });
  for (const [key, stats] of siteStats) {
    if (sites.has(key) || !stats.prototypeSplat) continue;
    const signedTargetCount = offsetSign >= 0 ? stats.targetPositive : stats.targetNegative;
    if (signedTargetCount <= 0) continue;
    sites.set(key, { key, position: keyToWorldPosition(key), sourceOccupied: false });
  }
  return sites;
}

function addSiteStat(siteStats, key, field, row = null) {
  let stat = siteStats.get(key);
  if (!stat) {
    stat = {
      targetOccupancy: 0,
      sourceOccupancy: 0,
      sampleCount: 0,
      targetPositive: 0,
      targetNegative: 0,
      prototypeSplat: null,
    };
    siteStats.set(key, stat);
  }
  stat[field] += 1;
  stat.sampleCount += 1;
  if (row && !stat.prototypeSplat) stat.prototypeSplat = Array.from(row);
}

function sigmoid(value) {
  if (value <= -40) return 0;
  if (value >= 40) return 1;
  return 1 / (1 + Math.exp(-value));
}

function dot(weights, input) {
  let total = 0;
  for (let index = 0; index < weights.length; index += 1) total += weights[index] * input[index];
  return total;
}

function finiteRecordNumber(record, field, label) {
  const value = Number(record?.[field]);
  if (!Number.isFinite(value)) throw new Error(`${label}.${field} must be finite`);
  return value;
}

function compileSharedMlxPhaseChurnModel(artifact, context) {
  if (artifact?.schema !== 'kaminos-phase-churn-shared-mlx-model-v0' || artifact.status !== 'completed') {
    throw new Error('shared MLX phase churn model requires completed kaminos-phase-churn-shared-mlx-model-v0 artifact');
  }
  if (artifact.route?.backend !== 'mlx'
    || !/^Device\(gpu,\s*\d+\)$/i.test(String(artifact.route?.device ?? ''))
    || artifact.route?.fallbackReason !== null) {
    throw new Error('shared MLX phase churn model requires effective MLX GPU device identity and null fallback');
  }
  if (artifact.manifest?.sha256 !== context.manifestSha256) {
    throw new Error(`shared MLX phase churn corpus mismatch: expected ${context.manifestSha256}, received ${artifact.manifest?.sha256}`);
  }
  if (Number(artifact.holdout?.offset) !== context.offset || artifact.holdout?.targetFrameId !== context.targetFrameId) {
    throw new Error('shared MLX phase churn holdout identity mismatch');
  }
  const artifactTrainingOffsets = Array.from(artifact.holdout?.trainingOffsets ?? []).map(Number).sort((a, b) => a - b);
  const expectedTrainingOffsets = context.trainingOffsets.slice().sort((a, b) => a - b);
  if (artifactTrainingOffsets.length !== expectedTrainingOffsets.length
    || artifactTrainingOffsets.some((value, index) => value !== expectedTrainingOffsets[index])) {
    throw new Error('shared MLX phase churn training offsets mismatch');
  }
  if (artifact.input?.authority !== 'exact-local-grid-42-feature-contract-v0'
    || artifact.input?.candidateFeatureCount !== 16
    || artifact.input?.featureCount !== context.inputSize) {
    throw new Error('shared MLX phase churn input contract mismatch');
  }
  const inputMean = finiteArray(artifact.input.mean, context.inputSize, 'shared MLX input mean');
  const inputScale = finiteArray(artifact.input.scale, context.inputSize, 'shared MLX input scale');
  if (inputScale.some(value => value <= 0)) throw new Error('shared MLX input scale must be positive');
  if (artifact.architecture?.authority !== 'dense-relu-shared-trunk-three-conditional-logit-heads-v0') {
    throw new Error('shared MLX phase churn architecture authority mismatch');
  }
  if (artifact.architecture?.outputOrder?.join(',') !== 'survival,birth,death') {
    throw new Error('shared MLX phase churn output order mismatch');
  }
  const hiddenSize = Math.floor(Number(artifact.architecture.hiddenSize));
  if (!Number.isInteger(hiddenSize) || hiddenSize <= 0) throw new Error('shared MLX phase churn hidden size must be positive');
  const [trunk, heads] = artifact.architecture.layers ?? [];
  if (trunk?.role !== 'shared-trunk' || trunk.inputSize !== context.inputSize || trunk.outputSize !== hiddenSize || trunk.activation !== 'relu') {
    throw new Error('shared MLX phase churn trunk layer contract mismatch');
  }
  if (heads?.role !== 'conditional-heads' || heads.inputSize !== hiddenSize || heads.outputSize !== 3 || heads.activation !== 'sigmoid') {
    throw new Error('shared MLX phase churn conditional-head layer contract mismatch');
  }
  const trunkWeights = finiteArray(trunk.weights, context.inputSize * hiddenSize, 'shared MLX trunk weights');
  const trunkBias = finiteArray(trunk.bias, hiddenSize, 'shared MLX trunk bias');
  const headWeights = finiteArray(heads.weights, hiddenSize * 3, 'shared MLX head weights');
  const headBias = finiteArray(heads.bias, 3, 'shared MLX head bias');
  const objectives = artifact.objectives;
  if (objectives?.conditionalBce?.authority !== 'masked-asymmetric-conditional-bce-v0'
    || objectives?.withinPairRanking?.authority !== 'within-training-pair-positive-negative-margin-ranking-v0'
    || objectives?.adjacentOffsetConsistency?.authority !== 'same-site-adjacent-offset-label-agreement-consistency-v0') {
    throw new Error('shared MLX phase churn objective authority mismatch');
  }
  if (finiteRecordNumber(objectives.withinPairRanking, 'evaluatedPairCount', 'within-pair ranking') <= 0
    || finiteRecordNumber(objectives.adjacentOffsetConsistency, 'evaluatedPairCount', 'adjacent-offset consistency') <= 0) {
    throw new Error('shared MLX phase churn ranking and consistency objectives require evaluated pairs');
  }
  const calibration = {};
  for (const headName of artifact.architecture.outputOrder) {
    const row = artifact.calibration?.[headName];
    calibration[headName] = {
      threshold: finiteRecordNumber(row, 'threshold', `${headName} calibration`),
      precision: finiteRecordNumber(row, 'precision', `${headName} calibration`),
      recall: finiteRecordNumber(row, 'recall', `${headName} calibration`),
      fScore: finiteRecordNumber(row, 'fScore', `${headName} calibration`),
      truePositive: finiteRecordNumber(row, 'truePositive', `${headName} calibration`),
      falsePositive: finiteRecordNumber(row, 'falsePositive', `${headName} calibration`),
      falseNegative: finiteRecordNumber(row, 'falseNegative', `${headName} calibration`),
      sampleCount: finiteRecordNumber(row, 'sampleCount', `${headName} calibration`),
    };
  }
  return {
    artifact,
    hiddenSize,
    calibration,
    predict(input) {
      finiteArray(input, context.inputSize, 'shared MLX phase churn input');
      const hidden = new Float64Array(hiddenSize);
      for (let output = 0; output < hiddenSize; output += 1) {
        let value = trunkBias[output];
        const row = output * context.inputSize;
        for (let feature = 0; feature < context.inputSize; feature += 1) {
          value += trunkWeights[row + feature] * ((input[feature] - inputMean[feature]) / inputScale[feature]);
        }
        hidden[output] = Math.max(0, value);
      }
      const probabilities = {};
      for (let output = 0; output < 3; output += 1) {
        let logit = headBias[output];
        const row = output * hiddenSize;
        for (let feature = 0; feature < hiddenSize; feature += 1) logit += headWeights[row + feature] * hidden[feature];
        probabilities[artifact.architecture.outputOrder[output]] = sigmoid(logit);
      }
      return probabilities;
    },
  };
}

function forEachLocalGridTrainingSample(trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, callback, options = {}) {
  for (const pair of trainingPairs) {
    if (heldOutFrameIds.has(pair.sourceFrameId) || heldOutFrameIds.has(pair.targetFrameId)) continue;
    const trainingSource = loadedFrames.get(pair.sourceFrameId);
    const trainingTarget = loadedFrames.get(pair.targetFrameId);
    const sourceRows = makeWorldFrameState(trainingSource);
    const targetRows = makeWorldFrameState(trainingTarget);
    const keys = options.includePredictionSiteNegatives
      ? new Set([...makeSpatialPredictionSites(sourceRows, siteStats, { offset: pair.offsetSteps }).keys(), ...targetRows.keys()])
      : new Set([...sourceRows.keys(), ...targetRows.keys()]);
    for (const key of keys) {
      const sourceOccupied = sourceRows.has(key);
      const targetOccupied = targetRows.has(key);
      callback({
        key,
        input: makeLocalGridOccupancyInput(keyToWorldPosition(key), sourceRows, siteStats, pair.offsetSteps, maxAbsOffset, gridStep),
        label: targetOccupied ? 1 : 0,
        sourceOccupied,
        targetOccupied,
        sourceAbsentTargetAbsentNegative: !sourceOccupied && !targetOccupied,
        offsetSteps: pair.offsetSteps,
      });
    }
  }
}

function trainLocalGridLogisticClassifier(trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, options = {}) {
  const inputSize = makeLocalGridOccupancyInput([0, 0, 0], new Map(), siteStats, 1, 1, gridStep).length;
  const weights = new Float64Array(inputSize);
  const epochs = Math.max(1, Math.floor(Number(options.localGridEpochs ?? 2)));
  const learningRate = Math.max(1e-5, Number(options.localGridLearningRate ?? 0.045));
  const l2 = Math.max(0, Number(options.localGridL2 ?? 0.0005));
  let sampleCount = 0;
  let positiveCount = 0;
  let sourceAbsentTargetAbsentNegativeCount = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let epochSamples = 0;
    forEachLocalGridTrainingSample(trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, sample => {
      const prediction = sigmoid(dot(weights, sample.input));
      const error = prediction - sample.label;
      for (let index = 0; index < weights.length; index += 1) {
        const penalty = index === 0 ? 0 : l2 * weights[index];
        weights[index] -= learningRate * (error * sample.input[index] + penalty);
      }
      epochSamples += 1;
      if (epoch === 0) {
        sampleCount += 1;
        positiveCount += sample.label;
        if (sample.sourceAbsentTargetAbsentNegative) sourceAbsentTargetAbsentNegativeCount += 1;
      }
    }, options);
    if (epochSamples === 0) throw new Error('local-grid occupancy classifier has no training samples');
  }
  return {
    inputSize,
    weights,
    epochs,
    learningRate,
    l2,
    sampleCount,
    positiveCount,
    sourceAbsentTargetAbsentNegativeCount,
    predict(input) {
      return sigmoid(dot(weights, input));
    },
  };
}

const SPLIT_SUPPORT_HEADS = Object.freeze({
  survival: {
    trainingUniverse: 'source-occupied-sites-v0',
    positiveWeight: 1.25,
    negativeWeight: 1,
    calibrationBeta: 2,
    thresholdTieBreak: 'lower',
    accepts: sample => sample.sourceOccupied,
    label: sample => sample.targetOccupied ? 1 : 0,
  },
  birth: {
    trainingUniverse: 'source-absent-prediction-sites-v0',
    positiveWeight: 1,
    negativeWeight: 2,
    calibrationBeta: 0.5,
    thresholdTieBreak: 'higher',
    accepts: sample => !sample.sourceOccupied,
    label: sample => sample.targetOccupied ? 1 : 0,
  },
  death: {
    trainingUniverse: 'source-occupied-sites-v0',
    positiveWeight: 1,
    negativeWeight: 2,
    calibrationBeta: 0.5,
    thresholdTieBreak: 'higher',
    accepts: sample => sample.sourceOccupied,
    label: sample => sample.targetOccupied ? 0 : 1,
  },
});

function forEachConditionalSupportHeadSample(headName, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, callback, options = {}) {
  const definition = SPLIT_SUPPORT_HEADS[headName];
  if (!definition) throw new Error(`unknown conditional support head ${headName}`);
  forEachLocalGridTrainingSample(trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, sample => {
    if (!definition.accepts(sample)) return;
    callback({ ...sample, label: definition.label(sample) });
  }, options);
}

function trainConditionalSupportHead(headName, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, options = {}) {
  const definition = SPLIT_SUPPORT_HEADS[headName];
  const inputSize = makeLocalGridOccupancyInput([0, 0, 0], new Map(), siteStats, 1, 1, gridStep).length;
  const weights = new Float64Array(inputSize);
  const epochs = Math.max(1, Math.floor(Number(options.localGridEpochs ?? 2)));
  const learningRate = Math.max(1e-5, Number(options.localGridLearningRate ?? 0.045));
  const l2 = Math.max(0, Number(options.localGridL2 ?? 0.0005));
  let sampleCount = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let epochSamples = 0;
    forEachConditionalSupportHeadSample(headName, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, sample => {
      const prediction = sigmoid(dot(weights, sample.input));
      const sampleWeight = sample.label ? definition.positiveWeight : definition.negativeWeight;
      const error = (prediction - sample.label) * sampleWeight;
      for (let index = 0; index < weights.length; index += 1) {
        const penalty = index === 0 ? 0 : l2 * weights[index];
        weights[index] -= learningRate * (error * sample.input[index] + penalty);
      }
      epochSamples += 1;
      if (epoch === 0) {
        sampleCount += 1;
        positiveCount += sample.label;
        negativeCount += 1 - sample.label;
      }
    }, options);
    if (epochSamples === 0) throw new Error(`${headName} support head has no training samples`);
  }
  return {
    headName,
    inputSize,
    weights,
    epochs,
    learningRate,
    l2,
    sampleCount,
    positiveCount,
    negativeCount,
    trainingUniverse: definition.trainingUniverse,
    loss: {
      authority: 'asymmetric-binary-cross-entropy-sgd-v0',
      positiveWeight: definition.positiveWeight,
      negativeWeight: definition.negativeWeight,
    },
    predict(input) {
      return sigmoid(dot(weights, input));
    },
  };
}

function chooseConditionalSupportHeadThreshold(head, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, options = {}) {
  const definition = SPLIT_SUPPORT_HEADS[head.headName];
  const beta2 = definition.calibrationBeta ** 2;
  const stats = thresholdGrid().map(threshold => ({ threshold, truePositive: 0, falsePositive: 0, falseNegative: 0, sampleCount: 0 }));
  forEachConditionalSupportHeadSample(head.headName, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, sample => {
    const probability = head.predict(sample.input);
    for (const row of stats) {
      const predicted = probability >= row.threshold;
      if (predicted && sample.label) row.truePositive += 1;
      else if (predicted && !sample.label) row.falsePositive += 1;
      else if (!predicted && sample.label) row.falseNegative += 1;
      row.sampleCount += 1;
    }
  }, options);
  const scored = stats.map(row => {
    const precision = row.truePositive / Math.max(1, row.truePositive + row.falsePositive);
    const recall = row.truePositive / Math.max(1, row.truePositive + row.falseNegative);
    const fScore = (1 + beta2) * precision * recall / Math.max(1e-12, beta2 * precision + recall);
    return { ...row, precision, recall, fScore, beta: definition.calibrationBeta };
  });
  return scored.reduce((best, row) => {
    if (row.fScore !== best.fScore) return row.fScore > best.fScore ? row : best;
    if (row.precision !== best.precision) return row.precision > best.precision ? row : best;
    return definition.thresholdTieBreak === 'lower'
      ? (row.threshold < best.threshold ? row : best)
      : (row.threshold > best.threshold ? row : best);
  }, scored[0]);
}

function thresholdGrid() {
  return Array.from({ length: 19 }, (_, index) => 0.05 + index * 0.05);
}

function chooseLocalGridThreshold(classifier, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, options = {}) {
  const thresholds = thresholdGrid();
  const stats = thresholds.map(threshold => ({
    threshold,
    tp: 0,
    fp: 0,
    fn: 0,
    birthTp: 0,
    birthFp: 0,
    birthFn: 0,
    deathTp: 0,
    deathFp: 0,
    deathFn: 0,
  }));
  forEachLocalGridTrainingSample(trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, sample => {
    const probability = classifier.predict(sample.input);
    for (const row of stats) {
      const predicted = probability >= row.threshold;
      if (predicted && sample.label) row.tp += 1;
      else if (predicted && !sample.label) row.fp += 1;
      else if (!predicted && sample.label) row.fn += 1;
      const trueBirth = !sample.sourceOccupied && sample.targetOccupied;
      const predictedBirth = !sample.sourceOccupied && predicted;
      if (predictedBirth && trueBirth) row.birthTp += 1;
      else if (predictedBirth && !trueBirth) row.birthFp += 1;
      else if (!predictedBirth && trueBirth) row.birthFn += 1;
      const trueDeath = sample.sourceOccupied && !sample.targetOccupied;
      const predictedDeath = sample.sourceOccupied && !predicted;
      if (predictedDeath && trueDeath) row.deathTp += 1;
      else if (predictedDeath && !trueDeath) row.deathFp += 1;
      else if (!predictedDeath && trueDeath) row.deathFn += 1;
    }
  }, options);
  const countsToMetrics = (tp, fp, fn) => ({
    truePositive: tp,
    falsePositive: fp,
    falseNegative: fn,
    precision: tp / Math.max(1, tp + fp),
    recall: tp / Math.max(1, tp + fn),
  });
  const withMetrics = stats.map(row => {
    const precision = row.tp / Math.max(1, row.tp + row.fp);
    const recall = row.tp / Math.max(1, row.tp + row.fn);
    const beta2 = 0.25;
    const fScore = (1 + beta2) * precision * recall / Math.max(1e-12, beta2 * precision + recall);
    return {
      ...row,
      precision,
      recall,
      fScore,
      birth: countsToMetrics(row.birthTp, row.birthFp, row.birthFn),
      death: countsToMetrics(row.deathTp, row.deathFp, row.deathFn),
    };
  });
  return withMetrics.reduce((best, row) => (row.fScore > best.fScore ? row : best), withMetrics[0]);
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function computeSupportBudget(trainingPairs, loadedFrames, heldOutFrameIds, sourceRows, targetRows, offset) {
  const offsetSign = Math.sign(offset) || 1;
  const ratios = [];
  const targetCounts = [];
  const sourceSurvivalRatios = [];
  const birthRatios = [];
  for (const pair of trainingPairs) {
    if (heldOutFrameIds.has(pair.sourceFrameId) || heldOutFrameIds.has(pair.targetFrameId)) continue;
    if ((Math.sign(pair.offsetSteps) || 1) !== offsetSign) continue;
    const trainingSource = loadedFrames.get(pair.sourceFrameId);
    const trainingTarget = loadedFrames.get(pair.targetFrameId);
    const sourceCount = trainingSource.splats.count;
    const targetCount = trainingTarget.splats.count;
    const alignment = alignBoundarySplatRowsByWorldPosition(trainingSource.splats.values, trainingTarget.splats.values, { countsOnly: true });
    ratios.push(targetCount / Math.max(1, sourceCount));
    targetCounts.push(targetCount);
    sourceSurvivalRatios.push(alignment.matchedCount / Math.max(1, sourceCount));
    birthRatios.push(alignment.birthCount / Math.max(1, sourceCount));
  }
  if (!ratios.length) {
    for (const pair of trainingPairs) {
      if (heldOutFrameIds.has(pair.sourceFrameId) || heldOutFrameIds.has(pair.targetFrameId)) continue;
      const trainingSource = loadedFrames.get(pair.sourceFrameId);
      const trainingTarget = loadedFrames.get(pair.targetFrameId);
      const sourceCount = trainingSource.splats.count;
      const targetCount = trainingTarget.splats.count;
      const alignment = alignBoundarySplatRowsByWorldPosition(trainingSource.splats.values, trainingTarget.splats.values, { countsOnly: true });
      ratios.push(targetCount / Math.max(1, sourceCount));
      targetCounts.push(targetCount);
      sourceSurvivalRatios.push(alignment.matchedCount / Math.max(1, sourceCount));
      birthRatios.push(alignment.birthCount / Math.max(1, sourceCount));
    }
  }
  const medianTargetToSourceRatio = median(ratios) ?? 1;
  const targetSupportBudget = Math.max(1, Math.round(sourceRows.size * medianTargetToSourceRatio));
  const medianSourceSurvivalRatio = median(sourceSurvivalRatios) ?? Math.min(1, medianTargetToSourceRatio);
  const medianBirthRatio = median(birthRatios) ?? Math.max(0, medianTargetToSourceRatio - medianSourceSurvivalRatio);
  const sourceSurvivalBudget = Math.max(0, Math.min(sourceRows.size, Math.round(sourceRows.size * medianSourceSurvivalRatio)));
  const birthSupportBudget = Math.max(0, Math.min(targetSupportBudget - sourceSurvivalBudget, Math.round(sourceRows.size * medianBirthRatio)));
  return {
    authority: 'training-offset-target-count-support-budget-v0',
    trainingPairCount: ratios.length,
    sourceSupportCount: sourceRows.size,
    exactTargetSupportCount: targetRows.size,
    medianTargetToSourceRatio,
    medianSourceSurvivalRatio,
    medianBirthRatio,
    medianTrainingTargetCount: median(targetCounts),
    targetSupportBudget,
    sourceSurvivalBudget,
    birthSupportBudget,
  };
}

function emptyPr() {
  return { truePositive: 0, falsePositive: 0, falseNegative: 0, precision: 0, recall: 0 };
}

function finishPr(row) {
  return {
    truePositive: row.truePositive,
    falsePositive: row.falsePositive,
    falseNegative: row.falseNegative,
    precision: row.truePositive / Math.max(1, row.truePositive + row.falsePositive),
    recall: row.truePositive / Math.max(1, row.truePositive + row.falseNegative),
  };
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = Array.from({ length: size }, (_, row) => [...matrix[row], vector[row]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-12) throw new Error('phase render model normal equations are singular');
    if (best !== pivot) [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) augmented[row][column] -= factor * augmented[pivot][column];
    }
  }
  return augmented.map(row => row[size]);
}

function makeStreamingRidge(inputSize, outputSize) {
  return {
    inputSize,
    outputSize,
    sampleCount: 0,
    xtx: Array.from({ length: inputSize }, () => new Float64Array(inputSize)),
    xty: Array.from({ length: outputSize }, () => new Float64Array(inputSize)),
  };
}

function addStreamingRidgeSample(accumulator, input, target) {
  accumulator.sampleCount += 1;
  for (let row = 0; row < accumulator.inputSize; row += 1) {
    for (let column = row; column < accumulator.inputSize; column += 1) {
      accumulator.xtx[row][column] += input[row] * input[column];
    }
    for (let output = 0; output < accumulator.outputSize; output += 1) {
      accumulator.xty[output][row] += input[row] * target[output];
    }
  }
}

function finishStreamingRidge(accumulator, lambda) {
  const matrix = Array.from({ length: accumulator.inputSize }, (_, row) => (
    Array.from({ length: accumulator.inputSize }, (_, column) => {
      const value = row <= column ? accumulator.xtx[row][column] : accumulator.xtx[column][row];
      return value + (row === column ? lambda : 0);
    })
  ));
  const weights = accumulator.xty.map(vector => solveLinearSystem(matrix, Array.from(vector)));
  return {
    sampleCount: accumulator.sampleCount,
    weights,
    predict(input) {
      return weights.map(row => row.reduce((sum, weight, index) => sum + weight * input[index], 0));
    },
  };
}

function phaseInput(features, offset, maxAbsOffset) {
  return [1, offset / maxAbsOffset, ...features];
}

function predictedSplatRow(sourceSplat, predictedFeatures, attributes, gridSize, applyVisibility = true) {
  const fireSignal = predictedFeatures[8] * 1.25
    + predictedFeatures[10] * 0.52
    + predictedFeatures[11] * 0.86
    + predictedFeatures[14] * 0.72
    + predictedFeatures[5] * 0.24;
  const smoothstep = (low, high, value) => {
    const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
    return t * t * (3 - 2 * t);
  };
  const structuralSignal = predictedFeatures[2]
    * smoothstep(0.055, 0.32, predictedFeatures[1])
    * smoothstep(0.018, 0.16, fireSignal);
  const radius = (2 / gridSize) * (0.60 + predictedFeatures[3] * 2.65 + predictedFeatures[2] * 0.48);
  const visible = structuralSignal >= 0.11 ? 1 : 0;
  return [
    sourceSplat[0], sourceSplat[1], sourceSplat[2], structuralSignal,
    attributes[0], attributes[1], attributes[2], attributes[3] * (applyVisibility ? visible : 1),
    radius * attributes[4], radius * attributes[5], predictedFeatures[2], fireSignal,
  ];
}

function calibratePredictedSplatRow(sourceSplat, predictedSplat, scales) {
  const calibrated = Array.from(predictedSplat);
  for (let channel = 3; channel < SPLAT_STRIDE_FLOATS; channel += 1) {
    calibrated[channel] = sourceSplat[channel] + scales[channel - 3] * (predictedSplat[channel] - sourceSplat[channel]);
  }
  if (calibrated[3] < 0.11) calibrated[7] = 0;
  return calibrated;
}

function imageMse(left, right) {
  if (left.length !== right.length) throw new Error('render comparison dimensions differ');
  let total = 0;
  let count = 0;
  for (let index = 0; index < left.length; index += 4) {
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = (left[index + channel] - right[index + channel]) / 255;
      total += delta * delta;
      count += 1;
    }
  }
  return total / Math.max(1, count);
}

function pixelLuminance(rgba, index) {
  return (rgba[index] / 255) * 0.2126 + (rgba[index + 1] / 255) * 0.7152 + (rgba[index + 2] / 255) * 0.0722;
}

function renderResidualMapPng(positive, negative) {
  if (positive.width !== negative.width || positive.height !== negative.height) throw new Error('residual map dimensions differ');
  const width = positive.width;
  const height = positive.height;
  const deltas = new Float32Array(width * height);
  let maxAbs = 0;
  let positivePixelCount = 0;
  let negativePixelCount = 0;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const index = pixel * 4;
    const delta = pixelLuminance(positive.rgba, index) - pixelLuminance(negative.rgba, index);
    deltas[pixel] = delta;
    maxAbs = Math.max(maxAbs, Math.abs(delta));
    if (delta > 1 / 255) positivePixelCount += 1;
    else if (delta < -1 / 255) negativePixelCount += 1;
  }
  const scale = Math.max(maxAbs, 1 / 255);
  const rgba = Buffer.alloc(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const value = Math.min(1, Math.abs(deltas[pixel]) / scale);
    const index = pixel * 4;
    if (deltas[pixel] >= 0) {
      rgba[index] = Math.round(20 + value * 235);
      rgba[index + 1] = Math.round(16 + value * 168);
      rgba[index + 2] = Math.round(22 + value * 42);
    } else {
      rgba[index] = Math.round(14 + value * 46);
      rgba[index + 1] = Math.round(18 + value * 122);
      rgba[index + 2] = Math.round(28 + value * 227);
    }
    rgba[index + 3] = 255;
  }
  return {
    authority: 'phase-render-luminance-residual-map-v0',
    width,
    height,
    rgba,
    png: writeRgbaPng(width, height, rgba),
    maxAbsLuminanceDelta: maxAbs,
    positivePixelCount,
    negativePixelCount,
  };
}

function makeDiagnosticSplat(position, color, radius, opacity = 0.9) {
  return [
    position[0], position[1], position[2], 1,
    color[0], color[1], color[2], opacity,
    radius, radius, 0.5, 1,
  ];
}

function diagnosticPrototypeRadius(row, gridStep) {
  if (!row) return Math.max(0.02, gridStep * 0.75);
  return Math.max(gridStep * 0.55, Math.max(Number(row[8] || 0), Number(row[9] || 0)) * 1.35);
}

function renderSupportChurnOverlay(sourceRows, targetRows, predictionSites, predictedOccupiedKeys, camera, renderOptions, gridStep) {
  const keys = new Set([...sourceRows.keys(), ...targetRows.keys(), ...predictionSites.keys(), ...predictedOccupiedKeys]);
  const rows = [];
  const categoryRows = {
    missedSupport: [],
    falseSupport: [],
    trueBirth: [],
    trueDeath: [],
  };
  const counts = {
    trueSurvival: 0,
    missedSupport: 0,
    falseSupport: 0,
    trueBirth: 0,
    falseBirth: 0,
    trueDeath: 0,
    retainedDeadSource: 0,
  };
  for (const key of keys) {
    const sourceRow = sourceRows.get(key);
    const targetRow = targetRows.get(key);
    const site = predictionSites.get(key);
    const predicted = predictedOccupiedKeys.has(key);
    const sourceOccupied = Boolean(sourceRow);
    const targetOccupied = Boolean(targetRow);
    let color = null;
    let opacity = 0.88;
    if (sourceOccupied && targetOccupied && predicted) {
      counts.trueSurvival += 1;
      color = [0.16, 1.0, 0.42];
      opacity = 0.58;
    } else if (targetOccupied && !predicted) {
      counts.missedSupport += 1;
      color = [1.0, 0.08, 0.18];
      categoryRows.missedSupport.push(key);
    } else if (predicted && !targetOccupied) {
      counts.falseSupport += 1;
      color = [1.0, 0.46, 0.05];
      if (!sourceOccupied) counts.falseBirth += 1;
      else counts.retainedDeadSource += 1;
      categoryRows.falseSupport.push(key);
    } else if (!sourceOccupied && targetOccupied && predicted) {
      counts.trueBirth += 1;
      color = [1.0, 0.88, 0.16];
      categoryRows.trueBirth.push(key);
    } else if (sourceOccupied && !targetOccupied && !predicted) {
      counts.trueDeath += 1;
      color = [0.12, 0.48, 1.0];
      opacity = 0.72;
      categoryRows.trueDeath.push(key);
    }
    if (!color) continue;
    const prototype = sourceRow?.splat || targetRow?.splat;
    const position = sourceRow?.position || targetRow?.position || site?.position || keyToWorldPosition(key);
    rows.push(makeDiagnosticSplat(position, color, diagnosticPrototypeRadius(prototype, gridStep), opacity));
  }
  const fallbackRow = makeDiagnosticSplat([0, 0, 0], [0.05, 0.05, 0.05], gridStep, 0.01);
  const renderRows = (categoryKeys, color, opacity = 0.9) => {
    const category = [];
    for (const key of categoryKeys) {
      const sourceRow = sourceRows.get(key);
      const targetRow = targetRows.get(key);
      const site = predictionSites.get(key);
      const prototype = sourceRow?.splat || targetRow?.splat;
      const position = sourceRow?.position || targetRow?.position || site?.position || keyToWorldPosition(key);
      category.push(makeDiagnosticSplat(position, color, diagnosticPrototypeRadius(prototype, gridStep), opacity));
    }
    return renderBoundarySplatRowsPng(category.length ? category : [fallbackRow], camera, renderOptions);
  };
  const render = renderBoundarySplatRowsPng(rows.length ? rows : [fallbackRow], camera, renderOptions);
  render.authority = 'world-position-support-churn-overlay-v0';
  const missedSupport = renderRows(categoryRows.missedSupport, [1.0, 0.08, 0.18], 0.9);
  missedSupport.authority = 'world-position-support-churn-category-overlay-v0';
  const falseSupport = renderRows(categoryRows.falseSupport, [1.0, 0.46, 0.05], 0.9);
  falseSupport.authority = 'world-position-support-churn-category-overlay-v0';
  const trueBirth = renderRows(categoryRows.trueBirth, [1.0, 0.88, 0.16], 0.9);
  trueBirth.authority = 'world-position-support-churn-category-overlay-v0';
  const trueDeath = renderRows(categoryRows.trueDeath, [0.12, 0.48, 1.0], 0.8);
  trueDeath.authority = 'world-position-support-churn-category-overlay-v0';
  return {
    render,
    counts,
    categoryRenders: {
      missedSupport,
      falseSupport,
      trueBirth,
      trueDeath,
    },
  };
}

function renderSupportFlowDebugMix(beauty, sourceRows, activeRows, camera, renderOptions, gridStep, gain) {
  const keys = new Set([...sourceRows.keys(), ...activeRows.keys()]);
  const diagnosticRows = [];
  const counts = { survivor: 0, birth: 0, death: 0 };
  for (const key of keys) {
    const sourceRow = sourceRows.get(key);
    const activeRow = activeRows.get(key);
    let color;
    let opacity;
    if (sourceRow && activeRow) {
      counts.survivor += 1;
      color = [0.08, 0.32, 1.0];
      opacity = 0.22;
    } else if (activeRow) {
      counts.birth += 1;
      color = [0.0, 1.0, 0.92];
      opacity = 0.9;
    } else {
      counts.death += 1;
      color = [1.0, 0.05, 0.42];
      opacity = 0.9;
    }
    const row = activeRow?.splat || sourceRow?.splat;
    const position = activeRow?.position || sourceRow?.position || keyToWorldPosition(key);
    diagnosticRows.push(makeDiagnosticSplat(position, color, diagnosticPrototypeRadius(row, gridStep), opacity));
  }
  const debug = renderBoundarySplatRowsPng(diagnosticRows, camera, renderOptions);
  const rgba = Buffer.alloc(beauty.rgba.length);
  const backgroundBytes = BACKGROUND.map(value => Math.round(value * 255));
  for (let pixel = 0; pixel < beauty.width * beauty.height; pixel += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const index = pixel * 4 + channel;
      const additive = Math.max(0, debug.rgba[index] - backgroundBytes[channel]);
      rgba[index] = Math.max(0, Math.min(255, Math.round(beauty.rgba[index] + additive * gain)));
    }
    rgba[pixel * 4 + 3] = 255;
  }
  return {
    authority: 'display-only-support-flow-debug-mix-v0',
    png: writeRgbaPng(beauty.width, beauty.height, rgba),
    width: beauty.width,
    height: beauty.height,
    rgba,
    gain,
    counts,
  };
}

function composeHorizontal(rendered) {
  const gap = 4;
  const width = rendered.reduce((sum, item) => sum + item.width, 0) + gap * (rendered.length - 1);
  const height = Math.max(...rendered.map(item => item.height));
  const rgba = Buffer.alloc(width * height * 4, 255);
  let offsetX = 0;
  for (const [itemIndex, item] of rendered.entries()) {
    for (let y = 0; y < item.height; y += 1) {
      item.rgba.copy(rgba, (y * width + offsetX) * 4, y * item.width * 4, (y + 1) * item.width * 4);
    }
    offsetX += item.width;
    if (itemIndex < rendered.length - 1) {
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < gap; x += 1) {
          const pixel = (y * width + offsetX + x) * 4;
          rgba[pixel] = 42;
          rgba[pixel + 1] = 44;
          rgba[pixel + 2] = 48;
          rgba[pixel + 3] = 255;
        }
      }
      offsetX += gap;
    }
  }
  return { width, height, rgba, png: writeRgbaPng(width, height, rgba) };
}

async function writeRenderArtifact(path, rendered) {
  await writeFile(path, rendered.png);
  return {
    path,
    bytes: rendered.png.byteLength,
    sha256: sha256(rendered.png),
    width: rendered.width,
    height: rendered.height,
    authority: rendered.authority || 'isolated-phase-render-comparison-strip-v0',
  };
}

async function runSpatialOccupancyRenderWitness(context) {
  const {
    manifestBytes,
    manifestPath,
    outDir,
    reportPath,
    source,
    target,
    heldOutPair,
    trainingPairs,
    trainingOffsets,
    loadedFrames,
    attributeModel,
    compiledAttributeModel,
    modelPath,
    modelBytes,
    offset,
    maxAbsOffset,
    holdoutAlignment,
    gridSize,
    renderOptions,
    ridgeLambda,
    options,
  } = context;
  const inputSize = makeSpatialOccupancyInput([0, 0, 0], new Map([[
    '0.000000,0.000000,0.000000',
    { position: [0, 0, 0], candidate: new Float32Array(16) },
  ]]), 1, 1).length;
  const occupancyAccumulator = makeStreamingRidge(inputSize, 1);
  const featureAccumulator = makeStreamingRidge(inputSize, 16);
  const siteStats = new Map();
  const heldOutFrameIds = new Set([heldOutPair.targetFrameId]);
  let featureTrainingSampleCount = 0;
  for (const pair of trainingPairs) {
    if (heldOutFrameIds.has(pair.sourceFrameId) || heldOutFrameIds.has(pair.targetFrameId)) continue;
    const trainingSource = loadedFrames.get(pair.sourceFrameId);
    const trainingTarget = loadedFrames.get(pair.targetFrameId);
    const sourceRows = makeWorldFrameState(trainingSource);
    const targetRows = makeWorldFrameState(trainingTarget);
    const keys = new Set([...sourceRows.keys(), ...targetRows.keys()]);
    for (const key of keys) {
      const position = keyToWorldPosition(key);
      const sourceRow = sourceRows.get(key);
      const targetRow = targetRows.get(key);
      if (sourceRow) addSiteStat(siteStats, key, 'sourceOccupancy', sourceRow.splat);
      if (targetRow) {
        addSiteStat(siteStats, key, 'targetOccupancy', targetRow.splat);
        const stat = siteStats.get(key);
        if (pair.offsetSteps >= 0) stat.targetPositive += 1;
        else stat.targetNegative += 1;
      }
      const input = makeSpatialOccupancyInput(position, sourceRows, pair.offsetSteps, maxAbsOffset);
      addStreamingRidgeSample(occupancyAccumulator, input, [targetRow ? 1 : 0]);
      if (targetRow) {
        addStreamingRidgeSample(featureAccumulator, input, Array.from(targetRow.candidate));
        featureTrainingSampleCount += 1;
      }
    }
  }
  const occupancyModel = finishStreamingRidge(occupancyAccumulator, ridgeLambda);
  const featureModel = finishStreamingRidge(featureAccumulator, ridgeLambda);
  const sourceRows = makeWorldFrameState(source);
  const targetRows = makeWorldFrameState(target);
  const predictionSites = makeSpatialPredictionSites(sourceRows, siteStats, { offset });
  const occupancyThreshold = Math.max(0, Math.min(1, Number(options.occupancyThreshold ?? 0.5)));
  const predictedRows = [];
  const predictedBirthRows = [];
  let predictedDeaths = 0;
  const predictedFeatureByKey = new Map();
  const occupancyByKey = new Map();
  for (const [key, site] of predictionSites) {
    const stat = siteStats.get(key);
    const signedTargetCount = stat ? (offset >= 0 ? stat.targetPositive : stat.targetNegative) : 0;
    const sitePrior = stat ? Math.max(stat.targetOccupancy / Math.max(1, stat.sampleCount), signedTargetCount > 0 ? 1 : 0) : 0;
    const input = makeSpatialOccupancyInput(site.position, sourceRows, offset, maxAbsOffset);
    const ridgeOccupancy = occupancyModel.predict(input)[0];
    const occupancy = Math.max(0, Math.min(1, Math.max(ridgeOccupancy, sitePrior)));
    occupancyByKey.set(key, { ridge: ridgeOccupancy, prior: sitePrior, final: occupancy });
    if (occupancy < occupancyThreshold) {
      if (site.sourceOccupied) predictedDeaths += 1;
      continue;
    }
    const predictedFeatures = featureModel.predict(input).map(value => Math.max(0, value));
    predictedFeatureByKey.set(key, predictedFeatures);
    const prototypeSplat = sourceRows.get(key)?.splat || stat?.prototypeSplat;
    if (!prototypeSplat) continue;
    const attributes = evaluateBoundarySplatAttributeModel(attributeModel, [predictedFeatures])[0];
    const row = !site.sourceOccupied && stat?.prototypeSplat && sitePrior >= occupancyThreshold
      ? Array.from(stat.prototypeSplat)
      : predictedSplatRow(prototypeSplat, predictedFeatures, attributes, gridSize, false);
    row[0] = site.position[0];
    row[1] = site.position[1];
    row[2] = site.position[2];
    row[7] *= occupancy;
    predictedRows.push(row);
    if (!site.sourceOccupied && targetRows.has(key)) predictedBirthRows.push(row);
  }
  if (!predictedRows.length) throw new Error('spatial occupancy phase model predicted no visible candidate sites');
  const predictedSplats = new Float32Array(predictedRows.length * SPLAT_STRIDE_FLOATS);
  predictedRows.forEach((row, index) => predictedSplats.set(row, index * SPLAT_STRIDE_FLOATS));
  const priorRows = [];
  for (const [key, site] of predictionSites) {
    const sourceRow = sourceRows.get(key);
    if (sourceRow) {
      priorRows.push(Array.from(sourceRow.splat));
      continue;
    }
    const stat = siteStats.get(key);
    if (!stat?.prototypeSplat) continue;
    const prior = stat.targetOccupancy / Math.max(1, stat.sampleCount);
    if (prior < occupancyThreshold) continue;
    const row = Array.from(stat.prototypeSplat);
    row[7] *= Math.min(0.35, prior);
    priorRows.push(row);
  }
  const priorSplats = new Float32Array(priorRows.length * SPLAT_STRIDE_FLOATS);
  priorRows.forEach((row, index) => priorSplats.set(row, index * SPLAT_STRIDE_FLOATS));
  let identityFeatureSquaredError = 0;
  let predictionFeatureSquaredError = 0;
  let predictedFeatureCount = 0;
  for (const match of holdoutAlignment.matched) {
    const sourceFeatures = featureRow(source.candidates.values, match.sourceIndex);
    const exactFeatures = featureRow(target.candidates.values, match.targetIndex);
    const key = worldPositionStableKey(flatRow(source.splats.values, match.sourceIndex, SPLAT_STRIDE_FLOATS));
    const prediction = predictedFeatureByKey.get(key);
    if (!prediction) continue;
    for (let feature = 0; feature < 16; feature += 1) {
      identityFeatureSquaredError += (sourceFeatures[feature] - exactFeatures[feature]) ** 2;
      predictionFeatureSquaredError += (prediction[feature] - exactFeatures[feature]) ** 2;
      predictedFeatureCount += 1;
    }
  }
  const identityRender = renderBoundarySplatRowsPng(source.splats.values, source.frame.camera, renderOptions);
  const predictionRender = renderBoundarySplatRowsPng(predictedSplats, source.frame.camera, renderOptions);
  const priorRender = renderBoundarySplatRowsPng(priorSplats, source.frame.camera, renderOptions);
  const exactRender = renderBoundarySplatRowsPng(target.splats.values, target.frame.camera, renderOptions);
  const comparisonRender = composeHorizontal([identityRender, priorRender, predictionRender, exactRender]);
  const offsetLabel = offset > 0 ? `p${offset}` : `m${Math.abs(offset)}`;
  const artifacts = {
    identity: await writeRenderArtifact(resolve(outDir, `phase-render-identity-${offsetLabel}.png`), identityRender),
    spatialPriorInterpolation: await writeRenderArtifact(resolve(outDir, `phase-render-spatial-prior-${offsetLabel}.png`), priorRender),
    phasePrediction: await writeRenderArtifact(resolve(outDir, `phase-render-spatial-occupancy-prediction-${offsetLabel}.png`), predictionRender),
    exactTarget: await writeRenderArtifact(resolve(outDir, `phase-render-exact-${offsetLabel}.png`), exactRender),
    comparison: await writeRenderArtifact(resolve(outDir, `phase-render-spatial-occupancy-comparison-${offsetLabel}.png`), comparisonRender),
  };
  const identityPixelMse = imageMse(identityRender.rgba, exactRender.rgba);
  const priorPixelMse = imageMse(priorRender.rgba, exactRender.rgba);
  const predictionPixelMse = imageMse(predictionRender.rgba, exactRender.rgba);
  const synthesizedBirthKeys = Array.from(predictionSites.values())
    .filter(site => !site.sourceOccupied && targetRows.has(site.key) && occupancyByKey.get(site.key)?.final >= occupancyThreshold)
    .map(site => site.key);
  const report = {
    schema: BOUNDARY_SPLAT_PHASE_RENDER_SCHEMA,
    status: 'completed',
    manifest: { path: manifestPath, bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
    route: {
      requested: source.frame.requestedRoute,
      effective: source.frame.effectiveRoute,
      rendererIdentity: source.frame.rendererIdentity,
      sourceAuthority: source.frame.sourceAuthority,
      fallbackReason: source.frame.fallbackReason,
    },
    attributeModel: { path: modelPath, sha256: sha256(modelBytes), identity: compiledAttributeModel.identity },
    phaseModel: {
      family: 'spatial-occupancy-ridge-v0',
      holdoutAuthority: 'entire-offset-pair-plus-target-frame-held-out-v0',
      heldOutOffset: offset,
      heldOutFrameIds: Array.from(heldOutFrameIds),
      trainingOffsets: trainingOffsets.sort((a, b) => a - b),
      ridgeLambda,
      siteUniverse: {
        authority: 'training-frame-world-position-site-universe-v0',
        siteCount: siteStats.size,
        predictionSiteCount: predictionSites.size,
        sourceAbsentSiteFilter: 'same-sign-training-target-observed-v0',
      },
      occupancy: {
        authority: 'offset-conditioned-spatial-occupancy-ridge-v0',
        threshold: occupancyThreshold,
        trainSampleCount: occupancyModel.sampleCount,
        synthesizedBirthKeys,
        predictedDeaths,
      },
      featureHead: {
        authority: 'offset-conditioned-spatial-feature-ridge-v0',
        trainSampleCount: featureTrainingSampleCount,
      },
    },
    alignment: {
      identityKey: 'world-position-stable-key',
      matched: holdoutAlignment.matchedCount,
      births: holdoutAlignment.birthCount,
      deaths: holdoutAlignment.deathCount,
      birthSynthesis: 'training-site-spatial-occupancy-synthesis-v0',
      synthesizedBirths: synthesizedBirthKeys.length,
      deathHandling: 'spatial-occupancy-threshold',
      predictedDeaths,
    },
    featureMetrics: {
      identityMse: identityFeatureSquaredError / Math.max(1, predictedFeatureCount),
      phasePredictionMse: predictionFeatureSquaredError / Math.max(1, predictedFeatureCount),
      beatsIdentity: predictionFeatureSquaredError < identityFeatureSquaredError,
      modelToIdentityRatio: predictionFeatureSquaredError / Math.max(1e-12, identityFeatureSquaredError),
      matchedFeatureValuesCompared: predictedFeatureCount,
    },
    pixelMetrics: {
      identityToExactMse: identityPixelMse,
      spatialPriorInterpolationToExactMse: priorPixelMse,
      phasePredictionToExactMse: predictionPixelMse,
      beatsIdentity: predictionPixelMse < identityPixelMse,
      beatsSpatialPriorInterpolation: predictionPixelMse <= priorPixelMse,
      modelToIdentityRatio: predictionPixelMse / Math.max(1e-12, identityPixelMse),
    },
    baselines: {
      currentCopy: {
        authority: 'current-source-splat-copy-baseline-v0',
        pixelMse: identityPixelMse,
        inputSplats: source.splats.count,
      },
      spatialPriorInterpolation: {
        authority: 'nearest-offset-site-prior-interpolation-baseline-v0',
        pixelMse: priorPixelMse,
        inputSplats: priorRows.length,
      },
    },
    renders: {
      authority: 'isolated-cpu-projected-boundary-splat-raster-v0',
      blocks: ['identity', 'spatialPriorInterpolation', 'phasePrediction', 'exactTarget'],
      width: renderOptions.width,
      height: renderOptions.height,
      radiusMultiplier: renderOptions.radiusMultiplier,
      kernelSharpness: renderOptions.kernelSharpness,
      artifacts,
      inputSplats: {
        identity: source.splats.count,
        spatialPriorInterpolation: priorRows.length,
        phasePrediction: predictedRows.length,
        exactTarget: target.splats.count,
      },
      visibleSupport: {
        identity: identityRender.nonBackgroundPixelCount,
        spatialPriorInterpolation: priorRender.nonBackgroundPixelCount,
        phasePrediction: predictionRender.nonBackgroundPixelCount,
        exactTarget: exactRender.nonBackgroundPixelCount,
      },
    },
    claimBoundary: 'isolated captured-splat raster; spatial occupancy can synthesize births only at training-observed world sites and live runtime instancing is unchanged',
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

async function runLocalGridOccupancyRenderWitness(context) {
  const {
    manifestBytes,
    manifestPath,
    outDir,
    reportPath,
    source,
    target,
    heldOutPair,
    trainingPairs,
    trainingOffsets,
    loadedFrames,
    attributeModel,
    compiledAttributeModel,
    modelPath,
    modelBytes,
    offset,
    maxAbsOffset,
    holdoutAlignment,
    gridSize,
    renderOptions,
    ridgeLambda,
    options,
    recordFailureContext = () => {},
  } = context;
  const requestedFamily = String(options.phaseModelFamily || options.modelFamily || 'local-grid-occupancy-classifier-v0');
  const budgetedSupport = requestedFamily === 'dense-negative-budgeted-local-grid-occupancy-v0';
  const quotaRankedSupport = requestedFamily === 'quota-ranked-survival-birth-death-local-grid-v0';
  const sharedMlxSupport = requestedFamily === 'shared-mlx-survival-birth-death-local-grid-v0';
  const rankedSupportHeads = quotaRankedSupport || sharedMlxSupport;
  const splitSupportHeads = requestedFamily === 'split-survival-birth-death-local-grid-v0'
    || rankedSupportHeads;
  const usesSupportBudget = budgetedSupport || splitSupportHeads;
  const classifierOptions = usesSupportBudget
    ? { ...options, includePredictionSiteNegatives: true }
    : options;
  const heldOutFrameIds = new Set([heldOutPair.targetFrameId]);
  const siteStats = new Map();
  for (const pair of trainingPairs) {
    if (heldOutFrameIds.has(pair.sourceFrameId) || heldOutFrameIds.has(pair.targetFrameId)) continue;
    const trainingSource = loadedFrames.get(pair.sourceFrameId);
    const trainingTarget = loadedFrames.get(pair.targetFrameId);
    const sourceRows = makeWorldFrameState(trainingSource);
    const targetRows = makeWorldFrameState(trainingTarget);
    const keys = new Set([...sourceRows.keys(), ...targetRows.keys()]);
    for (const key of keys) {
      const sourceRow = sourceRows.get(key);
      const targetRow = targetRows.get(key);
      if (sourceRow) addSiteStat(siteStats, key, 'sourceOccupancy', sourceRow.splat);
      if (targetRow) {
        addSiteStat(siteStats, key, 'targetOccupancy', targetRow.splat);
        const stat = siteStats.get(key);
        if (pair.offsetSteps >= 0) stat.targetPositive += 1;
        else stat.targetNegative += 1;
      }
    }
  }
  const gridStep = Number(options.gridStep ?? (2 / gridSize));
  let sharedMlxModelPath = null;
  let sharedMlxModelBytes = null;
  let sharedMlxModel = null;
  if (sharedMlxSupport) {
    if (!options.phaseModelArtifact) throw new Error('shared MLX phase churn family requires --phase-model-artifact');
    sharedMlxModelPath = resolve(String(options.phaseModelArtifact));
    sharedMlxModelBytes = await readFile(sharedMlxModelPath);
    const sharedMlxArtifact = JSON.parse(sharedMlxModelBytes.toString('utf8'));
    const localGridInputSize = makeLocalGridOccupancyInput([0, 0, 0], new Map(), siteStats, 1, 1, gridStep).length;
    sharedMlxModel = compileSharedMlxPhaseChurnModel(sharedMlxArtifact, {
      manifestSha256: sha256(manifestBytes),
      offset,
      targetFrameId: heldOutPair.targetFrameId,
      trainingOffsets,
      inputSize: localGridInputSize,
    });
    recordFailureContext('phase-model-support-scoring', {
      sharedMlxModelIdentity: sharedMlxModel.artifact.identity,
      sharedMlxModelDevice: sharedMlxModel.artifact.route.device,
      sharedMlxInputFeatureCount: localGridInputSize,
      trainingSiteCount: siteStats.size,
    });
  }
  const classifier = splitSupportHeads
    ? null
    : trainLocalGridLogisticClassifier(trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, classifierOptions);
  const calibratedThreshold = splitSupportHeads
    ? null
    : chooseLocalGridThreshold(classifier, trainingPairs, loadedFrames, heldOutFrameIds, siteStats, maxAbsOffset, gridStep, classifierOptions);
  const conditionalHeads = sharedMlxSupport
    ? Object.fromEntries(Object.keys(SPLIT_SUPPORT_HEADS).map(headName => {
      const counts = sharedMlxModel.artifact.training?.headSampleCounts?.[headName];
      if (!counts || !Number.isFinite(counts.sampleCount) || counts.sampleCount <= 0) {
        throw new Error(`shared MLX phase churn ${headName} head requires positive training sample counts`);
      }
      return [headName, {
        head: {
          headName,
          inputSize: sharedMlxModel.artifact.input.featureCount,
          sampleCount: counts.sampleCount,
          positiveCount: counts.positiveCount,
          negativeCount: counts.negativeCount,
          epochs: null,
          learningRate: null,
          l2: null,
          trainingUniverse: SPLIT_SUPPORT_HEADS[headName].trainingUniverse,
          loss: sharedMlxModel.artifact.objectives.conditionalBce,
          predict(input) {
            return sharedMlxModel.predict(input)[headName];
          },
        },
        calibration: sharedMlxModel.calibration[headName],
      }];
    }))
    : (splitSupportHeads
      ? Object.fromEntries(Object.keys(SPLIT_SUPPORT_HEADS).map(headName => {
      const head = trainConditionalSupportHead(
        headName,
        trainingPairs,
        loadedFrames,
        heldOutFrameIds,
        siteStats,
        maxAbsOffset,
        gridStep,
        classifierOptions,
      );
      const calibration = chooseConditionalSupportHeadThreshold(
        head,
        trainingPairs,
        loadedFrames,
        heldOutFrameIds,
        siteStats,
        maxAbsOffset,
        gridStep,
        classifierOptions,
      );
      return [headName, { head, calibration }];
      }))
      : null);
  const featureInputSize = makeSpatialOccupancyInput([0, 0, 0], new Map([[
    '0.000000,0.000000,0.000000',
    { position: [0, 0, 0], candidate: new Float32Array(16) },
  ]]), 1, 1).length;
  const featureAccumulator = makeStreamingRidge(featureInputSize, 16);
  let featureTrainingSampleCount = 0;
  for (const pair of trainingPairs) {
    if (heldOutFrameIds.has(pair.sourceFrameId) || heldOutFrameIds.has(pair.targetFrameId)) continue;
    const trainingSource = loadedFrames.get(pair.sourceFrameId);
    const trainingTarget = loadedFrames.get(pair.targetFrameId);
    const sourceRows = makeWorldFrameState(trainingSource);
    const targetRows = makeWorldFrameState(trainingTarget);
    for (const [key, targetRow] of targetRows) {
      addStreamingRidgeSample(
        featureAccumulator,
        makeSpatialOccupancyInput(targetRow.position, sourceRows, pair.offsetSteps, maxAbsOffset),
        Array.from(targetRow.candidate),
      );
      featureTrainingSampleCount += 1;
    }
  }
  const featureModel = finishStreamingRidge(featureAccumulator, ridgeLambda);
  const sourceRows = makeWorldFrameState(source);
  const targetRows = makeWorldFrameState(target);
  const predictionSites = makeSpatialPredictionSites(sourceRows, siteStats, { offset });
  const supportBudget = usesSupportBudget
    ? computeSupportBudget(trainingPairs, loadedFrames, heldOutFrameIds, sourceRows, targetRows, offset)
    : null;
  const occupancyThreshold = calibratedThreshold?.threshold ?? null;
  if (supportBudget) {
    if (rankedSupportHeads) {
      supportBudget.birthPrecisionBudgetScale = 1;
      supportBudget.effectiveSourceSurvivalBudget = Math.max(
        0,
        Math.min(sourceRows.size, supportBudget.sourceSurvivalBudget, supportBudget.targetSupportBudget),
      );
      supportBudget.effectiveBirthSupportBudget = Math.max(
        0,
        Math.min(
          supportBudget.birthSupportBudget,
          supportBudget.targetSupportBudget - supportBudget.effectiveSourceSurvivalBudget,
        ),
      );
    } else {
      const birthPrecision = splitSupportHeads
        ? conditionalHeads.birth.calibration.precision
        : calibratedThreshold.birth.precision;
      supportBudget.birthPrecisionBudgetScale = Math.max(0.05, Math.min(1, birthPrecision));
      supportBudget.effectiveBirthSupportBudget = Math.max(0, Math.round(supportBudget.birthSupportBudget * supportBudget.birthPrecisionBudgetScale));
      supportBudget.effectiveSourceSurvivalBudget = Math.max(
        0,
        Math.min(sourceRows.size, supportBudget.targetSupportBudget - supportBudget.effectiveBirthSupportBudget),
      );
    }
  }
  const probabilityByKey = new Map();
  const supportHeadProbabilityByKey = new Map();
  const selectedKeys = new Set();
  if (usesSupportBudget) {
    const rankedSourceSites = [];
    const rankedBirthSites = [];
    for (const [key, site] of predictionSites) {
      const input = makeLocalGridOccupancyInput(site.position, sourceRows, siteStats, offset, maxAbsOffset, gridStep);
      let probability;
      let decisionEligible = true;
      if (splitSupportHeads) {
        const sharedProbabilities = sharedMlxSupport ? sharedMlxModel.predict(input) : null;
        if (site.sourceOccupied) {
          const survival = sharedProbabilities?.survival ?? conditionalHeads.survival.head.predict(input);
          const death = sharedProbabilities?.death ?? conditionalHeads.death.head.predict(input);
          supportHeadProbabilityByKey.set(key, { survival, birth: null, death });
          const survivalMargin = survival - conditionalHeads.survival.calibration.threshold;
          const deathMargin = death - conditionalHeads.death.calibration.threshold;
          probability = rankedSupportHeads
            ? survivalMargin - deathMargin
            : survival * (1 - death);
          decisionEligible = rankedSupportHeads
            || (survivalMargin >= 0 && survivalMargin >= deathMargin);
        } else {
          const birth = sharedProbabilities?.birth ?? conditionalHeads.birth.head.predict(input);
          const birthDecision = rankedSupportHeads
            ? quotaRankedBirthDecision(
              birth,
              conditionalHeads.birth.calibration.threshold,
              conditionalHeads.birth.calibration.precision,
            )
            : null;
          supportHeadProbabilityByKey.set(key, { survival: null, birth, death: null, birthDecision });
          probability = rankedSupportHeads ? birthDecision.rankingScore : birth;
          decisionEligible = rankedSupportHeads
            || birth >= conditionalHeads.birth.calibration.threshold;
        }
      } else {
        probability = classifier.predict(input);
      }
      probabilityByKey.set(key, probability);
      const row = { key, site, probability, decisionEligible };
      if (site.sourceOccupied) rankedSourceSites.push(row);
      else rankedBirthSites.push(row);
    }
    const byProbability = (left, right) => (
      right.probability !== left.probability
        ? right.probability - left.probability
        : left.key.localeCompare(right.key)
    );
    rankedSourceSites
      .filter(row => row.decisionEligible)
      .sort(byProbability)
      .slice(0, supportBudget.effectiveSourceSurvivalBudget)
      .forEach(row => selectedKeys.add(row.key));
    rankedBirthSites
      .filter(row => row.decisionEligible)
      .sort(byProbability)
      .slice(0, Math.max(0, Math.min(supportBudget.effectiveBirthSupportBudget, supportBudget.targetSupportBudget - selectedKeys.size)))
      .forEach(row => selectedKeys.add(row.key));
    recordFailureContext('phase-model-feature-prediction', {
      predictionSiteCount: predictionSites.size,
      selectedSupportCount: selectedKeys.size,
      selectedSourceSupportCount: Array.from(selectedKeys).filter(key => sourceRows.has(key)).length,
      selectedBirthSupportCount: Array.from(selectedKeys).filter(key => !sourceRows.has(key)).length,
    });
  }
  const predictedRows = [];
  const predictedRowsByKey = new Map();
  const predictedFeatureByKey = new Map();
  const birthOpacityByKey = new Map();
  let predictedDeaths = 0;
  for (const [key, site] of predictionSites) {
    const input = makeLocalGridOccupancyInput(site.position, sourceRows, siteStats, offset, maxAbsOffset, gridStep);
    const probability = probabilityByKey.get(key) ?? classifier.predict(input);
    probabilityByKey.set(key, probability);
    const predictedOccupied = usesSupportBudget ? selectedKeys.has(key) : probability >= occupancyThreshold;
    if (!predictedOccupied) {
      if (site.sourceOccupied) predictedDeaths += 1;
      continue;
    }
    const stat = siteStats.get(key);
    const predictedFeatures = featureModel.predict(makeSpatialOccupancyInput(site.position, sourceRows, offset, maxAbsOffset)).map(value => Math.max(0, value));
    predictedFeatureByKey.set(key, predictedFeatures);
    const sourceRow = sourceRows.get(key);
    const prototypeSplat = sourceRow?.splat || stat?.prototypeSplat;
    if (!prototypeSplat) continue;
    const row = sourceRow
      ? Array.from(sourceRow.splat)
      : Array.from(stat.prototypeSplat);
    row[0] = site.position[0];
    row[1] = site.position[1];
    row[2] = site.position[2];
    const birthPrecision = splitSupportHeads
      ? conditionalHeads.birth.calibration.precision
      : calibratedThreshold.birth.precision;
    if (!sourceRow) {
      const rawBirthProbability = rankedSupportHeads
        ? supportHeadProbabilityByKey.get(key).birth
        : probability;
      const appliedScale = rankedSupportHeads
        ? supportHeadProbabilityByKey.get(key).birthDecision.opacityScale
        : quotaRankedBirthOpacityScale(rawBirthProbability, birthPrecision);
      birthOpacityByKey.set(key, { rawBirthProbability, appliedScale });
      row[7] *= appliedScale;
    }
    predictedRows.push(row);
    predictedRowsByKey.set(key, { key, position: site.position, splat: row });
  }
  if (!predictedRows.length) {
    recordFailureContext('phase-model-support-selection', {
      predictionSiteCount: predictionSites.size,
      selectedSupportCount: selectedKeys.size,
      predictedRowCount: predictedRows.length,
    });
    const splitDiagnostics = splitSupportHeads
      ? {
        predictionSiteCount: predictionSites.size,
        selectedSiteCount: selectedKeys.size,
        survivalThreshold: conditionalHeads.survival.calibration.threshold,
        birthThreshold: conditionalHeads.birth.calibration.threshold,
        deathThreshold: conditionalHeads.death.calibration.threshold,
        sourceProbabilities: Array.from(supportHeadProbabilityByKey.values())
          .filter(row => row.survival !== null)
          .slice(0, 8),
        birthProbabilities: Array.from(supportHeadProbabilityByKey.values())
          .filter(row => row.birth !== null)
          .slice(0, 8),
      }
      : null;
    throw new Error(`local-grid occupancy classifier predicted no visible candidate sites${splitDiagnostics ? `: ${JSON.stringify(splitDiagnostics)}` : ''}`);
  }
  recordFailureContext('isolated-raster', {
    predictedRowCount: predictedRows.length,
    predictedDeathCount: predictedDeaths,
  });
  const priorRows = [];
  for (const [key, site] of predictionSites) {
    const sourceRow = sourceRows.get(key);
    if (sourceRow) {
      priorRows.push(Array.from(sourceRow.splat));
      continue;
    }
    const stat = siteStats.get(key);
    if (!stat?.prototypeSplat) continue;
    const signedCount = offset >= 0 ? stat.targetPositive : stat.targetNegative;
    if (signedCount <= 0) continue;
    const row = Array.from(stat.prototypeSplat);
    row[7] *= 0.35;
    priorRows.push(row);
  }
  const predictedSplats = new Float32Array(predictedRows.length * SPLAT_STRIDE_FLOATS);
  predictedRows.forEach((row, index) => predictedSplats.set(row, index * SPLAT_STRIDE_FLOATS));
  const priorSplats = new Float32Array(priorRows.length * SPLAT_STRIDE_FLOATS);
  priorRows.forEach((row, index) => priorSplats.set(row, index * SPLAT_STRIDE_FLOATS));
  const evalSiteKeys = new Set([...sourceRows.keys(), ...targetRows.keys(), ...predictionSites.keys()]);
  const predictedOccupiedKeys = new Set();
  for (const key of evalSiteKeys) {
    const predictedOccupied = usesSupportBudget
      ? selectedKeys.has(key)
      : (probabilityByKey.get(key) ?? 0) >= occupancyThreshold;
    if (predictedOccupied) predictedOccupiedKeys.add(key);
  }
  const occupancyPr = emptyPr();
  const birthPr = emptyPr();
  const deathPr = emptyPr();
  const splitHeadPr = splitSupportHeads
    ? {
      survival: { ...emptyPr(), sampleCount: 0 },
      birth: { ...emptyPr(), sampleCount: 0 },
      death: { ...emptyPr(), sampleCount: 0 },
      sourceDecisionDisagreement: {
        sampleCount: 0,
        contradictoryPositive: 0,
        abstained: 0,
        complementary: 0,
      },
    }
    : null;
  const synthesizedBirthKeys = [];
  for (const key of evalSiteKeys) {
    const sourceOccupied = sourceRows.has(key);
    const targetOccupied = targetRows.has(key);
    const budgetedPredictedOccupied = predictedOccupiedKeys.has(key);
    if (budgetedPredictedOccupied && targetOccupied) occupancyPr.truePositive += 1;
    else if (budgetedPredictedOccupied && !targetOccupied) occupancyPr.falsePositive += 1;
    else if (!budgetedPredictedOccupied && targetOccupied) occupancyPr.falseNegative += 1;
    const trueBirth = !sourceOccupied && targetOccupied;
    const predictedBirth = !sourceOccupied && budgetedPredictedOccupied;
    if (predictedBirth && trueBirth) {
      birthPr.truePositive += 1;
      synthesizedBirthKeys.push(key);
    } else if (predictedBirth && !trueBirth) birthPr.falsePositive += 1;
    else if (!predictedBirth && trueBirth) birthPr.falseNegative += 1;
    const trueDeath = sourceOccupied && !targetOccupied;
    const predictedDeath = sourceOccupied && !budgetedPredictedOccupied;
    if (predictedDeath && trueDeath) deathPr.truePositive += 1;
    else if (predictedDeath && !trueDeath) deathPr.falsePositive += 1;
    else if (!predictedDeath && trueDeath) deathPr.falseNegative += 1;
    if (splitSupportHeads) {
      const input = makeLocalGridOccupancyInput(keyToWorldPosition(key), sourceRows, siteStats, offset, maxAbsOffset, gridStep);
      if (sourceOccupied) {
        const probabilities = supportHeadProbabilityByKey.get(key) ?? {
          survival: conditionalHeads.survival.head.predict(input),
          birth: null,
          death: conditionalHeads.death.head.predict(input),
        };
        const survivalLabel = targetOccupied;
        const deathLabel = !targetOccupied;
        const survivalDecision = probabilities.survival >= conditionalHeads.survival.calibration.threshold;
        const deathDecision = probabilities.death >= conditionalHeads.death.calibration.threshold;
        const recordDecision = (row, predicted, label) => {
          row.sampleCount += 1;
          if (predicted && label) row.truePositive += 1;
          else if (predicted && !label) row.falsePositive += 1;
          else if (!predicted && label) row.falseNegative += 1;
        };
        recordDecision(splitHeadPr.survival, survivalDecision, survivalLabel);
        recordDecision(splitHeadPr.death, deathDecision, deathLabel);
        splitHeadPr.sourceDecisionDisagreement.sampleCount += 1;
        if (survivalDecision && deathDecision) splitHeadPr.sourceDecisionDisagreement.contradictoryPositive += 1;
        else if (!survivalDecision && !deathDecision) splitHeadPr.sourceDecisionDisagreement.abstained += 1;
        else splitHeadPr.sourceDecisionDisagreement.complementary += 1;
      } else {
        const birthProbability = supportHeadProbabilityByKey.get(key)?.birth
          ?? conditionalHeads.birth.head.predict(input);
        const birthDecision = birthProbability >= conditionalHeads.birth.calibration.threshold;
        splitHeadPr.birth.sampleCount += 1;
        if (birthDecision && targetOccupied) splitHeadPr.birth.truePositive += 1;
        else if (birthDecision && !targetOccupied) splitHeadPr.birth.falsePositive += 1;
        else if (!birthDecision && targetOccupied) splitHeadPr.birth.falseNegative += 1;
      }
    }
  }
  let identityFeatureSquaredError = 0;
  let predictionFeatureSquaredError = 0;
  let predictedFeatureCount = 0;
  for (const match of holdoutAlignment.matched) {
    const sourceFeatures = featureRow(source.candidates.values, match.sourceIndex);
    const exactFeatures = featureRow(target.candidates.values, match.targetIndex);
    const key = worldPositionStableKey(flatRow(source.splats.values, match.sourceIndex, SPLAT_STRIDE_FLOATS));
    const prediction = predictedFeatureByKey.get(key);
    if (!prediction) continue;
    for (let feature = 0; feature < 16; feature += 1) {
      identityFeatureSquaredError += (sourceFeatures[feature] - exactFeatures[feature]) ** 2;
      predictionFeatureSquaredError += (prediction[feature] - exactFeatures[feature]) ** 2;
      predictedFeatureCount += 1;
    }
  }
  const identityRender = renderBoundarySplatRowsPng(source.splats.values, source.frame.camera, renderOptions);
  const priorRender = renderBoundarySplatRowsPng(priorSplats, source.frame.camera, renderOptions);
  const advectionRender = renderBoundarySplatRowsPng(source.splats.values, source.frame.camera, renderOptions);
  const predictionRender = renderBoundarySplatRowsPng(predictedSplats, source.frame.camera, renderOptions);
  const exactRender = renderBoundarySplatRowsPng(target.splats.values, target.frame.camera, renderOptions);
  let partialFlowDebug = null;
  if (sharedMlxSupport) {
    const requestedGain = Number(options.partialFlowDebugGain ?? 0.625);
    recordFailureContext('partial-flow-debug-validation', {
      requestedPartialFlowDebugGain: requestedGain,
    });
    if (!Number.isFinite(requestedGain) || requestedGain < 0.5 || requestedGain > 0.75) {
      throw new Error('partial flow-debug gain must be finite and within [0.50, 0.75]');
    }
    partialFlowDebug = {
      requestedGain,
      effectiveGain: requestedGain,
      reference: renderSupportFlowDebugMix(exactRender, sourceRows, targetRows, source.frame.camera, renderOptions, gridStep, requestedGain),
      control: renderSupportFlowDebugMix(identityRender, sourceRows, sourceRows, source.frame.camera, renderOptions, gridStep, requestedGain),
      predicted: renderSupportFlowDebugMix(predictionRender, sourceRows, predictedRowsByKey, source.frame.camera, renderOptions, gridStep, requestedGain),
    };
  }
  recordFailureContext('diagnostic-composition', {
    effectivePartialFlowDebugGain: partialFlowDebug?.effectiveGain ?? null,
    beautyRenderCount: 5,
  });
  const exactMinusIdentityRender = renderResidualMapPng(exactRender, identityRender);
  const exactMinusPredictionRender = renderResidualMapPng(exactRender, predictionRender);
  const predictionMinusIdentityRender = renderResidualMapPng(predictionRender, identityRender);
  const churnOverlay = renderSupportChurnOverlay(
    sourceRows,
    targetRows,
    predictionSites,
    predictedOccupiedKeys,
    source.frame.camera,
    renderOptions,
    gridStep,
  );
  const comparisonRender = composeHorizontal([identityRender, priorRender, advectionRender, predictionRender, exactRender]);
  const diagnosticContextRender = composeHorizontal([
    identityRender,
    predictionRender,
    exactRender,
    exactMinusIdentityRender,
    exactMinusPredictionRender,
    churnOverlay.render,
  ]);
  const offsetLabel = offset > 0 ? `p${offset}` : `m${Math.abs(offset)}`;
  recordFailureContext('render-artifact-write', {
    offsetLabel,
    outputDirectory: outDir,
  });
  const artifacts = {
    identity: await writeRenderArtifact(resolve(outDir, `phase-render-identity-${offsetLabel}.png`), identityRender),
    spatialPriorInterpolation: await writeRenderArtifact(resolve(outDir, `phase-render-spatial-prior-${offsetLabel}.png`), priorRender),
    advectionPrior: await writeRenderArtifact(resolve(outDir, `phase-render-advection-prior-${offsetLabel}.png`), advectionRender),
    phasePrediction: await writeRenderArtifact(resolve(outDir, `phase-render-local-grid-occupancy-prediction-${offsetLabel}.png`), predictionRender),
    exactTarget: await writeRenderArtifact(resolve(outDir, `phase-render-exact-${offsetLabel}.png`), exactRender),
    comparison: await writeRenderArtifact(resolve(outDir, `phase-render-local-grid-occupancy-comparison-${offsetLabel}.png`), comparisonRender),
  };
  const diagnosticArtifacts = {
    exactMinusIdentity: await writeRenderArtifact(resolve(outDir, `phase-render-residual-exact-minus-identity-${offsetLabel}.png`), exactMinusIdentityRender),
    exactMinusPrediction: await writeRenderArtifact(resolve(outDir, `phase-render-residual-exact-minus-prediction-${offsetLabel}.png`), exactMinusPredictionRender),
    predictionMinusIdentity: await writeRenderArtifact(resolve(outDir, `phase-render-residual-prediction-minus-identity-${offsetLabel}.png`), predictionMinusIdentityRender),
    supportChurn: await writeRenderArtifact(resolve(outDir, `phase-render-support-churn-overlay-${offsetLabel}.png`), churnOverlay.render),
    missedSupport: await writeRenderArtifact(resolve(outDir, `phase-render-support-churn-missed-support-${offsetLabel}.png`), churnOverlay.categoryRenders.missedSupport),
    falseSupport: await writeRenderArtifact(resolve(outDir, `phase-render-support-churn-false-support-${offsetLabel}.png`), churnOverlay.categoryRenders.falseSupport),
    trueBirth: await writeRenderArtifact(resolve(outDir, `phase-render-support-churn-true-birth-${offsetLabel}.png`), churnOverlay.categoryRenders.trueBirth),
    trueDeath: await writeRenderArtifact(resolve(outDir, `phase-render-support-churn-true-death-${offsetLabel}.png`), churnOverlay.categoryRenders.trueDeath),
    contextSheet: await writeRenderArtifact(resolve(outDir, `phase-render-diagnostic-context-${offsetLabel}.png`), diagnosticContextRender),
  };
  const partialFlowDebugArtifacts = partialFlowDebug
    ? {
      reference: await writeRenderArtifact(resolve(outDir, `phase-render-reference-partial-flow-debug-${offsetLabel}.png`), partialFlowDebug.reference),
      control: await writeRenderArtifact(resolve(outDir, `phase-render-control-partial-flow-debug-${offsetLabel}.png`), partialFlowDebug.control),
      predicted: await writeRenderArtifact(resolve(outDir, `phase-render-predicted-partial-flow-debug-${offsetLabel}.png`), partialFlowDebug.predicted),
    }
    : null;
  const identityPixelMse = imageMse(identityRender.rgba, exactRender.rgba);
  const priorPixelMse = imageMse(priorRender.rgba, exactRender.rgba);
  const advectionPixelMse = imageMse(advectionRender.rgba, exactRender.rgba);
  const predictionPixelMse = imageMse(predictionRender.rgba, exactRender.rgba);
  const quotaBirthOpacity = rankedSupportHeads
    ? (() => {
      const selectedBirthOpacity = Array.from(selectedKeys)
        .filter(key => !sourceRows.has(key))
        .map(key => birthOpacityByKey.get(key))
        .filter(Boolean);
      const birthPrecision = conditionalHeads.birth.calibration.precision;
      const birthThreshold = conditionalHeads.birth.calibration.threshold;
      return {
        authority: 'raw-birth-head-probability-capped-by-calibrated-precision-v0',
        selectedBirthCount: selectedBirthOpacity.length,
        calibratedPrecisionCap: birthPrecision,
        belowDiagnosticThresholdCount: selectedBirthOpacity
          .filter(row => row.rawBirthProbability < birthThreshold).length,
        minimumRawProbability: selectedBirthOpacity.length
          ? Math.min(...selectedBirthOpacity.map(row => row.rawBirthProbability))
          : null,
        minimumAppliedScale: selectedBirthOpacity.length
          ? Math.min(...selectedBirthOpacity.map(row => row.appliedScale))
          : null,
        maximumAppliedScale: selectedBirthOpacity.length
          ? Math.max(...selectedBirthOpacity.map(row => row.appliedScale))
          : null,
        maxAbsAppliedScaleError: selectedBirthOpacity.length
          ? Math.max(...selectedBirthOpacity.map(row => Math.abs(
            row.appliedScale - quotaRankedBirthOpacityScale(row.rawBirthProbability, birthPrecision)
          )))
          : 0,
      };
    })()
    : null;
  const splitSupportHeadMetrics = splitSupportHeads
    ? {
      authority: 'held-out-conditional-support-head-pr-v0',
      survival: { sampleCount: splitHeadPr.survival.sampleCount, ...finishPr(splitHeadPr.survival) },
      birth: { sampleCount: splitHeadPr.birth.sampleCount, ...finishPr(splitHeadPr.birth) },
      death: { sampleCount: splitHeadPr.death.sampleCount, ...finishPr(splitHeadPr.death) },
      sourceDecisionDisagreement: {
        ...splitHeadPr.sourceDecisionDisagreement,
        disagreementRate: (
          splitHeadPr.sourceDecisionDisagreement.contradictoryPositive
          + splitHeadPr.sourceDecisionDisagreement.abstained
        ) / Math.max(1, splitHeadPr.sourceDecisionDisagreement.sampleCount),
      },
    }
    : null;
  const supportHeadReport = splitSupportHeads
    ? Object.fromEntries(Object.entries(conditionalHeads).map(([headName, { head, calibration }]) => [headName, {
      authority: sharedMlxSupport
        ? `shared-mlx-local-grid-${headName}-conditional-head-v0`
        : `conditional-local-grid-${headName}-logistic-head-v0`,
      trainingUniverse: head.trainingUniverse,
      trainSampleCount: head.sampleCount,
      positiveTrainSampleCount: head.positiveCount,
      negativeTrainSampleCount: head.negativeCount,
      epochs: head.epochs,
      learningRate: head.learningRate,
      l2: head.l2,
      loss: head.loss,
      calibration: {
        authority: sharedMlxSupport
          ? sharedMlxModel.artifact.calibration.authority
          : 'training-pair-conditional-pr-threshold-calibration-v0',
        threshold: calibration.threshold,
        beta: calibration.beta,
        precision: calibration.precision,
        recall: calibration.recall,
        fScore: calibration.fScore,
        truePositive: calibration.truePositive,
        falsePositive: calibration.falsePositive,
        falseNegative: calibration.falseNegative,
        sampleCount: calibration.sampleCount,
      },
    }]))
    : null;
  const report = {
    schema: BOUNDARY_SPLAT_PHASE_RENDER_SCHEMA,
    status: 'completed',
    manifest: { path: manifestPath, bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
    route: {
      requested: source.frame.requestedRoute,
      effective: source.frame.effectiveRoute,
      rendererIdentity: source.frame.rendererIdentity,
      sourceAuthority: source.frame.sourceAuthority,
      fallbackReason: source.frame.fallbackReason,
    },
    attributeModel: { path: modelPath, sha256: sha256(modelBytes), identity: compiledAttributeModel.identity },
    phaseModel: {
      family: requestedFamily,
      holdoutAuthority: 'entire-offset-pair-plus-target-frame-held-out-v0',
      heldOutOffset: offset,
      heldOutFrameIds: Array.from(heldOutFrameIds),
      trainingOffsets: trainingOffsets.sort((a, b) => a - b),
      localGrid: {
        authority: 'world-position-neighborhood-source-context-v0',
        gridStep,
        neighborCount: LOCAL_GRID_NEIGHBOR_OFFSETS.length,
        featureCount: splitSupportHeads ? conditionalHeads.survival.head.inputSize : classifier.inputSize,
      },
      ...(!splitSupportHeads ? { occupancy: {
        authority: 'calibrated-local-grid-logistic-occupancy-classifier-v0',
        trainSampleCount: classifier.sampleCount,
        positiveTrainSampleCount: classifier.positiveCount,
        trainingUniverse: {
          authority: budgetedSupport
            ? 'prediction-site-source-absent-target-absent-negatives-v0'
            : 'source-target-union-occupancy-samples-v0',
          sourceAbsentTargetAbsentNegativeCount: classifier.sourceAbsentTargetAbsentNegativeCount,
        },
        epochs: classifier.epochs,
        learningRate: classifier.learningRate,
        l2: classifier.l2,
        calibration: {
          authority: 'training-pair-precision-recall-threshold-calibration-v0',
          threshold: occupancyThreshold,
          precision: calibratedThreshold.precision,
          recall: calibratedThreshold.recall,
          fScore: calibratedThreshold.fScore,
          birth: calibratedThreshold.birth,
          death: calibratedThreshold.death,
        },
        synthesizedBirthKeys,
        predictedDeaths,
      } } : {
        supportHeads: {
          authority: sharedMlxSupport
            ? 'shared-mlx-local-grid-survival-birth-death-trunk-v0'
            : 'conditional-local-grid-survival-birth-death-heads-v0',
          ...supportHeadReport,
        },
        ...(sharedMlxSupport ? {
          sharedTrunk: {
            authority: 'shared-mlx-local-grid-phase-churn-model-artifact-v0',
            path: sharedMlxModelPath,
            sha256: sha256(sharedMlxModelBytes),
            identity: sharedMlxModel.artifact.identity,
            architectureAuthority: sharedMlxModel.artifact.architecture.authority,
            hiddenSize: sharedMlxModel.hiddenSize,
            backend: sharedMlxModel.artifact.route.backend,
            device: sharedMlxModel.artifact.route.device,
            effectiveRunner: sharedMlxModel.artifact.route.effectiveRunner,
            fallbackReason: sharedMlxModel.artifact.route.fallbackReason,
            inputAuthority: sharedMlxModel.artifact.input.authority,
            candidateFeatureCount: sharedMlxModel.artifact.input.candidateFeatureCount,
            training: sharedMlxModel.artifact.training,
          },
          objectives: sharedMlxModel.artifact.objectives,
        } : {}),
        supportDecision: {
          authority: sharedMlxSupport
            ? 'shared-trunk-ranked-support-budget-v0'
            : (quotaRankedSupport
              ? 'quota-ranked-split-head-support-budget-v0'
              : 'split-head-threshold-gated-support-budget-v0'),
          thresholdRole: rankedSupportHeads ? 'diagnostic-only' : 'eligibility-gate',
          sourceScore: rankedSupportHeads
            ? 'calibrated-survival-margin-minus-calibrated-death-margin'
            : 'survival-probability-times-one-minus-death-probability',
          birthScore: rankedSupportHeads ? 'calibrated-birth-margin' : 'birth-probability',
          ...(rankedSupportHeads ? {
            birthDecisionAuthority: 'calibrated-margin-ranking-plus-raw-probability-opacity-v0',
          } : {}),
          ...(rankedSupportHeads ? { birthOpacity: quotaBirthOpacity } : {}),
          sourceRule: rankedSupportHeads
            ? 'rank-all-source-sites-and-fill-learned-source-survival-quota'
            : 'survival-positive-and-calibrated-margin-not-weaker-than-death-then-budget-ranked',
          birthRule: rankedSupportHeads
            ? 'rank-all-birth-sites-and-fill-learned-birth-quota-within-target-budget'
            : 'birth-positive-then-budget-ranked',
          sourceCandidateCount: Array.from(predictionSites.values()).filter(site => site.sourceOccupied).length,
          birthCandidateCount: Array.from(predictionSites.values()).filter(site => !site.sourceOccupied).length,
          selectedSourceSupport: Array.from(selectedKeys).filter(key => sourceRows.has(key)).length,
          selectedBirthSupport: Array.from(selectedKeys).filter(key => !sourceRows.has(key)).length,
          predictedDeaths,
        },
      }),
      featureHead: {
        authority: 'offset-conditioned-spatial-feature-ridge-v0',
        trainSampleCount: featureTrainingSampleCount,
        ridgeLambda,
      },
      ...(supportBudget ? { supportBudget } : {}),
    },
    alignment: {
      identityKey: 'world-position-stable-key',
      matched: holdoutAlignment.matchedCount,
      births: holdoutAlignment.birthCount,
      deaths: holdoutAlignment.deathCount,
      birthSynthesis: 'local-grid-classifier-training-site-synthesis-v0',
      synthesizedBirths: synthesizedBirthKeys.length,
      deathHandling: splitSupportHeads
        ? (rankedSupportHeads
          ? (sharedMlxSupport
            ? 'shared-trunk-calibrated-survival-versus-death-margin-v0'
            : 'quota-ranked-calibrated-survival-versus-death-margin-v0')
          : 'split-calibrated-survival-versus-death-margin-v0')
        : 'local-grid-classifier-occupancy-threshold',
      predictedDeaths,
    },
    metrics: {
      occupancyPrecisionRecall: {
        authority: 'held-out-site-occupancy-pr-v0',
        ...finishPr(occupancyPr),
      },
      birthDeathPrecisionRecall: {
        authority: 'held-out-birth-death-pr-v0',
        birth: finishPr(birthPr),
        death: finishPr(deathPr),
      },
      ...(splitSupportHeads ? { splitSupportHeads: splitSupportHeadMetrics } : {}),
    },
    diagnostics: {
      residuals: {
        authority: 'phase-render-raster-residual-maps-v0',
        interpretation: 'Residual maps encode luminance delta under the isolated captured-splat raster route; warm means the first named image is brighter, blue means the second named image is brighter.',
        artifacts: {
          exactMinusIdentity: diagnosticArtifacts.exactMinusIdentity,
          exactMinusPrediction: diagnosticArtifacts.exactMinusPrediction,
          predictionMinusIdentity: diagnosticArtifacts.predictionMinusIdentity,
        },
        maxAbsLuminanceDelta: {
          exactMinusIdentity: exactMinusIdentityRender.maxAbsLuminanceDelta,
          exactMinusPrediction: exactMinusPredictionRender.maxAbsLuminanceDelta,
          predictionMinusIdentity: predictionMinusIdentityRender.maxAbsLuminanceDelta,
        },
        positivePixelCount: {
          exactMinusIdentity: exactMinusIdentityRender.positivePixelCount,
          exactMinusPrediction: exactMinusPredictionRender.positivePixelCount,
          predictionMinusIdentity: predictionMinusIdentityRender.positivePixelCount,
        },
        negativePixelCount: {
          exactMinusIdentity: exactMinusIdentityRender.negativePixelCount,
          exactMinusPrediction: exactMinusPredictionRender.negativePixelCount,
          predictionMinusIdentity: predictionMinusIdentityRender.negativePixelCount,
        },
      },
      churnOverlay: {
        authority: 'world-position-support-churn-overlay-v0',
        interpretation: 'Categorical world-position support overlay: green true survival, yellow true birth, red missed target support, orange false predicted support, blue true death.',
        artifacts: {
          supportChurn: diagnosticArtifacts.supportChurn,
          missedSupport: diagnosticArtifacts.missedSupport,
          falseSupport: diagnosticArtifacts.falseSupport,
          trueBirth: diagnosticArtifacts.trueBirth,
          trueDeath: diagnosticArtifacts.trueDeath,
        },
        counts: churnOverlay.counts,
      },
      inspection: {
        authority: 'phase-render-diagnostic-context-sheet-v0',
        blocks: ['identity', 'phasePrediction', 'exactTarget', 'exactMinusIdentity', 'exactMinusPrediction', 'supportChurn'],
        artifacts: {
          contextSheet: diagnosticArtifacts.contextSheet,
        },
        note: 'Raw PNG has no embedded text labels; report block order and artifact names carry panel identity.',
      },
      ...(partialFlowDebug ? {
        partialFlowDebug: {
          authority: 'display-only-support-flow-debug-mix-v0',
          debugIdentity: 'stable-world-position-survival-birth-death-display-v0',
          requestedGain: partialFlowDebug.requestedGain,
          effectiveGain: partialFlowDebug.effectiveGain,
          changesRendererState: false,
          changesApplicationState: false,
          changesSimulationState: false,
          renderBackend: 'isolated-cpu-projected-boundary-splat-raster-v0',
          sameFrameCameraCrop: true,
          frameCustody: {
            sourceFrameId: heldOutPair.sourceFrameId,
            targetFrameId: heldOutPair.targetFrameId,
            offsetSteps: offset,
          },
          roles: {
            reference: {
              semanticRole: 'reference',
              beauty: artifacts.exactTarget,
              partial: partialFlowDebugArtifacts.reference,
              supportChangeCounts: partialFlowDebug.reference.counts,
            },
            control: {
              semanticRole: 'control',
              beauty: artifacts.identity,
              partial: partialFlowDebugArtifacts.control,
              supportChangeCounts: partialFlowDebug.control.counts,
            },
            predicted: {
              semanticRole: 'predicted',
              beauty: artifacts.phasePrediction,
              partial: partialFlowDebugArtifacts.predicted,
              supportChangeCounts: partialFlowDebug.predicted.counts,
            },
          },
          interpretation: 'Blue marks retained source support, cyan marks source-absent active support, and magenta marks source support absent from the role. The mix is additive to each role beauty image and does not claim vector-flow authority.',
        },
      } : {}),
    },
    featureMetrics: {
      identityMse: identityFeatureSquaredError / Math.max(1, predictedFeatureCount),
      phasePredictionMse: predictionFeatureSquaredError / Math.max(1, predictedFeatureCount),
      beatsIdentity: predictionFeatureSquaredError < identityFeatureSquaredError,
      modelToIdentityRatio: predictionFeatureSquaredError / Math.max(1e-12, identityFeatureSquaredError),
      matchedFeatureValuesCompared: predictedFeatureCount,
    },
    pixelMetrics: {
      identityToExactMse: identityPixelMse,
      spatialPriorInterpolationToExactMse: priorPixelMse,
      advectionPriorToExactMse: advectionPixelMse,
      phasePredictionToExactMse: predictionPixelMse,
      beatsIdentity: predictionPixelMse < identityPixelMse,
      beatsSpatialPriorInterpolation: predictionPixelMse <= priorPixelMse,
      beatsAdvectionPrior: predictionPixelMse <= advectionPixelMse,
      modelToIdentityRatio: predictionPixelMse / Math.max(1e-12, identityPixelMse),
    },
    baselines: {
      currentCopy: {
        authority: 'current-source-splat-copy-baseline-v0',
        pixelMse: identityPixelMse,
        inputSplats: source.splats.count,
      },
      spatialPriorInterpolation: {
        authority: 'nearest-offset-site-prior-interpolation-baseline-v0',
        pixelMse: priorPixelMse,
        inputSplats: priorRows.length,
      },
      advectionPrior: {
        authority: 'zero-velocity-world-site-advection-baseline-v0',
        pixelMse: advectionPixelMse,
        inputSplats: source.splats.count,
      },
    },
    renders: {
      authority: 'isolated-cpu-projected-boundary-splat-raster-v0',
      blocks: ['identity', 'spatialPriorInterpolation', 'advectionPrior', 'phasePrediction', 'exactTarget'],
      width: renderOptions.width,
      height: renderOptions.height,
      radiusMultiplier: renderOptions.radiusMultiplier,
      kernelSharpness: renderOptions.kernelSharpness,
      artifacts,
      inputSplats: {
        identity: source.splats.count,
        spatialPriorInterpolation: priorRows.length,
        advectionPrior: source.splats.count,
        phasePrediction: predictedRows.length,
        exactTarget: target.splats.count,
      },
      visibleSupport: {
        identity: identityRender.nonBackgroundPixelCount,
        spatialPriorInterpolation: priorRender.nonBackgroundPixelCount,
        advectionPrior: advectionRender.nonBackgroundPixelCount,
        phasePrediction: predictionRender.nonBackgroundPixelCount,
        exactTarget: exactRender.nonBackgroundPixelCount,
      },
    },
    claimBoundary: 'isolated captured-splat raster; local-grid support models use training-observed world sites and zero-velocity advection baseline; partial flow-debug is a display-only stable-support diagnostic rather than vector flow; live runtime instancing is unchanged',
  };
  recordFailureContext('report-write', {
    completedArtifactCount: Object.keys(artifacts).length
      + Object.keys(diagnosticArtifacts).length
      + Object.keys(partialFlowDebugArtifacts ?? {}).length,
  });
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

export async function writeBoundarySplatPhaseRenderWitness(manifestFile, options = {}) {
  const manifestPath = resolve(String(manifestFile));
  const outDir = resolve(String(options.outDir || dirname(manifestPath)));
  const reportPath = resolve(String(options.report || `${outDir}/phase-render-witness.json`));
  let failurePhase = 'manifest-read';
  const lastTrustworthyEvidence = { manifestPath };
  const recordFailureContext = (phase, evidence = {}) => {
    failurePhase = phase;
    Object.assign(lastTrustworthyEvidence, evidence);
  };
  try {
    await mkdir(outDir, { recursive: true });
    const manifestBytes = await readFile(manifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    if (manifest.schema !== 'kaminos-boundary-splat-phase-candidate-corpus-v0') throw new Error('phase render witness requires the phase candidate corpus schema');
    if (manifest.temporalAlignment?.identityKey !== 'world-position-stable-key') throw new Error('phase render witness requires world-position-stable-key alignment');
    const offset = Number(options.offset ?? 3);
    if (!Number.isInteger(offset) || offset === 0) throw new Error('phase render witness offset must be a nonzero integer');
    const heldOutPair = manifest.temporalAlignment.pairs.find(pair => pair.offsetSteps === offset);
    if (!heldOutPair) throw new Error(`phase render witness offset ${offset} is not present in the corpus`);
    const frameById = new Map(manifest.frames.map(frame => [frame.id, frame]));
    for (const frame of manifest.frames) validateBoundarySplatPhaseRenderFrame(frame);
    const baseDir = dirname(manifestPath);
    failurePhase = 'artifact-validation';
    const loadedFrames = new Map();
    for (const frame of manifest.frames) {
      const candidates = await readFloatArtifact(frame.candidates, 16, baseDir, `${frame.id} candidates`);
      const splats = await readFloatArtifact(frame.splats, 12, baseDir, `${frame.id} splats`);
      if (candidates.count !== splats.count) throw new Error(`${frame.id} candidate/splat counts differ`);
      loadedFrames.set(frame.id, { frame, candidates, splats });
    }
    lastTrustworthyEvidence.validatedFrameCount = loadedFrames.size;
    const modelPath = resolve(String(options.model || 'models/boundary-splat-attribute/live-support-h64-v0/model-artifact.json'));
    const modelBytes = await readFile(modelPath);
    const attributeModel = JSON.parse(modelBytes.toString('utf8'));
    const compiledAttributeModel = compileBoundarySplatAttributeModel(attributeModel);
    const modelIdentities = new Set(manifest.frames.map(frame => frame.modelIdentity));
    if (modelIdentities.size !== 1 || !modelIdentities.has(compiledAttributeModel.identity)) {
      throw new Error(`deployed attribute model identity mismatch: corpus=${Array.from(modelIdentities).join(',')} loaded=${compiledAttributeModel.identity}`);
    }
    failurePhase = 'phase-model-fit';
    const maxAbsOffset = Math.max(...manifest.temporalAlignment.offsetSteps.map(value => Math.abs(value)));
    const accumulator = makeStreamingRidge(18, 16);
    const trainingOffsets = [];
    const trainingPairs = [];
    for (const pair of manifest.temporalAlignment.pairs) {
      if (pair.offsetSteps === offset) continue;
      trainingOffsets.push(pair.offsetSteps);
      trainingPairs.push(pair);
      const source = loadedFrames.get(pair.sourceFrameId);
      const target = loadedFrames.get(pair.targetFrameId);
      const alignment = alignBoundarySplatRowsByWorldPosition(source.splats.values, target.splats.values);
      if (alignment.matchedCount !== pair.matchedSlots) throw new Error(`training offset ${pair.offsetSteps} world-position match count drift`);
      for (const match of alignment.matched) {
        addStreamingRidgeSample(
          accumulator,
          phaseInput(featureRow(source.candidates.values, match.sourceIndex), pair.offsetSteps, maxAbsOffset),
          featureRow(target.candidates.values, match.targetIndex),
        );
      }
    }
    const ridgeLambda = Number(options.ridgeLambda ?? 1e-3);
    const phaseModel = finishStreamingRidge(accumulator, ridgeLambda);
    const source = loadedFrames.get(heldOutPair.sourceFrameId);
    const target = loadedFrames.get(heldOutPair.targetFrameId);
    const holdoutAlignment = alignBoundarySplatRowsByWorldPosition(source.splats.values, target.splats.values);
    if (holdoutAlignment.matchedCount !== heldOutPair.matchedSlots) throw new Error('held-out world-position match count drift');
    failurePhase = 'held-out-prediction';
    const predictedFeatures = new Float32Array(source.candidates.count * 16);
    for (let sourceIndex = 0; sourceIndex < source.candidates.count; sourceIndex += 1) {
      const prediction = phaseModel.predict(phaseInput(featureRow(source.candidates.values, sourceIndex), offset, maxAbsOffset));
      predictedFeatures.set(prediction, sourceIndex * 16);
    }
    let identityFeatureSquaredError = 0;
    let predictionFeatureSquaredError = 0;
    for (const match of holdoutAlignment.matched) {
      const sourceFeatures = featureRow(source.candidates.values, match.sourceIndex);
      const exactFeatures = featureRow(target.candidates.values, match.targetIndex);
      const prediction = featureRow(predictedFeatures, match.sourceIndex);
      for (let feature = 0; feature < 16; feature += 1) {
        identityFeatureSquaredError += (sourceFeatures[feature] - exactFeatures[feature]) ** 2;
        predictionFeatureSquaredError += (prediction[feature] - exactFeatures[feature]) ** 2;
      }
    }
    const errorDenominator = Math.max(1, holdoutAlignment.matchedCount * 16);
    const effectiveUrl = new URL(source.frame.effectiveRoute, 'http://127.0.0.1/');
    const gridSize = Number(options.gridSize || effectiveUrl.searchParams.get('volume_resolution') || 160);
    failurePhase = 'phase-step-calibration';
    const calibrationNumerator = new Float64Array(9);
    const calibrationDenominator = new Float64Array(9);
    let calibrationSampleCount = 0;
    const inferenceChunkRows = 8192;
    for (const pair of trainingPairs) {
      const calibrationSource = loadedFrames.get(pair.sourceFrameId);
      const calibrationTarget = loadedFrames.get(pair.targetFrameId);
      const calibrationAlignment = alignBoundarySplatRowsByWorldPosition(calibrationSource.splats.values, calibrationTarget.splats.values);
      for (let start = 0; start < calibrationAlignment.matchedCount; start += inferenceChunkRows) {
        const end = Math.min(start + inferenceChunkRows, calibrationAlignment.matchedCount);
        const batchFeatures = [];
        for (let index = start; index < end; index += 1) {
          const sourceIndex = calibrationAlignment.matched[index].sourceIndex;
          batchFeatures.push(phaseModel.predict(phaseInput(featureRow(calibrationSource.candidates.values, sourceIndex), pair.offsetSteps, maxAbsOffset)));
        }
        const attributes = evaluateBoundarySplatAttributeModel(attributeModel, batchFeatures);
        for (let index = start; index < end; index += 1) {
          const match = calibrationAlignment.matched[index];
          const sourceSplat = calibrationSource.splats.values.subarray(match.sourceIndex * 12, (match.sourceIndex + 1) * 12);
          const targetSplat = calibrationTarget.splats.values.subarray(match.targetIndex * 12, (match.targetIndex + 1) * 12);
          const rawPrediction = predictedSplatRow(sourceSplat, batchFeatures[index - start], attributes[index - start], gridSize, false);
          for (let channel = 3; channel < SPLAT_STRIDE_FLOATS; channel += 1) {
            const predictedDelta = rawPrediction[channel] - sourceSplat[channel];
            calibrationNumerator[channel - 3] += predictedDelta * (targetSplat[channel] - sourceSplat[channel]);
            calibrationDenominator[channel - 3] += predictedDelta * predictedDelta;
          }
          calibrationSampleCount += 1;
        }
      }
    }
    const calibrationScales = Array.from(calibrationNumerator, (numerator, index) => (
      Math.max(0, Math.min(1, numerator / Math.max(1e-12, calibrationDenominator[index])))
    ));
    const predictedSplats = new Float32Array(source.splats.count * 12);
    for (let start = 0; start < source.splats.count; start += inferenceChunkRows) {
      const end = Math.min(start + inferenceChunkRows, source.splats.count);
      const batch = Array.from({ length: end - start }, (_, index) => Array.from(featureRow(predictedFeatures, start + index)));
      const attributes = evaluateBoundarySplatAttributeModel(attributeModel, batch);
      for (let index = start; index < end; index += 1) {
        const sourceSplat = source.splats.values.subarray(index * 12, (index + 1) * 12);
        const rawPrediction = predictedSplatRow(sourceSplat, featureRow(predictedFeatures, index), attributes[index - start], gridSize, false);
        predictedSplats.set(calibratePredictedSplatRow(sourceSplat, rawPrediction, calibrationScales), index * 12);
      }
    }
    failurePhase = 'isolated-raster';
    const width = Math.max(1, Math.floor(Number(options.width || 640)));
    const height = Math.max(1, Math.floor(Number(options.height || 480)));
    const radiusMultiplier = Number(options.radiusMultiplier ?? source.frame.camera.controls?.[0] ?? 1);
    const kernelSharpness = Number(options.kernelSharpness ?? source.frame.camera.controls?.[3] ?? 6.5);
    const renderOptions = { width, height, radiusMultiplier, kernelSharpness };
    const phaseModelFamily = String(options.phaseModelFamily || options.modelFamily || 'ridge-linear-offset-conditioned-v0');
    if (phaseModelFamily === 'spatial-occupancy-ridge-v0') {
      return await runSpatialOccupancyRenderWitness({
        manifestBytes,
        manifestPath,
        outDir,
        reportPath,
        source,
        target,
        heldOutPair,
        trainingPairs,
        trainingOffsets,
        loadedFrames,
        attributeModel,
        compiledAttributeModel,
        modelPath,
        modelBytes,
        offset,
        maxAbsOffset,
        holdoutAlignment,
        gridSize,
        renderOptions,
        ridgeLambda,
        options,
      });
    }
    if (phaseModelFamily === 'local-grid-occupancy-classifier-v0'
      || phaseModelFamily === 'dense-negative-budgeted-local-grid-occupancy-v0'
      || phaseModelFamily === 'split-survival-birth-death-local-grid-v0'
      || phaseModelFamily === 'quota-ranked-survival-birth-death-local-grid-v0'
      || phaseModelFamily === 'shared-mlx-survival-birth-death-local-grid-v0') {
      if (phaseModelFamily === 'shared-mlx-survival-birth-death-local-grid-v0') {
        failurePhase = 'phase-model-artifact-validation';
        lastTrustworthyEvidence.requestedPhaseModelFamily = phaseModelFamily;
        lastTrustworthyEvidence.phaseModelArtifactPath = options.phaseModelArtifact
          ? resolve(String(options.phaseModelArtifact))
          : null;
      }
      return await runLocalGridOccupancyRenderWitness({
        manifestBytes,
        manifestPath,
        outDir,
        reportPath,
        source,
        target,
        heldOutPair,
        trainingPairs,
        trainingOffsets,
        loadedFrames,
        attributeModel,
        compiledAttributeModel,
        modelPath,
        modelBytes,
        offset,
        maxAbsOffset,
        holdoutAlignment,
        gridSize,
        renderOptions,
        ridgeLambda,
        options,
        recordFailureContext,
      });
    }
    if (phaseModelFamily !== 'ridge-linear-offset-conditioned-v0') {
      throw new Error(`unsupported phase render model family ${phaseModelFamily}`);
    }
    const identityRender = renderBoundarySplatRowsPng(source.splats.values, source.frame.camera, renderOptions);
    const predictionRender = renderBoundarySplatRowsPng(predictedSplats, source.frame.camera, renderOptions);
    const exactRender = renderBoundarySplatRowsPng(target.splats.values, target.frame.camera, renderOptions);
    const comparisonRender = composeHorizontal([identityRender, predictionRender, exactRender]);
    const offsetLabel = offset > 0 ? `p${offset}` : `m${Math.abs(offset)}`;
    const artifacts = {
      identity: await writeRenderArtifact(resolve(outDir, `phase-render-identity-${offsetLabel}.png`), identityRender),
      phasePrediction: await writeRenderArtifact(resolve(outDir, `phase-render-prediction-${offsetLabel}.png`), predictionRender),
      exactTarget: await writeRenderArtifact(resolve(outDir, `phase-render-exact-${offsetLabel}.png`), exactRender),
      comparison: await writeRenderArtifact(resolve(outDir, `phase-render-comparison-${offsetLabel}.png`), comparisonRender),
    };
    failurePhase = 'report-write';
    const identityPixelMse = imageMse(identityRender.rgba, exactRender.rgba);
    const predictionPixelMse = imageMse(predictionRender.rgba, exactRender.rgba);
    const report = {
      schema: BOUNDARY_SPLAT_PHASE_RENDER_SCHEMA,
      status: 'completed',
      manifest: { path: manifestPath, bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) },
      route: {
        requested: source.frame.requestedRoute,
        effective: source.frame.effectiveRoute,
        rendererIdentity: source.frame.rendererIdentity,
        sourceAuthority: source.frame.sourceAuthority,
        fallbackReason: source.frame.fallbackReason,
      },
      attributeModel: { path: modelPath, sha256: sha256(modelBytes), identity: compiledAttributeModel.identity },
      phaseModel: {
        family: 'ridge-linear-offset-conditioned-v0',
        holdoutAuthority: 'entire-offset-pair-held-out-v0',
        heldOutOffset: offset,
        trainingOffsets: trainingOffsets.sort((a, b) => a - b),
        trainSampleCount: phaseModel.sampleCount,
        holdoutSampleCount: holdoutAlignment.matchedCount,
        ridgeLambda,
        calibration: {
          authority: 'training-offset-captured-splat-residual-calibration-v0',
          offsets: trainingOffsets.slice().sort((a, b) => a - b),
          sampleCount: calibrationSampleCount,
          channels: ['support', 'color.r', 'color.g', 'color.b', 'opacity', 'shape.x', 'shape.y', 'ridge', 'fireSignal'],
          scales: calibrationScales,
          range: [0, 1],
        },
      },
      alignment: {
        identityKey: 'world-position-stable-key',
        matched: holdoutAlignment.matchedCount,
        births: holdoutAlignment.birthCount,
        deaths: holdoutAlignment.deathCount,
        birthSynthesis: 'unsupported-in-v0',
        deathHandling: 'predicted-structural-support-threshold',
      },
      featureMetrics: {
        identityMse: identityFeatureSquaredError / errorDenominator,
        phasePredictionMse: predictionFeatureSquaredError / errorDenominator,
        beatsIdentity: predictionFeatureSquaredError < identityFeatureSquaredError,
        modelToIdentityRatio: predictionFeatureSquaredError / Math.max(1e-12, identityFeatureSquaredError),
      },
      pixelMetrics: {
        identityToExactMse: identityPixelMse,
        phasePredictionToExactMse: predictionPixelMse,
        beatsIdentity: predictionPixelMse < identityPixelMse,
        modelToIdentityRatio: predictionPixelMse / Math.max(1e-12, identityPixelMse),
      },
      renders: {
        authority: 'isolated-cpu-projected-boundary-splat-raster-v0',
        blocks: ['identity', 'phasePrediction', 'exactTarget'],
        width,
        height,
        radiusMultiplier,
        kernelSharpness,
        artifacts,
        inputSplats: {
          identity: source.splats.count,
          phasePrediction: source.splats.count,
          exactTarget: target.splats.count,
        },
        visibleSupport: {
          identity: identityRender.nonBackgroundPixelCount,
          phasePrediction: predictionRender.nonBackgroundPixelCount,
          exactTarget: exactRender.nonBackgroundPixelCount,
        },
      },
      claimBoundary: 'isolated captured-splat raster; predicted attributes use source world positions, births are not synthesized, and live runtime instancing is unchanged',
    };
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    await mkdir(dirname(reportPath), { recursive: true });
    const failure = {
      schema: BOUNDARY_SPLAT_PHASE_RENDER_SCHEMA,
      status: 'failed',
      failurePhase,
      error: error?.stack || error?.message || String(error),
      lastTrustworthyEvidence,
    };
    await writeFile(reportPath, JSON.stringify(failure, null, 2));
    throw error;
  }
}

function writeRgbaPng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) continue;
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) parsed.set(item, '1');
    else {
      parsed.set(item, next);
      index += 1;
    }
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = parseArgs(process.argv.slice(2));
  const manifest = args.get('--manifest');
  if (!manifest) {
    console.error('Usage: node boundary-splat-phase-render-witness.mjs --manifest <phase-corpus.json> [--model <model-artifact.json>] [--offset 3] [--phase-model-family ridge-linear-offset-conditioned-v0|spatial-occupancy-ridge-v0|local-grid-occupancy-classifier-v0|dense-negative-budgeted-local-grid-occupancy-v0|split-survival-birth-death-local-grid-v0|quota-ranked-survival-birth-death-local-grid-v0|shared-mlx-survival-birth-death-local-grid-v0] [--phase-model-artifact <phase-model.json>] [--partial-flow-debug-gain 0.625] [--out-dir <dir>] [--report <json>]');
    process.exitCode = 2;
  } else {
    try {
      const report = await writeBoundarySplatPhaseRenderWitness(manifest, {
        model: args.get('--model'),
        offset: args.get('--offset'),
        outDir: args.get('--out-dir'),
        report: args.get('--report'),
        width: args.get('--width'),
        height: args.get('--height'),
        gridSize: args.get('--grid-size'),
        ridgeLambda: args.get('--ridge-lambda'),
        phaseModelFamily: args.get('--phase-model-family'),
        phaseModelArtifact: args.get('--phase-model-artifact'),
        partialFlowDebugGain: args.get('--partial-flow-debug-gain'),
        occupancyThreshold: args.get('--occupancy-threshold'),
        localGridEpochs: args.get('--local-grid-epochs'),
        localGridLearningRate: args.get('--local-grid-learning-rate'),
        localGridL2: args.get('--local-grid-l2'),
        gridStep: args.get('--grid-step'),
      });
      console.log(JSON.stringify(report, null, 2));
    } catch (error) {
      console.error(error?.stack || error?.message || String(error));
      process.exitCode = 1;
    }
  }
}
