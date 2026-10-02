// Small actual-kernel conformance check. Caller supplies a Dawn installation;
// this is native Metal evidence, not browser composition or visual evidence.
import assert from 'node:assert/strict';
import {writeFileSync, mkdirSync, readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOuterSmoke, outerSmokeConfig} from '../volume-outer-smoke.mjs';
import {packSolidTextureRows} from '../volume-scene-solid.mjs';

const [dawnPath, output] = process.argv.slice(2);
assert.ok(dawnPath && output, 'usage: node tests/volume-outer-smoke-gpu.mjs <webgpu module> <output directory>');
mkdirSync(output,{recursive:true});
const report={schema:'outer-smoke-kernel-check-v0',phase:'adapter',passed:false,cases:[]};
let device;
try {
  report.source={root:resolve(new URL('..',import.meta.url).pathname),
    revision:execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}).trim(),
    files:Object.fromEntries(['volume-outer-smoke.mjs','volume-scene-solid.mjs','tests/volume-outer-smoke-gpu.mjs'].map(file=>
      [file,createHash('sha256').update(readFileSync(new URL(`../${file}`,import.meta.url))).digest('hex')]))};
  const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));
  Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']);
  const adapter=await gpu.requestAdapter();
  assert.ok(adapter,'native Metal adapter required');
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,
    description:adapter.info.description,device:adapter.info.device,dawnPath:resolve(dawnPath)};
  device=await adapter.requestDevice();
  const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const grid=16,c=outerSmokeConfig({grid:16,extent:2,pressureIterations:24});
  const near=new Float32Array(grid*grid*2*grid*16);
  // Constant upward near field. No exterior source and no outer buoyancy:
  // outside smoke must arrive by transport, not a prescribed rise animation.
  for(let i=0;i<near.length;i+=16){near[i+1]=1;near[i+4]=1;near[i+5]=.2;}
  const b=device.createBuffer({size:near.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
  device.queue.writeBuffer(b,0,near);
  for(const wall of [false,true]) {
    report.phase=wall?'blocked-transport':'open-transport';
    const solver=createOuterSmoke(device,c,grid,[b,b]);
    try {
      const compile=await solver.shader.getCompilationInfo();
      assert.deepEqual([...compile.messages].filter(x=>x.type==='error'),[]);
      const mask=new Uint8Array(c.shape.reduce((a,b)=>a*b,1));
      const wallY=21; // y=3.25..3.5, wholly outside the detailed domain
      if(wall)for(let z=0;z<c.grid;z++)for(let x=0;x<c.grid;x++)mask[x+c.grid*(wallY+2*c.grid*z)]=1;
      solver.setSolids(packSolidTextureRows(mask,c.grid),wall?'synthetic-exterior-ceiling':'empty');
      for(let i=0;i<48;i++){
        const encoder=device.createCommandEncoder();
        solver.encode(encoder,0,{dtScale:1,backtraceScale:1},0);
        device.queue.submit([encoder.finish()]);
      }
      const values=await solver.readState();
      assert.ok(values.every(Number.isFinite),'state must remain finite');
      assert.deepEqual(errors,[],'GPU validation must remain clean');
      let beyond=0,inWall=0,maxBlockedFlux=0;
      for(let z=0;z<c.grid;z++)for(let y=0;y<2*c.grid;y++)for(let x=0;x<c.grid;x++){
        const i=(x+(c.grid+1)*(y+(2*c.grid+1)*z))*8;
        if(y>wallY)beyond+=values[i+4];
        if(y===wallY)inWall+=values[i+4];
        if(y===wallY||y===wallY+1)maxBlockedFlux=Math.max(maxBlockedFlux,Math.abs(values[i+1]));
      }
      report.cases.push({wall,beyond,inWall,maxBlockedFlux,receipt:solver.receipt()});
      writeFileSync(resolve(output,wall?'blocked.f32':'open.f32'),new Uint8Array(values.buffer));
      if(wall){assert.equal(inWall,0);assert.equal(beyond,0);assert.equal(maxBlockedFlux,0);}
      else assert.ok(beyond>.01,`smoke must cross old top and reach y>3.5; got ${beyond}`);
    } finally {solver.destroy();}
  }
  b.destroy();report.phase='complete';report.passed=true;
} catch(error){report.error=error.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
