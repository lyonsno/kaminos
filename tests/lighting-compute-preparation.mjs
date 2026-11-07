// kaminos-test: node
import assert from 'node:assert/strict';
import {createLightingComputePipeline} from '../scene-lighting-compute.mjs';
const descriptor={label:'candidate',compute:{entryPoint:'gather'}};
let finish,calls=0;
const pipeline={getBindGroupLayout:()=>({})};
const device={createComputePipeline(){throw Error('blocking pipeline path used');},createComputePipelineAsync(value){calls++;assert.equal(value,descriptor);return new Promise(resolve=>finish=resolve);}};
const kernel=createLightingComputePipeline(device,descriptor,true);
assert.equal(calls,1);assert.equal(kernel.pipeline,null);
assert.throws(()=>kernel.get(),/not completed/);
finish(pipeline);await kernel.ready;assert.equal(kernel.get(),pipeline);
assert.equal(kernel.get(),pipeline);assert.equal(calls,1);
const failed=createLightingComputePipeline({createComputePipelineAsync:async()=>{throw Error('driver rejected');}},descriptor,true);
await assert.rejects(failed.ready,/driver rejected/);
assert.throws(()=>failed.get(),/driver rejected/);
assert.throws(()=>createLightingComputePipeline({},descriptor,true),/asynchronous compute/);
console.log('PASS asynchronous lighting pipeline completion, rejection, no synchronous fallback');
