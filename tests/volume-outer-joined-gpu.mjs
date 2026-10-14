// kaminos-test: manual — native Dawn WebGPU script; takes the webgpu module path and an output directory
// Native exterior-consumer conformance; fine input is synthetic, not a flame.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOuterSmoke,outerSmokeConfig} from '../volume-outer-smoke.mjs';
import {createCompositeGrid} from '../volume-composite-grid.mjs';
import {createCompositePressureGPU} from '../volume-composite-grid-gpu.mjs';
import {createCompositeStorageLayout} from '../volume-composite-storage.mjs';
import {createCompositeStorageGPU} from '../volume-composite-storage-gpu.mjs';
const [dawnPath,out]=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: node tests/volume-outer-joined-gpu.mjs <webgpu module> <output>');
mkdirSync(out,{recursive:true});
const report={schema:'outer-joined-consumer-v0',phase:'adapter',passed:false,cases:[]};let device;
try{
  const files=['volume-outer-smoke.mjs','volume-passive-material.mjs','volume-composite-grid.mjs','volume-composite-grid-gpu.mjs','volume-composite-storage.mjs','volume-composite-storage-gpu.mjs','tests/volume-outer-joined-gpu.mjs'];
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))};
  const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath:resolve(dawnPath),liveFlame:false,fineProducer:'synthetic',coarseProducer:'createOuterSmoke'};
  device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const c=outerSmokeConfig({grid:8,extent:2,nearHeightRatio:1});
  const grid=createCompositeGrid({shape:c.shape,min:c.min,cellWidth:c.cellWidth,fine:{min:[-1,-1,-1],max:[1,1,1],ratio:2},boundary:()=> 'open'});
  const layout=createCompositeStorageLayout(grid),owned=[];
  const alloc=(n,data)=>{const b=device.createBuffer({size:n*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);if(data)device.queue.writeBuffer(b,0,data);return b;};
  const read=async b=>{const r=device.createBuffer({size:b.size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,r,0,b.size);device.queue.submit([e.finish()]);await r.mapAsync(GPUMapMode.READ);return new Float32Array(r.getMappedRange().slice(0));}finally{r.destroy();}};
  const seed=new Float32Array(layout.fineLength);for(let i=0;i<seed.length;i+=16){seed[i+1]=.1;seed[i+4]=.7;seed[i+5]=.8;}
  const fine=alloc(seed.length,seed),lower=alloc(layout.lowerLength),targetBuffer=alloc(grid.cells.length),before=alloc(layout.coarseLength);
  const outer=createOuterSmoke(device,c,8,[fine,fine]),pressure=createCompositePressureGPU(device,grid),bridges=new Map();outer.clearSolids();
  try{
    report.phase='compile';for(const shader of [outer.shader,pressure.shader,pressure.targetShader])assert.deepEqual([...(await shader.getCompilationInfo()).messages].filter(m=>m.type==='error'),[]);
    let previous=null;
    for(let step=0;step<2;step++){
      report.phase=`joined-step-${step}`;
      const e=device.createCommandEncoder();
      outer.encodeExternalProjection(e,0,{dtScale:0,backtraceScale:0},(encoder,coarse)=>{
        encoder.copyBufferToBuffer(coarse,0,before,0,before.size);
        if(!bridges.has(coarse))bridges.set(coarse,createCompositeStorageGPU(device,layout,{fine,coarse,lower,flux:pressure.fluxBuffer}));
        const bridge=bridges.get(coarse);bridge.encodeGather(encoder,{interfaceSource:'fine'});
        pressure.encodeGPU(encoder,{targetBuffer,iterations:2048});bridge.encodeScatter(encoder);
      },0);
      device.queue.submit([e.finish()]);
      const result=await pressure.readback({tolerance:1e-5}),values=await outer.readState(),predicted=await read(before);
      assert.ok(result.converged,JSON.stringify(result.receipt));assert.deepEqual(errors,[]);
      assert.equal(outer.receipt().pressureScheme,'external-unverified');assert.equal(outer.receipt().pressureCompletion,null);
      let changed=0,consumed=0;
      for(let i=0;i<values.length;i++)if(i%8>=3)assert.equal(values[i],predicted[i],'shared pressure preserves exterior material');else if(values[i]!==predicted[i])changed++;
      assert.ok(changed>0,'actual exterior predictor must receive pressure corrections');
      if(previous){
        const bounds=outer.receipt().donorBounds;
        for(let z=0;z<c.shape[2];z++)for(let y=0;y<c.shape[1];y++)for(let x=0;x<c.shape[0];x++)for(let axis=0;axis<3;axis++){
          const p=[x,y,z].map((v,a)=>c.min[a]+(v+.5-(a===axis?.5:0))*c.cellWidth);
          if(p.every((v,a)=>v>bounds.min[a]&&v<bounds.max[a]))continue;
          const i=(x+(c.grid+1)*(y+(2*c.grid+1)*z))*8+axis;
          assert.ok(Math.abs(predicted[i]-previous[i])<1e-7,'next actual exterior predictor must read corrected velocity');consumed++;
        }
        assert.ok(consumed>0);
      }
      for(const [name,data] of Object.entries({predictor:predicted,coarse:values,fine:await read(fine),lower:await read(lower),flux:result.flux,pressure:result.pressure,target:result.target}))writeFileSync(resolve(out,`step-${step}-${name}.f32`),new Uint8Array(data.buffer));
      report.cases.push({step,changedVelocityEntries:changed,nextStepConsumptionEntries:consumed,pressure:result.receipt,outer:outer.receipt()});previous=values;
    }
    report.phase='complete';report.passed=true;
  }finally{for(const b of bridges.values())b.destroy();outer.destroy();pressure.destroy();for(const b of owned)b.destroy();}
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
