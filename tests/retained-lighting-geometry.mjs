// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createVolumeGather} from '../scene-volume-gather.mjs';
import {createExteriorSmokeLight} from '../scene-exterior-light.mjs';
import {buildTriangleVisibility} from '../scene-light-visibility.mjs';
const identity=new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]);
function geometry(count){const g=buildTriangleVisibility(Array.from({length:count},(_,i)=>({a:[0,0,i/100],b:[1,0,i/100],c:[0,1,i/100]}))).packGpu();g.matrices=identity;g.owners=new Uint32Array(Math.max(1,g.nodeCount+g.triangleCount));return g;}
export function fixture(){
 globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4,COPY_SRC:8};globalThis.GPUTextureUsage={STORAGE_BINDING:1,TEXTURE_BINDING:2,COPY_SRC:4};
 const resources=[],pipelines=[],writes=[];
 const resource=spec=>{const r={...spec,destroyed:0,createView:()=>({texture:r}),destroy(){this.destroyed++;}};resources.push(r);return r;};
 const device={limits:{maxStorageBufferBindingSize:1e8,maxTextureDimension2D:1024,maxTextureDimension3D:256,maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(b,o,d){assert.ok(!b.destroyed);assert.ok(d.byteLength+o<=b.size);writes.push({buffer:b,data:d.slice()});},submit(){}},createBuffer:resource,createTexture:spec=>resource({...spec,texture:true}),createShaderModule:s=>s,createComputePipeline(spec){pipelines.push(spec);return {getBindGroupLayout:()=>({})};},createBindGroup:g=>g,createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})})};
 return {device,resources,pipelines,writes};
}
test('changed lighting topology retains volume textures and pipelines through growth, shrink and empty geometry',()=>{
 const f=fixture(),source={status:'encoded',texture:f.device.createTexture({}),dimensions:[2,2,2],generation:1,frame:1};
 const gather=createVolumeGather(f.device,{geometry:geometry(1),receivers:[],volumeGrid:2,sourceDimensions:source.dimensions,smokeRefinement:1,directions:2,worldGeometry:true});
 try{
  gather.encode(source);const textures=f.resources.filter(r=>r.texture),compiled=f.pipelines.length,smoke=gather.smoke;
  for(const count of [20,2,0,9]){
   gather.setGeometry(geometry(count));const frame=gather.encode({...source,frame:++source.frame});
   assert.equal(frame.geometryTriangles,count);assert.equal(gather.smoke,smoke);
   assert.deepEqual(f.resources.filter(r=>r.texture),textures,'typing must not allocate replacement optical volumes');
   assert.equal(f.pipelines.length,compiled,'topology counts are data, never shader variants');
  }
 }finally{gather.destroy();}
 assert.ok(f.resources.every(r=>r.destroyed===1||r===source.texture));
});
test('exterior lighting retains each region through geometry revisions',()=>{
 const f=fixture(),texture=f.device.createTexture({}),source={status:'encoded',texture,dimensions:[2,2,2],generation:1,frame:1,exterior:{status:'encoded',texture,dimensions:[2,2,2],localMin:[-2,-2,-2],localMax:[2,2,2],generation:1,frame:1}};
 const lighting=createExteriorSmokeLight(f.device,{grid:2,refinement:1});
 try{
  const first=lighting.encode(source,{geometry:geometry(1),revision:1,directions:2,gain:1});const count=f.pipelines.length;
  const next=lighting.encode(source,{geometry:geometry(20),revision:2,directions:2,gain:1});
  assert.equal(next.texture,first.texture);assert.equal(f.pipelines.length,count);assert.equal(next.geometryTriangles,20);
 }finally{lighting.destroy();}
});
