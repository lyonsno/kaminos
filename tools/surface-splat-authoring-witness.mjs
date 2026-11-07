import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {buildSceneDocument} from '../scene-persistence-core.js';
import {compositionRestoreUrl} from '../scene-authoring.mjs';
import {visualWork} from '../visual-work.mjs';
const [origin,out,source]=process.argv.slice(2);if(!origin||!out||!source)throw Error('Usage: node tools/surface-splat-authoring-witness.mjs ORIGIN OUT ASSET_URL');
await fs.mkdir(out,{recursive:true});const report={ok:false,phase:'save-input',origin,source,repoRoot:process.cwd(),errors:[]};let browser,page;
const save=()=>fs.writeFile(out+'/launch.json',JSON.stringify(report,null,2));await save();
try{
 report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:report.repoRoot,encoding:'utf8'}).trim();
 report.dirty=!!execFileSync('git',['status','--porcelain'],{cwd:report.repoRoot,encoding:'utf8'}).trim();await save();
 const document=buildSceneDocument({objects:[{id:'surface-object',type:'glb',source,label:'Witch — deferred surface splats',fileName:'surface.glb',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]}}],camera:{position:[.9,.4,1.9],target:[0,-.02,0],fov:40},environment:{name:'studio',exposure:1.1,intensity:1,rotation:0,showBackground:false,ground:{visible:true,height:-.51}}});
 const response=await fetch(origin+'/api/save-scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(document)});assert(response.ok);report.input=await response.json();
 report.phase='launch-browser';await save();
 const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);report.executable=process.env.CHROME_EXECUTABLE;assert(report.executable&&!report.executable.includes('/Applications/Google Chrome.app/'));
 browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.executable,headless:true,viewport:{width:1280,height:850},args:['--use-mock-keychain','--password-store=basic','--use-angle=metal','--enable-unsafe-webgpu']});page=browser.pages()[0];page.setDefaultTimeout(0);
 let fail;const failure=new Promise((_,reject)=>fail=reject);failure.catch(()=>{});page.on('pageerror',error=>{report.errors.push(String(error));fail(error);});
 report.phase='exercise';await save();
 const exercise=visualWork({page,origin,repoRoot:process.cwd(),sceneFile:report.input.saved,workspace:'authoring',out:out+'/scene',exercise:async({retain,open})=>{
  const check=async()=>{await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());const rows=await page.evaluate(()=>window.kaminosSceneObjectDebugState());assert.equal(rows.length,1);assert.equal(rows[0].type,'glb');assert.equal(rows[0].surfaceSplats.length,1);assert.equal(rows[0].surfaceSplats[0].route,'deferred-surface-splats');assert.ok(rows[0].surfaceSplats[0].updates>0);return rows;};
  await check();await page.evaluate(()=>window.kaminosViewportSettings.set({gizmos:false}));await page.locator('#viewport').screenshot({path:out+'/witch.png'});
  const duplicate=await page.evaluate(()=>window.kaminosSceneAuthoring.duplicate('surface-object',{interactive:false}));
  assert.equal((await page.evaluate(()=>window.kaminosSceneObjectDebugState())).length,2);await page.evaluate(()=>window.kaminosSceneEdits.undo());await check();await page.evaluate(()=>window.kaminosSceneEdits.redo());
  await page.evaluate(()=>window.kaminosSceneLightingPreparation.whenIdle());const copies=await page.evaluate(()=>window.kaminosSceneObjectDebugState());assert.equal(copies.length,2);assert.ok(copies.every(x=>x.surfaceSplats.length===1));await page.evaluate(()=>window.kaminosSceneEdits.undo());await check();
  await page.evaluate(()=>window.kaminosSetSceneObjectTransform('surface-object',{position:[.15,0,0]}));
  const saved=await retain({name:'placed',capture:false,observe:()=>check()});await open(saved.filename);await check();
  await page.locator('#viewport').screenshot({path:out+'/reopened.png'});return {duplicate,copies,handoff:{filename:saved.filename,url:saved.url}};
 }});
 report.result=await Promise.race([exercise,failure]);assert.deepEqual(report.errors,[]);report.ok=true;report.phase='complete';
}catch(error){report.error=String(error.stack??error);process.exitCode=1;await page?.screenshot({path:out+'/failure.png'}).catch(()=>{});}
finally{await browser?.close();await save();console.log(JSON.stringify({ok:report.ok,phase:report.phase,error:report.error}));}
