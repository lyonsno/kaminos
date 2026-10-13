import assert from 'node:assert/strict';
const api=await import('../scripts/replay-smokey-heldout.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof api.validateHeldoutManifest,'function','held-out replay must admit the complete declared sampling frame');
const variants=['baseline','radius-half','radius-double','fuel-half','fuel-double','temperature-half','temperature-double','all-half','all-double'];
const manifest={identity:'smokey-heldout-capture-v1',status:'observed',phase:'complete',mode:'sweep',source:'test-source',
  cases:variants.flatMap(variant=>[197,229].flatMap(step=>[0,-15].map(yaw=>({variant,step,yaw,status:'observed'}))))};
api.validateHeldoutManifest(manifest);
for(const edit of [m=>m.cases.pop(),m=>m.cases[1]=m.cases[0],m=>m.cases[0].status='failed',m=>m.mode='baseline',m=>m.cases[0].step=198]) {
  const bad=structuredClone(manifest);edit(bad);assert.throws(()=>api.validateHeldoutManifest(bad));
}
const count=17,values=new Float32Array(count*32);
for(let i=0;i<count;i++){
  const at=i*32;values[at+2]=1;values[at+5]=0;values[at+6]=1;values[at+15]=.1;
  values[at+12]=1;values[at+16]=.5;values[at+17]=i===8?10:1;values[at+20]=.25;values[at+23]=1;
}
const predict=()=>[0,0,0,0];
const plain=api.replayHeldoutRay(values,0,count,{probeCount:3,predict,calibration:[1,1,1,1],thresholds:[.001],amplitude:1});
const scaled=api.replayHeldoutRay(values,0,count,{probeCount:3,predict,calibration:[1,1,1,1],thresholds:[.001],amplitude:2});
assert.equal(plain.results.length,3);assert.equal(scaled.teacher[3],plain.teacher[3]);
assert.equal(scaled.teacher[0],plain.teacher[0]*2);
assert.equal(scaled.results[1].uniqueProbeCount,plain.results[1].uniqueProbeCount);
assert.equal(scaled.results[1].error[0],plain.results[1].error[0]*2);
assert.deepEqual(scaled.results[1].observedIndices,plain.results[1].observedIndices);
assert.throws(()=>api.replayHeldoutRay(values,0,count,{probeCount:3,predict,calibration:undefined,thresholds:[.001],amplitude:1}),/calibration/);
assert.throws(()=>api.replayHeldoutRay(values,0,count,{probeCount:3,predict,calibration:[1,1,1,1],thresholds:[.001],amplitude:0}),/amplitude/);
const outside=api.replayHeldoutRay(values,0,count,{probeCount:3,predict,calibration:[1,1,1,1],thresholds:[.001],amplitude:1,
  trainingRange:{min:Array(35).fill(0),max:Array(35).fill(0)}});
assert.ok(outside.extrapolation.nodes>0);assert.ok(outside.extrapolation.outside>0);
console.log('held-out sampling frame, amplitude control and frozen controller contracts passed');
