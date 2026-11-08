import assert from 'node:assert/strict';

export function isShredWitnessFatalConsole(text) {
  return /invalid generated code|invalid shader|error while|validation|device lost|error occurred|PRESET LOAD FAILED/i.test(text);
}

export function validateShredWitness({state, replay, field, front}, {mode, steps, cells, split = false}) {
  assert.equal(state.backend, 'WebGPU:apple', 'native Apple GPU required');
  assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(state.appearanceModel.requested, mode);
  assert.equal(state.appearanceModel.effective, mode, state.appearanceModel.reason);
  assert.equal(replay.ok, true);
  assert.equal(replay.requestedSteps, steps);
  assert.equal(replay.completedSteps, steps, 'partial simulation replay');
  for (const role of split ? ['material', 'velocity'] : ['combined']) {
    assert.equal(state.simulationPipelines?.[`cs:${role}`]?.constants.SHRED_ONLY, mode === 'shred-only', 'wrong pipeline specialization');
  }
  assert.ok(field.length > 0 && field.length % 16 === 0, 'missing fluid field');
  if (cells !== undefined) assert.equal(field.length, cells * 16, 'incomplete fluid field');
  let heat = 0, shred = 0;
  for (let i = 0; i < field.length; i++) {
    assert.ok(Number.isFinite(field[i]), `nonfinite field value at ${i}`);
    if (i % 16 === 5) heat += field[i];
    if (i % 16 === 13) shred += field[i];
    if (mode === 'shred-only' && [7, 8, 9, 10, 11, 12, 14, 15].includes(i % 16)) {
      assert.equal(field[i], 0, `discarded carrier at ${i}`);
    }
  }
  assert.ok(heat > 0, 'no hot material');
  if (front) {
    assert.equal(front.length, field.length / 16, 'incomplete front field');
    assert.ok(front.every(Number.isFinite), 'nonfinite front field');
    if (mode === 'shred-only') assert.ok(front.every(x => x === 0), 'discarded front topology');
  }
  return {cells: field.length / 16, heat, shred, discardedFieldsZero: mode === 'shred-only'};
}
