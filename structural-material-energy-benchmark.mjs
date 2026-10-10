import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {serialize} from 'node:v8';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {splitMaterialInterior} from './structural-material-interior-cut.mjs';
import {prepareSeparatedTopology,packSolidTopology} from './structural-material-solid-topology.mjs';
const [out,executable,playwright,url,bodyPath,planesPath]=process.argv.slice(2);
fs.mkdirSync(out,{recursive:true});
const report={status:'running',phase:'setup',runs:[],errors:[],claim:'Same-law paired native solve timing; not complete frame or cut latency closure'},hash=b=>createHash('sha256').update(b).digest('hex'),save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));
save();let browser,page;
try{
 const root=process.cwd(),effective=fs.realpathSync(executable);
 assert.ok(effective.endsWith('/chrome-headless-shell')&&!effective.includes('/Google Chrome.app/'));
 report.revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.browser={executable:effective,version:execFileSync(effective,['--version'],{encoding:'utf8'}).trim()};
 report.sources=Object.fromEntries(['structural-material-solid-resident.js','structural-material-solid-topology.mjs','structural-material-solid-reference.mjs','structural-material-interior-cut.mjs'].map(name=>[name,hash(fs.readFileSync(name))]));
 report.inputs=[bodyPath,planesPath].map(filename=>({filename,sha256:hash(fs.readFileSync(filename))}));
 const body=JSON.parse(fs.readFileSync(bodyPath)),planes=JSON.parse(fs.readFileSync(planesPath)).planes;
 let mesh={positions:body.positions,tetrahedra:body.tetrahedra,domains:body.tetrahedra.map(()=>0)},fields={positions:body.positions,velocities:body.positions.map(()=>[0,0,0]),pinned:body.positions.map(()=>false)};
 const meshes=[{name:'intact',mesh}];for(const plane of planes){const cut=splitMaterialInterior(mesh,fields,plane);mesh=cut.mesh;fields=cut.fields;}
 meshes.push({name:'three-cuts',mesh});
 const {chromium}=await import(pathToFileURL(playwright));browser=await chromium.launch({executablePath:effective,headless:true,args:['--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});page=await browser.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));
 const benchmarkUrl=new URL('__material_energy_benchmark',url).href;
 await page.route(benchmarkUrl,route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Material energy benchmark fixture</title>'}));
 await page.goto(benchmarkUrl,{waitUntil:'load',timeout:0});
 report.effectiveUrl=page.url();report.pageMode='same-origin synthetic benchmark fixture; no visual consumer';assert.equal(report.effectiveUrl,benchmarkUrl);
 report.phase='source-admission';save();
 const source=await page.evaluate(async names=>Object.fromEntries(await Promise.all(names.map(async name=>{const r=await fetch(name,{cache:'no-store'});if(!r.ok)throw new Error(`Source HTTP ${r.status}`);const bytes=await r.arrayBuffer(),digest=await crypto.subtle.digest('SHA-256',bytes);return[name,Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('')];}))),Object.keys(report.sources));
 assert.deepEqual(source,report.sources);report.loadedSources=source;
 for(const fixture of meshes){
  const model=prepareSeparatedTopology({...fixture.mesh,status:'passed',route:'kaminos.conservative-interior-plane-cut.v0',volume:body.volume??.80318624058225},{young:100000,poisson:.25,density:1000,volumeBarrier:40000}),arrays=packSolidTopology(model);
  const min=Math.min(...model.positions.map(p=>p[0]));model.positions.forEach((p,i)=>{if(p[0]<min+.035)arrays.state[i*16+11]=1;});
  const descriptor={kind:'graph',points:model.positions.length,elements:model.elements.length,bonds:model.bonds.length,colorCount:model.colorCount,bufferLayout:model.bufferLayout,constitutiveLayout:model.constitutiveLayout,volumeBarrier:40000};
  const packed=Object.fromEntries(Object.entries(arrays).map(([name,value])=>[name,{type:value.constructor.name,data:Array.from(value)}]));
  report.phase=fixture.name;save();
  const result=await page.evaluate(async({descriptor,packed})=>{
   const {createSolidResident}=await import('./structural-material-solid-resident.js'),adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
   if(!adapter||adapter.info.isFallbackAdapter)throw new Error('Native WebGPU adapter required');const device=await adapter.requestDevice();const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
   const arrays=Object.fromEntries(Object.entries(packed).map(([name,value])=>[name,new (value.type==='Float32Array'?Float32Array:Uint32Array)(value.data)])),settings={iterations:12,lineSearchTrials:8,timeStep:1/60,gravity:0,damping:.98,floor:-10},runs=[];
   try{
    for(const requested of ['dense-reference','auto','auto','dense-reference']){
     const resident=await createSolidResident(device,descriptor,arrays,{energyKernel:requested});
     try{
      const free=Array.from({length:descriptor.points},(_,i)=>i).filter(i=>arrays.state[i*16+11]===0),contact=free.reduce((a,b)=>arrays.state[a*16+4]>arrays.state[b*16+4]?a:b);
      await resident.capturePatch([{index:contact,weight:1}],200000);await resident.movePatch([0,.03,.005]);
      const initial=await resident.read(),timings=[];for(let step=0;step<30;step++)timings.push(await resident.step(settings));
      runs.push({requested,effective:initial.energyKernel,initial,final:await resident.read(),timings,settings,contact});
     }finally{resident.dispose();}
    }
    return{adapter:{vendor:adapter.info.vendor,description:adapter.info.description,isFallbackAdapter:adapter.info.isFallbackAdapter},runs,errors};
   }finally{device.destroy();}
  },{descriptor,packed});
  assert.deepEqual(result.errors,[]);assert.equal(result.adapter.isFallbackAdapter,false);
  for(const run of result.runs)assert.equal(run.effective,run.requested==='auto'?'isotropic-intact-v1':'dense-reference');
  const raw=path.join(out,`${fixture.name}.v8`);fs.writeFileSync(raw,serialize(result));
  const differences=(a,b)=>({absolute:Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),relative:Math.max(...a.map((v,i)=>Math.abs(v-b[i])/(1+Math.abs(v))))});
  const initialParity=differences(result.runs[0].initial.diagnostics,result.runs[1].initial.diagnostics),finalParity=differences(result.runs[0].final.state,result.runs[1].final.state);
  assert.ok(initialParity.relative<1e-5&&finalParity.absolute<1e-3,JSON.stringify({initialParity,finalParity}));
  const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return(sorted[(sorted.length-1)>>1]+sorted[sorted.length>>1])/2;};
  const entries=result.runs.map(run=>({requested:run.requested,effective:run.effective,medianSolveMilliseconds:median(run.timings.map(t=>t.totalMilliseconds)),timings:run.timings,settings:run.settings})),dense=median(entries.filter(r=>r.requested==='dense-reference').map(r=>r.medianSolveMilliseconds)),fast=median(entries.filter(r=>r.requested==='auto').map(r=>r.medianSolveMilliseconds));
  report.runs.push({name:fixture.name,descriptor,adapter:result.adapter,raw:{path:raw,sha256:hash(fs.readFileSync(raw))},initialParity,finalParity,entries,denseMilliseconds:dense,optimizedMilliseconds:fast,speedup:dense/fast});save();
 }
 assert.deepEqual(report.errors,[]);for(const[name,digest]of Object.entries(report.sources))assert.equal(hash(fs.readFileSync(path.join(root,name))),digest);
 report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};save();process.exitCode=1;}
finally{await browser?.close();report.ownedBrowserExited=true;save();console.log(JSON.stringify({status:report.status,runs:report.runs.map(r=>({name:r.name,speedup:r.speedup,dense:r.denseMilliseconds,optimized:r.optimizedMilliseconds})),failure:report.failure}));}
