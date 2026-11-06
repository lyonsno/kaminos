// Explicit saved-scene performance assay; submit through Greenroom.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork} from '../visual-work.mjs';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {summarizeGiCostFrame,installGiCostDeviceCapture} from './gi-cost-floor-contracts.mjs';
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
 if(manifest.sourcePyramidOverride){const bytes=await fs.readFile(manifest.sourcePyramidOverride);report.sourceOverride={path:manifest.sourcePyramidOverride,sha256:createHash('sha256').update(bytes).digest('hex')};await page.route('**/lib/addons/tsl/display/SSGISourcePyramid.js',route=>route.fulfill({contentType:'text/javascript',body:bytes}));}
 await page.exposeFunction('__costGpuError',message=>report.errors.push(message));
 await page.addInitScript(installGiCostDeviceCapture);
 report.phase='load';await save();
 report.consumer=await visualWork({page,origin,repoRoot,sceneFile,out:path.join(out,'consumer'),workspace:'authoring',exercise:async({document})=>{
  assert.equal(document.composition,null,'This assay excludes live simulation');
  await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());
  report.mounted=await page.evaluate(()=>({objects:window.kaminosSceneObjectDebugState(),arrival:window.kaminosSceneArrivalState(),backend:window.kaminosWorkbenchSceneState(),quality:window.kaminosViewportQualityState()}));assert.equal(report.mounted.backend.rendererBackend,'webgpu');
  report.device=await page.evaluate(async()=>{
   if(window.__costDevices.length!==1)throw Error('Ambiguous actual shared device');
   const d=window.__costDevices[0];if(!d.features.has('timestamp-query'))throw Error('timestamp-query unavailable');
   const create=d.createCommandEncoder;window.__costTimer=(await import('/tools/ash-pass-timer.mjs')).installAshPassTimer(d);const timed=d.createCommandEncoder;d.createCommandEncoder=function(...args){const encoder=timed.apply(this,args),begin=encoder.beginRenderPass;encoder.beginRenderPass=function(desc){const attachments=desc.colorAttachments.map(a=>{if(!a)return null;const meta=window.__costViews.get(a.view);return meta?{...meta,label:meta.label()}:null;});return begin.call(this,{...desc,label:JSON.stringify({original:desc.label??null,attachments})});};return encoder;};
   window.__costRestoreEncoder=()=>{d.createCommandEncoder=create;};
   window.__costRelease=window.__kaminosBeginSceneInspection();
   return {features:[...d.features],limits:{maxTextureDimension2D:d.limits.maxTextureDimension2D},adapter:window.kaminosWorkbenchSceneState().adapter};
  });await save();
  const draw=()=>page.evaluate(async()=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   window._kaminosDirty();const before=window.kaminosSceneGIDebugState();let frame;const start=performance.now();
   const timing=await window.__costTimer.measure(()=>{frame=window.__kaminosRenderSceneForInspection();});
   const completionWallMs=performance.now()-start,after=window.kaminosSceneGIDebugState();
   const canvas=document.getElementById('kaminos-host-renderer-canvas');return {backend:window.kaminosWorkbenchSceneState().rendererBackend,backing:[canvas.width,canvas.height],before,after,frame,...timing,completionWallMs};
  });
  for(let round=0;round<manifest.rounds;round++){
   const order=round%2?[...cases].reverse():cases;
   for(const expected of order){
    report.phase='measure:'+round+':'+expected.id;const entry={round,expected,records:[]};report.cases.push(entry);await save();
    await page.evaluate(values=>{for(const [key,value] of Object.entries(values)){if(key==='id')continue;const control=document.getElementById('scene-gi-'+key);if(!control)throw Error('Unknown GI control '+key);if(control.type==='checkbox')control.checked=value;else control.value=String(value);control.dispatchEvent(new Event(control.type==='number'?'input':'change',{bubbles:true}));}},expected);
    for(let i=0;i<warmup;i++){const record=await draw();summarizeGiCostFrame(record,expected);}
    for(let i=0;i<samples;i++){const record=await draw();record.summary=summarizeGiCostFrame(record,expected);entry.records.push(record);await save();}
    entry.state=entry.records.at(-1).after;
    if(manifest.captureGI&&expected.id==='parity'){
     entry.native=[];
     for(const kind of ['estimate','receiving']){const data=await page.evaluate(kind=>window.kaminosSceneGIReadback(kind),kind);const bytes=Buffer.from(data.base64,'base64');delete data.base64;const file=`round-${round}-${expected.id}-${kind}.raw`;await fs.writeFile(path.join(out,file),bytes);entry.native.push({...data,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
     const mips=await page.evaluate(async()=>{
      const device=window.__costDevices[0],state=window.kaminosSceneGIDebugState(),[width,height]=state.optimizations.mipSampling.resolution,result=[];
      for(const label of ['SSGI mip depth','SSGI mip radiance','SSGI mip normal']){
       const texture=window.__costTextures.filter(t=>t.label===label&&t.width===width&&t.height===height).at(-1);if(!texture)throw Error('Missing live pyramid '+label);
       for(let level=0;level<=state.optimizations.mipSampling.maxSampleLevel;level++){
        const w=Math.max(1,width>>level),h=Math.max(1,height>>level),bpp=texture.format==='r32float'?4:8,stride=Math.ceil(w*bpp/256)*256;
        const buffer=device.createBuffer({size:stride*h,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture,mipLevel:level},{buffer,bytesPerRow:stride},{width:w,height:h});device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange()),chunks=[];for(let i=0;i<bytes.length;i+=16384)chunks.push(String.fromCharCode(...bytes.subarray(i,i+16384)));result.push({label,level,width:w,height:h,format:texture.format,bytesPerRow:stride,allocatedLevels:texture.mipLevelCount,base64:btoa(chunks.join(''))});}
        finally{buffer.unmap();buffer.destroy();}
       }
      }return result;
     });
     for(const data of mips){const bytes=Buffer.from(data.base64,'base64');delete data.base64;const file=`round-${round}-${expected.id}-${data.label.replaceAll(' ','-')}-${data.level}.raw`;await fs.writeFile(path.join(out,file),bytes);entry.native.push({...data,file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
    }
    await page.screenshot({path:path.join(out,`round-${round}-${expected.id}.png`)});await save();
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
