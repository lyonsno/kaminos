import assert from 'node:assert/strict';

export function checkMovingLogEvidence(report) {
 assert.equal(report.kernel?.status,'passed');
 assert.match(report.effective?.backend??'',/WebGPU/);
 assert.deepEqual(report.effective?.dimensions,[32,32,32]);
 assert.equal(report.effective?.rays,28);assert.equal(report.effective?.radius,.1);
 assert.deepEqual(report.effective?.gi,{steps:4,slices:3});
 assert.deepEqual(report.errors,[]);
 const named=name=>{const found=report.frames.filter(f=>f.name===name);assert.equal(found.length,1,'Missing or duplicate '+name);return found[0];};
 const off=named('burner-off'),carried=named('carried'),turned=named('turned'),still=named('stationary');
 for(const f of [off,carried,turned,still]){
  assert.equal(f.state.burner,false);assert.ok(Number.isFinite(f.burn)&&f.burn>.001);
  assert.equal(f.resets,off.resets);assert.equal(f.allocation,off.allocation);
  assert.equal(f.state.motion.runtimeReadbacks,0);
 }
 assert.ok(carried.state.followingDomain.translation[0]>.9);
 assert.ok(carried.state.followingDomain.shifts>off.state.followingDomain.shifts);
 assert.equal(still.state.followingDomain.shifts,turned.state.followingDomain.shifts);
 assert.ok(carried.state.fields[0].steps>off.state.fields[0].steps);
 return true;
}
