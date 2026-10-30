// kaminos-test: node
import assert from 'node:assert/strict';
import {resolveImmersedSourceConfig, immersedSourceUniformValues, immersedSourceWeights} from '../volume-core.js';
const config=resolveImmersedSourceConfig({emitterSourceLaw:'immersed-source',pressureSolver:'converged-open-top',pressureSolverIterations:12,projection:1,immersedCentreX:.5,immersedCentreY:-.5,immersedCentreZ:0,immersedRadius:.2},{grid:64,gridHeight:128});
assert.equal(config.effective.admitted,true);
const original=immersedSourceUniformValues(config);
const coarse=immersedSourceUniformValues(config,{materialPerVelocity:2});
assert.deepEqual(coarse.slice(1,4),[24,8,16],'Emitter physical centre survives velocity resolution change');
assert.equal(coarse[7],original[7]/2);
assert.equal(coarse[8],original[8]/2);
assert.equal(coarse[21],2,'Pattern lookup converts velocity cells back to the material texture lattice');
for(const i of [0,4,5,6,9,10,11,12,13,14,16,17,18,19,20])assert.equal(coarse[i],original[i]);
const weights=immersedSourceWeights({...config.effective,centreCells:coarse.slice(1,4),radiusCells:coarse[7],thickness:coarse[8]},{grid:32,gridHeight:64});
assert.ok(weights.sum>0,'Off-centre immersed momentum still has support');
