// Focused offline WebGPU conformance test. No simulation or rendering loop runs.
// Uses the production solver's actual grid pipeline and bind group.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const {values:a}=parseArgs({options:Object.fromEntries(['url','output','browser','playwright'].map(k=>[k,{type:'string'}]))});
const out=path.resolve(a.output);fs.mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'input',at:new Date().toISOString(),argv:process.argv,browserClosed:false,errors:[],
  authority:'offline_dispatch_of_production_grid_pipeline; explicit_test_readback; no_frame_loop'};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let context;
try{
  report.source={root:process.cwd(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim()};
  report.browserExecutable=fs.realpathSync(a.browser);assert(!report.browserExecutable.includes('/Google Chrome.app/'),'independent browser required');
  const {chromium}=await import(pathToFileURL(a.playwright));report.phase='browser';save();
  context=await chromium.launchPersistentContext(out+'/profile',{executablePath:a.browser,headless:true,args:['--use-mock-keychain','--password-store=basic']});
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  // A same-origin empty page avoids constructing the Workbench or hand runtime.
  await page.route('**/__hill_grid_test__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Hill grid contact test</title>'}));
  await page.goto(new URL('/__hill_grid_test__',a.url).href);
  report.servedFiles={};
  for(const file of ['mls-juice-solver.mjs','mls-juice-contract.mjs','mls-hill-terrain.mjs','vendor/splash-mls-mpm/p2g_1.wgsl','vendor/splash-mls-mpm/p2g_2.wgsl','vendor/splash-mls-mpm/g2p.wgsl']){
    const response=await page.request.get(new URL('/'+file,a.url).href);assert.equal(response.status(),200,`missing served ${file}`);
    const bytes=await response.body();assert.deepEqual(bytes,fs.readFileSync(file),`served source mismatch: ${file}`);
    report.servedFiles[file]=createHash('sha256').update(bytes).digest('hex');fs.mkdirSync(path.dirname(out+'/source/'+file),{recursive:true});fs.writeFileSync(out+'/source/'+file,bytes);
  }
  report.phase='grid-dispatch';save();
  report.cases=await page.evaluate(async()=>{
    const {createMlsJuiceSolver}=await import('/mls-juice-solver.mjs');
    const {sampleFrozenHill}=await import('/mls-hill-terrain.mjs');
    const adapter=await navigator.gpu?.requestAdapter();if(!adapter)throw Error('No WebGPU adapter');
    const gpu=await adapter.requestDevice();const cases=[];
    try{for(const fixture of [
      {name:'triangle_boundary_normal',heights:[.02,.03,.05,.09],node:[3,2,3],contact:true},
      {name:'cell_center_vertical_margin',heights:[.06,.06,.06,.06],node:[3,4,3],contact:false},
    ]){
      const terrain={schema:'kaminos.frozen-hill.v1',source:{repo:'test',commit:'asymmetric-two-triangle-fixture',phase:'frozen',sampleChecksum:fixture.name},grid:{x:2,z:2,min:[-.1,-.1],step:[.125,.125]},heights:fixture.heights,colors:Array(12).fill(.4),transform:{scale:1,translation:[0,0,0]}};
      let cells,pipeline,group,solver,readback;
      const device=new Proxy(gpu,{get(target,key){
        if(key==='createBuffer')return descriptor=>{const b=target.createBuffer(descriptor.label==='MLS grid'?{...descriptor,usage:descriptor.usage|GPUBufferUsage.COPY_SRC}:descriptor);if(descriptor.label==='MLS grid')cells=b;return b;};
        if(key==='createComputePipelineAsync')return async descriptor=>{const p=await target.createComputePipelineAsync(descriptor);if(descriptor.compute.entryPoint==='grid')pipeline=p;return p;};
        if(key==='createBindGroup')return descriptor=>{const g=target.createBindGroup(descriptor);group=g;return g;};
        const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
      }});
      gpu.pushErrorScope('validation');
      try{
        solver=await createMlsJuiceSolver({device,setup:{particleCount:1,gridSize:8,terrain},packet:{authority:{simulation_safe:false},emitters:[]}});
        if(!cells||!pipeline||!group)throw Error('Production grid capture missing');
        const cfg=solver.config,index=(fixture.node[0]*8+fixture.node[1])*8+fixture.node[2];
        gpu.queue.writeBuffer(cells,index*16,new Int32Array([0,-65536,0,65536]));
        const encoder=gpu.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(8);pass.end();
        readback=gpu.createBuffer({size:16,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});encoder.copyBufferToBuffer(cells,index*16,readback,0,16);gpu.queue.submit([encoder.finish()]);
        await readback.mapAsync(GPUMapMode.READ);const actual=Array.from(new Int32Array(readback.getMappedRange())).slice(0,3).map(v=>v/65536);
        // Pinned upstream transfers place physical samples at cellX + 0.5.
        const world=fixture.node.map((v,i)=>(v+.5)*cfg.cell+cfg.min[i]),ground=sampleFrozenHill(terrain,world[0],world[2]);
        const contact=world[1]<ground.height+cfg.cell,fall=-1-.4*cfg.dt*cfg.modelSecondsPerSecond;
        const expected=contact?ground.normal.map((n,i)=>(i===1?fall:0)-n*fall*ground.normal[1]):[0,fall,0];
        cases.push({name:fixture.name,node:fixture.node,world,normal:ground.normal,contact,expectedContact:fixture.contact,actual,expected,maxError:Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])))});
      }finally{readback?.destroy();solver?.dispose();const error=await gpu.popErrorScope();if(error)throw Error(error.message);}
    }}finally{gpu.destroy();}
    return cases;
  });
  for(const c of report.cases){assert.equal(c.contact,c.expectedContact,`${c.name}: fixture contact`);assert(c.maxError<5e-5,`${c.name}: production grid velocity ${c.actual} differs from cell-center contact ${c.expected}`);}
  assert.deepEqual(report.errors,[]);report.status='complete';report.phase='complete';
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;}
finally{if(context){await context.close();report.browserClosed=true;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));
