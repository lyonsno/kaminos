import assert from 'node:assert/strict';
export function assertJoinedPreview(state,{fine,coarse,roof}) {
  assert.equal(state.phase,'running');
  assert.deepEqual(state.effective.fine,fine);
  assert.deepEqual(state.coarse,coarse);
  assert.equal(state.roof,roof);
  assert.match(state.backend,/WebGPU:apple/i);
  assert(state.frame?.meanLuma>0&&state.frame?.litPixels>0,'blank or missing rendered frame');
  assert.equal(state.effective.physicalColor.effective,'emissive-transport-v2');
  assert.equal(state.controls.emitterSourceLaw,'immersed-source');
  assert(Number.isFinite(state.controls.curl),'missing curl control');
  assert(state.steps>0&&state.effective.ghostGeneration===state.steps,'stale or unexecuted joined step');
  assert(!state.gpuErrors.length,'GPU validation failure');
  assert(!state.pressure.breakdown&&state.pressure.maxDivergenceError<=1e-3,'pressure diagnostic failed');
}
