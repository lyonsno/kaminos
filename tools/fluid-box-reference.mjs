import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';
import {boxReferenceConfiguration} from '../fluid-box-reference-view.mjs';
import {validateBoxReferenceState,summarizeParticleState,collectDiscriminatorSources,verifyDiscriminatorServedSources,withDiscriminatorCleanup,captureDiscriminatorState} from './fluid-discriminator-evidence.mjs';

const arg=k=>{const i=process.argv.indexOf(k);if(i<0||!process.argv[i+1])throw Error('Required '+k);return process.argv[i+1];};
const out=arg('--out-dir');mkdirSync(out,{recursive:true});
const sha=x=>createHash('sha256').update(x).digest('hex');
const report={schema:'kaminos.fluid-box-reference.v1',status:'starting',phase:'arguments',lastTrustworthyEvidence:'none',cases:[]};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');save();
let browser,ws,sequence=0;const pending=new Map();
const disconnect=reason=>{for(const p of pending.values())p.reject(Error(reason));pending.clear();};
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++sequence;if(ws?.readyState!==WebSocket.OPEN)return reject(Error('Browser connection unavailable'));pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const evaluate=async(expression,sessionId)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
try {
  const root=arg('--repo-root'),revision=arg('--revision'),base=arg('--base-url');
  const git=(...a)=>{const r=spawnSync('git',a,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
  report.requested={root,revision,base,scenes:process.argv.includes('--smoke')?['block_drop']:['block_drop','block_flop','dam_break'],steps:process.argv.includes('--smoke')?[1]:[1,120,240,480],resolution:24,dt:1/240};
  report.phase='source-preflight';save();assert.equal(git('rev-parse','HEAD'),revision,'Wrong source revision');
  assert.equal(git('status','--porcelain'),'','Dirty source cannot identify this experiment');
  report.source={root,revision,dependencyContract:'local-static-ESM-and-external-module-script-closure',files:collectDiscriminatorSources(root,['fluid-box-reference.html','tools/fluid-box-reference.mjs'])};
  await verifyDiscriminatorServedSources(report.source.files,base);
  report.lastTrustworthyEvidence='frozen-source-and-served-source-match';report.phase='browser-launch';save();
  const launch=fluidBrowserLaunch({executable:process.env.KAMINOS_CHROME,debugPort:0,userDataDir:out+'/browser-profile',width:1280,height:900});launch.args.push('--headless=new','--enable-unsafe-webgpu','--use-angle=metal','--disable-features=AperitifHelpers');report.browser={...launch,events:[]};
  browser=spawn(launch.executable,launch.args,{stdio:['ignore','pipe','pipe']});report.browser.pid=browser.pid;
  browser.stderr.on('data',b=>writeFileSync(out+'/browser-stderr.log',b,{flag:'a'}));
  browser.stdout.on('data',b=>writeFileSync(out+'/browser-stdout.log',b,{flag:'a'}));
  browser.on('exit',(code,signal)=>{report.browser.events.push({type:'exit',code,signal});save();});
  const endpoint=await new Promise((resolve,reject)=>{let text='';browser.once('error',reject);browser.once('exit',c=>reject(Error('Browser exited before CDP '+c)));browser.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});});
  ws=new WebSocket(endpoint);ws.addEventListener('close',e=>{report.browser.events.push({type:'cdp-close',code:e.code,reason:e.reason});save();disconnect('Browser connection closed: '+e.code+' '+e.reason);});
  ws.addEventListener('error',e=>{report.browser.events.push({type:'cdp-error',error:e.error?.stack??e.message??String(e)});save();disconnect('Browser WebSocket error: '+(e.error?.message??e.message??String(e)));});browser.once('exit',()=>disconnect('Owned browser exited'));
  ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}}});
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  report.browser.version=await call('Browser.getVersion');
  async function run(fixture,steps) {
    const directory=out+'/'+fixture;mkdirSync(directory,{recursive:true});
    const url=new URL('fluid-box-reference.html',base+'/');url.search=new URLSearchParams({scene:fixture,resolution:String(report.requested.resolution),harness:'1'});
    const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    return withDiscriminatorCleanup(async()=>{
      await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
      const loaded=new Promise(resolve=>{const handler=e=>{const r=JSON.parse(e.data);if(r.sessionId===sessionId&&r.method==='Page.loadEventFired'){ws.removeEventListener('message',handler);resolve();}};ws.addEventListener('message',handler);});
      const nav=await call('Page.navigate',{url:url.href},sessionId);if(nav.errorText||nav.isDownload)throw Error('Navigation failed');await loaded;
      const boot=await evaluate('window.discriminatorBoot',sessionId);assert.ok(boot,'Missing boot result');
      const config=boxReferenceConfiguration({scene:fixture,resolution:report.requested.resolution});
      writeFileSync(directory+'/initial-input.f32',Buffer.from(config.fixture.population.particleData.buffer));
      const row={fixture,requested:boot.fixture,initialInputPath:directory+'/initial-input.f32',initialInputAuthority:'exact_factory_invocation_not_GPU_readback',url:url.href,adapter:boot.adapter,initialInputSha256:sha(Buffer.from(config.fixture.population.particleData.buffer)),captures:[]};
      report.cases.push(row);save();
      let previous=0;
      for(const step of steps) {
        const checkpoint=fixture+'-step-'+step;
        report.phase=checkpoint+'-advance';save();
        await evaluate('window.discriminator.advance('+String(step-previous)+')',sessionId);previous=step;
        const snapshot=await captureDiscriminatorState(expression=>evaluate(expression,sessionId),phase=>{report.phase=checkpoint+'-'+phase;save();});
        const values=validateBoxReferenceState(snapshot,config.fixture,step);
        const raw=Buffer.from(new Uint32Array(snapshot.words).buffer),stem=directory+'/step-'+step;writeFileSync(stem+'.u32',raw);
        const effectiveTimestep=new Float32Array(new Uint32Array(snapshot.diagnostics.pressureControlInputs.simulationWords).buffer)[0];
        const capture={step,simulationSeconds:step*effectiveTimestep,effectiveTimestep,requestedTimestep:report.requested.dt,sha256:sha(raw),rawPath:stem+'.u32',state:summarizeParticleState(values),effective:{...snapshot,words:undefined},views:[]};
        row.captures.push(capture);report.lastTrustworthyEvidence='validated-native-full-state-checkpoint';save();
        for(const mode of ['sphere_debug','screen_space_surface']) {
          report.phase=checkpoint+'-render-'+mode;save();
          await evaluate('discriminator.render('+JSON.stringify(mode)+')',sessionId);
          const image=await call('Page.captureScreenshot',{format:'png',fromSurface:true},sessionId),file=stem+'-'+mode+'.png';writeFileSync(file,Buffer.from(image.data,'base64'));capture.views.push({mode,path:file});
        }
        const after=await captureDiscriminatorState(expression=>evaluate(expression,sessionId),phase=>{report.phase=checkpoint+'-after-render-'+phase;save();});
        assert.equal(sha(Buffer.from(new Uint32Array(after.words).buffer)),capture.sha256,'Rendering changed the captured particle state');save();
      }
      await evaluate('discriminator.destroy()',sessionId);return row;
    },()=>call('Target.closeTarget',{targetId}),report);
  }
  for(const scene of report.requested.scenes)await run(scene,report.requested.steps);
  report.phase='source-postflight';save();assert.equal(git('rev-parse','HEAD'),revision);for(const f of report.source.files)assert.equal(sha(readFileSync(root+'/'+f.name)),f.sha256,'Source changed during diagnosis');
  report.status='complete';report.phase='complete';report.lastTrustworthyEvidence='all-requested-box-scenes-native-full-states-and-held-views';
  report.claimLimit='Finite paper-inspired box controls; exact grid spacing, volume and six pressure/collision planes. Product-union wall overlap is approximate. Not exact paper reproduction, physical SI calibration, integrated authoring admission, or performance benchmark.';
} catch(e) {report.status='failed';report.failurePhase=report.phase;report.error=e.stack;process.exitCode=1;}
finally {save();ws?.close();if(browser&&browser.exitCode===null&&browser.signalCode===null){const done=new Promise(r=>browser.once('exit',r));browser.kill('SIGTERM');await done;}save();}
console.log(JSON.stringify({status:report.status,phase:report.phase,path:out+'/report.json',error:report.error}));
