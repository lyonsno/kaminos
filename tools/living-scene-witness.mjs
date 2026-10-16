import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export function validateActors(read,setup){
 assert.equal(read?.actors?.length,setup.actors.length,'Missing/extra creature');
 assert.equal(new Set(read.actors.map(a=>a.state.host.id)).size,setup.actors.length,'Overlaid/shared registration');
 for(const actor of setup.actors){const state=read.actors.find(a=>a.id===actor.id)?.state;assert.ok(state?.host?.id,'Missing actor registration');assert.notEqual(state.playback.status,'removed');
  for(const [field,key]of [['caseSha256','case_sha256'],['motionSha256','motion_sha256'],['frameSha256','frame_sha256']])assert.equal(state.source[field],actor.creature[key],`Wrong actor ${field}`);
  assert.equal(state.deformation.requested,actor.creature.deformation??'cpu');assert.equal(state.deformation.effective,actor.creature.deformation==='gpu'?'webgpu-dense-dq':'cpu-reference','Silent deformation fallback');assert.equal(state.actorRoot.effective,'live-pelvis','Stale spawn root');}
}
const hash=data=>createHash('sha256').update(data).digest('hex');
export async function witness(args){
 const out=resolve(args.out);mkdirSync(out,{recursive:true});const report={schema:'kaminos.living-scene-witness.v1',status:'running',phase:'inputs',requested:args,errors:[],captures:[],continuous:[]};
 const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');let phase=report.phase;Object.defineProperty(report,'phase',{enumerable:true,get:()=>phase,set:value=>{phase=value;persist();}});persist();let browser,context,page;
 try{
  const root=realpathSync(args.root),setup=JSON.parse(readFileSync(args.setup)),world=JSON.parse(readFileSync(args.world));report.setupSha256=hash(readFileSync(args.setup));report.worldSha256=hash(readFileSync(args.world));
  const {chromium}=await import(args.playwright),executable=realpathSync(args.chrome);assert.ok(!executable.includes('/Applications/Google Chrome.app/'),'Independent automation browser required');report.effectiveExecutable=executable;
  report.phase='browser';browser=await chromium.launch({headless:true,executablePath:executable,args:['--use-mock-keychain','--password-store=basic','--no-first-run']});report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:1700,height:1120},recordVideo:{dir:join(out,'video'),size:{width:1700,height:1120}}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  report.phase='load';await page.goto(args.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.kaminosCreatureActors||window.kaminosWorkbenchExperimentError);assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperimentError??null),null);
  report.effectiveUrl=page.url();report.runtime=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.source.commit,args.commit);
  report.source=[];for(const file of ['experiments/creature-motion/living-scene.experiment.mjs','experiments/creature-motion/walking.experiment.mjs','experiments/creature-motion/live-actor-root.mjs','experiments/creature-motion/given-palette-playback.mjs']){const response=await page.request.get(new URL('/'+file,page.url()).href);assert.equal(response.status(),200);const sha256=hash(await response.body());assert.equal(sha256,hash(readFileSync(join(root,file))));report.source.push({file,sha256});}
  const read=()=>page.evaluate(()=>window.kaminosCreatureActors.read()),invoke=(operation,input)=>page.evaluate(({operation,input})=>window.kaminosWorkbenchExperiments.invoke(operation,input),{operation,input});
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  // Check the hit target, dispatch native pointer input, then observe domain
  // state explicitly. A perpetual render loop is not page/navigation idleness.
  const click=async locator=>{const box=await locator.boundingBox();assert.ok(box,'Native control has no hit box');const point={x:box.x+box.width/2,y:box.y+box.height/2};assert.ok(await locator.evaluate((node,p)=>node.contains(document.elementFromPoint(p.x,p.y)),point),'Native control is occluded');await page.mouse.click(point.x,point.y);};
  const capture=async name=>{await settle();const image=join(out,name+'.png');await page.screenshot({path:image});report.captures.push(image);return image;};
  report.initial=await read();validateActors(report.initial,setup);report.registrations=await page.evaluate(()=>window.kaminosSceneObjectDebugState());
  for(const object of world.objects)assert.ok(report.registrations.some(row=>row.id===object.id),`Prepared world object missing: ${object.id}`);
  const [a,b,c]=setup.actors.map(a=>a.id),rootBone=await page.evaluate(async setup=>{const r=await fetch(setup.actors[0].creature.case+'/manifest.json');return (await r.json()).bones.find(b=>b.parent===null).name;},setup);
  const poses=()=>page.evaluate(({ids,rootBone})=>Object.fromEntries(ids.map(id=>[id,window.kaminosCreatureActors.pose(id,{bones:[rootBone]})])),{ids:[a,b,c],rootBone});
  report.posesInitial=await poses();for(const pose of Object.values(report.posesInitial))for(const i of [12,13,14])assert.ok(Math.abs(pose.rootMatrix[i]-pose.bones[0].matrix[i])<1e-6,'Live handle does not follow actual root Bone');
  await page.evaluate(()=>window.kaminosViewportSettings.set({bones:false,paths:false}));await capture('world-initial');
  report.phase='context-selection';for(const id of [a,b,c]){report.phase='select-'+id;await invoke('select',{id});await settle();assert.equal(await page.locator('.creature-properties:not([hidden])').count(),1,'Several property panels active');assert.equal(await page.locator('.scene-owner-playback:not([hidden])').count(),1,'Several playback bars active');assert.equal(await page.locator('.creature-properties:not([hidden]) strong').textContent(),setup.actors.find(a=>a.id===id).label);}
  report.phase='native-play';
  await invoke('select',{id:a});await click(page.getByRole('button',{name:'↻ Replay',exact:true}));
  await page.waitForFunction(id=>window.kaminosCreatureActors.read().actors.find(a=>a.id===id).state.action.motion.elapsed>.4,a);await click(page.locator('.scene-owner-playback:not([hidden]) .playback-play'));
  report.afterNativePlay=await read();assert.ok(report.afterNativePlay.actors.find(row=>row.id===a).state.action.motion.elapsed>report.initial.actors.find(row=>row.id===a).state.action.motion.elapsed);
  assert.deepEqual(report.afterNativePlay.actors.find(row=>row.id===b).state.action.motion,report.initial.actors.find(row=>row.id===b).state.action.motion,'Local transport advanced a neighbour');
  await invoke('actor',{id:b,operation:'play'});await invoke('actor',{id:a,operation:'play'});await page.waitForFunction(id=>window.kaminosCreatureActors.read().actors.find(a=>a.id===id).state.action.motion.elapsed>.35,b);await invoke('actor',{id:a,operation:'pause'});
  report.onePaused=await read();const paused=report.onePaused.actors.find(row=>row.id===a).state.action.motion.elapsed,other=report.onePaused.actors.find(row=>row.id===b).state.action.motion.elapsed;
  await page.waitForFunction(({id,elapsed})=>window.kaminosCreatureActors.read().actors.find(a=>a.id===id).state.action.motion.elapsed>elapsed+.3,{id:b,elapsed:other});await invoke('actor',{id:b,operation:'pause'});report.neighbourContinued=await read();assert.equal(report.neighbourContinued.actors.find(row=>row.id===a).state.action.motion.elapsed,paused);
  report.phase='ordinary-scene-edit';await invoke('select',{id:a});const point=report.neighbourContinued.actors.find(row=>row.id===a).state.transform.position,next=point[0]+.35;
  const field=page.locator('input[data-transform-field="position.x"]');await field.click();await field.fill(String(next));await field.press('Enter');await settle();
  report.edited=await read();assert.ok(Math.abs(report.edited.actors.find(row=>row.id===a).state.transform.position[0]-next)<1e-6);assert.deepEqual(report.edited.actors.find(row=>row.id===b).state.actorRoot,report.neighbourContinued.actors.find(row=>row.id===b).state.actorRoot);
  await invoke('actor',{id:a,operation:'advance',input:{seconds:1/30}});report.afterEditAdvance=await poses();for(const i of [12,13,14])assert.ok(Math.abs(report.afterEditAdvance[a].rootMatrix[i]-report.afterEditAdvance[a].bones[0].matrix[i])<1e-6);
  await page.evaluate(()=>window.kaminosViewportSettings.set({gizmos:true}));await capture('selected-live-handle');
  report.phase='cast-isolation';const before=await read(),oldB=before.actors.find(row=>row.id===b),choice=setup.actors[0].creature.choices.find(choice=>choice.attachment==='distributed'&&choice.case_sha256!==before.actors.find(row=>row.id===a).state.source.caseSha256);
  await page.getByLabel('Creature cast',{exact:true}).filter({visible:true}).selectOption(choice.cast);await page.waitForFunction(({id,sha})=>window.kaminosCreatureActors.read().actors.find(a=>a.id===id).state.source.caseSha256===sha,{id:a,sha:choice.case_sha256});
  report.castChanged=await read();assert.deepEqual(report.castChanged.actors.find(row=>row.id===b),oldB,'Cast exchange changed a neighbour');
  await invoke('actor',{id:a,operation:'skin',input:{cast:setup.actors[0].creature.choices.find(c=>c.case_sha256===setup.actors[0].creature.case_sha256).cast,attachment:'distributed'}});
  report.phase='continuous-motion';await page.evaluate(()=>window.kaminosViewportSettings.set({bones:false,paths:false,gizmos:false}));await page.evaluate(()=>window.kaminosSelection.clear());
  const fps=(await read()).actors[0].state.playback.fps;for(let i=0;i<20;i++){const state=await read(),pose=await poses(),image=await capture('frame-'+String(i).padStart(2,'0'));writeFileSync(join(out,'frame-'+String(i).padStart(2,'0')+'.json'),JSON.stringify({state,pose})+'\n');report.continuous.push({index:i,image,elapsed:state.actors.map(a=>({id:a.id,elapsed:a.state.action.motion.elapsed,frame:a.state.playback.frame})),pose});if(i<19)for(const id of [a,b,c])await invoke('actor',{id,operation:'advance',input:{seconds:1/fps}});}
  for(let i=1;i<20;i++)for(let j=0;j<3;j++)assert.ok(Math.abs(report.continuous[i].elapsed[j].elapsed-report.continuous[i-1].elapsed[j].elapsed-1/fps)<1e-8);
  report.phase='local-duplicate-remove';await invoke('select',{id:b});await page.getByRole('button',{name:'Duplicate creature',exact:true}).click();await page.waitForFunction(()=>window.kaminosCreatureActors.read().actors.length===4);report.duplicated=await read();const added=report.duplicated.actors.find(row=>![a,b,c].includes(row.id));assert.ok(added);await invoke('select',{id:added.id});await page.getByRole('button',{name:'Remove creature',exact:true}).click();await page.waitForFunction(()=>window.kaminosCreatureActors.read().actors.length===3);report.afterRemove=await read();
  report.phase='cohort-roundtrip';const saved=report.afterRemove.recipe;await page.evaluate(recipe=>window.kaminosWorkbenchExperiments.open('mushfinger/living-scene',recipe),saved);report.reopened=await read();validateActors(report.reopened,setup);for(const row of report.afterRemove.actors){const next=report.reopened.actors.find(a=>a.id===row.id);assert.deepEqual(next.state.actorRoot.authoredTransform,row.state.actorRoot.authoredTransform);assert.deepEqual(next.state.action.motion,row.state.action.motion);}
  await page.evaluate(()=>window.kaminosViewportSettings.set({bones:false,paths:false,gizmos:true}));await invoke('select',{id:a});await capture('reopened-context');assert.deepEqual(report.errors,[]);report.status='complete';report.phase='complete';
 }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};if(page)try{report.failureState=await page.evaluate(()=>window.kaminosCreatureActors?.read()??{error:window.kaminosWorkbenchExperimentError});await page.screenshot({path:join(out,'failure.png')});}catch{}throw error;}
 finally{await context?.close().catch(e=>report.errors.push(e.message));if(browser){await browser.close();report.browserClosed=true;}persist();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];await witness(args);}
