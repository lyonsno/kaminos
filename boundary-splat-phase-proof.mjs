import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

import {
  BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA,
  validateBoundarySplatSupervisionCorpus,
} from './boundary-splat-supervision-corpus.mjs';

export const BOUNDARY_SPLAT_PHASE_PROOF_SCHEMA = 'kaminos-boundary-splat-phase-proof-v0';
export const BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA = 'kaminos-boundary-splat-phase-candidate-corpus-v0';
const CANDIDATE_STRIDE_FLOATS = 19;
const FEATURE_OFFSET = 3;
const FEATURE_COUNT = 16;
const FEATURE_ORDER = Object.freeze([
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
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readFloat32Rows(bytes, count, stride, label) {
  const expectedBytes = count * stride * Float32Array.BYTES_PER_ELEMENT;
  if (bytes.byteLength !== expectedBytes) throw new Error(`${label} bytes do not match count/stride`);
  const values = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / Float32Array.BYTES_PER_ELEMENT);
  const rows = [];
  for (let rowIndex = 0; rowIndex < count; rowIndex += 1) {
    const offset = rowIndex * stride;
    const row = Array.from(values.slice(offset, offset + stride));
    if (row.some(value => !Number.isFinite(value))) throw new Error(`${label} contains non-finite candidate data`);
    rows.push(row);
  }
  return rows;
}

function featureSlice(row) {
  return row.slice(FEATURE_OFFSET, FEATURE_OFFSET + FEATURE_COUNT);
}

function exactFeatureOrder(actual) {
  return Array.isArray(actual) && actual.length === FEATURE_ORDER.length && actual.every((value, index) => value === FEATURE_ORDER[index]);
}

function validateSharedTemporalAlignment(alignment, frameIds) {
  if (!alignment || typeof alignment !== 'object' || Array.isArray(alignment)) throw new Error('phase corpus requires temporal alignment evidence');
  if (alignment.schema !== BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA) throw new Error(`temporal alignment schema must be ${BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA}`);
  if (alignment.alignmentMethod !== 'grid-cell-slot' && alignment.alignmentMethod !== 'world-position-stable-key') {
    throw new Error('temporal alignment method must be stable grid-cell-slot or world-position-stable-key evidence');
  }
  if (alignment.identityKey !== alignment.alignmentMethod) throw new Error('temporal alignment identityKey must match alignment method');
  if (!Array.isArray(alignment.offsetSteps) || alignment.offsetSteps.some(offset => !Number.isInteger(offset) || offset === 0)) {
    throw new Error('temporal alignment offsetSteps must be nonzero integers');
  }
  const positives = alignment.offsetSteps.filter(offset => offset > 0);
  const negatives = alignment.offsetSteps.filter(offset => offset < 0);
  if (positives.length < 3 || negatives.length < 3) throw new Error('temporal alignment must include at least three positive and three negative offsets');
  if (!alignment.offsetSteps.some(offset => Math.abs(offset) <= 2) || !alignment.offsetSteps.some(offset => Math.abs(offset) >= 4)) {
    throw new Error('temporal alignment must include both easy and harder offset ranges');
  }
  if (!Array.isArray(alignment.pairs) || alignment.pairs.length === 0) throw new Error('temporal alignment must contain pairs');
  const declaredOffsets = new Set(alignment.offsetSteps);
  for (const [index, pair] of alignment.pairs.entries()) {
    const label = `temporal pair ${index}`;
    if (!frameIds.has(pair.sourceFrameId) || !frameIds.has(pair.targetFrameId)) throw new Error(`${label} references missing frame id`);
    if (pair.sourceFrameId === pair.targetFrameId) throw new Error(`${label} must compare distinct frames`);
    if (!declaredOffsets.has(pair.offsetSteps)) throw new Error(`${label} offsetSteps must be declared`);
    for (const field of ['sourceCount', 'targetCount']) {
      if (!Number.isInteger(pair[field]) || pair[field] <= 0) throw new Error(`${label} ${field} must be positive`);
    }
    for (const field of ['matchedSlots', 'births', 'deaths', 'stableSupportCount']) {
      if (!Number.isInteger(pair[field]) || pair[field] < 0) throw new Error(`${label} ${field} must be non-negative`);
    }
    if (pair.matchedSlots > Math.min(pair.sourceCount, pair.targetCount)) throw new Error(`${label} matchedSlots exceeds source/target counts`);
    if (pair.matchedSlots + pair.births > pair.targetCount) throw new Error(`${label} births exceed target count`);
    if (pair.matchedSlots + pair.deaths > pair.sourceCount) throw new Error(`${label} deaths exceed source count`);
    if (pair.stableSupportCount > pair.matchedSlots) throw new Error(`${label} stable support exceeds matched slots`);
  }
  return {
    schema: BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA,
    identityKey: alignment.identityKey,
    alignmentMethod: alignment.alignmentMethod,
    offsetSteps: alignment.offsetSteps,
    pairCount: alignment.pairs.length,
    positiveOffsetCount: positives.length,
    negativeOffsetCount: negatives.length,
    easyOffsetCount: alignment.offsetSteps.filter(offset => Math.abs(offset) <= 2).length,
    hardOffsetCount: alignment.offsetSteps.filter(offset => Math.abs(offset) >= 4).length,
    totalBirths: alignment.pairs.reduce((sum, pair) => sum + pair.births, 0),
    totalDeaths: alignment.pairs.reduce((sum, pair) => sum + pair.deaths, 0),
    totalMatchedSlots: alignment.pairs.reduce((sum, pair) => sum + pair.matchedSlots, 0),
    totalStableSupport: alignment.pairs.reduce((sum, pair) => sum + pair.stableSupportCount, 0),
  };
}

async function validatePhaseCandidateCorpus(manifest, manifestPath, manifestBytes) {
  if (manifest.authority !== 'live-simulator-controlled-step-selected-candidate-features-v0'
    && manifest.authority !== 'live-running-sample-sequence-v0') {
    throw new Error('phase candidate corpus authority must preserve live selected-candidate features');
  }
  if (!exactFeatureOrder(manifest.featureOrder)) throw new Error('phase candidate corpus feature order must match the 16-feature candidate contract');
  if (!Array.isArray(manifest.frames) || manifest.frames.length === 0) throw new Error('phase candidate corpus must contain frames');
  const frames = [];
  const frameIds = new Set();
  for (const [index, frame] of manifest.frames.entries()) {
    const label = `phase frame ${index}`;
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) throw new Error(`${label} must be an object`);
    if (typeof frame.id !== 'string' || !frame.id) throw new Error(`${label} id must be nonblank`);
    if (frameIds.has(frame.id)) throw new Error(`${label} duplicates frame id ${frame.id}`);
    frameIds.add(frame.id);
    if (typeof frame.sameBrowserSessionId !== 'string' || !frame.sameBrowserSessionId) throw new Error(`${label} must preserve same-browser session id`);
    if (typeof frame.sameStateCaptureId !== 'string' || !frame.sameStateCaptureId) throw new Error(`${label} must preserve same-state capture id`);
    if (typeof frame.requestedRoute !== 'string' || !frame.requestedRoute || typeof frame.effectiveRoute !== 'string' || !frame.effectiveRoute) {
      throw new Error(`${label} must preserve requested and effective routes`);
    }
    if (frame.rendererIdentity !== 'live-boundary-sidecar-learned-attribute-splats-v0' && frame.rendererIdentity !== 'live-boundary-sidecar-analytic-splats-v0') {
      throw new Error(`${label} renderer identity must be a live boundary splat route`);
    }
    if (frame.sourceAuthority !== 'live-baked-sidecar-plus-fluid-material-v0') throw new Error(`${label} source authority mismatch`);
    if (frame.fallbackReason != null) throw new Error(`${label} contains fallback evidence: ${frame.fallbackReason}`);
    if (!frame.candidates || typeof frame.candidates !== 'object') throw new Error(`${label} candidates artifact is missing`);
    if (frame.candidates.dtype !== 'float32-le' || frame.candidates.strideFloats !== FEATURE_COUNT || !Number.isInteger(frame.candidates.count) || frame.candidates.count <= 0) {
      throw new Error(`${label} candidates must be positive-count float32-le stride-16 features`);
    }
    const path = resolve(dirname(manifestPath), frame.candidates.path);
    const bytes = await readFile(path);
    if (bytes.byteLength !== frame.candidates.bytes) throw new Error(`${label} candidate bytes mismatch`);
    const digest = sha256(bytes);
    if (digest !== frame.candidates.sha256) throw new Error(`${label} candidate sha256 mismatch`);
    frames.push({ id: frame.id, candidatePath: path, candidateCount: frame.candidates.count, featureOnly: true });
  }
  const temporalAlignment = validateSharedTemporalAlignment(manifest.temporalAlignment, frameIds);
  return {
    schema: BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA,
    corpusIdentity: `sha256:${sha256(manifestBytes)}`,
    manifestPath,
    frameCount: frames.length,
    candidateCount: frames.reduce((sum, frame) => sum + frame.candidateCount, 0),
    frames,
    temporalAlignment,
  };
}

function mse(predicted, target) {
  let total = 0;
  for (let index = 0; index < predicted.length; index += 1) {
    const delta = predicted[index] - target[index];
    total += delta * delta;
  }
  return total / Math.max(1, predicted.length);
}

function transpose(matrix) {
  return matrix[0].map((_, column) => matrix.map(row => row[column]));
}

function solveLinearSystem(matrix, vector) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (Math.abs(augmented[best][pivot]) < 1e-12) throw new Error('phase model normal equations are singular');
    if (best !== pivot) [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= size; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === pivot) continue;
      const factor = augmented[row][pivot];
      for (let column = pivot; column <= size; column += 1) {
        augmented[row][column] -= factor * augmented[pivot][column];
      }
    }
  }
  return augmented.map(row => row[size]);
}

function fitRidgeLinear(samples, lambda) {
  if (!samples.length) throw new Error('phase model needs training samples');
  const inputs = samples.map(sample => sample.input);
  const targets = samples.map(sample => sample.target);
  const inputSize = inputs[0].length;
  const outputSize = targets[0].length;
  const xt = transpose(inputs);
  const xtx = Array.from({ length: inputSize }, (_, row) => (
    Array.from({ length: inputSize }, (_, column) => (
      xt[row].reduce((sum, value, index) => sum + value * inputs[index][column], 0) + (row === column ? lambda : 0)
    ))
  ));
  const weights = [];
  for (let outputIndex = 0; outputIndex < outputSize; outputIndex += 1) {
    const xty = xt.map(column => column.reduce((sum, value, index) => sum + value * targets[index][outputIndex], 0));
    weights.push(solveLinearSystem(xtx, xty));
  }
  return {
    inputSize,
    outputSize,
    weights,
    predict(input) {
      return weights.map(row => row.reduce((sum, value, index) => sum + value * input[index], 0));
    },
  };
}

function modelInput(features, offset, maxOffset) {
  return [1, offset / maxOffset, ...features];
}

async function evaluateBoundarySplatPhaseProof(manifestFile, options = {}) {
  const manifestPath = resolve(manifestFile);
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const validation = manifest.schema === BOUNDARY_SPLAT_PHASE_CORPUS_SCHEMA
    ? await validatePhaseCandidateCorpus(manifest, manifestPath, manifestBytes)
    : await validateBoundarySplatSupervisionCorpus(manifestPath);
  if (!validation.temporalAlignment || validation.temporalAlignment.schema !== BOUNDARY_SPLAT_TEMPORAL_ALIGNMENT_SCHEMA) {
    throw new Error('phase proof requires temporal alignment evidence');
  }
  const frameById = new Map(validation.frames.map(frame => [frame.id, frame]));
  const candidateRows = new Map();
  for (const frame of validation.frames) {
    const bytes = await readFile(frame.candidatePath);
    const stride = frame.featureOnly ? FEATURE_COUNT : CANDIDATE_STRIDE_FLOATS;
    candidateRows.set(frame.id, readFloat32Rows(bytes, frame.candidateCount, stride, `frame ${frame.id} candidates`));
  }
  const maxOffset = Math.max(...validation.temporalAlignment.offsetSteps.map(offset => Math.abs(offset)));
  const samples = [];
  for (const [pairIndex, pair] of manifest.temporalAlignment.pairs.entries()) {
    const sourceFrame = frameById.get(pair.sourceFrameId);
    const targetFrame = frameById.get(pair.targetFrameId);
    if (!sourceFrame || !targetFrame) throw new Error(`temporal pair ${pairIndex} references missing frames`);
    const sourceRows = candidateRows.get(pair.sourceFrameId);
    const targetRows = candidateRows.get(pair.targetFrameId);
    for (let slot = 0; slot < pair.matchedSlots; slot += 1) {
      const source = sourceFrame.featureOnly ? sourceRows[slot] : featureSlice(sourceRows[slot]);
      const target = targetFrame.featureOnly ? targetRows[slot] : featureSlice(targetRows[slot]);
      samples.push({
        pairIndex,
        offsetSteps: pair.offsetSteps,
        slot,
        source,
        target,
        input: modelInput(source, pair.offsetSteps, maxOffset),
      });
    }
  }
  if (samples.length < 4) throw new Error('phase proof requires at least four matched temporal samples');
  const holdoutModulo = Math.max(2, Math.floor(Number(options.holdoutModulo || 5)));
  const train = samples.filter((_, index) => index % holdoutModulo !== 0);
  const holdout = samples.filter((_, index) => index % holdoutModulo === 0);
  if (!train.length || !holdout.length) throw new Error('phase proof train/holdout split is empty');
  const model = fitRidgeLinear(train, Number(options.ridgeLambda ?? 1e-3));
  const offsetMetrics = new Map();
  const holdoutRows = [];
  let identityMseTotal = 0;
  let modelMseTotal = 0;
  for (const sample of holdout) {
    const prediction = model.predict(sample.input);
    const identityError = mse(sample.source, sample.target);
    const modelError = mse(prediction, sample.target);
    identityMseTotal += identityError;
    modelMseTotal += modelError;
    const bucket = offsetMetrics.get(sample.offsetSteps) || { offsetSteps: sample.offsetSteps, sampleCount: 0, identityMse: 0, modelMse: 0 };
    bucket.sampleCount += 1;
    bucket.identityMse += identityError;
    bucket.modelMse += modelError;
    offsetMetrics.set(sample.offsetSteps, bucket);
    if (options.includeHoldoutRows) {
      holdoutRows.push({
        pairIndex: sample.pairIndex,
        offsetSteps: sample.offsetSteps,
        slot: sample.slot,
        source: sample.source,
        modelPrediction: prediction,
        exactTarget: sample.target,
        identityMse: identityError,
        modelMse: modelError,
      });
    }
  }
  const perOffset = Array.from(offsetMetrics.values())
    .sort((a, b) => a.offsetSteps - b.offsetSteps)
    .map(bucket => ({
      ...bucket,
      identityMse: bucket.identityMse / bucket.sampleCount,
      modelMse: bucket.modelMse / bucket.sampleCount,
      advantageMse: (bucket.identityMse - bucket.modelMse) / bucket.sampleCount,
      modelToIdentityRatio: (bucket.modelMse / bucket.sampleCount) / Math.max(1e-12, bucket.identityMse / bucket.sampleCount),
    }));
  const identityMseMean = identityMseTotal / holdout.length;
  const modelMseMean = modelMseTotal / holdout.length;
  const proof = {
    schema: BOUNDARY_SPLAT_PHASE_PROOF_SCHEMA,
    manifestPath,
    corpusIdentity: validation.corpusIdentity,
    manifestSha256: sha256(manifestBytes),
    alignment: validation.temporalAlignment,
    model: {
      family: 'ridge-linear-offset-conditioned-v0',
      inputFeatures: ['bias', 'offsetSteps/maxAbsOffset', 'source[16]'],
      outputFeatures: 'target[16]',
      ridgeLambda: Number(options.ridgeLambda ?? 1e-3),
      trainSampleCount: train.length,
      holdoutSampleCount: holdout.length,
      maxAbsOffsetSteps: maxOffset,
    },
    identityBaseline: { mse: identityMseMean },
    phaseConditionedModel: { mse: modelMseMean },
    advantage: {
      mse: identityMseMean - modelMseMean,
      modelToIdentityRatio: modelMseMean / Math.max(1e-12, identityMseMean),
      beatsIdentity: modelMseMean < identityMseMean,
    },
    perOffset,
  };
  return { proof, holdoutRows };
}

export async function computeBoundarySplatPhaseProof(manifestFile, options = {}) {
  const { proof } = await evaluateBoundarySplatPhaseProof(manifestFile, options);
  return proof;
}

export async function writeBoundarySplatPhaseProofPreview(manifestFile, options = {}) {
  const out = resolve(String(options.out || '/tmp/kaminos-boundary-splat-phase-proof-preview.png'));
  const reportPath = resolve(String(options.report || out.replace(/\.png$/i, '.json')));
  const maxRowsPerOffset = Math.max(1, Math.floor(Number(options.maxRowsPerOffset || 12)));
  const cellSize = Math.max(2, Math.floor(Number(options.cellSize || 8)));
  const { proof, holdoutRows } = await evaluateBoundarySplatPhaseProof(manifestFile, {
    ...options,
    includeHoldoutRows: true,
  });
  const selectedRows = selectPreviewRows(holdoutRows, maxRowsPerOffset);
  if (!selectedRows.length) throw new Error('phase preview has no held-out rows to render');
  const previewPng = renderFeatureStatePreviewPng(selectedRows, cellSize);
  await writeFile(out, previewPng);
  const report = {
    schema: 'kaminos-boundary-splat-phase-proof-preview-v0',
    manifestPath: proof.manifestPath,
    corpusIdentity: proof.corpusIdentity,
    proof: {
      schema: proof.schema,
      model: proof.model,
      identityBaseline: proof.identityBaseline,
      phaseConditionedModel: proof.phaseConditionedModel,
      advantage: proof.advantage,
      perOffset: proof.perOffset,
    },
    preview: {
      authority: 'held-out-source-model-target-feature-state-png-v0',
      path: out,
      bytes: previewPng.length,
      sha256: sha256(previewPng),
      width: FEATURE_COUNT * 3 * cellSize,
      height: selectedRows.length * cellSize,
      cellSize,
    },
    blocks: ['source', 'modelPrediction', 'exactTarget'],
    featureOrder: FEATURE_ORDER,
    holdoutRows: selectedRows.map(row => ({
      offsetSteps: row.offsetSteps,
      slot: row.slot,
      identityMse: row.identityMse,
      modelMse: row.modelMse,
    })),
  };
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  return report;
}

function selectPreviewRows(rows, maxRowsPerOffset) {
  const counts = new Map();
  return rows
    .slice()
    .sort((a, b) => a.offsetSteps - b.offsetSteps || a.slot - b.slot)
    .filter(row => {
      const count = counts.get(row.offsetSteps) || 0;
      if (count >= maxRowsPerOffset) return false;
      counts.set(row.offsetSteps, count + 1);
      return true;
    });
}

function renderFeatureStatePreviewPng(rows, cellSize) {
  const width = FEATURE_COUNT * 3 * cellSize;
  const height = rows.length * cellSize;
  const rgba = Buffer.alloc(width * height * 4, 255);
  const values = rows.flatMap(row => [...row.source, ...row.modelPrediction, ...row.exactTarget]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1e-12, max - min);
  for (const [rowIndex, row] of rows.entries()) {
    const blocks = [row.source, row.modelPrediction, row.exactTarget];
    for (const [blockIndex, block] of blocks.entries()) {
      for (let featureIndex = 0; featureIndex < FEATURE_COUNT; featureIndex += 1) {
        const color = featureColor((block[featureIndex] - min) / span);
        const startX = (blockIndex * FEATURE_COUNT + featureIndex) * cellSize;
        const startY = rowIndex * cellSize;
        for (let y = startY; y < startY + cellSize; y += 1) {
          for (let x = startX; x < startX + cellSize; x += 1) {
            const offset = (y * width + x) * 4;
            rgba[offset] = color[0];
            rgba[offset + 1] = color[1];
            rgba[offset + 2] = color[2];
            rgba[offset + 3] = 255;
          }
        }
      }
    }
  }
  return writeRgbaPng(width, height, rgba);
}

function featureColor(value) {
  const t = Math.max(0, Math.min(1, value));
  const warmth = 1 - Math.abs(t - 0.5) * 1.35;
  return [
    Math.round(255 * t),
    Math.round(255 * Math.max(0, warmth)),
    Math.round(255 * (1 - t)),
  ];
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
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
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
