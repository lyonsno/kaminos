import test from 'node:test';
import assert from 'node:assert/strict';
import {createWebGPUFingerFluidSolver} from '../finger-fluid-webgpu-core.js';
test('composing PBF material controls preserves the admitted IPBF attraction range',async()=>{
 const result=await createWebGPUFingerFluidSolver({canvas:{getContext:()=>null},pressureSolver:'ipbf',cohesionModel:'ipbf_free_surface',capillaryStrength:26.89,livePressureControls:true,densityIterations:8,particleCount:12288});
 assert.equal(result.available,false,'no GPU is supplied; valid controls should reach runtime admission');
 assert.match(result.reason,/WebGPU|GPU/i);
});
