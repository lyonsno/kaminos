import assert from 'node:assert/strict';
const module=await import('../structural-material-energy-comparison.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof module.compareEnergyRuns,'function','Paired benchmark must reject invalid evidence before reporting speed');
const snapshot=()=>({state:Array(64).fill(0),diagnostics:Array(96).fill(0)});
const run=effective=>({effective,initial:snapshot(),final:snapshot()});
const runs=[run('dense-reference'),run('isotropic-intact-v1'),run('isotropic-intact-v1'),run('dense-reference')];
runs.forEach(r=>{r.initial.diagnostics[4]=100000;r.initial.diagnostics[5]=1;r.final.state[0]=1;});
runs[1].initial.diagnostics[5]+=.001;
assert.equal(module.compareEnergyRuns(runs,4,2).passed,true,'Cancellation entry is judged against its local Hessian norm');
for(const mutate of [r=>r[1].initial.diagnostics[4]+=100,r=>r[1].final.state[0]+=.01,r=>r[1].initial.diagnostics[0]=NaN,r=>r[1].final.state.pop(),r=>r[1].effective='fallback',r=>r.pop(),r=>r[2].initial.diagnostics[3]=1]){
 const copy=structuredClone(runs);mutate(copy);assert.throws(()=>module.compareEnergyRuns(copy,4,2));
}
console.log('Paired energy evidence rejects wrong route, partial/nonfinite output, invalid elements and physical drift');
