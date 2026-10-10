import assert from 'node:assert/strict';

export function compareEnergyRuns(runs,points,lengthScale){
 assert.ok(Number.isInteger(points)&&points>0&&Number.isFinite(lengthScale)&&lengthScale>0);
 assert.deepEqual(runs.map(r=>r.effective),['dense-reference','isotropic-intact-v1','isotropic-intact-v1','dense-reference']);
 for(const run of runs)for(const phase of ['initial','final'])for(const [name,size]of [['state',points*16],['diagnostics',points*24]]){
  assert.equal(run[phase][name].length,size,`${phase} ${name} is incomplete`);
  assert.ok(run[phase][name].every(Number.isFinite),`${phase} ${name} is nonfinite`);
 }
 const metrics=[];
 for(const dense of [runs[0],runs[3]])for(const fast of [runs[1],runs[2]]){
  const result={gradient:0,hessian:0,energy:0,position:0,velocity:0};
  for(let i=0;i<points;i++){
   for(const [name,offsets]of [['gradient',[0,1,2]],['hessian',[4,5,6,8,9,10,12,13,14]],['energy',[16]]]){
    const a=offsets.map(k=>dense.initial.diagnostics[i*24+k]),b=offsets.map(k=>fast.initial.diagnostics[i*24+k]);
    const scale=Math.max(1,...a.map(Math.abs),...b.map(Math.abs));
    result[name]=Math.max(result[name],...a.map((v,k)=>Math.abs(v-b[k])/scale));
   }
   assert.equal(dense.initial.diagnostics[i*24+3],0,'Dense invalid element');assert.equal(fast.initial.diagnostics[i*24+3],0,'Optimized invalid element');
   for(const [name,offsets]of [['position',[0,1,2]],['velocity',[12,13,14]]])for(const k of offsets)result[name]=Math.max(result[name],Math.abs(dense.final.state[i*16+k]-fast.final.state[i*16+k])/lengthScale);
  }
  // Reordered f32 sums use a local block norm, not cancellation-sensitive entry ratios.
  for(const name of ['gradient','hessian','energy'])assert.ok(result[name]<=32*2**-23,`${name} same-law error ${result[name]}`);
  assert.ok(result.position<=1e-5,`Position drift ${result.position} object lengths`);
  assert.ok(result.velocity<=1e-3,`Velocity drift ${result.velocity} object lengths/second`);
  metrics.push(result);
 }
 return{passed:true,metrics,tolerances:{localF32Block:32*2**-23,positionObjectLengths:1e-5,velocityObjectLengthsPerSecond:1e-3},lengthScale};
}
