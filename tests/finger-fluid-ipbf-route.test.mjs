import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';

test('pressure solver selection is explicit and unknown modes fail',()=>{
 assert.equal(typeof core.resolveFingerFluidPressureSolver,'function','selectable pressure capability absent');
 assert.equal(core.resolveFingerFluidPressureSolver(), 'pbf');assert.equal(core.resolveFingerFluidPressureSolver('ipbf'),'ipbf');
 assert.throws(()=>core.resolveFingerFluidPressureSolver('IPBF_typo'),/pressure solver/i);
});
test('IPBF settings validate before GPU admission',async()=>{
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'bad'}),/pressure solver/i);
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'ipbf',ipbfCompliance:-1}),/compliance/i);
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'ipbf',adaptiveDensity:true}),/adaptive/i);
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'ipbf',ipbfDamping:'yes'}),/damping/i);
});
