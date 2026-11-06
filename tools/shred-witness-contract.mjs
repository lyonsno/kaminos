import assert from 'node:assert/strict';

export function validateShredWitness({state, replay, field, front}, {mode, steps, cells, split = false}) {
  assert.equal(state.backend, 'WebGPU:apple', 'native Apple GPU required');
  assert.equal(state.effectiveRoute, 'native-3d-compute-fluid-raymarch-v0');
  assert.equal(state.appearanceModel.requested, mode);
  assert.equal(state.appearanceModel.effective, mode, state.appearanceModel.reason);
  assert.equal(replay.ok, true);
  assert.equal(replay.requestedSteps, steps);
  assert.equal(replay.completedSteps, steps, 'partial simulation replay');
  for (const role of split ? ['material', 'velocity'] : ['combined']) {
    assert.equal(state.simulationPipelines?.[`cs:${role}`]?.constants.SHRED_ONLY, ['shred-only','no-activity'].includes(mode), 'wrong pipeline specialization');
    if (mode === 'no-activity') assert.equal(state.simulationPipelines?.[`cs:${role}`]?.constants.NO_ACTIVITY,true,'activity pipeline still enabled');
  }
  assert.ok(field.length > 0 && field.length % 16 === 0, 'missing fluid field');
  if (cells !== undefined) assert.equal(field.length, cells * 16, 'incomplete fluid field');
  let heat = 0, shred = 0;
  for (let i = 0; i < field.length; i++) {
    assert.ok(Number.isFinite(field[i]), `nonfinite field value at ${i}`);
    if (i % 16 === 5) heat += field[i];
    if (i % 16 === 13) shred += field[i];
    if (['shred-only','no-activity'].includes(mode) && [7, 8, 9, 10, 11, 12, 14, 15].includes(i % 16)) {
      assert.equal(field[i], 0, `discarded carrier at ${i}`);
    }
    if (mode === 'no-activity' && i % 16 === 13) assert.equal(field[i],0,`retained Shred at ${i}`);
  }
  assert.ok(heat > 0, 'no hot material');
  if (front) {
    assert.equal(front.length, field.length / 16, 'incomplete front field');
    assert.ok(front.every(Number.isFinite), 'nonfinite front field');
    if (['shred-only','no-activity'].includes(mode)) assert.ok(front.every(x => x === 0), 'discarded front topology');
  }
  return {cells: field.length / 16, heat, shred, discardedFieldsZero: ['shred-only','no-activity'].includes(mode)};
}
