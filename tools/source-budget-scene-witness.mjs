import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
const [out,origin,sceneFile,mode]=process.argv.slice(2);assert(out&&origin&&sceneFile);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',origin,sceneFile,mode:mode??'comparison',repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}),executable:process.env.KAMINOS_TEST_BROWSER,errors:[],arms:[]};
const write=()=>fs.writeFile(out+'/launch.json',JSON.stringify(report,null,2));await write();let context,page;
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1100,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];page.setDefaultTimeout(0);
 const diagnostic=setInterval(async()=>{try{report.last=await page.evaluate(()=>({url:location.href,info:document.getElementById('info-bar')?.textContent,volume:window.__kaminosVolumePrototype?.debugState(),lighting:window.__kaminosSceneRadiance?.debugState()}));await write();}catch{}},15000);diagnostic.unref();page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.exposeFunction('__gpuError',m=>report.errors.push(m));await page.addInitScript(()=>{if(!globalThis.GPUAdapter)return;const old=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...a){const d=await old.apply(this,a);d.addEventListener('uncapturederror',e=>window.__gpuError(e.error.message));return d;};});
 report.phase='scene';await write();
 report.result=await visualWork({page,origin,repoRoot:process.cwd(),sceneFile,workspace:'workbench',out,exercise:async({retain,open})=>{
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState()?.simStepCount>=120&&window.__kaminosSceneRadiance?.canRender());
  report.input=await page.evaluate(()=>({volume:window.__kaminosVolumePrototype.debugState(),lighting:window.__kaminosSceneRadiance.debugState()}));
  await page.evaluate(async()=>{window.__kaminosVolumePrototype.setSimulationPaused(true);window.__kaminosSceneRadiance.setGain(1);});
  const held=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);
  for(const [count,blockerSamples,filterSamples,edge] of (mode==='controls-only'?[]:[[4,3,3,false],[6,2,2,false],[6,2,2,true],[8,2,2,true]])){
   report.phase=`sources-${count}-edge-${edge}`;await write();
   await page.evaluate(async({count,blockerSamples,filterSamples,edge})=>{const r=window.__kaminosSceneRadiance;r.setQuadrature(count,'all');r.setShadowQuality({blockerSamples,filterSamples});r.setShadowEdgeFilter(edge);await r.whenRebuilt();},{count,blockerSamples,filterSamples,edge});
   await page.waitForFunction(()=>{const r=window.__kaminosSceneRadiance,s=r.debugState();if(s.error)throw Error(s.error);return r.canRender();});
   const state=await page.evaluate(async()=>({lighting:window.__kaminosSceneRadiance.debugState(),points:await window.__kaminosSceneRadiance.readPointRegions(),volume:window.__kaminosVolumePrototype.debugState()}));
   assert.equal(state.lighting.pointCount,count);assert.equal(state.lighting.capturedPointCount,count);assert.equal(state.lighting.evaluatedPointCount,count);assert.equal(state.points.regions.length,count);assert.equal(state.points.partition,'spatial');assert.equal(state.lighting.shadowEdgeFilter,edge);assert.equal(state.volume.simStepCount,held);
   assert.equal(state.volume.controls.raySteps,8);assert(state.lighting.shadows.every(s=>s.effective&&s.shadowEdgeFilter===edge));
   report.arms.push({count,blockerSamples,filterSamples,edge,state});await page.screenshot({path:`${out}/sources-${count}-edge-${edge}.png`});await write();
  }
  // Actual ordinary inspector controls, then save and cold reopen.
  const choices=await page.locator('[aria-label="Flame lighting sources"] option').evaluateAll(es=>es.map(e=>e.value));assert(choices.includes('6')&&choices.includes('8'));
  const toggle=page.locator('[aria-label="Smooth solid shadow texels"]');assert.equal(await toggle.count(),1);
  await page.locator('[aria-label="Flame lighting sources"]').evaluate(el=>{el.value='6';el.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.evaluate(()=>window.__kaminosSceneRadiance.whenRebuilt());await page.waitForFunction(()=>window.__kaminosSceneRadiance.canRender());
  assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().pointCount),6);
  for(const checked of [false,true]){await toggle.evaluate((el,checked)=>{el.checked=checked;el.dispatchEvent(new Event('change',{bubbles:true}));},checked);assert.equal(await page.evaluate(()=>window.__kaminosSceneRadiance.debugState().shadowEdgeFilter),checked);}
  await page.screenshot({path:out+'/six-source-offer.png'});
  const saved=await retain({name:'six-source-corridor',capture:false});report.saved=saved;await open(saved.filename);
  await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender());
  report.reopened=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),objects:window.kaminosSceneObjectDebugState()}));
  assert.equal(report.reopened.lighting.pointCount,6);assert.equal(report.reopened.lighting.shadowEdgeFilter,true);assert.equal(report.reopened.objects.filter(o=>o.type==='flame-emitter').length,2);
  assert.deepEqual(report.errors,[]);return {url:saved.url,claim:'saved-scene control and runtime exercise; exercised counts are recorded in arms and reopened state; no timing or motion-quality verdict'};
 }});report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,errors:report.errors}));}
