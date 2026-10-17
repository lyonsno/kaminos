// kaminos-test: manual — native Metal A/B assay, run through Greenroom.
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createCompositeGrid} from '../volume-composite-grid.mjs';
import {createCompositePCGGPU} from '../volume-composite-pcg-gpu.mjs';
import {pressureTimestampScope} from './helpers/volume-pressure-timing.mjs';
const [modulePath,out]=process.argv.slice(2);assert.ok(modulePath&&out);
mkdirSync(out,{recursive:true});
const report={schema:'pcg-uniform-assay-v1',passed:false,phase:'source',cases:[],claim:'synthetic pressure-only counts A/B, not live drag or browser performance'};
const persist=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));
let device,gpu;
try{
  report.source={root:process.cwd(),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(['volume-composite-pcg-gpu.mjs','tests/volume-pcg-uniform-native.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(f)).digest('hex')]))};
  report.phase='adapter';persist();
  const {create,globals}=await import(pathToFileURL(resolve(modulePath)));Object.assign(globalThis,globals);
  gpu=create(['backend=metal']);const adapter=await gpu.requestAdapter();assert.ok(adapter);assert.ok(adapter.features.has('timestamp-query'));
  device=await adapter.requestDevice({requiredFeatures:['timestamp-query']});
  report.route={backend:'metal',modulePath,vendor:adapter.info.vendor,architecture:adapter.info.architecture,timestampQuery:device.features.has('timestamp-query')};
  const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  // Same physical extent and fine region; each obstacle mask changes compact counts.
  // Four states expose first use and new-count rebuilds, not only cache hits.
  for(let state=0;state<4;state++){
    report.phase=`state-${state}`;persist();
    const t=performance.now(),grid=createCompositeGrid({shape:[16,32,16],cellWidth:1/8,fine:{min:[.75,.25,.75],max:[1.25,.75,1.25],ratio:4},boundary:axis=>axis===1?'open':'wall',solid:p=>state>0&&p[0]<.25+state/8&&p[1]>.9&&p[1]<1.2});
    const gridBuildMs=performance.now()-t;
    const target=Float32Array.from(grid.cells,c=>c.level===1?.001:0),base=Float32Array.from(grid.faces,f=>f.axis===1&&f.b>=0&&grid.cells[f.a].level===1&&grid.cells[f.b].level===1?.1*f.area:0);
    writeFileSync(resolve(out,`s${state}-input.f32`),new Uint8Array(base.buffer));writeFileSync(resolve(out,`s${state}-target.f32`),new Uint8Array(target.buffer));
    const solvers={},results={};
    try{
      for(const uniformCounts of state%2?[true,false]:[false,true]){
        const name=uniformCounts?'uniform':'constant',start=performance.now();
        solvers[name]=createCompositePCGGPU(device,grid,{tolerance:1e-3,uniformCounts});
        const constructMs=performance.now()-start;
        for(const shader of solvers[name].shaders){const info=await shader.getCompilationInfo();assert.deepEqual(info.messages.filter(m=>m.type==='error'),[]);}
        results[name]=[];
        report.cases.push({state,name,cells:grid.cells.length,faces:grid.faces.length,gridBuildMs,constructMs,steps:[]});persist();
      }
      for(let step=0;step<4;step++)for(const name of (state+step)%2?['uniform','constant']:['constant','uniform']){
        const solver=solvers[name],q=Float32Array.from(base,(v,i)=>v*(1+.1*Math.sin(i*.013+step)));
        solver.setInput(q,target);await device.queue.onSubmittedWorkDone();
        const encoder=device.createCommandEncoder(),scope=pressureTimestampScope(device,encoder),start=performance.now();
        solver.encode(scope.encoder,{iterations:32,reset:step===0});scope.resolve();const commands=encoder.finish(),encoded=performance.now();
        device.queue.submit([commands]);await device.queue.onSubmittedWorkDone();const done=performance.now();
        let timing;try{timing=await scope.read();}finally{scope.destroy();}
        const result=await solver.readback();assert.deepEqual(errors,[]);assert.equal(result.receipt.breakdown,false);assert.ok(result.pressure.every(Number.isFinite));
        results[name].push(result);
        report.cases.find(r=>r.state===state&&r.name===name).steps.push({step,label:step===0?'first-submit':'changed-input-warm',encodeMs:encoded-start,submitCompletionMs:done-encoded,totalMs:done-start,...timing,receipt:result.receipt});
        for(const key of ['pressure','flux'])writeFileSync(resolve(out,`s${state}-${name}-${step}-${key}.f32`),new Uint8Array(result[key].buffer));persist();
      }
      for(let step=0;step<4;step++)for(const key of ['pressure','flux']){
        const a=results.constant[step][key],b=results.uniform[step][key];let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));
        assert.ok(max<=1e-6,`${key} parity exceeded: ${max}`);
      }
    }finally{for(const solver of Object.values(solvers))solver.destroy();}
  }
  report.passed=true;report.phase='complete';
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();persist();console.log(JSON.stringify({passed:report.passed,phase:report.phase,error:report.error,report:resolve(out,'report.json')}));}
