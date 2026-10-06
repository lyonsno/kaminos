import assert from 'node:assert/strict';
const route='kaminos/finger-fluid/local-analytic-host-frame-v0';
export function assertLocalLiquidSelectionContinuity(samples) {
  assert.ok(Array.isArray(samples)&&samples.length>=2,'selection needs before and after evidence');
  const first=samples[0].water,last=samples.at(-1).water;
  const ids=first.emitters.map(row=>row.id);
  assert.equal(ids.length,2);
  for(const {water} of samples) {
    assert.equal(water.backend,'WebGPUBackend');
    assert.equal(water.mounted,true);
    assert.ok(!water.failure);
    assert.equal(water.requestedRoute,route);
    assert.equal(water.effectiveRoute,route);
    assert.equal(water.lastFrame.submittedByHost,true);
    assert.equal(water.lastFrame.presentedByHost,true);
    assert.equal(water.lastFrame.frameId,water.hostFrameCompositionEvidence.hostFrameId);
    assert.equal(water.hostFrameCompositionEvidence.effectiveRoute,route);
    assert.equal(water.hostFrameCompositionEvidence.primaryCommandEncoded,true);
    assert.equal(water.solver.liveInlets.activeInletCount,2);
    assert.ok(Number.isSafeInteger(water.solver.liveInlets.generation));
    assert.equal(water.solver.liveInlets.generation,first.solver.liveInlets.generation);
    assert.deepEqual(water.emitters.map(row=>row.id),ids);
    const sources=water.solver.liveInlets.inlets.filter(row=>{
      if(row.activationAuthority!=='inactive_padding') return true;
      assert.equal(row.active,false,'padding cannot release water');
      assert.equal(row.requestedActive,false,'padding cannot be an authored source');
      return false;
    });
    assert.deepEqual(sources.map(row=>row.id),ids);
    assert.ok(sources.every(row=>row.active===true),'both authored sources must remain active');
    assert.ok(Number.isSafeInteger(water.frameCount)&&Number.isSafeInteger(water.solver.stepCount));
  }
  assert.ok(last.frameCount>first.frameCount,'host must produce new frames');
  assert.ok(last.solver.stepCount>first.solver.stepCount,'solver must advance');
}
