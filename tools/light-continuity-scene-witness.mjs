import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
const [out,repo,origin,sceneFile]=process.argv.slice(2);
assert(out&&repo&&origin&&sceneFile,'output, source root, runtime URL, saved scene required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'launch',repo,origin,sceneFile,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),errors:[]};
const write=()=>fs.writeFile(out+'/launch.json',JSON.stringify(report,null,2));await write();let context,page;
try{
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 report.executable=process.env.KAMINOS_TEST_BROWSER;
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1200,height:900},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];page.setDefaultTimeout(0);
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text()+' '+JSON.stringify(m.location()));});
 await page.exposeFunction('__gpuError',m=>report.errors.push(m));await page.addInitScript(()=>{const old=GPUAdapter.prototype.requestDevice;GPUAdapter.prototype.requestDevice=async function(...a){const d=await old.apply(this,a);d.addEventListener('uncapturederror',e=>window.__gpuError(e.error.message));return d;};});
 report.phase='scene';await write();
 report.result=await visualWork({page,origin,repoRoot:repo,sceneFile,workspace:'workbench',out,exercise:async()=>{
  const settings=await page.evaluate(()=>window.__kaminosVolumePrototype.debugState().controls);
  assert.equal(settings.resolution,32,'implementation witness must use its recorded32-cell simulation');assert.equal(settings.raySteps,8,'implementation witness camera ray budget');
  await page.waitForFunction(()=>{const v=window.__kaminosVolumePrototype?.debugState(),s=window.__kaminosSceneRadiance?.debugState();if(v?.error||s?.error)throw Error(v?.error||s?.error);return v?.simStepCount>=120&&window.__kaminosSceneRadiance?.canRender();});
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
  const observe=()=>page.evaluate(()=>({lighting:window.__kaminosSceneRadiance.debugState(),volume:window.__kaminosVolumePrototype.debugState(),objects:window.kaminosSceneObjectDebugState()}));
  report.held=await observe();assert.equal(report.held.lighting.frame.pointRegions.partition,'spatial');assert.equal(report.held.lighting.frame.smokeReconstruction.identity,'prepared-clear-box-support-v3');
  report.points=await page.evaluate(()=>window.__kaminosSceneRadiance.readPointRegions());
  await page.screenshot({path:out+'/held.png'});await write();
  await page.evaluate(()=>{window.__kaminosSceneRadiance.setGain(4);window.__kaminosSceneRadiance.setSourceSoftness(0);});
  const frame=report.held.volume.frameCount;await page.waitForFunction(f=>window.__kaminosVolumePrototype.debugState().frameCount>f+3,frame);
  report.bright=await observe();await page.screenshot({path:out+'/bright.png'});await write();
  assert.equal(report.bright.volume.simStepCount,report.held.volume.simStepCount);
  assert.deepEqual(report.errors,[]);return {url:page.url(),claim:'held real-scene candidate exercise; no matched before/after simulation or cost claim'};
 }});report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure=String(e.stack||e);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,errors:report.errors}));}
