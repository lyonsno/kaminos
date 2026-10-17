// kaminos-test: manual — native Dawn WebGPU script; takes the webgpu module path and an output directory
// Small native numerical conformance; not a benchmark or live flame witness.
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createCompositeGrid,projectComposite} from '../volume-composite-grid.mjs';
const [dawnPath,out]=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: node tests/volume-composite-pcg-gpu.mjs <webgpu module> <output>');
mkdirSync(out,{recursive:true});
const report={schema:'composite-pcg-conformance-v0',phase:'capability',passed:false,cases:[]};let device;
try{
  const url=new URL('../volume-composite-pcg-gpu.mjs',import.meta.url);
  assert.ok(existsSync(url),'shared pressure lacks a warm-started GPU PCG candidate');
  const {createCompositePCGGPU}=await import(url);
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-composite-pcg-gpu.mjs','volume-composite-grid.mjs','tests/volume-composite-pcg-gpu.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};
  report.phase='adapter';const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath:resolve(dawnPath),liveFlame:false};
  device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  for(const closed of [false,true]){
    report.phase=closed?'closed-exterior':'open-exterior';
    const grid=createCompositeGrid({shape:[4,6,4],cellWidth:1,fine:{min:[1,1,1],max:[3,3,3],ratio:2},boundary:axis=>axis===1?'open':'wall',solid:p=>closed&&p[1]>4&&p[1]<5});
    const q=Float32Array.from(grid.faces,f=>f.axis===1&&f.b>=0&&grid.cells[f.a].level===1&&grid.cells[f.b].level===1?.1*f.area:0);
    const target=Float32Array.from(grid.cells,c=>c.level===1?.001:0),ref=projectComposite(grid,q,{target,tolerance:1e-9});assert.ok(ref.converged);
    const solver=createCompositePCGGPU(device,grid,{tolerance:1e-5});
    const run=async(iterations,reset=false)=>{solver.setInput(q,target);const e=device.createCommandEncoder();solver.encode(e,{iterations,reset});device.queue.submit([e.finish()]);return solver.readback();};
    try{
      for(const shader of solver.shaders){assert.deepEqual([...((await shader.getCompilationInfo()).messages)].filter(m=>m.type==='error'),[]);}
      const incomplete=await run(0,true);assert.equal(incomplete.converged,false,'zero budget may not hide unsolved divergence');
      const cold=await run(128,true);assert.ok(cold.converged,JSON.stringify(cold.receipt));assert.ok(cold.receipt.iterations>0&&cold.receipt.iterations<128);
      const error=cold.flux.reduce((s,v,i)=>Math.max(s,Math.abs(v-ref.flux[i])),0);assert.ok(error<2e-6,`CPU flux discrepancy ${error}`);
      const warm=await run(128);assert.ok(warm.converged,JSON.stringify(warm.receipt));assert.equal(warm.receipt.iterations,0,'same input must reuse converged pressure');
      const reset=await run(0,true);assert.equal(reset.converged,false,'reset must discard previous pressure');
      const targetBuffer=device.createBuffer({size:target.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
      try{
        device.queue.writeBuffer(solver.fluxBuffer,0,q);device.queue.writeBuffer(targetBuffer,0,target);
        let e=device.createCommandEncoder();solver.encodeGPU(e,{targetBuffer,iterations:128});device.queue.submit([e.finish()]);
        const joined=await solver.readback();assert.ok(joined.converged,JSON.stringify(joined.receipt));assert.deepEqual(joined.target,target);assert.equal(joined.receipt.inputRoute,'gpu-buffers');
        device.queue.writeBuffer(targetBuffer,0,new Float32Array(target.length).fill(.5));assert.deepEqual((await solver.readback()).target,target,'upstream mutation cannot rewrite solve identity');
        assert.throws(()=>solver.encodeGPU(device.createCommandEncoder(),{targetBuffer:solver.fluxBuffer,iterations:1}),/target/);
        assert.equal((await solver.readback()).converged,true,'rejected call preserves measured solve');
        device.queue.writeBuffer(targetBuffer,0,new Float32Array(target.length).fill(NaN));device.queue.writeBuffer(solver.fluxBuffer,0,q);
        e=device.createCommandEncoder();solver.encodeGPU(e,{targetBuffer,iterations:4});device.queue.submit([e.finish()]);
        const invalid=await solver.readback();assert.equal(invalid.converged,false);assert.equal(invalid.receipt.targetFinite,false);
        assert.ok((await run(128)).converged,'bad input must not permanently poison warm state');
        report.cases.push({closed,error,cold:cold.receipt,warm:warm.receipt,joined:joined.receipt,invalid:invalid.receipt,fineFlow:grid.faces.reduce((s,f,i)=>s+(f.axis===1&&Math.abs(f.center[1]-3)<1e-12&&grid.cells[f.a].level===1?cold.flux[i]:0),0)});
        for(const [name,raw] of Object.entries({input:q,target,flux:cold.flux,pressure:cold.pressure}))writeFileSync(resolve(out,`${closed?'closed':'open'}-${name}.f32`),new Uint8Array(raw.buffer));
      }finally{targetBuffer.destroy();}
    }finally{solver.destroy();}
  }
  assert.ok(Math.abs(report.cases[0].fineFlow-report.cases[1].fineFlow)>.01,'exterior closure must change fine flow');assert.deepEqual(errors,[]);
  report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
