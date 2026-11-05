// kaminos-test: node
import test from 'node:test';import assert from 'node:assert/strict';
import {createMaterialHierarchyGPU} from '../volume-material-hierarchy-gpu.mjs';
globalThis.GPUBufferUsage={STORAGE:1,COPY_DST:2,COPY_SRC:4,UNIFORM:8,MAP_READ:16,INDIRECT:32};globalThis.GPUMapMode={READ:1};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,COPY_DST:2,STORAGE_BINDING:4};
function fixture(){const writes=[],passes=[],maps=[];const d={limits:{maxTextureDimension2D:16384,maxStorageBufferBindingSize:2**28,maxBufferSize:2**28,maxComputeWorkgroupsPerDimension:65535},createBuffer:s=>({...s,data:new ArrayBuffer(s.size),async mapAsync(){maps.push(s.label);},getMappedRange(){return this.data;},unmap(){},destroy(){}}),createTexture:s=>({...s,width:s.size[0],height:s.size[1],createView(){return this;},destroy(){}}),createShaderModule:s=>s,createComputePipeline:s=>({...s,getBindGroupLayout:i=>i}),createBindGroup:s=>s,queue:{writeBuffer(b,o,a){writes.push({label:b.label,bytes:a.byteLength});new Uint8Array(b.data,o,a.byteLength).set(new Uint8Array(a.buffer??a,a.byteOffset??0,a.byteLength));},writeTexture(){writes.push({label:'CPU texture upload'});},onSubmittedWorkDone:async()=>{}}};const encoder={clearBuffer(){},copyBufferToBuffer(){},beginComputePass({label}){passes.push(label);return{setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}};}};const world=Object.fromEntries([0,1,2,4,5].map(k=>[k,{buffer:d.createBuffer({size:16})}]));for(const k of[8,9,10,11,14,15,16])world[k]={texture:k};return{d,encoder,world,writes,passes,maps};}
test('live allocation submits GPU planning and indirect work without CPU grid writes or demand mapping',async()=>{const f=fixture(),h=createMaterialHierarchyGPU(f.d,{materialDims:[8,4,4],materialPitch:1,min:[0,0,0],max:[8,4,4]},'',{budget:8,maxDetail:2});try{for(let i=0;i<3;i++){h.encode(f.encoder,f.world,1);await new Promise(setImmediate);}assert.deepEqual(f.maps,[],'allocation must not depend on demand readback');assert.ok(f.passes.includes('GPU material allocation'),'GPU must choose the topology');assert.ok(f.writes.every(x=>!['material brick topology','material remapping','material brick work','CPU texture upload'].includes(x.label)),'CPU must not rebuild or upload grid lists');assert.equal(h.read().allocationBackend,'gpu-resident');}finally{h.destroy();}});

test('Fine-follow observations convert simulated displacement to wall-clock seconds',async()=>{
 const {chooseFineCoverage}=await import('../volume-fine-coverage.mjs');
 const f=fixture(),originalNow=globalThis.performance,now={value:1000};
 globalThis.performance={now:()=>now.value};
 f.encoder.copyBufferToBuffer=(src,so,dst,offset,bytes)=>new Uint8Array(dst.data,offset,bytes).set(new Uint8Array(src.data,so,bytes));
 f.encoder.beginComputePass=({label})=>{let group;return{setPipeline(){},setBindGroup(index,g){if(index===(label==='GPU material allocation'?0:1))group=g;},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){
  if(label==='GPU material allocation'){
   const state=group.entries.find(x=>x.binding===6).resource.buffer,nodes=group.entries.find(x=>x.binding===5).resource.buffer,u=new Uint32Array(state.data),floats=new Float32Array(nodes.data),words=new Uint32Array(nodes.data);
   u.set([1,1,1,0,0,1,1,1,64,128,192,64]);u[64]=0;u[128]=0;floats.set([0,0,0,1]);words.fill(0xffffffff,4,13);words[13]=0;
  }
  if(label==='measureBricks'){const b=group.entries.find(x=>x.binding===5).resource.buffer;new Float32Array(b.data).set([1,0,0,0,0,0,0,0,2,0,0,0]);}
 }};};
 const h=createMaterialHierarchyGPU(f.d,{materialDims:[4,4,4],materialPitch:1,min:[0,0,0],max:[4,4,4]},'',{budget:0});
 try{
  h.coverageDemand();h.encode(f.encoder,f.world,1);await new Promise(setImmediate);
  h.coverageDemand();now.value=1100;h.encode(f.encoder,f.world,1);await new Promise(setImmediate);
  const demand=h.coverageDemand(),rate=10;
  assert.ok(Math.abs(demand.boxes[0].motionMax[0]-2*rate)<1e-9,'one transport unit in 0.1 s means ten transport units per wall second');
  const input={frame:{translate:[0,0,0],scale:1},dims:[8,8,8],world:{lo:[-10,-10,-10],hi:[20,20,20]},sources:[],demand:demand.boxes.map(b=>({...b,lo:[-.1,-.1,-.1],hi:[.1,.1,.1]}))},options={mode:'fire',margin:0,lookahead:.3,hysteresis:0};
  const actual=chooseFineCoverage(input,options),expected=chooseFineCoverage({...input,demand:input.demand.map(b=>({...b,motionMax:[20,0,0]}))},options);
  assert.deepEqual(actual.target,expected.target,'the existing seconds-based coverage consumer receives the converted bounds');assert.ok(actual.target.translate[0]>2);
 }finally{h.destroy();globalThis.performance=originalNow;}
});

test('resident allocation consumes borrowed GPU source buffers and empty supply skips grid deposition',()=>{
 const f=fixture(),h=createMaterialHierarchyGPU(f.d,{materialDims:[4,4,4],materialPitch:1,min:[0,0,0],max:[4,4,4]},'',{budget:0});
 const gpu={parcels:f.d.createBuffer({size:64}),supports:f.d.createBuffer({size:48}),parcelCount:1,supportCount:1,sourceStep:0,backend:'gpu-resident-immersed-source'},sources={gpu,get parcels(){throw Error('GPU sources must not be serialized or visited on CPU');},get supports(){throw Error('GPU supports must not be reconstructed on CPU');}};
 try{h.encode(f.encoder,f.world,1,sources);assert.ok(f.passes.includes('GPU source deposition'));const before=f.passes.filter(x=>x==='GPU source deposition').length;h.encode(f.encoder,f.world,1,{gpu:{...gpu,parcelCount:0,supportCount:0}});assert.equal(f.passes.filter(x=>x==='GPU source deposition').length,before,'no source binds the empty supply instead of clearing every recipient cell');}finally{h.destroy();}
});
