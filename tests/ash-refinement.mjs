// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {ashObjectLayout,defaultAshSettings} from '../ash/scene-record.mjs';

test('refined ash allocates coarse background and fine regions with one physical owner',async()=>{
 const settings={...defaultAshSettings(),width:1.6,depth:1.6,height:.8,cellSize:.05,refinement:{ratio:2,regions:[{min:[-.4,0,-.4],max:[.4,.4,.4]}]}};
 const p=ashObjectLayout(settings);
 assert.equal(p.refinement?.ratio,2,'authored refinement must reach the physical layout');
 const {refinementCell,refinementIndex}=await import('../ash/refinement-plan.mjs');
 let volume=0,leaves=0;
 for(let i=0;i<p.count;i++){
  const c=refinementCell(p,i);if(!c?.owned)continue;
  volume+=(c.size*p.cellSize)**3;leaves++;
  assert.equal(refinementIndex(p,c.coord),i);
 }
 assert.ok(Math.abs(volume-1.6*1.6*.8)<1e-10,'leaf volumes partition the domain without double-counting');
 assert.ok(leaves<32*16*32,'local refinement does not allocate the global fine lattice');
 assert.equal(refinementCell(p,refinementIndex(p,[16,2,16])).size,1);
 assert.equal(refinementCell(p,refinementIndex(p,[0,2,0])).size,2);
});

test('refinement regions reject misalignment and overlap instead of losing ownership',async()=>{
 const {createRefinementLayout}=await import('../ash/refinement-plan.mjs');
 const input={cellSize:.1,bounds:{min:[0,0,0],max:[2,1,2]},tileSize:4,refinement:{ratio:2,regions:[{min:[.3,0,0],max:[1,.4,1]}]}};
 assert.throws(()=>createRefinementLayout(input),/align/);
 input.refinement.regions=[{min:[0,0,0],max:[1,.4,1]},{min:[.8,0,0],max:[1.2,.4,1]}];
 assert.throws(()=>createRefinementLayout(input),/overlap/);
});

test('coarse-fine exchange conserves volume with bounded density and transfers across all six interface directions',async()=>{
 const {createRefinementLayout,refinementCell,referenceRefinementStep}=await import('../ash/refinement-plan.mjs');
 const p=createRefinementLayout({cellSize:1,bounds:{min:[0,0,0],max:[8,8,8]},tileSize:4,refinement:{ratio:2,regions:[{min:[2,2,2],max:[6,6,6]}]}});
 for(let axis=0;axis<3;axis++)for(const sign of [-1,1]){
  const values=new Float32Array(p.count);
  const source=Array.from({length:p.count},(_,i)=>({i,c:refinementCell(p,i)})).filter(({c})=>c?.owned&&c.size===(sign>0?2:1)&&c.coord[axis]===(sign>0?0:5));
  for(const {i,c}of source)values[i]=c.size**3*.8;
  const before=values.reduce((a,b)=>a+b,0);
  let state=values;
  for(let step=0;step<12;step++)state=referenceRefinementStep(p,state,{axes:[axis],gravity:false});
  const after=state.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(after-before)<1e-4,`axis ${axis}/${sign} conserves volume`);
  assert.ok(state.every((m,i)=>m>=0&&m<=refinementCell(p,i).size**3+1e-6));
  assert.ok(state.some((m,i)=>m>0&&refinementCell(p,i).size!==(sign>0?2:1)),'material crosses resolution boundary');
 }
});

import {createAshSceneObject} from '../ash/scene-object.mjs';
import {Group} from '../lib/three.core.js';
test('native field forwards refinement to its runtime and retains refined checkpoint identity',async()=>{
 const ash={...defaultAshSettings(),width:1.6,depth:1.6,height:.8,cellSize:.05,initialDepth:0,sourcePosition:[0,.4,0],refinement:{ratio:2,regions:[{min:[-.4,0,-.4],max:[.4,.4,.4]}]}};
 const record={id:'refined-field',type:'retained-ash',source:'kaminos:retained-ash',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},ash};
 let received;
 const obj=await createAshSceneObject({record,readObjects:()=>[],createPatch:async options=>{
  received=options;
  return {root:new Group(),setSoftNormals(){},setSliding(){},syncScene(){},read:()=>({}),dispose(){}};
 }});
 assert.deepEqual(received.refinement,ash.refinement,'native ash must construct the actual refined backend');
 obj.dispose();
});

import {createRefinementLayout,refinementCell,refinementIndex,referenceRefinementStep} from '../ash/refinement-plan.mjs';
import {createGpuRefinedAsh} from '../ash/refinement-gpu.mjs';
import {mkdtempSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('newly overlapping moving solids evacuate material through coarse and fine interiors',()=>{
 for(const mode of ['coarse','fine','mixed']){
  const p=createRefinementLayout({cellSize:1,bounds:{min:[0,0,0],max:[8,8,8]},tileSize:4,refinement:{ratio:2,regions:mode==='coarse'?[]:[{min:[2,2,2],max:[6,6,6]}]}});
  const solid=Uint32Array.from({length:p.count},(_,i)=>{const c=refinementCell(p,i);return c.owned&&c.coord.every(v=>v<6)?2:0;});
  let values=new Float32Array(p.count);const origin=refinementIndex(p,mode==='coarse'?[2,2,2]:[3,3,3]);values[origin]=1;
  for(let step=0;step<48;step++)values=referenceRefinementStep(p,values,{solid});
  const escaped=values.reduce((sum,m,i)=>sum+(solid[i]===0?m:0),0);
  assert.ok(escaped>.001,`${mode} material must reach free cells, got ${escaped}`);
  assert.ok(values[origin]<.99,'embedded cell must release its material');
  assert.ok(Math.abs(values.reduce((a,b)=>a+b,0)-1)<1e-5);
 }
});

// These buffers execute production JavaScript validation/loading only. They do
// not execute WGSL and cannot establish a GPU or host integration contract.
function storageRenderer(){
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,INDIRECT:8,UNIFORM:16,MAP_READ:32};globalThis.GPUShaderStage={COMPUTE:4};globalThis.GPUMapMode={READ:1};
 const attributes=new Map(),writes=[];
 const device={limits:{maxStorageBufferBindingSize:1e7,maxBufferSize:1e7,maxComputeWorkgroupsPerDimension:65535},
  createBuffer:({size})=>({size,bytes:new Uint8Array(size),destroy(){},mapAsync:async()=>{},getMappedRange(){return this.bytes.buffer;},unmap(){}}),
  queue:{writeBuffer(buffer,offset,data){writes.push({buffer,offset});const bytes=ArrayBuffer.isView(data)?new Uint8Array(data.buffer,data.byteOffset,data.byteLength):new Uint8Array(data);buffer.bytes.set(bytes,offset);},submit(){}},
  createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipelineAsync:async()=>({}),createBindGroup:()=>({}),
  createCommandEncoder:()=>({beginComputePass:()=>({setPipeline(){},setBindGroup(){},dispatchWorkgroups(){},dispatchWorkgroupsIndirect(){},end(){}}),copyBufferToBuffer(a,from,b,to,size){b.bytes.set(a.bytes.subarray(from,from+size),to);},finish(){return {};}})};
 const backend={device,isWebGPUBackend:true,createStorageAttribute(a){const buffer=device.createBuffer({size:a.array.byteLength});device.queue.writeBuffer(buffer,0,a.array);attributes.set(a,{buffer});},createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>attributes.get(a),destroyAttribute:a=>attributes.delete(a)};
 return {backend,writes};
}
const smallRefined=renderer=>createGpuRefinedAsh({renderer,cellSize:.1,bounds:{min:[0,0,0],max:[.8,.8,.8]},tileSize:4,refinement:{ratio:2,regions:[{min:[.2,0,.2],max:[.6,.4,.6]}]}});

test('refined Add layer is additive above existing coarse and fine deposits',async()=>{
 const patch=await smallRefined(storageRenderer());
 try{
  await patch.deposit({blanketDepth:.1,groundOnly:true});const first=await patch.snapshot();
  await patch.deposit({blanketDepth:.1,groundOnly:true});const second=await patch.snapshot();
  assert.ok(Math.abs(first.volume-.064)<1e-7);
  assert.ok(Math.abs(second.volume-.128)<1e-7,'second layer adds its full depth');
 }finally{patch.dispose();}
});

test('refined restore rejects omitted/nonfinite volume before any upload',async()=>{
 const renderer=storageRenderer(),patch=await smallRefined(renderer);
 try{
  await patch.deposit({blanketDepth:.1,groundOnly:true});const saved=await patch.snapshot();
  for(const volume of [undefined,NaN,Infinity,-1]){
   const bad={...saved,volume};if(volume===undefined)delete bad.volume;
   const count=renderer.writes.length;
   assert.throws(()=>patch.restore(bad),/volume|ledger/i);
   assert.equal(renderer.writes.length,count,'rejection preserves GPU buffers');
  }
 }finally{patch.dispose();}
});

test('native witness records missing repo as a terminal argument failure',()=>{
 const out=mkdtempSync(join(tmpdir(),'ash-native-arguments-'));
 const result=spawnSync(process.execPath,['tools/ash-refinement-native-witness.mjs','--out',out],{encoding:'utf8'});
 assert.equal(result.status,1);
 assert.ok(existsSync(join(out,'report.json')),'argument failure must retain report');
 const report=JSON.parse(readFileSync(join(out,'report.json'),'utf8'));
 assert.equal(report.status,'failed');assert.equal(report.phase,'arguments');assert.match(report.error,/repo/);
});

import {seedRefinedLayer} from '../ash/refinement-seed.mjs';
test('ground-only refined layers do not seed tops of elevated solid plates',()=>{
 const p=createRefinementLayout({cellSize:1,bounds:{min:[0,0,0],max:[8,8,8]},tileSize:4,refinement:{ratio:2,regions:[{min:[2,0,2],max:[6,8,6]}]}});
 const solid=Uint32Array.from({length:p.count},(_,i)=>{const c=refinementCell(p,i);return c.owned&&c.coord[1]===2?2:0;});
 const initial=new Float32Array(p.count),ground=seedRefinedLayer(p,solid,{blanketDepth:1,groundOnly:true},initial);
 assert.ok(ground.some(v=>v>0));
 assert.ok(ground.every((v,i)=>refinementCell(p,i).coord[1]<2||v===0));
 const all=seedRefinedLayer(p,solid,{blanketDepth:1,groundOnly:false},initial);
 assert.ok(all.some((v,i)=>v>0&&refinementCell(p,i).coord[1]>=4));
});

test('refined checkpoint collision mismatch carries the native strict-recovery code',async()=>{
 const patch=await smallRefined(storageRenderer());
 try{const state=await patch.snapshot();state.collisionIdentity=[{key:'0/missing',geometry:'saved',matrix:[]}];assert.throws(()=>patch.restore(state),error=>error.code==='ASH_CHECKPOINT_COLLISION_MISMATCH');}finally{patch.dispose();}
});
