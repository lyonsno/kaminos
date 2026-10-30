// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneVolumeTransport} from '../scene-volume-transport.mjs';
globalThis.GPUShaderStage={FRAGMENT:2};globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};globalThis.GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2};
const sync=[],asyncCalls=[],textures=[],passes=[];
const device={createBindGroupLayout:x=>x,createBindGroup:x=>x,createShaderModule:x=>x,createPipelineLayout:x=>x,createSampler:x=>x,
 createRenderPipeline:x=>(sync.push(x),x),async createRenderPipelineAsync(x){asyncCalls.push(x);return x;},
 createBuffer:()=>({destroy(){}}),createTexture:x=>{textures.push(x);return {createView:()=>({}),destroy(){}};},queue:{writeBuffer(){}}};
const transport=createSceneVolumeTransport(device),mainLayout={},lighting={layout:{},group:{}};
const config={code:'// actual WGSL conformance belongs to the native browser',mainLayout,lighting,constants:{LEAN_EMISSIVE_RAYMARCH:true},width:320,height:180,emission:true};
assert.equal(typeof transport.prepare,'function','native transport must support cold asynchronous preparation');
await Promise.all([transport.prepare(config),transport.prepare(config)]);await transport.prepare(config);
assert.equal(sync.length,0,'preparation never invokes synchronous pipeline compilation');
assert.equal(asyncCalls.length,3,'segment and two composite targets compile once');
assert.equal(textures.length,1);
const encoder={beginRenderPass(){const p={setPipeline:x=>passes.push(x),setBindGroup(){},draw(){},end(){}};return p;}};
transport.encode({...config,encoder,targetView:{},emissionTargetView:{},frontDepthView:{},sceneDepthView:{},forwardScale:[0,0,-1,1],mainGroup:{}});
assert.equal(sync.length,0,'first matching flame frame reuses prepared pipelines');
assert.equal(textures.length,1,'first matching frame reuses its prepared target');
assert.equal(passes[0].fragment.constants.LEAN_EMISSIVE_RAYMARCH,true);
await transport.prepare({...config,constants:{LEAN_EMISSIVE_RAYMARCH:false}});
assert.equal(asyncCalls.length,4,'changed raymarch constants compile their own variant');
transport.dispose();await assert.rejects(()=>transport.prepare(config),/disposed/);
console.log('native transport asynchronous preparation passed');
