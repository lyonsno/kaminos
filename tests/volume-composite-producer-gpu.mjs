// kaminos-test: manual — native Dawn WebGPU script; takes the webgpu module path and an output directory
// Native binding-19 format/ordering conformance. Synthetic values, actual
// r32float storage-texture descriptor and shared pressure consumer; no flame.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createCompositeProducerLayout,gatherCompositeTarget} from '../volume-composite-producer.mjs';
import {createCompositePressureGPU} from '../volume-composite-grid-gpu.mjs';
const [dawnPath,out]=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: node tests/volume-composite-producer-gpu.mjs <webgpu module> <output>');
mkdirSync(out,{recursive:true});
const report={schema:'composite-producer-conformance-v0',phase:'capability',passed:false,cases:[]};
let device,bridge,solver;const textures=[];
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
  const url=new URL('../volume-composite-producer-gpu.mjs',import.meta.url);
  assert.ok(existsSync(url),'GPU texture-to-leaf target intake is absent');
  const {createCompositeProducerGPU}=await import(url);
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-core.js','volume-composite-grid.mjs','volume-composite-grid-gpu.mjs','volume-composite-producer.mjs','volume-composite-producer-gpu.mjs','tests/volume-composite-producer-gpu.mjs'].map(f=>[f,hash(readFileSync(new URL('../'+f,import.meta.url)))]))};
  report.phase='adapter';const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath:resolve(dawnPath),liveFlame:false,
    producer:'synthetic values; binding19 r32float STORAGE_BINDING|COPY_DST observed in volume-core.js',consumer:'createCompositePressureGPU.encodeGPU'};
  device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const shape=[4,6,2],min=[-2,3,-1],fineMin=[-1.5,3.5,-.5];
  const fineCells=new Uint8Array(48);fineCells[9]=1;
  const coarseCells=new Uint8Array(80);coarseCells[0]=1;coarseCells[25]=1;
  const layout=createCompositeProducerLayout({geometry:{shape:[4,5,4],min,cellWidth:.5,fine:{min:fineMin,max:[-.5,5,0],ratio:2}},
    fineSolids:{cells:fineCells,shape,revision:'fine-A'},coarseSolids:{cells:coarseCells,shape:[4,5,4],revision:'coarse-A'}});
  report.geometry={...layout.grid.geometry,fineShape:shape,cells:layout.grid.cells.length,faces:layout.grid.faces.length,solidRevisions:layout.solidRevisions};
  const texture=(size=shape,format='r32float',usage=GPUTextureUsage.STORAGE_BINDING|GPUTextureUsage.COPY_DST)=>{
    const t=device.createTexture({size,dimension:'3d',format,usage});textures.push(t);return t;
  };
  const source=texture(),revisions=layout.solidRevisions;
  bridge=createCompositeProducerGPU(device,layout);solver=createCompositePressureGPU(device,layout.grid);
  report.phase='compile';assert.deepEqual([...(await bridge.shader.getCompilationInfo()).messages].filter(m=>m.type==='error'),[]);
  const write=values=>device.queue.writeTexture({texture:source},values,{bytesPerRow:shape[0]*4,rowsPerImage:shape[1]},shape);
  const preserve=(name,values)=>writeFileSync(resolve(out,name+'.f32'),new Uint8Array(values.buffer,values.byteOffset,values.byteLength));
  for(const scale of [1,2]){
    report.phase='target-'+scale;const values=Float32Array.from({length:48},(_,i)=>scale*(i+1)/4096);write(values);
    const e=device.createCommandEncoder();bridge.encode(e,{targetTexture:source,solidRevisions:revisions});
    solver.encodeGPU(e,{targetBuffer:bridge.targetBuffer,iterations:2048});device.queue.submit([e.finish()]);
    const result=await solver.readback({tolerance:1e-5}),expected=gatherCompositeTarget(layout,values);
    assert.deepEqual(result.target,expected,'native leaf target must equal source unchanged, with outer zero');
    assert.ok(result.converged,JSON.stringify(result.receipt));
    preserve('input-'+scale,values);preserve('target-'+scale,result.target);preserve('flux-'+scale,result.flux);preserve('pressure-'+scale,result.pressure);
    report.cases.push({scale,converged:result.converged,receipt:result.receipt,targetExact:true});
  }
  report.phase='refusal';
  const e=device.createCommandEncoder();
  assert.throws(()=>bridge.encode(e,{targetTexture:source,solidRevisions:{fine:'fine-B',coarse:'coarse-A'}}),/rebuild/);
  assert.throws(()=>bridge.encode(e,{targetTexture:texture([4,2,6]),solidRevisions:revisions}),/shape/);
  assert.throws(()=>bridge.encode(e,{targetTexture:texture(shape,'rgba32float'),solidRevisions:revisions}),/r32float/);
  assert.throws(()=>bridge.encode(e,{targetTexture:texture(shape,'r32float',GPUTextureUsage.TEXTURE_BINDING),solidRevisions:revisions}),/STORAGE_BINDING/);
  device.queue.submit([e.finish()]);
  const old=await solver.readback({tolerance:1e-5});assert.ok(old.converged,'rejected intake must not invalidate completed pressure');
  report.phase='nonfinite';const bad=new Float32Array(48);bad[0]=NaN;write(bad);
  const b=device.createCommandEncoder();bridge.encode(b,{targetTexture:source,solidRevisions:revisions});solver.encodeGPU(b,{targetBuffer:bridge.targetBuffer,iterations:0});device.queue.submit([b.finish()]);
  const invalid=await solver.readback({tolerance:1e-5});assert.equal(invalid.converged,false,'nonfinite native target cannot close');preserve('nonfinite-target',invalid.target);
  bridge.destroy();assert.throws(()=>bridge.encode(device.createCommandEncoder(),{targetTexture:source,solidRevisions:revisions}),/destroyed/);bridge=null;
  await device.queue.onSubmittedWorkDone();assert.deepEqual(errors,[]);report.phase='complete';report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{bridge?.destroy();solver?.destroy();for(const t of textures)t.destroy();device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
