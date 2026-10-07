import {validateOwnedCdpEndpoint} from './thin-stream-stage-tap.mjs';
import {evaluateJsonTransfer} from './cdp-json-transfer.mjs';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const args=process.argv.slice(2),arg=k=>args[args.indexOf(k)+1];
const out=resolve(arg('--out-dir'));mkdirSync(out,{recursive:true});
const report={schema:'soggy.pressure-vessels-witness.v1',status:'starting',phase:'input',events:[],observations:[],primaryOutputWritten:false};
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
function errors(){if(report.events.some(e=>e.method==='Runtime.exceptionThrown'||e.params?.type==='error'))throw Error('Browser error captured')}
function check(s,mode){assert.equal(s?.status,'running');const r=s.runtime;
 for(const [k,v] of Object.entries({truthScene:'pressure_playground',solver_backend:'webgpu_compute',particleCount:36864,fixedVolumeReferenceParticleCount:36864,densityIterationsPerStep:3,particleVolumeScale:1,adaptiveDensity:false,packedDensity:true,uniformVolumeDensityKernel:true,densityCellRejection:true,artificialPressureMode:mode,effectiveRendererMode:'screen_space_surface'}))assert.equal(r[k],v,'effective '+k);
 assert.equal(r.energyDiagnostics.effectiveMode,'disabled');assert.equal(r.pressurePlayground.forcing,'resting-inventory-gravity-only');assert.equal(r.pressurePlayground.sourceRecirculation,false);assert.equal(r.pressurePlayground.gateOpen,r.stepCount>90);
}
try{
 const input=JSON.parse(readFileSync(resolve(arg('--manifest'))));report.input=input;const root=resolve(input.repoRoot),revision=git(root,'rev-parse','HEAD');assert.equal(revision,input.revision);assert.equal(git(root,'status','--porcelain'),'');report.source={root,revision,files:[]};save();
 report.phase='source-server';save();const runtime=await(await fetch(new URL('/api/runtime-config',input.url))).json(),identity=runtime.sourceIdentity||runtime.source;assert.equal(resolve(identity.repoRoot),root);assert.equal(identity.commit||identity.revision,revision);report.source.runtimeConfig=runtime;
 for(const name of ['index.html','finger-fluid-webgpu-core.js','finger-fluid-pressure-vessels.mjs','tools/pressure-vessels-witness.mjs']){const bytes=readFileSync(join(root,name)),r=await fetch(new URL(name,input.url));assert.equal(r.status,200);assert.equal(sha(Buffer.from(await r.arrayBuffer())),sha(bytes));report.source.files.push({name,sha256:sha(bytes)})}
 const profile=mkdtempSync(join(out,'browser-profile-')),activePortPath=join(profile,'DevToolsActivePort');const helper=await import(input.browserHelper),launch=helper.fluidBrowserLaunch({executable:input.browserExecutable,debugPort:0,userDataDir:profile,width:1440,height:900});report.browser={profile,activePortPath,executable:launch.executable,args:launch.args,helper:input.browserHelper,helperSha256:sha(readFileSync(input.browserHelper))};save();
 if(args.includes('--preflight-only')){report.status='preflight_passed';report.phase=null;save();process.exit(0)}
 assert.ok(process.env.SOGGY_EXECUTION_SOURCE);report.executionSource=process.env.SOGGY_EXECUTION_SOURCE;report.phase='browser-start';save();child=spawn(launch.executable,launch.args,{stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>{report.browser.stderr=(report.browser.stderr||'')+b});await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no)});
 let portText;while(!portText){if(child.exitCode!==null)throw Error('owned browser exited');try{const t=readFileSync(activePortPath,'utf8');if(t.trim().split('\n').length===2)portText=t}catch{}if(!portText)await delay(100)}const port=Number(portText.split('\n')[0]);report.browser.endpoint=validateOwnedCdpEndpoint(portText,await cdp(port,'/json/version'));report.browser.pid=child.pid;save();
 const page=(await cdp(port,'/json/list')).find(p=>p.type==='page'&&p.url==='about:blank');assert.ok(page);client=await connect(page.webSocketDebuggerUrl);await client.call('Runtime.enable');await client.call('Page.enable');await client.call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 for(const mode of ['standard','off']){
  const url=new URL(input.url);for(const [k,v] of Object.entries({kaminos_finger_fluid_bench:1,finger_fluid_truth_scene:'pressure_playground',finger_fluid_artificial_pressure:mode,finger_fluid_renderer:'screen_space_surface',finger_fluid_color_mode:'phase',finger_fluid_particle_count:36864,finger_fluid_fixed_volume_reference_count:36864,finger_fluid_density_iterations:3,finger_fluid_density_cell_rejection:1,finger_fluid_uniform_volume_density_kernel:1,finger_fluid_packed_density:1,finger_fluid_adaptive_density:0,finger_fluid_energy_diagnostics:'disabled',finger_fluid_witness_start_step:30}))url.searchParams.set(k,String(v));
  report.phase=mode+'-load';const row={mode,requestedUrl:url.href,frames:[]};report.observations.push(row);save();await client.call('Page.navigate',{url:url.href});
  let s;while(true){errors();s=await state();if(s?.status==='error')throw Error(JSON.stringify(s));if(s?.status==='running'&&s.runtime.stepCount>=30)break;await delay(100)}check(s,mode);assert.equal(s.runtime.stepCount,30);assert.equal(s.runtime.witnessStartAutoPaused,true);
  await evaluate('window.kaminosFingerFluidBenchRenderCurrentStateForWitness("screen_space_surface");true');
  for(const target of [30,90,150,240,480]){
   report.phase=mode+'-step-'+target;save();if(target>30)await evaluate('window.kaminosFingerFluidBenchAdvanceToStepForWitness('+target+');true');
   const raw=await evaluateJsonTransfer(client,'window.kaminosFingerFluidBenchCapturePackedDensityForWitness()');assert.equal(raw.count,36864);assert.equal(raw.stepCount,target);assert.equal(Buffer.from(raw.buffers.source,'base64').length,36864*64);
   const file=join(out,mode+'-step-'+target+'.json');writeFileSync(file,JSON.stringify(raw));s=await state();check(s,mode);assert.equal(s.runtime.stepCount,target);
   await evaluate('window.kaminosFingerFluidBenchRenderCurrentStateForWitness("screen_space_surface");true');const image=await client.call('Page.captureScreenshot',{format:'png',fromSurface:true,captureBeyondViewport:false});const imagePath=join(out,mode+'-step-'+target+'.png');writeFileSync(imagePath,Buffer.from(image.data,'base64'));errors();row.frames.push({step:target,effectiveState:s,rawPath:file,sha256:sha(readFileSync(file)),imagePath});report.primaryOutputWritten=true;save();
  }
  row.complete=true;save();
 }
 errors();assert.equal(git(root,'rev-parse','HEAD'),revision);assert.equal(git(root,'status','--porcelain'),'');report.status='done';report.phase=null;
}catch(e){report.status='failed';report.error=e.stack||String(e);report.lastTrustworthyEvidence={source:report.source?.revision,frames:report.observations.map(r=>({mode:r.mode,steps:r.frames.map(f=>f.step)}))};process.exitCode=1}
finally{client?.ws.close();if(child){report.browser.cleanup={pid:child.pid,signal:'SIGTERM'};if(child.exitCode===null&&!child.signalCode)await new Promise(yes=>{child.once('close',yes);child.kill('SIGTERM')});report.browser.cleanup.exitCode=child.exitCode;report.browser.cleanup.signalCode=child.signalCode}report.completedAt=new Date().toISOString();save()}
