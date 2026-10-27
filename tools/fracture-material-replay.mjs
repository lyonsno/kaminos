import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {assertWholeObjectAtRest} from './fracture-whole-response-contract.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const vector=value=>Array.isArray(value)?[...value]:['x','y','z'].map(k=>value[k]);
export function materialFixture(report,config={}){
 const m=report.initial?.material;
 if(m?.backend!=='webgpu-avbd'||!report.sourceDigest||!report.commit)throw new Error('Replay needs an observed WebGPU material report with source identity');
 if(m.hand||m.broken||m.bonds.some(b=>!b.alive))throw new Error('Replay needs the intact ungrabbed material');
 const effective={...m.config,...config};
 if(config.elasticModulus!==undefined&&(!(config.elasticModulus>0)||!Number.isFinite(config.elasticModulus)||!(m.config.elasticModulus>0)))throw new Error('Replay needs a positive finite modulus and an elastic source');
 const scale=config.elasticModulus===undefined?1:config.elasticModulus/m.config.elasticModulus;
 return {cells:m.bodies.map(b=>({...b,position:vector(b.rest),halfExtents:[...b.halfExtents]})),
  config:effective,dimensions:{...m.dimensions},floorY:m.floorY,
  bonds:m.bonds.map(b=>({...b,normal:vector(b.normal),anchorA:vector(b.anchorA),anchorB:vector(b.anchorB),linearStiffness:b.linearStiffness*scale,rotationalStiffness:b.rotationalStiffness===undefined?undefined:b.rotationalStiffness*scale}))};
}

export async function runReplay([url,sourcePath,out,optionsPath]){
 fs.mkdirSync(out,{recursive:true});
 const result={status:'running',phase:'input',url,sourcePath,optionsPath,root:process.cwd(),cases:[],errors:[],console:[]};
 const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(result,null,2));save();let context;
 try{
  const sourceBytes=fs.readFileSync(sourcePath),source=JSON.parse(sourceBytes),options=JSON.parse(fs.readFileSync(optionsPath));
  result.sourceReportSha256=hash(sourceBytes);result.sourceAssetSha256=source.sourceDigest;result.sourceCommit=source.commit;result.commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();result.dirty=execFileSync('git',['status','--short'],{encoding:'utf8'});result.harnessSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url)));result.options=options;
  if(!Array.isArray(options.cases)||!options.cases.length)throw new Error('Replay needs explicit cases');
  for(const c of options.cases)if(!c.name||!Number.isInteger(c.steps)||c.steps<1)throw new Error('Each case needs a name and positive integer physical-step count');
  const {chromium}=await import('/Users/noahlyons/.local/state/sammy-kaminos-masks-0922/browser-tools/node_modules/playwright/index.mjs');
  result.executable='/Users/noahlyons/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';result.phase='browser';save();
  context=await chromium.launchPersistentContext(path.join(out,'browser-profile'),{headless:true,executablePath:result.executable,viewport:{width:800,height:600},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal']});context.setDefaultTimeout(0);context.setDefaultNavigationTimeout(0);
  const page=context.pages()[0];page.on('pageerror',e=>{result.errors.push(e.stack);save();});page.on('console',m=>{result.console.push({type:m.type(),text:m.text()});save();});
  const importMap=fs.readFileSync('index.html','utf8').match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];
  if(!importMap)throw new Error('Replay needs the application import map');
  result.importMapSha256=hash(importMap);
  await page.route('**/__fracture_material_replay.html',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><title>Material graph replay</title><script type="importmap">'+importMap+'</script><canvas></canvas>'}));
  await page.goto(new URL('/__fracture_material_replay.html',url).href);
  result.runtime=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());
  if(result.runtime.source?.commit!==result.commit||result.runtime.source?.dirty)throw new Error('Replay server must serve the exact clean harness checkout revision');
  result.modules={};
  for(const name of ['fracture-coarse-dynamics.mjs','fracture-coarse-kernels.mjs','lib/fracture/rigid-engine.js']){
   const response=await page.request.get(new URL(name,url).href);if(!response.ok())throw new Error('Replay module fetch failed: '+name);
   const digest=hash(await response.body());if(digest!==hash(fs.readFileSync(name)))throw new Error('Replay module source mismatch: '+name);result.modules[name]=digest;
  }
  result.device=await page.evaluate(async()=>{
   const {WebGPURenderer}=await import('/lib/three.webgpu.js'),{requestKaminosSharedWebGpuDevice}=await import('/volume-core.js');
   window.replayGpu=await requestKaminosSharedWebGpuDevice();window.replayGpuErrors=[];window.replayGpu.device.addEventListener('uncapturederror',e=>window.replayGpuErrors.push(e.error.message));
   window.replayRenderer=new WebGPURenderer({canvas:document.querySelector('canvas'),device:window.replayGpu.device});window.replayRenderer.setSize(16,16);await window.replayRenderer.init();
   const a=window.replayGpu.adapter,info=a.info;return {route:'kaminos-shared-webgpu-device',vendor:info?.vendor,architecture:info?.architecture,device:info?.device,description:info?.description,isFallbackAdapter:info?.isFallbackAdapter??a.isFallbackAdapter,storageBindings:window.replayGpu.device.limits.maxStorageBuffersPerShaderStage};
  });save();
  if(result.device.isFallbackAdapter!==false||/swiftshader|llvmpipe|software/i.test(result.device.description??''))throw new Error('Replay requires an observed native GPU adapter');
  result.phase='physical-replay';save();
  for(const c of options.cases){
   const fixture=materialFixture(source,c.config??{});const record={name:c.name,config:fixture.config,steps:c.steps,states:[]};result.cases.push(record);save();
   await page.evaluate(async fixture=>{const {createCoarseFractureDynamics}=await import('/fracture-coarse-dynamics.mjs');window.replayMaterial=await createCoarseFractureDynamics(fixture,window.replayRenderer);},fixture);
   record.initial=await page.evaluate(()=>window.replayMaterial.snapshot());if(c.diagnostics)record.initial.solver=await page.evaluate(()=>window.replayMaterial.readSolverDiagnostics());save();
   for(let step=0;step<c.steps;step++){await page.evaluate(()=>window.replayMaterial.step());const state=await page.evaluate(()=>window.replayMaterial.snapshot());if(c.diagnostics)state.solver=await page.evaluate(()=>window.replayMaterial.readSolverDiagnostics());record.states.push(state);save();}
   const last=record.states.at(-1);try{record.unloaded={status:'passed',...assertWholeObjectAtRest({initial:{material:record.initial},unloaded:{material:last}})};}catch(error){record.unloaded={status:'failed',error:error.message};}
   await page.evaluate(()=>{window.replayMaterial.dispose();window.replayMaterial=null;});save();
  }
  if(result.errors.length)throw new Error('Replay page errors');
  result.gpuErrors=await page.evaluate(()=>window.replayGpuErrors);if(result.gpuErrors.length)throw new Error('Replay GPU validation failed');
  await page.evaluate(()=>{window.replayRenderer.dispose();window.replayGpu.device.destroy();});result.status='completed';result.phase='completed';result.claim='Observed graph replay and unchanged unloaded verdicts; no original-surface or direct-pointer acceptance';
 }catch(error){result.status='failed';result.error=error.stack;fs.writeFileSync(path.join(out,'failure.json'),JSON.stringify(result,null,2));process.exitCode=1;}
 finally{if(context){try{result.gpuErrors=await context.pages()[0]?.evaluate(()=>window.replayGpuErrors??[]);}catch{}await context.close();}save();}
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runReplay(process.argv.slice(2));
