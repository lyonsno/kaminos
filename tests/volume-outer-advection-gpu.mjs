import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const [dawnPath,output,sourceRef]=process.argv.slice(2);assert.ok(dawnPath&&output);mkdirSync(output,{recursive:true});
const source=sourceRef?execFileSync('git',['show',`${sourceRef}:volume-outer-smoke.mjs`],{cwd:new URL('..',import.meta.url),maxBuffer:Infinity}).toString():readFileSync(new URL('../volume-outer-smoke.mjs',import.meta.url),'utf8');
const {createOuterSmoke,outerSmokeConfig}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const report={purpose:'translated resolved smoke pulse retains bulk amplitude and displacement on actual outer kernel',phase:'adapter',passed:false};let device;
try{
 report.source={revision:sourceRef||execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}).trim(),shaderHash:createHash('sha256').update(source).digest('hex')};
 writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));
 const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);const gpu=create(['backend=metal']);globalThis.__nativeGPU=gpu;const adapter=await gpu.requestAdapter();assert.ok(adapter);
 device=await adapter.requestDevice();report.route={backend:'metal',vendor:adapter.info.vendor,device:adapter.info.device};
 const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const c=outerSmokeConfig({grid:32,extent:4}),n=16,shape=c.shape;
 const initial=new Float32Array(33*65*33*8);
 for(let z=0;z<=32;z++)for(let y=0;y<=64;y++)for(let x=0;x<=32;x++){
  const i=(x+33*(y+65*z))*8;initial[i]=.05;
  if(x>=17&&x<=19&&y>=35&&y<=37&&z>=15&&z<=17)initial[i+4]=1;
 }
 const near=new Float32Array(n*n*2*n*16);for(let i=0;i<near.length;i+=16)near[i]=.4;
 const b=device.createBuffer({size:near.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,near);
 // Native buffer initialization spy: only seeds an explicit synthetic state;
 // all pipelines, dispatches and readbacks remain the production implementation.
 const wrapped=new Proxy(device,{get(t,k){if(k==='createBuffer')return descriptor=>{const buffer=t.createBuffer(descriptor);if(descriptor.label==='outer smoke state A')t.queue.writeBuffer(buffer,0,initial);return buffer;};const v=Reflect.get(t,k,t);return typeof v==='function'?v.bind(t):v;}});
 const solver=createOuterSmoke(wrapped,c,n,[b,b]);
 try{
  report.phase='transport';writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));for(let step=0;step<40;step++){const e=device.createCommandEncoder();solver.encode(e,0,{dtScale:1,backtraceScale:1},0);device.queue.submit([e.finish()]);}
  const values=await solver.readState();writeFileSync(resolve(output,'translated.f32'),new Uint8Array(values.buffer));
  let max=0,mass=0,weightedX=0;
  for(let z=0;z<32;z++)for(let y=0;y<64;y++)for(let x=0;x<32;x++){const d=values[(x+33*(y+65*z))*8+4];max=Math.max(max,d);mass+=d;weightedX+=d*x;}
  report.result={max,mass,centroidX:weightedX/mass,expectedCentroidX:26,receipt:solver.receipt()};
  assert.ok(values.every(Number.isFinite));assert.deepEqual(errors,[]);
  assert.ok(Math.abs(weightedX/mass-26)<.5,'bulk advection must move eight cells');
  assert.ok(max>.65,`resolved pulse lost too much amplitude over eight cells: ${max}`);
 }finally{solver.destroy();b.destroy();}
 report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
