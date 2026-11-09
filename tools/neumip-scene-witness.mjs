// Lightweight real-page Save/Open conformance; does not measure performance.
import fs from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import net from 'node:net';
import assert from 'node:assert/strict';
const [out,meshURL]=process.argv.slice(2);assert(out,'Output directory required');
const root=process.cwd(),report={root,commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),phase:'launch',status:'running',errors:[]};
await fs.mkdir(out,{recursive:true});const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
let context,server,log,spawnError;
try{
 const socket=net.createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));const origin='http://127.0.0.1:'+port;report.origin=origin;
 log=await fs.open(out+'/server.log','a');
 server=spawn('python3',['-u','serve.py',String(port)],{cwd:root,env:{...process.env,KAMINOS_BIND_HOST:'127.0.0.1',KAMINOS_SCENES_DIR:out+'/scenes'},stdio:['ignore',log.fd,log.fd]});server.on('error',e=>spawnError=e);await log.close();log=null;
 const {setTimeout:pause}=await import('node:timers/promises');
 for(;;){if(spawnError)throw spawnError;try{const r=await fetch(origin+'/api/runtime-config');if(r.ok){report.runtime=await r.json();break;}}catch{}if(server.exitCode!==null)throw Error('Server failed');await pause(100);}
 assert.equal(report.runtime.source.repoRoot,root);
 report.browser=process.env.KAMINOS_TEST_BROWSER;assert(report.browser&&!report.browser.includes('/Google Chrome.app/'),'Independent browser required');
 const {chromium}=await import(process.env.KAMINOS_TEST_PLAYWRIGHT);
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.browser,headless:true,viewport:{width:1080,height:800},args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});
 const page=context.pages()[0];page.on('pageerror',e=>report.errors.push(e.message));
 const observe=()=>page.evaluate(()=>({objects:window.kaminosSceneObjectDebugState(),materials:window.kaminosMaterials.read(),backend:window.kaminosWorkbenchSceneState().rendererBackend,document:window.kaminosSceneLoadPresentation().document}));
 report.phase='experiment';await save();await page.goto(origin+'/?experiment=neumip&workspace=workbench');
 await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='neumip');
 report.setup=await page.evaluate(async()=>{
  const e=window.kaminosWorkbenchExperiments;await e.invoke('setSurface','sphere');await e.invoke('setUVScale',2.25);await e.invoke('setGain',1.35);
  const state=await e.read();window.kaminosSetSceneObjectTransform(state.objectId,{position:[.2,1.4,0],rotation:[0,.3,0],scale:[1,1,1]});
  const light=window.kaminosSceneAuthoring.addLight();window.kaminosSceneAuthoring.setLight(light,{intensity:70,angle:60});window.kaminosSetSceneObjectTransform(light,{position:[1,3,3],rotation:[-.5,.25,0],scale:[1,1,1]});return {...state,light};
 });
 assert.equal(report.setup.source.sha256,'7dc1eb1b92887006a3736898aea405cf220725b44922b2ca9d5bb4e47d0f7afd');
 report.before=await observe();assert.equal(report.before.backend,'webgpu');
 report.saved=await page.evaluate(()=>window.saveSceneAs({result:true,name:'neural-material-roundtrip'}));assert.equal(report.saved.ok,true,JSON.stringify(report.saved));
 assert.equal(report.saved.document.objects.find(o=>o.id===report.setup.objectId).neuralCarrier.surface,'sphere');
 await fs.writeFile(out+'/saved.json',JSON.stringify(report.saved.document,null,2));await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());await page.screenshot({path:out+'/before.png'});
 report.phase='fresh-native-page';await save();
 const url=new URL(report.saved.url),hash=new URLSearchParams(url.hash.slice(1));hash.delete('experiment');hash.delete('experiment_inputs');url.hash=hash.toString();
 report.nativeURL=url.href;const fresh=await context.newPage();fresh.on('pageerror',e=>report.errors.push(e.message));await page.close();await fresh.goto(url.href);
 await fresh.waitForFunction(id=>window.kaminosWorkbenchExperiments&&window.kaminosSceneLoadPresentation?.().document.phase==='idle'&&window.kaminosSceneLoadPresentation().document.filename&&window.kaminosMaterials?.read().bindings.some(b=>b.objectId===id),report.setup.objectId);
 report.after=await fresh.evaluate(()=>({objects:window.kaminosSceneObjectDebugState(),materials:window.kaminosMaterials.read(),backend:window.kaminosWorkbenchSceneState().rendererBackend,document:window.kaminosSceneLoadPresentation().document,experiment:window.kaminosWorkbenchExperiments.state()}));
 assert.equal(report.after.backend,'webgpu');assert.equal(report.after.experiment.id,null);
 assert.deepEqual(report.after.materials,report.before.materials);
 for(const id of [report.setup.objectId,report.setup.light]){const a=report.before.objects.find(o=>o.id===id),b=report.after.objects.find(o=>o.id===id);assert.ok(a&&b);assert.deepEqual(b.transform,a.transform);assert.equal(b.source,a.source);}
 await fresh.evaluate(id=>{window.selectSceneObject(id);window.kaminosWorkspace.setContext('material');},report.setup.objectId);
 await fresh.locator('[data-material-param="uvScale"]').click();await fresh.locator('[data-material-param="uvScale"]').fill('1.75');await fresh.locator('[data-material-param="uvScale"]').press('Enter');
 assert.equal((await fresh.evaluate(()=>window.kaminosMaterials.read())).recipes.find(r=>r.id===report.setup.recipeId).parameters.uvScale,1.75);
 await fresh.evaluate(()=>window.kaminosSceneEdits.undo());
 assert.equal((await fresh.evaluate(()=>window.kaminosMaterials.read())).recipes.find(r=>r.id===report.setup.recipeId).parameters.uvScale,2.25);
 await fresh.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());await fresh.screenshot({path:out+'/reopened.png'});
 report.phase='native-checkpoint-edits';await save();
 const rocky={url:'/api/read?root=image-inbox&path=neumip-author-models%2Frocky_web.model',sha256:'4eeda3a37d370aea6550f888387ab354ad6b2d5504681b9c93680d2b09058427'};
 let releaseSource;const held=new Promise(resolve=>releaseSource=resolve);await fresh.route('**/*rocky_web.model',route=>held.then(()=>route.continue()));
 const requested=fresh.waitForRequest(request=>request.url().endsWith('rocky_web.model'));
 await fresh.evaluate(({id,source})=>{window.__neuralSourceEdit=window.kaminosMaterials.edit(id,{parameters:{source}}).then(value=>({ok:true,value})).catch(error=>({ok:false,error:error.message}));},{id:report.setup.recipeId,source:rocky});
 await requested;await fresh.evaluate(id=>window.kaminosMaterials.edit(id,{parameters:{uvScale:1.9}}),report.setup.recipeId);releaseSource();
 report.staleSourceEdit=await fresh.evaluate(()=>window.__neuralSourceEdit);assert.equal(report.staleSourceEdit.ok,false);assert.match(report.staleSourceEdit.error,/changed while loading/);
 await fresh.unroute('**/*rocky_web.model');await fresh.evaluate(()=>window.kaminosSceneEdits.undo());
 report.badSourceEdit=await fresh.evaluate(async({id,source})=>{try{await window.kaminosMaterials.edit(id,{parameters:{source:{...source,sha256:'0'.repeat(64)}}});return {ok:true};}catch(error){return {ok:false,error:error.message};}},{id:report.setup.recipeId,source:rocky});
 assert.equal(report.badSourceEdit.ok,false);assert.match(report.badSourceEdit.error,/digest mismatch/);
 assert.deepEqual(await fresh.evaluate(()=>window.kaminosMaterials.read()),report.before.materials);
 await fresh.locator('[data-material-source]').selectOption({label:'embroidery'});
 await fresh.waitForFunction(id=>window.kaminosMaterials.read().recipes.find(r=>r.id===id).parameters.source.sha256==='a516a8ffb907cbf8cb7015f5fb493d561895fc0abe363627fb13debe620ba1ff',report.setup.recipeId);
 await fresh.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());await fresh.screenshot({path:out+'/native-embroidery.png'});
 await fresh.evaluate(()=>window.kaminosSceneEdits.undo());assert.deepEqual(await fresh.evaluate(()=>window.kaminosMaterials.read()),report.before.materials);
 await fresh.evaluate(()=>window.kaminosSceneEdits.redo());assert.equal((await fresh.evaluate(()=>window.kaminosMaterials.read())).recipes[0].parameters.source.sha256,'a516a8ffb907cbf8cb7015f5fb493d561895fc0abe363627fb13debe620ba1ff');await fresh.evaluate(()=>window.kaminosSceneEdits.undo());
 report.phase='owner-reopen';await save();const owner=await context.newPage();await fresh.close();await owner.goto(report.saved.url);await owner.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='neumip');
 report.owner=await owner.evaluate(async()=>({state:await window.kaminosWorkbenchExperiments.read(),objects:window.kaminosSceneObjectDebugState()}));
 assert.equal(report.owner.state.objectId,report.setup.objectId);assert.equal(report.owner.objects.filter(o=>o.source==='kaminos:neumip-carrier').length,1);
 report.ownerCoherence=await owner.evaluate(async({id,recipeId})=>{
  const e=window.kaminosWorkbenchExperiments;window.kaminosMaterials.edit(recipeId,{name:'My boutique knit'});window.kaminosMaterials.edit(recipeId,{parameters:{uvScale:1.85}});
  const readControls=()=>{const panel=document.querySelector('.owner-experiment-content'),row=[...panel.querySelectorAll('label')].find(l=>l.textContent.startsWith('UV scale'));const params=new URLSearchParams(location.hash.slice(1));return {scale:row.querySelector('input').value,checkpoint:panel.querySelector('select').value,url:JSON.parse(params.get('experiment_inputs'))};};
  const edited=readControls();await window.kaminosSceneEdits.undo();const undone=readControls();
  await window.removeSceneObject(id);await window.kaminosSceneEdits.undo();await e.invoke('setSurface','folded');await e.invoke('setSurface','sphere');await e.invoke('frame');
  return {edited,undone,restored:await e.read()};
 },{id:report.setup.objectId,recipeId:report.setup.recipeId});
 assert.equal(report.ownerCoherence.edited.scale,'1.85');assert.equal(report.ownerCoherence.edited.url.uvScale,1.85);assert.equal(report.ownerCoherence.edited.checkpoint,'wool2');assert.equal(report.ownerCoherence.undone.scale,'2.25');assert.equal(report.ownerCoherence.undone.url.uvScale,2.25);assert.equal(report.ownerCoherence.restored.surface,'sphere');
 await owner.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.ok((await owner.evaluate(()=>window.kaminosSceneObjectDebugState())).some(o=>o.id===report.setup.objectId));
 if(meshURL){
  report.phase='imported-assignment';await save();
  report.imported=await owner.evaluate(async({meshURL,recipeId})=>{
   window.kaminosSceneLodBudget.setSettings({enabled:true,faceBudget:5000});
   const before=new Set(window.kaminosSceneObjectDebugState().map(o=>o.id));
   await window.kaminosWorkbenchLoadAsset(meshURL,{normalize:false,arrival:'append'});await window.kaminosSceneLightingPreparation.whenIdle();
   const entry=window.kaminosSceneObjectDebugState().find(o=>!before.has(o.id)&&o.type==='glb');if(!entry)throw Error('Imported GLB did not register');
   const slots=window.kaminosMaterials.slots(entry.id);if(!slots.length)throw Error('Imported GLB has no material slot');
   for(const slot of slots)window.kaminosMaterials.assign({objectId:entry.id,slot:slot.key,recipeId});
   window.selectSceneObject(entry.id);window.kaminosFrameSelected();window.kaminosWorkspace.setContext('material');await window.kaminosSceneLightingPreparation.whenIdle();
   return {entry,slots,materials:window.kaminosMaterials.read(),lod:window.kaminosSceneLodBudget.read()};
  },{meshURL,recipeId:report.setup.recipeId});
  await owner.screenshot({path:out+'/imported.png'});
  report.importedSave=await owner.evaluate(()=>window.saveSceneAs({result:true,name:'neural-imported-roundtrip'}));assert.equal(report.importedSave.ok,true);
  const imported=await context.newPage();await owner.close();const importedURL=new URL(report.importedSave.url);const params=new URLSearchParams(importedURL.hash.slice(1));params.delete('experiment');params.delete('experiment_inputs');importedURL.hash=params.toString();
  await imported.goto(importedURL.href);await imported.waitForFunction(id=>window.kaminosSceneLoadPresentation?.().document.phase==='idle'&&window.kaminosMaterials?.read().bindings.some(b=>b.objectId===id),report.imported.entry.id);
  report.importedReopened=await imported.evaluate(()=>window.kaminosMaterials.read());assert.deepEqual(report.importedReopened,report.imported.materials);
  await imported.evaluate(id=>{window.selectSceneObject(id);window.kaminosFrameSelected();},report.imported.entry.id);await imported.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());await imported.screenshot({path:out+'/imported-reopened.png'});
 }
 assert.deepEqual(report.errors,[]);report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}finally{try{await context?.close();}catch(error){report.cleanupError=error.stack;}server?.kill('SIGTERM');await log?.close();await save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,out}));}
