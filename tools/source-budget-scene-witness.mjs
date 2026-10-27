import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
const [out,origin,sceneFile]=process.argv.slice(2);assert(out&&origin&&sceneFile);
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',origin,sceneFile,repo:process.cwd(),commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--short'],{encoding:'utf8'}),executable:process.env.KAMINOS_TEST_BROWSER,errors:[],arms:[]};
const write=()=>fs.writeFile(out+'/launch.json',JSON.stringify(report,null,2));await write();let context,page;
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1100,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>report.errors.push(e.message));
 await page.exposeFunction('__gpuError',m=>report.errors.push(m));await page.addInitScript(()=>{if(!globalThis.GPUAdapter)return;const old=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...a){const d=await old.apply(this,a);d.addEventListener('uncapturederror',e=>window.__gpuError(e.error.message));return d;};});
 report.phase='scene';await write();
 report.result=await visualWork({page,origin,repoRoot:process.cwd(),sceneFile,workspace:'workbench',out,exercise:async({retain,open})=>{
  await page.waitForFunction(()=>window.__kaminosVolumePrototype?.debugState()?.simStepCount>=8&&window.__kaminosSceneRadiance?.canRender());
  report.input=await page.evaluate(()=>({volume:window.__kaminosVolumePrototype.debugState(),lighting:window.__kaminosSceneRadiance.debugState()}));
  await page.evaluate(async()=>{window.__kaminosVolumePrototype.setSimulationPaused(true);await window.kaminosSetVolumeParam('volume_ray_steps',8);window.__kaminosSceneRadiance.setGain(1);});
  const held=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().simStepCount);
  for(const [count,blockerSamples,filterSamples,edge] of [[4,3,3,false],[6,2,2,false],[6,2,2,true],[8,2,2,true]]){
   report.phase=`sources-${count}-edge-${edge}`;await write();
   await page.evaluate(async({count,blockerSamples,filterSamples,edge})=>{const r=window.__kaminosSceneRadiance;r.setQuadrature(count,'all');r.setShadowQuality({blockerSamples,filterSamples});r.setShadowEdgeFilter(edge);await r.retryRebuild();},{count,blockerSamples,filterSamples,edge});
   await page.waitForFunction(()=>{const r=window.__kaminosSceneRadiance,s=r.debugState();if(s.error)throw Error(s.error);return r.canRender();});
   const state=await page.evaluate(async()=>({lighting:window.__kaminosSceneRadiance.debugState(),points:await window.__kaminosSceneRadiance.readPointRegions(),volume:window.__kaminosVolumePrototype.debugState()}));
   assert.equal(state.lighting.pointCount,count);assert.equal(state.lighting.capturedPointCount,count);assert.equal(state.lighting.evaluatedPointCount,count);assert.equal(state.points.regions.length,count);assert.equal(state.points.partition,'spatial');assert.equal(state.lighting.shadowEdgeFilter,edge);assert.equal(state.volume.simStepCount,held);
   assert.equal(state.volume.controls.raySteps,8);assert(state.lighting.shadows.every(s=>s.effective&&s.shadowEdgeFilter===edge));
   report.arms.push({count,blockerSamples,filterSamples,edge,state});await page.screenshot({path:`${out}/sources-${count}-edge-${edge}.png`});await write();
  }
  // Actual ordinary inspector controls, then save and cold reopen.
  const choices=await page.locator('[aria-label="Flame lighting sources"] option').evaluateAll(es=>es.map(e=>e.value));assert(choices.includes('6')&&choices.includes('8'));
  const toggle=page.locator('[aria-label="Smooth solid shadow texels"]');assert.equal(await toggle.count(),1);
  const saved=await retain({name:'six-source-corridor',capture:false});report.saved=saved;await open(saved.filename);
  await page.waitForFunction(()=>window.__kaminosSceneRadiance?.canRender());
  report.reopened=await page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),objects:window.kaminosSceneObjectDebugState()}));
  assert.equal(report.reopened.lighting.pointCount,8);assert.equal(report.reopened.lighting.shadowEdgeFilter,true);assert.equal(report.reopened.objects.filter(o=>o.type==='flame-emitter').length,2);
  assert.deepEqual(report.errors,[]);return {url:saved.url,claim:'real saved two-brazier scene exercises 4/6/8 current cubemaps, optional comparison filter and cold reopen; no timing or motion-quality verdict'};
 }});report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,errors:report.errors}));}
