import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {visualWork,assertMountedScene} from '../visual-work.mjs';
const [out,store,origin='http://127.0.0.1:18588',softnessInput='0',sceneInput='dj-with-a-kiln-pretty.kaminos.json',sampling='fixed',pointsInput='1']=process.argv.slice(2);
const pointCount=Number(pointsInput);
let owner=null,workspace='authoring';
const shadowSoftness=Number(softnessInput);
if(!out||!store)throw Error('explicit output and copied store required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'arguments',requested:{sampling,softnessInput},repoRoot:process.cwd(),source:null,origin,store,errors:[],consoleErrors:[],claim:'kiln hybrid authoring preview; no performance or adjustable-domain acceptance'};
const write=()=>fs.writeFile(out+'/kiln.json',JSON.stringify(report,null,2));await write();let browser;
try{
 if(![1,2].includes(pointCount))throw Error('surface point count must be 1 or 2');report.requested.points=pointCount;
 if(!['fixed','complementary'].includes(sampling))throw Error('valid shadow sampling required');
 if(!Number.isFinite(shadowSoftness)||shadowSoftness<0)throw Error('finite nonnegative shadow softness required');
 owner=sampling==='complementary'?{id:'fire-shadow-sampling',inputsText:JSON.stringify({sampling,points:pointCount})}:null;
 workspace=owner?'workbench':'authoring';report.phase='source-identity';
 report.source=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 report.phase='browser-dependency';report.playwrightModule=process.env.KAMINOS_PLAYWRIGHT_MODULE||'playwright';await write();
 const {chromium}=await import(report.playwrightModule);
 report.phase='prepare';await write();
 const bytes=await fs.readFile(store+'/scenes/'+sceneInput);
 const doc=JSON.parse(bytes);report.input={file:sceneInput,sha256:createHash('sha256').update(bytes).digest('hex'),preset:doc.composition.flame.presetId};
 Object.assign(doc.composition.route,{volume_light_field_shared_source:'1',volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_hybrid_points:String(pointCount),volume_light_field_hybrid_smoke_refinement:'1'});
 if(shadowSoftness>0)doc.composition.route.volume_light_field_hybrid_shadow_softness=String(shadowSoftness);
 doc.composition.route.volume_light_field_hybrid_shadow_sampling=sampling;
 await fs.writeFile(store+'/scenes/kiln-hybrid-preview.kaminos.json',JSON.stringify(doc,null,2));
 const executablePath='/Users/noahlyons/.local/state/kaminos/browsers/chrome-for-testing-154.0.8037.92/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';report.browser=executablePath;
 browser=await chromium.launch({executablePath,headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});
 const page=await browser.newPage({viewport:{width:1500,height:1050},deviceScaleFactor:1});page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);
 page.on('pageerror',e=>{report.errors.push(e.message);write();});
 page.on('console',m=>{if(m.type()==='error'){const r={text:m.text(),location:m.location()};report.consoleErrors.push(r);if(!(r.text.startsWith('Failed to load resource:')&&new URL(r.location.url||origin).pathname==='/favicon.ico'))report.errors.push(r.text);write();}});
 // Reuse Modal's exact preserved HDR bytes at the original resource URL.
 const hdr=await fs.readFile('/Users/noahlyons/.local/state/kaminos/modal-scene-solids-1013/evidence/studio_small_09_1k.hdr');
 report.environmentReplay={url:'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',sha256:createHash('sha256').update(hdr).digest('hex')};
 await page.route(report.environmentReplay.url,r=>r.fulfill({status:200,contentType:'application/octet-stream',body:hdr,headers:{'Access-Control-Allow-Origin':'*'}}));
 report.phase='open';await write();
 const observe=()=>page.evaluate(()=>({url:location.href,lighting:window.__kaminosSceneRadiance?.debugState(),volume:window.__kaminosVolumePrototype?.debugState(),objects:window.kaminosSceneObjectDebugState?.(),authoredObjects:window.kaminosSceneAuthoring?.read().objects,info:document.getElementById('info-bar')?.textContent}));
 const settle=async()=>{
   await page.waitForFunction(()=>{
     const setup=window.__kaminosSceneRadianceSetup,l=window.__kaminosSceneRadiance?.debugState(),v=window.__kaminosVolumePrototype?.debugState();
     if(setup?.error||l?.error||v?.error)throw Error(setup?.error||l?.error||v?.error);
     return l?.identity==='hybrid-distributed-smoke-point-surfaces-v0'&&window.__kaminosSceneRadiance.canRender()&&v?.frameCount>30;
   });
   assert.deepEqual(report.errors,[]);
 };
 report.visual=await visualWork({page,origin,repoRoot:process.cwd(),sceneStore:store+'/scenes',basinStore:store+'/basins',sceneFile:'kiln-hybrid-preview.kaminos.json',workspace,owner,out,exercise:async({document,retain,open})=>{
   await settle();report.phase='settings';report.loaded=await observe();await write();
   await page.evaluate(()=>{
     for(const [id,value] of [['rendering-angular-samples','8'],['rendering-angular-pattern','guided']]){const input=document.getElementById(id);input.value=value;input.dispatchEvent(new Event('change'));}
     window.setGizmoMode(null);
   });
   await page.waitForFunction(()=>window.__kaminosSceneRadiance.debugState().frame?.directions===8);
   const state=await observe();assert.equal(state.lighting.surfaceReceivers,0);assert.equal(state.lighting.pointCount,pointCount);assert.equal(state.lighting.frame.smokeReconstruction.refinement,1);assert.equal(state.volume.backend,'WebGPU:apple');
   assertMountedScene(document,state.objects,state);report.effective=state;
   if(shadowSoftness>0){
     report.phase='held-shadow-comparison';await write();
     report.requestedComparisonSimStep=400;
     await page.waitForFunction(()=>window.__kaminosVolumePrototype.debugState().simStepCount>=400);
     report.pause=await page.evaluate(()=>window.__kaminosVolumePrototype.setSimulationPaused(true));
     const before=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
     const raw=Buffer.from(new Float32Array(before.values).buffer);await fs.writeFile(out+'/held-source.f32',raw);
     report.heldSource={...before,values:undefined,sha256:createHash('sha256').update(raw).digest('hex')};
     report.heldCamera=await page.evaluate(sampling=>{
       if(sampling==='complementary')return window.kaminosSetCameraDebugPose({position:[7,5,11],target:[0,-.3,1]});
       const {position:p,target:t}=window.kaminosCameraDebugState();
       return window.kaminosSetCameraDebugPose({position:p.map((v,i)=>t[i]+(v-t[i])*.65),target:t});
     },sampling);
     if(owner){
       report.experiment=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
       assert.equal(report.experiment.effective,'complementary');
       await page.locator('select[aria-label="Fire shadow sampling"]').selectOption('fixed');
       await page.waitForFunction(async()=>(await window.kaminosWorkbenchExperiments.read()).effective==='fixed');
       report.controlExercise=await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setSampling','complementary'));
       assert.equal(report.controlExercise.effective,'complementary');
       report.giBefore=await page.evaluate(()=>window.kaminosSceneGIDebugState());
       await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('setBounceGain',0));
       assert.equal(await page.evaluate(()=>window.kaminosSceneGIDebugState().gain),0);
     }
     const lights=await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects.filter(o=>o.type==='light'));
     report.held=[];
     for(const spotlight of [true,false]){
       await page.evaluate(({lights,spotlight})=>{for(const light of lights)window.kaminosSceneAuthoring.setLight(light.id,{enabled:spotlight&&light.light.enabled});},{lights,spotlight});
       for(const [softness,mode]of [[0,'fixed'],[shadowSoftness,'fixed'],...(owner?[[shadowSoftness,'complementary']]:[])]){
         await page.evaluate(value=>window.__kaminosSceneRadiance.setShadowSoftness(value),softness);
         await page.evaluate(({owner,mode})=>owner?window.kaminosWorkbenchExperiments.invoke('setSampling',mode):window.__kaminosSceneRadiance.setShadowSampling(mode),{owner:!!owner,mode});
         await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
         const row=await observe();assert.equal(row.volume.simStepCount,report.pause.simStepCount);
         report.held.push({spotlight,softness,sampling:mode,lighting:row.lighting,gi:await page.evaluate(()=>window.kaminosSceneGIDebugState()),simStepCount:row.volume.simStepCount,camera:await page.evaluate(()=>window.kaminosCameraDebugState())});
         await page.screenshot({path:out+'/'+(spotlight?'authored':'fire-only')+'-'+(softness?(mode==='complementary'?'complementary':'soft'):'hard')+'.png'});await write();
       }
     }
     if(pointCount===2){
       report.pointComparison=[];
       for(const count of [1,2,1,2]){
         await page.locator('select[aria-label="Flame lighting sources"]').selectOption(String(count));
         await page.waitForFunction(count=>window.__kaminosSceneRadiance?.canRender()&&window.__kaminosSceneRadiance.debugState().frame?.pointRegions?.count===count,count);
         await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
         const row=await observe(),regions=await page.evaluate(()=>window.__kaminosSceneRadiance.readPointRegions());
         assert.equal(row.volume.simStepCount,report.pause.simStepCount);assert.equal(row.lighting.shadows.length,count);
         assert.equal(row.lighting.shadowSampling,'complementary');assert.equal(regions.count,count);
         report.pointComparison.push({count,regions,lighting:row.lighting,camera:await page.evaluate(()=>window.kaminosCameraDebugState())});
         await page.screenshot({path:out+`/points-${count}-${report.pointComparison.length}.png`});await write();
       }
       const sum=entry=>entry.regions.regions.reduce((a,r)=>a.map((v,i)=>v+r.energy[i]),[0,0,0]);
       const one=sum(report.pointComparison[0]),two=sum(report.pointComparison[1]);
       one.forEach((v,i)=>assert(Math.abs(v-two[i])<1e-4*Math.max(1,Math.abs(v)),'two points must conserve source energy'));
       assert.deepEqual(report.pointComparison[0].regions.regions,report.pointComparison[2].regions.regions,'one-point restoration');
       assert.deepEqual(report.pointComparison[1].regions.regions,report.pointComparison[3].regions.regions,'two-point restoration');
     }
     const after=await page.evaluate(()=>window.__kaminosVolumePrototype.sampleSceneVolumeSource());
     await fs.writeFile(out+'/held-source-after.f32',Buffer.from(new Float32Array(after.values).buffer));
     assert.deepEqual(after.values,before.values,'shadow comparison must preserve actual source coefficients');
     if(owner)await page.evaluate(gain=>window.kaminosWorkbenchExperiments.invoke('setBounceGain',gain),report.giBefore.gain);
     await page.evaluate(lights=>{for(const light of lights)window.kaminosSceneAuthoring.setLight(light.id,{enabled:light.light.enabled});window.__kaminosVolumePrototype.setSimulationPaused(false);},lights);
   }
   report.phase='capture';await write();
   await page.screenshot({path:out+'/authoring.png'});
   const saved=await retain({name:'kiln-hybrid',observe});
   const url=new URL(saved.url),hash=new URLSearchParams(url.hash.slice(1));hash.set('rendering_directions','8');hash.set('rendering_angular_pattern','guided');url.hash=hash.toString();
   report.saved={filename:saved.filename,url:url.href,documentUrl:saved.url};await write();
   report.phase='reopen';await write();await page.goto('about:blank');await page.goto(url.href);
   await page.waitForFunction(()=>{
     const failure=document.querySelector('#status.failed'),status=document.getElementById('info-bar')?.textContent||'';
     if(failure||/Scene load failed|Invalid scene|water host unavailable/i.test(status))throw Error(failure?.textContent||status);
     return /^(Scene loaded|Volume scene loaded)/.test(status);
   });
   await settle();report.reopened=await observe();
   // The legacy debug mesh registry intentionally excludes Modal's simulation
   // domain. The authoring document is the full typed-object consumer contract.
   assertMountedScene(saved.document,await page.evaluate(()=>window.kaminosSceneAuthoring.read().objects));
   assert.equal(report.reopened.lighting.frame.directions,8);assert.equal(report.reopened.lighting.frame.angularPattern,'guided');
   assert.equal(report.reopened.lighting.pointCount,pointCount);assert.equal(report.reopened.lighting.frame.smokeReconstruction.refinement,1);
   assert.equal(report.reopened.lighting.shadowSoftness,shadowSoftness);
   assert.equal(report.reopened.lighting.shadowSampling,sampling);
   await page.screenshot({path:out+'/reopened.png'});
   report.camera=await page.evaluate(()=>window.kaminosCameraDebugState());
   report.obliqueCamera=await page.evaluate(()=>{
     const {position:p,target:t}=window.kaminosCameraDebugState(),x=p[0]-t[0],z=p[2]-t[2],a=0.8;
     return window.kaminosSetCameraDebugPose({position:[t[0]+x*Math.cos(a)+z*Math.sin(a),t[1]+Math.hypot(x,z)*0.8,t[2]+z*Math.cos(a)-x*Math.sin(a)],target:t});
   });
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.screenshot({path:out+'/oblique.png'});
   return {saved:report.saved,lighting:report.reopened.lighting};
 }});
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure={phase:report.phase,message:e.message,stack:e.stack};if(browser){const p=browser.contexts()[0]?.pages()[0];if(p){report.last=await p.evaluate(()=>({info:document.getElementById('info-bar')?.textContent,setup:window.__kaminosSceneRadianceSetup,lighting:window.__kaminosSceneRadiance?.debugState(),volume:window.__kaminosVolumePrototype?.debugState()})).catch(()=>null);await p.screenshot({path:out+'/failure.png'}).catch(()=>{});}}process.exitCode=1;
}finally{await browser?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.message,saved:report.saved}));}
