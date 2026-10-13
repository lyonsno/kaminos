// kaminos-test: browser — explicit setup, independent CFT, actual shared host
import fs from 'node:fs/promises';
import path from 'node:path';
import v8 from 'node:v8';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

function check(state,setup,frames){
 assert.equal(state.host.route,'shared-owner-scene');assert.equal(state.host.scene.rendererBackend,'webgpu');assert.ok(state.host.id);
 assert.equal(state.source.motionSha256,setup.motion_sha256);assert.equal(state.source.caseSha256,setup.case_sha256);assert.equal(state.source.frameSha256,setup.frame_sha256);
 assert.equal(state.skin.route,'shared-owner-scene-full-body-dq');assert.equal(state.skin.vertices,50501);assert.equal(state.skin.bones,28);
 assert.equal(state.playback.frames,frames);assert.equal(state.playback.fps,30);assert.equal(state.boneWorld.length,28);
 assert.equal(state.vertices.length,50501*3);assert.ok(state.vertices.every(Number.isFinite));let min=Infinity,max=-Infinity;for(const v of state.vertices){min=Math.min(min,v);max=Math.max(max,v);}assert.ok(max-min>1e-3,'blank geometry cannot be motion evidence');
 assert.equal(state.playback.editedSinceSourcePose,false);
}
if(process.argv.includes('--self-test')){
 const setup={motion_sha256:'a',case_sha256:'b',frame_sha256:'c'},good={host:{route:'shared-owner-scene',id:'body',scene:{rendererBackend:'webgpu'}},source:{motionSha256:'a',caseSha256:'b',frameSha256:'c'},skin:{route:'shared-owner-scene-full-body-dq',vertices:50501,bones:28},playback:{frames:260,fps:30,editedSinceSourcePose:false},boneWorld:Array(28).fill({}),vertices:Array(50501*3).fill(1)};good.vertices[0]=0;check(good,setup,260);
 for(const change of [s=>s.host.route='legacy-viewer',s=>s.host.scene.rendererBackend='webgl',s=>s.source.motionSha256='stale',s=>s.skin.bones=7,s=>s.vertices=[],s=>s.vertices.fill(0),s=>s.playback.frames=60,s=>s.playback.editedSinceSourcePose=true]){const bad=structuredClone(good);change(bad);assert.throws(()=>check(bad,setup,260));}
 console.log('Walking witness rejects old/fallback host, stale/partial/blank output and edited motion');process.exit(0);
}
const args=Object.fromEntries(process.argv.slice(2).reduce((all,arg,i,list)=>i%2?all:[...all,[arg,list[i+1]]],[])),root=args['--repo-root'],out=args['--out'],port=args['--port'],frames=Number(args['--frames']);
if(!root||!out||!port||!args['--setup']||!args['--chrome']||!args['--playwright']||!Number.isInteger(frames)||frames<2)throw Error('Explicit native source/setup/browser/output/frames required');
await fs.mkdir(out,{recursive:true});await assert.rejects(fs.access(out+'/report.json'),'Preserve existing evidence');
const report={status:'failed',phase:'setup',requested:{root,port,frames,setup:args['--setup'],browser:args['--chrome']},images:[],samples:[],errors:[]};let server,browser,context,page,log='';
const save=()=>fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));await save();
try{
 const setup=JSON.parse(await fs.readFile(args['--setup'],'utf8'));report.setup=setup;
 report.phase='server';server=spawn('python3',['-u','serve.py',port,'--volume-settings-store',out+'/settings','--volume-basin-session-store',out+'/sessions','--volume-cockpit-layout-store',out+'/layouts','--no-shared-basin-store'],{cwd:root,env:{...process.env,KAMINOS_SCENES_DIR:out+'/scenes'}});report.serverPid=server.pid;server.stdout.on('data',b=>log+=b);server.stderr.on('data',b=>log+=b);
 const origin=`http://127.0.0.1:${port}`;
 while(!report.runtime){if(server.exitCode!==null)throw Error('Owned source server exited');try{const response=await fetch(origin+'/api/runtime-config');if(response.ok)report.runtime=await response.json();}catch{}if(!report.runtime)await new Promise(r=>setTimeout(r,100));}
 assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.source.dirty,false);
 const url=new URL(origin+'/index.html');url.searchParams.set('experiment','marionette/walking-creature');url.searchParams.set('experiment_inputs',JSON.stringify(setup));report.url=url.href;
 report.phase='browser';const {chromium}=await import(pathToFileURL(args['--playwright']));browser=await chromium.launch({executablePath:args['--chrome'],headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});report.browserVersion=browser.version();context=await browser.newContext({viewport:{width:1600,height:1000},recordVideo:{dir:out+'/video',size:{width:1600,height:1000}}});page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(url.href,{timeout:0});
 async function mounted(){await page.evaluate(async()=>{for(;;){if(window.kaminosWorkbenchExperimentError)throw Error(window.kaminosWorkbenchExperimentError);if(window.kaminosWorkbenchExperiments?.state().id==='marionette/walking-creature'&&window.kaminosWalkingCreature)return;await new Promise(r=>requestAnimationFrame(r));}});}
 await mounted();report.phase='source-poses';
 async function retain(label,expected){await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));const state=await page.evaluate(()=>window.kaminosWalkingCreature());check(state,setup,frames);if(expected!==undefined)assert.equal(state.playback.frame,expected);const registered=await page.evaluate(()=>window.kaminosSceneObjectDebugState());assert.ok(registered.some(row=>row.id===state.host.id),'owner root is not registered in the actual application');await fs.writeFile(out+'/'+label+'.state.v8',v8.serialize({state,registered}));await page.screenshot({path:out+'/'+label+'.png'});report.images.push(label+'.png');report.samples.push({label,mode:state.mode,cycle:state.cycle,frame:state.playback.frame,root:state.rootMatrix,geometrySha256:createHash('sha256').update(Buffer.from(new Float32Array(state.vertices).buffer)).digest('hex'),raw:label+'.state.v8'});await save();return state;}
 await retain('source-0',0);
 const indices=new Set([Math.floor(frames*.25),Math.floor(frames*.5),Math.floor(frames*.75),frames-1]);const first=await page.evaluate(()=>window.kaminosWalkingCreature().source);
 if(first.prefixFrames){const stride=(frames-first.prefixFrames)/first.addedSegments;for(let i=0;i<first.addedSegments;i++){indices.add(first.prefixFrames+i*stride-1);indices.add(first.prefixFrames+i*stride);}}
 for(const index of [...indices].sort((a,b)=>a-b)){await page.evaluate(i=>window.kaminosWorkbenchExperiments.invoke('seek',{frame:i}),index);await retain('source-'+index,index);}
 assert.ok(new Set(report.samples.map(s=>s.geometrySha256)).size>2,'cached/static geometry cannot establish movement');
 report.phase='actual-source-play';await page.getByRole('button',{name:'Restart motion',exact:true}).click();await page.evaluate(async()=>{while(window.kaminosWalkingCreature().playback.status!=='held')await new Promise(r=>requestAnimationFrame(r));});await retain('actual-source-end',frames-1);
 report.phase='cycle-seam';await page.getByRole('button',{name:'Straight cycle',exact:true}).click();await page.evaluate(i=>window.kaminosWorkbenchExperiments.invoke('seek',{frame:i}),frames-2);await retain('cycle-before');await page.getByRole('button',{name:'Play motion',exact:true}).click();await page.evaluate(async()=>{while(window.kaminosWalkingCreature().cycle<1)await new Promise(r=>requestAnimationFrame(r));});await page.getByRole('button',{name:'Pause motion',exact:true}).click();await retain('cycle-after');
 report.phase='path-turn';await page.getByRole('button',{name:'Walk the curve',exact:true}).click();for(const index of [0,Math.floor(frames*.5),frames-1]){await page.evaluate(i=>window.kaminosWorkbenchExperiments.invoke('seek',{frame:i}),index);await retain('path-'+index,index);}
 await page.getByRole('button',{name:'Restart motion',exact:true}).click();await page.evaluate(async()=>{while(window.kaminosWalkingCreature().playback.frame<65)await new Promise(r=>requestAnimationFrame(r));});await page.getByRole('button',{name:'Pause motion',exact:true}).click();await retain('actual-path-moving');assert.deepEqual(report.errors,[],'positive route emitted page errors');
 report.phase='close';await page.evaluate(()=>window.kaminosWorkbenchExperiments.close());assert.equal(await page.evaluate(()=>window.kaminosWorkbenchSceneState().activeSubscriptions),0);assert.equal(await page.evaluate(()=>window.kaminosWalkingCreature===undefined),true);
 report.phase='negative-source';const wrong=new URL(url);wrong.searchParams.set('experiment_inputs',JSON.stringify({...setup,motion_sha256:'0'.repeat(64)}));await page.goto(wrong.href,{timeout:0});await page.evaluate(async()=>{while(!window.kaminosWorkbenchExperimentError)await new Promise(r=>requestAnimationFrame(r));});report.negative=await page.evaluate(()=>({error:window.kaminosWorkbenchExperimentError,state:window.kaminosWorkbenchExperiments?.state(),scene:window.kaminosWorkbenchSceneState?.()}));assert.match(report.negative.error,/digest mismatch/);assert.equal(report.negative.state.id,null);await page.screenshot({path:out+'/source-rejected.png'});report.images.push('source-rejected.png');
 report.status='inspection-passed';report.limit='Actual shared-host source, repeat and broad-curve consumer; no contact, seamless/native-cycle, terrain planner or gait-quality acceptance';
}catch(error){report.failure=String(error.stack??error);process.exitCode=1;if(page){try{report.lastTrustworthy=await page.evaluate(()=>window.kaminosWalkingCreature?.()??{startupError:window.kaminosWorkbenchExperimentError});await fs.writeFile(out+'/failure.state.v8',v8.serialize(report.lastTrustworthy));await page.screenshot({path:out+'/failure.png'});report.images.push('failure.png');delete report.lastTrustworthy;report.lastTrustworthyRaw='failure.state.v8';}catch{}}}
finally{try{if(page)report.videoPath=await page.video()?.path();await context?.close();await browser?.close();report.browserClosed=true;}catch(e){report.cleanupError=String(e);process.exitCode=1;}if(server){server.kill('SIGTERM');await new Promise(r=>server.exitCode!==null?r():server.once('exit',r));report.serverExit=server.exitCode;}await fs.writeFile(out+'/server.log',log);await save();console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,images:report.images,video:report.videoPath}));}
