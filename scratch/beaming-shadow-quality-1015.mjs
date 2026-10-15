import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork,assertCapturePixels} from '../visual-work.mjs';
import {decodeScreenshotPngRgb} from '../screenshot-png-rgb.mjs';
const [out,store,origin,sceneFile]=process.argv.slice(2);
if(!out||!store||!origin||!sceneFile)throw Error('explicit output, store, origin and scene required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'identity',repoRoot:process.cwd(),origin,store,sceneFile,errors:[],claim:'lighting-budget control exercise; no timing or cold-scene-recovery claim'};
const write=()=>fs.writeFile(out+'/quality.json',JSON.stringify(report,null,2));
await write();let context,page;
try{
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.modules={};
 for(const name of ['scene-hybrid-radiance.mjs','fire-light-field-shadow.mjs','fire-shadow-filter.mjs','fire-shadow-quality.mjs','fire-shadow-sampling.mjs','experiments/fire-shadow-sampling.experiment.mjs']){
  const local=await fs.readFile(name),served=Buffer.from(await(await fetch(origin+'/'+name)).arrayBuffer());
  assert.deepEqual(served,local);report.modules[name]=createHash('sha256').update(local).digest('hex');
 }
 const {chromium}=await import(process.env.KAMINOS_PLAYWRIGHT_MODULE);
 report.executable='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
 report.profile=out+'/browser-profile';
 context=await chromium.launchPersistentContext(report.profile,{executablePath:report.executable,headless:true,viewport:{width:1500,height:1100},deviceScaleFactor:1,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 page=context.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 page.on('pageerror',error=>report.errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))report.errors.push(message.text());});
 const hdr=await fs.readFile('/Users/noahlyons/.local/state/kaminos/modal-scene-solids-1013/evidence/studio_small_09_1k.hdr');
 await page.route('https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',r=>r.fulfill({status:200,contentType:'application/octet-stream',body:hdr,headers:{'Access-Control-Allow-Origin':'*'}}));
 const owner={id:'fire-shadow-sampling',inputsText:JSON.stringify({sampling:'complementary',points:4,pointSampling:'paired'})};
 const observe=async quality=>{
  await page.waitForFunction(q=>{
   const l=window.__kaminosSceneRadiance,s=l?.debugState();
   const error=s?.error||window.kaminosWorkbenchSceneFrameError||window.kaminosWorkbenchExperimentError;
   if(error)throw Error(error);
   return !!(l?.canRender()&&s.pointCount===4&&s.pointSampling==='paired'&&s.shadows.length===4&&s.shadows.every(x=>x.effective&&x.resolution===q.resolution&&x.blockerSamples===q.blockerSamples&&x.filterSamples===q.filterSamples));
  },quality);
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const row=await page.evaluate(async()=>{
   const canvas=document.getElementById('kaminos-host-renderer-canvas');
   if(!canvas||!(canvas.width>0&&canvas.height>0))throw Error('missing scene renderer surface');
   const rect=canvas.getBoundingClientRect(),volume=window.__kaminosVolumePrototype.debugState();
   for(const key of ['width','height','displayWidth','displayHeight','renderScale'])if(!(Number.isFinite(volume[key])&&volume[key]>0))throw Error('missing volume dimensions: '+key);
   if(!(rect.width>0&&rect.height>0))throw Error('missing scene renderer display');
   return {lighting:window.__kaminosSceneRadiance.debugState(),owner:await window.kaminosWorkbenchExperiments.read(),volume,url:location.href,canvas:[canvas.width,canvas.height],sceneDisplay:[rect.width,rect.height]};
  });
  assert(row&&row.lighting&&row.owner,'missing observation');
  assert.deepEqual(row.owner.shadowQuality,quality);assert.equal(row.volume.backend,'WebGPU:apple');
  assert.equal(row.lighting.evaluatedPointCount,2);assert.equal(row.lighting.capturedPointCount,4);
  assert(row.lighting.shadows.every(x=>x.effective&&x.resolution===quality.resolution&&x.blockerSamples===quality.blockerSamples&&x.filterSamples===quality.filterSamples));
  assert.deepEqual(report.errors,[]);return row;
 };
 report.phase='open';
 report.visual=await visualWork({page,origin,repoRoot:process.cwd(),sceneStore:store+'/scenes',basinStore:store+'/basins',sceneFile,workspace:'workbench',owner,out,exercise:async()=>{
  const baseline={resolution:256,blockerSamples:9,filterSamples:16};
  await observe(baseline);
  await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=200);
  await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
  const before=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
  await fs.writeFile(out+'/held-source.f32',Buffer.from(new Float32Array(before.values).buffer));
  report.rows=[];
  const capture=async(name,quality)=>{
   const row=await observe(quality),png=await page.screenshot({path:out+'/'+name+'.png'});
   // viewport-preservation:start
   if(report.rows.length){
    const baseline=report.rows[0];
    assert.deepEqual(row.canvas,baseline.canvas,'scene dimensions changed');
    assert.deepEqual(row.sceneDisplay,baseline.sceneDisplay,'scene display dimensions changed');
    for(const key of ['width','height','displayWidth','displayHeight','renderScale'])assert.equal(row.volume[key],baseline.volume[key],'volume dimensions changed: '+key);
   }
   // viewport-preservation:end
   const decoded=decodeScreenshotPngRgb(png);assertCapturePixels(decoded,{width:decoded.width,height:decoded.height});
   row.image=name+'.png';report.rows.push(row);await write();
  };
  report.phase='baseline';await capture('baseline',baseline);
  report.phase='human-controls';
  for(const [label,value] of [['Shadow cube resolution',128],['Blocker-search samples',5],['Soft-shadow samples',8]]){
   await page.locator('input[type=range][aria-label="'+label+'"]').evaluate((element,value)=>{element.value=String(value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));},value);
   const expected={...report.rows.at(-1).owner.shadowQuality,[label==='Shadow cube resolution'?'resolution':label==='Blocker-search samples'?'blockerSamples':'filterSamples']:value};
   await capture('control-'+label.replaceAll(' ','-'),expected);
  }
  report.phase='agent-operation';
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setShadowQuality',{resolution:192,blockerSamples:7,filterSamples:12}));
  await capture('agent-192-7-12',{resolution:192,blockerSamples:7,filterSamples:12});
  report.phase='owner-reopen';
  const edited=await page.evaluate(async()=>{const {readOwnerExperimentAddress}=await import('/owner-experiment-entry.mjs');return readOwnerExperimentAddress(location);});
  assert.deepEqual(JSON.parse(edited.inputsText).shadowQuality,{resolution:192,blockerSamples:7,filterSamples:12});
  await page.evaluate(async edited=>{await window.kaminosWorkbenchExperiments.close();await window.kaminosWorkbenchExperiments.open(edited.id,JSON.parse(edited.inputsText));},edited);
  await capture('owner-reopen',{resolution:192,blockerSamples:7,filterSamples:12});
  report.phase='restore';await page.getByRole('button',{name:'Restore 256 / 9 / 16',exact:true}).click();
  await capture('restored',baseline);
  const after=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
  assert.deepEqual(after.values,before.values);report.sourceUnchanged=true;
  report.handoff=report.rows.at(-1).url;return {url:report.handoff};
 }});
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};process.exitCode=1;if(page)await page.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await context?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.message,handoff:report.handoff}));}
