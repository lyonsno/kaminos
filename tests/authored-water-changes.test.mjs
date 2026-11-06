// kaminos-test: node
import assert from 'node:assert/strict';
import {authoredWaterChanges as changes} from '../authored-water-changes.mjs';
const setup={particleCount:1000,waterSampling:{spacing:.1,particleTarget:64,container:null,worldBounds:{min:[-1,-1,-1],max:[1,1,1]}}};
const sources=[{id:'A',type:'local-liquid-emitter',transform:{position:[0,1,0],scale:[1,1,1]},localLiquidEmitter:{mode:'finite_drop',drop:{width:.5}}}];
assert.deepEqual(changes(setup,structuredClone(setup),sources,structuredClone(sources)),[]);
const draft=structuredClone(setup);draft.waterSampling.particleTarget=512;
assert.deepEqual(changes(setup,draft,sources,sources).map(c=>c.key),['waterSampling']);
draft.waterSampling.particleTarget=64;assert.deepEqual(changes(setup,draft,sources,sources),[],'Reverting to running setup must clear pending restart');
draft.mlsMaterial={pressureWaveSpeed:2,kinematicViscosity:.0005};assert.deepEqual(changes(setup,draft,sources,sources),[],'Material has live application semantics');
const moved=structuredClone(sources);moved[0].transform.position[0]=.2;
assert.deepEqual(changes(setup,setup,sources,moved).map(c=>c.key),['sources']);
const flow={id:'inlet',localLiquidEmitter:{mode:'continuous',volumeRate:.001}};
assert.deepEqual(changes(setup,setup,sources,[...sources,flow]).map(c=>c.key),['inlets']);
assert.deepEqual(changes(setup,setup,[...sources,flow],[...sources,{...flow,localLiquidEmitter:{...flow.localLiquidEmitter,volumeRate:.002}}]),[]);
