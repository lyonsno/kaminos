// kaminos-test: browser — native full-body motion in the existing index scene
import fs from 'node:fs/promises';
import path from 'node:path';
import v8 from 'node:v8';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const ids={motion:'5bebb370c728bd18c7130d3874ed1584d6338510bcb15819a8e8361ad95fd92e',frame:'259c3773a41cf7a98fde7e6683cb2044ccef7c3c8f121d2b2c9fffce6d80e771',skin:'160fcabc2ef1f1b8e7436134314a427a2412667bbd6697d6c3bf2b7a710f795f'};
function check(snapshot,frame){
 assert.equal(snapshot.status,'mounted');assert.equal(snapshot.effective.motionSha256,ids.motion);assert.equal(snapshot.effective.frameSha256,ids.frame);assert.equal(snapshot.effective.caseSha256,ids.skin);
 assert.equal(snapshot.skin.rendererBackend,'WebGPUBackend');assert.equal(snapshot.skin.effectiveRoute,'index-scene-live-full-tree-transport');assert.equal(snapshot.skin.candidatePaintedWeights,false);
 assert.equal(snapshot.skin.controls.length,28);assert.equal(snapshot.playback.frames,60);assert.equal(snapshot.playback.fps,30);if(frame!==undefined)assert.equal(snapshot.playback.frame,frame);
 assert.equal(snapshot.playback.editedSinceSourcePose,false);
}
if(process.argv.includes('--self-test')){
 const good={status:'mounted',effective:{motionSha256:ids.motion,frameSha256:ids.frame,caseSha256:ids.skin},skin:{rendererBackend:'WebGPUBackend',effectiveRoute:'index-scene-live-full-tree-transport',candidatePaintedWeights:false,controls:Array(28)},playback:{frames:60,fps:30,frame:15,editedSinceSourcePose:false}};check(good,15);
 for(const mutate of [s=>s.status='loading',s=>s.effective.motionSha256='wrong',s=>s.effective.frameSha256='wrong',s=>s.skin.rendererBackend='WebGLBackend',s=>s.skin.controls=[],s=>s.playback.frame=0,s=>s.playback.editedSinceSourcePose=true]){const wrong=structuredClone(good);mutate(wrong);assert.throws(()=>check(wrong,15));}
 console.log('Native whole-body witness rejects wrong/partial/fallback source and stale/edited pose');process.exit(0);
}
const args=Object.fromEntries(process.argv.slice(2).reduce((all,arg,i,list)=>i%2?all:[...all,[arg,list[i+1]]],[]));
const out=args['--out'],root=args['--repo-root'],port=args['--port'];if(!out||!root||!port||!args['--source-mount'])throw Error('Explicit source root, output, port and source mount required');
await fs.mkdir(out,{recursive:true});await assert.rejects(fs.access(path.join(out,'report.json')),'preserve existing evidence');
const report={status:'starting',phase:'server',requested:{root,port,ids},images:[],samples:[],errors:[]};let server,browser,page,serverLog='';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
try{
 server=spawn('python3',['-u','serve.py',port,'--volume-settings-store',out+'/settings','--volume-basin-session-store',out+'/sessions','--volume-cockpit-layout-store',out+'/layouts','--no-shared-basin-store'],{cwd:root,env:{...process.env,KAMINOS_LERMS_PREVIEW_ROOT:args['--source-mount'],KAMINOS_SCENES_DIR:out+'/scenes'}});
 server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);report.server={pid:server.pid,root,port};const origin=`http://127.0.0.1:${port}`;
 while(!report.runtime){if(server.exitCode!==null)throw Error('Owned source server exited before admission');try{const response=await fetch(origin+'/api/runtime-config');if(response.ok)report.runtime=await response.json();}catch{}if(!report.runtime)await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(report.runtime.source.repoRoot,root);assert.equal(report.runtime.source.dirty,false);
 const url=new URL(origin+'/index.html');for(const [name,value] of Object.entries({transport_case:'scratch/mushfinger-full-given-tree-r4-1013',transport_sha256:ids.skin,transport_motion:'/api/read?root=lerms-preview&path=motion.json',transport_motion_sha256:ids.motion,transport_frame:'/api/read?root=lerms-preview&path=frame.json',transport_frame_sha256:ids.frame}))url.searchParams.set(name,value);
 report.url=url.href;report.phase='browser';report.browserExecutable=args['--chrome'];
 const {chromium}=await import(pathToFileURL(args['--playwright']));browser=await chromium.launch({executablePath:args['--chrome'],headless:true,args:['--enable-unsafe-webgpu','--use-angle=metal']});page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>report.errors.push(String(e)));
 await page.goto(url.href);await page.evaluate(async()=>{while(true){const state=window.kaminosGivenMotion?.snapshot();if(state?.status==='mounted')return;if(state?.status==='failed')throw Error(state.error);if(window.kaminosLiveTransport?.snapshot().status==='failed')throw Error(window.kaminosLiveTransport.snapshot().error);await new Promise(resolve=>requestAnimationFrame(resolve));}});
 const snapshot=()=>page.evaluate(()=>({motion:window.kaminosGivenMotion.snapshot(),positions:window.kaminosLiveTransport.positions(),registered:window.kaminosSceneObjectDebugState()}));
 async function retain(label,expected){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const raw=await snapshot();check(raw.motion,expected);await fs.writeFile(path.join(out,label+'.state.v8'),v8.serialize(raw));await page.screenshot({path:path.join(out,label+'.png')});report.images.push(label+'.png');const p=raw.motion.playback;report.samples.push({label,frame:p.frame,status:p.status,actor:p.actualLocalPose.actor,bones:p.actualLocalPose.bones,skinUpdateMs:raw.motion.skin.lastUpdateMs,goldSha256:hash(Buffer.from(new Float32Array(raw.positions.gold).buffer)),raw:label+'.state.v8'});return raw;}
 report.phase='source-start';const start=await retain('01-source-start',0);assert.equal(start.motion.skin.registeredIds.length,29);assert.ok(start.motion.skin.registeredIds.every(id=>start.registered.some(row=>row.id===id)),'given creature/Bones not registered');
 report.phase='actual-playback';await page.getByRole('button',{name:'Play source',exact:true}).click();await page.evaluate(async()=>{while(window.kaminosGivenMotion.read().frame<15){const state=window.kaminosGivenMotion.read();if(['failed','removed'].includes(state.status))throw Error(state.error??state.status);await new Promise(resolve=>requestAnimationFrame(resolve));}});await page.getByRole('button',{name:'Pause source',exact:true}).click();const moving=await retain('02-after-live-play');assert.ok(moving.motion.playback.frame>=15);assert.equal(moving.motion.playback.status,'paused');
 report.phase='source-poses';for(const frame of [15,30,45,59]){await page.evaluate(frame=>window.kaminosGivenMotion.seek(frame),frame);await retain('pose-'+frame,frame);}
 assert.equal(new Set(report.samples.map(s=>s.goldSha256)).size>2,true,'skin stayed at the same pose');
 assert.deepEqual(report.errors,[],'positive motion route emitted a page error');
 report.phase='negative-source';const wrong=new URL(url);wrong.searchParams.set('transport_motion_sha256','0'.repeat(64));await page.goto(wrong.href);await page.evaluate(async()=>{while(!['mounted','failed'].includes(window.kaminosGivenMotion?.snapshot().status))await new Promise(resolve=>requestAnimationFrame(resolve));});report.negative=await page.evaluate(()=>window.kaminosGivenMotion.snapshot());assert.equal(report.negative.status,'failed');assert.equal(report.negative.phase,'source-authentication');assert.match(report.negative.error,/digest mismatch/);
 report.status='inspection-passed';report.limit='Actual existing scene/deformer playback and full source poses; no gait/contact/production-rate/main-join claim';
}catch(error){report.status='failed';report.failure=String(error.stack??error);process.exitCode=1;try{await page?.screenshot({path:out+'/failure.png'});report.images.push('failure.png');}catch{}}
finally{try{await browser?.close();report.browserClosed=true;}catch(error){report.cleanupError=String(error);process.exitCode=1;}if(server){server.kill('SIGTERM');await new Promise(resolve=>server.exitCode!==null?resolve():server.once('exit',resolve));report.serverExit=server.exitCode;}await fs.writeFile(out+'/server.log',serverLog);await fs.writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,phase:report.phase,failure:report.failure,images:report.images}));}
