import assert from 'node:assert/strict';

export function assertWitnessCamera(requested,effective) {
  for(const key of ['position','target']) {
    assert.ok(requested[key]?.length===3 && requested[key].every(Number.isFinite),'invalid requested camera');
    assert.ok(effective?.[key]?.length===3 && effective[key].every((v,i)=>Number.isFinite(v)&&Math.abs(v-requested[key][i])<1e-6),'effective camera differs');
  }
}

export function assertSharedSceneConsumers(shared, frame) {
  assert.ok(shared?.materialCount>0,'no actual material consumer');
  assert.equal(shared.frame?.frame,frame,'stale shared source frame');
  assert.ok(shared.frame.generation>0,'missing shared generation');
  assert.equal(shared.frame.hostDepthEffective,true,'missing effective host depth');
  assert.equal(shared.frame.presented,true,'shared smoke not presented');
  assert.equal(shared.shadow?.effective,true,'missing solid visibility');
}

export function assertSceneSourceCapture(source, frame) {
  assert.equal(source?.kind, 'coefficients', 'wrong source kind');
  assert.equal(source.channels, 4);
  assert.equal(source.frame, frame, 'stale source frame');
  assert.ok(Number.isInteger(source.generation) && source.generation > 0, 'missing generation');
  assert.ok(Array.isArray(source.dimensions) && source.dimensions.length === 3 && source.dimensions.every(n=>Number.isInteger(n)&&n>0), 'invalid dimensions');
  assert.ok(source.values?.length === source.dimensions.reduce((a,b)=>a*b,4), 'missing/partial volume coefficients');
  assert.ok(source.values.every(Number.isFinite), 'nonfinite coefficients');
  assert.ok(source.values.some((v,i)=>i%4!==3 && v>0), 'empty source emission');
  assert.ok(source.values.some((v,i)=>i%4===3 && v>0), 'empty source extinction');
}

// Optional exact control-isolation relation, never an artistic completion test.
// Caller has already checked effective route, frozen state and complete RGBA.
export function assertArmEquivalent(arm, rgba, earlier) {
  if (arm.equalTo === undefined) return;
  assert.equal(typeof arm.equalTo,'string','equalTo must name a prior arm');
  assert.ok(earlier.has(arm.equalTo),`prior arm missing: ${arm.equalTo}`);
  assert.ok(rgba.equals(earlier.get(arm.equalTo)),`raw RGBA differs: ${arm.id} != ${arm.equalTo}`);
}
