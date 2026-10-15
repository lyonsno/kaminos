// kaminos-test: browser — exact caller recipe, actual shared scene and independent CFT
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import v8 from 'node:v8';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

function compareWorldPositions(actual,expected){
 assert.equal(actual.length,expected.length,'export must retain every current-pose vertex');let max=0;
 for(let i=0;i<actual.length;i++){assert.ok(Number.isFinite(actual[i])&&Number.isFinite(expected[i]));max=Math.max(max,Math.abs(actual[i]-expected[i]));}
 assert.ok(max<.00002,'downloaded GLB differs from current posed world geometry: '+max);return max;
}
function check(state,setup){
 assert.equal(state.clock.rendererBackend,'webgpu');assert.equal(state.read.entries.length,setup.entries.length);
 assert.equal(state.clock.activeSubscriptions,1,'one actual app clock drives the comparison');
 assert.equal(state.read.presentation,'in-place');
 for(let i=0;i<setup.entries.length;i++){
  const e=state.read.entries[i],s=setup.entries[i];assert.equal(e.key,s.id);assert.ok(e.id&&state.scene.some(r=>r.id===e.id));
  assert.equal(e.source.motionSha256,s.source.motion_sha256);assert.equal(e.source.caseSha256,s.source.case_sha256);assert.equal(e.source.frameSha256,s.source.frame_sha256);
  assert.equal(e.skin.route,'shared-owner-scene-full-body-dq');assert.equal(e.skin.vertices,50501);assert.equal(e.skin.bones,28);
  assert.equal(e.skin.deformation?.backend,'webgpu-dense-dq');assert.ok(e.skin.deformation.dispatches>0);assert.equal(e.skin.poseCache.bytes,0);assert.equal(e.skin.poseCache.enabled,false);
  assert.equal(e.vertices.length,50501*3);assert.ok(e.vertices.every(Number.isFinite));assert.ok(e.vertices.some(v=>v!==e.vertices[0]),'blank output');
 }
 assert.equal(new Set(state.read.entries.map(e=>e.id)).size,setup.entries.length,'six sources need six actual objects');
}
if(process.argv.includes('--self-test')){
 compareWorldPositions([1,2,3],[1,2,3]);assert.throws(()=>compareWorldPositions([0,0,0],[1,2,3]));assert.throws(()=>compareWorldPositions([1,2],[1,2,3]));assert.throws(()=>compareWorldPositions([NaN,2,3],[1,2,3]));
 const setup={entries:[{id:'a',source:{motion_sha256:'m',case_sha256:'c',frame_sha256:'f'}}]},entry={key:'a',id:'body',source:{motionSha256:'m',caseSha256:'c',frameSha256:'f'},skin:{route:'shared-owner-scene-full-body-dq',deformation:{backend:'webgpu-dense-dq',dispatches:1},poseCache:{bytes:0,enabled:false},vertices:50501,bones:28},vertices:Array(50501*3).fill(0)};entry.vertices[0]=1;
 const good={clock:{rendererBackend:'webgpu',activeSubscriptions:1},scene:[{id:'body'}],read:{presentation:'in-place',entries:[entry]}};check(good,setup);
 for(const edit of [s=>s.clock.rendererBackend='webgl',s=>s.clock.activeSubscriptions=6,s=>s.scene=[],s=>s.read.entries=[],s=>s.read.entries[0].source.motionSha256='stale',s=>s.read.entries[0].vertices.fill(0),s=>s.read.entries[0].skin.deformation.backend='cpu-reference',s=>s.read.entries[0].skin.deformation.dispatches=0,s=>s.read.entries[0].skin.poseCache.bytes=100]){const bad=structuredClone(good);edit(bad);assert.throws(()=>check(bad,setup));}
 console.log('Comparison witness refuses fallback renderer, private clocks, missing registration, partial cohort, stale source and blank body');process.exit(0);
}
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,l)=>i%2?a:[...a,[v,l[i+1]]],[]));
const out=args['--out'],root=args['--repo-root'],origin=args['--origin'];if(!out||!root||!origin||!args['--setup']||!args['--recipe-url']||!args['--chrome']||!args['--playwright'])throw Error('Explicit source, setup, recipe route, browser and output required');
await fs.mkdir(out,{recursive:true});await assert.rejects(fs.access(out+'/report.json'),'Preserve existing evidence');
const report={status:'running',phase:'inputs',requested:args,images:[],errors:[]};let browser,context,page;
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
try{
 const bytes=await fs.readFile(args['--setup']),setup=JSON.parse(bytes),sha=createHash('sha256').update(bytes).digest('hex');report.recipeSha256=sha;report.setup=setup;
 report.runtime=await (await fetch(origin+'/api/runtime-config')).json();assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.source.dirty,false);
 const url=new URL(origin+'/index.html');url.searchParams.set('experiment','marionette/motion-comparison');url.searchParams.set('experiment_inputs',JSON.stringify({recipe:args['--recipe-url'],recipe_sha256:sha}));report.url=url.href;
 const {chromium}=await import(pathToFileURL(args['--playwright']));browser=await chromium.launch({executablePath:args['--chrome'],headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal','--use-mock-keychain','--password-store=basic']});report.browserVersion=browser.version();
 context=await browser.newContext({viewport:{width:1800,height:1200},recordVideo:{dir:out+'/video',size:{width:1800,height:1200}}});page=await context.newPage();
 await page.route('**/favicon.ico',r=>r.fulfill({status:204}));
 let rejectPage;const failedPage=new Promise((_,reject)=>rejectPage=reject);failedPage.catch(()=>{});
 const evaluate=page.evaluate.bind(page);page.evaluate=(...args)=>Promise.race([evaluate(...args),failedPage]);
 page.on('pageerror',e=>{report.errors.push(String(e));void fs.appendFile(out+'/console.log',String(e)+'\n');rejectPage(e);});
 page.on('console',m=>{if(m.type()==='error'){report.errors.push(m.text());void fs.appendFile(out+'/console.log',m.text()+'\n');rejectPage(Error(m.text()));}});
 report.phase='mount';await save();await page.goto(url.href,{timeout:0});await page.evaluate(async()=>{for(;;){if(window.kaminosWorkbenchExperimentError)throw Error(window.kaminosWorkbenchExperimentError);if(window.kaminosCreatureComparison)return;await new Promise(r=>requestAnimationFrame(r));}});
 const read=()=>page.evaluate(()=>({read:window.kaminosCreatureComparison(),scene:window.kaminosSceneObjectDebugState(),clock:window.kaminosWorkbenchSceneState()}));
 async function retain(label,validate=false){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const state=await read();if(validate)check(state,setup);await fs.writeFile(out+'/'+label+'.state.v8',v8.serialize(state));await page.screenshot({path:out+'/'+label+'.png'});report.images.push(label+'.png');await save();return state;}
 report.phase='simultaneous-play';const moving=await retain('all-playing',true);assert.equal(moving.read.status,'playing');
 report.phase='gpu-pose-cadence';await save();
 report.cadence=await page.evaluate(async()=>{
  const before=await window.kaminosWorkbenchExperiments.read(),timestamps=[];
  await new Promise(resolve=>{const frame=t=>{timestamps.push(t);if(t-timestamps[0]>=3000)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);});
  return {before,after:await window.kaminosWorkbenchExperiments.read(),timestamps};
 });
 for(let i=0;i<setup.entries.length;i++){const a=report.cadence.before.entries[i].skin,b=report.cadence.after.entries[i].skin;assert.equal(b.poseCache.bytes,0);assert.ok(b.deformation.dispatches>a.deformation.dispatches,'elapsed playback must exercise actual GPU dispatches');assert.equal(b.poseCache.deformations,a.poseCache.deformations,'playback must not run CPU skin solves');}
 await save();
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('pause'));await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{seconds:1}));const middle=await retain('paired-middle');assert.ok(middle.read.entries.every(e=>e.frame===30));assert.equal(middle.clock.activeSubscriptions,0);
 report.phase='same-pose-gpu-parity';report.parity=[];
 if(args['--shared-controls']==='true'){
  report.phase='shared-controls';await save();
  const bar=page.locator('.scene-owner-playback:visible');assert.equal(await bar.count(),1,'selection exposes one common cohort bar');
  await bar.getByLabel('Playback speed',{exact:true}).selectOption('0.5');
  await bar.locator('.playback-play').click();await page.evaluate(async()=>{const before=(await window.kaminosWorkbenchExperiments.read()).seconds;while((await window.kaminosWorkbenchExperiments.read()).seconds<=before)await new Promise(r=>requestAnimationFrame(r));});await bar.locator('.playback-play').click();
  report.phase='shared-keyboard-scrub';await save();
  const track=bar.getByLabel('Playback position',{exact:true});await track.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));report.keyboardScrub=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());await save();
  assert.ok(Math.abs(report.keyboardScrub.seconds-1/30)<1e-6,'keyboard scrub must reach the next source sample');
  const id=(await read()).read.entries[0].id;await page.evaluate(id=>window.kaminosSetSceneObjectTransform(id,{position:[-2.5,0,6]}),id);
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{seconds:.5}));const placed=await read();assert.ok(Math.abs(placed.read.entries[0].rootMatrix[12]+2.5)<.1,'pose overwrote authored placement');
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{seconds:1}));
  const downloadPromise=page.waitForEvent('download');await page.locator('.scene-owner-properties:not([hidden])').getByRole('button',{name:'Save comparison setup',exact:true}).click();const download=await downloadPromise;await download.saveAs(out+'/saved-comparison.json');report.savedComparison=JSON.parse(await fs.readFile(out+'/saved-comparison.json','utf8'));assert.equal(report.savedComparison.entries[0].position[0],-2.5);assert.equal(report.savedComparison.rate,.5);assert.equal(report.savedComparison.seconds,1);
  await page.evaluate(()=>window.kaminosViewportSettings.set({helpers:false}));await retain('shared-controls');await page.evaluate(()=>window.kaminosViewportSettings.set({helpers:true,bones:false,paths:true}));
  assert.equal(await page.locator('#experiment-owner-slot').isVisible(),false,'selected-body context should use the ordinary scene room');
 }
 report.phase='same-pose-gpu-parity';
 const parityTimes=args['--gpu-parity']==='false'?[]:[0,1,59/30];report.gpuParity={requested:args['--gpu-parity']!=='false',sampleTimes:parityTimes};
 for(const seconds of parityTimes){
  await page.evaluate(seconds=>window.kaminosWorkbenchExperiments.invoke('seek',{seconds}),seconds);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const samples=await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('inspectGpu'));await fs.writeFile(out+'/gpu-parity-'+Math.round(seconds*30)+'.v8',v8.serialize(samples));
  for(const s of samples){assert.equal(s.backend,'webgpu-dense-dq');assert.ok(s.dispatches>0);const error=(a,b)=>{assert.equal(a.length,50501*3);assert.equal(a.length,b.length);let max=0,sum=0;for(let i=0;i<a.length;i++){assert.ok(Number.isFinite(a[i])&&Number.isFinite(b[i]));const d=Math.abs(a[i]-b[i]);max=Math.max(max,d);sum+=d*d;}return {max,rms:Math.sqrt(sum/a.length)};};
   const positions=error(s.positions,s.cpuPositions),normals=error(s.normals,s.cpuNormals);report.parity.push({seconds,key:s.key,source:s.source,positions,normals});assert.ok(positions.max<.00002,'GPU vertex transport differs from CPU reference');assert.ok(normals.rms<.001,'GPU triangle-derived normals differ from CPU reference');
  }
  await save();
 }
 if(args['--export-pose']==='true'){
  report.phase='posed-glb-download';await save();
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{seconds:1}));
  const posed=(await read()).read.entries[0];await fs.writeFile(out+'/export-source.v8',v8.serialize(posed));
  await page.evaluate(id=>window.selectSceneObject(id),posed.id);
  const downloadPromise=page.waitForEvent('download');
  assert.equal(await page.evaluate(()=>window.exportGLB({name:'posed-creature'})),true);
  const download=await downloadPromise,path=out+'/posed-creature.glb';await download.saveAs(path);
  const bytes=await fs.readFile(path),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  gltf.scene.updateMatrixWorld(true);const meshes=[];gltf.scene.traverse(o=>{if(o.isMesh)meshes.push(o);});assert.equal(meshes.length,1,'export excludes bone markers and comparison helpers');
  const mesh=meshes[0],p=mesh.geometry.attributes.position,actual=[],expected=[],v=new THREE.Vector3(),world=new THREE.Matrix4().fromArray(posed.rootMatrix);
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(mesh.matrixWorld);actual.push(...v);v.fromArray(posed.vertices,i*3).applyMatrix4(world);expected.push(...v);}
  report.export={path,bytes:bytes.length,vertices:p.count,positionItemSize:p.itemSize,worldMaxError:compareWorldPositions(actual,expected),source:posed.source,rootMatrix:posed.rootMatrix};
  await retain('exported-pose');await save();
 }
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('restart'));await page.evaluate(async()=>{while(window.kaminosCreatureComparison().seconds<.5)await new Promise(r=>requestAnimationFrame(r));});await retain('elapsed-motion',true);
 report.phase='raw-once';await save();await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('presentation',{mode:'raw'}));await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('restart'));await page.evaluate(async()=>{while((await window.kaminosWorkbenchExperiments.read()).status!=='held')await new Promise(r=>requestAnimationFrame(r));});const held=await retain('raw-held');assert.ok(held.read.entries.every(e=>e.frame===59));assert.equal(held.clock.activeSubscriptions,0);
 report.phase='travel';await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('presentation',{mode:'travel'}));await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('seek',{seconds:1}));const travel=await retain('travel-middle');assert.ok(travel.read.entries.every(e=>e.skin.deformation.backend==='webgpu-dense-dq'&&e.skin.poseCache.bytes===0));
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('restart'));const travelStart=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());await page.evaluate(async()=>{while((await window.kaminosWorkbenchExperiments.read()).seconds<2.2)await new Promise(r=>requestAnimationFrame(r));});const traveled=await page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 for(let i=0;i<setup.entries.length;i++){assert.ok(traveled.entries[i].skin.deformation.dispatches>travelStart.entries[i].skin.deformation.dispatches);assert.equal(traveled.entries[i].skin.poseCache.deformations,travelStart.entries[i].skin.poseCache.deformations);}
 if(args['--shared-controls']==='true'){
  report.phase='travel-reconstruction';report.travelReconstruction=[];await save();
  await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('pause'));
  for(const playing of [false,true]){
   const result=await page.evaluate(async playing=>{
    const e=window.kaminosWorkbenchExperiments,before=await e.read(),saved=await e.invoke('setup');saved.play=playing;
    await e.close();await e.open('marionette/motion-comparison',saved);const after=await e.read();await e.invoke('pause');return {playing,before,saved,after};
   },playing);
   assert.equal(result.after.seconds,result.saved.seconds);assert.ok(result.saved.seconds>2,'witness needs accumulated travel, not just the initial cycle');assert.equal(result.after.status,playing?'playing':'paused');assert.equal(result.after.rate,result.before.rate);assert.deepEqual(result.after.view,result.before.view);
   for(let i=0;i<setup.entries.length;i++){const a=result.before.entries[i],b=result.after.entries[i];assert.equal(b.frame,a.frame);assert.equal(b.cycle,a.cycle);assert.notEqual(b.id,a.id);for(let k=0;k<16;k++)assert.ok(Math.abs(a.rootMatrix[k]-b.rootMatrix[k])<.00001,'travel reconstruction changed current world placement');}
   report.travelReconstruction.push(result);await save();
  }
  await retain('travel-reopened');
 }
 report.phase='removal';await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('presentation',{mode:'in-place'}));const first=(await read()).read.entries[0];await page.evaluate(id=>window.removeSceneObject(id),first.id);await page.evaluate(()=>window.kaminosWorkbenchExperiments.invoke('play'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const removed=await retain('one-removed');assert.equal(removed.read.entries[0].status,'removed');assert.equal(removed.read.entries[0].id,null);assert.equal(removed.read.entries.filter(e=>e.id).length,setup.entries.length-1);
 await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());report.closed=await page.evaluate(()=>({clock:window.kaminosWorkbenchSceneState(),scene:window.kaminosSceneObjectDebugState()}));assert.equal(report.closed.clock.activeSubscriptions,0);assert.equal(report.closed.scene.length,0);assert.deepEqual(report.errors,[]);
 if(report.savedComparison){
  assert.equal(await page.locator('.scene-owner-playback').count(),0);
  await page.evaluate(setup=>window.kaminosWorkbenchExperiments.open('marionette/motion-comparison',setup),report.savedComparison);
  report.reopened=await read();assert.equal(report.reopened.read.entries.length,6);assert.equal(report.reopened.read.seconds,1);assert.equal(report.reopened.read.rate,.5);assert.equal(report.reopened.clock.activeSubscriptions,0);assert.notEqual(report.reopened.read.entries[0].id,moving.read.entries[0].id);
  assert.ok(Math.abs(report.reopened.read.entries[0].rootMatrix[12]+2.5)<.1);await retain('shared-reopened');await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());
 }
 report.phase='negative-recipe';const wrong=new URL(url);wrong.searchParams.set('experiment_inputs',JSON.stringify({recipe:args['--recipe-url'],recipe_sha256:'0'.repeat(64)}));await page.goto(wrong.href,{timeout:0});await page.evaluate(async()=>{while(!window.kaminosWorkbenchExperimentError)await new Promise(r=>requestAnimationFrame(r));});report.negative=await page.evaluate(()=>({error:window.kaminosWorkbenchExperimentError,scene:window.kaminosSceneObjectDebugState(),clock:window.kaminosWorkbenchSceneState()}));assert.match(report.negative.error,/digest mismatch/);assert.equal(report.negative.scene.length,0);assert.equal(report.negative.clock.activeSubscriptions,0);
 report.status='inspection-passed';report.limit='Live simultaneous composition and source identity; in-place and seam are derived presentation, no gait acceptance or contact solver';
}catch(e){report.status='failed';report.failure=String(e.stack??e);await save();process.exitCode=1;if(page)try{await fs.writeFile(out+'/failure.state.v8',v8.serialize(await page.evaluate(()=>window.kaminosCreatureComparison?.()??{error:window.kaminosWorkbenchExperimentError})));await page.screenshot({path:out+'/failure.png'});report.images.push('failure.png');}catch{}}
finally{try{const video=page?.video();await browser?.close();report.browserClosed=true;report.videoPath=await video?.path();}catch(e){report.cleanupError=String(e);process.exitCode=1;}await save();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,images:report.images}));}
