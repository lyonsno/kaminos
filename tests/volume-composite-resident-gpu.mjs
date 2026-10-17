// kaminos-test: manual — native Metal conformance, not a timing or flame witness
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createCompositeGrid,projectComposite} from '../volume-composite-grid.mjs';
import {createCompositePCGGPU} from '../volume-composite-pcg-gpu.mjs';
const [dawnPath,out]=process.argv.slice(2);assert(dawnPath&&out);mkdirSync(out,{recursive:true});
const report={passed:false,phase:'adapter',cases:[],source:{revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),files:Object.fromEntries(['volume-composite-solids-gpu.mjs','volume-composite-pcg-gpu.mjs','tests/volume-composite-resident-gpu.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex')]))}};
let gpu,device;const resources=[];
const save=()=>writeFileSync(resolve(out,'report.json'),JSON.stringify(report,null,2));save();
try{
  const {create,globals}=await import(pathToFileURL(resolve(dawnPath)));Object.assign(globalThis,globals);
  gpu=create(['backend=metal']);const adapter=await gpu.requestAdapter();assert(adapter);device=await adapter.requestDevice();
  report.route={backend:'metal',vendor:adapter.info.vendor,architecture:adapter.info.architecture,liveFlame:false,solidContract:'Sinter92359a8c9 scene-solid-gpu.mjs r32uint sampled 3d occupancy',dawnPath};
  const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const geometry={shape:[4,4,4],cellWidth:1,fine:{min:[1,1,1],max:[3,3,3],ratio:2}};
  const grid=createCompositeGrid(geometry),idx=q=>q[0]+4*(q[1]+4*q[2]);
  const texture=()=>{const t=device.createTexture({size:[4,4,4],dimension:'3d',format:'r32uint',usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST});resources.push(t);return t;};
  const fine=texture(),coarse=texture(),fineMask=new Uint32Array(64),coarseMask=new Uint32Array(64);
  const upload=()=>{for(const [t,v] of [[fine,fineMask],[coarse,coarseMask]])device.queue.writeTexture({texture:t},v,{bytesPerRow:16,rowsPerImage:4},[4,4,4]);};
  const solvers=[false,true].map(uniformCounts=>{const s=createCompositePCGGPU(device,grid,{tolerance:1e-5,residentSolids:true,uniformCounts});resources.push(s);s.bindSolids({fine,coarse});return s;});
  report.phase='compile';save();for(const s of solvers)for(const shader of s.shaders)assert.deepEqual((await shader.getCompilationInfo()).messages.filter(m=>m.type==='error'),[]);
  const faceKey=f=>JSON.stringify([f.center,f.axis,f.area,f.side]);
  for(let pose=0;pose<3;pose++){
    report.phase='pose-'+pose;save();fineMask.fill(0);coarseMask.fill(0);
    if(pose===1){fineMask[21]=1;coarseMask[0]=1;} // close, then reopen the same slots
    upload();
    const solid=p=>{const inner=p.every(v=>v>=1&&v<3),q=p.map(v=>Math.round((v-(inner?1:0))/(inner?.5:1)-.5));return (inner?fineMask:coarseMask)[idx(q)]!==0;};
    const compact=createCompositeGrid({...geometry,solid});
    const velocity=f=>f.axis===1&&f.b>=0?.01*f.area:0;
    const target=c=>c.level===1?.001:0;
    const ref=projectComposite(compact,Float32Array.from(compact.faces,velocity),{target:Float32Array.from(compact.cells,target),tolerance:1e-9});assert(ref.converged);
    const expected=new Map(compact.faces.map((f,i)=>[faceKey(f),ref.flux[i]]));
    for(let variant=0;variant<solvers.length;variant++){
      const s=solvers[variant];s.setInput(Float32Array.from(grid.faces,velocity),Float32Array.from(grid.cells,target));
      const e=device.createCommandEncoder();s.encode(e,{iterations:128,reset:pose===0});device.queue.submit([e.finish()]);
      const r=await s.readback();assert(r.converged,JSON.stringify(r.receipt));
      let error=0;grid.faces.forEach((f,i)=>{const v=expected.get(faceKey(f));if(v===undefined)assert.equal(r.flux[i],0,'solid faces must be exactly closed');else error=Math.max(error,Math.abs(v-r.flux[i]));});
      assert(error<2e-6,`compact reference flux error ${error}`);
      grid.cells.forEach((c,i)=>{if(solid(c.center)){assert.equal(r.pressure[i],0);assert.equal(r.target[i],0);}});
      for(const [name,v] of Object.entries({pressure:r.pressure,flux:r.flux,target:r.target}))writeFileSync(resolve(out,`pose-${pose}-variant-${variant}-${name}.f32`),new Uint8Array(v.buffer));
      report.cases.push({pose,uniformCounts:Boolean(variant),error,receipt:r.receipt});save();
    }
  }
  report.phase='refusal';assert.throws(()=>solvers[0].bindSolids({fine:null,coarse}),/r32uint/);
  // A zero dispatch budget cannot masquerade as a successful solve.
  solvers[0].setInput(Float32Array.from(grid.faces,f=>f.axis===1?.2*f.area:0));
  const e=device.createCommandEncoder();solvers[0].encode(e,{iterations:0,reset:true});device.queue.submit([e.finish()]);assert.equal((await solvers[0].readback()).converged,false);
  await device.queue.onSubmittedWorkDone();assert.deepEqual(errors,[]);report.phase='complete';report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{if(device)await device.queue.onSubmittedWorkDone().catch(()=>{});for(const r of resources)r.destroy();device?.destroy();save();console.log(JSON.stringify(report));}
