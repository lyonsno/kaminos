import assert from 'node:assert/strict';
// Main retired these optical controls. This replay compares velocity fields,
// not appearance parity; every other captured coefficient must match.
const presentationDifference = /^(physicalMaterialLaw|physicalColorMode|physicalTemperature|physicalTemperatureSpread|volumeExposure|radiance|glow|raySteps|renderScale|reactionBoundary.*|shellAmount|shellWidth|shellSoftClip|shellSmoke|fireLightField|reactionShellGamma|pyro.*Color|runtimeQualityReason|runtimeQualityReceipt)$/;
export function assertDriftReplayRoute(state, mode, captured, overrides = {}) {
  assert.equal(state.openWorldBoundary?.effective, 'ambient-pressure-open-faces', 'Replay must exercise open world boundaries');
  assert.ok(!state.error, state.error);
  assert.equal(state.controls.windStrength, 0);
  assert.equal(state.pressureResolution.effective, mode);
  assert.equal(state.worldSmoke?.effective, 'one-way-world-field', 'World smoke must run');
  assert.equal(state.pressureSolver?.effective?.solver, 'converged', 'Converged pressure must run');
  if (!captured) return;
  assert.deepEqual(state.simGridDimensions,captured.simGridDimensions,'Fine grid changed');
  for (const key of ['flowDims','materialDims','min','max'])
    assert.deepEqual(state.worldSmoke[key],captured.worldSmoke[key],'World '+key+' changed');
  for (const [key,value] of Object.entries(captured.controls)) {
    if(presentationDifference.test(key)) continue;
    const expected=key==='pressureResolution'?mode:Object.hasOwn(overrides,key)?overrides[key]:value;
    assert.deepEqual(state.controls[key],expected,'Replay coefficient changed: '+key);
  }
  for(const [key,value] of Object.entries(overrides))
    assert.deepEqual(state.controls[key],value,'Override not applied: '+key);
}
