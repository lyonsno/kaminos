import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {restrictPressureReference} from '../volume-pressure-resolution.mjs';
const [origin,out]=process.argv.slice(2);assert.ok(origin&&out,'origin and caller-owned output directory required');
await fs.mkdir(out,{recursive:true});
const executable=process.env.CHROME_EXECUTABLE;assert.ok(executable&&!executable.includes('/Google Chrome.app/'),'independent browser executable required');
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const report={status:'running',phase:'launch',repo:process.cwd(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),origin,executable,errors:[]};let context;
const sourceFiles=['volume-fine-grid.mjs','volume-pressure-resolution.mjs','volume-grid-transfer.mjs','volume-world-smoke.mjs'];
report.sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async p=>[p,createHash('sha256').update(await fs.readFile(p)).digest('hex')])));
try{
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:executable,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--disable-dawn-features=timestamp_quantization','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(origin+'/api/runtime-config');report.runtime=await page.evaluate(()=>JSON.parse(document.body.innerText));assert.equal(report.runtime.source.repoRoot,report.repo);assert.equal(report.runtime.source.commit,report.head);
 report.phase='native-producers';
 const signal=await page.evaluate(async({benchmark})=>{
  const fineModule=await import('/volume-fine-grid.mjs'),pressureModule=await import('/volume-pressure-resolution.mjs'),worldModule=await import('/volume-world-smoke.mjs');
  const adapter=await navigator.gpu.requestAdapter();if(!adapter||adapter.isFallbackAdapter||adapter.info.vendor!=='apple')throw Error('native Apple adapter required');
  const device=await adapter.requestDevice({requiredFeatures:benchmark?['timestamp-query']:[]}),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));device.pushErrorScope('validation');const rows=[];
  try{
   for(const target of [6,7,12,15])for(const kind of ['velocity','pressure']){
    const dims=[12,24,12],n=12*24*12,data=new Float32Array(n*16),expansion=new Float32Array(n).fill(.25),mask=new Uint32Array(n),front=new Float32Array(n).fill(.35),wet=new Uint32Array(n+5),react=new Float32Array(n*2),resources=[];
    for(let z=0;z<12;z++)for(let y=0;y<24;y++)for(let x=0;x<12;x++){const i=x+12*(y+24*z);data.set([.125*(x+1),.25*(y+1),.5*(z+1),0],i*16);for(let k=4;k<16;k++)data[i*16+k]=k;react[i*2]=.3;react[i*2+1]=.4;}
    const buffer=(values,extra=0)=>{const b=device.createBuffer({size:values.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|extra});resources.push(b);device.queue.writeBuffer(b,0,values);return b;};
    const texture=(format,values,channels=1)=>{const t=device.createTexture({dimension:'3d',size:dims,format,usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST});resources.push(t);device.queue.writeTexture({texture:t},values,{bytesPerRow:12*4*channels,rowsPerImage:24},dims);return t;};
    const fluid=buffer(data),solid=texture('r32uint',mask),burn=texture('r32float',expansion);
    const lower=device.createTexture({size:[24,24,3],format:'r32float',usage:GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});resources.push(lower);
    let owner,restricted,encoder=device.createCommandEncoder();
    if(kind==='velocity'){
     owner=fineModule.createFineVelocityGrid(device,fineModule.fineGridPlan({materialDims:dims,velocity:target,pressure:target}),16);
     owner.prepare({fluid,prior:buffer(data),front:buffer(front),quench:buffer(wet),solid,reactant:texture('rg32float',react,2),burn,lower});
     owner.encode(encoder,'restrictScalars');owner.encode(encoder,'restrictBurn');owner.encode(encoder,'injectMomentum');restricted=owner.fluid[owner.current];
    }else{
     owner=pressureModule.createPressureTransfer(device,pressureModule.pressureResolutionPlan({dims,width:target}));
     owner.prepare({fluid,solidTexture:solid,burnTexture:burn,fineLower:lower,openBoundary:true,openTop:true,nonLegacy:true,maxSpeed:64});owner.encode(encoder,'restrict');restricted=owner.before;
    }
    const size=target*target*target*2*64,read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});resources.push(read);encoder.copyBufferToBuffer(restricted,0,read,0,size);
    if(kind==='velocity')owner.encode(encoder,'prolongVelocity');else{encoder.copyBufferToBuffer(owner.before,0,owner.after,0,size);owner.encode(encoder,'prolong');}
    const readFine=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});resources.push(readFine);encoder.copyBufferToBuffer(fluid,0,readFine,0,data.byteLength);device.queue.submit([encoder.finish()]);
    await Promise.all([read.mapAsync(GPUMapMode.READ),readFine.mapAsync(GPUMapMode.READ)]);
    rows.push({kind,target,dims,input:Array.from(data),restricted:Array.from(new Float32Array(read.getMappedRange())),prolonged:Array.from(new Float32Array(readFine.getMappedRange())),expansion:Array.from(expansion)});
    read.unmap();readFine.unmap();owner.destroy();resources.forEach(r=>r.destroy());
   }
   // Compile and execute the actual outer solver with nonintegral and finer
   // pressure grids, not merely a shader substring or a mocked device.
   const resources=[];const src=new Float32Array(12*24*12*16);for(let i=0;i<src.length;i+=16)src.set([.01,.05,.02,0,.3,.5,.2,0],i);
   const fluid=device.createBuffer({size:src.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(fluid,0,src);resources.push(fluid);
   const reaction=device.createTexture({dimension:'3d',size:[12,24,12],format:'rg32float',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});resources.push(reaction);
   const outer=[];
   for(const pressure of [5,8,11]){
    const owner=worldModule.createWorldSmoke(device,worldModule.worldSmokePlan({flow:8,material:12,pressure,extent:4}),{translate:[0,0,0],scale:1},{exportFields:true});
    const encoder=device.createCommandEncoder();const state=owner.encode(encoder,{fineBuffer:fluid,reactionTexture:reaction,fineDims:[12,24,12],fineVelocityMode:'staggered',transform:{translate:[0,0,0],scale:1},time:{dtScale:1,backtraceScale:1},iterations:12,transitionCells:4});
    const read=device.createBuffer({size:8*16*256,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});resources.push(read);encoder.copyTextureToBuffer({texture:owner.flowTexture},{buffer:read,bytesPerRow:256,rowsPerImage:16},[8,16,8]);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);const values=Array.from(new Float32Array(read.getMappedRange()));read.unmap();outer.push({pressure,state,values});owner.destroy();
   }resources.forEach(r=>r.destroy());let timings=null,timingError=null;if(benchmark)try{timings=await (await import('/tools/grid-freedom-benchmark.mjs')).benchmarkTransfers(device);}catch(e){timingError=e.stack;}await device.queue.onSubmittedWorkDone();const validation=await device.popErrorScope();return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},rows,outer,timings,timingError,errors,validation:validation?.message??null};
  }finally{device.destroy();}
 },{benchmark:process.env.GRID_BENCHMARK==='1'});
 await fs.writeFile(out+'/raw-signal.json',JSON.stringify(signal));report.adapter=signal.adapter;assert.equal(signal.validation,null);assert.deepEqual(signal.errors,[]);assert.deepEqual(report.errors,[]);
 report.phase='numerical-comparison';report.rows=[];
 for(const row of signal.rows){
  const expected=restrictPressureReference({dims:row.dims,divisor:12/row.target,fluid:row.input,expansion:row.expansion});assert.equal(row.restricted.length,expected.fluid.length);let maxError=0;
  if(process.env.GRID_WITNESS_NEGATIVE==='blank')row.restricted.fill(0);
  row.restricted.forEach((v,i)=>{assert.ok(Number.isFinite(v));maxError=Math.max(maxError,Math.abs(v-expected.fluid[i]));assert.ok(Math.abs(v-expected.fluid[i])<4e-5,`${row.kind}/${row.target} restriction ${i}: ${v} != ${expected.fluid[i]}`);});
  row.prolonged.forEach((v,i)=>{assert.ok(Number.isFinite(v));if(i%16>=3)assert.equal(v,row.input[i],'material survives velocity/pressure transfer');});
  report.rows.push({kind:row.kind,target:row.target,maxError});
 }
 for(const row of signal.outer){assert.ok(row.values.every(Number.isFinite));assert.ok(row.values.some(v=>v>0),'outer solver must produce actual outflow');}
 report.timings=signal.timings;if(signal.timingError){report.phase='benchmark';throw Error(signal.timingError);}
 for(const [p,hash] of Object.entries(report.sourceHashes))assert.equal(createHash('sha256').update(await fs.readFile(p)).digest('hex'),hash,'source changed during witness');
 report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;}
finally{await context?.close();report.browserClosed=true;await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error}));}
