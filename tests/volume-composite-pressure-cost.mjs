// kaminos-test: manual — native Dawn WebGPU script; takes the webgpu module path and an output directory
// Explicit provisional pressure-only cost comparison. Run via Greenroom.
// Wall timings include JS encoding, submission and queue completion, not readback.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createCompositeGrid} from '../volume-composite-grid.mjs';
import {createCompositePressureGPU} from '../volume-composite-grid-gpu.mjs';
import {createCompositePCGGPU} from '../volume-composite-pcg-gpu.mjs';
import {pressureTimestampScope} from './helpers/volume-pressure-timing.mjs';
const [dawnPath,out,scaleArg='32',repeatArg='3',mode='comparison']=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: <dawn module> <output> [outer width=32] [repetitions=3]');
const width=Number(scaleArg),repetitions=Number(repeatArg);
assert.ok(Number.isInteger(width)&&width>=8&&width%8===0&&Number.isInteger(repetitions)&&repetitions>0);
mkdirSync(out,{recursive:true});
const report={schema:'composite-pressure-cost-v0',phase:'source',passed:false,cases:[],requested:{width,repetitions,tolerance:1e-5,mode},claim:'pressure-only synthetic forcing; no full-frame or live flame claim'};let device;
const persist=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
try{
  assert.ok(['comparison','attribution'].includes(mode),'explicit supported comparison mode required');
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-composite-grid.mjs','volume-composite-grid-gpu.mjs','volume-composite-pcg-gpu.mjs','tests/volume-composite-pressure-cost.mjs','tests/helpers/volume-pressure-timing.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};
  report.phase='adapter';persist();const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath:resolve(dawnPath),queue:process.env.GPU_GREENROOM_QUEUE_DIR??null};
  if(mode==='attribution')assert.ok(adapter.features.has('timestamp-query'),'native timestamp-query required');
  device=await adapter.requestDevice({requiredFeatures:mode==='attribution'?['timestamp-query']:[]});report.route.timestampQuery=device.features.has('timestamp-query');
  const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const h=1/8,fineMin=[width/2-width/8,1,width/2-width/8].map(v=>v*h),fineMax=fineMin.map(v=>v+width*h/4);
  report.phase='topology';persist();const buildStart=performance.now();
  const grid=createCompositeGrid({shape:[width,2*width,width],cellWidth:h,fine:{min:fineMin,max:fineMax,ratio:4},boundary:axis=>axis===1?'open':'wall'});
  report.grid={cells:grid.cells.length,faces:grid.faces.length,geometry:grid.geometry,buildMs:performance.now()-buildStart};
  const q=Float32Array.from(grid.faces,f=>f.axis===1&&f.b>=0&&grid.cells[f.a].level===1&&grid.cells[f.b].level===1?.1*f.area:0);
  const perturbed=Float32Array.from(q,(v,i)=>v*(1+.01*Math.sin(i*.013))),target=Float32Array.from(grid.cells,c=>c.level===1?.001:0);
  for(const [name,raw] of Object.entries({input:q,perturbed,target}))writeFileSync(resolve(out,`${name}.f32`),new Uint8Array(raw.buffer));
  report.phase='solvers';persist();const reference=createCompositePressureGPU(device,grid),candidate=createCompositePCGGPU(device,grid,{tolerance:report.requested.tolerance});
  try{
    const measure=async(solver,name,iterations,input,reset,label,effectiveTarget=target)=>{
      solver.setInput(input,effectiveTarget);await device.queue.onSubmittedWorkDone();
      const e=device.createCommandEncoder(),scope=mode==='attribution'?pressureTimestampScope(device,e):null;
      let timing;
      const t0=performance.now();solver.encode(scope?.encoder??e,{iterations,reset});scope?.resolve();const cb=e.finish(),t1=performance.now();device.queue.submit([cb]);await device.queue.onSubmittedWorkDone();const t2=performance.now();
      try{timing=scope?await scope.read():null;}finally{scope?.destroy();}
      const result=await solver.readback({tolerance:report.requested.tolerance});assert.deepEqual(errors,[]);
      const row={solver:name,label,iterations,encodeMs:t1-t0,submitAndCompletionMs:t2-t1,totalMs:t2-t0,gpuTiming:timing,receipt:result.receipt};report.cases.push(row);
      const id=String(report.cases.length).padStart(3,'0');for(const [key,raw] of Object.entries({flux:result.flux,pressure:result.pressure}))writeFileSync(resolve(out,`${id}-${key}.f32`),new Uint8Array(raw.buffer));
      persist();console.log(JSON.stringify(row));return result;
    };
    report.phase='comparison';persist();
    // Budget sweep is the experimental input, not a hidden solver cap. Every
    // exhausted case remains visible. Compilation/first-use is labeled apart.
    await measure(candidate,'pcg',0,q,true,'first-use-zero-budget');
    if(mode==='attribution'){
      const zeroQ=new Float32Array(q.length),zeroTarget=new Float32Array(target.length);
      for(let repetition=0;repetition<repetitions;repetition++)for(const iterations of [0,32,128]){
        await measure(candidate,'pcg',iterations,q,true,`active-${repetition}`);
        const idle=await measure(candidate,'pcg',iterations,zeroQ,true,`inactive-${repetition}`,zeroTarget);
        assert.ok(idle.converged&&idle.receipt.iterations===0,'inactive control must start converged');
      }
    }else{
    await measure(reference,'jacobi',0,q,true,'first-use-zero-budget');
    for(let repetition=0;repetition<repetitions;repetition++){
      for(const iterations of [32,64,128,256]){
        await measure(candidate,'pcg',iterations,q,true,`cold-${repetition}`);
        await measure(candidate,'pcg',iterations,perturbed,false,`changed-input-warm-${repetition}`);
      }
      for(const iterations of [128,512,2048])await measure(reference,'jacobi',iterations,q,true,`cold-${repetition}`);
    }
    }
    report.phase='complete';report.passed=true;
  }finally{reference.destroy();candidate.destroy();}
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();persist();console.log(JSON.stringify({phase:report.phase,passed:report.passed,error:report.error,report:resolve(out,'report.json')}));}
