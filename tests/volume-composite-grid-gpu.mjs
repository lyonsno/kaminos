// kaminos-test: manual — native Dawn WebGPU script; takes the webgpu module path and an output directory
// Tiny native-kernel conformance, not a performance benchmark or flame smoke.
import assert from 'node:assert/strict';
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createCompositeGrid,projectComposite} from '../volume-composite-grid.mjs';
import {createCompositeStorageLayout,scatterCompositeFlux} from '../volume-composite-storage.mjs';
import {createCompositeStorageGPU} from '../volume-composite-storage-gpu.mjs';
const [dawnPath,out]=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: node tests/volume-composite-grid-gpu.mjs <webgpu module> <output>');
mkdirSync(out,{recursive:true});
const report={schema:'composite-pressure-conformance-v0',phase:'capability',passed:false,cases:[]};let device;
try{
  const url=new URL('../volume-composite-grid-gpu.mjs',import.meta.url);
  assert.ok(existsSync(url),'composite pressure has no GPU execution capability');
  const {createCompositePressureGPU}=await import(url);
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-composite-grid.mjs','volume-composite-grid-gpu.mjs','volume-composite-storage.mjs','volume-composite-storage-gpu.mjs','tests/volume-composite-grid-gpu.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};
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
      for(const shader of [solver.shader,solver.targetShader].filter(Boolean)){const info=await shader.getCompilationInfo();assert.deepEqual([...info.messages].filter(m=>m.type==='error'),[]);}
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
      report.phase='gpu-gather-project-scatter';
      assert.equal(typeof solver.encodeGPU,'function','shared pressure cannot yet consume GPU-gathered velocity and expansion targets');
      const layout=createCompositeStorageLayout(grid),owned=[];
      const alloc=data=>{const b=device.createBuffer({size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
      const read=async(b,length)=>{const d=device.createBuffer({size:length*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,d,0,length*4);device.queue.submit([e.finish()]);await d.mapAsync(GPUMapMode.READ);return new Float32Array(d.getMappedRange().slice(0));}finally{d.destroy();}};
      const initial=scatterCompositeFlux(layout,q,{fine:Float32Array.from({length:layout.fineLength},(_,i)=>i%16>=3?i*.125:0),coarse:Float32Array.from({length:layout.coarseLength},(_,i)=>i%8>=3?i*.25:0)});
      const buffers={fine:alloc(Float32Array.from(initial.fine)),coarse:alloc(Float32Array.from(initial.coarse)),lower:alloc(Float32Array.from(initial.lower)),flux:solver.fluxBuffer};
      const targets=Float32Array.from(grid.cells,c=>c.level===1?.001:0),targetBuffer=alloc(targets);
      const bridge=createCompositeStorageGPU(device,layout,buffers);
      try{
        const refGPU=projectComposite(grid,q,{target:targets,tolerance:1e-9});assert.ok(refGPU.converged);
        const encode=budget=>{const e=device.createCommandEncoder();bridge.encodeGather(e,{interfaceSource:'fine'});solver.encodeGPU(e,{targetBuffer,iterations:budget});bridge.encodeScatter(e);device.queue.submit([e.finish()]);};
        encode(2048);const joined=await solver.readback({tolerance:1e-5});assert.ok(joined.converged,JSON.stringify(joined.receipt));
        assert.equal(joined.receipt.inputRoute,'gpu-buffers');
        assert.deepEqual(joined.target,targets,'receipt target must come from encoded GPU input');
        const expected=scatterCompositeFlux(layout,refGPU.flux,initial),actual={fine:await read(buffers.fine,layout.fineLength),coarse:await read(buffers.coarse,layout.coarseLength),lower:await read(buffers.lower,layout.lowerLength)};
        let maxVelocityError=0;
        for(const k of ['fine','coarse','lower']){for(let i=0;i<actual[k].length;i++){if(k!=='lower'&&i%(k==='fine'?16:8)>=3)assert.equal(actual[k][i],initial[k][i],'material fields unchanged by composed projection');else{maxVelocityError=Math.max(maxVelocityError,Math.abs(actual[k][i]-expected[k][i]));assert.ok(Math.abs(actual[k][i]-expected[k][i])<2e-6);}}writeFileSync(resolve(out,`${closed?'closed':'open'}-joined-${k}.f32`),new Uint8Array(actual[k].buffer));}
        for(const [name,raw] of Object.entries({target:targets,flux:joined.flux,pressure:joined.pressure}))writeFileSync(resolve(out,`${closed?'closed':'open'}-joined-${name}.f32`),new Uint8Array(raw.buffer));
        report.cases.at(-1).joined={receipt:joined.receipt,maxVelocityError,nonVelocityFieldsExact:true};
        // A mutable upstream target must be copied into this solve's state;
        // later producer writes cannot change what the readback claims was solved.
        device.queue.writeBuffer(targetBuffer,0,new Float32Array(targets.length).fill(.5));
        assert.equal((await solver.readback()).converged,true,'readback must retain the effective encoded target');
        assert.throws(()=>solver.encodeGPU(device.createCommandEncoder(),{targetBuffer:buffers.fine,iterations:1}),/target/);
        assert.equal((await solver.readback()).converged,true,'refused GPU input must preserve previous solve');
        device.queue.writeBuffer(targetBuffer,0,new Float32Array(targets.length).fill(NaN));
        encode(0);const invalid=await solver.readback();assert.equal(invalid.converged,false,'nonfinite GPU target must not claim convergence');assert.equal(invalid.receipt.targetFinite,false);
        assert.deepEqual(errors,[]);
      }finally{bridge.destroy();for(const b of owned)b.destroy();}
    }finally{solver.destroy();}
  }
  assert.ok(Math.abs(report.cases[0].fineFlow-report.cases[1].fineFlow)>.01);
  report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
