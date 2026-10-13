// Native buffer-layout conformance, not live producer integration or timing.
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createCompositeGrid} from '../volume-composite-grid.mjs';
import {createCompositeStorageLayout,gatherCompositeFlux,scatterCompositeFlux} from '../volume-composite-storage.mjs';
const [dawnPath,out,recorded]=process.argv.slice(2);
assert.ok(dawnPath&&out,'usage: node tests/volume-composite-storage-gpu.mjs <webgpu module> <output> [recorded outer-evolution directory]');
mkdirSync(out,{recursive:true});
const report={schema:'composite-storage-conformance-v0',phase:'capability',passed:false,cases:[]};let device;
const hash=b=>createHash('sha256').update(b).digest('hex');
try{
  const url=new URL('../volume-composite-storage-gpu.mjs',import.meta.url);
  assert.ok(existsSync(url),'shared pressure has no native fine/coarse storage bridge');
  const {createCompositeStorageGPU}=await import(url);
  report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-composite-grid.mjs','volume-composite-storage.mjs','volume-composite-storage-gpu.mjs','tests/volume-composite-storage-gpu.mjs'].map(f=>[f,hash(readFileSync(new URL('../'+f,import.meta.url)))]))};
  report.phase='adapter';const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']),adapter=await gpu.requestAdapter();assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,dawnPath:resolve(dawnPath),liveFlame:false};
  device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const cases=[{name:'noncube-solid',grid:createCompositeGrid({shape:[4,5,4],cellWidth:1,fine:{min:[1,1,1],max:[3,4,3],ratio:2},solid:p=>p[0]<1&&p[1]<1})}];
  if(recorded){
    const src=JSON.parse(readFileSync(resolve(recorded,'report.json'))),arm=src.arms.find(a=>a.label==='on-146');
    assert.equal(src.phase,'complete');assert.equal(arm.state.effectiveRoute,'native-3d-compute-fluid-raymarch-v0');
    assert.equal(arm.outer.receipt.effective,'one-way-coarse-pressure-smoke-v0');
    assert.deepEqual(arm.state.simGridDimensions,[32,32,32]);assert.deepEqual(arm.outer.receipt.shape,[32,64,32]);
    assert.equal(arm.state.sceneCollision.solidCellCount,0);
    const raw=Object.fromEntries(['fluid','outer'].map(k=>[k,readFileSync(resolve(recorded,`on-146-${k}.f32`))]));
    assert.equal(hash(raw.outer),arm.outer.sha256,'recorded outer bytes must match the observed receipt');
    const asFloat=b=>new Float32Array(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength));
    const c=arm.outer.receipt;
    cases.push({name:'observed-one-way-buffer-replay',grid:createCompositeGrid({shape:c.shape,min:c.bounds.min,cellWidth:c.cellWidth,fine:{min:[-1,-1,-1],max:[1,1,1],ratio:4}}),fine:asFloat(raw.fluid),coarse:asFloat(raw.outer)});
    report.observed={directory:resolve(recorded),revision:src.sourceRevision,effectiveHash:src.effectiveHash,reportHash:hash(readFileSync(resolve(recorded,'report.json'))),
      inputHashes:Object.fromEntries(Object.entries(raw).map(([k,b])=>[k,hash(b)])),route:arm.state.effectiveRoute,
      boundaryAuthority:'synthetic lower-face zeros; replay validates storage only, not producer boundary physics'};
  }
  for(const c of cases){
    report.phase=c.name;const layout=createCompositeStorageLayout(c.grid);
    const fine=c.fine??Float32Array.from({length:layout.fineLength},(_,i)=>Math.sin(i)*.25);
    const coarse=c.coarse??Float32Array.from({length:layout.coarseLength},(_,i)=>Math.cos(i)*.125);
    const lower=new Float32Array(layout.lowerLength);
    const owned=[],alloc=(label,data)=>{const b=device.createBuffer({label,size:data.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST});owned.push(b);device.queue.writeBuffer(b,0,data);return b;};
    const buffers={fine:alloc('fine fluid',fine),coarse:alloc('coarse cells',coarse),lower:alloc('lower faces',lower),flux:alloc('shared flux',new Float32Array(layout.faces.length))};
    assert.throws(()=>createCompositeStorageGPU(device,layout,{...buffers,lower:buffers.fine}),/distinct/,'aliased producer storage must refuse');
    const short=alloc('incomplete lower faces',new Float32Array(layout.lowerLength-1));
    assert.throws(()=>createCompositeStorageGPU(device,layout,{...buffers,lower:short}),/complete storage/,'missing boundary coverage must refuse');
    const bridge=createCompositeStorageGPU(device,layout,buffers);
    const read=async(b,length)=>{const dst=device.createBuffer({size:length*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{const e=device.createCommandEncoder();e.copyBufferToBuffer(b,0,dst,0,length*4);device.queue.submit([e.finish()]);await dst.mapAsync(GPUMapMode.READ);return new Float32Array(dst.getMappedRange().slice(0));}finally{dst.destroy();}};
    const compare=(a,b,label)=>{assert.equal(a.length,b.length);let maxError=0;for(let i=0;i<a.length;i++){assert.ok(Number.isFinite(a[i]));maxError=Math.max(maxError,Math.abs(a[i]-b[i]));assert.ok(Math.abs(a[i]-b[i])<2e-6*Math.max(1,Math.abs(b[i])),`${label} at ${i}: ${a[i]} vs ${b[i]}`);}return maxError;};
    try{
      for(const s of bridge.shaders)assert.deepEqual([...(await s.getCompilationInfo()).messages].filter(m=>m.type==='error'),[]);
      assert.throws(()=>bridge.encodeGather(device.createCommandEncoder(),{}),/interface source/);
      const gatherErrors={};
      for(const interfaceSource of ['fine','coarse']){const e=device.createCommandEncoder();bridge.encodeGather(e,{interfaceSource});device.queue.submit([e.finish()]);gatherErrors[interfaceSource]=compare(await read(buffers.flux,layout.faces.length),gatherCompositeFlux(layout,{fine,coarse,lower,interfaceSource}),'gather');}
      // Independent varying subface flux exercises conservative restriction.
      const flux=Float32Array.from(layout.faces,(f,i)=>Math.sin(i*.31)*.02*f.area);
      device.queue.writeBuffer(buffers.flux,0,flux);const e=device.createCommandEncoder();bridge.encodeScatter(e);device.queue.submit([e.finish()]);
      const output={fine:await read(buffers.fine,layout.fineLength),coarse:await read(buffers.coarse,layout.coarseLength),lower:await read(buffers.lower,layout.lowerLength)};
      const expected=scatterCompositeFlux(layout,flux,{fine,coarse}),scatterErrors={};
      for(const k of ['fine','coarse','lower']){scatterErrors[k]=compare(output[k],expected[k],k);writeFileSync(resolve(out,`${c.name}-${k}.f32`),new Uint8Array(output[k].buffer));}
      for(let i=0;i<fine.length;i++)if(i%16>=3)assert.equal(output.fine[i],fine[i],'fine scalar/appearance fields unchanged');
      for(let i=0;i<coarse.length;i++)if(i%8>=3)assert.equal(output.coarse[i],coarse[i],'coarse scalar/padding fields unchanged');
      assert.deepEqual(errors,[]);
      report.cases.push({name:c.name,cells:c.grid.cells.length,faces:c.grid.faces.length,gatherErrors,scatterErrors,nonVelocityFieldsExact:true});
    }finally{bridge.destroy();assert.throws(()=>bridge.encodeScatter(device.createCommandEncoder()),/destroyed/);for(const b of owned)b.destroy();}
  }
  report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
