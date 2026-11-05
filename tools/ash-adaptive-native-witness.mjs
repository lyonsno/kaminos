import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),origin=args.get('--url');mkdirSync(out,{recursive:true});
const report={status:'running',phase:'arguments',requested:{repo:args.get('--repo'),origin},errors:[],consoleErrors:[],frames:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let browser,page;
try{
 assert.ok(args.get('--repo'));assert.ok(origin);const repo=resolve(args.get('--repo'));report.phase='source';save();
 report.identity=await verifyAuthoringServer({origin,repoRoot:repo});report.sources={};
 for(const name of ['ash/adaptive-plan.mjs','ash/adaptive-wgsl.mjs','ash/adaptive-collision.mjs','ash/refinement-gpu.mjs','ash/refinement-shader.mjs','ash/refinement-surface.mjs','ash/refinement-wgsl.mjs','ash/scene-gpu.mjs','ash/fall-gpu.mjs','ash/refinement-controls.mjs','tools/ash-adaptive-native-witness.mjs']){
  const response=await fetch(new URL(name,origin));assert.ok(response.ok);const hash=b=>createHash('sha256').update(b).digest('hex'),digest=hash(Buffer.from(await response.arrayBuffer()));assert.equal(digest,hash(readFileSync(resolve(repo,name))));report.sources[name]=digest;
 }
 report.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:out+'/profile',width:1200,height:850});
 const {chromium}=await import(args.get('--playwright'));browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.launch.executable,headless:true,viewport:{width:1200,height:850},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal']});
 page=browser.pages()[0];page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const capture=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:out+'/'+name+'.png'});report.frames.push(name);save();};
 const snapshot=async(name,id)=>{const s=await page.evaluate(id=>window.kaminosAsh.snapshot(id),id);writeFileSync(out+'/'+name+'.json',JSON.stringify(s));return s.ash.checkpoint;};
 report.phase='native-create';save();await page.goto(new URL('/?workspace=authoring',origin).href);
 await page.waitForFunction(()=>window.kaminosAsh&&window.kaminosWorkspace&&window.kaminosWorkbenchExperiments&&window.kaminosSceneAuthoring&&window.__kaminosSetSceneCameraFrame);
 report.objects=await page.evaluate(async fraction=>{
  window.kaminosWorkspace.setMode('authoring');
  const box=window.kaminosSceneAuthoring.addMesh('box',{width:.31,height:.35,depth:.29});window.kaminosSetSceneObjectTransform(box,{position:[-.65,.175,.01]});
  const shelf=window.kaminosSceneAuthoring.addMesh('box',{width:.53,height:.07,depth:.47});window.kaminosSetSceneObjectTransform(shelf,{position:[.55,.38,-.3],rotation:[0,.28,0]});
  const id=await window.kaminosAsh.add({width:3.2,depth:3.2,height:.64,cellSize:.04,initialDepth:.08,sourcePosition:[0,.6,0],paused:true,softNormals:true,refinement:{ratio:2,mode:'adaptive',fineFraction:fraction}},[0,0,0]);
  const source=await window.kaminosAsh.addSource({fieldId:id,position:[-.65,.6,.01],spread:.18,rate:.008,enabled:false});
  window.kaminosAsh.setSource(source,{enabled:false});
  window.__kaminosSetSceneCameraFrame([2.9,2.3,3.4],[0,.1,0]);window.selectSceneObject(id);window.kaminosViewportSettings.set({overlays:false,gizmos:false});return {box,shelf,id,source};
 },Number(args.get('--fine-fraction')??.5));
 const {id,box,source}=report.objects;
 report.initial=await page.evaluate(id=>({ash:window.kaminosAsh.read(id),gi:window.kaminosSceneGIDebugState()}),id);
 assert.equal(report.initial.ash.runtime.backend,'webgpu-adaptive-ash');assert.equal(report.initial.gi.effectiveMode,'combined');assert.equal(report.initial.ash.runtime.runtimeReadbacks,0);
 const before=await snapshot('before',id);assert.ok(before.residency.slots.some(Boolean),'collider shape must generate actual fine residency');assert.ok(before.values.some(v=>v>0));
 await capture('01-automatic-collider-detail');await page.evaluate(id=>window.kaminosAsh.showRefinement(id,true),id);await capture('01b-gpu-fine-bricks');await page.evaluate(id=>window.kaminosAsh.showRefinement(id,false),id);
 report.phase='moving-contact';save();await page.evaluate(()=>{const original=GPUBuffer.prototype.mapAsync;window.__ashRestoreMap=()=>GPUBuffer.prototype.mapAsync=original;window.__ashLiveMaps=0;GPUBuffer.prototype.mapAsync=function(...args){window.__ashLiveMaps++;return original.apply(this,args);};});
 await page.evaluate(async({id,box})=>{window.kaminosSetSceneObjectTransform(box,{position:[.55,.175,.55]});window.kaminosAsh.advance(id,4);},{id,box});
 report.liveMaps=await page.evaluate(()=>{window.__ashRestoreMap();return window.__ashLiveMaps;});assert.equal(report.liveMaps,0,'live allocation/contact must not map GPU state to CPU');
 const moved=await snapshot('moved',id);
 const oldPages=before.residency.map.flatMap((slot,page)=>slot?[page]:[]),newPages=moved.residency.map.flatMap((slot,page)=>slot&&!before.residency.map[page]?[page]:[]);
 assert.ok(newPages.length>0,'moving scene geometry must request new fine locations without regrid');
 const occupiedPages=before.residency.slots.flatMap((page,slot)=>page&&before.values.slice(before.layout.pool.offset+slot*512,before.layout.pool.offset+(slot+1)*512).some(v=>v>0)?[page-1]:[]);
 for(const page of occupiedPages)assert.ok(moved.residency.map[page],'occupied fine history must survive geometry motion');
 assert.equal(moved.volume,before.volume,'contact-only phase must have no source input');
 assert.ok(Math.abs(moved.retainedVolume-before.retainedVolume)<1e-6,'refinement and contact conserve material');
 report.movement={oldPages:oldPages.length,newPages:newPages.length,preservedOccupied:occupiedPages.length};
 report.contact=await page.evaluate(id=>window.kaminosAsh.diagnostics(id,{fields:true}),id);writeFileSync(out+'/contact.json',JSON.stringify(report.contact));assert.equal(report.contact.stats.surfaceOverflow,0);
 await capture('02-moved-collider-and-history');
 report.phase='falling-source';save();await page.evaluate(source=>{window.kaminosAsh.setSource(source,{enabled:true});window.kaminosSetSceneObjectTransform(source,{position:[.55,.6,.55]});},source);await page.evaluate(id=>{window.kaminosAsh.burst(id,.025);window.kaminosAsh.advance(id,48);},id);
 const emitted=await snapshot('emitted',id);assert.ok(emitted.volume>moved.volume);const deposited=s=>s.values.reduce((a,b)=>a+b,0)*s.layout.cellSize**3;report.sourceMaterial={introduced:emitted.volume-moved.volume,depositedGain:deposited(emitted)-deposited(moved)};assert.ok(report.sourceMaterial.depositedGain>emitted.layout.cellSize**3,'source must actually add retained field material, not only airborne or pending volume');assert.ok(Math.abs(emitted.retainedVolume-emitted.volume)<1e-5);await capture('03-live-fallout');
 report.phase='save-reopen';save();report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.ok(report.saved.ok,JSON.stringify(report.saved));
 await page.goto(report.saved.url);await page.waitForFunction(id=>window.kaminosAsh&&window.kaminosSceneObjectDebugState().some(e=>e.id===id)&&window.kaminosAsh.read(id).runtime.backend==='webgpu-adaptive-ash',id);
 const reopened=await snapshot('reopened',id);assert.deepEqual(reopened.residency,emitted.residency);assert.deepEqual(reopened.values,emitted.values);assert.deepEqual(reopened.falling,emitted.falling);
 await page.evaluate(id=>window.selectSceneObject(id),id);const details=page.locator('#selected-ash-properties details').filter({has:page.getByText('Adaptive detail',{exact:true})});await details.evaluate(e=>e.open=true);
 assert.equal(await page.locator('[data-ash-refinement-mode]').inputValue(),'adaptive');await page.locator('[data-ash-inspect-residency]').click();await page.waitForFunction(()=>document.querySelector('[data-ash-residency]')?.textContent.includes('fine bricks'));
 await capture('04-reopened-native-inspector');
 report.final=await page.evaluate(id=>window.kaminosAsh.read(id),id);assert.equal(report.final.failure,null);assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastText=await page.locator('body').innerText().catch(String);await page.screenshot({path:out+'/failed.png'}).catch(()=>{});}process.exitCode=1;}
finally{try{await browser?.close();report.browserClosed=true;}catch(error){report.cleanupError=String(error);report.status='failed';report.browserClosed=false;process.exitCode=1;}finally{save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));}}
