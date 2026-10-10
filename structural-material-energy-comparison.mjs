import assert from 'node:assert/strict';

export function compareEnergyRuns(runs,points,lengthScale,material){
 assert.ok(Number.isInteger(points)&&points>0&&Number.isFinite(lengthScale)&&lengthScale>0);
 assert.ok(material&&Number.isInteger(material.elements)&&material.elements>0,'Known element count required');
 assert.equal(material.coefficients.length,material.elements*36,'Complete material coefficients required');
 assert.ok(material.coefficients.every(Number.isFinite)&&Number.isFinite(material.volumeBarrier)&&material.volumeBarrier>=0);
 assert.deepEqual(runs.map(r=>r.effective),['dense-reference','isotropic-intact-v1','isotropic-intact-v1','dense-reference']);
 for(const run of runs)for(const phase of ['initial','final'])for(const [name,size]of [['state',points*16],['diagnostics',points*24]]){
  assert.equal(run[phase][name].length,size,`${phase} ${name} is incomplete`);
  assert.ok(run[phase][name].every(Number.isFinite),`${phase} ${name} is nonfinite`);
 }
 const stressMetrics=[];
 for(const run of runs)for(const phase of ['initial','final']){
  const sample=run[phase];
  for(let i=0;i<points;i++)assert.equal(sample.diagnostics[i*24+3],0,`${phase} invalid element`);
  assert.equal(sample.stresses?.length,material.elements,`${phase} stress output is incomplete`);
  let error=0;
  for(let i=0;i<material.elements;i++){
   const record=sample.stresses[i],{F,stress}=record;
   for(const matrix of [F,stress])assert.ok(Array.isArray(matrix)&&matrix.length===3&&matrix.every(row=>Array.isArray(row)&&row.length===3&&row.every(Number.isFinite)),`${phase} nonfinite or incomplete stress matrix`);
   assert.ok(record.active===true&&record.invalid===false&&Number.isFinite(record.volume)&&record.volume>0&&Number.isFinite(record.energy),`${phase} unhealthy stress record`);
   const lambda=material.coefficients[i*36+1],mu=material.coefficients[i*36+21],beta=material.volumeBarrier;
   const J=F[0][0]*(F[1][1]*F[2][2]-F[1][2]*F[2][1])-F[0][1]*(F[1][0]*F[2][2]-F[1][2]*F[2][0])+F[0][2]*(F[1][0]*F[2][1]-F[1][1]*F[2][0]);
   assert.ok(Number.isFinite(J)&&J>0,`${phase} inverted stress deformation`);
   const E=F.map((_,r)=>F.map((_,c)=>(F.reduce((sum,row)=>sum+row[r]*row[c],0)-(r===c?1:0))/2));
   const trace=E.reduce((sum,row,r)=>sum+row[r],0),S=E.map((row,r)=>row.map((v,c)=>2*mu*v+(r===c?lambda*trace:0)));
   // Compare the law at each run's own F; evolved trajectory differences are separate.
   const expected=F.map((_,r)=>F.map((_,c)=>F.reduce((sum,row,a)=>sum+row.reduce((inner,__,b)=>inner+F[r][a]*S[a][b]*F[c][b],0),0)/J+(r===c?beta*(1-1/J):0)));
   const scale=Math.max(1,Math.abs(lambda),Math.abs(mu),beta,...stress.flat().map(Math.abs),...expected.flat().map(Math.abs));
   for(let r=0;r<3;r++)for(let c=0;c<3;c++)error=Math.max(error,Math.abs(stress[r][c]-expected[r][c])/scale);
  }
  assert.ok(error<=32*2**-23,`${phase} stress same-deformation error ${error}`);
  stressMetrics.push({effective:run.effective,phase,error});
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
   for(const [name,offsets]of [['position',[4,5,6]],['velocity',[8,9,10]]])for(const k of offsets)result[name]=Math.max(result[name],Math.abs(dense.final.state[i*16+k]-fast.final.state[i*16+k])/lengthScale);
  }
  // Reordered f32 sums use a local block norm, not cancellation-sensitive entry ratios.
  for(const name of ['gradient','hessian','energy'])assert.ok(result[name]<=32*2**-23,`${name} same-law error ${result[name]}`);
  assert.ok(result.position<=1e-5,`Position drift ${result.position} object lengths`);
  assert.ok(result.velocity<=1e-3,`Velocity drift ${result.velocity} object lengths/second`);
  metrics.push(result);
 }
 return{passed:true,metrics,stressMetrics,tolerances:{localF32Block:32*2**-23,stressMaterialBlock:32*2**-23,positionObjectLengths:1e-5,velocityObjectLengthsPerSecond:1e-3},lengthScale};
}
