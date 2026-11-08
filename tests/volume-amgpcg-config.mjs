// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolvePressureSolverConfig} from '../volume-core.js';

test('AMGPCG is a distinct pressure algorithm with CG iterations, preserving boundary and gain semantics', () => {
  const value=resolvePressureSolverConfig({pressureSolver:'converged-open-top',pressureAlgorithm:'amgpcg',pressureCgIterations:6,pressureSolverIterations:60,projection:1});
  assert.equal(value.effective.algorithm,'amgpcg','requested AMGPCG must reach the effective pressure route');
  assert.equal(value.effective.iterations,6,'CG budget must not silently inherit SOR sweeps');
  assert.equal(value.effective.openTop,true);
  assert.equal(value.effective.projectionGain,1);
  const off=resolvePressureSolverConfig({pressureSolver:'converged-open-top',pressureAlgorithm:'amgpcg',pressureCgIterations:6,projection:0});
  assert.equal(off.effective.dispatch,'disabled');
  assert.equal(off.effective.iterations,0);
});

test('existing basins retain SOR, and unsupported AMGPCG requests fail visibly', () => {
  assert.equal(resolvePressureSolverConfig({pressureSolver:'converged',pressureSolverIterations:60}).effective.algorithm,'sor');
  assert.throws(()=>resolvePressureSolverConfig({pressureSolver:'legacy',pressureAlgorithm:'amgpcg'}),/converged/);
  for(const iterations of [0,-1,2.5,NaN,Infinity])assert.throws(()=>resolvePressureSolverConfig({pressureSolver:'converged',pressureAlgorithm:'amgpcg',pressureCgIterations:iterations}),/CG iterations/);
  assert.equal(resolvePressureSolverConfig({pressureSolver:'converged',pressureAlgorithm:'amgpcg',pressureCgIterations:300}).effective.iterations,300,'no hidden tighter CG cap');
});

test('AMGPCG diagnostics name the effective algorithm and its own requested budget',()=>{
 const c=resolvePressureSolverConfig({pressureSolver:'converged-open-top',pressureAlgorithm:'amgpcg',pressureCgIterations:6,pressureSolverIterations:136});
 assert.equal(c.identity,'kaminos.pressure.uaamg-pcg.v1');
 assert.equal(c.requested.algorithm,'amgpcg');
 assert.equal(c.requested.iterations,6);
 assert.equal(c.requested.sorSweeps,136);
 assert.equal(c.effective.omega,null,'SOR relaxation does not apply to CG');
});

test('AMGPCG linear dispatch tiles supported tall grids instead of exceeding one dimension',async()=>{
 const {amgpcgPlan}=await import('../volume-amgpcg.mjs');
 const p=amgpcgPlan([128,512,128],{maxComputeWorkgroupsPerDimension:65535});
 assert.ok(p.linearDispatch?.every(n=>n<=65535),'every dimension must fit the acquired dispatch limit');
 assert.ok(p.linearDispatch.reduce((a,b)=>a*b,1)>=p.groups,'all linear groups must be covered');
});
test('grid preview checks AMGPCG admission before accepting a settings mutation',async()=>{
 const {gridTuningPlan}=await import('../volume-grid-tuning.mjs');
 assert.throws(()=>gridTuningPlan({resolution:16,pressureSolver:'converged',pressureAlgorithm:'amgpcg'},{maxComputeWorkgroupStorageSize:8192}),/workgroup storage/);
});
