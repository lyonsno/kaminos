// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createJoinedExterior} from '../volume-joined-exterior.mjs';

// Resource-lifetime witness, not a GPU numerical or performance oracle.
function fixture(){
  globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8};
  globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_DST:4};
  globalThis.GPUShaderStage={COMPUTE:1};
  const resources=[],pipelines=[];
  const resource=o=>{const r={...o,destroyed:false,destroy(){this.destroyed=true;},createView(){return {texture:this};}};resources.push(r);return r;};
  const device={limits:{maxTextureDimension3D:2048,maxBufferSize:2**30,maxStorageBufferBindingSize:2**30,maxComputeWorkgroupsPerDimension:65535},
    queue:{writeBuffer(){},writeTexture(){},submit(){}},createBuffer:resource,
    createTexture:o=>resource({...o,width:o.size[0],height:o.size[1],depthOrArrayLayers:o.size[2]}),
    createShaderModule:o=>o,createBindGroupLayout:o=>o,createPipelineLayout:o=>o,createBindGroup:o=>o,
    createComputePipeline:o=>{pipelines.push(o);return {...o,getBindGroupLayout:()=>({})};}};
  const p={dims:[4,4,4],pitch:.5,allocation:1,fluidBuffers:[{},{}],lowerFaceTexture:{width:4,height:4,depthOrArrayLayers:3,dimension:'2d',format:'r32float',usage:3,mipLevelCount:1,sampleCount:1,createView:()=>({})},burnRateTexture:{},solidMask:{revision:'a',cells:new Uint8Array(64)}};
  return {device,p,resources,pipelines};
}
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
