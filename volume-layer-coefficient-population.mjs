import assert from 'node:assert/strict';

const LAYER_WIDTH = 4;
const COEFFICIENT_WIDTH = 8;
const ADMISSION_WIDTH = 2;

export function emptyLayerCoefficientPopulation() {
  return {
    rowCount: 0,
    ridgeAdmittedRows: 0,
    ridgePositiveRows: 0,
    ridgeAdmittedPositiveRows: 0,
    ridgeUnadmittedPositiveRows: 0,
    nonRidgeAdmittedRows: 0,
    nonRidgePositiveRows: 0,
    nonRidgeAdmittedPositiveRows: 0,
    nonRidgeUnadmittedPositiveRows: 0,
    unadmittedRows: 0,
    unionPositiveRows: 0,
    channelStats: Array.from({ length: COEFFICIENT_WIDTH }, (_, channel) => ({
      channel,
      minimum: null,
      maximum: null,
      nonzeroCount: 0,
    })),
  };
}

export function summarizeLayerCoefficientPopulation({ coefficients, admission }) {
  assert.ok(coefficients instanceof Float32Array, 'coefficient population requires Float32 coefficients');
  assert.ok(admission instanceof Float32Array, 'coefficient population requires Float32 admission');
  assert.equal(coefficients.length % COEFFICIENT_WIDTH, 0, 'coefficient population row width drifted');
  const rowCount = coefficients.length / COEFFICIENT_WIDTH;
  assert.equal(admission.length, rowCount * ADMISSION_WIDTH, 'coefficient population admission row count drifted');
  const result = emptyLayerCoefficientPopulation();
  result.rowCount = rowCount;
  for (let row = 0; row < rowCount; row += 1) {
    const coefficientOffset = row * COEFFICIENT_WIDTH;
    const admissionOffset = row * ADMISSION_WIDTH;
    for (let channel = 0; channel < COEFFICIENT_WIDTH; channel += 1) {
      const value = coefficients[coefficientOffset + channel];
      assert.ok(Number.isFinite(value), `coefficient population contains a non-finite value at row ${row}, channel ${channel}`);
      assert.ok(value >= 0, `coefficient population contains a negative value at row ${row}, channel ${channel}`);
    }
    for (let layer = 0; layer < ADMISSION_WIDTH; layer += 1) {
      const value = admission[admissionOffset + layer];
      assert.ok(Number.isFinite(value), `coefficient population admission contains a non-finite value at row ${row}, layer ${layer}`);
      assert.ok(value >= 0, `coefficient population admission contains a negative value at row ${row}, layer ${layer}`);
    }
    const ridgePositive = coefficients.subarray(coefficientOffset, coefficientOffset + LAYER_WIDTH).some(value => value > 0);
    const nonRidgePositive = coefficients.subarray(coefficientOffset + LAYER_WIDTH, coefficientOffset + COEFFICIENT_WIDTH).some(value => value > 0);
    const ridgeAdmitted = admission[admissionOffset] > 0;
    const nonRidgeAdmitted = admission[admissionOffset + 1] > 0;
    for (let channel = 0; channel < COEFFICIENT_WIDTH; channel += 1) {
      const admitted = channel < LAYER_WIDTH ? ridgeAdmitted : nonRidgeAdmitted;
      if (!admitted) continue;
      const value = coefficients[coefficientOffset + channel];
      const stats = result.channelStats[channel];
      stats.minimum = stats.minimum == null ? value : Math.min(stats.minimum, value);
      stats.maximum = stats.maximum == null ? value : Math.max(stats.maximum, value);
      if (value > 0) stats.nonzeroCount += 1;
    }
    if (ridgeAdmitted) result.ridgeAdmittedRows += 1;
    if (nonRidgeAdmitted) result.nonRidgeAdmittedRows += 1;
    if (!ridgeAdmitted && !nonRidgeAdmitted) result.unadmittedRows += 1;
    if (ridgePositive) result.ridgePositiveRows += 1;
    if (nonRidgePositive) result.nonRidgePositiveRows += 1;
    if (ridgeAdmitted && ridgePositive) result.ridgeAdmittedPositiveRows += 1;
    if (!ridgeAdmitted && ridgePositive) result.ridgeUnadmittedPositiveRows += 1;
    if (nonRidgeAdmitted && nonRidgePositive) result.nonRidgeAdmittedPositiveRows += 1;
    if (!nonRidgeAdmitted && nonRidgePositive) result.nonRidgeUnadmittedPositiveRows += 1;
    if (ridgePositive || nonRidgePositive) result.unionPositiveRows += 1;
  }
  return result;
}

export function mergeLayerCoefficientPopulation(target, source) {
  for (const key of [
    'rowCount',
    'ridgeAdmittedRows',
    'ridgePositiveRows',
    'ridgeAdmittedPositiveRows',
    'ridgeUnadmittedPositiveRows',
    'nonRidgeAdmittedRows',
    'nonRidgePositiveRows',
    'nonRidgeAdmittedPositiveRows',
    'nonRidgeUnadmittedPositiveRows',
    'unadmittedRows',
    'unionPositiveRows',
  ]) target[key] += source[key];
  for (let channel = 0; channel < COEFFICIENT_WIDTH; channel += 1) {
    const incoming = source.channelStats[channel];
    const current = target.channelStats[channel];
    if (incoming.minimum != null) current.minimum = current.minimum == null ? incoming.minimum : Math.min(current.minimum, incoming.minimum);
    if (incoming.maximum != null) current.maximum = current.maximum == null ? incoming.maximum : Math.max(current.maximum, incoming.maximum);
    current.nonzeroCount += incoming.nonzeroCount;
  }
  return target;
}

export function assertLayerCoefficientPopulation(population, label = 'exact coefficients') {
  assert.ok(population.rowCount > 0, `${label} contain no rows`);
  assert.equal(population.unadmittedRows, 0, `${label} contain a row without Ridge or Non-Ridge admission membership`);
  assert.ok(population.unionPositiveRows > 0, `${label} contain no positive Ridge or Non-Ridge optical mass`);
  assert.equal(population.ridgeUnadmittedPositiveRows, 0, `${label} contain Ridge optical mass outside admitted Ridge support`);
  assert.equal(population.nonRidgeUnadmittedPositiveRows, 0, `${label} contain Non-Ridge optical mass outside admitted Non-Ridge support`);
  assert.equal(population.channelStats?.length, COEFFICIENT_WIDTH, `${label} lack per-channel signal receipts`);
  for (let channel = 0; channel < COEFFICIENT_WIDTH; channel += 1) {
    const stats = population.channelStats[channel];
    assert.equal(stats?.channel, channel, `${label} channel receipt ${channel} drifted`);
    assert.ok(Number.isFinite(stats.minimum) && stats.minimum >= 0, `${label} channel ${channel} minimum is invalid`);
    assert.ok(Number.isFinite(stats.maximum) && stats.maximum >= stats.minimum, `${label} channel ${channel} maximum is invalid`);
    assert.ok(Number.isInteger(stats.nonzeroCount) && stats.nonzeroCount >= 0 && stats.nonzeroCount <= population.rowCount, `${label} channel ${channel} nonzero count is invalid`);
  }
  if (population.ridgeAdmittedRows > 0) {
    assert.ok(population.ridgePositiveRows > 0, `${label} contain admitted Ridge support but no positive Ridge optical mass`);
    assert.ok(population.ridgeAdmittedPositiveRows <= population.ridgeAdmittedRows, `${label} contain more positive Ridge rows than admitted Ridge support`);
    for (let channel = 0; channel < LAYER_WIDTH; channel += 1) {
      assert.ok(population.channelStats[channel].nonzeroCount > 0, `${label} Ridge channel ${channel} has no positive signal`);
    }
  }
  if (population.nonRidgeAdmittedRows > 0) {
    assert.ok(population.nonRidgePositiveRows > 0, `${label} contain admitted Non-Ridge support but no positive Non-Ridge optical mass`);
    assert.ok(population.nonRidgeAdmittedPositiveRows <= population.nonRidgeAdmittedRows, `${label} contain more positive Non-Ridge rows than admitted Non-Ridge support`);
    for (let channel = LAYER_WIDTH; channel < COEFFICIENT_WIDTH; channel += 1) {
      assert.ok(population.channelStats[channel].nonzeroCount > 0, `${label} Non-Ridge channel ${channel} has no positive signal`);
    }
  }
  return population;
}
