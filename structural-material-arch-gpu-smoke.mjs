import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Vector3, Quaternion } from 'three';
import { inspectGpuConformance, inspectGpuArchLoad, inspectGpuArchRendererLifetime, inspectArchPerformanceTrial } from './structural-material-arch-gpu-evidence.mjs';
import { inspectStoneVisual, stoneAssetsForDetail } from './structural-material-arch-stones.js';

const [outputInput, executableInput, page = 'structural-material-arch-gpu-conformance.html', exercise = 'load', appearance = 'boxes', stoneDetail = '500-normal'] = process.argv.slice(2);
if (!outputInput || !executableInput) throw new Error('usage: node structural-material-arch-gpu-smoke.mjs OUTPUT.json INDEPENDENT_CHROME [PAGE]');
const output=path.resolve(outputInput), root=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={status:'running',phase:'preflight',root,argv:process.argv,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  browser:{},sources:{},inputs:[],captures:{},checks:[],errors:[],lastTrustworthyEvidence:'invocation'};
report.harnessSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url)));
fs.mkdirSync(path.dirname(output),{recursive:true});
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
let server,child,socket,stderr='',nextId=0,expectedStoneAssets=[];
const pending=new Map(), sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{report.inputs.push({expression,at:new Date().toISOString()});save();const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
function check(name,passed,observed){report.checks.push({name,passed,observed});save();if(!passed)throw new Error(`Predicate failed: ${name}`);}
const input=async params=>{report.inputs.push({method:'Input.dispatchMouseEvent',params,at:new Date().toISOString()});save();return send('Input.dispatchMouseEvent',params);};
const witness=()=>evaluate('window.__archCollapse.witness()');
async function capture(name,expected,expectedFailures){
  const state=await witness(),errors=inspectGpuArchLoad(state,expected,expectedFailures),pixels=await evaluate('window.__archCollapse.pixels()');
  if(appearance==='stones')errors.push(...inspectStoneVisual(state,stoneDetail));
  report.states??={};report.states[name]=state;save();
  check(`${name}: native route, requested configuration, live physical and displayed poses`,!errors.length,errors);
  check(`${name}: canvas contains geometry`,pixels.fraction>.001,pixels);
  const frame=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(frame.data,'base64');
  const target=`${output.slice(0,-path.extname(output).length)}-${name}.png`;fs.writeFileSync(target,bytes);
  report.captures[name]={path:target,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),pixels};
  check(`${name}: PNG dimensions match effective viewport`,report.captures[name].width===state.viewport.width&&report.captures[name].height===state.viewport.height,state.viewport);
  report.lastTrustworthyEvidence=`${name} at physical step ${state.state.step}`;save();return state;
}
async function injury(pick,delta={x:-1.5,y:0,z:.5},frames=60,requireFrontPatch=true){
  check('a visible material contact is available',Boolean(pick?.visible),pick);
  await input({type:'mousePressed',x:pick.screen.x,y:pick.screen.y,button:'left',buttons:1,clickCount:1});
  const selected=await witness();
  if(appearance==='stones')check('grab is attached to a visible stone triangle',expectedStoneAssets.some(asset=>asset.id===selected.lastPick?.asset)&&selected.lastPick?.eligibility==='surface'&&selected.lastPick.point.every((value,index)=>Math.abs(value-[pick.world.x,pick.world.y,pick.world.z][index])<1e-5),selected.lastPick);
  check('pointer selects the advertised current material patch',selected.state.hand?.index===pick.index&&selected.state.hand.indices.includes(pick.index)&&(!requireFrontPatch||selected.state.hand.indices.length>1&&selected.state.hand.layers.join(',')==='2'),selected.state.hand);
  let screen=pick.screen;
  for(let i=0;i<frames;i++){
    const target={x:pick.world.x+delta.x*(i+1)/frames,y:pick.world.y+delta.y*(i+1)/frames,z:pick.world.z+delta.z*(i+1)/frames};
    screen=await evaluate(`window.__archCollapse.projectWorld(${JSON.stringify(target)})`);
    await input({type:'mouseMoved',x:screen.x,y:screen.y,button:'left',buttons:1});await evaluate('window.__archCollapse.advance(1)');
  }
  const held=await witness();
  await input({type:'mouseReleased',x:screen.x,y:screen.y,button:'left',buttons:0,clickCount:1});
  check('release removes hand without erasing damage',(await witness()).state.hand===null,held.state.broken);return held;
}
function minimumY(state){let low=Infinity;for(const body of state.bodies)for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
  const [x,y,z]=body.halfExtents.map((value,index)=>value*[sx,sy,sz][index]),q=body.quaternion;
  const ux=q.y*z-q.z*y,uy=q.z*x-q.x*z,uz=q.x*y-q.y*x;
  low=Math.min(low,body.position.y+y+2*(q.z*ux-q.x*uz+q.w*uy));
}return low;}
function repairTarget(state){
  const bodyQuaternion=body=>new Quaternion(body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w);
  const anchor=(body,point)=>new Vector3(point.x,point.y,point.z).applyQuaternion(bodyQuaternion(body)).add(new Vector3(body.position.x,body.position.y,body.position.z));
  const gap=Math.min(...Object.values(state.state.dimensions))*.15;
  for(const bond of state.state.bonds){if(bond.alive)continue;const a=state.state.bodies[bond.a],b=state.state.bodies[bond.b];
    if(anchor(a,bond.anchorA).distanceTo(anchor(b,bond.anchorB))>gap||Math.abs(bodyQuaternion(a).dot(bodyQuaternion(b)))<.98)continue;
    const target=state.pickTargets.find(item=>item.visible&&(item.index===bond.a||item.index===bond.b));if(target)return{target,bond:bond.id};
  }
  return null;
}
async function repairClick(before){
  const candidate=repairTarget(before);check('a visible damaged current-pose connection can be repaired',Boolean(candidate),candidate);
  await evaluate('document.querySelector("#bind").click()');const selected=await witness();
  check('Bind selection leaves existing damage and pose untouched',selected.state.broken===before.state.broken&&JSON.stringify(selected.state.bodies)===JSON.stringify(before.state.bodies),selected.state.broken);
  const {target}=candidate,center=before.state.bodies[target.index].position,radius=Math.max(before.state.dimensions.dx,before.state.dimensions.dy)*2;
  const distance=body=>Math.hypot(body.position.x-center.x,body.position.y-center.y,body.position.z-center.z);
  const farDead=before.state.bonds.filter(bond=>!bond.alive&&Math.min(distance(before.state.bodies[bond.a]),distance(before.state.bodies[bond.b]))>radius).map(bond=>bond.id);
  check('local repair has damaged connections outside its neighborhood',farDead.length>0,farDead);
  await input({type:'mousePressed',x:target.screen.x,y:target.screen.y,button:'left',buttons:1,clickCount:1});
  check('Bind contact is the advertised current surface',(await witness()).state.hand?.index===target.index,(await witness()).lastPick);
  await evaluate('window.__archCollapse.advance(1)');const repaired=await capture('local-bind');
  const bound=repaired.state.events.filter(event=>event.kind==='bind'&&event.step>before.state.step);
  check('actual Bind input reconnects resident material',bound.length>0&&bound.some(event=>repaired.state.bonds.find(bond=>bond.id===event.id).alive),bound);
  check('local Bind does not restore remote damage',farDead.every(id=>!repaired.state.bonds.find(bond=>bond.id===id).alive),farDead.length);
  check('Bind leaves the operator camera untouched',JSON.stringify(repaired.camera)===JSON.stringify(before.camera),repaired.camera);
  await input({type:'mouseReleased',x:target.screen.x,y:target.screen.y,button:'left',buttons:0,clickCount:1});
  await evaluate('window.__archCollapse.advance(12)');const retained=await capture('local-bind-released');
  check('a repaired connection survives release and weight',bound.some(event=>retained.state.bonds.find(bond=>bond.id===event.id).alive),bound.map(event=>event.id));
  return retained;
}
async function liveClock(name='live-clock',expectedFailures=[]){
  const before=await witness(),wallStart=performance.now();check('live-clock exercise starts paused',before.paused===true,before.paused);
  await evaluate('document.querySelector("#pause").click()');await sleep(2000);await evaluate('(async()=>{document.querySelector("#pause").click();await window.__archCollapse.advance(0);})()');
  const live=await capture(name,undefined,expectedFailures),clock={wallSeconds:(performance.now()-wallStart)/1000,steps:live.state.step-before.state.step,simulationSeconds:live.state.time-before.state.time};
  report.liveClocks??={};report.liveClocks[name]=clock;
  check('the live clock advances actual GPU physics without manual advance',clock.steps>2&&clock.simulationSeconds>0&&live.paused===true,clock);return live;
}
save();
try {
  const executable=fs.realpathSync(executableInput);
  if(executable.includes('/Google Chrome.app/')||!/chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable))throw new Error('Independent native testing browser required');
  report.browser.executable=executable;report.browser.version=execFileSync(executable,['--version'],{encoding:'utf8'}).trim();
  const isArch=page==='structural-material-arch-gpu.html';
  if(!['boxes','stones'].includes(appearance)||appearance==='stones'&&!isArch)throw new Error('Unsupported visual appearance');
  if(appearance==='stones')expectedStoneAssets=stoneAssetsForDetail(stoneDetail);
  if(!['load','collapse','fracture','bind','controls','performance','standing-diagnostics','penalty-diagnostics','stiffness-diagnostics','construction-diagnostics','contact-diagnostics'].includes(exercise)||exercise!=='load'&&!isArch)throw new Error('Unsupported exercise');
  if(!isArch&&page!=='structural-material-arch-gpu-conformance.html')throw new Error('Unsupported GPU smoke page');
  for(const source of [page,...(isArch?['structural-material-arch-gpu-view.js','structural-material-arch-gpu.js','structural-material-arch-gpu-kernels.js','structural-material-arch-gpu-fixture.js']:['structural-material-arch-gpu-conformance.js']),'dist/structural-material-arch-gpu-engine.js','vendor/webphysics/provenance.json','package-lock.json','node_modules/three/build/three.module.js','node_modules/three/build/three.webgpu.js','node_modules/three/build/three.tsl.js'])report.sources[source]=hash(fs.readFileSync(path.join(root,source)));
  if(appearance==='stones')for(const source of ['structural-material-arch-stones.js',...expectedStoneAssets.map(asset=>asset.url)])report.sources[source]=hash(fs.readFileSync(path.join(root,source)));
  report.phase='http';save();
  server=createServer((req,res)=>{
    const filename=path.resolve(root,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);
    if(!filename.startsWith(`${root}${path.sep}`)){res.writeHead(403).end();return;}
    try{const bytes=fs.readFileSync(filename);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wgsl':'text/plain'})[path.extname(filename)]??'application/octet-stream');res.setHeader('cache-control','no-store');res.end(bytes);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  report.requestedUrl=`http://127.0.0.1:${server.address().port}/${page}${isArch?`?smoke=1${appearance==='stones'?`&stones=1&stoneDetail=${encodeURIComponent(stoneDetail)}`:''}`:''}`;
  report.phase='launch';report.browser.profile=fs.mkdtempSync(path.join(os.tmpdir(),'kaminos-arch-gpu-'));save();
  child=spawn(executable,['--headless=new','--enable-automation','--no-first-run','--no-default-browser-check','--enable-unsafe-webgpu','--use-gl=angle','--use-angle=metal','--remote-debugging-port=0',`--user-data-dir=${report.browser.profile}`,'about:blank'],{stdio:['ignore','pipe','pipe']});
  child.stderr.setEncoding('utf8').on('data',value=>{stderr+=value;});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});report.browser.pid=child.pid;save();
  const endpoint=path.join(report.browser.profile,'DevToolsActivePort');
  while(!fs.existsSync(endpoint)){if(child.exitCode!==null)throw new Error(`Testing browser exited: ${stderr}`);await sleep(50);}
  const port=fs.readFileSync(endpoint,'utf8').split('\n')[0];
  const targets=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target=targets.find(item=>item.type==='page');if(!target)throw new Error('No testing page target');report.browser.target=target;
  socket=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  socket.addEventListener('close',()=>{for(const item of pending.values())item.reject(new Error('CDP disconnected'));pending.clear();});
  socket.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.method==='Runtime.exceptionThrown'){report.errors.push(message.params.exceptionDetails);save();}if(message.id){const item=pending.get(message.id);if(!item)return;pending.delete(message.id);message.error?item.reject(new Error(JSON.stringify(message.error))):item.resolve(message.result);}});
  await send('Page.enable');await send('Runtime.enable');
  report.browser.runtimeVersion=await send('Browser.getVersion');report.browser.runtimeCommand=await send('Browser.getBrowserCommandLine');
  if(fs.realpathSync(report.browser.runtimeCommand.arguments[0])!==executable)throw new Error('Effective browser differs from owned launch');
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  report.phase='load';save();await send('Page.navigate',{url:report.requestedUrl});
  while(!await evaluate(isArch?'Boolean(window.__archCollapse)':'Boolean(window.__gpuConformance)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
  report.phase=isArch?'paused-arch-load':'conformance';save();
  report.result=await evaluate(isArch?'window.__archCollapse.witness()':'window.__gpuConformance');
  if(isArch&&report.result.phase==='interactive') { await sleep(350);report.pixels=await evaluate('window.__archCollapse.pixels()'); }
  report.effectiveUrl=await evaluate('location.href');
  const frame=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(frame.data,'base64');
  const capturePath=`${output.slice(0,-path.extname(output).length)}.png`;fs.writeFileSync(capturePath,bytes);report.captures.desktop={path:capturePath,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  report.lastTrustworthyEvidence=`${isArch?'paused arch':'native conformance'} report from ${report.effectiveUrl}`;
  report.evidenceErrors=isArch?inspectGpuArchLoad(report.result):inspectGpuConformance(report.result);
  if(appearance==='stones')report.evidenceErrors.push(...inspectStoneVisual(report.result,stoneDetail));
  if(isArch){
    if(report.result.phase!=='interactive'||report.result.state?.backend!=='webgpu-avbd'||report.result.identity?.backend!=='webgpu')report.evidenceErrors.push('GPU arch failed to initialize');
    if(!(report.pixels?.fraction>.001))report.evidenceErrors.push('Arch canvas is blank');
    if(!report.result.state?.bodies?.length)report.evidenceErrors.push('No physical body readback');
  }
  if(report.evidenceErrors.length||report.errors.length)throw new Error(JSON.stringify({evidence:report.evidenceErrors,page:report.errors}));
  if(exercise==='performance'){
    report.phase='performance';report.performanceTrials=[];report.performancePicks=[];save();
    const visible=report.result.pickTargets.filter(target=>target.visible);
    for(const pick of [visible[0],visible[Math.floor(visible.length/2)],visible.at(-1)]){
      check('timing pick has a visible material target',Boolean(pick),pick);
      await input({type:'mousePressed',x:pick.screen.x,y:pick.screen.y,button:'left',buttons:1,clickCount:1});
      const selected=await witness();report.performancePicks.push({requested:pick,observed:selected.lastPick});save();
      check('timing pick measured actual current triangle contact',selected.lastPick?.index===pick.index&&selected.lastPick.eligibility==='surface'&&Number.isFinite(selected.lastPick.raycastMilliseconds)&&selected.lastPick.raycastMilliseconds>=0,selected.lastPick);
      await input({type:'mouseReleased',x:pick.screen.x,y:pick.screen.y,button:'left',buttons:0,clickCount:1});
    }
    for(const settings of [{mode:'solver',renderPasses:1},{mode:'render',renderPasses:1},{mode:'coupled',renderPasses:1},{mode:'coupled',renderPasses:2}]){
      await evaluate('window.__archCollapse.reset()');
      const trial=await evaluate(`window.__archCollapse.performanceTrial(${JSON.stringify({...settings,samples:60,warmup:20})})`);
      report.performanceTrials.push(trial);save();
      const errors=inspectArchPerformanceTrial(trial,{...settings,samples:60,warmup:20,appearance,...(appearance==='stones'?{stoneDetail}:{}),bodies:report.result.state.bodies.length,config:report.result.state.config,triangles:report.result.visual.triangles});
      check(`${settings.mode}/${settings.renderPasses}: native requested configuration and complete timing samples`,!errors.length,errors);
      report.lastTrustworthyEvidence=`${settings.mode}/${settings.renderPasses} complete timing samples`;save();
    }
    await capture('performance-final');
  }
  if(isArch&&exercise==='standing-diagnostics'){
    report.phase='standing-convergence-comparison';report.diagnostics={};save();
    for(const iterations of [20,80]){
      const url=new URL(report.requestedUrl);url.searchParams.set('strength','1e12');url.searchParams.set('solverIterations',String(iterations));
      await send('Page.navigate',{url:url.href});while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
      const received=await witness();check('diagnostic control values are actually applied',received.state.config.strength===1e12&&received.state.config.solverIterations===iterations,received.state.config);
      await evaluate('window.__archCollapse.advance(120)');const state=await capture(`intact-solve-${iterations}`,{layers:3,strength:1e12,timeStep:1/60,gripRadius:.55,solverIterations:iterations});
      report.diagnostics[iterations]={finalMaximumStress:Math.max(...state.state.bonds.map(bond=>bond.stress)),peakMaximumStress:Math.max(...state.state.samples.map(sample=>sample.maximumStress)),maximumSag:Math.max(...state.state.bodies.map(body=>Math.abs(body.position.y-body.rest.y))),broken:state.state.broken};save();
    }
  }
  if(isArch&&exercise==='penalty-diagnostics'){
    report.phase='initial-penalty-comparison';report.diagnostics={};save();
    for(const initialJointPenalty of [1,1000,1e6]){
      const url=new URL(report.requestedUrl);url.searchParams.set('initialJointPenalty',String(initialJointPenalty));
      await send('Page.navigate',{url:url.href});while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
      const received=await witness();check('diagnostic penalty is actually applied without changing material strength',received.state.config.strength===80&&received.state.config.initialJointPenalty===initialJointPenalty,received.state.config);
      await evaluate('window.__archCollapse.advance(120)');const state=await capture(`initial-penalty-${initialJointPenalty}`,{layers:3,strength:80,timeStep:1/60,gripRadius:.55,solverIterations:20,initialJointPenalty});
      report.diagnostics[initialJointPenalty]={finalMaximumStress:Math.max(...state.state.bonds.map(bond=>bond.stress)),peakMaximumStress:Math.max(...state.state.samples.map(sample=>sample.maximumStress)),maximumSag:Math.max(...state.state.bodies.map(body=>Math.abs(body.position.y-body.rest.y))),broken:state.state.broken,penaltyRange:[Math.min(...state.state.bonds.map(bond=>bond.penaltyMinimum)),Math.max(...state.state.bonds.map(bond=>Math.max(bond.linearPenaltyMaximum,bond.angularPenaltyMaximum)))]};save();
    }
  }
  if(isArch&&exercise==='stiffness-diagnostics'){
    report.phase='finite-stiffness-comparison';report.diagnostics={};save();
    for(const stiffness of [1000,10000,100000]){
      const url=new URL(report.requestedUrl);url.searchParams.set('stiffness',String(stiffness));url.searchParams.set('initialJointPenalty',String(stiffness));
      await send('Page.navigate',{url:url.href});while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
      const received=await witness();check('finite stiffness is applied at unchanged breaking strength',received.state.config.strength===80&&received.state.config.stiffness===stiffness&&received.state.config.initialJointPenalty===stiffness,received.state.config);
      await evaluate('window.__archCollapse.advance(120)');const state=await capture(`finite-stiffness-${stiffness}`,{layers:3,strength:80,timeStep:1/60,gripRadius:.55,solverIterations:20,stiffness,initialJointPenalty:stiffness});
      report.diagnostics[stiffness]={finalMaximumStress:Math.max(...state.state.bonds.map(bond=>bond.stress)),peakMaximumStress:Math.max(...state.state.samples.map(sample=>sample.maximumStress)),maximumSag:Math.max(...state.state.bodies.map(body=>Math.abs(body.position.y-body.rest.y))),broken:state.state.broken};save();
    }
  }
  if(isArch&&exercise==='construction-diagnostics'){
    report.phase='construction-load-comparison';report.diagnostics={};save();
    for(const gravityRampSeconds of [.5,1]){
      const url=new URL(report.requestedUrl);url.searchParams.set('gravityRampSeconds',String(gravityRampSeconds));
      await send('Page.navigate',{url:url.href});while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
      const received=await witness();check('construction loads full weight with fracture still active',received.state.config.strength===80&&received.state.config.gravityRampSeconds===gravityRampSeconds&&received.state.constructionLoad.gravityScale===1&&received.state.constructionLoad.complete,received.state.config);
      await evaluate('window.__archCollapse.advance(120)');const state=await capture(`construction-load-${gravityRampSeconds}`,{layers:3,strength:80,timeStep:1/60,gripRadius:.55,solverIterations:20,stiffness:1e6,initialJointPenalty:1e6,gravityRampSeconds});
      report.diagnostics[gravityRampSeconds]={finalMaximumStress:Math.max(...state.state.bonds.map(bond=>bond.stress)),peakMaximumStress:Math.max(...state.state.samples.map(sample=>sample.maximumStress)),maximumSag:Math.max(...state.state.bodies.map(body=>Math.abs(body.position.y-body.rest.y))),broken:state.state.broken};save();
    }
  }
  if(isArch&&exercise==='contact-diagnostics'){
    report.phase='contact-comparison';report.diagnostics={};save();
    for(const [name,substeps,preventPenetratingNormalDropout] of [['retained-normal',1,true],['two-substeps',2,false]]){
      const url=new URL(report.requestedUrl);url.searchParams.set('substeps',String(substeps));url.searchParams.set('preventPenetratingNormalDropout',String(preventPenetratingNormalDropout));
      await send('Page.navigate',{url:url.href});while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
      const received=await witness(),expected={substeps,preventPenetratingNormalDropout};
      check('contact controls reach the actual engine without strengthening the material',received.state.config.strength===80&&received.state.residency.substeps===substeps&&received.state.residency.preventPenetratingNormalDropout===preventPenetratingNormalDropout,received.state.residency);
      await evaluate('window.__archCollapse.advance(120)');const standing=await capture(`${name}-standing`,expected);
      check('diagnostic arch begins intact at full weight',standing.state.broken===0,{broken:standing.state.broken});
      const held=await injury(standing.pickTargets.find(item=>item.row===1&&item.visible));
      await evaluate('window.__archCollapse.advance(480)');const rest=await capture(`${name}-after-fall`,expected);
      report.diagnostics[name]={substeps,preventPenetratingNormalDropout,heldBroken:held.state.broken,broken:rest.state.broken,minimumCornerY:minimumY(rest.state),floorPenetration:rest.state.floorY-minimumY(rest.state),maximumHeight:Math.max(...rest.state.bodies.map(body=>body.position.y)),maximumSpeed:Math.max(...rest.state.bodies.map(body=>Math.hypot(...Object.values(body.velocity))))};save();
    }
  }
  if(isArch&&exercise==='bind'){
    report.phase='local-bind-exercise';save();await evaluate('window.__archCollapse.advance(120)');const standing=await capture('standing');
    await injury(standing.pickTargets.find(item=>item.row===1&&item.visible));const injured=await capture('released-injury');await repairClick(injured);
  }
  if(isArch&&['collapse','fracture'].includes(exercise)){
    report.phase='standing-under-weight';save();await evaluate('window.__archCollapse.advance(120)');const standing=await capture('standing');
    check('the arch stands intact under its own weight',standing.state.broken===0&&standing.state.bodies.every(body=>Math.abs(body.position.y-body.rest.y)<.05),{broken:standing.state.broken,maximumSag:Math.max(...standing.state.bodies.map(body=>Math.abs(body.position.y-body.rest.y)))});
    report.phase='front-patch-injury';save();const held=await injury(standing.pickTargets.find(item=>item.row===1&&item.visible),{x:-.35,y:0,z:.12},12);const injured=await capture('released-injury');
    check('front patch produces reaction-dependent fractures',injured.state.broken>0&&injured.state.events.some(event=>event.kind==='crack'&&event.handActive&&event.stress>injured.state.config.strength),injured.state.broken);
    check('object pull leaves camera under operator control',JSON.stringify(injured.camera)===JSON.stringify(standing.camera),injured.camera);
    report.phase='repeated-injury';save();await evaluate('window.__archCollapse.advance(6)');const wounded=await capture('wounded-before-second-grab');
    const oldDead=wounded.state.bonds.filter(bond=>!bond.alive).map(bond=>bond.id);
    check('the wounded arch retains connectivity for a second injury',oldDead.length>0&&oldDead.length<wounded.state.bonds.length,oldDead.length);
    const second=wounded.pickTargets.find(item=>item.visible&&item.row>2&&wounded.state.components[wounded.state.bodies[item.index].component].count>6);
    await injury(second,{x:1.4,y:.5,z:.6},60,false);const repeated=await capture('repeated-injury');
    check('second injury adds damage without healing prior damage',repeated.state.broken>wounded.state.broken&&oldDead.every(id=>!repeated.state.bonds.find(bond=>bond.id===id).alive),{before:wounded.state.broken,after:repeated.state.broken});
    let binding=repeated;
    if(exercise==='collapse'){
      binding=await repairClick(repeated);
      const repairedIds=binding.state.events.filter(event=>event.kind==='bind'&&event.step>repeated.state.step&&binding.state.bonds.find(bond=>bond.id===event.id).alive).map(event=>event.id);
      const repairedPick=binding.pickTargets.find(item=>item.visible&&binding.state.bonds.some(bond=>repairedIds.includes(bond.id)&&(bond.a===item.index||bond.b===item.index)));
      await evaluate('document.querySelector("#shear").click()');await injury(repairedPick,{x:-1.2,y:.3,z:.4},60,false);const reinjured=await capture('repaired-material-injury');
      check('repaired connectivity can fracture under a later actual grab',reinjured.state.events.some(event=>event.kind==='crack'&&event.handActive&&event.step>binding.state.step&&repairedIds.includes(event.id)),repairedIds);
    }
    await evaluate('window.__archCollapse.advance(60)');await capture('fall-1s');
    await evaluate('window.__archCollapse.advance(120)');await capture('fall-3s');
    await evaluate('window.__archCollapse.advance(300)');const rest=await capture('rest-8s');
    check('gravity continues breaking connections after release',rest.state.events.some(event=>event.kind==='crack'&&!event.handActive&&event.step>injured.state.step),{held:held.state.broken,released:injured.state.broken,afterGravity:rest.state.broken});
    const crownDrop=Math.max(...rest.state.bodies.filter(body=>body.row>=8).map(body=>body.rest.y-body.position.y));
    check('the crown falls beyond the grabbed patch',crownDrop>1,crownDrop);
    const penetration=rest.state.floorY-minimumY(rest.state);
    check('rubble meets the floor within six percent of a cell',penetration<Math.min(...Object.values(rest.state.dimensions))*.06,penetration);
    report.phase='fallen-material-grab';save();
    const fallen=rest.surfaceTargets.find(item=>item.visible&&rest.state.bodies[item.index].row>=8&&rest.state.bodies[item.index].position.y<rest.state.floorY+rest.state.dimensions.dy*2);
    const lifted=await injury(fallen,{x:.2,y:.4,z:.1},30,false),releasedRubble=await capture('rubble-grab-released');
    const originalPosition=rest.state.bodies[fallen.index].position,liftedPosition=lifted.state.bodies[fallen.index].position;
    const travel=Math.hypot(liftedPosition.x-originalPosition.x,liftedPosition.y-originalPosition.y,liftedPosition.z-originalPosition.z);
    check('fallen material remains pickable and moves from its current pose',travel>.05,{index:fallen.index,originalPosition,liftedPosition,travel});
    check('rubble manipulation leaves the operator camera untouched',JSON.stringify(releasedRubble.camera)===JSON.stringify(rest.camera),releasedRubble.camera);
    await evaluate('(async()=>{document.querySelector("#shear").click();await window.__archCollapse.reset();})()');const reset=await capture('explicit-reset');
    check('explicit Reset clears damage and preserves camera',reset.state.broken===0&&JSON.stringify(reset.camera)===JSON.stringify(binding.camera),reset.state.broken);
    await input({type:'mousePressed',x:40,y:180,button:'left',buttons:1,clickCount:1});check('background press does not grip material',(await witness()).state.hand===null,(await witness()).lastPick);
    await input({type:'mouseMoved',x:100,y:210,button:'left',buttons:1});await input({type:'mouseReleased',x:100,y:210,button:'left',buttons:0,clickCount:1});await sleep(350);const orbit=await capture('operator-orbit');
    check('background drag changes only the operator camera',JSON.stringify(orbit.camera)!==JSON.stringify(reset.camera)&&JSON.stringify(orbit.state.bodies)===JSON.stringify(reset.state.bodies),orbit.camera);
    const rotated=orbit.surfaceTargets.find(item=>item.visible&&item.row===2);
    await input({type:'mousePressed',x:rotated.screen.x,y:rotated.screen.y,button:'left',buttons:1,clickCount:1});check('rotated camera picks current surface',(await witness()).state.hand?.index===rotated.index,(await witness()).lastPick);
    await input({type:'mouseReleased',x:rotated.screen.x,y:rotated.screen.y,button:'left',buttons:0,clickCount:1});
    report.phase='live-clock';await liveClock();
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:report.requestedUrl});
    while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
    await sleep(350);await capture('mobile-standing');check('mobile controls fit without horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'),await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})'));
  }
  if(isArch&&exercise==='controls'){
    report.phase='live-clock-and-recovery';save();await liveClock();const knownFailures=[];
    const lifetimeBaseline=await evaluate('window.__archCollapse.rendererLifetime()');
    report.rendererLifetimes=[{name:'before-reset',...lifetimeBaseline}];save();
    check('active renderer lifetime baseline is observed',!inspectGpuArchRendererLifetime(lifetimeBaseline,lifetimeBaseline).length,lifetimeBaseline);
    async function checkLifetime(name){
      const current=await evaluate('window.__archCollapse.rendererLifetime()');
      report.rendererLifetimes.push({name,...current});save();
      check(`${name}: Reset releases old compute registrations`,!inspectGpuArchRendererLifetime(current,lifetimeBaseline).length,current);
    }
    for(const initiallyPaused of [false,true]){
      if(!initiallyPaused)await evaluate('document.querySelector("#pause").click()');
      const before=await witness();check('recovery starts in the intended clock state',before.paused===initiallyPaused,before.paused);
      await evaluate('(async()=>{const {ArchGpuEngine}=await import("./dist/structural-material-arch-gpu-engine.js");const original=ArchGpuEngine.prototype.step;ArchGpuEngine.prototype.step=function(){ArchGpuEngine.prototype.step=original;throw new Error("injected native recovery fault");};try{await window.__archCollapse.advance(1);}catch(error){return error.message;}finally{ArchGpuEngine.prototype.step=original;}})()');
      const failed=await witness();check('the injected fault is visible and stops the live clock',failed.phase==='failed'&&failed.paused===true&&failed.failure.message==='injected native recovery fault'&&failed.failures.length===knownFailures.length+1,failed.failure);
      knownFailures.push(failed.failure);report.expectedRecoveryFaults=[...knownFailures];save();
      await evaluate('window.__archCollapse.reset()');const recovered=await capture(`recovered-${initiallyPaused?'paused':'live'}`,undefined,knownFailures);
      await checkLifetime(`recovered-${initiallyPaused?'paused':'live'}`);
      check('Reset preserves the pre-failure clock and failure history',recovered.paused===initiallyPaused&&recovered.failures.length===knownFailures.length&&JSON.stringify(recovered.camera)===JSON.stringify(before.camera),{paused:recovered.paused,failures:recovered.failures.length});
      if(!initiallyPaused)await evaluate('(async()=>{document.querySelector("#pause").click();await window.__archCollapse.advance(0);})()');
    }
    for(let reset=1;reset<=3;reset++){
      await evaluate('(async()=>{await window.__archCollapse.reset();await window.__archCollapse.advance(3);})()');
      await checkLifetime(`repeat-reset-${reset}`);
    }
    await capture('repeated-reset-standing',undefined,knownFailures);
  }
  report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};save();process.exitCode=1;
}finally{
  if(socket?.readyState===1)await send('Browser.close').catch(()=>{});
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  socket?.close();if(server)await new Promise(resolve=>server.close(resolve));report.browser.stderr=stderr;report.browser.cleanup={exitCode:child?.exitCode,signal:child?.signalCode};save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,output,failure:report.failure,identity:report.result?.identity}));
