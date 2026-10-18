import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {serialize} from 'node:v8';

export function validateRigCastState(state,setup,frame){
 assert.equal(state?.actors?.length,setup.casts.length,'Missing or extra cast');
 assert.equal(new Set(state.actors.map(a=>a.objectId)).size,setup.casts.length,'Duplicate scene registrations');
 for(const expected of setup.casts){
  const a=state.actors.find(a=>a.slug===expected.slug);assert.ok(a?.objectId,'Missing registered body');
  assert.equal(a.source.caseSha256,expected.case_sha256,'Wrong cast');assert.equal(a.source.motionSha256,expected.motion_sha256,'Wrong motion');assert.equal(a.source.frameSha256,expected.frame_sha256,'Wrong bind frame');
  assert.equal(a.source.effectiveMotionRoute,'retained-source-plus-fixed-rest-descendants');
  assert.equal(a.skin.bones,36);assert.ok(a.skin.vertices>0);assert.equal(a.skin.deformation.backend,'webgpu-dense-dq','Wrong/fallback deformation');assert.ok(a.skin.deformation.dispatches>0,'No GPU dispatch');
  assert.equal(a.playback.frame,frame,'Wrong/skipped/stale source frame');assert.notEqual(a.playback.status,'playing','Unheld capture');
  assert.equal(a.playback.actualLocalPose?.bones?.length,36,'Missing actual bone poses');
  assert.ok(a.playback.actualLocalPose.bones.every(b=>b.matrix?.length===16&&b.matrix.every(Number.isFinite)),'Incomplete/nonfinite actual pose');
 }
}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const servedModuleUrl=(path,pageUrl)=>new URL('/'+path.replace(/^\/+/,''),pageUrl).href;
export async function witness(args){
 const out=resolve(args.out);mkdirSync(out,{recursive:true});
 const report={status:'running',phase:'inputs',requested:args,errors:[],console:[],frames:[],captures:[]};
 const persist=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2)+'\n');persist();
 let browser,context,page;const phase=p=>{report.phase=p;persist();};
 try{
  const offer=JSON.parse(readFileSync(args.offer)),setup=offer.setup;
  report.offerSha256=hash(readFileSync(args.offer));report.sourceRevision=offer.sourceCommit;
  const {chromium}=await import(args.playwright);report.executable=realpathSync(args.chrome);assert.ok(!report.executable.includes('/Applications/Google Chrome.app/'),'Independent automation executable required');
  phase('browser');browser=await chromium.launch({headless:true,executablePath:report.executable,args:['--use-mock-keychain','--password-store=basic','--no-first-run']});
  context=await browser.newContext({viewport:{width:1920,height:1080},recordVideo:{dir:join(out,'video'),size:{width:1920,height:1080}}});page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>report.console.push({type:m.type(),text:m.text(),location:m.location()}));
  phase('load');await page.goto(args.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(async()=>{if(window.kaminosWorkbenchExperimentError)return true;const owner=window.kaminosWorkbenchExperiments;if(owner?.state().id!=='mushfinger/rig-cast-comparison')return false;try{return (await owner.read())?.actors?.length===2;}catch{return false;}});
  assert.equal(await page.evaluate(()=>window.kaminosWorkbenchExperimentError??null),null);
  report.effectiveUrl=page.url();report.runtime=await page.evaluate(async()=>await(await fetch('/api/runtime-config')).json());
  assert.equal(report.runtime.source.repoRoot,realpathSync(args.root));assert.equal(report.runtime.source.commit,offer.sourceCommit);assert.equal(report.runtime.source.dirty,false);
  report.experimentState=await page.evaluate(()=>window.kaminosWorkbenchExperiments.state());assert.equal(report.experimentState.id,'mushfinger/rig-cast-comparison');
  for(const file of offer.modules){const response=await page.request.get(servedModuleUrl(file.path,page.url()));assert.equal(response.status(),200,'Served module unavailable: '+file.path);assert.equal(hash(await response.body()),file.sha256,'Served module changed: '+file.path);}
  const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
  const invoke=(operation,input)=>page.evaluate(({operation,input})=>window.kaminosWorkbenchExperiments.invoke(operation,input),{operation,input});
  const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const capture=async name=>{await settle();const path=join(out,name+'.png');await page.screenshot({path});report.captures.push({path,sha256:hash(readFileSync(path))});return path;};
  await settle();report.initial=await read();validateRigCastState(report.initial,setup,setup.sample??0);report.registrations=await page.evaluate(()=>window.kaminosSceneObjectDebugState());await capture('initial');
  phase('native-replay');const replay=page.locator('[aria-label="Matched clip · both generated casts"] .playback-replay');await replay.scrollIntoViewIfNeeded();const box=await replay.boundingBox();assert.ok(box);assert.ok(await replay.evaluate((n,p)=>n.contains(document.elementFromPoint(p.x,p.y)),{x:box.x+box.width/2,y:box.y+box.height/2}),'Replay is occluded');await replay.click();
  await page.waitForFunction(async()=>(await window.kaminosWorkbenchExperiments.read()).actors.every(a=>a.playback.frame>1));await invoke('pause');report.afterPlay=await read();assert.ok(report.afterPlay.actors.every(a=>a.playback.frame>1));
  phase('contiguous-frame-capture');await page.evaluate(()=>{window.kaminosSelection?.clear();window.kaminosViewportSettings?.set({bones:false,paths:false,gizmos:false});});
  const start=Number(args.start??10),count=Number(args.count??20);assert.ok(Number.isInteger(start)&&Number.isInteger(count)&&start>=0&&count>0&&start+count<=report.initial.actors[0].playback.frames,'Explicit capture slice is outside the retained source');
  report.gpuSamples=[];
  for(let i=0;i<count;i++){
   const frame=start+i;await invoke('seek',{frame});await settle();const state=await read();validateRigCastState(state,setup,frame);
   const path=await capture('frame-'+String(frame).padStart(3,'0'));writeFileSync(join(out,'frame-'+String(frame).padStart(3,'0')+'.json'),JSON.stringify(state)+'\n');report.frames.push({frame,path,sha256:hash(readFileSync(path))});
   if(i===0||i===count-1)for(const c of setup.casts){
    const sample=await page.evaluate(async slug=>{const r=await window.kaminosWorkbenchExperiments.invoke('inspect',{slug});return {slug,source:r.source,playback:r.playback,backend:r.geometry.backend,positions:Array.from(r.geometry.positions)};},c.slug);
    assert.equal(sample.backend,'webgpu-dense-dq');assert.equal(sample.positions.length,state.actors.find(a=>a.slug===c.slug).skin.vertices*3);assert.ok(sample.positions.every(Number.isFinite));let minimum=Infinity,maximum=-Infinity;for(const v of sample.positions){minimum=Math.min(minimum,v);maximum=Math.max(maximum,v);}assert.ok(maximum>minimum,'Blank GPU sample');
    sample.positions=Float32Array.from(sample.positions);const file=join(out,`${c.slug}-frame-${frame}.v8`);writeFileSync(file,serialize(sample));report.gpuSamples.push({slug:c.slug,frame,file,sha256:hash(readFileSync(file)),geometryHash:hash(Buffer.from(sample.positions.buffer))});
   }
  }
  for(const c of setup.casts){const rows=report.gpuSamples.filter(r=>r.slug===c.slug);assert.notEqual(rows[0].geometryHash,rows[1].geometryHash,'Cached geometry did not move');}
  const montage=await context.newPage();await montage.setViewportSize({width:1800,height:1800});report.strips=[];
  for(let start=0;start<report.frames.length;start+=5){const frames=report.frames.slice(start,start+5);await montage.setContent('<style>body{margin:0;background:#181c20;color:white;font:18px system-ui}.grid{display:grid;grid-template-columns:900px 900px}p{margin:6px;height:26px}img{width:900px;display:block}</style><div class="grid">'+frames.map(f=>`<div><p>Retained source frame ${f.frame}</p><img src="data:image/png;base64,${readFileSync(f.path).toString('base64')}"></div>`).join('')+'</div>');await montage.locator('img').evaluateAll(images=>Promise.all(images.map(i=>i.decode())));const path=join(out,`strip-${frames[0].frame}-${frames.at(-1).frame}.png`);await montage.screenshot({path,fullPage:true});report.strips.push({path,sha256:hash(readFileSync(path))});}await montage.close();
  await invoke('rest');await capture('generating-rest');assert.deepEqual(report.errors,[]);assert.deepEqual(report.console.filter(m=>m.type==='error'&&/^THREE\.(?:Renderer|WebGPURenderer|WebGPUBackend):/.test(m.text)),[]);
  report.status='complete';phase('complete');
 }catch(error){report.status='failed';report.error={message:error.message,stack:error.stack};if(page){
  try{report.lastOwnerState=await page.evaluate(()=>({url:location.href,owner:window.kaminosWorkbenchExperiments?.state()??null,error:window.kaminosWorkbenchExperimentError??null}));}catch(e){report.ownerReadError=e.message;}
  try{report.lastState=await page.evaluate(()=>window.kaminosWorkbenchExperiments?.read());}catch(e){report.stateReadError=e.message;}
  try{const path=join(out,'failure.png');await page.screenshot({path});report.failureCapture={path,sha256:hash(readFileSync(path))};}catch(e){report.captureError=e.message;}
 }process.exitCode=1;}
 finally{await context?.close().catch(e=>report.errors.push(e.message));if(browser){await browser.close();report.browserClosed=true;}persist();}
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];const result=await witness(args);console.log(JSON.stringify({status:result.status,phase:result.phase,error:result.error}));}
