import assert from 'node:assert/strict';
import {m} from './generation-input-fixture.js';
let api;try{api=await import('../generation-memory-policy.js');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
assert.equal(typeof api?.admitGenerationGpuBudget,'function','admit memory from actual declared checkpoint before downloading or launching inference');
const plan=api.admitGenerationGpuBudget(m),peak=Math.max(...Object.values(plan.checkpointBytes));
assert.ok(peak>0);assert.equal(api.admitGenerationGpuBudget(m,peak).maxLiveBytes,peak);
assert.throws(()=>api.admitGenerationGpuBudget(m,peak-1),e=>e.name==='TrellisMemoryBudgetError'&&e.memoryBudget.refusedBytes>peak-1);
assert.equal(api.memoryBudgetBytes('0.5','budget'),524288);
for(const value of ['',0,-1,'oops',Infinity,true])assert.throws(()=>api.memoryBudgetBytes(value,'budget'),/positive/);
assert.equal(api.memoryBudgetBytes(undefined,'budget'),undefined);
console.log('Exact manifest checkpoint demand and explicit MiB parsing precede execution; activation/driver/process demand remains separate.');
