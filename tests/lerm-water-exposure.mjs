// kaminos-test: node
import assert from 'node:assert/strict';
import {validateWaterInterface} from '../experiments/lerms/water-exposure.mjs';
const device={queue:{}},source={schema:'kaminos.liquid-fire-contact-descriptor.v1',packing:'gpu-sparse-liquid-fire-contact-source-vec4x8-v1',device,queue:device.queue,recordsBuffer:{},headerBuffer:{},headerBytes:80,recordFloats:32,recordBytes:128,capacity:1331,generation:1,allocationGeneration:1,epoch:0,step:2,writeTick:1,sourceFrameId:'kaminos/finger-fluid-bench:gpu-simulation-frame',sourceFrameHash:12,coverage:'active-liquid-particles',volumeMeaning:'world-volume-per-particle',validitySource:'gpu_header_only_fail_closed_v0'};
assert.equal(validateWaterInterface(source),source);
assert.equal(validateWaterInterface({...source,additive:true}).additive,true);
for(const [key,value]of Object.entries({schema:'other',device:null,recordsBuffer:null,headerBuffer:null,recordFloats:20,recordBytes:80,packing:'sampled',coverage:'supported-interface',volumeMeaning:'interface-thickness-proxy',validitySource:'cpu',capacity:0,generation:undefined,step:-1,writeTick:NaN,sourceFrameHash:0,headerBytes:0}))assert.throws(()=>validateWaterInterface({...source,[key]:value}),/water|Water|Liquid fire/);
assert.throws(()=>validateWaterInterface(source,{}),/same GPUDevice/);
console.log('Water receiver rejects missing identity, sampled/fallback layouts and device mismatch; additive metadata remains compatible');
