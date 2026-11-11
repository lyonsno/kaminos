// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createParticleExchange,particleExchangePlan} from '../volume-particle-exchange.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';

const particleWgsl=`struct Particle {anchor:vec4<f32>,source:vec4<f32>,emission:vec4<f32>,motion:vec4<f32>,shape:vec4<f32>,state:vec4<f32>}`;
function record(state,{position=[-.75,-.75,-.75],pitch=1,length=1,active=1,tag=0}={}){
 return [...position,active,tag,2,3,4,5,6,7,8,9,10,11,12,pitch,.1,.2,length,...state];
}
async function read(device,buffer,size=buffer.size){
 const copy=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{const e=device.createCommandEncoder();e.copyBufferToBuffer(buffer,0,copy,0,size);device.queue.submit([e.finish()]);await copy.mapAsync(GPUMapMode.READ);return copy.getMappedRange().slice(0);}finally{copy.unmap();copy.destroy();}
}
async function fixture(ctx,records,run){
 const d=ctx.device,particles=d.createBuffer({size:Math.max(96,records.length*96),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
 const owner=createParticleExchange(d,{particleWgsl});const before=new Float32Array(records.flat());if(before.length)d.queue.writeBuffer(particles,0,before);
 const update=async(input={})=>{
  let result;await withGpuErrorScopes(d,'production particle exchange',async()=>{const e=d.createCommandEncoder();result=owner.encode(e,{particles,slots:records.length,dims:[4,4,4],pitch:.5,stepDelta:1,frame:0,strength:.5,time:1,cellSize:1,...input});d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();});
  return {result,records:new Float32Array(await read(d,particles))};
 };
 try{await run({owner,particles,before,update,read:buffer=>read(d,buffer)});}finally{owner.dispose();particles.destroy();}
}
async function grouping(read,result){
 const [counts,offsets,ids,metadata]=await Promise.all([read(result.counts),read(result.offsets),read(result.ids),read(result.metadata)]);
 return {counts:new Uint32Array(counts),offsets:new Uint32Array(offsets),ids:new Uint32Array(ids),metadata:new Uint32Array(metadata)};
}
const near=(a,b,message,tolerance=2e-5)=>assert.ok(Math.abs(a-b)<=tolerance*Math.max(1,Math.abs(b)),`${message}: ${a} versus ${b}`);
test('production cell pairs make partial weighted progress and preserve every other record field',async()=>{
 await withKaminosGpu(async ctx=>fixture(ctx,[record([2,10,.5,1],{pitch:.5,length:.25}),record([8,1,2,5],{pitch:.25,length:2})],async({before,update})=>{
  const {records:after}=await update();const weight=[.0625,.125],fraction=.5*(1-Math.exp(-1));
  for(let component=0;component<4;component++){
   const a=before[20+component],b=before[44+component],mean=(weight[0]*a+weight[1]*b)/(weight[0]+weight[1]);
   near(after[20+component],a+fraction*(mean-a),'first carrier exchanges actual state');near(after[44+component],b+fraction*(mean-b),'second carrier exchanges actual state');
   near(weight[0]*after[20+component]+weight[1]*after[44+component],weight[0]*a+weight[1]*b,'weighted component total');
  }
  for(let i=0;i<after.length;i++)if(i%24<20)assert.equal(after[i],before[i],'exchange writes state only');
 }));
});
test('zero and paused exchange preserve every byte while grouping all admitted carriers',async()=>{
 await withKaminosGpu(async ctx=>fixture(ctx,[record([2,1,.5,4]),record([7,6,2,1]),record([3,2,1,0],{active:0}),record([4,3,2,1],{position:[2,0,0]}),record([3,2,1,0],{active:NaN})],async({particles,before,update,read})=>{
  for(const input of [{strength:0},{stepDelta:0}]){
   const {result}=await update(input);const g=await grouping(read,result);
   assert.deepEqual(new Uint8Array(await read(particles)),new Uint8Array(before.buffer),'identity must preserve NaN payloads and all inactive fields too');
   assert.deepEqual(Array.from(g.metadata.slice(0,6)),[2,1,1,1,2,0]);
   assert.deepEqual(Array.from(g.ids.slice(0,g.offsets[result.cellCount])).sort((a,b)=>a-b),[0,1],'scatter cannot admit records the count stage excluded');
   assert.equal(result.gpuDerived,'pending-readback');assert.equal(result.placed,null);assert.equal(result.pairs,null);assert.equal(result.mixing,'identity');
  }
 }));
});
test('cell-local odd populations use the frame rotation, touch each carrier at most once and stay in their cells',async()=>{
 const records=Array.from({length:9},(_,i)=>record([i+1,10-i,(i+1)*.25,(i+1)*2],{position:[i<5?-.75:i<8?-.25:.75,-.75,-.75],pitch:i===0?0:.25*(i%3+1),length:i===0?0:.5,tag:i}));
 await withKaminosGpu(async ctx=>fixture(ctx,records,async({before,update,read})=>{
  let previous=before;
  for(const frame of [0,1,4]){
   const {result,records:after}=await update({frame,strength:.8,stepDelta:.5,time:2});const g=await grouping(read,result),expected=new Float32Array(previous),paired=new Set();
   assert.deepEqual(Array.from(g.metadata.slice(0,6)),[9,3,3,0,0,3]);assert.equal(g.offsets[0],0);
   for(let cell=0;cell<result.cellCount;cell++){
    const n=g.counts[cell];assert.equal(g.offsets[cell+1]-g.offsets[cell],n);
    for(let local=0;local<Math.floor(n/2);local++){
     const a=g.ids[g.offsets[cell]+(2*local+frame%n)%n],b=g.ids[g.offsets[cell]+(2*local+frame%n+1)%n];
     assert.ok(!paired.has(a)&&!paired.has(b),'pair assignments must be disjoint');paired.add(a);paired.add(b);
     const wa=Math.max(1e-12,previous[a*24+16]**2*previous[a*24+19]),wb=Math.max(1e-12,previous[b*24+16]**2*previous[b*24+19]);
     for(let k=0;k<4;k++){const delta=(previous[b*24+20+k]-previous[a*24+20+k])*result.effectiveFraction;expected[a*24+20+k]+=delta*wb/(wa+wb);expected[b*24+20+k]-=delta*wa/(wa+wb);}
    }
   }
   for(let i=0;i<after.length;i++)near(after[i],expected[i],'frame-rotated production pair result');previous=after;
  }
 }));
});
function constrainedDevice(device,overrides){return new Proxy(device,{get(target,key){if(key==='limits')return new Proxy(target.limits,{get(limits,name){return name in overrides?overrides[name]:limits[name];}});const value=target[key];return typeof value==='function'?value.bind(target):value;}});}
test('recursive exclusive offsets and 2D dispatch cover a complete nonmultiple population without a cap',async()=>{
 await withKaminosGpu(async ctx=>{
  const d=constrainedDevice(ctx.device,{maxComputeWorkgroupsPerDimension:2}),dims=[19,17,3],pitch=.1;
  const records=Array.from({length:771},(_,i)=>{const cell=i*37%969;return record([i,1,2,3],{position:[cell%19,Math.floor(cell/19)%17,Math.floor(cell/(19*17))].map(v=>-1+(v+.5)*pitch),active:i%7?1:0,tag:i});});
  await fixture({device:d},records,async({before,update,read})=>{
   const labels=[];const {result,records:after}=await update({dims,pitch,strength:0,profileWrites:label=>{labels.push(label);return {};}}),g=await grouping(read,result);
   assert.equal(result.particleDispatch.x,2);assert.equal(result.particleDispatch.y,2);assert.equal(result.scanLevels.length,2);
   assert.deepEqual(labels,['exchangeCount','exchangePrefix0','exchangePrefix1','exchangePrefixAdd0','exchangeScatter']);
   assert.equal(new Set(labels).size,labels.length,'every recursive pass needs a distinct timestamp slot');
   const admitted=records.map((r,i)=>r[3]>0?i:null).filter(i=>i!==null),actual=Array.from(g.ids.slice(0,g.offsets[result.cellCount])).sort((a,b)=>a-b);
   assert.deepEqual(actual,admitted,'every declared live slot, including dispatch tail, must survive exactly once');assert.deepEqual(after,before);
   for(let c=0;c<result.cellCount;c++){assert.equal(g.offsets[c+1]-g.offsets[c],g.counts[c]);for(let i=g.offsets[c];i<g.offsets[c+1];i++)assert.equal(g.ids[i]*37%969,c,'each ID belongs to its reported bin');}
   assert.equal(g.metadata[0],admitted.length);assert.equal(g.metadata[4],records.length-admitted.length);assert.equal(result.liveCount.buffer,result.offsets);assert.equal(result.liveCount.byteOffset,result.cellCount*4);
  });
 });
});
test('mixed pairs cover populated bins across workgroup rows and never exchange across a cell boundary',async()=>{
 await withKaminosGpu(async ctx=>{
  const d=constrainedDevice(ctx.device,{maxComputeWorkgroupsPerDimension:2}),records=Array.from({length:773},(_,i)=>record([i+1,1000-i,(i%13)*.5,i%3],{position:[-1+(i%13+.5)*.125,-.75,-.75],tag:i}));
  await fixture({device:d},records,async({before,update,read})=>{
   const {result,records:after}=await update({dims:[16,4,4],pitch:.125,cellSize:1,frame:17,strength:.75});const g=await grouping(read,result),expected=new Float32Array(before);let totalPairs=0;
   for(let cell=0;cell<result.cellCount;cell++){
    const count=g.counts[cell],first=g.offsets[cell];totalPairs+=Math.floor(count/2);
    for(let local=0;local<Math.floor(count/2);local++){
     const a=g.ids[first+(2*local+17%count)%count],b=g.ids[first+(2*local+17%count+1)%count];assert.equal(a%13,b%13,'the production pair must share a physical bin');
     for(let k=0;k<4;k++){const delta=(before[b*24+20+k]-before[a*24+20+k])*result.effectiveFraction*.5;expected[a*24+20+k]+=delta;expected[b*24+20+k]-=delta;}
    }
   }
   assert.ok(totalPairs>256,'this fixture must exercise more than one pair workgroup');assert.equal(g.metadata[5],totalPairs);assert.equal(g.metadata[1],totalPairs);
   for(let i=0;i<after.length;i++)near(after[i],expected[i],'complete parallel mixing result');
  });
 });
});
test('three-level production prefix propagates carries across both recursion boundaries',async()=>{
 await withKaminosGpu(async ctx=>{
  // Just above 256² cells is the smallest production layout needing three
  // scan levels; six particles and less than one MiB of grouping storage.
  const cells=[0,255,256,65535,65536,66048],dims=[257,257,1],pitch=.01;
  const records=cells.map((cell,i)=>record([i,1,2,3],{position:[-1+(cell%257+.5)*pitch,-1+(Math.floor(cell/257)+.5)*pitch,-1+.5*pitch]}));
  await fixture(ctx,records,async({update,read})=>{
   const {result}=await update({dims,pitch,strength:0}),g=await grouping(read,result);assert.equal(result.scanLevels.length,3);
   assert.deepEqual(result.groupingProfilePasses,['exchangeCount','exchangePrefix0','exchangePrefix1','exchangePrefix2','exchangePrefixAdd1','exchangePrefixAdd0','exchangeScatter']);
   for(let cell=0;cell<=result.cellCount;cell++)assert.equal(g.offsets[cell],cells.filter(c=>c<cell).length,'prefix carry must cross every parent block');
   assert.deepEqual(Array.from(g.ids.slice(0,6)),[0,1,2,3,4,5]);assert.equal(g.metadata[0],6);
  });
 });
});
test('empty and resized groupings clear old counts and preserve complete resource identity',async()=>{
 await withKaminosGpu(async ctx=>{
  await fixture(ctx,[],async({update,read})=>{const {result}=await update();const g=await grouping(read,result);assert.ok(g.counts.every(v=>v===0));assert.ok(g.offsets.every(v=>v===0));assert.ok(g.metadata.every(v=>v===0));});
  await fixture(ctx,[record([1,2,3,4]),record([5,6,7,8],{position:[.75,.75,.75]})],async({particles,update,read})=>{
   const first=await update({strength:0});const second=await update({strength:0,cellSize:2});assert.notEqual(first.result.offsets,second.result.offsets);assert.deepEqual(second.result.cellDims,[2,2,2]);
   ctx.device.queue.writeBuffer(particles,0,new Float32Array(48));const third=await update({strength:0,cellSize:2}),g=await grouping(read,third.result);assert.ok(g.counts.every(v=>v===0));assert.ok(g.offsets.every(v=>v===0));assert.deepEqual(Array.from(g.metadata.slice(0,6)),[0,0,0,0,2,0]);
  });
 });
});
test('effective hardware limits and malformed invocations fail before any command is encoded',async()=>{
 await withKaminosGpu(async ctx=>{
  const d=ctx.device,limits=d.limits,input={slots:2,dims:[4,4,4],pitch:.5,cellSize:1};
  const plan=particleExchangePlan(limits,input);assert.deepEqual(plan.cellDims,[4,4,4]);assert.equal(plan.cellCount,64);assert.ok(plan.bytes>=64*12+8);
  assert.throws(()=>particleExchangePlan(new Proxy(limits,{get(t,k){return k==='maxStorageBufferBindingSize'?256:t[k];}}),input),/binding capacity/);
  assert.throws(()=>particleExchangePlan(limits,{...input,slots:Math.floor(Math.min(limits.maxBufferSize,limits.maxStorageBufferBindingSize)/96)+1}),/particles.*binding capacity/);
  assert.throws(()=>particleExchangePlan(limits,{...input,dims:[65536,65536,2]}),/offset count/);
  assert.throws(()=>particleExchangePlan(limits,{...input,cellSize:0}),/cell size/);
  const particles=d.createBuffer({size:192,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});const owner=createParticleExchange(d,{particleWgsl});const calls=[];
  const encoder=new Proxy({}, {get(_t,key){return ()=>{calls.push(key);throw Error('unexpected command');};}});
  try{for(const invalid of [{strength:1.01},{stepDelta:-1},{frame:-1},{time:0},{slots:3}])assert.throws(()=>owner.encode(encoder,{particles,...input,...invalid}),/Particle exchange/);assert.deepEqual(calls,[]);}finally{owner.dispose();particles.destroy();}
 });
});
