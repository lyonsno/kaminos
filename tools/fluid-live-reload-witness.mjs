import {validateOwnedCdpEndpoint} from './thin-stream-stage-tap.mjs';
import {evaluateJsonTransfer} from './cdp-json-transfer.mjs';
import {checkLiveFluidState,checkLiveFluidProgress} from './fluid-live-reload-check.mjs';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
const out=resolve(arg('--out-dir'));mkdirSync(out,{recursive:true});
const report={schema:'soggy.fluid-live-reload-witness.v1',status:'starting',phase:'input',events:[],observations:[],primaryOutputWritten:false};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));save();
const sha=b=>createHash('sha256').update(b).digest('hex');const delay=ms=>new Promise(r=>setTimeout(r,ms));
let child=null,client=null;
const git=(root,...args)=>{const p=spawnSync('/usr/bin/git',args,{cwd:root,encoding:'utf8'});if(p.status)throw Error(p.stderr);return p.stdout.trim()};
async function connect(url){const ws=new WebSocket(url);await new Promise((yes,no)=>{ws.addEventListener('open',yes,{once:true});ws.addEventListener('error',no,{once:true})});let id=0,closed=false;const pending=new Map();
 const fail=()=>{closed=true;for(const p of pending.values())p.no(Error('CDP transport closed'));pending.clear()};ws.addEventListener('close',fail);ws.addEventListener('error',fail);
 ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.id){const p=pending.get(m.id);if(!p)return;pending.delete(m.id);m.error?p.no(Error(JSON.stringify(m.error))):p.yes(m.result)}else if(['Runtime.exceptionThrown','Runtime.consoleAPICalled'].includes(m.method))report.events.push(m)});
 return {ws,call(method,params={}){return new Promise((yes,no)=>{if(closed)return no(Error('CDP closed'));const i=++id;pending.set(i,{yes,no});ws.send(JSON.stringify({id:i,method,params}))})}};
}
async function evaluate(expression){const r=await client.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
async function cdp(port,path){const r=await fetch(`http://127.0.0.1:${port}${path}`);if(!r.ok)throw Error('CDP HTTP '+r.status);return r.json()}

async function state(){return evaluate('window.kaminosFingerFluidBenchDebugState?.()||null')}
function failOnBrowserError(){const errors=report.events.filter(e=>e.method==='Runtime.exceptionThrown'||e.params?.type==='error');if(errors.length)throw Error('Browser errors: '+JSON.stringify(errors))}
try {
 const input=JSON.parse(readFileSync(resolve(arg('--manifest'))));report.input=input;
 const root=resolve(input.repoRoot),revision=git(root,'rev-parse','HEAD');assert.equal(revision,input.revision);assert.equal(git(root,'status','--porcelain'),'');report.source={root,revision,files:[]};save();
 report.phase='source-server';save();const runtime=await(await fetch(new URL('/api/runtime-config',input.url))).json(),identity=runtime.sourceIdentity||runtime.source;assert.equal(resolve(identity.repoRoot),root);assert.equal(identity.commit||identity.revision,revision);report.source.runtimeConfig=runtime;
 for(const name of ['index.html','finger-fluid-webgpu-core.js','finger-fluid-river-playground.mjs','tools/fluid-live-reload-witness.mjs','tools/fluid-live-reload-check.mjs']){const local=readFileSync(join(root,name));const r=await fetch(new URL(name,input.url));assert.equal(r.status,200);assert.equal(sha(Buffer.from(await r.arrayBuffer())),sha(local));report.source.files.push({name,sha256:sha(local)})}
 const profile=mkdtempSync(join(out,'browser-profile-'));const activePortPath=join(profile,'DevToolsActivePort');const helper=await import(input.browserHelper);const launch=helper.fluidBrowserLaunch({executable:input.browserExecutable,debugPort:0,userDataDir:profile,width:1440,height:900});report.browser={profile,activePortPath,executable:launch.executable,args:launch.args,helper:input.browserHelper,helperSha256:sha(readFileSync(input.browserHelper))};save();
 if(args.includes('--preflight-only')){report.status='preflight_passed';report.phase=null;save();process.exit(0)}
 assert.ok(process.env.SOGGY_EXECUTION_SOURCE);report.executionSource=process.env.SOGGY_EXECUTION_SOURCE;report.phase='browser-start';save();child=spawn(launch.executable,launch.args,{stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>{report.browser.stderr=(report.browser.stderr||'')+b});await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no)});
 let portText;while(!portText){if(child.exitCode!==null)throw Error('owned Chrome exited');try{const t=readFileSync(activePortPath,'utf8');if(t.trim().split('\n').length===2)portText=t}catch{}if(!portText)await delay(100)}const port=Number(portText.split('\n')[0]);report.browser.endpoint=validateOwnedCdpEndpoint(portText,await cdp(port,'/json/version'));report.browser.pid=child.pid;save();
 async function attach(page){client=await connect(page.webSocketDebuggerUrl);await client.call('Runtime.enable');await client.call('Page.enable');await client.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})}
 await attach((await cdp(port,'/json/list')).find(p=>p.type==='page'&&p.url==='about:blank'));
 for(const mode of ['standard','off']) {
  const url=new URL(input.url);for(const [k,v] of Object.entries({kaminos_finger_fluid_bench:1,finger_fluid_truth_scene:'river_playground',finger_fluid_artificial_pressure:mode,finger_fluid_renderer:'screen_space_refraction',finger_fluid_color_mode:'phase',finger_fluid_particle_count:36864,finger_fluid_fixed_volume_reference_count:36864,finger_fluid_density_iterations:3,finger_fluid_density_cell_rejection:1,finger_fluid_uniform_volume_density_kernel:1,finger_fluid_packed_density:1,finger_fluid_adaptive_density:0,finger_fluid_energy_diagnostics:'disabled'}))url.searchParams.set(k,String(v));
  const requested={particleCount:36864,truthScene:'river_playground',artificialPressureMode:mode};
  for(const visit of ['load','refresh','reopen']) {
   report.phase=mode+'-'+visit;const row={mode,visit,requestedUrl:url.href,states:[]};report.observations.push(row);save();
   if(visit==='refresh')await client.call('Page.reload',{ignoreCache:false});
   else {if(visit==='reopen'){const old=await evaluate('location.href');row.closedUrl=old;const oldId=(await cdp(port,'/json/list')).find(p=>p.webSocketDebuggerUrl===client.ws.url)?.id;client.ws.close();if(oldId)await fetch(`http://127.0.0.1:${port}/json/close/${oldId}`);const page=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();await attach(page)}await client.call('Page.navigate',{url:url.href})}
   let before;while(true){failOnBrowserError();before=await state();if(before?.status==='error')throw Error(JSON.stringify(before));if(before?.status==='running')break;await delay(100)}
   row.effectiveUrl=await evaluate('location.href');assert.equal(row.effectiveUrl,url.href);checkLiveFluidState(before,requested);row.states.push(before);save();
   // Measured observation window: enough to expose a stopped RAF even at the
   // existing low scene cadence. This is a liveness check, not a speed assay.
   await delay(3000);failOnBrowserError();let after=await state();row.states.push(after);save();checkLiveFluidProgress(before,after,requested);
   let lastChange=Date.now(),lastStep=after.runtime.stepCount;
   const targets=visit==='load'?[180,360]:[120];
   for(const target of targets){while(after.runtime.stepCount<target){await delay(100);failOnBrowserError();after=await state();checkLiveFluidState(after,requested);if(after.runtime.stepCount!==lastStep){lastChange=Date.now();lastStep=after.runtime.stepCount}assert.ok(Date.now()-lastChange<10000,'RAF stopped for ten seconds before selected visual step')}
    const image=await client.call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const file=join(out,mode+'-'+visit+'-'+target+'.png');writeFileSync(file,Buffer.from(image.data,'base64'));row.visuals??=[];row.visuals.push({path:file,effectiveStep:after.runtime.stepCount,effectiveState:after});save();
   }
   row.localStorage=await evaluate('Object.fromEntries(Object.entries(localStorage))');row.complete=true;report.primaryOutputWritten=true;save();
   if(visit==='reopen') {
    report.phase=mode+'-native-particle-state';save();
    await evaluate('window.kaminosFingerFluidBenchSetSimulationPausedForWitness(true);window.kaminosFingerFluidBenchAdvanceToStepForWitness(720);true');
    const raw=await evaluateJsonTransfer(client,'window.kaminosFingerFluidBenchCapturePackedDensityForWitness()');
    assert.equal(raw.count,36864);assert.equal(raw.stepCount,720);assert.equal(Buffer.from(raw.buffers.source,'base64').length,36864*64);
    const file=join(out,mode+'-native-particles-720.json');writeFileSync(file,JSON.stringify(raw));row.nativeParticleSnapshot={path:file,sha256:sha(readFileSync(file)),count:raw.count,step:raw.stepCount,meaning:'Native source particle buffer after paused exact advance; scratch density results also preserved, no live cadence claim.'};save();
    await evaluate('window.kaminosFingerFluidBenchSetCameraForWitness({yaw:0.6,pitch:1.05,distance:5.5,target:[-1.2,-0.55,0]});window.kaminosFingerFluidBenchRenderCurrentStateForWitness();true');
    const image=await client.call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const imagePath=join(out,mode+'-river-focus-720.png');writeFileSync(imagePath,Buffer.from(image.data,'base64'));row.nativeParticleSnapshot.visual=imagePath;save();
   }

  }
 }
 assert.equal(git(root,'rev-parse','HEAD'),revision);assert.equal(git(root,'status','--porcelain'),'');report.status='done';report.phase=null;
}catch(e){report.status='failed';report.error=e.stack||String(e);report.lastTrustworthyEvidence={source:report.source?.revision,completed:report.observations.filter(r=>r.complete).map(r=>[r.mode,r.visit])};process.exitCode=1}
finally{client?.ws.close();if(child){report.browser.cleanup={pid:child.pid,signal:'SIGTERM'};if(child.exitCode===null&&!child.signalCode)await new Promise(yes=>{child.once('close',yes);child.kill('SIGTERM')});report.browser.cleanup.exitCode=child.exitCode;report.browser.cleanup.signalCode=child.signalCode}report.completedAt=new Date().toISOString();save()}
