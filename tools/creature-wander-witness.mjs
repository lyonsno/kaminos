import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import * as THREE from '../lib/three.core.js';
import {validateCreatureControlRead,validateWanderObservation,validateWanderProgress} from './creature-controls-witness.mjs';
const hash=data=>createHash('sha256').update(data).digest('hex');
export async function witness(args){
 const out=resolve(args.out),root=realpathSync(args.root);mkdirSync(out,{recursive:true});
 const report={schema:'kaminos.creature-wander-witness.v1',status:'running',phase:'inputs',requested:args,errors:[],captures:[],continuous:[]};
 let browser,context,page;
 const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');persist();
 try{
  const setup=JSON.parse(readFileSync(args.setup));report.setupSha256=hash(readFileSync(args.setup));report.requestedUrl=args.url;
  const {chromium}=await import(args.playwright),executable=realpathSync(args.chrome);assert.ok(!executable.includes('/Applications/Google Chrome.app/'),'Independent test browser required');
  report.effectiveExecutable=executable;report.phase='browser';browser=await chromium.launch({headless:true,executablePath:executable,args:['--use-mock-keychain','--password-store=basic','--no-first-run']});report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:1600,height:1100},recordVideo:{dir:join(out,'video'),size:{width:1600,height:1100}}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  report.phase='load';await page.goto(args.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.kaminosWalkingCreature==='function');
  report.effectiveUrl=page.url();report.runtime=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.source.commit,args.commit);
  report.source=[];for(const file of ['index.html','scene-owner-controls.mjs','playback-controls.mjs','experiments/creature-motion/creature-properties.mjs','experiments/creature-motion/walking.experiment.mjs','experiments/creature-motion/wander-motion.mjs','experiments/creature-motion/wander-path.mjs','experiments/creature-motion/full-body-runtime.mjs']){const response=await page.request.get(new URL('/'+file,page.url()).href);assert.equal(response.status(),200);const actual=hash(await response.body());assert.equal(actual,hash(readFileSync(join(root,file))));report.source.push({file,sha256:actual});}
  const read=()=>page.evaluate(()=>({...window.kaminosWalkingCreature({geometry:true}),registration:window.kaminosSceneObjectDebugState()}));
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const capture=async name=>{await settle();const path=join(out,name+'.png');await page.screenshot({path});report.captures.push(path);return path;};
  report.initial=await read();validateCreatureControlRead(report.initial,setup);validateWanderObservation(report.initial);assert.notEqual(report.initial.playback.status,'playing');
  report.deformationRoute=report.initial.skin.route;assert.equal(report.deformationRoute,'shared-owner-scene-full-body-dq');report.deformationBackend='CPU-reference DQ deformation; WebGPU scene rendering';
  await capture('initial');report.phase='native-sustained-playback';
  await page.getByRole('button',{name:'↻ Replay',exact:true}).click();
  await page.waitForFunction(()=>{const r=window.kaminosWalkingCreature({geometry:false});return r.action.motion.cycle>=1;});
  report.live=await read();assert.equal(report.live.playback.status,'playing');report.liveProgress=validateWanderProgress(report.initial,report.live,{minimumCycles:1});
  await page.locator('.playback-play').click();report.held=await read();assert.notEqual(report.held.playback.status,'playing');
  await settle();report.heldAfter=await read();assert.deepEqual(report.heldAfter.action.motion,report.held.action.motion,'Pause left the action advancing');
  report.phase='ordinary-area-edit';await page.getByRole('button',{name:'Edit wander area',exact:true}).click();
  assert.equal(await page.locator('.scene-owner-playback').isVisible(),true,'Area selection hides the creature transport');
  const input=page.locator('input[data-transform-field="position.x"]');assert.equal(await input.isVisible(),true);assert.equal(await input.isEnabled(),true);
  const nextX=report.held.action.area.transform.position[0]+6;await input.click();await input.fill(String(nextX));await input.press('Enter');await settle();
  report.areaEdited=await read();assert.equal(report.areaEdited.action.area.transform.position[0],nextX);assert.deepEqual(report.areaEdited.action.motion.path.position,report.held.action.motion.path.position,'Editing area teleports the creature');
  await capture('edited-area');
  report.phase='save-open';await page.getByText('Save / open creature',{exact:true}).click();const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'Save creature setup',exact:true}).click();const download=await downloading,saved=join(out,'saved-creature.json');await download.saveAs(saved);report.saved=JSON.parse(readFileSync(saved));
  const previousId=report.areaEdited.host.id;await page.getByLabel('Open creature setup',{exact:true}).setInputFiles(saved);
  await page.waitForFunction(id=>typeof window.kaminosWalkingCreature==='function'&&window.kaminosWalkingCreature({geometry:false}).host.id!==id,previousId);
  report.reopened=await read();validateCreatureControlRead(report.reopened,setup);validateWanderObservation(report.reopened);
  assert.deepEqual(report.reopened.action.motion.path.position,report.areaEdited.action.motion.path.position);assert.deepEqual(report.reopened.action.area.transform,report.areaEdited.action.area.transform);assert.notEqual(report.reopened.playback.status,'playing');
  assert.notDeepEqual(report.reopened.action.motion.path.area,report.held.action.motion.path.area,'Paused edit did not control the reopened path');
  report.areaApplied=report.reopened;
  await capture('reopened');
  report.phase='endpoint-resume';
  await page.evaluate(()=>{const frames=window.kaminosWalkingCreature({geometry:false}).playback.frames;return window.kaminosWorkbenchExperiments.invoke('seek',{frame:frames-1});});
  report.endpointHeld=await read();await page.locator('.playback-play').click();
  await page.waitForFunction(time=>window.kaminosWalkingCreature({geometry:false}).action.motion.elapsed>time+.2,report.endpointHeld.action.motion.elapsed);await page.locator('.playback-play').click();
  report.endpointResumed=await read();validateWanderProgress(report.endpointHeld,report.endpointResumed);
  report.phase='consecutive-action-frames';
  const initial=report.endpointResumed.action.motion,elapsed=initial.elapsed,period=initial.period,fps=report.reopened.playback.fps;
  // Twenty adjacent samples straddle a source seam, not twenty selected poses.
  const untilSeam=(Math.floor(elapsed/period)+1)*period-elapsed;
  await page.evaluate(seconds=>window.kaminosWorkbenchExperiments.invoke('advance',{seconds}),Math.max(0,untilSeam-9/fps));
  report.continuousKind='20 consecutive controlled active-time steps at retained source fps; separate live playback evidence above';
  await page.evaluate(()=>window.kaminosViewportSettings.set({bones:false,paths:false}));
  for(let i=0;i<20;i++){
   const state=await read();validateWanderObservation(state);
   const posePath=join(out,'frame-'+String(i).padStart(2,'0')+'.json');writeFileSync(posePath,JSON.stringify(state)+'\n');
   const bodyBox=new THREE.Box3().setFromArray(state.vertices).applyMatrix4(new THREE.Matrix4().fromArray(state.rootMatrix)),center=bodyBox.getCenter(new THREE.Vector3()),size=bodyBox.getSize(new THREE.Vector3()),distance=size.length()*1.15;
   const camera=await page.evaluate(({center,distance})=>window.__kaminosSetSceneCameraFrame([center[0]+distance*.7,center[1]+distance*.27,center[2]-distance*.7],center),{center:center.toArray(),distance});
   const image=await capture('frame-'+String(i).padStart(2,'0'));
   report.continuous.push({index:i,elapsed:state.action.motion.elapsed,sourceFrame:state.playback.frame,cycle:state.action.motion.cycle,path:state.action.motion.path,bodyBox:{min:bodyBox.min.toArray(),max:bodyBox.max.toArray()},camera,posePath,image});
   if(i<19)await page.evaluate(seconds=>window.kaminosWorkbenchExperiments.invoke('advance',{seconds}),1/fps);
  }
  for(let i=1;i<20;i++)assert.ok(Math.abs(report.continuous[i].elapsed-report.continuous[i-1].elapsed-1/fps)<1e-9);
  for(let i=1;i<20;i++)assert.equal(report.continuous[i].sourceFrame,(report.continuous[i-1].sourceFrame+1)%(report.reopened.playback.frames-1),'Exact consecutive steps skipped a retained source frame');
  assert.ok(report.continuous.at(-1).cycle>report.continuous[0].cycle,'Consecutive sample window did not cross the source seam');
  // Native playback must also continue after the ordinary edited-area roundtrip.
  report.phase='resume-edited-area';const before=await read();await page.locator('.playback-play').click();await page.waitForFunction(time=>window.kaminosWalkingCreature({geometry:false}).action.motion.elapsed>time+.5,before.action.motion.elapsed);await page.locator('.playback-play').click();report.afterResume=await read();validateWanderProgress(before,report.afterResume);
  report.phase='close';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());report.afterClose=await page.evaluate(()=>({objects:window.kaminosSceneObjectDebugState(),scene:window.kaminosWorkbenchSceneState()}));
  for(const id of [report.reopened.host.id,report.reopened.action.area.id])assert.ok(!report.afterClose.objects.some(row=>row.id===id),'Disposed action left a registered object');
  assert.deepEqual(report.errors,[]);report.status='complete';report.phase='complete';
 }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};if(page)try{report.failureState=await page.evaluate(()=>typeof window.kaminosWalkingCreature==='function'?window.kaminosWalkingCreature({geometry:false}):null);await page.screenshot({path:join(out,'failure.png')});}catch{}throw error;}
 finally{if(context)await context.close().catch(e=>report.errors.push(e.message));if(browser){await browser.close();report.browserClosed=true;}persist();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];await witness(args);}
