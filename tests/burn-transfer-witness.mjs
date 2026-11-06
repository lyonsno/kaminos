// kaminos-test: node
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {materialSummary, validateTransfer} from '../tools/burn-transfer-check.mjs';

const cell = (fuel, reaction = 0) => ({initial: [1], material: [0, 0, reaction, 0, 0, fuel, 0, 0]});
const row = (fuel, reaction = 0) => ({snapshot: cell(fuel, reaction)});
const before = {step: 0, rows: [row(.7, .2), row(1), row(1)]};
const after = {step: 60, rows: [row(.6, .1), row(.98, .1), row(1)]};
const effective = {backend: 'WebGPU:apple', simGrid: 32, sourceEnabled: false};

test('observation requires complete finite occupied material', () => {
  assert.equal(materialSummary(cell(.8)).meanFuel, .8);
  assert.throws(() => materialSummary({initial: [1], material: []}), /Incomplete/);
  assert.throws(() => materialSummary(cell(NaN)), /Nonfinite/);
  assert.throws(() => materialSummary({initial: [0], material: Array(8).fill(0)}), /Empty/);
});

test('transfer verdict refuses plausible false closure paths', () => {
  assert.equal(validateTransfer(before, after, effective).interpretation, 'donor-mediated-secondary-ignition');
  assert.throws(() => validateTransfer(before, after, {...effective, backend: 'software'}), /Wrong backend/);
  assert.throws(() => validateTransfer(before, after, {...effective, simGrid: 64}), /Wrong grid/);
  assert.throws(() => validateTransfer(before, after, {...effective, sourceEnabled: true}), /Starter still/);
  assert.throws(() => validateTransfer(before, {...after, step: 0}, effective), /No actual/);
  assert.throws(() => validateTransfer(before, {...after, rows: [after.rows[0], row(1), row(1)]}, effective), /Receiver did not/);
  assert.throws(() => validateTransfer(before, {...after, rows: [after.rows[0], after.rows[1], row(.9)]}, effective), /Distant control/);
  assert.throws(() => validateTransfer({...before, rows: [row(1), row(1), row(1)]}, after, effective), /Donor did not/);
  assert.throws(() => validateTransfer({...before, rows: [row(.7, .2), row(.9), row(1)]}, after, effective), /initially cold/);
});
