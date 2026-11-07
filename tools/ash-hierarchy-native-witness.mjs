import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {refinementCell} from '../ash/refinement-plan.mjs';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=new Map();for(let n=2;n<process.argv.length;n+=2)args.set(process.argv[n],process.argv[n+1]);
const out=resolve(args.get('--out')),origin=args.get('--url');let repo;mkdirSync(out,{recursive:true});
const r={status:'running',phase:'source',pageErrors:[],consoleErrors:[],frames:[],purpose:'Compare actual ash deposited on curved pipes at fixed background and storage budget; no timing claim'};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(r,null,2));save();let browser,page;
try{
 assert.ok(args.get('--repo'),'--repo required');repo=resolve(args.get('--repo'));assert.ok(origin,'--url required');
 r.identity=await verifyAuthoringServer({origin,repoRoot:repo});r.sources={};
 for(const name of ['ash/hierarchy-plan.mjs','ash/hierarchy-impact.mjs','ash/fall-plan.mjs','ash/fall-gpu.mjs','ash/hierarchy-wgsl.mjs','ash/hierarchy-collision.mjs','ash/collision-mips.mjs','ash/refinement-gpu.mjs','ash/refinement-shader.mjs','ash/refinement-surface.mjs','ash/scene-gpu.mjs','ash/scene-object.mjs','ash/scene-controls.mjs','ash/refinement-controls.mjs']){const response=await fetch(new URL(name,origin));assert.ok(response.ok);const hash=b=>createHash('sha256').update(b).digest('hex'),digest=hash(Buffer.from(await response.arrayBuffer()));assert.equal(digest,hash(readFileSync(resolve(repo,name))));r.sources[name]=digest;}
 r.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:out+'/profile',width:1200,height:850});
 const {chromium}=await import(args.get('--playwright'));browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:r.launch.executable,headless:true,viewport:{width:1200,height:850},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal']});page=browser.pages()[0];page.setDefaultTimeout(0);page.setDefaultNavigationTimeout(0);page.on('pageerror',e=>r.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')r.consoleErrors.push(m.text());});
 await page.goto(origin+'/?workspace=authoring');await page.waitForFunction(()=>window.kaminosWorkspace&&window.kaminosAsh&&window.kaminosSceneAuthoring&&window.__kaminosSetSceneCameraFrame&&window.kaminosSceneLoadPresentation&&!window.kaminosSceneLoadPresentation().document.blocked);await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());
 r.phase='geometry';save();r.parts=await page.evaluate(()=>{
  window.kaminosWorkspace.setMode('authoring');const ids=[];
  for(const part of [{radius:.009,height:.32,position:[-.02,.13,-.08],rotation:[0,0,Math.PI/2]},{radius:.003,height:.24,position:[.015,.22,.06],rotation:[0,0,Math.PI/2]},{radius:.009,height:.13,position:[-.14,.065,-.08]},{radius:.003,height:.22,position:[-.08,.11,.06]}]){
   const id=window.kaminosSceneAuthoring.addMesh('cylinder',{radius:part.radius,height:part.height});window.kaminosSetSceneObjectTransform(id,{position:part.position,rotation:part.rotation??[0,0,0]});ids.push(id);
  }
  window.__kaminosSetSceneCameraFrame([.47,.43,.53],[0,.125,0]);window.kaminosViewportSettings.set({overlays:false,gizmos:false});return ids;
 });
 const capture=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:out+'/'+name+'.png'});r.frames.push(name);save();};
 for(const [label,cellSize]of [['coarse',.01],['fine',Number(args.get('--fine')??.00125)]]){
  r.phase=label;save();const id=await page.evaluate(async({cellSize,budget,background})=>{
   return window.kaminosAsh.add({width:.64,depth:.64,height:.4,cellSize,initialDepth:.006,paused:true,sourcePosition:[0,.36,0],spread:.22,emitting:true,rate:.0004,softNormals:true,slideVariation:.25,refinement:{ratio:2,mode:'hierarchy',backgroundCellSize:background,budgetMiB:budget,airBudgetMiB:budget/8,targetPixels:1}},[0,0,0]);
  },{cellSize,budget:Number(args.get('--budget')??32),background:Number(args.get('--background')??.08)});
  await page.evaluate(id=>{window.selectSceneObject(id);window.kaminosAsh.advance(id,48);window.kaminosAsh.set(id,{emitting:false});window.kaminosAsh.advance(id,96);},id);
  const state=await page.evaluate(id=>window.kaminosAsh.snapshot(id),id);writeFileSync(out+'/'+label+'.kaminos-object.json',JSON.stringify(state));
  const diagnostic=await page.evaluate(id=>window.kaminosAsh.diagnostics(id),id);assert.ok(diagnostic.hierarchy.resident>0);assert.equal(diagnostic.stats.surfaceOverflow,0);assert.ok(state.ash.checkpoint.values.some(v=>v>0));assert.ok(Math.abs(state.ash.checkpoint.volume-state.ash.checkpoint.retainedVolume)<1e-6,'retain all supplied material');
  r[label]={id,hierarchy:diagnostic.hierarchy,runtime:await page.evaluate(id=>window.kaminosAsh.read(id).runtime,id),introduced:state.ash.checkpoint.volume,retained:state.ash.checkpoint.retainedVolume};await capture(label+'-deposited');
  if(label==='fine'){
   assert.equal(diagnostic.hierarchy.deepest,state.ash.checkpoint.layout.hierarchy.depth,'requested deepest physical cells must exist');
   const checkpoint=state.ash.checkpoint,view={...checkpoint.layout,residency:checkpoint.residency};let fineVolume=0;
   for(let i=0;i<checkpoint.values.length;i++)if(checkpoint.values[i]>0){const c=refinementCell(view,i);if(c.owned&&c.size===1&&(view.origin[1]+c.coord[1]*view.cellSize)>.05)fineVolume+=checkpoint.values[i]*view.cellSize**3;}
   assert.ok(fineVolume>0,'actual elevated ash must reach the requested finest receiving cells');r.fine.finestElevatedVolume=fineVolume;await page.evaluate(id=>window.kaminosAsh.showRefinement(id,true),id);await capture('fine-bricks-by-depth');await page.evaluate(id=>window.kaminosAsh.showRefinement(id,false),id);
   const saved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.ok(saved.ok,JSON.stringify(saved));r.saved={ok:saved.ok,filename:saved.filename,url:saved.url};
   await page.goto(r.saved.url);await page.waitForFunction(id=>window.kaminosAsh&&window.kaminosSceneObjectDebugState().some(x=>x.id===id)&&!window.kaminosAsh.read(id).pendingRestore,id);
   const reopened=await page.evaluate(id=>window.kaminosAsh.snapshot(id),id);for(const key of ['values','residency','falling','volume','steps'])assert.deepEqual(reopened.ash.checkpoint[key],state.ash.checkpoint[key],key);
   await page.evaluate(id=>window.selectSceneObject(id),id);await page.locator('[data-ash-refinement-controls]').evaluate(e=>e.open=true);assert.equal(await page.locator('[data-ash-refinement-mode]').inputValue(),'hierarchy');await page.locator('[data-ash-hierarchy="budgetMiB"]').scrollIntoViewIfNeeded();await capture('reopened-native-controls');
  }else await page.evaluate(id=>window.removeSceneObject(id),id);
 }
 assert.deepEqual(r.pageErrors,[]);r.status='physical-and-visual-capture-complete';r.phase='complete';r.diagnosticsClean=r.consoleErrors.length===0;
}catch(e){r.status='failed';r.error=String(e.stack??e);if(page){r.lastText=await page.locator('body').innerText().catch(String);await page.screenshot({path:out+'/failed.png'}).catch(()=>{});}process.exitCode=1;}
finally{try{await browser?.close();r.browserClosed=true;}catch(e){r.cleanupError=String(e);r.browserClosed=false;r.status='failed';process.exitCode=1;}finally{save();console.log(JSON.stringify({status:r.status,phase:r.phase,report:out+'/report.json'}));}}
