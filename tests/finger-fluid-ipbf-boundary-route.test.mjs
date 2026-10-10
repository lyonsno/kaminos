import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';

test('a requested cubic wall cannot silently run under incumbent pressure',async()=>{
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'pbf',ipbfBoundaryMode:'tangent_plane'}),/IPBF wall support requires IPBF/);
});
test('wall mode selects an explicit pressure contract and rejects unknown modes',()=>{
 assert.equal(core.resolveFingerFluidPressureBoundary({pressureSolver:'ipbf',ipbfBoundaryMode:'tangent_plane'}).boundaryPressureContract,'ipbf-cubic-tangent-plane-density-v1');
 assert.equal(core.resolveFingerFluidPressureBoundary({pressureSolver:'ipbf'}).boundaryPressureContract,'ipbf-collision-projection-only-v0');
 assert.equal(core.resolveFingerFluidPressureBoundary({pressureSolver:'pbf'}).boundaryPressureContract,core.KAMINOS_FINGER_FLUID_BOUNDARY_PRESSURE_CONTRACT);
 assert.throws(()=>core.resolveFingerFluidPressureBoundary({pressureSolver:'ipbf',ipbfBoundaryMode:'unknown'}),/boundary mode/);
});
test('wall evidence cannot substitute collision-only or unknown pressure support',()=>{
 const state={pressureSolver:'ipbf',solverRoute:'webgpu-ipbf-cubic-spline-grid-v0',solver_backend:'webgpu_compute',boundaryPressureContract:'ipbf-cubic-tangent-plane-density-v1'};
 const options={ipbfBoundaryMode:'tangent_plane'};
 assert.equal(core.validateFingerFluidTruthPressureState('ipbf',state,options).boundaryPressureContract,state.boundaryPressureContract);
 assert.throws(()=>core.validateFingerFluidTruthPressureState('ipbf',{...state,boundaryPressureContract:'ipbf-collision-projection-only-v0'},options),/boundary/);
 assert.throws(()=>core.validateFingerFluidTruthPressureState('ipbf',state),/boundary/);
});
