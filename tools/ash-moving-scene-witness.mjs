import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {verifyAuthoringServer} from '../scene-authoring-witness-identity.mjs';
const args=new Map();for(let i=2;i<process.argv.length;i+=2)args.set(process.argv[i],process.argv[i+1]);
const origin=args.get('--url'),repo=resolve(args.get('--repo')),out=resolve(args.get('--out'));

mkdirSync(out,{recursive:true});const r={status:'running',phase:'source',requested:{origin,repo},errors:[],consoleErrors:[],frames:[],interventions:[]};let browser,page;const save=()=>writeFileSync(out+'/report.json',JSON.stringify(r,null,2));save();
try{
 r.server=await verifyAuthoringServer({origin,repoRoot:repo});r.sources={};for(const file of ['index.html','ash/scene-gpu.mjs','ash/scene-plan.mjs','ash/tile-plan.mjs','tools/ash-moving-scene-witness.mjs','ash/gpu-plan.mjs','ash/tile-gpu.mjs','ash/landscape-fixture.mjs','experiments/ash-gpu-deposition.experiment.mjs','experiments/ash-tiled-landscape.experiment.mjs','experiments/ash-scene-cloud.experiment.mjs']){const response=await fetch(new URL(file,origin));assert.ok(response.ok);const hash=b=>createHash('sha256').update(b).digest('hex');const actual=hash(Buffer.from(await response.arrayBuffer()));assert.equal(actual,hash(readFileSync(repo+'/'+file)));r.sources[file]=actual;}
 r.browserExecutable=args.get('--browser');assert.ok(r.browserExecutable.includes('Chrome for Testing')||r.browserExecutable.includes('chromium'),'independent browser required');const {chromium}=await import(args.get('--playwright'));
 browser=await chromium.launchPersistentContext(out+'/profile',{executablePath:r.browserExecutable,headless:true,viewport:{width:1440,height:1000},args:['--use-mock-keychain','--password-store=basic','--enable-unsafe-webgpu','--disable-gpu-sandbox','--use-angle=metal','--disable-background-timer-throttling','--disable-renderer-backgrounding']});page=browser.pages()[0];page.setDefaultTimeout(0);page.on('pageerror',e=>r.errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')r.consoleErrors.push(m.text());});
 r.phase='mount';save();await page.goto(origin+'/?workspace=workbench&experiment=ash-tiled-landscape');await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape'||document.body.innerText.includes('Experiments unavailable'));assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperiments?.state().id),'ash-tiled-landscape');
 r.url=page.url();const invoke=async(n,v)=>{if(n==='restore'){const file='intervention-'+r.interventions.length+'.json';writeFileSync(out+'/'+file,JSON.stringify(v));r.interventions.push({n,inputFile:file});}else r.interventions.push({n,v});save();return page.evaluate(([n,v])=>window.kaminosWorkbenchExperiments.invoke(n,v),[n,v]);};
 const frame=async name=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await invoke('settleFrame');const state=await invoke('read');assert.deepEqual(state.errors,[]);await page.screenshot({path:out+'/'+name+'.png'});await page.locator('#kaminos-host-renderer-canvas').screenshot({path:out+'/'+name+'-canvas.png'});r.frames.push({name,state});save();};
 await page.getByRole('button',{name:'Pause',exact:true}).click();r.initial=await invoke('read');assert.equal(r.initial.backend,'webgpu-connected-ash-tiles');assert.equal(r.initial.atmosphere.settings.enabled,false);assert.ok(r.initial.layout.bounds.max[0]-r.initial.layout.bounds.min[0]>7);assert.equal(await page.getByRole('checkbox',{name:'Scene ash enabled'}).count(),0);
 if(args.get('--negative-unmounted')==='yes'){await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());await invoke('read');throw Error('Unmounted route admitted');}
 await frame('00-covered-landscape');
 r.phase='moving-scene';save();const g=r.initial.identity.groundY;
 await invoke('contactEnabled',false);
 const before=await invoke('snapshot');writeFileSync(out+'/before.json',JSON.stringify(before));
 const timber=r.initial.sceneObjectIds.find(x=>x.name==='Fallen timber');assert.ok(timber,'individually registered timber');
 r.motion=[];
 for(const x of [1.8,1.6,1.4,1.2,1,.8,.6,.4,.2,0]){
  await page.evaluate(({id,position})=>window.kaminosSetSceneObjectTransform(id,{position}),{id:timber.id,position:[x,g+.125,1.8]});
  await invoke('advance',{steps:3});r.motion.push({...await invoke('read'),work:await invoke('diagnostics')});
 }
 await frame('01-timber-plough');
 await invoke('view',{position:[3,g+2.8,5],target:[.8,g+.15,1.8]});await frame('02-plough-close');
 const after=await invoke('snapshot');writeFileSync(out+'/after.json',JSON.stringify(after));
 assert.notDeepEqual(after.local.patch.values,before.local.patch.values);
 assert.ok(Math.abs(after.local.patch.retainedVolume-before.local.patch.retainedVolume)<1e-4);
 assert.equal(after.local.patch.collisionIdentity.length,before.local.patch.collisionIdentity.length);
 assert.equal(r.motion.at(-1).sceneCollision.shapeBuilds,r.initial.sceneCollision.shapeBuilds,'translation reuses local shape');
 r.mass={before:before.local.patch.retainedVolume,after:after.local.patch.retainedVolume};
 r.phase='added-native-mesh';save();
 r.added=await page.evaluate(g=>{const id=window.kaminosSceneAuthoring.addMesh('box',{width:.6,height:.3,depth:.6});window.kaminosSetSceneObjectTransform(id,{position:[-1,g+.15,-.8]});return id;},g);
 await invoke('advance',{steps:10});await frame('03-added-mesh');
 const addedState=await invoke('read');assert.ok(addedState.sceneCollision.members.some(m=>m.id===r.added));
 const addedSaved=await invoke('snapshot');
 await assert.rejects(()=>invoke('restore',before),/scene geometry or poses differ/);
 const afterRejected=await invoke('snapshot');assert.deepEqual(afterRejected.local.patch.values,addedSaved.local.patch.values,'rejected scene mismatch preserves material');
 await page.evaluate(id=>window.kaminosSetSceneObjectTransform(id,{rotation:[0,.7,.2],scale:[1.3,.8,1.1]}),r.added);await invoke('advance',{steps:3});
 r.scaled=await invoke('read');assert.ok(r.scaled.sceneCollision.shapeBuilds>addedState.sceneCollision.shapeBuilds,'scale resolves a finer local shape');
 await page.evaluate(id=>window.kaminosSceneAuthoring.setGeometry(id,{parameters:{width:.9}}),r.added);await invoke('advance',{steps:3});
 r.edited=await invoke('read');assert.ok(r.edited.sceneCollision.shapeBuilds>r.scaled.sceneCollision.shapeBuilds,'geometry edit rebuilds collision');
 await page.evaluate(id=>{window.kaminosSelection.set([id],id);return window.kaminosSelection.remove();},r.added);
 await invoke('advance',{steps:10});r.removed=await invoke('read');assert.ok(!r.removed.sceneCollision.members.some(m=>m.id===r.added));
 await page.evaluate(({id,position})=>window.kaminosSetSceneObjectTransform(id,{position}),{id:timber.id,position:[0,g+1,1.8]});
 await invoke('advance',{steps:15});await frame('04-released-support');
 r.end=await invoke('snapshot');writeFileSync(out+'/end.json',JSON.stringify(r.end));assert.ok(Math.abs(r.end.local.patch.retainedVolume-r.mass.before)<1e-4);const continuation=r.end;delete r.end;
 r.phase='reconstruction';save();await page.reload();await page.waitForFunction(()=>window.kaminosWorkbenchExperiments?.state().id==='ash-tiled-landscape');await invoke('play',false);await invoke('restore',continuation);
 const reopened=await invoke('snapshot');assert.deepEqual(reopened.local.patch.values,continuation.local.patch.values);assert.deepEqual(reopened.local.patch.collisionIdentity,continuation.local.patch.collisionIdentity);r.reopened=true;await frame('05-reopened');
 await invoke('advance',{steps:3});const next=await invoke('snapshot');assert.ok(Math.abs(next.local.patch.retainedVolume-r.mass.before)<1e-4);r.continued=true;

 r.final=await invoke('read');for(const [file,digest] of Object.entries(r.sources)){assert.equal(createHash('sha256').update(readFileSync(repo+'/'+file)).digest('hex'),digest,'source changed during witness: '+file);}r.status='passed';r.phase='complete';assert.deepEqual(r.errors,[]);assert.deepEqual(r.consoleErrors,[]);
}catch(e){r.status='failed';r.error=String(e.stack??e);if(page){r.text=await page.locator('body').innerText().catch(String);await page.screenshot({path:out+'/failed.png'}).catch(()=>{});}process.exitCode=1;}finally{await browser?.close();r.browserClosed=true;save();console.log(JSON.stringify({status:r.status,phase:r.phase,error:r.error,out}));}
