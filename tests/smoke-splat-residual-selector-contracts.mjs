import assert from 'node:assert/strict';

import {
  applySparseFineSelector,
  trainSparseFineSelector,
} from '../smoke-splat-residual-selector.mjs';

function rows(frameId, count, phase) {
  return Array.from({ length: count }, (_, index) => {
    const detail = ((index * 7 + phase) % 13) / 12;
    const interfaceShred = ((index * 5 + phase * 2) % 11) / 10;
    const densityVariance = ((index * 3 + phase) % 17) / 16;
    return {
      frameId,
      spatialKey: `fine:${index % 4}:${Math.floor(index / 4)}`,
      features: [
        Math.log1p(0.1 + index * 0.01),
        densityVariance,
        detail,
        interfaceShred,
        index / count,
      ],
      label: densityVariance * 0.7 + detail * 0.5 + interfaceShred * 0.4 > 0.78 ? 1 : 0,
    };
  });
}

const trainingRows = rows('sim-step-96', 160, 0);
const evaluationRows = rows('sim-step-97', 160, 1);
const trained = trainSparseFineSelector({
  trainingRows,
  evaluationRows,
  steps: 240,
  learningRate: 0.18,
  sparsityWeight: 0.04,
  seed: 7,
});

assert.equal(trained.schema, 'kaminos-smoke-splat-sparse-fine-selector-v0');
assert.equal(trained.authority, 'held-out-adjacent-phase-sparse-residual-learning-v0');
assert.deepEqual(trained.frameSplit.trainFrameIds, ['sim-step-96']);
assert.deepEqual(trained.frameSplit.evaluationFrameIds, ['sim-step-97']);
assert.equal(trained.frameSplit.overlap, 0);
assert.ok(trained.metrics.training.loss < trained.metrics.initialTraining.loss);
assert.ok(trained.metrics.evaluation.recall >= 0.7, 'held-out selector preserves most articulated bins');
assert.ok(trained.metrics.evaluation.predictedPositiveFraction < 0.7, 'selector remains sparse on held-out phase');
assert.equal(trained.model.featureCount, trainingRows[0].features.length);
assert.equal(trained.model.identity.startsWith('sha256:'), true);
assert.equal(trained.model.thresholdAuthority, 'training-f1-calibrated-v0');
assert.ok(trained.model.threshold > 0 && trained.model.threshold < 1);

const selected = applySparseFineSelector(trained.model, evaluationRows);
assert.equal(selected.length, evaluationRows.length);
assert.ok(selected.every(row => Number.isFinite(row.probability)));
assert.ok(selected.every(row => row.selected === (row.probability >= trained.model.threshold)));

assert.throws(
  () => trainSparseFineSelector({
    trainingRows,
    evaluationRows: trainingRows,
  }),
  /frame custody overlaps/i,
  'same-frame evaluation cannot masquerade as temporal holdout',
);

console.log('smoke splat residual selector contracts passed');
