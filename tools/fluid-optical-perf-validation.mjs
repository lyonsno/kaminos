import assert from 'node:assert/strict';

export function validateOpticalTiming(samples, expected) {
  assert.equal(samples.length, expected, 'Partial GPU timestamp capture');
  assert.ok(samples.every(v=>Number.isFinite(v)&&v>0), 'Missing, unordered or zero GPU timestamps');
}
export function validateOpticalRuntime(state) {
  assert.equal(state.clock.paused,true,'Timing requires held water');
  assert.equal(state.bench.runtime.solver_backend,'webgpu_compute','Wrong effective solver');
  assert.equal(state.viewport.effective,'shared','Wrong effective viewport');
  assert.equal(state.bench.runtime.effectiveRendererMode,'screen_space_refraction','Wrong effective renderer');
  assert.equal(state.viewport.lastFrame?.presentedByHost,true,'Host frame was not presented');
  assert.equal(state.viewport.failure,null,'Host render failed');
}

export function substituteBaseline(code, replacements) {
  for(const {candidate,baseline} of replacements) {
    assert.equal(code.split(candidate).length-1,1,'Baseline replacement must bind the exact effective shader once');
    code=code.replace(candidate,baseline);
  }
  return code;
}
