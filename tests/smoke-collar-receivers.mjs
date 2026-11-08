// kaminos-test: node
import assert from 'node:assert/strict';
import {volumeGatherPlan,createVolumeGather} from '../scene-volume-gather.mjs';
import {createSceneVolumeSource} from '../scene-volume-source.mjs';
import {WORLD_SMOKE_OPTICS_WGSL} from '../volume-world-smoke-optics.mjs';
import {COMPOSED_SMOKE_WGSL,createDistributedSmokeBindings} from '../scene-smoke-reconstruction.mjs';
import {createExteriorSmokeLight} from '../scene-exterior-light.mjs';
const limits={maxStorageBufferBindingSize:1e9,maxBufferSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535};
const bounds={lo:[-2,-1,-3],hi:[2,7,3]};
assert.deepEqual(volumeGatherPlan({volumeGrid:4,receiverBounds:bounds},limits).volumeDimensions,[4,8,6], 'independent XYZ coverage retains cubic physical pitch');
globalThis.GPUShaderStage={FRAGMENT:1};
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
const groups=[],writes=new Map();
const device={limits,queue:{writeBuffer(b,offset,data){const next=offset===0?new Float32Array(Math.max(b.size??0,offset+data.byteLength)/4):(writes.get(b.label)??new Float32Array(Math.max(b.size??0,offset+data.byteLength)/4));next.set(new Float32Array(data),offset/4);writes.set(b.label,next);},submit(){}},
 createBindGroupLayout(o){return o;},
 createBuffer(o){return {...o,destroy(){}};},createTexture(){return {createView(){return {};},destroy(){}};},createShaderModule(){return {};},
 createComputePipeline(){return {getBindGroupLayout(){return {};}};},createBindGroup(g){groups.push(g);return g;},
 createCommandEncoder(){return {copyBufferToBuffer(){},beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};},finish(){return {};}};}};
const geometry={nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:0,triangleCount:0};
const source={texture:device.createTexture(),dimensions:[4,8,4],status:'encoded',frame:1,generation:1};
const full=createVolumeGather(device,{geometry,receivers:[],volumeGrid:16,sourceDimensions:source.dimensions,receiverBounds:{lo:[-2,-2,-2],hi:[2,6,2]},smokeRefinement:1,directions:4,
 receiverExclusion:{lo:[-1,-1,-1],hi:[1,3,1],blendWidth:.125}});
const frame=full.encode(source);
assert.ok(frame.activeVolumeReceivers<frame.allocatedVolumeReceivers,'overlap interior must skip ray work');
assert.ok(frame.activeVolumeReceivers>0);
const packed=writes.get('surface and smoke receivers');
for(let i=0;i<packed.length;i+=8)if(packed[i+7]>0){
 for(let a=0;a<3;a++)assert.ok(packed[i+a]>[-1,-1,-1][a]+.125+.5&&packed[i+a]<[1,3,1][a]-.125-.5,'excluded donors must be beyond reconstruction/filter support');
}
full.destroy();
let world={texture:device.createTexture(),dimensions:[4,8,4],localMin:[-3,-3,-3],localMax:[3,9,3],handoffMargin:.17};
const producer=createSceneVolumeSource({device,module:{},uniformBuffer:{},fluidBuffers:[{}],frontBuffers:[{}],getReactantTextures:()=>[device.createTexture()],grid:4,gridY:8,getWorldSmoke:()=>world,worldRenderUniform:{}});
producer.encode(device.createCommandEncoder(),0,1);
assert.equal(producer.describe().exterior.handoffMargin,.17,'source preserves authored handoff width');
assert.ok(groups.some(g=>[20,21].every(b=>g.entries.some(e=>e.binding===b))), 'fine source must bind the physical World coefficients used by the camera');
const light=createExteriorSmokeLight(device,{grid:2,refinement:1});
const lit=light.encode(producer.describe(),{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.equal(lit.handoffMargin,.17,'published receiver frame preserves the authored handoff width');
light.destroy();producer.destroy();
console.log('smoke collar receiver coverage, overlap and source composition pass');
const far={...source,exterior:{texture:device.createTexture(),dimensions:[8,16,8],localMin:[-4,-4,-4],localMax:[4,12,4],status:'encoded',frame:1,generation:1}};
const regional=createExteriorSmokeLight(device,{grid:8,refinement:1,receiverCoverage:{lo:[-1.5,-1,-2],hi:[1.5,5,2],pitch:.25}});
const near=regional.encode(far,{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.deepEqual(near.middle?.smokeReconstruction.coarseDimensions,[12,24,16], 'lighting-only near grid must not require simulated Middle material');
assert.deepEqual(near.middle.smokeReconstruction.localMin,[-1.5,-1,-2]);
assert.ok(near.middle.skippedVolumeReceivers>0,'near overlap skips the Fine core');
const built=near.builds;
const next=regional.encode({...far,generation:2,frame:2,exterior:{...far.exterior,generation:2,frame:2}},{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.equal(next.builds,built,'live smoke frames reuse stable receiver/visibility resources');
regional.setReceiverCoverage(null);
assert.equal(regional.encode(far,{geometry,revision:1,worldGeometry:false,directions:4,gain:1}).middle,null,'disabled near coverage leaves no stale lookup');
assert.throws(()=>regional.setReceiverCoverage({lo:[0,0,0],hi:[1,1,1],pitch:0}),/pitch/);
regional.destroy();

const prepared=()=>({identity:'prepared-planar-support-v4',texture:device.createTexture(),masks:device.createBuffer({size:16}),planes:device.createBuffer({size:64}),coarseDimensions:[16,32,16],staticPreparations:1,updates:1,localMin:[-3,-3,-3],localMax:[3,9,3]});
const binding=createDistributedSmokeBindings(device);
binding.update({...source,smokeReconstruction:prepared(),exterior:{...source,handoffMargin:.17,smokeReconstruction:prepared()}});
assert.ok(Math.abs(writes.get('exterior smoke lookup coverage')[7]-1.17)<1e-6,'lookup consumes the propagated authored margin');
binding.destroy();

const rounded=createExteriorSmokeLight(device,{grid:8,refinement:4,receiverCoverage:{lo:[-1.5,-1,-1.5],hi:[1.5,5,1.5],pitch:.125}});
const roundedFrame=rounded.encode({...far,exterior:{...far.exterior,handoffMargin:.36}},{geometry,revision:1,worldGeometry:false,directions:4,gain:1});
assert.ok(roundedFrame.middle.skippedVolumeReceivers>0,'default rounded handoff retains an anisotropic Fine core instead of applying top margin to X/Z');
rounded.destroy();

const functions=[...(WORLD_SMOKE_OPTICS_WGSL+COMPOSED_SMOKE_WGSL).matchAll(/\bfn\s+(\w+)\s*\(/g)].map(m=>m[1]);
assert.deepEqual(functions.filter((name,i)=>functions.indexOf(name)!==i),[],'assembled camera fragments must have distinct module-scope declarations');
for(const fineReceiverGrid of [1,2]){
 const low=createExteriorSmokeLight(device,{grid:2,refinement:1});
 assert.doesNotThrow(()=>low.encode(far,{geometry,revision:1,worldGeometry:false,directions:4,gain:1,fineReceiverGrid}), 'valid low receiver grids retain every donor when the removable core is empty');
 low.destroy();
}
let mutableWorld={...world,handoffMargin:.36};
const cameraUniform=device.createBuffer({label:'live physical handoff',size:80});
const changing=createSceneVolumeSource({device,module:{},uniformBuffer:{},fluidBuffers:[{}],frontBuffers:[{}],getReactantTextures:()=>[device.createTexture()],grid:4,gridY:8,getWorldSmoke:()=>mutableWorld,worldRenderUniform:cameraUniform});
changing.encode(device.createCommandEncoder(),0,1);
assert.ok(Math.abs(writes.get('live physical handoff')[9]-.36)<1e-6);
for(const value of [undefined,0]){
 if(value===undefined)delete mutableWorld.handoffMargin;else mutableWorld.handoffMargin=value;
 changing.encode(device.createCommandEncoder(),0,2);
 assert.equal(writes.get('live physical handoff')[9],0,'removed or zero optional margin restores the physical cell-width law');
 assert.equal(changing.describe().exterior.handoffMargin,0,'effective published law agrees with the physical camera uniform');
}
changing.destroy();
