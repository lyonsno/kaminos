import { createHash } from 'node:crypto';

function finite(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} must be finite`);
  return number;
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponent = Math.exp(value);
  return exponent / (1 + exponent);
}

function validateRows(rows, label, featureCount = null) {
  if (!Array.isArray(rows) || rows.length === 0) throw new TypeError(`${label} must be a non-empty array`);
  const expected = featureCount ?? rows[0]?.features?.length;
  if (!Number.isInteger(expected) || expected <= 0) throw new TypeError(`${label} feature count must be positive`);
  return rows.map((row, index) => {
    if (!row || typeof row !== 'object') throw new TypeError(`${label} row ${index} must be an object`);
    if (typeof row.frameId !== 'string' || !row.frameId) throw new TypeError(`${label} row ${index} frameId is required`);
    if (!Array.isArray(row.features) || row.features.length !== expected) {
      throw new TypeError(`${label} row ${index} must contain ${expected} features`);
    }
    const features = row.features.map((value, featureIndex) => finite(value, `${label} row ${index} feature ${featureIndex}`));
    const target = Number(row.label);
    if (target !== 0 && target !== 1) throw new TypeError(`${label} row ${index} label must be 0 or 1`);
    return { ...row, features, label: target };
  });
}

function frameIds(rows) {
  return [...new Set(rows.map(row => row.frameId))].sort();
}

function featureNormalizer(rows, featureCount) {
  const means = Array(featureCount).fill(0);
  for (const row of rows) {
    for (let index = 0; index < featureCount; index += 1) means[index] += row.features[index];
  }
  for (let index = 0; index < featureCount; index += 1) means[index] /= rows.length;
  const scales = Array(featureCount).fill(0);
  for (const row of rows) {
    for (let index = 0; index < featureCount; index += 1) {
      const delta = row.features[index] - means[index];
      scales[index] += delta * delta;
    }
  }
  for (let index = 0; index < featureCount; index += 1) {
    scales[index] = Math.max(Math.sqrt(scales[index] / rows.length), 1e-6);
  }
  return { means, scales };
}

function normalizedFeatures(features, normalizer) {
  return features.map((value, index) => (value - normalizer.means[index]) / normalizer.scales[index]);
}

function probability(model, features) {
  const normalized = normalizedFeatures(features, model.normalizer);
  let logit = model.bias;
  for (let index = 0; index < model.weights.length; index += 1) logit += model.weights[index] * normalized[index];
  return sigmoid(logit);
}

function metrics(model, rows) {
  let loss = 0;
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let predictedPositive = 0;
  let targetPositive = 0;
  for (const row of rows) {
    const predicted = probability(model, row.features);
    loss += -(row.label * Math.log(Math.max(predicted, 1e-9)) + (1 - row.label) * Math.log(Math.max(1 - predicted, 1e-9)));
    const selected = predicted >= model.threshold;
    if (selected) predictedPositive += 1;
    if (row.label === 1) targetPositive += 1;
    if (selected && row.label === 1) truePositive += 1;
    else if (selected) falsePositive += 1;
    else if (row.label === 1) falseNegative += 1;
  }
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return {
    rowCount: rows.length,
    loss: loss / rows.length,
    precision,
    recall,
    f1: precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0,
    targetPositiveFraction: targetPositive / rows.length,
    predictedPositiveFraction: predictedPositive / rows.length,
    truePositive,
    falsePositive,
    falseNegative,
  };
}

function seededNoise(seed, index) {
  let value = (seed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) / 0xffffffff - 0.5) * 0.02;
}

function modelIdentity(model) {
  const payload = JSON.stringify({
    schema: model.schema,
    featureCount: model.featureCount,
    weights: model.weights,
    bias: model.bias,
    threshold: model.threshold,
    thresholdAuthority: model.thresholdAuthority,
    normalizer: model.normalizer,
  });
  return `sha256:${createHash('sha256').update(payload).digest('hex')}`;
}

function calibrateThreshold(model, rows) {
  const ranked = rows.map(row => ({ probability: probability(model, row.features), label: row.label }))
    .sort((left, right) => right.probability - left.probability);
  const positiveCount = ranked.reduce((sum, row) => sum + row.label, 0);
  let truePositive = 0;
  let falsePositive = 0;
  let best = { f1: -1, selectedCount: Number.POSITIVE_INFINITY, threshold: 0.5 };
  for (let index = 0; index < ranked.length; index += 1) {
    if (ranked[index].label === 1) truePositive += 1;
    else falsePositive += 1;
    const isLastAtProbability = index === ranked.length - 1
      || ranked[index + 1].probability !== ranked[index].probability;
    if (!isLastAtProbability) continue;
    const falseNegative = positiveCount - truePositive;
    const precision = truePositive / Math.max(1, truePositive + falsePositive);
    const recall = truePositive / Math.max(1, truePositive + falseNegative);
    const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const selectedCount = index + 1;
    if (f1 > best.f1 + 1e-12 || (Math.abs(f1 - best.f1) <= 1e-12 && selectedCount < best.selectedCount)) {
      best = { f1, selectedCount, threshold: ranked[index].probability };
    }
  }
  model.threshold = best.threshold;
  model.thresholdAuthority = 'training-f1-calibrated-v0';
  return best;
}

export function trainSparseFineSelector(options = {}) {
  const trainingRows = validateRows(options.trainingRows, 'trainingRows');
  const featureCount = trainingRows[0].features.length;
  const evaluationRows = validateRows(options.evaluationRows, 'evaluationRows', featureCount);
  const trainFrameIds = frameIds(trainingRows);
  const evaluationFrameIds = frameIds(evaluationRows);
  const overlap = trainFrameIds.filter(frameId => evaluationFrameIds.includes(frameId));
  if (overlap.length) throw new Error(`frame custody overlaps between training and evaluation: ${overlap.join(', ')}`);
  const steps = Math.floor(finite(options.steps ?? 180, 'steps'));
  const learningRate = finite(options.learningRate ?? 0.12, 'learningRate');
  const sparsityWeight = finite(options.sparsityWeight ?? 0.03, 'sparsityWeight');
  const seed = Math.floor(finite(options.seed ?? 1, 'seed'));
  if (steps < 0 || learningRate <= 0 || sparsityWeight < 0) throw new RangeError('steps and sparsityWeight must be non-negative and learningRate must be positive');

  const normalizer = featureNormalizer(trainingRows, featureCount);
  const positiveCount = trainingRows.reduce((sum, row) => sum + row.label, 0);
  const negativeCount = trainingRows.length - positiveCount;
  if (positiveCount === 0 || negativeCount === 0) throw new Error('training rows must contain both sparse and articulated targets');
  const positiveWeight = negativeCount / positiveCount;
  const model = {
    schema: 'kaminos-smoke-splat-sparse-fine-selector-v0',
    featureCount,
    weights: Array.from({ length: featureCount }, (_, index) => seededNoise(seed, index)),
    bias: Math.log(positiveCount / negativeCount),
    threshold: 0.5,
    normalizer,
  };
  const initialTraining = metrics(model, trainingRows);
  const losses = [{ step: 0, loss: initialTraining.loss }];
  for (let step = 0; step < steps; step += 1) {
    const weightGradient = Array(featureCount).fill(0);
    let biasGradient = 0;
    let totalLoss = 0;
    for (const row of trainingRows) {
      const features = normalizedFeatures(row.features, normalizer);
      let logit = model.bias;
      for (let index = 0; index < featureCount; index += 1) logit += model.weights[index] * features[index];
      const predicted = sigmoid(logit);
      const sampleWeight = row.label === 1 ? positiveWeight : 1;
      const error = (predicted - row.label) * sampleWeight + sparsityWeight * predicted * (1 - predicted);
      biasGradient += error;
      for (let index = 0; index < featureCount; index += 1) weightGradient[index] += error * features[index];
      totalLoss += sampleWeight * (-(row.label * Math.log(Math.max(predicted, 1e-9)) + (1 - row.label) * Math.log(Math.max(1 - predicted, 1e-9))))
        + sparsityWeight * predicted;
    }
    const scale = learningRate / trainingRows.length;
    model.bias -= biasGradient * scale;
    for (let index = 0; index < featureCount; index += 1) model.weights[index] -= weightGradient[index] * scale;
    if (step === 0 || (step + 1) % 20 === 0 || step + 1 === steps) {
      losses.push({ step: step + 1, loss: totalLoss / trainingRows.length });
    }
  }
  const thresholdCalibration = calibrateThreshold(model, trainingRows);
  model.identity = modelIdentity(model);
  return {
    schema: 'kaminos-smoke-splat-sparse-fine-selector-v0',
    authority: 'held-out-adjacent-phase-sparse-residual-learning-v0',
    model,
    frameSplit: {
      authority: 'explicit-disjoint-frame-holdout-v0',
      trainFrameIds,
      evaluationFrameIds,
      overlap: overlap.length,
    },
    optimization: { steps, learningRate, sparsityWeight, positiveWeight, seed, losses, thresholdCalibration },
    metrics: {
      initialTraining,
      training: metrics(model, trainingRows),
      evaluation: metrics(model, evaluationRows),
    },
  };
}

export function predictSparseFine(model, features) {
  if (!model || model.schema !== 'kaminos-smoke-splat-sparse-fine-selector-v0') {
    throw new TypeError('model must be a sparse fine selector artifact');
  }
  return probability(model, features);
}

export function applySparseFineSelector(model, rows) {
  const validated = validateRows(rows, 'rows', model.featureCount);
  return validated.map(row => {
    const predicted = predictSparseFine(model, row.features);
    return { ...row, probability: predicted, selected: predicted >= model.threshold };
  });
}
