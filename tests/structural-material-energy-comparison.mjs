import assert from 'node:assert/strict';
const module=await import('../structural-material-energy-comparison.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof module.compareEnergyRuns,'function','Paired benchmark must reject invalid evidence before reporting speed');
const material={elements:1,coefficients:Array(36).fill(0),volumeBarrier:4};
material.coefficients[1]=2;material.coefficients[21]=3;
const stretches=[1.1,.9,1.05],strain=stretches.map(x=>(x*x-1)/2),trace=strain.reduce((a,b)=>a+b,0),J=stretches.reduce((a,b)=>a*b,1);
const sigma=stretches.map((x,i)=>x*x*(2*trace+6*strain[i])/J+4*(1-1/J));
const snapshot=()=>({state:Array(64).fill(0),diagnostics:Array(96).fill(0),stresses:[{F:stretches.map((x,i)=>stretches.map((_,j)=>i===j?x:0)),stress:sigma.map((x,i)=>sigma.map((_,j)=>i===j?x:0)),volume:1,energy:.2,active:true,invalid:false}]});
const run=effective=>({effective,initial:snapshot(),final:snapshot()});
const runs=[run('dense-reference'),run('isotropic-intact-v1'),run('isotropic-intact-v1'),run('dense-reference')];
runs.forEach(r=>{r.initial.diagnostics[4]=100000;r.initial.diagnostics[5]=1;r.final.state[0]=1;});
runs[1].initial.diagnostics[5]+=.001;
assert.equal(module.compareEnergyRuns(runs,4,2,material).passed,true,'Cancellation entry is judged against its local Hessian norm');
for(const mutate of [r=>r[1].initial.diagnostics[4]+=100,r=>r[1].final.state[4]+=.01,r=>r[1].final.state[8]+=.01,r=>r[1].initial.diagnostics[0]=NaN,r=>r[1].final.state.pop(),r=>r[1].effective='fallback',r=>r.pop(),r=>r[2].initial.diagnostics[3]=1]){
 const copy=structuredClone(runs);mutate(copy);assert.throws(()=>module.compareEnergyRuns(copy,4,2,material));
}
console.log('Paired energy evidence rejects wrong route, partial/nonfinite output, invalid elements and physical drift');
for(const mutate of [r=>r[1].final.diagnostics[3]=1,r=>delete r[1].final.stresses,r=>r[1].final.stresses[0].stress[0][0]=NaN,r=>r[1].final.stresses[0].stress=sigma.map(()=>[0,0,0]),r=>r[1].final.stresses.pop(),r=>r[1].final.stresses[0].active=false,r=>r[1].final.stresses[0].invalid=true,r=>r[1].final.stresses[0].F[0][0]=0]){
 const copy=structuredClone(runs);mutate(copy);assert.throws(()=>module.compareEnergyRuns(copy,4,2,material),'Final material health and stress output cannot be omitted');
}
console.log('Loaded stress is complete, healthy and matches its recorded deformation, independently of trajectory parity');
