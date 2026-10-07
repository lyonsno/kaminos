import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {createFingerFluidBenchState} from '../finger-fluid-bench-core.js';import {evaluateFingerFluidTruthTrajectory} from '../finger-fluid-webgpu-core.js';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/ipbf-native-snapshot.json',import.meta.url),'utf8'));
const trajectory=()=>[0,100].map(elapsedMs=>({elapsedMs,fluidTruthSnapshot:structuredClone(fixture.snapshot)}));
test('bench consumer preserves the supplied effective solver identity',()=>{
 const s=createFingerFluidBenchState({solverIdentity:'webgpu-ipbf-cubic-spline-grid-v0',pressureProjection:'implicit_variational_position_update'});
 assert.equal(s.solver.identity,'webgpu-ipbf-cubic-spline-grid-v0');assert.equal(s.solver.pressureProjection,'implicit_variational_position_update');
 assert.equal(createFingerFluidBenchState().solver.identity,'webgpu-pbf-linked-cell-fluid-v0');
});
test('truth trajectory admits an explicitly selected IPBF boundary and preserves it',()=>{
 // Synthetic repeated observed snapshot: this tests admission, not real motion.
 const r=evaluateFingerFluidTruthTrajectory('multi_regime_playground',trajectory(),{boundaryPressureContract:'ipbf-collision-projection-only-v0'});
 assert.equal(r.boundaryPressureContract,'ipbf-collision-projection-only-v0');
 assert.throws(()=>evaluateFingerFluidTruthTrajectory('multi_regime_playground',trajectory()),/boundary pressure contract/,'incumbent default still expects PBF');
 const mixed=trajectory();mixed[1].fluidTruthSnapshot.boundaryPressureContract='wgsl-analytic-boundary-density-support-v0';
 assert.throws(()=>evaluateFingerFluidTruthTrajectory('multi_regime_playground',mixed,{boundaryPressureContract:'ipbf-collision-projection-only-v0'}),/boundary pressure contract/);
 assert.throws(()=>evaluateFingerFluidTruthTrajectory('multi_regime_playground',trajectory(),{boundaryPressureContract:'unknown'}),/boundary pressure contract/);
});

test('truth witness pressure admission rejects fallback or changed boundary',async()=>{
 const core=await import('../finger-fluid-webgpu-core.js');assert.equal(typeof core.validateFingerFluidTruthPressureState,'function');
 const state={pressureSolver:'ipbf',solverRoute:'webgpu-ipbf-cubic-spline-grid-v0',solver_backend:'webgpu_compute',boundaryPressureContract:'ipbf-collision-projection-only-v0'};
 assert.equal(core.validateFingerFluidTruthPressureState('ipbf',state).boundaryPressureContract,state.boundaryPressureContract);
 assert.throws(()=>core.validateFingerFluidTruthPressureState('ipbf',{...state,pressureSolver:'pbf'}),/pressure solver/);
 assert.throws(()=>core.validateFingerFluidTruthPressureState('ipbf',{...state,solverRoute:'webgpu-pbf-linked-cell-fluid-v0'}),/route/);
 assert.throws(()=>core.validateFingerFluidTruthPressureState('ipbf',{...state,solver_backend:'cpu_fallback'}),/backend/);
 assert.throws(()=>core.validateFingerFluidTruthPressureState('ipbf',{...state,boundaryPressureContract:'wgsl-analytic-boundary-density-support-v0'}),/boundary/);
});
