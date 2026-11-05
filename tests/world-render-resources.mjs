// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {worldRenderShape,createWorldRenderField,WORLD_RENDER_STRIDE} from '../volume-world-render.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4};
globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4};
function fixture(){
 const groups=[],passes=[],textures=[],writes=[];let finish;
 const device={limits:{maxTextureDimension3D:2048,maxComputeWorkgroupsPerDimension:65535},
 createBuffer:x=>({...x,destroy(){}}),createComputePipeline:x=>({...x,getBindGroupLayout:i=>i}),
 createTexture(x){const t={...x,width:x.size[0],height:x.size[1],depthOrArrayLayers:x.size[2],dead:false,createView(){return {texture:this};},destroy(){this.dead=true;}};textures.push(t);return t;},
 createBindGroup(x){groups.push(x);return x;},queue:{writeBuffer(...args){writes.push(args);},onSubmittedWorkDone:()=>new Promise(r=>{finish=r;})}};
 const encoder={beginComputePass(x){passes.push(x);return {setPipeline(){},setBindGroup(i,g){for(const e of g.entries)assert.equal(e.resource?.texture?.dead??false,false);},dispatchWorkgroups(...v){x.dispatch=v;},end(){}};}};
 const field=createWorldRenderField(device,{},{});
 const source={steps:1,gas:{},plan:{materialDims:[8,4,4],materialPitch:.5,min:[-2,-1,-1],max:[2,1,1]},hierarchy:null};
 return {field,source,groups,passes,textures,writes,encode:()=>field.encode(encoder,source,[1,2]),finish:()=>finish?.()};
}
test('atlas capacity packs every node without depending on maximum refinement depth',()=>{
 for(const n of [1,9,1024,8192]){const s=worldRenderShape(n,2048);assert.ok(s.every(v=>v<=2048));assert.ok(s.reduce((a,b)=>a*b)>=n*WORLD_RENDER_STRIDE);}
 assert.throws(()=>worldRenderShape(9,4),/capacity/);
 assert.throws(()=>worldRenderShape(NaN,2048),/capacity/);
});
test('same-state reuse, actual current gas, topology and material changes govern preparation',()=>{
 const f=fixture();assert.equal(f.encode(),true);assert.equal(f.field.read().effective,'dense-cell-optics');assert.equal(f.passes.length,1);
 assert.equal(f.encode(),false);assert.equal(f.passes.length,1,'same observation does not rebuild');
 f.source.gas={};f.encode();assert.equal(f.passes.length,2,'replacement gas cannot reuse stale optics');
 f.source.hierarchy={nodes:{},work:{},nodeCount:10,leafCount:9,capacity:10,revision:1,steps:2};f.source.steps=2;
 assert.equal(f.encode(),true);assert.equal(f.field.read().effective,'resident-leaf-optics');assert.equal(f.field.read().leafCount,9);
 f.source.hierarchy.revision++;f.encode();assert.equal(f.passes.length,4,'topology revision rebuilds even at equal dimensions');
 assert.equal(f.field.encode({},{...f.source},[1,2]),false);
 const groups=f.groups.length;f.source.steps++;f.encode();assert.equal(f.groups.length,groups,'same buffers reuse bindings');
 f.field.encode({beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}},f.source,[2,2]);assert.equal(f.field.read().builds,6,'material change refreshes held field');
 assert.equal(f.field.read().smokeOnly,false);
 f.field.encode({beginComputePass(){return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}},f.source,[2,2],{worldSmokeOnly:true});
 assert.equal(f.field.read().builds,7,'toggling worldSmokeOnly refreshes held field');
 assert.equal(f.field.read().smokeOnly,true);
 assert.equal(new Float32Array(f.writes.at(-1)[2])[7],5,'hierarchy (1) | worldSmokeOnly (4) packed into loMode.w');
 f.field.destroy();
});
test('resize retires the old atlas after submission and inactive state cannot claim refined output',async()=>{
 const f=fixture();f.encode();const old=f.textures.at(-1);
 f.source.hierarchy={nodes:{},work:{},nodeCount:10,leafCount:9,capacity:10,revision:1,steps:2};f.encode();
 assert.equal(old.dead,false);await Promise.resolve();f.finish();await Promise.resolve();assert.equal(old.dead,true);
 f.field.encode({},null,[]);assert.equal(f.field.read().effective,'inactive');f.field.destroy();
});

test('camera indexing consumes exact material dimensions instead of deriving strides from transformed bounds',async()=>{
 const {WORLD_RENDER_WGSL}=await import('../volume-world-render.mjs');
 assert.match(WORLD_RENDER_WGSL,/let dims=worldRender\.atlas\.yzw/);
 assert.doesNotMatch(WORLD_RENDER_WGSL,/let dims=\(worldRender\.hiEnabled/);
 assert.match(WORLD_RENDER_WGSL,/for\(var depth=0u;depth<16u;depth\+\+\)/,'resident octree traversal must be depth-bounded');
 assert.match(WORLD_RENDER_WGSL,/if\(n\.w<=0\.0\)\{return EmissiveMaterial\(vec3<f32>\(0\),0,0\);\}/,'resident sampling must guard zero brick pitch');
 const f=fixture();f.encode();assert.deepEqual(f.field.read().materialDims,[8,4,4]);
 // A valid translated mapping can cross ceil's integer boundary in f32.
 const r=Math.fround,derived=r(r(r(-3.862)-r(-4.662))/r(.1));
 assert.ok(derived>8);assert.equal(Math.ceil(derived/4),3);assert.equal(Math.ceil(8/4),2);
 f.field.destroy();
});

test('shared scene consumers prepare resident World optics and record stepping receipts when canvas draw is suppressed',async()=>{
 const {readFileSync}=await import('node:fs');
 const core=readFileSync(new URL('../volume-core.js',import.meta.url),'utf8');
 const shared=core.slice(core.indexOf('  function prepareSharedSceneConsumers('),core.indexOf('  function prepareRayStepCounters('));
 assert.match(shared,/prepareVolumeRenderResources\(encoder\)/,'shared scene consumers must prepare World and display render resources before encoding scene source or host transport');
 const host=core.slice(core.indexOf('  function renderSceneTransportHost('),core.indexOf('  function prepareSharedSceneConsumers('));
 assert.match(host,/state\.opticalStepping\s*=/,'native scene transport must publish current opticalStepping state when encodeDraw is bypassed');
 assert.match(host,/state\.worldSmoke\.raymarch\s*=/,'native scene transport must publish current worldSmoke.raymarch state when encodeDraw is bypassed');
});

