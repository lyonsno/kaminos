// kaminos-test: node
import assert from 'node:assert/strict';
import {assertAuthoredWaterPopulation} from '../authored-water-evidence.mjs';
const route='kaminos/mls-mpm-finger-juice-v1',words=Array(40).fill(0);words[3]=100;
const state={requestedRoute:route,effectiveRoute:route,fallbackRoute:null,failure:null,solver:{capacity:2,clock:{step:12,completedStep:12},population:{active:1,capacity:2,step:12,authority:'completed_gpu_occupancy'}}};
const particles={route,recordFloats:20,particleCount:2,stepCount:12,words};
assert.throws(()=>assertAuthoredWaterPopulation({...state,effectiveRoute:'old-fluid'},particles),/route/);
assert.throws(()=>assertAuthoredWaterPopulation(state,{...particles,words:[]}),/body/);
assert.throws(()=>assertAuthoredWaterPopulation(state,{...particles,stepCount:11}),/step/);
assert.throws(()=>assertAuthoredWaterPopulation({...state,solver:{...state.solver,population:{...state.solver.population,active:2}}},particles),/population/);
assert.throws(()=>assertAuthoredWaterPopulation({...state,failure:'GPU failed'},particles),/failure/);
assert.equal(assertAuthoredWaterPopulation(state,particles),1);
