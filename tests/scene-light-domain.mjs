// kaminos-test: node
import assert from 'node:assert/strict';
import * as domains from '../scene-volume-source.mjs';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {sourceRaySample,integrateCellRay} from '../scene-source-aware.mjs';
import {deriveSourceGuide,sourceGuideRaySample} from '../scene-source-guide.mjs';

assert.equal(typeof domains.sceneSourceDomain,'function','lighting needs the actual source domain, not a fixed tall box');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};
globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
for(const ratio of [1,1.125,1.5,2,3,4]) {
  const dims=[32,32*ratio,32],domain=domains.sceneSourceDomain(dims),height=2*ratio;
  assert.deepEqual(domain.lo,[-1,-1,-1]);assert.deepEqual(domain.hi,[1,-1+height,1]);
  assert.equal(domain.volume,4*height);
  const ray=sourceRaySample([0,-2,0],0,0,domain);
  assert.ok(ray.point[1]>-1&&ray.point[1]<height-1);assert.ok(ray.pdf>0);
  near(integrateCellRay(()=>[2,1,0,0],dims,[0,-2,0],[0,1,0])[0],2*height);
  near(integrateCellRay(()=>[2,1,0,3],dims,[0,-2,0],[0,1,0])[0],2*(1-Math.exp(-3*height))/3);
  const guide=deriveSourceGuide({position:[0,4,0],radius:.2,height:1,depth:.1},undefined,domain);
  assert.ok(guide.hi[1]<=domain.hi[1]);
  const broad=sourceGuideRaySample([0,-2,0],0,guide,4,0,domain);
  assert.ok(broad.pdf>0);assert.ok(broad.point[1]<=domain.hi[1]);
  const uploads=new Map(),textures=[],modules=[],dispatches=[];
  const pipeline={getBindGroupLayout:()=>({})};
  const device={limits:{maxStorageBufferBindingSize:1e9,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},
    queue:{writeBuffer(buffer,offset,data){uploads.set(buffer.label,new Float32Array(data));},submit(){}},
    createBuffer:d=>({...d,destroy(){}}),createTexture:d=>{textures.push(d);return {createView:()=>({}),destroy(){}};},
    createShaderModule:d=>{modules.push(d);return d;},createComputePipeline:()=>pipeline,createBindGroup:()=>({}),
    createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(...n){dispatches.push(n);},end(){}}),finish:()=>({})})};
  const gather=createVolumeGather(device,{geometry:{nodes:new Float32Array(12),triangles:new Float32Array(12),nodeCount:1,triangleCount:0},receivers:[],volumeGrid:16,smokeRefinement:1,sourceDimensions:dims});
  const field={status:'encoded',texture:{createView:()=>({})},dimensions:dims,localMin:domain.lo,localMax:domain.hi,generation:1,frame:1};
  const frame=gather.encode(field);
  assert.equal(frame.allocatedVolumeReceivers,16*16*16*ratio);
  assert.deepEqual(frame.sourceDomain,{lo:domain.lo,hi:domain.hi});
  assert.deepEqual(textures.find(t=>t.label==='direct flame mean incident radiance').size,[16,16*ratio,16]);
  const values=uploads.get('surface and smoke receivers');
  near(values[1],-1+1/16);near(values.at(-7),height-1-1/16);
  assert.ok(dispatches.length>0);
  const shader=modules.find(m=>m.label==='distributed volume ray gather').code;
  assert.match(shader,/VOLUME_HEIGHT:u32=/,'height-dependent texture indexing must reach the shader');
  assert.doesNotMatch(shader,/vec3<f32>\(1\.0,3\.0,1\.0\)/,'ray integration cannot retain the tall box');
  assert.throws(()=>gather.encode({...field,localMax:[1,999,1]}),/domain|bounds/,'conflicting source bounds cannot silently use old receivers');
  gather.destroy();
}
for(const dims of [[0,2,1],[1,NaN,1],[2,4,3]])assert.throws(()=>domains.sceneSourceDomain(dims),/dimensions/);
console.log('PASS actual source bounds, receiver allocations, chord transport and guided coverage across supported aspect ratios');
