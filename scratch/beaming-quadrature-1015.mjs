import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
const [out,store,origin,sceneFile='volumetric-cube-playground.kaminos.json']=process.argv.slice(2);
if(!out||!store||!origin)throw Error('explicit out, copied store and origin required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'identity',repoRoot:process.cwd(),origin,store,sceneFile,errors:[],claim:'held-source visual quadrature comparison; not GPU performance or temporal-flicker acceptance'};
const write=()=>fs.writeFile(out+'/quadrature.json',JSON.stringify(report,null,2));await write();let context,page;
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.modules={};
 for(const file of ['scene-hybrid-radiance.mjs','fire-light-field-shadow.mjs','fire-shadow-filter.mjs','fire-source-quadrature.mjs','experiments/fire-shadow-sampling.experiment.mjs']){
  const bytes=await fs.readFile(file),served=Buffer.from(await(await fetch(origin+'/'+file)).arrayBuffer());assert.deepEqual(bytes,served);report.modules[file]=createHash('sha256').update(bytes).digest('hex');
 }
 report.inputHash=createHash('sha256').update(await fs.readFile(store+'/scenes/'+sceneFile)).digest('hex');
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE||'playwright');
 report.executable='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 report.profile=out+'/browser-profile';
 context=await chromium.launchPersistentContext(report.profile,{executablePath:report.executable,headless:true,viewport:{width:1500,height:1050},deviceScaleFactor:1,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 page.on('pageerror',e=>report.errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&!m.text().startsWith('Failed to load resource:'))report.errors.push(m.text());});
 await page.addInitScript(()=>{
  if(location.protocol==='about:')return;
  window.__quadratureShaders=[];
  const original=GPUDevice.prototype.createShaderModule;
  GPUDevice.prototype.createShaderModule=function(descriptor){window.__quadratureShaders.push({label:descriptor.label,code:descriptor.code});return original.call(this,descriptor);};
 });
 const hdr=await fs.readFile('/Users/noahlyons/.local/state/kaminos/modal-scene-solids-1013/evidence/studio_small_09_1k.hdr');
 report.hdrHash=createHash('sha256').update(hdr).digest('hex');
 await page.route('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',r=>r.fulfill({status:200,contentType:'application/octet-stream',body:hdr,headers:{'Access-Control-Allow-Origin':'*'}}));
 const owner={id:'fire-shadow-sampling',inputsText:JSON.stringify({sampling:'complementary',points:2,pointSampling:'all'})};
 const settle=async(points,pointSampling)=>{
  await page.waitForFunction(async({points,pointSampling})=>{
   const l=window.__kaminosSceneRadiance,v=window.__kaminosVolumePrototype,s=l?.debugState();
   const error=window.__kaminosSceneRadianceSetup?.error||s?.error||v?.debugState().error||window.kaminosWorkbenchExperimentError||window.kaminosWorkbenchSceneFrameError;if(error)throw Error(error);
   return l?.canRender()&&s.pointCount===points&&s.pointSampling===pointSampling&&s.frame?.pointRegions?.count===points&&window.kaminosWorkbenchExperiments?.state().id==='fire-shadow-sampling';
  },{points,pointSampling});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.deepEqual(report.errors,[]);
 };
 const observe=async()=>{
  // Admission and observation belong to the same document, not two separate
  // evaluations on opposite sides of the preset trampoline navigation.
  const handle=await page.waitForFunction(async()=>{
   const lighting=window.__kaminosSceneRadiance,volume=window.__kaminosVolumePrototype,owner=window.kaminosWorkbenchExperiments;
   if(!lighting?.canRender()||!volume||owner?.state().id!=='fire-shadow-sampling')return false;
   return {lighting:lighting.debugState(),volume:volume.debugState(),camera:window.kaminosCameraDebugState(),owner:await owner.read(),url:location.href};
  });try{return await handle.jsonValue();}finally{await handle.dispose();}
 };
 report.phase='workbench-open';report.visual=await visualWork({page,origin,repoRoot:process.cwd(),sceneStore:store+'/scenes',basinStore:store+'/basins',sceneFile,workspace:'workbench',owner,out,exercise:async({retain})=>{
  await settle(2,'all');report.loaded=await observe();assert.equal(report.loaded.volume.backend,'WebGPU:apple');
  report.phase='hold-source';await write();
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=400);
  report.pause=await page.evaluate(()=>{window.setGizmoMode(null);return window.__kaminosVolumePrototype.setSimulationPaused(true);});
  const before=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
  const raw=Buffer.from(new Float32Array(before.values).buffer);await fs.writeFile(out+'/held-source.f32',raw);report.heldSource={...before,values:undefined,sha256:createHash('sha256').update(raw).digest('hex')};
  report.phase='mode-comparison';report.modes=[];await write();
  for(const [points,pointSampling]of [[2,'all'],[4,'all'],[4,'paired'],[4,'all'],[2,'all']]){
   await page.locator('select[aria-label="Flame lighting sources"]').selectOption(pointSampling==='paired'?'4-paired':String(points));
   await settle(points,pointSampling);
   const row=await observe();row.regions=await page.evaluate(()=>window.__kaminosSceneRadiance.readPointRegions());
   assert.equal(row.volume.simStepCount,report.pause.simStepCount);assert.equal(row.lighting.shadows.length,points);
   assert.equal(row.lighting.evaluatedPointCount,pointSampling==='paired'?2:points);assert.equal(row.lighting.capturedPointCount,points);
   assert(row.lighting.shadows.every(s=>s.effective));
   row.image=`mode-${report.modes.length}-${points}-${pointSampling}.png`;await page.screenshot({path:out+'/'+row.image});
   report.modes.push(row);await write();
  }
  const energy=row=>row.regions.regions.reduce((sum,r)=>sum.map((v,i)=>v+r.energy[i]),[0,0,0]);
  const control=energy(report.modes[0]);for(const row of report.modes)energy(row).forEach((v,i)=>assert(Math.abs(v-control[i])<1e-4*Math.max(1,Math.abs(control[i]))));
  assert.deepEqual(report.modes[0].regions.regions,report.modes[4].regions.regions);
  assert.deepEqual(report.modes[1].regions.regions,report.modes[2].regions.regions);
  const after=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());assert.deepEqual(after.values,before.values);
  await fs.writeFile(out+'/held-source-after.f32',Buffer.from(new Float32Array(after.values).buffer));
  report.phase='persist-paired';await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setQuadrature',{points:4,pointSampling:'paired'}));await settle(4,'paired');
  report.shaders=await page.evaluate(()=>window.__quadratureShaders);await fs.writeFile(out+'/shaders.json',JSON.stringify(report.shaders,null,2));report.shaders={path:out+'/shaders.json',count:report.shaders.length};
  const savedOwner=await page.evaluate(async()=>{const {readOwnerExperimentAddress}=await import('/owner-experiment-entry.mjs');return readOwnerExperimentAddress(location);});
  assert.equal(JSON.parse(savedOwner.inputsText).pointSampling,'paired');
  const saved=await retain({name:'quadrature-paired',owner:savedOwner,observe});report.saved={filename:saved.filename,url:saved.url};await write();
  report.phase='cold-reopen';await page.goto('about:blank');await page.goto(saved.url);
  // The preset trampoline can briefly expose a valid old mount before its
  // scene navigation. Wait for actual scene admission before owner admission.
  await page.waitForFunction(()=>/^(Scene loaded|Volume scene loaded)/.test(document.getElementById('info-bar')?.textContent||''));
  await settle(4,'paired');report.reopened=await observe();await page.screenshot({path:out+'/reopened.png'});
  return report.saved;
 }});
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};process.exitCode=1;if(page){report.last=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance?.debugState(),info:document.getElementById('info-bar')?.textContent})).catch(()=>null);await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.message,saved:report.saved}));}
