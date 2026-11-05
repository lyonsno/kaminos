// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Mesh,BoxGeometry,MeshBasicMaterial} from '../lib/three.core.js';
import {patchLayout} from '../ash/gpu-plan.mjs';
import {createAshSceneSolids} from '../ash/scene-gpu.mjs';
// Scheduling regression only. This fake records submissions and executes no WGSL.
function setup(){
 globalThis.GPUBufferUsage={STORAGE:1,COPY_SRC:2,COPY_DST:4,UNIFORM:8};globalThis.GPUTextureUsage={TEXTURE_BINDING:1,STORAGE_BINDING:2,COPY_SRC:4,COPY_DST:8};globalThis.GPUShaderStage={COMPUTE:1};
 const submissions=[],passes=[];
 const device={limits:{maxTextureDimension3D:256,maxStorageBufferBindingSize:1e7,maxBufferSize:1e7,maxComputeWorkgroupsPerDimension:65535},queue:{writeBuffer(){},submit(commands){submissions.push(commands);}},createBuffer:({size})=>({size,destroy(){}}),createTexture:()=>({createView:()=>({}),destroy(){}}),createShaderModule:()=>({}),createBindGroupLayout:()=>({}),createPipelineLayout:()=>({}),createComputePipeline:({compute})=>({entryPoint:compute?.entryPoint}),createBindGroup:()=>({}),createCommandEncoder:()=>({clearBuffer(){},copyTextureToTexture(){},beginComputePass:({label}={})=>{const p={label,entryPoint:null,workgroups:null};return {setPipeline(pipe){p.entryPoint=pipe?.entryPoint??null;},setBindGroup(){},dispatchWorkgroups(...wg){p.workgroups=wg;},end(){passes.push(p);}};},finish:()=>({})})};
 const layout=patchLayout({cellSize:.1,bounds:{min:[-3,0,-3],max:[3,2,3]},tileSize:4});
 const field=createAshSceneSolids({device,layout,collision:device.createBuffer({size:layout.count*4}),headers:device.createBuffer({size:layout.tiles.count*32})});
 const a=new Mesh(new BoxGeometry(.4,.4,.4),new MeshBasicMaterial()),b=new Mesh(new BoxGeometry(.4,.4,.4),new MeshBasicMaterial());a.name='A';b.name='B';a.position.set(-1,.2,0);b.position.set(1,.2,0);
 const records=[{id:'a',object:a},{id:'b',object:b}];
 return {field,layout,a,b,records,submissions,passes,dispose(){field.dispose();for(const mesh of [a,b]){mesh.geometry.dispose();mesh.material.dispose();}}};
}
for(const operation of ['move','remove'])test(`${operation} before later refusal composes on correction without another edit`,()=>{
 const s=setup();try{
  assert.equal(s.field.update(s.records),true);
  const submitted=s.submissions.length;
  if(operation==='move')s.a.position.x=-2;else s.records.shift();
  s.b.scale.x=0;assert.throws(()=>s.field.update(s.records),/invertible/);
  assert.equal(s.submissions.length,submitted,'failed pass did not publish collision');
  s.b.scale.x=1;
  assert.equal(s.field.update(s.records),true,'recovery must compose retained dirty regions');
  assert.equal(s.submissions.length,submitted+1);
  assert.equal(s.field.update(s.records),false,'unchanged recovered scene is quiet');
 }finally{s.dispose();}
});
test('enlarging a tall obstacle past the 1D workgroup ceiling clips and bounds collision shapes without freezing or churning every drag step',()=>{
 const s=setup();try{
  const kiln=new Mesh(new BoxGeometry(1.4,2.0,1.4),new MeshBasicMaterial());kiln.name='Kiln';kiln.position.set(0,1,0);
  const records=[{id:'kiln',object:kiln}];
  for(let step=0;step<=20;step++){
   const factor=1+step*0.4; // scales height from 2m (grid ~24) up to 18m (rawGrid ~184 > 162)
   kiln.scale.setScalar(factor);
   assert.doesNotThrow(()=>s.field.update(records),`scale factor ${factor} must not throw capacity failure`);
  }
  const state=s.field.read();
  assert.equal(state.members.length,1);
  assert.ok(state.members[0].grid<=128,`member grid ${state.members[0].grid} must remain bounded`);
  assert.ok(state.shapeBuilds<=8,`expected quantized/clipped shape builds during 21-step scale drag, got ${state.shapeBuilds}`);
  const buildsBeforeMove=state.shapeBuilds;
  kiln.position.x=0.05;
  s.field.update(records);
  assert.equal(s.field.read().shapeBuilds,buildsBeforeMove,'sub-quantum translation of clipped obstacle reuses shape');
  kiln.geometry.dispose();kiln.material.dispose();
 }finally{s.dispose();}
});
test('stamp dispatches each collider only over its own overlapping marked tiles instead of the global dirty union',()=>{
 const s=setup();try{
  s.a.position.set(-2,.2,-2);s.b.position.set(2,.2,2);
  const c=new Mesh(new BoxGeometry(.4,.4,.4),new MeshBasicMaterial());c.name='C';c.position.set(0,.2,0);
  const all=[...s.records,{id:'c',object:c}];
  s.passes.length=0;
  assert.equal(s.field.update(all),true);
  const clearPasses=s.passes.filter(p=>p.label==='ash scene clear');
  const stampPasses=s.passes.filter(p=>p.label==='ash scene stamp');
  assert.equal(clearPasses.length,1);
  assert.equal(stampPasses.length,3);
  const clearGroups=clearPasses[0].workgroups[0];
  for(const sp of stampPasses){
   assert.ok(sp.workgroups[0]<clearGroups,`each disjoint collider stamp (${sp.workgroups[0]} workgroups) must be strictly smaller than the 3-collider dirty union (${clearGroups} workgroups)`);
  }
  const sumStampGroups=stampPasses.reduce((n,p)=>n+p.workgroups[0],0);
  assert.equal(sumStampGroups,clearGroups,'disjoint colliders sum to the dirty union instead of multiplying by collider count');
  c.geometry.dispose();c.material.dispose();
 }finally{s.dispose();}
});
import {BURNER_DEFAULTS,normalizeBurner} from '../annular-burner.mjs';
test('analytic annular burner collider bypasses 3D texture voxelization and stamps synthetic ring recipe directly',()=>{
 const s=setup();try{
  const proxy=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial());
  proxy.name='ShrineFloorBurner';
  proxy.scale.setScalar(4);
  proxy.userData.kaminosAnalyticAnnularBurner=normalizeBurner(BURNER_DEFAULTS);
  const buildsBefore=s.field.read().shapeBuilds;
  assert.equal(s.field.update([{id:'burner',object:proxy}]),true);
  const state=s.field.read();
  assert.equal(state.members.length,1);
  assert.equal(state.members[0].grid,0,'analytic annular burner allocates no 3D voxel texture grid');
  assert.match(state.members[0].geometry,/^annular-analytic:/,'analytic annular burner records synthetic recipe identity');
  assert.equal(state.shapeBuilds,buildsBefore+1);
  proxy.position.x=0.2;
  assert.equal(s.field.update([{id:'burner',object:proxy}]),true);
  assert.equal(s.field.read().shapeBuilds,buildsBefore+1,'moving analytic annular burner reuses collider record without rebuilding');
  proxy.geometry.dispose();proxy.material.dispose();
 }finally{s.dispose();}
});
