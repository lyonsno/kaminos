// kaminos-test: node
import assert from 'node:assert/strict';
import {validateWaterInterface} from '../experiments/lerms/water-exposure.mjs';
const device={},source={schema:'kaminos.finger-fluid.interface-record-descriptor.v0',device,recordsBuffer:{},countersBuffer:{},recordFloats:20,recordBytes:80,fields:{positionId:0},activeCountCounterIndex:0,writeStage:'compacted-after-velocity-update-each-step',capacity:1331,generation:1,step:2,writeTick:1,visibleParticleRadius:.05,counterBytes:40};
assert.equal(validateWaterInterface(source),source);
assert.equal(validateWaterInterface({...source,additive:true}).additive,true);
for(const [key,value]of Object.entries({schema:'other',device:null,recordsBuffer:null,countersBuffer:null,recordFloats:19,recordBytes:76,fields:{positionId:4},activeCountCounterIndex:1,writeStage:'debug-sample',capacity:0,generation:undefined,step:-1,writeTick:NaN,visibleParticleRadius:-1,counterBytes:0}))assert.throws(()=>validateWaterInterface({...source,[key]:value}),/water|Water/);
assert.throws(()=>validateWaterInterface(source,{}),/current producer/);
console.log('Water receiver rejects missing identity, sampled/fallback layouts and device mismatch; additive metadata remains compatible');
