import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../finger-fluid-webgpu-core.js';

test('the recovered IPBF pair keeps attraction in sparse water without changing legacy pairs',()=>{
 const pair={offset:[.11,0,0],kernelRadius:.185,surfaceFactors:[1,1],densityRatios:[.2,.2],strength:1};
 assert.equal(core.evaluateFingerFluidCapillaryPair(pair).magnitude,0);
 assert.equal(typeof core.evaluateFingerFluidCohesionPairWeight,'function','explicit cohesion pair profile is absent');
 const args={q:.11/.185,surfaceFactor:1,neighborSurface:1,densityRatio:.2,neighborDensityRatio:.2};
 assert.equal(core.evaluateFingerFluidCohesionPairWeight(args),0);
 assert.ok(core.evaluateFingerFluidCohesionPairWeight({...args,cohesionModel:'ipbf_free_surface'})>0,'sparse water is still rejected by density confidence');
});

test('recovered attraction has a monotonic acceleration scale and a zero-strength endpoint',()=>{
 assert.equal(typeof core.evaluateFingerFluidCohesionAcceleration,'function','cohesion acceleration mapping is missing');
 const input={weightedDirection:[.5,0,0],totalWeight:1,activity:1,gravity:9.2,cohesionModel:'ipbf_free_surface'};
 assert.deepEqual(core.evaluateFingerFluidCohesionAcceleration({...input,strength:0}),[0,0,0]);
 assert.deepEqual(core.evaluateFingerFluidCohesionAcceleration({...input,strength:1}),[4.6,0,0]);
 assert.deepEqual(core.evaluateFingerFluidCohesionAcceleration({...input,strength:2}),[9.2,0,0]);
 assert.deepEqual(core.evaluateFingerFluidCohesionAcceleration({...input,totalWeight:0,strength:2}),[0,0,0]);
});

test('balanced neighborhoods and isolated reciprocal pairs do not introduce a force bias',()=>{
 assert.equal(typeof core.evaluateFingerFluidCohesionAcceleration,'function');
 const input={totalWeight:1,activity:1,gravity:9.2,strength:1,cohesionModel:'ipbf_free_surface'};
 assert.deepEqual(core.evaluateFingerFluidCohesionAcceleration({...input,weightedDirection:[0,0,0]}),[0,0,0]);
 const a=core.evaluateFingerFluidCohesionAcceleration({...input,weightedDirection:[1,0,0]});
 const b=core.evaluateFingerFluidCohesionAcceleration({...input,weightedDirection:[-1,0,0]});
 assert.ok(a.every((v,i)=>v+b[i]===0));
});

test('the opt-in profile rejects wrong methods and malformed requests before GPU admission',async()=>{
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'pbf',cohesionModel:'ipbf_free_surface'}),/requires IPBF/);
 await assert.rejects(core.createWebGPUFingerFluidSolver({pressureSolver:'ipbf',cohesionModel:'typo'}),/cohesion model/i);
});

import {readFileSync} from 'node:fs';
test('the actual cohesion shader changes only under its admitted opt-in profile',()=>{
 const source=readFileSync(new URL('../finger-fluid-webgpu-core.js',import.meta.url),'utf8');
 const shader=source.match(/const COMPUTE_SHADER = \/\* wgsl \*\/`([\s\S]*?)`;/)?.[1];assert.ok(shader,'actual compute shader is unavailable');
 assert.equal(core.applyFingerFluidCohesionProfile(shader),shader,'legacy shader changed');
 const changed=core.applyFingerFluidCohesionProfile(shader,{cohesionModel:'ipbf_free_surface'});
 assert.match(changed,/cohesionAcceleration = \(attraction \/ max\(1.0, attractionWeight\)\) \* \(abs\(params.forces.x\) \* params.chemistry.y \* cohesionActivity\)/);
 assert.match(changed,/pairSupportConfidence = 1.0/);
 assert.doesNotMatch(changed,/cohesionLength > 0.42/);
 assert.throws(()=>core.applyFingerFluidCohesionProfile(shader,{pressureSolver:'pbf',cohesionModel:'ipbf_free_surface'}),/requires IPBF/);
 assert.throws(()=>core.applyFingerFluidCohesionProfile('wrong shader',{cohesionModel:'ipbf_free_surface'}),/anchor missing/);
});

test('weak isolated pair weights fade the recovered force at the attraction boundary',()=>{
 const acceleration=core.evaluateFingerFluidCohesionAcceleration({weightedDirection:[.0001,0,0],totalWeight:.0001,strength:1,activity:1,gravity:9.2,cohesionModel:'ipbf_free_surface'});
 assert.ok(Math.abs(acceleration[0]-.00092)<1e-12,'weak band weight was cancelled into full-strength attraction');
});
