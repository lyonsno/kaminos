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
