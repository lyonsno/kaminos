import assert from 'node:assert/strict';

export function checkWater(evidence) {
  const {state,requestedSteps,startStep,samples}=evidence;
  assert.ok(state.mounted && !state.failure && state.paused);
  assert.equal(state.backend,'WebGPUBackend');
  assert.equal(state.effectiveRoute,'kaminos/finger-fluid/local-analytic-host-frame-v0');
  assert.equal(state.setup.particleCount,12288);
  assert.equal(state.setup.densityIterations,1);
  assert.equal(state.solver.particleCount,12288);
  assert.equal(state.solver.densityIterationsPerStep,1);
  assert.equal(state.solver.stepCount-startStep,requestedSteps);
  assert.ok(state.lastFrame.submittedByHost && state.lastFrame.presentedByHost);
  assert.ok(samples.length>1 && samples.at(-1).step>samples[0].step);
  return evidence;
}

export function checkOverlap(arm) {
  assert.ok(arm.water.some(water=>{
    const during=water.samples.filter(sample=>sample.at>=arm.preview.activeStart && sample.at<=arm.preview.activeEnd);
    return during.length>1 && during.at(-1).step>during[0].step;
  }),'No water advancement during the preview process');
  return arm;
}
