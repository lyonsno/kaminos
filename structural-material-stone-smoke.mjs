import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectStoneThickness } from './structural-material-stone-evidence.mjs';
import { createStoneObservationRuntime } from './structural-material-stone-experiment.mjs';
import * as THREE from 'three';

const [outputInput,executableInput,exercise='paired',sharedRootInput,sharedRevision]=process.argv.slice(2);
if(!outputInput||!executableInput)throw new Error('usage: node structural-material-stone-smoke.mjs OUTPUT.json INDEPENDENT_BROWSER');
const root=path.dirname(fileURLToPath(import.meta.url)),output=path.resolve(outputInput),hash=b=>createHash('sha256').update(b).digest('hex');
const report={status:'running',phase:'preflight',exercise,root,argv:process.argv,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sources:{},inputs:[],checks:[],states:{},captures:{},errors:[],lastTrustworthyEvidence:'invocation'};
fs.mkdirSync(path.dirname(output),{recursive:true});const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));save();
let server,child,socket,stderr='',nextId=0,expectedStrength=200;const pending=new Map(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
let shared;
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{report.inputs.push({expression,at:new Date().toISOString()});save();const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
const input=async params=>{report.inputs.push({method:'Input.dispatchMouseEvent',params,at:new Date().toISOString()});save();return send('Input.dispatchMouseEvent',params);};
const check=(name,passed,observed)=>{report.checks.push({name,passed,observed});save();if(!passed)throw new Error(`Predicate failed: ${name}`);};
const witness=()=>evaluate('window.__stoneThickness.witness()');
async function capture(name){const state=await witness();report.states[name]=state;save();
  const errors=inspectStoneThickness(state,{preparedSha256:report.sources['artifacts/imported-stone-thickness/prepared.json'],sourceSha256:'33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011',strength:expectedStrength});
  check(`${name}: complete effective geometry, material and render contract`,errors.length===0,errors);
  check(`${name}: exact native imported-stone route`,state.route==='kaminos.structural-material.imported-stone-thickness.webgpu.v0'&&state.phase==='interactive'&&!state.failure&&state.identity?.backend==='webgpu'&&state.identity.adapterFallback===false,state.failure??state.identity);
  check(`${name}: prepared source and actual normal materials`,state.sourceSha256==='33eb6f774a3b2bd52751c052029b529359957a71ec3eeee2e93c51bee46d8011'&&state.preparedSha256===report.sources['artifacts/imported-stone-thickness/prepared.json']&&state.specimens.every(s=>s.normalMapped&&s.state.backend==='webgpu-avbd'),state.sourceSha256);
  check(`${name}: rendered poses consume current mechanical poses`,state.specimens.every(s=>s.rendererPoses.every((p,i)=>p.position.every((v,a)=>Math.abs(v-s.state.bodies[i].position[['x','y','z'][a]]-s.offset[a])<1e-6)&&p.quaternion.every((v,a)=>Math.abs(v-s.state.bodies[i].quaternion[['x','y','z','w'][a]])<1e-6))),null);
  const pixels=await evaluate('window.__stoneThickness.pixels()');check(`${name}: actual nonblank presentation`,pixels?.source==='actual-webgpu-presentation-texture'&&pixels.fraction>.001,pixels);
  const frame=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(frame.data,'base64'),target=`${output.slice(0,-path.extname(output).length)}-${name}.png`;fs.writeFileSync(target,bytes);report.captures[name]={path:target,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),pixels};report.lastTrustworthyEvidence=`${name} at steps ${state.specimens.map(s=>s.state.step)}`;save();return state;
}
try {
  if(!['paired','hold','workbench'].includes(exercise))throw new Error('Unknown stone exercise');
  if(exercise==='workbench'){
    if(!sharedRootInput||!sharedRevision)throw new Error('Workbench requires explicit shared repo root and revision');
    const sharedRoot=fs.realpathSync(sharedRootInput),effectiveRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:sharedRoot,encoding:'utf8'}).trim();
    if(effectiveRevision!==sharedRevision)throw new Error(`Shared workbench revision differs: ${effectiveRevision}`);
    execFileSync('git',['diff','--exit-code',sharedRevision,'--'],{cwd:sharedRoot,stdio:'pipe'});
    const sharedFiles=['experiment-work.mjs','experiment-scene.mjs','observation-session.mjs','visual-work.mjs','screenshot-png-rgb.mjs'];
    report.shared={root:sharedRoot,requestedRevision:sharedRevision,effectiveRevision,sources:Object.fromEntries(sharedFiles.map(name=>[name,hash(fs.readFileSync(path.join(sharedRoot,name)))]))};save();
    shared={...await import(pathToFileURL(path.join(sharedRoot,'experiment-work.mjs'))),...await import(pathToFileURL(path.join(sharedRoot,'observation-session.mjs'))),...await import(pathToFileURL(path.join(sharedRoot,'experiment-scene.mjs')))};
  }
  const executable=fs.realpathSync(executableInput);if(executable.includes('/Google Chrome.app/')||!/chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable))throw new Error('Independent browser required');
  report.browser={executable,version:execFileSync(executable,['--version'],{encoding:'utf8'}).trim()};
  for(const filename of ['structural-material-stone.html','structural-material-stone-view.js','structural-material-stone-fixture.js','structural-material-stone-prepare.mjs','structural-material-stone-smoke.mjs','structural-material-stone-experiment.mjs','structural-material-arch-gpu.js','structural-material-arch-gpu-kernels.js','structural-material-arch-stones.js','dist/structural-material-arch-gpu-engine.js','package-lock.json','artifacts/imported-stone-thickness/prepared.json','assets/arch-stones/03-bedded-stone-500-normal.glb'])report.sources[filename]=hash(fs.readFileSync(path.join(root,filename)));
  server=createServer((req,res)=>{const filename=path.resolve(root,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);if(!filename.startsWith(root+path.sep)){res.writeHead(403).end();return;}try{res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json'})[path.extname(filename)]??'application/octet-stream');res.setHeader('cache-control','no-store');res.end(fs.readFileSync(filename));}catch{res.writeHead(404).end();}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));report.requestedUrl=`http://127.0.0.1:${server.address().port}/structural-material-stone.html?smoke=1`;
  report.phase='browser-launch';report.browser.profile=fs.mkdtempSync(path.join(os.tmpdir(),'kaminos-stone-'));save();
  child=spawn(executable,['--headless=new','--enable-automation','--no-first-run','--no-default-browser-check','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal','--remote-debugging-port=0',`--user-data-dir=${report.browser.profile}`,'about:blank'],{stdio:['ignore','pipe','pipe']});report.browser.pid=child.pid;child.stderr.on('data',d=>stderr+=d);
  const endpoint=path.join(report.browser.profile,'DevToolsActivePort');while(!fs.existsSync(endpoint)){if(child.exitCode!==null)throw new Error(`Browser exited: ${stderr}`);await sleep(50);}const port=fs.readFileSync(endpoint,'utf8').split('\n')[0];
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();report.browser.target=targets.find(t=>t.type==='page');socket=new WebSocket(report.browser.target.webSocketDebuggerUrl);await new Promise((r,j)=>{socket.addEventListener('open',r,{once:true});socket.addEventListener('error',j,{once:true});});
  socket.addEventListener('message',event=>{const m=JSON.parse(event.data);if(m.method==='Runtime.exceptionThrown'){report.errors.push(m.params.exceptionDetails);save();}if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(p)m.error?p.reject(new Error(JSON.stringify(m.error))):p.resolve(m.result);}});
  socket.addEventListener('close',()=>{for(const p of pending.values())p.reject(new Error('CDP disconnected'));pending.clear();});
  await send('Page.enable');await send('Runtime.enable');report.browser.runtimeCommand=await send('Browser.getBrowserCommandLine');check('effective browser equals owned executable',fs.realpathSync(report.browser.runtimeCommand.arguments[0])===executable,executable);
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});report.phase='load';save();await send('Page.navigate',{url:report.requestedUrl});
  while(!await evaluate('Boolean(window.__stoneThickness)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}await sleep(350);report.effectiveUrl=await evaluate('location.href');check('effective page equals requested route',report.effectiveUrl===report.requestedUrl,report.effectiveUrl);
  const initial=await capture('initial');check('same material, solver and external fixture',JSON.stringify(initial.specimens[0].state.config)===JSON.stringify(initial.specimens[1].state.config),initial.specimens.map(s=>s.state.config));
  check('both imported interiors stand intact before hand load',initial.specimens.every(s=>s.state.broken===0),initial.specimens.map(s=>s.state.broken));
  if(exercise==='workbench'){
    report.phase='shared-workbench';save();
    const expected={preparedSha256:report.sources['artifacts/imported-stone-thickness/prepared.json'],sourceSha256:initial.sourceSha256,strength:200};
    const runtime=createStoneObservationRuntime({evaluate,expected});
    const preparation=JSON.parse(fs.readFileSync(path.join(root,'artifacts/imported-stone-thickness/prepared.json'),'utf8'));
    const currentBounds=state=>state.specimens.flatMap((s,i)=>s.state.bodies.map((body,index)=>{
      const g=preparation.specimens[i].cells[index].geometry,rest=preparation.specimens[i].cells[index].position,box=new THREE.Box3();
      const rotation=new THREE.Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);
      for(let k=0;k<g.properties.length;k+=g.numProp)box.expandByPoint(new THREE.Vector3(...g.properties.slice(k,k+3)).sub(new THREE.Vector3(...rest)).applyQuaternion(rotation).add(new THREE.Vector3(body.position.x+s.offset[0],body.position.y+s.offset[1],body.position.z+s.offset[2])));
      return{id:`stone-${i}-region-${index}`,representation:'current-prepared-geometry-bounds',min:box.min.toArray(),max:box.max.toArray()};
    }));
    const observationOut=path.join(path.dirname(output),`${path.basename(output,path.extname(output))}-observations`);
    report.shared.observationOut=observationOut;save();
    const result=await shared.observationSession({out:observationOut,source:{consumerRoot:root,consumerRevision:report.sourceRevision,consumerSources:report.sources,shared:report.shared,requestedUrl:report.requestedUrl,effectiveUrl:report.effectiveUrl,browser:report.browser},
      capture:async()=>Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'),
      exercise:async({retain})=>{
        const work=shared.experiment({runtime,retain});
        const before=await work.observe('intact');
        const rejected=await evaluate('window.__stoneThickness.camera({position:[5,3,7],target:[0,0,0],up:[0,1,0],near:200}).then(()=>({rejected:false}),error=>({rejected:true,message:error.message}))');
        const afterRejected=await runtime.read();
        check('invalid effective camera lens rejects without changing view or runtime',rejected.rejected&&JSON.stringify(afterRejected.camera)===JSON.stringify(before.observed.camera)&&afterRejected.phase==='interactive'&&!afterRejected.failure,rejected);
        await evaluate('window.__stoneThickness.pull(.24)');await evaluate('window.__stoneThickness.advance(30)');
        const injured=await work.observe('injured');
        check('shared observation retains actual hand-driven damage',injured.observed.specimens.some(s=>s.state.broken>0&&s.visibleCaps>0),injured.observed.specimens.map(s=>s.state.broken));
        const bounds=currentBounds(injured.observed),views=shared.viewsAround(bounds,{aspect:1280/900,fov:38});
        report.shared.bounds=bounds;report.shared.views=views;save();
        await work.camera(views.find(v=>v.name==='back'));const opposing=await work.observe('opposing-injury');
        check('shared opposing view keeps the identical held injury',opposing.observed.clock.runId===injured.observed.clock.runId&&opposing.observed.clock.completedSteps===injured.observed.clock.completedSteps&&JSON.stringify(opposing.observed.specimens.map(s=>s.state))===JSON.stringify(injured.observed.specimens.map(s=>s.state)),null);
        await evaluate('window.__stoneThickness.release()');const released=await work.observe('released');
        check('shared hold/unload preserves injury connectivity',released.observed.specimens.every((s,i)=>s.state.broken===injured.observed.specimens[i].state.broken),null);
        await evaluate('window.__stoneThickness.reset()');const reset=await work.observe('reset');
        check('shared observation sees reset as a new run with physical startup time',reset.observed.clock.runId!==before.observed.clock.runId&&reset.observed.clock.experimentSeconds===0&&reset.observed.clock.completedSeconds>0,null);
        return{sameMomentSteps:injured.observed.clock.completedSteps,physicalSeconds:injured.observed.clock.completedSeconds,constructionSteps:injured.observed.clock.constructionSteps,viewsUsed:['current','back'],claim:'Existing rigid-region stone runtime and shared observation composition, not shard solver evidence'};
      }});
    report.shared.result={status:result.status,observations:result.observations.map(o=>({name:o.name,status:o.status,image:o.image,sha256:o.sha256})),report:path.join(observationOut,'report.json')};
    for(const [filename,expectedHash] of Object.entries(report.shared.sources))check(`shared source unchanged: ${filename}`,hash(fs.readFileSync(path.join(report.shared.root,filename)))===expectedHash,null);
    check('shared observation session passed',result.status==='passed',result.result);
  }
  if(exercise==='hold'){
    report.phase='gravity-only-control';report.hold=[];save();
    for(let i=0;i<8;i++){await evaluate('window.__stoneThickness.advance(30)');const state=await witness();report.hold.push(state);save();}
    const held=await capture('gravity-only');check('gravity-only baseline remains intact through four seconds',held.specimens.every(s=>s.state.broken===0&&s.state.hand===null),held.specimens.map(s=>({broken:s.state.broken,step:s.state.step,maxStress:Math.max(...s.state.bonds.map(b=>b.stress))})));
  }
  if(exercise==='paired'){
  report.phase='intact-response';save();await evaluate('window.__stoneThickness.setStrength(1e8)');expectedStrength=1e8;await evaluate('window.__stoneThickness.pull(.08)');await evaluate('window.__stoneThickness.advance(60)');const elastic=await capture('intact-response');
  check('requested intact advancement completed on both models',elastic.specimens.every((s,i)=>s.state.step-initial.specimens[i].state.step===60),elastic.specimens.map(s=>s.state.step));
  const forces=elastic.specimens.map(s=>Math.hypot(s.state.hand.force.x,s.state.hand.force.y,s.state.hand.force.z));
  check('same prescribed pull produces finite distinct reaction',forces.every(v=>Number.isFinite(v)&&v>0)&&Math.abs(forces[0]-forces[1])>Math.max(...forces)*.01,forces);
  check('intact diagnostic retains all interfaces',elastic.specimens.every(s=>s.state.broken===0&&s.visibleCaps===0),elastic.specimens.map(s=>s.state.broken));
  check('support remains fixed and field moves before fracture',elastic.specimens.every((s,i)=>s.state.bodies.filter(b=>b.pinned).every(b=>Math.hypot(b.position.x-b.rest.x,b.position.y-b.rest.y,b.position.z-b.rest.z)<1e-7)&&s.state.bodies.some(b=>!b.pinned&&Math.hypot(b.position.x-b.rest.x,b.position.y-b.rest.y,b.position.z-b.rest.z)>1e-5)),null);
  await evaluate('window.__stoneThickness.release()');await evaluate('window.__stoneThickness.setStrength(200)');expectedStrength=200;await evaluate('window.__stoneThickness.reset()');report.phase='fracture-ramp';report.ramp=[];save();
  for(const travel of [.01,.03,.06,.12,.24,.48,.8,1.2]){await evaluate(`window.__stoneThickness.pull(${travel})`);await evaluate('window.__stoneThickness.advance(30)');const state=await witness();report.ramp.push({travel,state});save();if(state.specimens.some(s=>s.state.broken>0)&&!report.captures['first-fracture'])await capture('first-fracture');}
  const fractured=await capture('fractured');check('actual reactions cause persistent internal failure',fractured.specimens.every(s=>s.state.broken>0&&s.visibleCaps>0&&s.state.events.some(e=>e.kind==='crack'&&e.handActive&&e.stress>s.state.config.strength)),fractured.specimens.map(s=>({broken:s.state.broken,caps:s.visibleCaps})));
  check('different geometry changes failure sequence',report.ramp.some(r=>r.state.specimens[0].state.broken!==r.state.specimens[1].state.broken),report.ramp.map(r=>({travel:r.travel,broken:r.state.specimens.map(s=>s.state.broken)})));
  await evaluate('window.__stoneThickness.release()');await evaluate('window.__stoneThickness.advance(120)');const released=await capture('released');check('release does not heal failed material',released.specimens.every((s,i)=>s.state.broken>=fractured.specimens[i].state.broken),released.specimens.map(s=>s.state.broken));
  check('material operations preserve camera',JSON.stringify(initial.camera)===JSON.stringify(released.camera),released.camera);
  report.phase='pointer';await evaluate('window.__stoneThickness.reset()');const contact=(await evaluate('window.__stoneThickness.contacts()'))[1];
  await input({type:'mousePressed',...contact.screen,button:'left',buttons:1,clickCount:1});const picked=await witness();check('real pointer hits current imported skin',picked.lastPick?.specimen===1&&picked.specimens[1].state.hand?.index===picked.lastPick.index,picked.lastPick);
  await input({type:'mouseMoved',x:contact.screen.x,y:contact.screen.y+70,button:'left',buttons:1});await evaluate('window.__stoneThickness.advance(30)');await input({type:'mouseReleased',x:contact.screen.x,y:contact.screen.y+70,button:'left',buttons:0,clickCount:1});const pointer=await capture('pointer');check('pointer pull leaves camera unchanged',JSON.stringify(pointer.camera)===JSON.stringify(initial.camera),pointer.camera);
  await evaluate('window.__stoneThickness.pull(.3)');check('held pull is displayed before Reset',await evaluate('document.querySelector("#pull").value')==='0.3',null);
  await evaluate('window.__stoneThickness.reset()');const resetFromLoad=await witness();check('Reset clears both physical load and displayed pull',!resetFromLoad.paired&&resetFromLoad.specimens.every(s=>s.state.hand===null)&&await evaluate('document.querySelector("#pull").value')==='0',null);
  await evaluate('window.__stoneThickness.pull(.02)');const held=await witness();
  const beforeCamera=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),beforeBytes=Buffer.from(beforeCamera.data,'base64'),beforePath=`${output.slice(0,-path.extname(output).length)}-paused-camera-before.png`;fs.writeFileSync(beforePath,beforeBytes);
  await input({type:'mousePressed',x:90,y:220,button:'left',buttons:1,clickCount:1});await input({type:'mouseMoved',x:140,y:260,button:'left',buttons:1});await input({type:'mouseReleased',x:140,y:260,button:'left',buttons:0,clickCount:1});await sleep(150);
  const ordinaryOrbit=await witness(),afterCamera=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),afterBytes=Buffer.from(afterCamera.data,'base64'),afterPath=`${output.slice(0,-path.extname(output).length)}-paused-camera-after.png`;fs.writeFileSync(afterPath,afterBytes);
  report.pausedCamera={before:{path:beforePath,sha256:hash(beforeBytes),submissions:held.presentation.sceneSubmissions},after:{path:afterPath,sha256:hash(afterBytes),submissions:ordinaryOrbit.presentation.sceneSubmissions}};save();
  check('paused camera draws through ordinary path before forcing capture',ordinaryOrbit.presentation.sceneSubmissions>held.presentation.sceneSubmissions&&hash(beforeBytes)!==hash(afterBytes),report.pausedCamera);
  check('ordinary paused camera presentation advances no physics or load',ordinaryOrbit.specimens.every((s,i)=>JSON.stringify(s.state)===JSON.stringify(held.specimens[i].state)),null);
  const orbited=await capture('background-orbit');
  check('background orbit changes only camera and preserves paired load',JSON.stringify(held.camera)!==JSON.stringify(orbited.camera)&&orbited.paired&&orbited.specimens.every((s,i)=>JSON.stringify(s.state)===JSON.stringify(held.specimens[i].state)),orbited.camera);
  await evaluate('window.__stoneThickness.release()');const beforeMode=await witness();await evaluate('document.querySelector("#bind").click()');const boundMode=await witness();check('Bind selection is inert and does not silently route paired pull',boundMode.mode==='bind'&&await evaluate('document.querySelector("#pull").disabled')&&JSON.stringify(beforeMode.specimens.map(s=>s.state))===JSON.stringify(boundMode.specimens.map(s=>s.state)),boundMode.mode);
  await evaluate('document.querySelector("#shear").click()');
  await evaluate('window.__stoneThickness.reset()');await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await sleep(350);await capture('mobile');check('mobile controls fit',await evaluate('document.documentElement.scrollWidth<=innerWidth'),null);
  }
  check('no browser exceptions',report.errors.length===0,report.errors);report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};save();process.exitCode=1;}
finally{socket?.close();if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}if(server)await new Promise(r=>server.close(r));report.browser??={};report.browser.stderr=stderr;report.browser.ownedChildExited=child?.exitCode!==null;save();console.log(JSON.stringify({status:report.status,phase:report.phase,output,failure:report.failure?.message}));}
