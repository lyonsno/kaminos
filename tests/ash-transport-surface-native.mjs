// kaminos-test: node
import assert from 'node:assert/strict';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
import {createGpuAshFall} from '../ash/fall-gpu.mjs';
import {createGpuTiledAsh} from '../ash/tile-gpu.mjs';
import {patchLayout} from '../ash/gpu-plan.mjs';

// Real Dawn buffers and production runtime factories; only drawing is omitted.
function backendFor(ctx,mutate=null){
 const buffers=new Map();
 const device=new Proxy(ctx.device,{get(target,key){
  if(key==='createShaderModule')return descriptor=>target.createShaderModule(mutate?{...descriptor,code:mutate(descriptor.code,descriptor.label)}:descriptor);
  const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
 }});
 const backend={device,isWebGPUBackend:true,
  createStorageAttribute(a){const b=device.createBuffer({size:a.array.byteLength,usage:ctx.GPUBufferUsage.STORAGE|ctx.GPUBufferUsage.COPY_SRC|ctx.GPUBufferUsage.COPY_DST|ctx.GPUBufferUsage.INDIRECT});device.queue.writeBuffer(b,0,a.array);buffers.set(a,{buffer:b});},
  createIndirectStorageAttribute(a){this.createStorageAttribute(a);},get:a=>buffers.get(a),
  destroyAttribute(a){buffers.get(a)?.buffer.destroy();buffers.delete(a);},
 };
 return {backend};
}
async function readBuffer(ctx,b){
 const r=ctx.device.createBuffer({size:b.size,usage:ctx.GPUBufferUsage.COPY_DST|ctx.GPUBufferUsage.MAP_READ});
 try{const e=ctx.device.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);ctx.device.queue.submit([e.finish()]);await r.mapAsync(ctx.GPUMapMode.READ);return r.getMappedRange().slice(0);}finally{r.unmap();r.destroy();}
}
await withKaminosGpu(async ctx=>{
 Object.assign(globalThis,{GPUBufferUsage:ctx.GPUBufferUsage,GPUShaderStage:ctx.GPUShaderStage,GPUMapMode:ctx.GPUMapMode,GPUTextureUsage:ctx.GPUTextureUsage});
 console.log('ash-transport-surface-device: '+JSON.stringify(ctx.adapterInfo));
 const make=(array)=>{const b=ctx.device.createBuffer({size:array.byteLength,usage:ctx.GPUBufferUsage.STORAGE|ctx.GPUBufferUsage.COPY_SRC|ctx.GPUBufferUsage.COPY_DST});ctx.device.queue.writeBuffer(b,0,array);return b;};
 async function transport(scenario,mutate=null){
  const p=patchLayout({cellSize:.1,bounds:{min:[0,0,0],max:[.8,.4,.8]}});
  const density=make(new Float32Array(p.count)),solidValues=new Uint32Array(p.count),wake=make(new Uint32Array(4));
  if(scenario==='ceiling')for(let z=0;z<8;z++)for(let x=0;x<8;x++)solidValues[x+8*(3+4*z)]=2;
  const solid=make(solidValues);let fall;
  try{
   fall=await createGpuAshFall({renderer:backendFor(ctx,mutate),layout:p,density,collision:solid,wake});
   if(scenario==='source')fall.request(.016);
   else{
    const particles=new Float32Array(fall.description.capacity*8);particles.set([.35,scenario==='ceiling'?.405:.005,.35,1,0,-.8,0,0]);
    fall.restore({schema:'kaminos.ash-fall.v1',capacity:fall.description.capacity,particles:Array.from(particles),state:[0,0,0,0],queuedVolume:0,requestedVolume:.001});
   }
   const e=ctx.device.createCommandEncoder();fall.encode(e,{position:[.79,1,.4],spread:.3,rate:0,dt:scenario==='source'?.01:.03});ctx.device.queue.submit([e.finish()]);
   const air=await fall.snapshot(),values=new Float32Array(await readBuffer(ctx,density));
   if(scenario==='source'){
    const live=[];for(let i=0;i<air.particles.length;i+=8)if(air.particles[i+3]>0)live.push(air.particles.slice(i,i+8));
    assert.ok(live.length>0,'source emits actual parcels');
    assert.ok(live.every(p=>p[0]>=.05-1e-6&&p[0]<=.75+1e-6&&p[2]>=.05-1e-6&&p[2]<=.75+1e-6),'overhanging source stays inside receiving field');
    assert.ok(live.every(p=>p[3]<=.250001),'fine source quanta remain at a quarter cell for this budget');
    const pending=new Float32Array(new Uint32Array(air.state).buffer)[0];assert.ok(Math.abs(live.reduce((s,p)=>s+p[3],pending)-16)<1e-5,'source budget is retained');
   }else if(scenario==='impact'){
    const at=(x,z)=>values[x+8*(4*z)];assert.ok(Math.abs(at(3,3)-.32)<1e-5,'impact center receives its physical share');
    for(const [x,z]of [[2,3],[4,3],[3,2],[3,4]])assert.ok(at(x,z)>.16999,'supported neighbors receive feathered material');
    assert.ok(Math.abs(values.reduce((a,b)=>a+b,0)-1)<1e-5,'impact conserves one parcel');
   }else{
    const parcel=air.particles;assert.ok(Math.hypot(parcel[0]-.35,parcel[2]-.35)>.01,'blocked ceiling produces horizontal travel');
    assert.ok(Math.hypot(parcel[4],parcel[6])>.39&&parcel[5]<0,'blocked parcel retains a moving velocity');
    assert.equal(parcel[3],1,'blocked material remains airborne');assert.equal(values.reduce((a,b)=>a+b,0),0);
   }
  }finally{fall?.dispose();density.destroy();solid.destroy();wake.destroy();}
 }
 async function surface(scenario,mutate=null){
  const dims=[32,2,32],values=new Float32Array(32*2*32),solid=new Uint8Array(values.length);
  for(let z=0;z<32;z++)for(let x=0;x<32;x++){
   if(scenario==='slope')values[x+32*(2*z)]=(x+z)%2?.25:.75;
   else if(scenario==='shelf'){solid[x+32*(2*z)]=2;values[x+32*(1+2*z)]=.5;}
   else{values[x+32*(2*z)]=.5;if(x>=14&&x<18&&z>=14&&z<18)values[x+32*(1+2*z)]=.25;}
  }
  let patch;
  try{
   patch=await createGpuTiledAsh({renderer:backendFor(ctx,mutate),cellSize:1,bounds:{min:[0,0,0],max:dims},solid,tileSize:16,surfaceMode:'runs'});
   const seed=await patch.snapshot(),volume=values.reduce((a,b)=>a+b,0);
   patch.restore({...seed,values:Array.from(values),seededVolume:volume,volume,retainedVolume:volume,pendingTiles:Array.from({length:patch.layout.tiles.count},(_,i)=>i)});
   const result=await patch.diagnostics({surfaceRecords:true}),B=16,V=B**3,covered=new Uint32Array(values.length);let merged=0;
   for(const tile of result.surfaceRecords)for(const word of tile.words){
    const face=word%6,code=word%(V*6),local=Math.floor(code/6),span=Math.floor(word/(V*6)),width=span%B+1,depth=Math.floor(span/B)+1;
    assert.equal(face,3,'these receiving fixtures expose top faces without bottom/subsurface quads');
    const tc=[tile.tile%2,0,Math.floor(tile.tile/2)],c=[tc[0]*B+local%B,Math.floor(local/B)%B,tc[2]*B+Math.floor(local/(B*B))];
    if(width*depth>1)merged++;
    if(scenario==='slope')assert.equal(width*depth,1,'noncoplanar cells are not flattened into rectangles');
    for(let dz=0;dz<depth;dz++)for(let dx=0;dx<width;dx++)covered[c[0]+dx+32*(c[1]+2*(c[2]+dz))]++;
   }
   for(let z=0;z<32;z++)for(let x=0;x<32;x++){
    const y=scenario==='shelf'||(scenario==='stack'&&x>=14&&x<18&&z>=14&&z<18)?1:0;
    assert.equal(covered[x+32*(y+2*z)],1,'physical top is covered once without gaps or overlaps');
    assert.equal(covered[x+32*(1-y+2*z)],0,'hidden/solid column level emits no top');
   }
   if(scenario!=='slope')assert.ok(merged>0,'coplanar receiving interiors actually coalesce');
  }finally{patch?.dispose();}
 }
 await withGpuErrorScopes(ctx.device,'production ash transport and uniform surface',async()=>{
  for(const scenario of ['source','impact','ceiling'])await transport(scenario);
  for(const scenario of ['stack','slope','shelf'])await surface(scenario);
  // Both faults compile as WGSL; the numerical/coverage oracles must reject them.
  await assert.rejects(()=>transport('source',(code,label)=>label==='falling ash conservative deposition'?code.replace('clamp(available*(1.0/64.0),0.25,8.0)','8.0'):code),/fine source quanta/);
  await assert.rejects(()=>surface('shelf',(code,label)=>label==='connected ash tiles'?code.replace('local*6u+face+','local*6u+2u+'):code),/receiving fixtures expose top faces/);
 });
});
