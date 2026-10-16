// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneVolumeSource} from '../scene-volume-source.mjs';
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
globalThis.GPUBufferUsage={UNIFORM:1,COPY_DST:2};
const dispatches=[],textures=[];
const device={queue:{writeBuffer(){}},createShaderModule:x=>x,
  createTexture(spec){const t={spec,destroyed:false,createView(){return {texture:t};},destroy(){t.destroyed=true;}};textures.push(t);return t;},
  createComputePipeline(spec){return {spec,getBindGroupLayout:i=>i};},createBindGroup:spec=>spec};
const encoder={beginComputePass(){let entry;return {setPipeline(p){entry=p.spec.compute.entryPoint;},setBindGroup(){},dispatchWorkgroups(...dims){dispatches.push({entry,dims});},end(){}};}};
const material={createView(){return {};}};
const reactants=[material,material];
let joined={enabled:true,texture:material,uniformBuffer:{},dimensions:[12,24,12],localMin:[-3,-2,-3],localMax:[3,10,3]};
const field=createSceneVolumeSource({device,module:{},uniformBuffer:{},fluidBuffers:[{},{}],frontBuffers:[{},{}],getReactantTextures:()=>reactants,
  grid:32,gridY:64,getJoinedOptics:()=>joined});
field.encode(encoder,0,7);
let live=field.describe();
assert.ok(live.exterior?.texture,'joined source must export exterior coefficients, not silently fine-only');
assert.deepEqual(live.dimensions,[32,64,32],'keep the existing fine source resolution');
assert.deepEqual(live.exterior.dimensions,[12,24,12]);
assert.deepEqual(live.exterior.localMin,[-3,-2,-3]);
assert.deepEqual(live.exterior.localMax,[3,10,3]);
assert.equal(live.exterior.generation,live.generation);
assert.deepEqual(dispatches.map(d=>d.dims),[[8,16,8],[3,6,3]]);
const old=live.exterior.texture;
joined={...joined,dimensions:[16,32,16]};
field.encode(encoder,1,8);live=field.describe();
assert.notEqual(live.exterior.texture,old);assert.equal(old.destroyed,true);
assert.deepEqual(live.exterior.dimensions,[16,32,16]);
field.invalidate('material changed');assert.equal(field.describe().exterior?.texture??null,null);
joined={...joined,enabled:false};field.encode(encoder,0,9);
assert.equal(field.describe().exterior,null,'disabled joined route must not expose stale exterior');
field.destroy();assert(textures.every(t=>t.destroyed));
console.log('joined lighting export preserves two resolutions and current resource identity (mock GPU)');
