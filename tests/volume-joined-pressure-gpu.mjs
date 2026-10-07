import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createOuterSmoke,outerSmokeConfig} from '../volume-outer-smoke.mjs';
import {joinedVelocityUnits} from '../volume-core.js';
const [dawnPath,out]=process.argv.slice(2);assert.ok(dawnPath&&out);mkdirSync(out,{recursive:true});
const report={phase:'adapter',passed:false,cases:[]};let device;
try {
  const root=resolve(new URL('..',import.meta.url).pathname);
  report.source={root,revision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),hashes:Object.fromEntries(['volume-core.js','volume-outer-smoke.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(resolve(root,f))).digest('hex')]))};
  const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  globalThis.__joinedPressureGPU=create(['backend=metal']);const adapter=await globalThis.__joinedPressureGPU.requestAdapter();
  assert.ok(adapter);device=await adapter.requestDevice();report.route={backend:'metal',vendor:adapter.info.vendor,device:adapter.info.device};
  const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  // Execute the production appearance helpers on identical local velocities,
  // separately from the pressure/transport fixtures below.
  const coreSource=readFileSync(resolve(root,'volume-core.js'),'utf8');
  function fn(name){const start=coreSource.indexOf(`fn ${name}(`),open=coreSource.indexOf('{',start);assert.ok(start>=0);let depth=1,i=open+1;for(;depth&&i<coreSource.length;i++){if(coreSource[i]==='{')depth++;if(coreSource[i]==='}')depth--;}return coreSource.slice(start,i);}
  const opticalShader=device.createShaderModule({code:`override GRID:u32=32u;const OUTER_SMOKE:bool=true;
    ${['joinedVelocityScale','opticalVelocityMagnitude','emissiveTemperature','boundarySupportFromSlots'].map(fn).join('\n')}
    @group(0) @binding(0) var<storage,read_write> result:array<vec4<f32>>;
    @compute @workgroup_size(1) fn check(){
      let v=vec4<f32>(0.0,.5*f32(GRID)/32.0,0.0,0.0);
      let m=vec4<f32>(.1,.2,.05,0.0);let f=vec4<f32>(.04,0.0,.03,.01);let d=vec4<f32>(0.0,0.0,.005,0.0);
      let speed=opticalVelocityMagnitude(v.xyz);
      result[0]=vec4<f32>(speed,emissiveTemperature(f,m,d,speed),boundarySupportFromSlots(v,m,f,d,.01,vec4<f32>(1.0)),0.0);
    }`});
  report.optical=[];let firstOptical;
  for(const grid of [32,64]){
    report.phase=`optical-${grid}`;const p=device.createComputePipeline({layout:'auto',compute:{module:opticalShader,entryPoint:'check',constants:{GRID:grid}}});
    const b=device.createBuffer({size:16,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const e=device.createCommandEncoder(),pass=e.beginComputePass();pass.setPipeline(p);pass.setBindGroup(0,device.createBindGroup({layout:p.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:b}}]}));pass.dispatchWorkgroups(1);pass.end();e.copyBufferToBuffer(b,0,read,0,16);device.queue.submit([e.finish()]);await read.mapAsync(GPUMapMode.READ);const v=Array.from(new Float32Array(read.getMappedRange()));read.unmap();
      report.optical.push({grid,speed:v[0],temperatureProxy:v[1],boundarySupport:v[2]});if(firstOptical)assert.deepEqual(v,firstOptical);else firstOptical=v;
    }finally{b.destroy();read.destroy();}
  }
  let reference;
  for(const n of [32,64]) {
    report.phase=`core-${n}`;const values=new Float32Array(n**3*16);
    const scale=joinedVelocityUnits(n,true).cellScale;
    for(let i=0;i<values.length;i+=16){values[i+1]=.5*scale;values[i+4]=1;values[i+5]=1;}
    const near=device.createBuffer({size:values.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(near,0,values);
    const solver=createOuterSmoke(device,outerSmokeConfig({grid:32,nearHeightRatio:1}),n,[near,near]);
    try {
      for(let step=0;step<8;step++){const e=device.createCommandEncoder();solver.encode(e,0,{dtScale:1,backtraceScale:1},0);device.queue.submit([e.finish()]);}
      const field=await solver.readState(),receipt=solver.receipt();
      writeFileSync(resolve(out,`core-${n}.f32`),new Uint8Array(field.buffer));
      assert.equal(receipt.pressureCompletion.satisfied,true);assert.ok(receipt.pressureCompletion.maxError<=.001);
      assert.ok(field.every(Number.isFinite));let maxDifference=0;
      if(reference)for(let i=0;i<field.length;i++)maxDifference=Math.max(maxDifference,Math.abs(field[i]-reference[i]));
      else reference=field;
      report.cases.push({coreGrid:n,cellScale:scale,localSpeed:.5*scale*2/n,receipt,maxDifference});
      assert.ok(maxDifference<1e-5,'the identical local donor field must not acquire a resolution-dependent receiving phase');
    } finally {solver.destroy();near.destroy();}
  }
  // A queue that submits no commands leaves zero-initialized buffers. Those
  // must be rejected, not described as a converged pressure solve.
  report.phase='negative-dropped-submit';
  const dropped=new Proxy(device,{get(target,key){if(key==='queue')return new Proxy(target.queue,{get(q,k){if(k==='submit')return()=>{};const v=q[k];return typeof v==='function'?v.bind(q):v;}});const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  const near=device.createBuffer({size:32**3*16*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  const solver=createOuterSmoke(dropped,outerSmokeConfig({nearHeightRatio:1}),32,[near,near]);
  try {const e=device.createCommandEncoder();solver.encode(e,0,{dtScale:1,backtraceScale:1},0);dropped.queue.submit([e.finish()]);await assert.rejects(solver.readState(),/execution-unverified/);}
  finally {solver.destroy();near.destroy();}
  assert.deepEqual(errors,[]);report.phase='complete';report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
