// Tiny native-kernel conformance, not a performance benchmark or flame smoke.
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCompositeGrid,projectComposite} from '../volume-composite-grid.mjs';
const [dawnPath,out]=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: node tests/volume-composite-grid-gpu.mjs <webgpu module> <output>');
mkdirSync(out,{recursive:true});
const report={schema:'composite-pressure-conformance-v0',phase:'capability',passed:false,cases:[]};let device;
try{
  const url=new URL('../volume-composite-grid-gpu.mjs',import.meta.url);
  assert.ok(existsSync(url),'composite pressure has no GPU execution capability');
  const {createCompositePressureGPU}=await import(url);
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-composite-grid.mjs','volume-composite-grid-gpu.mjs','tests/volume-composite-grid-gpu.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};
  report.phase='adapter';const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath:resolve(dawnPath),liveFlame:false};
  device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  for(const closed of [false,true]){
    report.phase=closed?'closed-exterior':'open-exterior';
    const grid=createCompositeGrid({shape:[4,6,4],cellWidth:1,fine:{min:[1,1,1],max:[3,3,3],ratio:2},
      boundary:axis=>axis===1?'open':'wall',solid:p=>closed&&p[1]>4&&p[1]<5});
    const q=Float32Array.from(grid.faces,f=>f.axis===1&&f.b>=0&&grid.cells[f.a].level===1&&grid.cells[f.b].level===1?.1*f.area:0);
    const ref=projectComposite(grid,q,{tolerance:1e-9});assert.ok(ref.converged);
    const solver=createCompositePressureGPU(device,grid);
    try{
      const info=await solver.shader.getCompilationInfo();assert.deepEqual([...info.messages].filter(m=>m.type==='error'),[]);
      solver.setInput(q);let e=device.createCommandEncoder();solver.encode(e,{iterations:0});device.queue.submit([e.finish()]);
      const incomplete=await solver.readback({tolerance:1e-5});assert.equal(incomplete.converged,false,'zero iterations must not claim completion');
      solver.setInput(q);e=device.createCommandEncoder();solver.encode(e,{iterations:2048});device.queue.submit([e.finish()]);
      const result=await solver.readback({tolerance:1e-5});assert.ok(result.converged,JSON.stringify(result.receipt));
      assert.deepEqual(errors,[]);
      const maxError=result.flux.reduce((m,v,i)=>Math.max(m,Math.abs(v-ref.flux[i])),0);assert.ok(maxError<2e-6,`flux CPU/GPU mismatch ${maxError}`);
      const fineFlow=grid.faces.reduce((s,f,i)=>s+(f.axis===1&&Math.abs(f.center[1]-3)<1e-12&&grid.cells[f.a].level===1?result.flux[i]:0),0);
      for(const [name,raw] of Object.entries({input:q,flux:result.flux,pressure:result.pressure}))writeFileSync(resolve(out,`${closed?'closed':'open'}-${name}.f32`),new Uint8Array(raw.buffer));
      report.cases.push({closed,fineFlow,maxError,receipt:result.receipt});
      assert.throws(()=>solver.setInput(q,new Float64Array(grid.cells.length).fill(1e100)),/float32 range/);
      assert.equal((await solver.readback({tolerance:1e-5})).converged,true,'refused input must preserve the previous measured target');
    }finally{solver.destroy();}
  }
  assert.ok(Math.abs(report.cases[0].fineFlow-report.cases[1].fineFlow)>.01);
  report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
