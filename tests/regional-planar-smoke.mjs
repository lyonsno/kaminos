// kaminos-test: node
import assert from 'node:assert/strict';
import {createDistributedSmokeBindings,COMPOSED_SMOKE_WGSL} from '../scene-smoke-reconstruction.mjs';
globalThis.GPUShaderStage={FRAGMENT:2};
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,UNIFORM:4};
const copies=[];
const device={limits:{maxBufferSize:1e8,maxStorageBufferBindingSize:1e8},
  createBuffer({size}){return {size,data:new Uint8Array(size),destroy(){}};},
  queue:{writeBuffer(b,offset,data){b.data.set(new Uint8Array(data.buffer,data.byteOffset,data.byteLength),offset);},submit(){}},
  createCommandEncoder(){return {copyBufferToBuffer(src,start,dst,offset,size){copies.push({src,dst,offset,size});dst.data.set(src.data.subarray(start,start+size),offset);},finish(){return {};}};},
  createBindGroupLayout:value=>value,createBindGroup:value=>value};
const make=(n,value)=>{
  const masks=device.createBuffer({size:n*4}),planes=device.createBuffer({size:n*16});
  new Uint32Array(masks.data.buffer).fill(value);
  new Float32Array(planes.data.buffer).fill(value+.25);
  return {identity:'prepared-planar-support-v4',texture:{createView:()=>({})},masks,planes,
    staticPreparations:1,updates:1,localMin:[-3,-3,-3],localMax:[3,3,3],coarseDimensions:[2,2,2]};
};
const fine=make(8,1),world=make(27,2),middle=make(64,3);
const bindings=createDistributedSmokeBindings(device);
assert.equal(bindings.layout.entries.filter(e=>e.buffer?.type==='read-only-storage').length,2,
  'regional planar support must retain masks and planes without multiplying storage bindings by region');
const frame={texture:fine.texture,generation:1,frame:2,smokeReconstruction:fine,
  exterior:{generation:1,frame:2,smokeReconstruction:world,middle:{generation:1,frame:2,smokeReconstruction:middle}}};
const group=bindings.update(frame),byBinding=new Map(group.entries.map(e=>[e.binding,e.resource]));
const packedMasks=new Uint32Array(byBinding.get(1).buffer.data.buffer);
const packedPlanes=new Float32Array(byBinding.get(2).buffer.data.buffer);
let offset=0;
for(const [n,value]of [[8,1],[27,2],[64,3]]){
  assert.ok(packedMasks.slice(offset,offset+n).every(v=>v===value));
  assert.ok(packedPlanes.slice(offset*4,(offset+n)*4).every(v=>v===value+.25));
  offset+=n;
}
assert.equal(copies.length,6);
fine.updates++;assert.equal(bindings.update(frame),group);assert.equal(copies.length,6,'radiance changes retain static support');
fine.planes=make(8,4).planes;
bindings.update(frame);assert.equal(copies.length,8,'replacement planar support must reach the packed buffer');
assert.equal(packedPlanes[0],4.25);
assert.throws(()=>bindings.update({...frame,smokeReconstruction:{...fine,planes:null}}),/reconstruction resources/);
assert.throws(()=>bindings.update({...frame,exterior:{...frame.exterior,frame:1}}),/same-generation/);
assert.throws(()=>bindings.update({...frame,smokeReconstruction:{...fine,identity:'prepared-geometry-visible-v1'}}),/reconstruction resources/);
assert.equal((COMPOSED_SMOKE_WGSL.match(/var<storage,read> smokeSupportPlanes:/g)||[]).length,1);
assert.match(COMPOSED_SMOKE_WGSL,/smokeSupportPlanes\[exteriorCoverage.maskOffsets.y\+id\]/);
assert.match(COMPOSED_SMOKE_WGSL,/smokeSupportPlanes\[exteriorCoverage.maskOffsets.z\+id\]/);
bindings.destroy();
console.log('three-region planar support preserves every mask and plane with coherent refresh');
