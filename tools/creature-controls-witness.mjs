import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as THREE from '../lib/three.core.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function validateCreatureBackendRead(r,requested){
 assert.ok(['cpu','gpu'].includes(requested),'Unknown requested deformation');
 const effective=requested==='gpu'?'webgpu-dense-dq':'cpu-reference';
 assert.equal(r.deformation?.requested,requested);assert.equal(r.deformation?.effective,effective);
 assert.equal(r.skin.deformation.backend,effective);
 if(requested==='gpu'){assert.ok(r.skin.deformation.dispatches>0,'GPU request has not drawn');assert.equal(r.skin.deformation.pending,false,'GPU pose has not been presented');}
 return {requested,effective,dispatches:r.skin.deformation.dispatches??null};
}
export function validateCreatureGpuGeometry(gpu,cpu){
 assert.equal(gpu.backend,'webgpu-dense-dq');assert.ok(gpu.dispatches>0);
 assert.equal(gpu.positions.length,cpu.vertices.length);assert.equal(gpu.normals.length,cpu.vertices.length);
 assert.ok(gpu.positions.every(Number.isFinite)&&gpu.normals.every(Number.isFinite),'Invalid GPU geometry');
 let maxError=0;for(let i=0;i<cpu.vertices.length;i++)maxError=Math.max(maxError,Math.abs(gpu.positions[i]-cpu.vertices[i]));
 assert.ok(maxError<.0001,'Native GPU positions differ from current CPU pose: '+maxError);
 return {vertices:gpu.positions.length/3,maxError,tolerance:.0001,backend:gpu.backend,dispatches:gpu.dispatches};
}
export function validateCreatureControlRead(r,setup){
 assert.equal(r.host.route,'shared-owner-scene');assert.equal(r.host.scene.rendererBackend,'webgpu');
 assert.equal(r.source.frameSha256,setup.frame_sha256);assert.equal(r.source.caseSha256,r.currentSkin.current.case_sha256);
 assert.equal(r.currentSkin.pending,null);assert.equal(r.skin.bones,28);assert.ok(r.skin.vertices>0);
 assert.ok(Number.isInteger(r.playback.frame)&&r.playback.frame>=0&&r.playback.frame<r.playback.frames);
 assert.ok(r.transform.position.every(Number.isFinite));assert.ok(r.host.id);
 assert.ok(r.registration?.some(row=>row.id===r.host.id&&row.objectVisible),'Creature is not registered and visible');
 assert.equal(r.vertices?.length,r.skin.vertices*3);assert.ok(r.vertices.every(Number.isFinite));assert.ok(r.vertices.some(v=>v!==0));
}
export function validateCreatureDisplayRead(r,{helpers=true,bones=true,paths=false,mode=r.mode,motionId,minimumCycle}={}){
 assert.equal(r.display.castsShadows,true);assert.equal(r.display.receivesShadows,true);
 assert.equal(r.display.boneMarkers.length,28,'Actual Bone-marker inventory is missing');
 assert.ok(r.display.boneMarkers.every(b=>b.visible===(helpers&&bones)),'Bone visibility differs from effective viewport settings');
 assert.equal(r.mode,mode);assert.equal(r.source.presentation.mode,mode);assert.equal(r.pathGuide.mode,mode);assert.equal(r.pathGuide.visible,helpers&&paths);
 assert.ok(r.pathGuide.points>=2);if(mode==='path'){assert.equal(r.pathGuide.kind,'complete-circular-rail');assert.equal(r.pathGuide.points,129);}
 if(motionId!==undefined)assert.equal(r.motion?.id,motionId,'Effective motion differs from requested switch');
 if(minimumCycle!==undefined)assert.ok(r.cycle>=minimumCycle,'Requested repeat cycle has not completed');
}
export function validateCreatureFrameRead(r,camera){
 assert.ok(r.vertices?.length>=6&&r.vertices.every(Number.isFinite));assert.equal(r.rootMatrix?.length,16);
 const box=new THREE.Box3().setFromArray(r.vertices).applyMatrix4(new THREE.Matrix4().fromArray(r.rootMatrix)),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
 const expectedDistance=size.length()/2*Math.sqrt(1+Math.max(camera.projectionMatrix[0],camera.projectionMatrix[5])**2)*1.12;
 assert.ok(new THREE.Vector3().fromArray(camera.target).distanceTo(center)<1e-5,'Frame target is not the current body center');
 const actualDistance=new THREE.Vector3().fromArray(camera.position).distanceTo(center);assert.ok(Math.abs(actualDistance-expectedDistance)<1e-5,'Frame distance includes empty travel or helper bounds');
 return {bodyCenter:center.toArray(),bodySize:size.toArray(),expectedDistance,actualDistance,camera};
}
export function validateWanderObservation(r){
 const a=r.action,m=a?.motion,p=m?.path;
 assert.equal(a?.kind,'wander');assert.equal(a.error,null);assert.equal(a.area?.mounted,true);
 assert.ok(r.registration.some(row=>row.id===a.area.id&&row.objectVisible),'Wander area is not actually registered and visible');
 assert.equal(m.sourceKey,r.source.motionSha256+':'+r.source.frameSha256,'Wander uses a stale motion/bind source');
 assert.ok(Number.isFinite(m.elapsed)&&m.elapsed>=0);assert.ok(Number.isInteger(m.cycle)&&m.cycle>=0);
 assert.ok(Number.isFinite(p.distance)&&p.distance>=0);assert.ok(p.position.length===2&&p.position.every(Number.isFinite));
 const root=r.boneWorld.find(b=>b.name==='pelvis');assert.ok(root,'Observed rig has no actual pelvis root');
 const position=new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().fromArray(root.matrix)).applyMatrix4(new THREE.Matrix4().fromArray(r.placementMatrix).invert());
 assert.ok(Math.hypot(position.x-p.position[0],position.z-p.position[1])<1e-5,'Reported path does not drive the actual root Bone');
 return {rootInPlacement:position.toArray(),elapsed:m.elapsed,cycle:m.cycle,distance:p.distance,position:p.position};
}
export function validateWanderProgress(before,after,{minimumCycles=0}={}){
 const a=validateWanderObservation(before),b=validateWanderObservation(after);
 assert.ok(b.elapsed>a.elapsed,'Action clock did not advance');assert.ok(b.distance>a.distance,'Source-paced travel did not advance');
 assert.ok(b.cycle-a.cycle>=minimumCycles,'Wander did not cross the requested source-clip boundary');
 assert.ok(Math.hypot(...b.rootInPlacement.map((v,i)=>v-a.rootInPlacement[i]))>1e-5,'Only a reported path advanced; actual root did not move');
 return {before:a,after:b};
}
export async function witness(args){
 const out=resolve(args.out),root=realpathSync(args.root);mkdirSync(out,{recursive:true});
 const report={schema:'kaminos.creature-controls-witness.v1',status:'running',phase:'inputs',requested:args,captures:[],errors:[],actions:[]};
 let browser,context,page;
 const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');persist();
 try{
  const setup=JSON.parse(readFileSync(args.setup));report.setupSha256=hash(readFileSync(args.setup));
  const url=new URL('/index.html',args.base);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','marionette/walking-creature');url.searchParams.set('experiment_inputs',JSON.stringify(setup));report.requestedUrl=url.href;
  report.phase='browser';const {chromium}=await import(args.playwright);const executable=realpathSync(args.chrome);
  assert.ok(!executable.includes('/Applications/Google Chrome.app/'),'Independent test browser required');report.effectiveExecutable=executable;
  browser=await chromium.launch({headless:true,executablePath:executable,args:['--use-mock-keychain','--password-store=basic','--no-first-run']});report.browserVersion=browser.version();
  context=await browser.newContext({viewport:{width:1600,height:1100},recordVideo:{dir:join(out,'video'),size:{width:1600,height:1100}}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  report.phase='load';await page.goto(url.href,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>typeof window.kaminosWalkingCreature==='function');
  report.effectiveUrl=page.url();report.runtimeConfig=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());assert.equal(report.runtimeConfig.source.repoRoot,root);
  report.source=[];for(const file of ['index.html','playback-controls.mjs','scene-owner-controls.mjs','viewport-display-settings.mjs','authoring-workspace.mjs','scene-frame-selected.mjs','experiments/creature-motion/walking-pose.mjs','experiments/creature-motion/creature-properties.mjs','experiments/creature-motion/walking.experiment.mjs','experiments/creature-motion/full-body-runtime.mjs']){const response=await page.request.get(new URL('/'+file,url).href);assert.equal(response.status(),200);const expected=hash(readFileSync(join(root,file))),actual=hash(await response.body());assert.equal(actual,expected);report.source.push({file,sha256:actual});}
  // Full vertex transfer belongs to the three geometry observations, not every
  // timing/interaction predicate. Use the ordinary owner read for live control.
  const read=({geometry=false}={})=>page.evaluate(geometry=>({...window.kaminosWalkingCreature({geometry}),registration:window.kaminosSceneObjectDebugState()}),geometry);
  const capture=async name=>{const path=join(out,name+'.png');await page.screenshot({path});report.captures.push(path);};
  report.initial=await read({geometry:true});validateCreatureControlRead(report.initial,setup);assert.notEqual(report.initial.playback.status,'playing');
  assert.equal(await page.locator('#experiment-owner-slot').isVisible(),false,'Creature context still exposes the experiment picker instead of ordinary scene objects');
  assert.equal(await page.getByRole('button',{name:'Replay source',exact:true}).count(),0);assert.equal(await page.getByLabel('Creature cast',{exact:true}).isVisible(),true);
  await capture('initial');
  report.phase='replay';await page.getByLabel('Playback speed',{exact:true}).selectOption('0.25');await page.getByRole('button',{name:'↻ Replay',exact:true}).click();assert.ok(['playing','held'].includes((await read()).playback.status),'Replay did not start the owner clock');await page.waitForFunction(()=>window.kaminosWalkingCreature({geometry:false}).playback.frame>0);assert.equal((await read()).playback.status,'playing','Pause hit-target observation requires a still-playing source');await page.locator('.playback-play').click();
  report.held=await read();assert.notEqual(report.held.playback.status,'playing');report.actions.push({kind:'replay-pause',frame:report.held.playback.frame});await capture('held');
  report.phase='scrub';const track=page.getByLabel('Playback position',{exact:true}),bounds=await track.boundingBox();assert.ok(bounds?.width>100);report.scrubBounds=[bounds];
  await page.mouse.move(bounds.x+2,bounds.y+bounds.height/2);await page.mouse.down();
  for(const f of [.05,.25,.5,.75,.99]){await page.mouse.move(bounds.x+bounds.width*f,bounds.y+bounds.height/2,{steps:3});report.scrubBounds.push(await track.boundingBox());}
  await page.mouse.up();await page.waitForFunction(()=>window.kaminosWalkingCreature().playback.status!=='playing');
  for(const b of report.scrubBounds)for(const k of ['x','y','width','height'])assert.ok(Math.abs(b[k]-bounds[k])<.1,'Scrubbing moved or resized its target');
  await track.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');await page.waitForFunction(()=>window.kaminosWalkingCreature().playback.frame===1);
  report.beforeCast=await read();report.phase='cast';const target=setup.choices.find(c=>c.attachment==='distributed'&&c.cast!==report.beforeCast.currentSkin.current.cast);assert.ok(target);
  await page.getByLabel('Creature cast',{exact:true}).selectOption(target.cast);await page.waitForFunction(sha=>window.kaminosWalkingCreature().source.caseSha256===sha,target.case_sha256);
  report.afterCast=await read({geometry:true});validateCreatureControlRead(report.afterCast,setup);assert.equal(report.afterCast.playback.frame,1);assert.deepEqual(report.afterCast.transform,report.beforeCast.transform);await capture('cast-switch');
  report.phase='motion';const next=setup.motions.find(m=>m.id==='walk-1');await page.getByLabel('Creature motion',{exact:true}).selectOption(next.id);await page.waitForFunction(sha=>window.kaminosWalkingCreature().source.motionSha256===sha,next.motion_sha256);report.afterMotion=await read();assert.equal(report.afterMotion.source.caseSha256,target.case_sha256);assert.deepEqual(report.afterMotion.transform,report.afterCast.transform);
  await page.getByLabel('Playback speed',{exact:true}).selectOption('0.5');await page.waitForFunction(()=>window.kaminosWalkingCreature().rate===.5);
  report.phase='save-open';await page.getByText('Save / open creature',{exact:true}).click();const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Save creature setup',exact:true}).click();const download=await downloadPromise;const saved=join(out,'saved-creature.json');await download.saveAs(saved);report.saved=JSON.parse(readFileSync(saved));assert.equal(report.saved.case_sha256,target.case_sha256);assert.equal(report.saved.rate,.5);
  const previousId=(await read()).host.id;
  await page.getByLabel('Open creature setup',{exact:true}).setInputFiles(saved);await page.waitForFunction(({sha,previousId})=>{if(typeof window.kaminosWalkingCreature!=='function')return false;const r=window.kaminosWalkingCreature({geometry:false});return r.host.id!==previousId&&r.source.caseSha256===sha&&r.rate===.5;},{sha:target.case_sha256,previousId});report.reopened=await read({geometry:true});validateCreatureControlRead(report.reopened,setup);await capture('reopened');
  report.phase='workspace';await page.getByRole('button',{name:'Authoring',exact:true}).click();assert.equal(await page.getByLabel('Creature motion',{exact:true}).isVisible(),true);assert.equal(await track.isVisible(),true);await capture('authoring');
  await page.getByRole('button',{name:'Workbench',exact:true}).click();assert.equal(await page.locator('#experiment-scene-slot #scene-object-list').isVisible(),true);await capture('workbench-return');
  if(args.display==='true'){
   report.phase='viewport-helpers';await page.getByRole('button',{name:'Authoring',exact:true}).click();
   const menu=page.locator('#authoring-viewport-settings');await menu.locator('summary').click();
   await page.getByLabel('Show helpers',{exact:true}).uncheck();report.helpersHidden=await read();validateCreatureDisplayRead(report.helpersHidden,{helpers:false});await capture('helpers-hidden');
   await page.getByLabel('Bones',{exact:true}).uncheck();await page.getByLabel('Show helpers',{exact:true}).check();report.bonesHidden=await read();validateCreatureDisplayRead(report.bonesHidden,{bones:false});
   await page.getByLabel('Motion paths',{exact:true}).check();await menu.locator('summary').click();
   const mode=page.locator('.creature-properties select[aria-label="Creature playback"]');await mode.selectOption('path');
   report.pathSwitches=[];
   for(const id of ['trot-2','run-3','walk-1']){await page.getByLabel('Creature motion',{exact:true}).selectOption(id);await page.waitForFunction(id=>window.kaminosWalkingCreature({geometry:false}).motion.id===id,id);const r=await read();validateCreatureDisplayRead(r,{bones:false,paths:true,mode:'path',motionId:id});report.pathSwitches.push({requestedId:id,motion:r.motion,mode:r.mode,path:r.pathGuide});}
   await page.getByLabel('Playback speed',{exact:true}).selectOption('4');await page.getByRole('button',{name:'↻ Replay',exact:true}).click();await page.waitForFunction(()=>window.kaminosWalkingCreature({geometry:false}).cycle>=1);await page.locator('.playback-play').click();report.pathRepeated=await read();validateCreatureDisplayRead(report.pathRepeated,{bones:false,paths:true,mode:'path',minimumCycle:1});
   const bounds=report.pathRepeated.pathGuide.bounds,center=bounds.min.map((v,i)=>(v+bounds.max[i])/2);report.pathCamera=await page.evaluate(c=>window.__kaminosSetSceneCameraFrame([c[0]+24,c[1]+23,c[2]-28],c),center);await capture('path-circle');
   await page.getByRole('button',{name:'Frame',exact:true}).click();report.creatureFrameCamera=await page.evaluate(()=>window.kaminosCameraDebugState());await capture('frame-creature');
   report.phase='shadow';await mode.selectOption('source');await page.getByLabel('Creature motion',{exact:true}).selectOption('continued-trot');await page.waitForFunction(()=>window.kaminosWalkingCreature({geometry:false}).motion.id==='continued-trot');
   await page.evaluate(view=>window.__kaminosSetSceneCameraFrame(view.position,view.target),setup.view);
   report.shadowLight=await page.evaluate(()=>{
    const values={intensity:160,azimuth:135,elevation:45,distance:6,angle:45,penumbra:.2,'target-x':0,'target-y':-1,'target-z':-1};
    for(const [key,value]of Object.entries(values)){const input=document.getElementById('rim-'+key+'-number');input.value=String(value);input.dispatchEvent(new Event('input',{bubbles:true}));}
    const enabled=document.getElementById('rim-enabled');enabled.checked=true;enabled.dispatchEvent(new Event('change',{bubbles:true}));window.kaminosViewportSettings.set({helpers:false});return {requested:values,effective:window.kaminosSceneLightState()};
   });report.shadowRead=await read();validateCreatureDisplayRead(report.shadowRead,{helpers:false,bones:false,paths:true,mode:'source'});assert.equal(report.shadowRead.referenceFloor.visible,true);await capture('shadow-start');
   await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{frame:20}));await page.getByRole('button',{name:'Frame',exact:true}).click();await capture('shadow-frame20');
   report.phase='travelled-frame';await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{frame:259}));
   const travelled=await read({geometry:true});assert.equal(travelled.playback.frame,259);report.travelledFrames=[];
   for(const helpers of [true,false]){await page.evaluate(helpers=>window.kaminosViewportSettings.set({helpers,paths:true}),helpers);await page.getByRole('button',{name:'Frame',exact:true}).click();const camera=await page.evaluate(()=>window.kaminosCameraDebugState());report.travelledFrames.push({helpers,frame:259,...validateCreatureFrameRead(travelled,camera)});await capture('travelled-frame-'+(helpers?'path-visible':'path-hidden'));}
  }
  report.phase='close';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.locator('.scene-owner-playback').count(),0);assert.equal(await page.locator('.creature-properties').count(),0);
  assert.deepEqual(report.errors,[]);report.status='complete';report.phase='complete';
 }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};if(page)try{report.failureState=await page.evaluate(async()=>typeof window.kaminosWorkbenchExperiments?.read==='function'?await window.kaminosWorkbenchExperiments.read():null);await page.screenshot({path:join(out,'failure.png')});}catch{}throw error;}
 finally{if(context)await context.close().catch(e=>report.errors.push(e.message));if(browser){await browser.close();report.browserClosed=true;}persist();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];await witness(args);}
