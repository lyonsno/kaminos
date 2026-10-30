// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {createMaterialHierarchyGPU} from '../volume-material-hierarchy-gpu.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16};
globalThis.GPUMapMode={READ:1};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
// This fake checks ownership/dispatch, not WebGPU shader conformance. The
// native witness separately exercises the shaders and real buffer mapping.
function fixture(options={}){
 const buffers=[],groups=[],passes=[];let hold=false;const maps=[];
 const device={limits:{maxStorageBufferBindingSize:2**28,maxBufferSize:2**28,maxComputeWorkgroupsPerDimension:65535},
  createBuffer(spec){const b={...spec,data:new ArrayBuffer(spec.size),destroyed:false,mapState:'unmapped',
   async mapAsync(){assert.equal(this.destroyed,false);assert.equal(this.mapState,'unmapped');this.mapState='pending';if(hold)await new Promise(resolve=>maps.push(resolve));assert.equal(this.destroyed,false);this.mapState='mapped';},
   getMappedRange(){assert.equal(this.mapState,'mapped');return this.data;},unmap(){assert.equal(this.mapState,'mapped');this.mapState='unmapped';},destroy(){assert.equal(this.destroyed,false,`${this.label} double destroy`);this.destroyed=true;}};buffers.push(b);return b;},
  createShaderModule:x=>x,createComputePipeline:x=>({...x,getBindGroupLayout:index=>({name:x.label,index})}),
  createBindGroup(spec){groups.push(spec);return spec;},
  queue:{writeBuffer(b,offset,data){new Uint8Array(b.data).set(new Uint8Array(data.buffer??data,data.byteOffset??0,data.byteLength),offset);},onSubmittedWorkDone:async()=>{}},
 };
 const encoder=()=>({beginComputePass({label}){const pass={label,groups:[]};passes.push(pass);return {setPipeline(){},setBindGroup(i,g){pass.groups[i]=g;},dispatchWorkgroups(x,y=1,z=1){pass.count=x*y*z;if(label==='measureBricks'){const b=pass.groups[1].entries.find(e=>e.binding===5).resource.buffer;new Float32Array(b.data).fill(.5);}},end(){}};},copyBufferToBuffer(src,so,dst,offset,bytes){assert.equal(dst.destroyed,false);assert.equal(dst.mapState,'unmapped','never copy into an in-flight/mapped readback');new Uint8Array(dst.data,offset,bytes).set(new Uint8Array(src.data,so,bytes));}});
 const world=Object.fromEntries([0,1,2,4,5].map(k=>[k,{buffer:device.createBuffer({label:`world${k}`,size:16})}]));
 for(const k of [8,9,10,11,14,15,16])world[k]={texture:k};
 const hierarchy=createMaterialHierarchyGPU(device,{materialDims:[8,4,4],materialPitch:1,min:[0,0,0],max:[8,4,4]},'',{budget:0,...options});
 const step=()=>hierarchy.encode(encoder(),world,1);
 return {hierarchy,world,buffers,groups,passes,step,hold(){hold=true;},release(){hold=false;for(const r of maps.splice(0))r();}};
}
test('stable topology reuses demand staging and both ping-pong binding variants',async()=>{
 const f=fixture();try{
  for(let i=0;i<4;i++){f.step();await flush();}
  const groupCount=f.groups.length;f.step();await flush();
  assert.equal(f.groups.length,groupCount,'steady frame must reuse bind groups');
  assert.equal(f.buffers.filter(b=>b.label==='material demand readback').length,1,'steady readback reuses one unmapped buffer');
  const nextFlow={label:'new flow'};f.world[2]={buffer:nextFlow};f.world[9]={texture:'new solids'};f.step();await flush();
  const measure=f.passes.findLast(p=>p.label==='measureBricks');
  assert.equal(measure.groups[0].entries.find(e=>e.binding===2).resource.buffer,nextFlow,'changed flow resource must bind immediately');
  assert.equal(measure.groups[0].entries.find(e=>e.binding===9).resource,f.world[9],'changed collision texture must bind immediately');
 }finally{f.hierarchy.destroy();await flush();}
});
test('parent demand is reconstructed from children; only leaves are measured',async()=>{
 const f=fixture({budget:8,maxDetail:2});try{
  f.step();await flush();f.step();await flush();
  const state=f.hierarchy.read();assert.ok(state.allocatedBricks>state.leafBricks);
  assert.equal(f.passes.findLast(p=>p.label==='measureBricks').count,state.leafBricks);
 }finally{f.hierarchy.destroy();await flush();}
});
test('resize and disposal preserve an in-flight demand readback, then retire it',async()=>{
 const f=fixture();f.hold();f.step();await flush();
 const first=f.buffers.find(b=>b.label==='material demand readback');
 f.hierarchy.configure({budget:8});f.step();await flush();
 assert.equal(f.buffers.filter(b=>b.label==='material demand readback').length,1,'no second in-flight read');
 assert.equal(first.destroyed,false);
 f.release();await flush();f.step();await flush();
 assert.equal(first.destroyed,true,'capacity change retires the old staging allocation after completion');
 const replacement=f.buffers.findLast(b=>b.label==='material demand readback');
 assert.notEqual(replacement,first);
 f.hold();f.step();await flush();f.hierarchy.destroy();f.release();await flush();
 assert.equal(replacement.destroyed,true);
 assert.ok(f.buffers.filter(b=>b.label.startsWith('material')||b.label==='hierarchy parameters').every(b=>b.destroyed),'all owned buffers are retired');
});
