import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createOuterSmoke,outerSmokeConfig} from '../volume-outer-smoke.mjs';

const [dawnPath,output]=process.argv.slice(2);
assert.ok(dawnPath&&output,'usage: <Dawn module> <output directory>');mkdirSync(output,{recursive:true});
const report={purpose:'area-integrated fine face momentum must survive coarse restriction',phase:'adapter',cases:[],passed:false};let device;
try{
 report.source={root:resolve(new URL('..',import.meta.url).pathname),revision:execFileSync('git',['rev-parse','HEAD'],{cwd:new URL('..',import.meta.url),encoding:'utf8'}).trim(),
  shaderHash:createHash('sha256').update(readFileSync(new URL('../volume-outer-smoke.mjs',import.meta.url))).digest('hex')};
 const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
 const gpu=create(['backend=metal']);
 globalThis.__outerFaceGPU=gpu;
 const adapter=await gpu.requestAdapter();assert.ok(adapter);report.route={backend:'metal',vendor:adapter.info.vendor,device:adapter.info.device};device=await adapter.requestDevice();
 const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const n=64,c=outerSmokeConfig({grid:32,extent:4,nearHeightRatio:1}),h=2/n;
 for(const axis of [0,1,2]){
  report.phase=`axis-${axis}`;const near=new Float32Array(n*n*n*16);
  // Thin axial jet at the origin. The coarse face center lies outside it,
  // but its face area intersects a real resolved fine-grid inlet.
  for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
   const xyz=[x,y,z],p=xyz.map(v=>(v+.5)*h-1);
   if(p.some((v,a)=>a!==axis&&Math.abs(v)>.075))continue;
   const i=(x+n*(y+n*z))*16;near[i+axis]=1;near[i+4]=1;
  }
  const b=device.createBuffer({size:near.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});device.queue.writeBuffer(b,0,near);
  const solver=createOuterSmoke(device,c,n,[b,b]);
  try{
   const e=device.createCommandEncoder();solver.encode(e,0,{dtScale:1,backtraceScale:1},0);device.queue.submit([e.finish()]);
   const v=await solver.readState();writeFileSync(resolve(output,`axis-${axis}.f32`),new Uint8Array(v.buffer));
   // Face at coordinate 0, spanning [0,.25] in the two transverse axes.
   const xyz=[16,16,16];const i=(xyz[0]+33*(xyz[1]+65*xyz[2]))*8;
   const expected=(2*h/c.cellWidth)**2*h;
   const observed=v[i+axis];report.cases.push({axis,observed,expected,smoke:v[i+4],receipt:solver.receipt()});
   assert.ok(Math.abs(observed-expected)<1e-7,`axis ${axis}: area-average momentum ${expected}, received ${observed}`);
  }finally{solver.destroy();b.destroy();}
 }
 assert.deepEqual(errors,[]);report.phase='complete';report.passed=true;
}catch(e){report.error=e.stack;process.exitCode=1;}
finally{device?.destroy();writeFileSync(resolve(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
