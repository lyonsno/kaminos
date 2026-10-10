import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {discriminatorConfiguration,BASE_VOLUME} from '../fluid-core-discriminator-view.mjs';
import {validateDiscriminatorState,summarizeParticleState} from './fluid-discriminator-evidence.mjs';

const arg=k=>{const i=process.argv.indexOf(k);if(i<0||!process.argv[i+1])throw Error('Required '+k);return process.argv[i+1];};
const out=arg('--out-dir');mkdirSync(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const report={schema:'kaminos.fluid-assembly-discriminator.v1',status:'starting',phase:'arguments',lastTrustworthyEvidence:'none',arms:[],dropResponses:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');save();
let browser,ws,sequence=0;const pending=new Map();
const disconnect=reason=>{for(const p of pending.values())p.reject(Error(reason));pending.clear();};
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;if(ws?.readyState!==WebSocket.OPEN)return reject(Error('Browser connection unavailable'));pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const evaluate=async(expression,sessionId)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
try {
  const root=arg('--repo-root'),revision=arg('--revision'),base=arg('--base-url');
  const git=(...a)=>{const r=spawnSync('git',a,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
  report.requested={root,revision,base,basinSteps:[1,30,90,180],dropSteps:[1,6,12],dt:1/60};
  report.phase='source-preflight';save();assert.equal(git('rev-parse','HEAD'),revision,'Wrong source revision');
  assert.equal(git('status','--porcelain'),'','Dirty source cannot identify this experiment');
  const names=['finger-fluid-webgpu-core.js','finger-fluid-ipbf-wgsl.mjs','finger-fluid-akinci.mjs','finger-fluid-discriminator.mjs','fluid-core-discriminator.html','fluid-core-discriminator-view.mjs','tools/fluid-discriminator-evidence.mjs','tools/fluid-core-discriminator.mjs'];
  report.source={root,revision,files:names.map(name=>({name,sha256:sha(readFileSync(root+'/'+name))}))};
  for(const f of report.source.files){const r=await fetch(new URL(f.name,base+'/'));assert.ok(r.ok,'Served source missing');assert.equal(sha(await r.text()),f.sha256,'Served source differs: '+f.name);}
  report.lastTrustworthyEvidence='frozen-source-and-served-source-match';report.phase='browser-launch';save();
  const launch=fluidBrowserLaunch({executable:process.env.KAMINOS_CHROME,debugPort:0,userDataDir:out+'/browser-profile',width:1280,height:900});launch.args.push('--headless=new','--enable-unsafe-webgpu','--use-angle=metal');report.browser=launch;
  browser=spawn(launch.executable,launch.args,{stdio:['ignore','pipe','pipe']});report.browser.pid=browser.pid;
  browser.stderr.on('data',b=>writeFileSync(out+'/browser-stderr.log',b,{flag:'a'}));
  const endpoint=await new Promise((resolve,reject)=>{let text='';browser.once('error',reject);browser.once('exit',c=>reject(Error('Browser exited before CDP '+c)));browser.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});});
  ws=new WebSocket(endpoint);ws.addEventListener('close',()=>disconnect('Browser connection closed'));browser.once('exit',()=>disconnect('Owned browser exited'));
  ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}}});
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  report.browser.version=await call('Browser.getVersion');
  async function run(arm,fixture,gamma,steps) {
    const directory=out+'/'+fixture+'-'+arm+'-'+gamma;mkdirSync(directory,{recursive:true});
    const url=new URL('fluid-core-discriminator.html',base+'/');url.search=new URLSearchParams({arm,fixture,gamma:String(gamma),harness:'1'});
    const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    try {
      await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
      const loaded=new Promise(resolve=>{const handler=e=>{const r=JSON.parse(e.data);if(r.sessionId===sessionId&&r.method==='Page.loadEventFired'){ws.removeEventListener('message',handler);resolve();}};ws.addEventListener('message',handler);});
      const nav=await call('Page.navigate',{url:url.href},sessionId);if(nav.errorText||nav.isDownload)throw Error('Navigation failed');await loaded;
      const boot=await evaluate('window.discriminatorBoot',sessionId);assert.ok(boot,'Missing boot result');
      const config=discriminatorConfiguration({arm,fixture,coefficient:gamma});
      writeFileSync(directory+'/initial-input.f32',Buffer.from(config.diagnosticPopulation.particleData.buffer));
      const row={arm,fixture,gamma,initialInputPath:directory+'/initial-input.f32',initialInputAuthority:'exact_factory_invocation_not_GPU_readback',url:url.href,adapter:boot.adapter,initialInputSha256:sha(Buffer.from(config.diagnosticPopulation.particleData.buffer)),captures:[]};
      (fixture==='basin'?report.arms:report.dropResponses).push(row);save();
      let previous=0;
      for(const step of steps) {
        report.phase=fixture+'-'+arm+'-step-'+step;save();
        await evaluate('window.discriminator.advance('+String(step-previous)+')',sessionId);previous=step;
        const snapshot=await evaluate('(async()=>{const diagnostics=await discriminator.snapshot(),d=discriminator.debug();return {adapter:d.adapterInfo,dynamics:d.diagnosticDynamics,pressure:d.ipbfSettings,surface:d.cohesionSettings,step:d.stepCount,words:diagnostics.particleSnapshot.words,diagnostics:{...diagnostics,particleSnapshot:undefined},stages:{density:d.densityIterationCount,surface:d.surfaceForcePassCount,vorticity:d.vorticityPassCount},errors:discriminator.errors};})()',sessionId);
        const values=validateDiscriminatorState(snapshot,{arm,particleCount:config.particleCount,volume:BASE_VOLUME*config.diagnosticPopulation.particleVolumeScale,radius:.125,surfaceRadius:config.akinciSupportRadius,gamma,step});
        assert.equal(snapshot.errors.length,0,'GPU errors');assert.equal(snapshot.stages.density,4*step);assert.equal(snapshot.stages.surface,3*step);assert.equal(snapshot.stages.vorticity,arm==='assembled'?2*Math.ceil(step/3):0);
        if(step>0){const w=snapshot.diagnostics.pressureControlInputs;assert.ok(w?.pressureWords?.length===4&&w.simulationWords?.length===56,'Missing effective GPU input bytes');const pressure=new Float32Array(new Uint32Array(w.pressureWords).buffer),uniform=new Float32Array(new Uint32Array(w.simulationWords).buffer);assert.equal(pressure[0],Math.fround(.125));assert.equal(pressure[1],Math.fround(.0113));assert.equal(uniform[29],Math.fround(gamma));assert.equal(new Uint32Array(w.simulationWords)[1],config.particleCount);}
        const raw=Buffer.from(new Uint32Array(snapshot.words).buffer),stem=directory+'/step-'+step;writeFileSync(stem+'.u32',raw);
        const capture={step,simulationSeconds:step/60,sha256:sha(raw),rawPath:stem+'.u32',state:summarizeParticleState(values),effective:{...snapshot,words:undefined},views:[]};
        row.captures.push(capture);save();
        for(const mode of ['sphere_debug','screen_space_refraction']) {
          await evaluate('discriminator.render('+JSON.stringify(mode)+')',sessionId);
          const image=await call('Page.captureScreenshot',{format:'png',fromSurface:true},sessionId),file=stem+'-'+mode+'.png';writeFileSync(file,Buffer.from(image.data,'base64'));capture.views.push({mode,path:file});
        }
        const after=await evaluate('(async()=>{const d=await discriminator.snapshot();return d.particleSnapshot.words;})()',sessionId);
        assert.equal(sha(Buffer.from(new Uint32Array(after).buffer)),capture.sha256,'Rendering changed the captured particle state');save();
      }
      await evaluate('discriminator.destroy()',sessionId);return row;
    } finally {await call('Target.closeTarget',{targetId});}
  }
  // Test the finer arm early; a shader or admission defect cannot waste the whole run.
  for(const arm of ['fine','assembled','reduced'])await run(arm,'basin',.19,report.requested.basinSteps);
  for(const arm of ['reduced','fine'])for(const gamma of [0,.19])await run(arm,'drop',gamma,report.requested.dropSteps);
  report.phase='source-postflight';save();assert.equal(git('rev-parse','HEAD'),revision);for(const f of report.source.files)assert.equal(sha(readFileSync(root+'/'+f.name)),f.sha256,'Source changed during diagnosis');
  report.status='complete';report.phase='complete';report.lastTrustworthyEvidence='all-three-full-state-trajectories-and-four-drop-responses';
  report.claimLimit='Controlled finite pour; direct analytic renderer; collision-only pressure walls. Not a replay of the operator steady emitter, physical SI calibration, integrated authoring admission, or performance benchmark.';
} catch(e) {report.status='failed';report.failurePhase=report.phase;report.error=e.stack;process.exitCode=1;}
finally {save();ws?.close();if(browser&&browser.exitCode===null){const done=new Promise(r=>browser.once('exit',r));browser.kill('SIGTERM');await done;}}
console.log(JSON.stringify({status:report.status,phase:report.phase,path:out+'/report.json',error:report.error}));
