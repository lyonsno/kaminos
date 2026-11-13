// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createParticleLightSweep} from '../volume-particle-light-sweep.mjs';
import {withKaminosGpu,withGpuErrorScopes} from '../tools/shader-herder.mjs';
const near=(a,b,t=3e-5)=>assert.ok(Math.abs(a-b)<=t*Math.max(1,Math.abs(b)),`${a} != ${b}`);
async function read(d,b){const r=d.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=d.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);d.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);return new Float32Array(r.getMappedRange().slice(0));}finally{r.unmap();r.destroy();}}
function integral(c,solid,n,z,reverse){let light=[0,0,0],trans=1;for(let i=0;i<n;i++){const k=reverse?z+i:z-i;if(k<0||k>=n)break;const fraction=i===0?.5:1;if(solid[k]){trans=0;break;}const tau=c[k*4+3]*fraction,T=Math.exp(-tau),f=tau>1e-8?(1-T)/tau:1;for(let a=0;a<3;a++)light[a]+=trans*c[k*4+a]*fraction*f;trans*=T;}return [...light,trans];}
test('native shared opposite sweeps equal independent interior integrals, including both sides of opaque walls',async()=>{
 await withKaminosGpu(async ctx=>{
  const d=ctx.device,owner=createParticleLightSweep(d,{dims:[1,1,7],origin:[0,0,0],extent:[1,1,7],direction:[0,0,1]});
  const coefficients=new Float32Array(Array.from({length:7},(_,k)=>[k+1,.125*k,.25,.125*(k+1)]).flat()),solid=new Uint32Array([0,0,1,0,0,1,0]);
  try{await withGpuErrorScopes(d,'particle interior optical sweep',async()=>{d.queue.writeTexture({texture:owner.coefficients},new Uint8Array(new Float16Array(coefficients).buffer),{bytesPerRow:7*8},[7,1]);d.queue.writeBuffer(owner.solids,0,solid);const e=d.createCommandEncoder();owner.sweep(e);d.queue.submit([e.finish()]);const [p,m]=await Promise.all([read(d,owner.positive),read(d,owner.negative)]);for(let z=0;z<7;z++)for(const [output,reverse] of [[p,false],[m,true]]){const expected=solid[z]?[0,0,0,0]:integral(coefficients,solid,7,z,reverse);expected.forEach((v,a)=>near(output[z*4+a],v));}});}finally{owner.dispose();}
 });
});

import {readLightCoefficients,readLightBuffer,referenceLightAt} from '../tools/particle-light-reference.mjs';
const carrier=({position=[0,0,0],emission=[3,2,1],soot=.5,scattered=[0,0,0],active=1}={})=>[...position,active,...scattered,0,...emission,1,0,0,0,0,1,0,0,.2,1,1,soot,1];
const simpson=(fn,a,b)=>{let sum=fn(a)+fn(b);for(let i=1;i<200;i++)sum+=(i%2?4:2)*fn(a+(b-a)*i/200);return sum*(b-a)/600;};
test('fresh optical carrier lighting uses the same independent ease window as its camera support',async()=>withKaminosGpu(async ctx=>{
 const d=ctx.device,owner=createParticleLightSweep(d,{dims:[2,2,2],origin:[-1,-1,-1],extent:[2,2,2],direction:[0,0,1],settings:{carrierMode:1,stateLife:0,filterWidth:0}}),particles=d.createBuffer({size:96,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const measure=async fade=>{const row=carrier();row[15]=fade;d.queue.writeBuffer(particles,0,new Float32Array(row));const e=d.createCommandEncoder();owner.deposit(e,{particles,slots:1});d.queue.submit([e.finish()]);return (await readLightCoefficients(d,owner)).reduce((a,b)=>a+b,0);};
 try{const full=await measure(0),quarter=await measure(.75);assert.ok(full>0);near(quarter/full,.25,1e-3);}finally{owner.dispose();particles.destroy();}
}));
test('native splats integrate full conditional depth support and exclude captured scattered light',async()=>{
 await withKaminosGpu(async ctx=>withGpuErrorScopes(ctx.device,'Gaussian slab deposition',async()=>{
  const d=ctx.device,owner=createParticleLightSweep(d,{dims:[3,3,6],origin:[-1,-1,-1],extent:[2,2,2],direction:[0,0,1],settings:{radius:.2,stretch:2,filterWidth:0,stateLife:0,gain:1,extinction:2}}),particles=d.createBuffer({size:96,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  try{
   let held;
   for(const scattered of [[0,0,0],[100000,200000,300000]]){
    d.queue.writeBuffer(particles,0,new Float32Array(carrier({scattered})));const e=d.createCommandEncoder();owner.deposit(e,{particles,slots:1});owner.sweep(e);d.queue.submit([e.finish()]);const c=await readLightCoefficients(d,owner);if(held)assert.deepEqual(c,held,'captured incident light is not intrinsic emission');held=c;
    for(let z=0;z<6;z++){
     const lo=-1+z/3,hi=lo+1/3,fraction=simpson(t=>Math.exp(-.5*(t/.2)**2)/(.2*Math.sqrt(2*Math.PI)),lo,hi),weight=.2/(2*Math.PI*.2*.4)*fraction;
     for(let a=0;a<4;a++)near(c[4*(1+3*(1+3*z))+a],[3,2,1,1][a]*weight,8e-4);
    }
   }
   assert.ok(held.filter((v,i)=>i%4===3&&v>1e-4).length>2,'a carrier must occupy multiple depth bins');
   const blank=d.createCommandEncoder();owner.deposit(blank,{particles,slots:0});owner.sweep(blank);d.queue.submit([blank.finish()]);assert.ok((await readLightCoefficients(d,owner)).every(v=>v===0),'empty deposition must clear the old field');const out=await readLightBuffer(d,owner.positive);for(let i=0;i<out.length;i++)assert.equal(out[i],i%4===3?1:0,'empty field is vacuum');
  }finally{owner.dispose();particles.destroy();}
 }));
});
test('oblique nonmultiple field, separated smoke/emitter and interior solid masks agree at every receiver',async()=>{
 await withKaminosGpu(async ctx=>withGpuErrorScopes(ctx.device,'oblique particle transport',async()=>{
  const d=ctx.device,dims=[3,5,7],owner=createParticleLightSweep(d,{dims,origin:[-1,-1,-1],extent:[2,3,3],direction:[1,1,1],settings:{radius:.3,stretch:2,stateLife:0}}),records=new Float32Array([carrier(),carrier({position:[.3,.4,.2],emission:[0,0,0],soot:4}),carrier({position:[-.1,.3,.5],emission:[2,4,8],soot:0})].flat()),particles=d.createBuffer({size:records.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}),solid=new Uint32Array(owner.plan.cells);
  for(let y=0;y<5;y++)for(let x=0;x<3;x++)solid[x+3*(y+5*3)]=1;
  try{d.queue.writeBuffer(particles,0,records);d.queue.writeBuffer(owner.solids,0,solid);const e=d.createCommandEncoder();owner.deposit(e,{particles,slots:3});owner.sweep(e);d.queue.submit([e.finish()]);const [c,p,m]=await Promise.all([readLightCoefficients(d,owner),readLightBuffer(d,owner.positive),readLightBuffer(d,owner.negative)]);assert.ok(c.some(v=>v>0),'oblique deposition cannot be blank');for(let z=0;z<7;z++)for(let y=0;y<5;y++)for(let x=0;x<3;x++){const i=x+3*(y+5*z);for(const [out,reverse]of [[p,false],[m,true]])(solid[i]?[0,0,0,0]:referenceLightAt(c,solid,dims,[x,y,z],reverse)).forEach((v,a)=>near(out[4*i+a],v));}}finally{owner.dispose();particles.destroy();}
 }));
});
test('thin bright slabs preserve the clear-medium limit without cancellation as spatial resolution rises',async()=>{
 await withKaminosGpu(async ctx=>withGpuErrorScopes(ctx.device,'thin optical transfer',async()=>{
  const d=ctx.device,owner=createParticleLightSweep(d,{dims:[1,1,1],origin:[0,0,0],extent:[1,1,1],direction:[0,0,1]});
  try{for(const tau of [0,.0004,.004,.0000001]){
   const half=new Float16Array([4096,2048,1024,tau]);d.queue.writeTexture({texture:owner.coefficients},new Uint8Array(half.buffer),{bytesPerRow:8},[1,1]);const e=d.createCommandEncoder();owner.sweep(e);d.queue.submit([e.finish()]);const actual=await readLightBuffer(d,owner.positive),t=Number(half[3])*.5,phi=t>0?-Math.expm1(-t)/t:1;for(let k=0;k<3;k++)near(actual[k],Number(half[k])*.5*phi,2e-6);
  }}finally{owner.dispose();}
 }));
});
