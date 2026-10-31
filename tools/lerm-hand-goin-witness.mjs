import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {bindMlsWitnessSource,MLS_WITNESS_FILES} from './mls-witness-source.mjs';
import {waitForLermScene,waitForLermState} from './lerm-witness-startup.mjs';
const {values:a}=parseArgs({options:Object.fromEntries(['output','browser','playwright','capture','setup','python','models','joint-regressor','port'].map(k=>[k,{type:'string'}]))});
const out=path.resolve(a.output);fs.mkdirSync(out,{recursive:true});
const report={status:'failed',phase:'input',argv:process.argv,pageErrors:[],consoleErrors:[],observations:[],browserClosed:false,serverStopped:false};
const save=()=>fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2));save();
let server,context,page;
try{
 const capture=JSON.parse(fs.readFileSync(a.capture)),image=Buffer.from(capture.request.image,'base64');
 fs.copyFileSync(a.capture,out+'/camera-source.json');fs.writeFileSync(out+'/source.png',image);
 report.setup=JSON.parse(fs.readFileSync(a.setup));report.fixture='retained real camera image; controlled world hand placement, not live human aiming';
 const url=new URL(`http://127.0.0.1:${a.port}/`);url.searchParams.set('workspace','workbench');url.searchParams.set('experiment','lerms/hand-goin');url.searchParams.set('experiment_inputs',JSON.stringify(report.setup));report.url=url.href;
 const log=fs.openSync(out+'/server.log','w');
 report.catalogue='experiments/lerms';report.startupWait={timeoutMs:0,completion:'actual experiment activation',failure:'explicit activation error or browser failure'};
 server=spawn(a.python,['-u','tools/hand_browser_server.py','--port',a.port,'--models',a.models,'--joint-regressor',a['joint-regressor'],'--output',out+'/server'],{cwd:process.cwd(),env:{...process.env,KAMINOS_EXPERIMENTS_DIR:report.catalogue},stdio:['ignore',log,log]});fs.closeSync(log);
 report.serverPid=server.pid;report.phase='server';save();
 while(true){if(server.exitCode!==null)throw Error('Owned asset server exited');let response;try{response=await fetch(new URL('/api/runtime-config',url));}catch{}
   if(response?.ok){report.preflight=await response.json();assert.equal(report.preflight.source?.repoRoot,fs.realpathSync(process.cwd()),'Wrong served source root');break;}await new Promise(r=>setTimeout(r,100));}
 report.browserExecutable=fs.realpathSync(a.browser);assert(!report.browserExecutable.includes('/Google Chrome.app/'));
 const {chromium}=await import(pathToFileURL(a.playwright));
 context=await chromium.launchPersistentContext(out+'/profile',{executablePath:a.browser,headless:true,viewport:{width:1280,height:900},recordVideo:{dir:out+'/video',size:{width:1280,height:900}},args:['--use-mock-keychain','--password-store=basic','--autoplay-policy=no-user-gesture-required']});
 page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
 const verify=bindMlsWitnessSource({page,url:url.href,root:process.cwd(),out,report,files:[...MLS_WITNESS_FILES,'mls-sphere-query.mjs','experiments/lerms/hand-goin.experiment.mjs','experiments/lerms/goin-pursuit.experiment.mjs','experiments/lerms/goin-task.mjs','experiments/hand-live.experiment.mjs','experiments/hand-browser-juice.experiment.mjs','experiments/hand-play-space.mjs']});
 await page.route('**/__lerm-camera.png',route=>route.fulfill({contentType:'image/png',body:image}));
 const installCamera=()=>{globalThis.lermWitnessCameraCalls=0;navigator.mediaDevices.getUserMedia=async()=>{
   globalThis.lermWitnessCameraCalls++;
   const image=new Image();image.src='/__lerm-camera.png';await image.decode();const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
   const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);const stream=canvas.captureStream(30);
   const draw=()=>{if(stream.getTracks().some(t=>t.readyState==='live')){ctx.drawImage(image,0,0);requestAnimationFrame(draw);}};draw();return stream;
 };};
 await page.addInitScript(installCamera);
 report.phase='load';save();await page.goto(url.href);
 await waitForLermScene(page,report.consoleErrors);
 await page.evaluate(installCamera);
 const invoke=(name,input)=>page.evaluate(async({name,input})=>{const result=await window.kaminosWorkbenchExperiments.invoke(name,input);return ArrayBuffer.isView(result)?Array.from(result):result;},{name,input});
 const read=()=>page.evaluate(()=>window.kaminosWorkbenchExperiments.read());
 const wait=predicate=>waitForLermState(read,predicate);
 const captureState=async name=>{const state=await read();report.observations.push({name,state});await page.screenshot({path:out+'/'+name+'.png'});save();return state;};
 await invoke('setSourceFlux',0);await invoke('start');
 report.cameraFixtureCalls=await page.evaluate(()=>globalThis.lermWitnessCameraCalls);assert(report.cameraFixtureCalls>0,'Retained camera fixture was not consumed');save();
 await wait(s=>{if(s.hand.error||s.hand.fingerJuice.error)throw Error(s.hand.error??s.hand.fingerJuice.error);return s.hand.received>=2&&s.hand.visible;});
 report.phase='dry-theft';save();await invoke('setRunning',{running:true});
 await wait(s=>{if(s.physics.failure||s.water.status==='failed')throw Error(s.physics.failure??s.water.error);return s.task.custody.phase==='carried';});
 await invoke('setRunning',{running:false});
 let state=await captureState('carried-dry');assert.equal(state.task.custody.phase,'carried');const goinId=state.goin.id;
 assert.equal(state.hand.identity.backend,'webgpu-local');assert.equal(state.hand.fingerJuice.backend,'mls-mpm');assert.equal(state.hand.acquisitionDetails.fallback,false);
 assert.deepEqual(state.hand.fingerJuice.runtime.solver.domain.gridDimensions,report.setup.hand.fluidGridSize);
 await invoke('sampleWater');state=await read();assert.equal(state.water.overlap,0);assert.equal(state.task.custody.phase,'carried');
 const center=state.water.receiver.center,hand=state.hand,emitter=hand.fingerJuice.packet.emitters.find(e=>e.active);assert(emitter,'real retained hand must produce an active finger');
 const config=hand.playSpace.config,observation=hand.playSpace.observation;
 const factor=(observation.imageWrist[0]-.5)*(config.mirror?-1:1);assert(Math.abs(factor)>.01,'fixture wrist must support controlled horizontal placement');
 const reachX=config.reachX+(center[0]-emitter.origin_world[0])/factor;assert(reachX>0,'controlled hand placement must preserve legal reach');
 report.alignment={receiver:center,emitter,playSpace:{reachX,height:config.height+center[1]-emitter.origin_world[1],depth:config.depth+center[2]-emitter.origin_world[2]}};
 await invoke('setPlaySpace',report.alignment.playSpace);await invoke('setSourceFlux',1800);
 report.phase='liquid-hit';save();
 await wait(s=>{if(s.water.status==='failed')throw Error(s.water.error);return s.task.custody.phase==='dropped'&&s.water.overlap>0;});
 state=await captureState('liquid-drop');assert.equal(state.goin.id,goinId);assert(state.physics.active);assert.equal(state.water.route,'kaminos/mls-mpm-finger-juice-v1');
 await verify();
 await invoke('stop');
 // Paused native state makes a CPU snapshot an independent check of the GPU reduction.
 const words=await invoke('snapshotWater');fs.writeFileSync(out+'/particles.json',JSON.stringify(Array.from(words)));
 state=await read();const domain=state.hand.fingerJuice.runtime.solver.domain;
 const first=Array.from(words).findIndex((v,i)=>i%20===3&&v>0);assert(first>=3);
 const sphere={center:[0,1,2].map(i=>words[first-3+i]*domain.cellSize+domain.originWorld[i]),radius:.05};
 const observed=await invoke('sampleLiquidSphere',sphere);let active=0,overlap=0;
 for(let i=0;i<words.length;i+=20)if(words[i+3]>0){active++;const distance=Math.hypot(...sphere.center.map((v,k)=>words[i+k]*domain.cellSize+domain.originWorld[k]-v));if(distance<=sphere.radius+domain.cellSize*.65)overlap++;}
 report.queryOracle={sphere,observed,active,overlap};assert.equal(observed.active,active);assert.equal(observed.overlap,overlap);assert(overlap>0);
 const dry=await invoke('sampleLiquidSphere',{center:[100,100,100],radius:.1});assert.equal(dry.overlap,0);report.miss=dry;
 await invoke('setSourceFlux',0);await invoke('resetPile');await invoke('sampleWater');
 await invoke('advance',{seconds:.25});state=await captureState('physical-fall');assert.equal(state.goin.id,goinId);
 await invoke('setRunning',{running:true});
 await wait(s=>{if(s.physics.failure||s.water.status==='failed')throw Error(s.physics.failure??s.water.error);return s.task.custody.phase==='carried';});
 await invoke('setRunning',{running:false});state=await captureState('recovered');assert.equal(state.task.custody.phase,'carried');assert.equal(state.goin.id,goinId);
 assert.deepEqual(report.pageErrors,[]);report.status='complete';report.phase='complete';
}catch(error){report.error=String(error);report.stack=error.stack;process.exitCode=1;if(page){try{report.failure=await page.evaluate(()=>({state:window.kaminosWorkbenchExperiments?.state(),text:document.body.innerText}));await page.screenshot({path:out+'/failure.png'});}catch{}}}
finally{
 if(page)try{await page.evaluate(()=>window.kaminosWorkbenchExperiments?.close());}catch{}
 if(context){try{report.video=await page?.video()?.path();await context.close();report.browserClosed=true;}catch(error){report.cleanupError=String(error);report.status='failed';process.exitCode=1;}}
 if(server){try{if(server.exitCode===null){server.kill('SIGTERM');await once(server,'exit');}report.serverStopped=true;}catch(error){report.serverCleanupError=String(error);report.status='failed';process.exitCode=1;}}
 save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,report:out+'/report.json'}));
