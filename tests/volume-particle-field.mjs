// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createParticleField} from '../volume-particle-field.mjs';
import {PARTICLE_STATE_WGSL} from '../volume-particle-state.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
const create=createParticleField;
const particleWgsl='struct Particle {anchor:vec4<f32>,source:vec4<f32>,emission:vec4<f32>,motion:vec4<f32>,shape:vec4<f32>,state:vec4<f32>}';
const rec=(position,state,weight=1,active=1)=>[...position,active,2,3,4,5,6,7,8,9,10,11,12,13,1,0,1,weight,...state];
async function read(d,b){const r=d.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);d.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);return new Float32Array(r.getMappedRange().slice(0));}finally{r.unmap();r.destroy();}}
async function fixture(d,rows,run){const b=d.createBuffer({size:rows.length*96,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC}),owner=create(d,{particleWgsl}),before=new Float32Array(rows.flat());d.queue.writeBuffer(b,0,before);let step=0;
 function encode(e,options={}){return owner.encode(e,{particles:b,slots:rows.length,dims:[4,4,4],pitch:.5,stepDelta:1,frame:++step,step,strength:1,time:1,cellSize:1,heatRate:1,speciesRate:1,sootRate:1,...options});}
 async function update(options={}){let state;await withGpuErrorScopes(d,'overlapping exchange field',async()=>{const e=d.createCommandEncoder();state=encode(e,options);d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();});return {records:await read(d,b),state};}
 try{await run({b,owner,before,encode,update});}finally{owner.dispose();b.destroy();}}
const near=(a,b,label)=>assert.ok(Math.abs(a-b)<2e-5*Math.max(1,Math.abs(b)),`${label}: ${a} versus ${b}`);
test('overlapping field transfers heat across an old bin face, includes all local contributors and preserves weighted state',async()=>withKaminosGpu(async({device:d})=>fixture(d,[rec([-.51,-.75,-.75],[1,4,2,1],2),rec([-.49,-.75,-.75],[3,0,0,2],1),rec([-.48,-.75,-.75],[2,0,1,3],3),rec([.75,.75,.75],[7,0,4,5],1)],async({before,update})=>{
 const {records:a}=await update();assert.ok(a[45]>0,'cold carrier across the old bin wall receives heat');assert.ok(a[69]>0,'third local carrier participates in the same update');assert.equal(a[93],0,'distant carrier receives no heat');
 for(let k=0;k<4;k++){let x=0,y=0;for(let i=0;i<4;i++){x+=before[i*24+19]*before[i*24+20+k];y+=a[i*24+19]*a[i*24+20+k];}near(y,x,'weighted component conservation');}
 for(let i=0;i<a.length;i++)if(i%24<20)assert.equal(a[i],before[i],'exchange changes composition only');
})));
test('component rates are independent and zero work skips grouping unless following requires it',async()=>withKaminosGpu(async({device:d})=>fixture(d,[rec([-.51,-.75,-.75],[1,4,2,1]),rec([-.49,-.75,-.75],[3,0,0,2])],async({before,update})=>{
 const off=await update({strength:0,requireGrouping:false});assert.deepEqual(off.records,before);assert.equal(off.state.work.grouping,false,'off means no hidden count/prefix/scatter');
 const a=await update({heatRate:1,speciesRate:0,sootRate:0});assert.ok(a.records[45]>0);for(const i of [20,22,23,44,46,47])assert.equal(a.records[i],before[i],'non-thermal rates stay frozen');
})));
test('a connected hot-seed ignition front advances through retained fuel across grouping boundaries',async()=>withKaminosGpu(async({device:d})=>{
 const rows=Array.from({length:16},(_,i)=>rec([-.85+i*.1,-.75,-.75],[1,i<2?1:0,0,3]));
 await fixture(d,rows,async({b,owner,encode})=>{
  const code=particleWgsl+PARTICLE_STATE_WGSL+'@group(0) @binding(0) var<storage,read_write> p:array<Particle>; @compute @workgroup_size(64) fn burn(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=arrayLength(&p)){return;}p[id.x].state=particleCompositionBurn(p[id.x].state,.2,vec4<f32>(1,3,.15,.5),vec4<f32>(.5,1000,0,1000)).state;}';
  const pipeline=d.createComputePipeline({layout:'auto',compute:{module:d.createShaderModule({code}),entryPoint:'burn'}}),bind=d.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:b}}]});
  const ignition=Array(16).fill(null);for(let t=0;t<36;t++){const e=d.createCommandEncoder();encode(e,{dims:[10,10,10],pitch:.2,stepDelta:.2,time:.3,speciesRate:0,sootRate:0});const pass=e.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.dispatchWorkgroups(1);pass.end();d.queue.submit([e.finish()]);owner.invalidate?.();const current=await read(d,b);if(t===0)assert.equal(current[15*24+20],1,'distant fuel remains unignited after the first exchange/reaction');for(let i=0;i<16;i++)if(ignition[i]===null&&current[i*24+20]<.95)ignition[i]=t+1;}
  await d.queue.onSubmittedWorkDone();const a=await read(d,b);assert.ok(a[7*24+20]<.95,'fuel initially cold several bins away is ignited by the connected front');assert.ok(ignition[7]>ignition[2]&&ignition[15]>ignition[7],'ignition progresses through space over multiple updates');console.log('Connected-front ignition updates',JSON.stringify(ignition));
 });
}));

test('field cadence accumulates elapsed reaction time and grouping remains available for following',async()=>withKaminosGpu(async({device:d})=>fixture(d,[rec([-.5,-.75,-.75],[1,2,1,1]),rec([-.49,-.75,-.75],[0,0,0,0])],async({owner,update})=>{const a=await update({step:1,stepDelta:1,interval:3});assert.equal(a.state.work.fieldGather,true);owner.invalidate();const held=await update({step:2,stepDelta:1,interval:3});assert.equal(held.state.work.fieldGather,false);assert.equal(held.state.work.grouping,false);assert.deepEqual(held.records,a.records);const follow=await update({step:3,stepDelta:1,interval:3,requireGrouping:true});assert.equal(follow.state.work.grouping,true);assert.equal(follow.state.work.fieldGather,false);const compact=await owner.statistics();assert.equal(compact.active,2);assert.equal(compact.step,3);const b=await update({step:4,stepDelta:1,interval:3});near(b.state.fractions[0],-Math.expm1(-3),'accumulated exchange fraction');assert.equal(b.state.work.fieldGather,true);const pause=await update({step:4,stepDelta:0,interval:3});assert.equal(pause.state.work.fieldGather,false);assert.deepEqual(pause.records,b.records);})));

test('all dense contributors participate and a two-dimensional node dispatch covers the final node',async()=>withKaminosGpu(async({device:d})=>{const limited=new Proxy(d,{get(t,k){if(k==='limits')return new Proxy(t.limits,{get(l,p){return p==='maxComputeWorkgroupsPerDimension'?8:Reflect.get(l,p,l);}});const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});const rows=Array.from({length:131},(_,i)=>rec([.99,.99,.99],[0,i===130?131:0,0,0]));await fixture(limited,rows,async({update})=>{const r=await update({dims:[2,2,2],pitch:1,time:1e-6});assert.ok(r.state.field.nodeCount>8,'fixture must use more than one node-dispatch row');for(let i=0;i<rows.length;i++)near(r.records[i*24+21],1,'complete dense weighted mean');});}));
