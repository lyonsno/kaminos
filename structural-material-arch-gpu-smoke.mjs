import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inspectGpuConformance, inspectGpuArchLoad } from './structural-material-arch-gpu-evidence.mjs';

const [outputInput, executableInput, page = 'structural-material-arch-gpu-conformance.html', exercise = 'load'] = process.argv.slice(2);
if (!outputInput || !executableInput) throw new Error('usage: node structural-material-arch-gpu-smoke.mjs OUTPUT.json INDEPENDENT_CHROME [PAGE]');
const output=path.resolve(outputInput), root=path.dirname(fileURLToPath(import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={status:'running',phase:'preflight',root,argv:process.argv,sourceRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
  browser:{},sources:{},inputs:[],captures:{},checks:[],errors:[],lastTrustworthyEvidence:'invocation'};
report.harnessSha256=hash(fs.readFileSync(fileURLToPath(import.meta.url)));
fs.mkdirSync(path.dirname(output),{recursive:true});
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
let server,child,socket,stderr='',nextId=0;
const pending=new Map(), sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
const evaluate=async expression=>{report.inputs.push({expression,at:new Date().toISOString()});save();const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
function check(name,passed,observed){report.checks.push({name,passed,observed});save();if(!passed)throw new Error(`Predicate failed: ${name}`);}
const input=async params=>{report.inputs.push({method:'Input.dispatchMouseEvent',params,at:new Date().toISOString()});save();return send('Input.dispatchMouseEvent',params);};
const witness=()=>evaluate('window.__archCollapse.witness()');
async function capture(name){
  const state=await witness(),errors=inspectGpuArchLoad(state),pixels=await evaluate('window.__archCollapse.pixels()');
  report.states??={};report.states[name]=state;save();
  check(`${name}: native route, requested configuration, live physical and displayed poses`,!errors.length,errors);
  check(`${name}: canvas contains geometry`,pixels.fraction>.001,pixels);
  const frame=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}),bytes=Buffer.from(frame.data,'base64');
  const target=`${output.slice(0,-path.extname(output).length)}-${name}.png`;fs.writeFileSync(target,bytes);
  report.captures[name]={path:target,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),pixels};
  check(`${name}: PNG dimensions match effective viewport`,report.captures[name].width===state.viewport.width&&report.captures[name].height===state.viewport.height,state.viewport);
  report.lastTrustworthyEvidence=`${name} at physical step ${state.state.step}`;save();return state;
}
async function injury(pick,delta={x:-1.5,y:0,z:.5}){
  check('a visible material contact is available',Boolean(pick?.visible),pick);
  await input({type:'mousePressed',x:pick.screen.x,y:pick.screen.y,button:'left',buttons:1,clickCount:1});
  const selected=await witness();
  check('pointer selects the advertised finite front patch',selected.state.hand?.index===pick.index&&selected.state.hand.indices.length>1&&selected.state.hand.layers.join(',')==='2',selected.state.hand);
  let screen=pick.screen;
  for(let i=0;i<60;i++){
    const target={x:pick.world.x+delta.x*(i+1)/60,y:pick.world.y+delta.y*(i+1)/60,z:pick.world.z+delta.z*(i+1)/60};
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
save();
try {
  const executable=fs.realpathSync(executableInput);
  if(executable.includes('/Google Chrome.app/')||!/chrome-headless-shell$|\/Chromium$|Google Chrome for Testing$/.test(executable))throw new Error('Independent native testing browser required');
  report.browser.executable=executable;report.browser.version=execFileSync(executable,['--version'],{encoding:'utf8'}).trim();
  const isArch=page==='structural-material-arch-gpu.html';
  if(!['load','collapse'].includes(exercise)||exercise==='collapse'&&!isArch)throw new Error('Unsupported exercise');
  if(!isArch&&page!=='structural-material-arch-gpu-conformance.html')throw new Error('Unsupported GPU smoke page');
  for(const source of [page,...(isArch?['structural-material-arch-gpu-view.js','structural-material-arch-gpu.js','structural-material-arch-gpu-kernels.js','structural-material-arch-gpu-fixture.js']:['structural-material-arch-gpu-conformance.js']),'dist/structural-material-arch-gpu-engine.js','vendor/webphysics/provenance.json','package-lock.json','node_modules/three/build/three.module.js','node_modules/three/build/three.webgpu.js','node_modules/three/build/three.tsl.js'])report.sources[source]=hash(fs.readFileSync(path.join(root,source)));
  report.phase='http';save();
  server=createServer((req,res)=>{
    const filename=path.resolve(root,`.${decodeURIComponent(new URL(req.url,'http://localhost').pathname)}`);
    if(!filename.startsWith(`${root}${path.sep}`)){res.writeHead(403).end();return;}
    try{const bytes=fs.readFileSync(filename);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.wgsl':'text/plain'})[path.extname(filename)]??'application/octet-stream');res.setHeader('cache-control','no-store');res.end(bytes);}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  report.requestedUrl=`http://127.0.0.1:${server.address().port}/${page}${isArch?'?smoke=1':''}`;
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
  const capture=`${output.slice(0,-path.extname(output).length)}.png`;fs.writeFileSync(capture,bytes);report.captures.desktop={path:capture,sha256:hash(bytes),width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  report.lastTrustworthyEvidence=`${isArch?'paused arch':'native conformance'} report from ${report.effectiveUrl}`;
  report.evidenceErrors=isArch?inspectGpuArchLoad(report.result):inspectGpuConformance(report.result);
  if(isArch){
    if(report.result.phase!=='interactive'||report.result.state?.backend!=='webgpu-avbd'||report.result.identity?.backend!=='webgpu')report.evidenceErrors.push('GPU arch failed to initialize');
    if(!(report.pixels?.fraction>.001))report.evidenceErrors.push('Arch canvas is blank');
    if(!report.result.state?.bodies?.length)report.evidenceErrors.push('No physical body readback');
  }
  if(report.evidenceErrors.length||report.errors.length)throw new Error(JSON.stringify({evidence:report.evidenceErrors,page:report.errors}));
  if(isArch&&exercise==='collapse'){
    report.phase='standing-under-weight';save();await evaluate('window.__archCollapse.advance(120)');const standing=await capture('standing');
    check('the arch stands intact under its own weight',standing.state.broken===0&&standing.state.bodies.every(body=>Math.abs(body.position.y-body.rest.y)<.05),{broken:standing.state.broken,maximumSag:Math.max(...standing.state.bodies.map(body=>Math.abs(body.position.y-body.rest.y)))});
    report.phase='front-patch-injury';save();const held=await injury(standing.pickTargets.find(item=>item.row===1&&item.visible));const injured=await capture('released-injury');
    check('front patch produces reaction-dependent fractures',injured.state.broken>0&&injured.state.events.some(event=>event.kind==='crack'&&event.handActive&&event.stress>injured.state.config.strength),injured.state.broken);
    check('object pull leaves camera under operator control',JSON.stringify(injured.camera)===JSON.stringify(standing.camera),injured.camera);
    await evaluate('window.__archCollapse.advance(60)');await capture('fall-1s');
    await evaluate('window.__archCollapse.advance(120)');await capture('fall-3s');
    await evaluate('window.__archCollapse.advance(300)');const rest=await capture('rest-8s');
    check('gravity continues breaking connections after release',rest.state.events.some(event=>event.kind==='crack'&&!event.handActive&&event.step>injured.state.step),{held:held.state.broken,released:injured.state.broken,afterGravity:rest.state.broken});
    const crownDrop=Math.max(...rest.state.bodies.filter(body=>body.row>=8).map(body=>body.rest.y-body.position.y));
    check('the crown falls beyond the grabbed patch',crownDrop>1,crownDrop);
    const penetration=rest.state.floorY-minimumY(rest.state);
    check('rubble meets the floor within six percent of a cell',penetration<Math.min(...Object.values(rest.state.dimensions))*.06,penetration);
    report.phase='repeated-injury';save();const oldDead=rest.state.bonds.filter(bond=>!bond.alive).map(bond=>bond.id);
    const second=rest.pickTargets.find(item=>item.visible&&item.row>2&&rest.state.components[rest.state.bodies[item.index].component].count>6);
    await injury(second,{x:1.4,y:.5,z:.6});await evaluate('window.__archCollapse.advance(240)');const repeated=await capture('repeated-injury');
    check('second injury adds damage without healing prior damage',repeated.state.broken>rest.state.broken&&oldDead.every(id=>!repeated.state.bonds.find(bond=>bond.id===id).alive),{before:rest.state.broken,after:repeated.state.broken});
    await evaluate('document.querySelector("#bind").click()');const binding=await capture('bind-selected');
    check('Bind mode selection is not a pose or topology reset',binding.state.broken===repeated.state.broken&&JSON.stringify(binding.state.bodies)===JSON.stringify(repeated.state.bodies)&&JSON.stringify(binding.camera)===JSON.stringify(repeated.camera),binding.state.broken);
    await evaluate('document.querySelector("#shear").click();await window.__archCollapse.reset()');const reset=await capture('explicit-reset');
    check('explicit Reset clears damage and preserves camera',reset.state.broken===0&&JSON.stringify(reset.camera)===JSON.stringify(binding.camera),reset.state.broken);
    await input({type:'mousePressed',x:40,y:180,button:'left',buttons:1,clickCount:1});check('background press does not grip material',(await witness()).state.hand===null,(await witness()).lastPick);
    await input({type:'mouseMoved',x:100,y:210,button:'left',buttons:1});await input({type:'mouseReleased',x:100,y:210,button:'left',buttons:0,clickCount:1});await sleep(350);const orbit=await capture('operator-orbit');
    check('background drag changes only the operator camera',JSON.stringify(orbit.camera)!==JSON.stringify(reset.camera)&&JSON.stringify(orbit.state.bodies)===JSON.stringify(reset.state.bodies),orbit.camera);
    const rotated=orbit.surfaceTargets.find(item=>item.visible&&item.row===2);
    await input({type:'mousePressed',x:rotated.screen.x,y:rotated.screen.y,button:'left',buttons:1,clickCount:1});check('rotated camera picks current surface',(await witness()).state.hand?.index===rotated.index,(await witness()).lastPick);
    await input({type:'mouseReleased',x:rotated.screen.x,y:rotated.screen.y,button:'left',buttons:0,clickCount:1});
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await send('Page.navigate',{url:report.requestedUrl});
    while(!await evaluate('Boolean(window.__archCollapse)')){if(report.errors.length)throw new Error(JSON.stringify(report.errors));await sleep(100);}
    await sleep(350);await capture('mobile-standing');check('mobile controls fit without horizontal overflow',await evaluate('document.documentElement.scrollWidth<=innerWidth'),await evaluate('({width:innerWidth,documentWidth:document.documentElement.scrollWidth})'));
  }
  report.status='passed';report.phase='complete';save();
}catch(error){report.status='failed';report.failure={phase:report.phase,message:error.message,stack:error.stack};save();process.exitCode=1;
}finally{
  if(socket?.readyState===1)await send('Browser.close').catch(()=>{});
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));}
  socket?.close();if(server)await new Promise(resolve=>server.close(resolve));report.browser.stderr=stderr;report.browser.cleanup={exitCode:child?.exitCode,signal:child?.signalCode};save();
}
console.log(JSON.stringify({status:report.status,phase:report.phase,output,failure:report.failure,identity:report.result?.identity}));
