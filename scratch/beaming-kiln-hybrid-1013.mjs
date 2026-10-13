import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chromium} from '/Users/noahlyons/.local/state/kaminos/beaming-browser-deps-1007/node_modules/playwright/index.mjs';
import {visualWork,assertMountedScene} from '../visual-work.mjs';
const [out,store,origin='http://127.0.0.1:18588']=process.argv.slice(2);
if(!out||!store)throw Error('explicit output and copied store required');
await fs.mkdir(out,{recursive:true});
const report={status:'running',phase:'prepare',repoRoot:process.cwd(),source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),origin,store,errors:[],consoleErrors:[],claim:'kiln hybrid authoring preview; no performance or adjustable-domain acceptance'};
const write=()=>fs.writeFile(out+'/kiln.json',JSON.stringify(report,null,2));await write();let browser;
try{
 const bytes=await fs.readFile(store+'/scenes/dj-with-a-kiln-pretty.kaminos.json');
 const doc=JSON.parse(bytes);report.input={file:'dj-with-a-kiln-pretty.kaminos.json',sha256:createHash('sha256').update(bytes).digest('hex'),preset:doc.composition.flame.presetId};
 Object.assign(doc.composition.route,{volume_light_field_shared_source:'1',volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_hybrid_points:'1',volume_light_field_hybrid_smoke_refinement:'1'});
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
 const observe=()=>page.evaluate(()=>({url:location.href,lighting:window.__kaminosSceneRadiance?.debugState(),volume:window.__kaminosVolumePrototype?.debugState(),objects:window.kaminosSceneObjectDebugState?.(),info:document.getElementById('info-bar')?.textContent}));
 const settle=async()=>{
   await page.waitForFunction(()=>{
     const setup=window.__kaminosSceneRadianceSetup,l=window.__kaminosSceneRadiance?.debugState(),v=window.__kaminosVolumePrototype?.debugState();
     if(setup?.error||l?.error||v?.error)throw Error(setup?.error||l?.error||v?.error);
     return l?.identity==='hybrid-distributed-smoke-point-surfaces-v0'&&window.__kaminosSceneRadiance.canRender()&&v?.frameCount>30;
   });
   assert.deepEqual(report.errors,[]);
 };
 report.visual=await visualWork({page,origin,repoRoot:process.cwd(),sceneStore:store+'/scenes',basinStore:store+'/basins',sceneFile:'kiln-hybrid-preview.kaminos.json',out,exercise:async({document,retain,open})=>{
   await settle();report.phase='settings';report.loaded=await observe();await write();
   await page.evaluate(()=>{
     window.__kaminosSceneRadiance.setDirections(8);window.__kaminosSceneRadiance.setAngularPattern('guided',0);
     window.__kaminosSceneRadiance.setSurfaceScattering(true);
     window.setGizmoMode(null);
   });
   await page.waitForFunction(()=>window.__kaminosSceneRadiance.debugState().frame?.directions===8);
   const state=await observe();assert.equal(state.lighting.surfaceReceivers,0);assert.equal(state.lighting.pointCount,1);assert.equal(state.lighting.frame.smokeReconstruction.refinement,1);assert.equal(state.volume.backend,'WebGPU:apple');
   assertMountedScene(document,state.objects);report.effective=state;
   report.phase='capture';await write();
   await page.screenshot({path:out+'/authoring.png'});
   const saved=await retain({name:'kiln-hybrid',observe});report.saved={filename:saved.filename,url:saved.url};await write();
   report.phase='reopen';await write();await open(saved.filename);await settle();report.reopened=await observe();
   assert.equal(report.reopened.lighting.pointCount,1);assert.equal(report.reopened.lighting.frame.smokeReconstruction.refinement,1);
   await page.screenshot({path:out+'/reopened.png'});
   return {saved:report.saved,lighting:report.reopened.lighting};
 }});
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(e){report.status='failed';report.failure={phase:report.phase,message:e.message,stack:e.stack};if(browser){const p=browser.contexts()[0]?.pages()[0];if(p){report.last=await p.evaluate(()=>({info:document.getElementById('info-bar')?.textContent,setup:window.__kaminosSceneRadianceSetup,lighting:window.__kaminosSceneRadiance?.debugState(),volume:window.__kaminosVolumePrototype?.debugState()})).catch(()=>null);await p.screenshot({path:out+'/failure.png'}).catch(()=>{});}}process.exitCode=1;
}finally{await browser?.close();await write();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure?.message,saved:report.saved}));}
