// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJoinedExterior} from '../volume-joined-exterior.mjs';
import * as THREE from '../lib/three.core.js';
import {createOuterSmoke,outerSmokeConfig} from '../volume-outer-smoke.mjs';

// Resource-lifetime witness, not a GPU numerical or performance oracle.
function fixture(){
  globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8};
  globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_DST:4};
  globalThis.GPUShaderStage={COMPUTE:1};
  const resources=[],pipelines=[],groups=[],writes=[],passes=[];
  const resource=o=>{const r={...o,destroyed:false,destroy(){this.destroyed=true;},createView(){return {texture:this};}};resources.push(r);return r;};
  const device={limits:{maxTextureDimension3D:2048,maxBufferSize:2**30,maxStorageBufferBindingSize:2**30,maxComputeWorkgroupsPerDimension:65535},
    queue:{writeBuffer(buffer,offset,data){writes.push({buffer,offset,data:data.slice?.(0)??data});},writeTexture(){},submit(){}},createBuffer:resource,
    createTexture:o=>resource({mipLevelCount:1,sampleCount:1,...o,width:o.size[0],height:o.size[1],depthOrArrayLayers:o.size[2]}),
    createShaderModule:o=>o,createBindGroupLayout:o=>o,createPipelineLayout:o=>o,createBindGroup:o=>{groups.push(o);return o;},
    createCommandEncoder(){return {clearBuffer(){},copyBufferToBuffer(){},finish(){return {};},beginComputePass(o){passes.push(o);return {setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}};}};},
    createComputePipeline:o=>{pipelines.push(o);return {...o,getBindGroupLayout:()=>({})};}};
  const p={dims:[4,4,4],pitch:.5,allocation:1,fluidBuffers:[{},{}],lowerFaceTexture:{width:4,height:4,depthOrArrayLayers:3,dimension:'2d',format:'r32float',usage:3,mipLevelCount:1,sampleCount:1,createView:()=>({})},burnRateTexture:{},solidMask:{revision:'a',cells:new Uint8Array(64)}};
  return {device,p,resources,pipelines,groups,writes,passes};
}

test('exterior authored geometry shares a resident mask between pressure and transport across movement and removal',()=>{
  const {device,p,resources,pipelines,groups,writes}=fixture();
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5));mesh.position.y=2;
  p.sceneSolids={objects:[{id:'outer-obstacle',object:mesh}],transform:{translate:[10,20,30],scale:2},revision:'outer-a'};
  const joined=createJoinedExterior(device,{coarseResolution:4,residentSolids:true});
  const prepared=joined.prepare(p);assert.equal(prepared.admitted,true,prepared.reason);
  assert.equal(joined.receipt().solids.scene?.backend,'gpu','exterior must consume authored scene geometry, not just configured slabs');
  const mask=resources.find(r=>r.label==='GPU resident scene solid');assert.ok(mask);
  assert.ok(groups.some(g=>g.entries.some(e=>e.binding===2&&e.resource.texture===mask)),'pressure classifier must bind the authored coarse texture');
  assert.equal(joined.receipt().outer.solidRevision,joined.receipt().solids.coarse);
  const transformWrite=writes.find(w=>w.buffer.label==='scene solid transform');
  assert.deepEqual(Array.from(new Float32Array(transformWrite.data).slice(16,20)),[10,20,30,4]);
  const before=joined.receipt(),optical=joined.optical,compiled=pipelines.length;
  const uploads=()=>resources.filter(r=>r.label==='resident scene solid local triangles').length;
  assert.equal(uploads(),1);
  mesh.position.x=1;p.sceneSolids.revision='outer-b';
  assert.equal(joined.matches(p),false,'outer-only motion invalidates occupancy');
  assert.equal(joined.prepare(p).admitted,true);
  assert.equal(joined.receipt().topologyGeneration,before.topologyGeneration);
  assert.equal(joined.optical,optical);assert.equal(pipelines.length,compiled);assert.equal(uploads(),1);
  assert.equal(resources.filter(r=>r.label==='GPU resident scene solid').length,1);
  // The consumer's diagnostic exposes the exact bound transport mask, not a CPU proxy.
  assert.equal(joined.receipt().solids.scene.status,'submitted-unverified');
  p.sceneSolids={...p.sceneSolids,objects:[],revision:'removed'};
  assert.equal(joined.prepare(p).admitted,true);
  assert.equal(joined.receipt().solids.scene.backend,'configured-wall');
  assert.equal(mask.destroyed,true,'last-object removal releases the producer and cannot retain its old output');
  assert.equal(before.solids.scene.backend,'gpu','an earlier receipt must not change when a later pose removes geometry');
  assert.equal(joined.receipt().outer.solidRevision,joined.receipt().solids.coarse);
  joined.destroy();assert.ok(resources.every(r=>r.destroyed));
});

test('outer transport borrows the exact supplied mask and releases cached bindings on replacement',()=>{
  const {device,groups}=fixture(),c=outerSmokeConfig({grid:4,extent:2,donorMode:'joined-full'});
  const outer=createOuterSmoke(device,c,4,[{},{}]);
  const mask=device.createTexture({size:c.shape,dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING});
  assert.equal(typeof outer.bindSolids,'function');outer.bindSolids(mask,'pose-1');
  const step=()=>outer.encodeExternalProjection(device.createCommandEncoder(),0,{dtScale:1,backtraceScale:1},()=>{});
  step();assert.equal(groups.at(-1).entries.find(e=>e.binding===6).resource.texture,mask);
  const count=groups.length;outer.bindSolids(mask,'pose-2');step();step();const warmed=groups.length;step();assert.equal(groups.length,warmed);
  assert.throws(()=>outer.bindSolids({...mask,width:99},'bad'),/match current domain/);
  outer.clearSolids();step();assert.equal(groups.at(-1).entries.find(e=>e.binding===6).resource.texture,outer.solids);
  assert.ok(groups.length>count);outer.destroy();assert.equal(mask.destroyed,false);mask.destroy();
});
test('collider occupancy changes preserve exterior state and optical resources',()=>{
  const {device,p,resources}=fixture(),joined=createJoinedExterior(device,{coarseResolution:4});
  assert.equal(joined.prepare(p).admitted,true);
  const optical=joined.optical,states=resources.filter(r=>r.label?.startsWith('outer smoke state'));
  const before=joined.receipt();p.solidMask={revision:'b',cells:p.solidMask.cells.slice()};p.solidMask.cells[21]=1;
  assert.equal(joined.matches(p),false);
  assert.equal(joined.prepare(p).admitted,true);
  assert.equal(joined.optical,optical,'mesh movement must not replace exterior optical/state allocation');
  assert.equal(joined.receipt().generation,before.generation);
  assert.equal(states.length,2);assert.ok(states.every(r=>!r.destroyed));
  assert.equal(joined.receipt().cells,before.cells-1);
  assert.equal(joined.matches(p),true);
  joined.destroy();assert.ok(resources.every(r=>r.destroyed));
});
test('revision-only movement allocates no GPU resources or pipelines',()=>{
  const {device,p,resources,pipelines}=fixture(),joined=createJoinedExterior(device,{coarseResolution:4});
  assert.equal(joined.prepare(p).admitted,true);
  const counts=[resources.length,pipelines.length];
  p.solidMask={revision:'same occupancy',cells:p.solidMask.cells.slice()};
  assert.equal(joined.prepare(p).admitted,true);assert.equal(joined.matches(p),true);
  assert.deepEqual([resources.length,pipelines.length],counts);
  joined.destroy();
});
test('resident occupancy changes preserve pressure addresses, buffers and pipelines',()=>{
  const {device,p,resources,pipelines}=fixture();
  const joined=createJoinedExterior(device,{coarseResolution:4,residentSolids:true});
  assert.equal(joined.prepare(p).admitted,true);const before=joined.receipt(),counts=[resources.length,pipelines.length];
  p.solidMask={revision:'moving',cells:p.solidMask.cells.slice()};p.solidMask.cells[21]=1;
  assert.equal(joined.prepare(p).admitted,true);
  assert.equal(joined.receipt().cells,before.cells,'moving obstacle must not renumber pressure cells');
  assert.equal(joined.receipt().topologyGeneration,before.topologyGeneration);
  assert.deepEqual([resources.length,pipelines.length],counts,'moving obstacle must not allocate or compile');
  joined.destroy();assert.ok(resources.every(r=>r.destroyed));
});
test('allocation changes still rebuild; malformed masks cannot replace a valid state',()=>{
  const {device,p}=fixture(),joined=createJoinedExterior(device,{coarseResolution:4});
  assert.equal(joined.prepare(p).admitted,true);const old=joined.optical;
  const bad={...p,solidMask:{revision:'bad',cells:new Uint8Array(1)}};
  assert.equal(joined.prepare(bad).admitted,false);assert.equal(joined.matches(bad),false);
  assert.equal(joined.optical,old);assert.equal(old.destroyed,false);
  p.allocation++;assert.equal(joined.prepare(p).admitted,true);
  assert.notEqual(joined.optical,old);assert.equal(old.destroyed,true);joined.destroy();
});
test('resident GPU masks remain producer-owned across revisions and disposal',()=>{
  const {device,p,resources,pipelines}=fixture();
  const texture=device.createTexture({size:p.dims,dimension:'3d',format:'r32uint',mipLevelCount:1,sampleCount:1,usage:GPUTextureUsage.TEXTURE_BINDING});
  p.solidMask={backend:'gpu',texture,revision:'gpu-1',cells:null};
  const joined=createJoinedExterior(device,{coarseResolution:4,residentSolids:true});
  assert.equal(joined.prepare(p).admitted,true);const counts=[resources.length,pipelines.length];
  device.queue.writeTexture=()=>{throw Error('GPU producer mask must not be replaced by a CPU upload');};
  p.solidMask.revision='gpu-2';assert.equal(joined.prepare(p).admitted,true);
  assert.deepEqual([resources.length,pipelines.length],counts);
  joined.destroy();assert.equal(texture.destroyed,false,'consumer must not destroy producer-owned mask');texture.destroy();
});
test('resident preparation refusal is visible to admission without revoking other grid configurations',()=>{
  const {device,p}=fixture(),joined=createJoinedExterior(device,{coarseResolution:4,residentSolids:true});
  assert.equal(joined.prepare({...p,fluidBuffers:[]}).admitted,false);
  assert.deepEqual(joined.admission(p),{admitted:false,reason:'producer-resources-missing'});
  assert.equal(joined.admission({...p,dims:[8,8,8],pitch:.25}).admitted,true);
  joined.destroy();
});
test('a corrected producer allocation can recover from preparation failure at the same geometry',()=>{
 const {device,p}=fixture(),joined=createJoinedExterior(device,{coarseResolution:4,residentSolids:true});
 assert.equal(joined.prepare({...p,fluidBuffers:[]}).admitted,false);
 assert.equal(joined.admission(p).admitted,false);
 assert.equal(joined.retryAvailable(p),false);
 p.allocation++;joined.deferRetry(p,'producer-resources-missing');
 assert.equal(joined.retryAvailable(p),false,'fallback allocation itself must not trigger endless retries');
 p.allocation++;
 assert.equal(joined.retryAvailable(p),true);
 assert.equal(joined.admission(p).admitted,true,'new producer must be allowed to retry');
 assert.equal(joined.prepare(p).admitted,true);assert.equal(joined.admission(p).admitted,true);
 assert.equal(joined.retryAvailable(p),false);
 assert.equal(joined.matches(p),true);joined.destroy();
});
