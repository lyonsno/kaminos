import assert from 'node:assert/strict';
import {resolvePressureSolverConfig} from '../volume-core.js';
const controls={pressureSolver:'converged',pressureSolverIterations:24,projection:1};
assert.equal(resolvePressureSolverConfig(controls).effective.openTop,false);
const joined=resolvePressureSolverConfig(controls,{surroundingSmoke:true});
assert.equal(joined.effective.openTop,true,'joined near domain still has an artificial ceiling');
assert.equal(joined.requested.solver,'converged','preserve authored request');
assert.equal(joined.effective.boundarySource,'surrounding-smoke-outflow');
console.log('joined fine pressure exposes effective outflow while retaining request passed');
