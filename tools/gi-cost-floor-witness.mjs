// Explicit saved-scene performance assay; submit through Greenroom.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {summarizeGiCostFrame} from './gi-cost-floor-contracts.mjs';
const [manifestPath]=process.argv.slice(2);
const manifest=JSON.parse(await fs.readFile(manifestPath,'utf8'));
const {out,repoRoot,origin,sceneFile,cases,samples,warmup,expectedCommit,executable,playwrightModule,viewport}=manifest;
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'source',requested:manifest,errors:[],consoleErrors:[],cases:[],scope:'Fresh ordinary Three scene graph; forced activity with held camera; no simulation. GPU interval span/union and submission-to-completion duration are distinct.'};
const save=()=>fs.writeFile(path.join(out,'cost-report.json'),JSON.stringify(report,null,2)+'\n');
await save();let browser,page,profile;
const source=async()=>{const files=['index.html','scene-gi.mjs','scene-gi-history.mjs','scene-lighting-filter.mjs','scene-surface-lighting.mjs','lib/addons/tsl/display/SSGINode.js','lib/addons/tsl/display/SSGISourcePyramid.js','tools/ash-pass-timer.mjs','tools/gi-cost-floor-contracts.mjs','tools/gi-cost-floor-witness.mjs'];return Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await fs.readFile(path.join(repoRoot,f))).digest('hex')])));};
try{
 assert.ok(Number.isSafeInteger(samples)&&samples>0&&Number.isSafeInteger(warmup)&&warmup>=0&&cases.length);
 report.sourceBefore=await source();report.runtime=await verifyAuthoringServer({origin,repoRoot});
 assert.equal(report.runtime.source.commit,expectedCommit);assert.equal(report.runtime.source.dirty,false);
 assert.match(executable,/Google Chrome for Testing|chromium|chrome-headless-shell/);
 const {chromium}=await import(playwrightModule);profile=await fs.mkdtemp(path.join(out,'browser-'));report.profile=profile;
 const flags=['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--use-angle=metal','--enable-webgpu-developer-features'];report.browser={executable,flags,viewport};
 browser=await chromium.launchPersistentContext(profile,{executablePath:executable,headless:true,viewport,deviceScaleFactor:1,args:flags});report.browser.version=browser.browser()?.version();page=browser.pages()[0];page.setDefaultTimeout(0);
 page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 await page.exposeFunction('__costGpuError',message=>report.errors.push(message));
 await page.addInitScript(()=>{
  const request=GPUAdapter.prototype.requestDevice;window.__costDevices=[];window.__costViews=new WeakMap();
  GPUAdapter.prototype.requestDevice=async function(...args){
   const device=await request.apply(this,args);window.__costDevices.push(device);device.addEventListener('uncapturederror',e=>window.__costGpuError(e.error.message));
   const create=device.createTexture;device.createTexture=function(descriptor){const texture=create.call(this,descriptor),view=texture.createView;texture.createView=function(desc={}){const result=view.call(this,desc);window.__costViews.set(result,{label:()=>texture.label,width:texture.width,height:texture.height,format:texture.format,mipLevels:texture.mipLevelCount,baseMipLevel:desc.baseMipLevel??0});return result;};return texture;};
   return device;
  };
 });
 report.phase='load';await save();
 report.consumer=await visualWork({page,origin,repoRoot,sceneFile,out:path.join(out,'consumer'),workspace:'authoring',exercise:async({document})=>{
  assert.equal(document.composition,null,'This assay excludes live simulation');
  await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());
  report.mounted=await page.evaluate(()=>({objects:window.kaminosSceneObjectDebugState(),arrival:window.kaminosSceneArrivalState(),backend:window.kaminosWorkbenchSceneState(),quality:window.kaminosViewportQualityState()}));assert.equal(report.mounted.backend.rendererBackend,'webgpu');
  report.device=await page.evaluate(async()=>{
   if(window.__costDevices.length!==1)throw Error('Ambiguous actual shared device');
   const d=window.__costDevices[0];if(!d.features.has('timestamp-query'))throw Error('timestamp-query unavailable');
   const create=d.createCommandEncoder;d.createCommandEncoder=function(...args){const encoder=create.apply(this,args),begin=encoder.beginRenderPass;encoder.beginRenderPass=function(desc){const attachments=desc.colorAttachments.map(a=>{if(!a)return null;const meta=window.__costViews.get(a.view);return meta?{...meta,label:meta.label()}:null;});return begin.call(this,{...desc,label:JSON.stringify({original:desc.label??null,attachments})});};return encoder;};
   window.__costRestoreEncoder=()=>{d.createCommandEncoder=create;};
   window.__costTimer=(await import('/tools/ash-pass-timer.mjs')).installAshPassTimer(d);window.__costRelease=window.__kaminosBeginSceneInspection();
   return {features:[...d.features],limits:{maxTextureDimension2D:d.limits.maxTextureDimension2D},adapter:window.kaminosWorkbenchSceneState().adapter};
  });await save();
  const draw=()=>page.evaluate(async()=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   window._kaminosDirty();const before=window.kaminosSceneGIDebugState();let frame;const start=performance.now();
   const timing=await window.__costTimer.measure(()=>{frame=window.__kaminosRenderSceneForInspection();});
   const completionWallMs=performance.now()-start,after=window.kaminosSceneGIDebugState();
   return {backend:window.kaminosWorkbenchSceneState().rendererBackend,before,after,frame,...timing,completionWallMs};
  });
  for(let round=0;round<manifest.rounds;round++){
   const order=round%2?[...cases].reverse():cases;
   for(const expected of order){
    report.phase='measure:'+round+':'+expected.id;const entry={round,expected,records:[]};report.cases.push(entry);await save();
    await page.evaluate(values=>{for(const [key,value] of Object.entries(values)){if(key==='id')continue;const control=document.getElementById('scene-gi-'+key);if(!control)throw Error('Unknown GI control '+key);if(control.type==='checkbox')control.checked=value;else control.value=String(value);control.dispatchEvent(new Event(control.type==='number'?'input':'change',{bubbles:true}));}},expected);
    for(let i=0;i<warmup;i++){const record=await draw();summarizeGiCostFrame(record,expected);}
    for(let i=0;i<samples;i++){const record=await draw();record.summary=summarizeGiCostFrame(record,expected);entry.records.push(record);await save();}
    entry.state=entry.records.at(-1).after;await page.screenshot({path:path.join(out,`round-${round}-${expected.id}.png`)});await save();
    assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
   }
  }
  return {scene:sceneFile,cases:report.cases.length};
 }});
 report.sourceAfter=await source();assert.deepEqual(report.sourceAfter,report.sourceBefore);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
 assert.equal(report.cases.length,cases.length*manifest.rounds);for(const entry of report.cases)assert.equal(entry.records.length,samples);
 report.status='observed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
finally{
 await page?.evaluate(()=>{window.__costTimer?.dispose();window.__costRestoreEncoder?.();window.__costRelease?.();}).catch(()=>{});
 await browser?.close();report.browserClosed=true;
 if(profile){await fs.rm(profile,{recursive:true,force:true});report.profileRemoved=true;}
 await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,cases:report.cases.length}));
}
