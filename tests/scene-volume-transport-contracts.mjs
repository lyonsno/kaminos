// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createSceneVolumeTransport} from '../scene-volume-transport.mjs';
const source=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
assert.ok(/linearRadiance:\s*vec3<f32>/.test(source),'the native raymarch must return its pre-camera radiance for scene composition');
assert.ok(/result\.linearRadiance\s*=\s*color/.test(source),'transport must expose the native accumulated material radiance');
assert.ok(/sceneDepthStartT:\s*f32/.test(source),'native segment transport must bound both ends of the ray');
console.log('native scene transport result contracts passed');

// Local resource/encoding policy fixture. Actual shader/binding conformance
// requires the native browser route; these stand-ins do not establish it.
globalThis.GPUShaderStage={FRAGMENT:2};
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};
globalThis.GPUTextureUsage={RENDER_ATTACHMENT:1,TEXTURE_BINDING:2};
const textures=[],buffers=[],passes=[],writes=[];
const resource=(record,list)=>{const value={...record,destroyed:0,destroy(){this.destroyed++;},createView(){return {texture:this};}};list.push(value);return value;};
const device={
  createBindGroupLayout:x=>x,createBindGroup:x=>x,createShaderModule:x=>x,createRenderPipeline:x=>x,createPipelineLayout:x=>x,createSampler:x=>x,
  createTexture:x=>resource(x,textures),createBuffer:x=>resource(x,buffers),
  queue:{writeBuffer:(...args)=>writes.push(args)},
};
const encoder={beginRenderPass(descriptor){const pass={descriptor,draws:[],groups:[],setPipeline(value){this.pipeline=value;},setBindGroup(...args){this.groups.push(args);},draw(...args){this.draws.push(args);},end(){this.ended=true;}};passes.push(pass);return pass;}};
const transport=createSceneVolumeTransport(device),frontDepthView={},sceneDepthView={},mainLayout={},mainGroup={},targetView={};
const input={encoder,targetView,frontDepthView,sceneDepthView,forwardScale:[0,0,-1,2],width:60,height:40,code:'// native shader fixture',mainLayout,mainGroup};
assert.throws(()=>transport.encode({...input,frontDepthView:null}),/current encoder and attachments/);
assert.equal(passes.length,0,'missing attachments cannot emit a partial transport frame');
assert.throws(()=>transport.encode({...input,forwardScale:[0,0,-1,0]}),/positive world scale/);
const background=transport.encode(input),foreground=transport.encode({...input,foreground:true});
assert.equal(background.segment,'water-to-opaque');assert.equal(foreground.segment,'camera-to-water');
assert.equal(background.privateSubmit,false);
assert.equal(textures.length,1,'both ordered segments reuse the native-resolution transport target');
assert.deepEqual(textures[0].size,[60,40]);assert.equal(textures[0].format,'rgba16float');
assert.equal(passes.length,4);assert.ok(passes.every(pass=>pass.ended&&pass.draws.length===1));
assert.equal(passes[0].descriptor.colorAttachments[0].loadOp,'clear');
assert.equal(passes[1].descriptor.colorAttachments[0].loadOp,'load');
assert.equal(passes[1].descriptor.colorAttachments[0].view,targetView);
assert.equal(passes[1].pipeline.fragment.targets[0].blend.color.dstFactor,'one-minus-src-alpha');
assert.equal(passes[0].pipeline.fragment.constants.TRANSPORT_FOREGROUND,false);
assert.equal(passes[2].pipeline.fragment.constants.TRANSPORT_FOREGROUND,true);
transport.encode({...input,width:30,height:20});
assert.equal(textures[0].destroyed,1,'resizing retires the old owned target');
assert.equal(textures.length,2);assert.equal(writes.length,3);
transport.dispose();transport.dispose();
assert.equal(textures[1].destroyed,1);assert.equal(buffers[0].destroyed,1);
assert.throws(()=>transport.encode(input),/disposed/);
console.log('native scene transport resource/encoding policy passed');
