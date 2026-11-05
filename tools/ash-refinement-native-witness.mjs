import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const out=resolve(args.get('--out')),repo=resolve(args.get('--repo')),origin=args.get('--url');mkdirSync(out,{recursive:true});
const report={status:'running',phase:'source',requested:{repo,origin},errors:[],consoleErrors:[],frames:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();let browser,page;
try{
 report.identity=await verifyAuthoringServer({origin,repoRoot:repo});report.sources={};
 for(const name of ['index.html','ash/refinement-gpu.mjs','ash/refinement-shader.mjs','ash/refinement-surface.mjs','ash/refinement-wgsl.mjs','ash/scene-object.mjs','ash/refinement-controls.mjs','tools/ash-refinement-native-witness.mjs']){
  const remote=await fetch(new URL(name,origin));assert.ok(remote.ok);const hash=b=>createHash('sha256').update(b).digest('hex');
  const digest=hash(Buffer.from(await remote.arrayBuffer()));assert.equal(digest,hash(readFileSync(resolve(repo,name))));report.sources[name]=digest;
 }
 report.launch=fluidBrowserLaunch({executable:args.get('--browser'),debugPort:0,userDataDir:out+'/profile',width:1280,height:900});
 const {chromium}=await import(args.get('--playwright'));browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:report.launch.executable,headless:true,viewport:{width:1280,height:900},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal']});
 page=browser.pages()[0];page.on('pageerror',e=>report.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const capture=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:out+'/'+name+'.png'});report.frames.push(name);save();};
 const snapshot=async(name,id)=>{const value=await page.evaluate(id=>window.kaminosAsh.snapshot(id),id);writeFileSync(out+'/'+name+'.json',JSON.stringify(value));return value;};
 report.phase='native-mount';save();await page.goto(new URL('/?workspace=authoring',origin).href);
 await page.waitForFunction(()=>window.kaminosAsh&&window.kaminosWorkspace&&window.kaminosWorkbenchExperiments&&window.kaminosSceneAuthoring&&window.__kaminosSetSceneCameraFrame);
 report.objects=await page.evaluate(async()=>{
  window.kaminosWorkspace.setMode('authoring');
  const box=window.kaminosSceneAuthoring.addMesh('box',{width:.4,height:.24,depth:.5});window.kaminosSetSceneObjectTransform(box,{position:[-.8,.12,0]});
  const platform=window.kaminosSceneAuthoring.addMesh('box',{width:.8,height:.16,depth:.6});window.kaminosSetSceneObjectTransform(platform,{position:[.4,.32,-.2]});
  const pillar=window.kaminosSceneAuthoring.addMesh('box',{width:.3,height:.64,depth:.3});window.kaminosSetSceneObjectTransform(pillar,{position:[.8,.32,.7]});
  const id=await window.kaminosAsh.add({width:3.2,depth:3.2,height:.96,cellSize:.04,initialDepth:.12,sourcePosition:[0,.8,0],paused:true,softNormals:true,refinement:{ratio:2,regions:[{min:[-.64,0,-.64],max:[.96,.64,.96]}]}},[0,0,0]);
  const source=await window.kaminosAsh.addSource({fieldId:id,position:[.4,.85,-.2],spread:.24,rate:.024});
  window.__kaminosSetSceneCameraFrame([3.5,2.6,4],[0,.1,0]);window.selectSceneObject(id);window.kaminosViewportSettings.set({overlays:false,gizmos:false});
  return {box,platform,pillar,id,source};
 });
 const {id,source,box}=report.objects;
 report.initial=await page.evaluate(id=>({ash:window.kaminosAsh.read(id),gi:window.kaminosSceneGIDebugState()}),id);
 assert.equal(report.initial.ash.runtime.backend,'webgpu-coarse-fine-ash');assert.equal(report.initial.gi.effectiveMode,'combined');
 await capture('01-refined-layer');const before=await snapshot('before',id);
 report.phase='moving-object';save();
 for(const x of [-.64,-.48,-.32,-.16,0,.16,.32,.48,.64])await page.evaluate(async({id,box,x})=>{window.kaminosSetSceneObjectTransform(box,{position:[x,.12,.35]});await window.kaminosAsh.advance(id,2);},{id,box,x});
 const moved=await snapshot('moved',id);assert.notDeepEqual(moved.ash.checkpoint.values,before.ash.checkpoint.values);assert.ok(Math.abs(moved.ash.checkpoint.retainedVolume-moved.ash.checkpoint.volume)<1e-5);
 await capture('02-moving-box');
 report.phase='sources';save();
 await page.evaluate(async id=>{for(let i=0;i<48;i++)await window.kaminosAsh.advance(id,1);},id);
 const emitted=await snapshot('emitted',id);assert.ok(emitted.ash.checkpoint.volume>moved.ash.checkpoint.volume);report.emittedVolume=emitted.ash.checkpoint.volume-moved.ash.checkpoint.volume;
 await capture('03-deposition');
 report.phase='native-save';save();
 report.saved=await page.evaluate(()=>window.saveSceneAs({result:true}));assert.ok(report.saved?.ok,JSON.stringify(report.saved));
 report.savedName=report.saved.saved??report.saved.filename??report.saved.name;
 report.savedDocument=await (await fetch(new URL('/api/read?root=scenes&path='+encodeURIComponent(report.savedName),origin))).json();
 writeFileSync(out+'/scene.json',JSON.stringify(report.savedDocument));
 report.phase='reopen';save();
 await page.goto(report.saved.url);
 await page.waitForFunction(id=>window.kaminosWorkbenchExperiments&&window.kaminosSceneObjectDebugState().some(e=>e.id===id)&&window.kaminosAsh.read(id).runtime.backend==='webgpu-coarse-fine-ash',id);
 const reopened=await snapshot('reopened',id);assert.deepEqual(reopened.ash.checkpoint.values,emitted.ash.checkpoint.values);assert.equal(await page.evaluate(source=>window.kaminosAsh.readSource(source).settings.fieldId,source),id);
 await capture('04-reopened');
 report.phase='inspector-reset';save();
 await page.evaluate(id=>{window.selectSceneObject(id);window.kaminosViewportSettings.set({overlays:true,gizmos:true});},id);
 const detail=page.locator('#selected-ash-properties details').filter({has:page.getByText('Coarse and fine regions',{exact:true})});await detail.evaluate(e=>e.open=true);
 await page.locator('[data-ash-cell]').click();await page.locator('[data-ash-cell]').fill('.032');await page.locator('[data-ash-cell]').press('Tab');await page.locator('[data-ash-regrid]').click();
 await page.waitForFunction(id=>window.kaminosAsh.read(id).settings.cellSize===.032&&!window.kaminosAsh.read(id).busy,id);
 report.reset=await page.evaluate(({id,source})=>({ash:window.kaminosAsh.read(id),source:window.kaminosAsh.readSource(source)}),{id,source});assert.equal(report.reset.ash.runtime.volume,0);assert.equal(report.reset.source.settings.fieldId,id);assert.equal(report.reset.ash.settings.refinement.ratio,2);
 await page.evaluate(async id=>{await window.kaminosAsh.cover(id,.12);await window.kaminosAsh.advance(id,12);},id);
 await capture('05-finer-reset-inspector');
 report.final=await page.evaluate(id=>window.kaminosAsh.read(id),id);assert.equal(report.final.failure,null);
 assert.deepEqual(report.errors,[]);assert.deepEqual(report.consoleErrors,[]);
 report.status='passed';report.phase='complete';
}catch(error){report.status='failed';report.error=String(error.stack??error);if(page){report.lastText=await page.locator('body').innerText().catch(String);await page.screenshot({path:out+'/failed.png'}).catch(()=>{});}process.exitCode=1;}
finally{await browser?.close();report.browserClosed=true;save();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));}
