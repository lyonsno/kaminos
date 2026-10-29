// kaminos-test: node
import assert from 'node:assert/strict';
import {createFireSmokeShadow} from '../fire-smoke-shadow.mjs';
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
let allocations=0,submits=0;
const texture=()=>({createView(){return {};},destroy(){}}),pipeline={getBindGroupLayout(){return {};}};
const device={limits:{maxTextureDimension2D:16384},queue:{writeBuffer(){},submit(){submits++;}},createTexture(){allocations++;return texture();},createBuffer(){return {destroy(){}};},createShaderModule(){return {};},createComputePipeline(){return pipeline;},createBindGroup(){return {};},createCommandEncoder(){return {beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
const shadow=createFireSmokeShadow(device,{points:texture(),count:4,steps:8,resolution:16,angleDegrees:8});const firstReceiving=shadow.external;shadow.setQuality({resolution:512});assert.notEqual(shadow.external,firstReceiving,'resizing must replace the sampled texture identity so existing pass bindings cannot retain its destroyed GPU allocation');
let frame;assert.doesNotThrow(()=>frame=shadow.encode({status:'encoded',texture:texture(),dimensions:[8,8,8],generation:1,frame:1},{count:4,generation:1,frame:1}),'accounting cannot reject a device-admitted atlas after submission');
assert.deepEqual(frame.size,[12288,1024]);assert.equal(frame.work.integrationRays,6291456);assert.equal(submits,1);
const before=allocations;assert.throws(()=>shadow.setQuality({resolution:1024}),/device capacity/);assert.equal(allocations,before,'invalid atlas must fail before resource mutation');assert.equal(shadow.debugState().resolution,512);shadow.dispose();console.log('PASS effective device capacity survives quality accounting and frame publication');
