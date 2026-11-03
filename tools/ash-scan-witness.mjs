// Tiny GPU conformance witness; no timing claim. Executes production WGSL and
// compares complete outputs to independent serial integer references.
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';import {createHash} from 'node:crypto';import assert from 'node:assert/strict';
import {ashAirAdmissionWGSL,ashDrawPrefixWGSL} from '../ash/scan-wgsl.mjs';
const a=new Map();for(let i=2;i<process.argv.length;i+=2)a.set(process.argv[i],process.argv[i+1]);
const out=resolve(a.get('--out'));mkdirSync(out,{recursive:true});
const r={status:'running',phase:'launch',route:'isolated-webgpu-production-scan-kernels',cases:[],errors:[]};let browser;
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(r,null,2));save();
try{
 const path=new URL('../ash/scan-wgsl.mjs',import.meta.url);r.source=createHash('sha256').update(readFileSync(path)).digest('hex');
 const {chromium}=await import(a.get('--playwright'));r.browserExecutable=a.get('--browser');assert.match(r.browserExecutable,/Chrome for Testing|chromium/);
 browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:r.browserExecutable,headless:true,args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal']});
 const page=browser.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>r.errors.push(String(e)));await page.goto(a.get('--url'));
 await page.evaluate(async()=>{const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw Error('No actual GPU adapter');window.scanDevice=await adapter.requestDevice();window.scanErrors=[];window.scanDevice.addEventListener('uncapturederror',e=>window.scanErrors.push(e.error.message));});
 const run=async(code,entry,inputs,outputs)=>page.evaluate(async({code,entry,inputs,outputs})=>{
  const d=window.scanDevice,owned=[];d.pushErrorScope('validation');
  try{
   const mod=d.createShaderModule({code});const errors=(await mod.getCompilationInfo()).messages.filter(m=>m.type==='error');if(errors.length)throw Error(errors.map(e=>e.message).join('; '));
   const buffers=inputs.map(words=>{const b=d.createBuffer({size:words.length*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);d.queue.writeBuffer(b,0,new Uint32Array(words));return b;});
   const layout=d.createBindGroupLayout({entries:buffers.map((_,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:'storage'}}))});
   const pipe=await d.createComputePipelineAsync({layout:d.createPipelineLayout({bindGroupLayouts:[layout]}),compute:{module:mod,entryPoint:entry}});
   const group=d.createBindGroup({layout,entries:buffers.map((buffer,binding)=>({binding,resource:{buffer}}))});
   const enc=d.createCommandEncoder(),pass=enc.beginComputePass();pass.setPipeline(pipe);pass.setBindGroup(0,group);pass.dispatchWorkgroups(1);pass.end();
   const reads=outputs.map(i=>{const b=d.createBuffer({size:buffers[i].size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});owned.push(b);enc.copyBufferToBuffer(buffers[i],0,b,0,b.size);return b;});d.queue.submit([enc.finish()]);
   const result=[];for(const b of reads){await b.mapAsync(GPUMapMode.READ);result.push(Array.from(new Uint32Array(b.getMappedRange())));b.unmap();}return result;
  }finally{for(const b of owned)b.destroy();const error=await d.popErrorScope();if(error)throw Error(error.message);}
 },{code,entry,inputs,outputs});
 const bits=f=>new Uint32Array(new Float32Array([f]).buffer)[0];
 const pop=n=>{let count=0;for(n>>>=0;n;n=(n&(n-1))>>>0)count++;return count;};
 for(const n of [1,255,256,257,432,1728,2304,2305]){
  r.phase='prefix-'+n;save();const headers=new Uint32Array(n*8);for(let i=0;i<n;i++)headers[i*8+3]=(i%7===0)?0:(i*113)%4096;
  const expected=[];let sum=0;for(let i=0;i<n;i++){expected.push(sum);sum+=headers[i*8+3];}expected.push(sum);
  const code='@group(0) @binding(0) var<storage,read_write> headers:array<atomic<u32>>;\n@group(0) @binding(1) var<storage,read_write> prefix:array<u32>;\n@group(0) @binding(2) var<storage,read_write> draw:array<atomic<u32>>;\n@group(0) @binding(3) var<storage,read_write> jobs:array<atomic<u32>>;\n'+ashDrawPrefixWGSL(n,0);
  const result=await run(code,'draw_prefix',[Array.from(headers),Array(n+1).fill(0xffffffff),[6,0,0,0,0],[0]],[1,2,3]);assert.deepEqual(result,[expected,[6,sum,0,0,0],[sum]]);r.cases.push({kind:'draw-prefix',n,expected,actual:result});save();
 }
 for(const capacity of [1,63,64,65,16383,16384,16385,147451])for(const pattern of ['empty','mixed','full'])for(const units of [0,.25,8,513,1e7]){
  r.phase='air-'+capacity+'-'+pattern+'-'+units;save();const n=Math.ceil(capacity/64),packed=new Uint32Array(n*3+4);packed.fill(0xffffffff,n*2);const occupied=[];
  for(let i=0;i<capacity;i++)if(pattern==='full'||(pattern==='mixed'&&(i%97===0||i%131===31))){packed[Math.floor(i/64)*2+Math.floor(i%64/32)]|=(1<<(i%32));}
  let need=Math.ceil(units/8);const selected=[];for(let i=0;i<n;i++){const count=pop(packed[i*2])+pop(packed[i*2+1]),free=Math.min(64,capacity-i*64)-count;occupied.push(count);if(count>0||(need>0&&free>0)){selected.push(i);need-=Math.min(need,free);}}
  const code=`struct Params{dims:vec4<u32>,clock:vec4<f32>}\n@group(0) @binding(0) var<storage,read_write> p:Params;\n@group(0) @binding(1) var<storage,read_write> state:array<atomic<u32>>;\n@group(0) @binding(2) var<storage,read_write> groupData:array<atomic<u32>>;\n@group(0) @binding(3) var<storage,read_write> draw:array<atomic<u32>>;\n`+ashAirAdmissionWGSL(n);
  // Split fractional pending source and newly queued volume, as in production.
  const pending=units?units/2:0,addition=units-pending;
  const result=await run(code,'prepare_fall',[[1,1,1,capacity,0,bits(addition),0,0],[bits(pending),occupied.reduce((a,b)=>a+b,0),7,0],Array.from(packed),[24,999,0,0,0]],[1,2,3]);
  assert.deepEqual(result[0],[bits(units),0,8,0]);assert.deepEqual(result[1].slice(0,n*2),Array(n*2).fill(0));assert.deepEqual(result[1].slice(n*2,n*2+selected.length),selected);assert.deepEqual(result[1].slice(n*3,n*3+3),[selected.length,1,1]);assert.deepEqual(result[2],[24,0,0,0,0]);
  r.cases.push({kind:'air-admission',capacity,pattern,units,selected,actual:result});
 }
 assert.deepEqual(await page.evaluate(()=>window.scanErrors),[]);assert.deepEqual(r.errors,[]);assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),r.source);await page.evaluate(()=>window.scanDevice.destroy());r.status='passed';r.phase='complete';
}catch(e){r.status='failed';r.error=String(e.stack??e);process.exitCode=1;}finally{await browser?.close();r.browserClosed=true;save();console.log(JSON.stringify({status:r.status,phase:r.phase,cases:r.cases.length,error:r.error,out}));}
