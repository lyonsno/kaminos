// kaminos-test: node
import assert from 'node:assert/strict';
import {soilStress} from '../experiments/hill-terrain/soil-material.mjs';
const zero=Array(9).fill(0),config={bulk:12000,shear:5000,friction:.65};
const elastic=soilStress({pressure:1000,deviator:zero},[0,.02,0,0,0,0,0,0,0],.01,config);
assert.ok(elastic.deviator[1]>0,'confined soil must retain small shear stress, unlike the fluid pressure law');
assert.ok(Math.abs(elastic.deviator[1]-1)<1e-9);
const yielded=soilStress({pressure:100,deviator:zero},[0,100,0,0,0,0,0,0,0],.01,config);
const q=Math.sqrt(yielded.deviator.reduce((s,x)=>s+x*x,0));
assert.ok(Math.abs(q-65)<1e-8,'deviatoric stress must return to friction times pressure');
const tension=soilStress({pressure:10,deviator:zero},[1,0,0,0,1,0,0,0,1],.01,config);
assert.equal(tension.pressure,0);assert.deepEqual(tension.deviator,zero);
const compression=soilStress({pressure:0,deviator:zero},[-1,0,0,0,-1,0,0,0,-1],.001,config);
assert.equal(compression.pressure,36);assert.deepEqual(compression.deviator,zero);
console.log('soil pressure, elastic shear, frictional yield and no-tension checks passed');
