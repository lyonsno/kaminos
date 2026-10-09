import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {materialResponse,validateNativeCohesion} from './ipbf-material-response.mjs';
import {nativeCohesionFixture} from './ipbf-cohesion-native.mjs';
import {fluidBrowserLaunch} from '../finger-fluid-browser-launch.mjs';

const arg=key=>{const i=process.argv.indexOf(key);if(i<0||!process.argv[i+1])throw Error(`Required ${key}`);return process.argv[i+1];};
const sha=data=>createHash('sha256').update(data).digest('hex');
const out=arg('--out-dir');mkdirSync(out,{recursive:true});
const report={schema:'kaminos.ipbf-calibration-station.v1',status:'starting',phase:'arguments',lastTrustworthyEvidence:'none'};
const save=()=>writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');save();
let child,ws;let sequence=0;const pending=new Map();
const disconnect=reason=>{for(const p of pending.values())p.reject(Error(reason));pending.clear();};
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{if(ws?.readyState!==WebSocket.OPEN)return reject(Error('Browser connection unavailable'));const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const evalPage=async(expression,sessionId)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
try{
 const root=arg('--repo-root'),revision=arg('--revision'),configPath=arg('--config');
 const configBytes=readFileSync(configPath),config=JSON.parse(configBytes);
 report.requested={repoRoot:root,revision,configPath,configSha256:sha(configBytes),native:process.argv.includes('--native')};
 report.input=config;writeFileSync(out+'/input.json',configBytes);
 report.phase='source-preflight';save();
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
 assert.equal(git('rev-parse','HEAD'),revision,'Source revision mismatch');
 report.source={repoRoot:root,revision,dirty:git('status','--porcelain'),files:['finger-fluid-webgpu-core.js','finger-fluid-ipbf-wgsl.mjs','finger-fluid-ipbf-reference.mjs','finger-fluid-cohesion.mjs','finger-fluid-browser-launch.mjs','tools/ipbf-material-response.mjs','tools/ipbf-cohesion-native.mjs','tools/ipbf-material-calibration.mjs'].map(name=>({name,sha256:sha(readFileSync(root+'/'+name))}))};
 report.lastTrustworthyEvidence='source-and-full-input-recorded';report.phase='cpu-equation-audit';save();
 report.response=materialResponse(config);
 report.resolution=config.resolutionVolumeScales.map(scale=>materialResponse({...config,particleVolume:config.particleVolume*scale,pressureRadius:config.pressureRadius*Math.cbrt(scale)}));
 report.native=null;report.phase='cpu-equation-audit-complete';save();
 if(report.requested.native){
  const baseUrl=arg('--base-url');report.requested.baseUrl=baseUrl;
  report.phase='served-source-preflight';save();
  for(const f of report.source.files){const res=await fetch(baseUrl+'/'+f.name);assert.ok(res.ok,'Source route missing '+f.name);assert.equal(sha(await res.text()),f.sha256,'Served source mismatch '+f.name);}
  const launch=fluidBrowserLaunch({executable:process.env.KAMINOS_CHROME,debugPort:0,userDataDir:out+'/profile',width:1280,height:900});launch.args.push('--headless=new','--enable-unsafe-webgpu','--use-angle=metal');
  report.browser=launch;report.phase='browser-launch';save();
  child=spawn(launch.executable,launch.args,{stdio:['ignore','pipe','pipe']});report.browser.pid=child.pid;
  child.stderr.on('data',b=>{writeFileSync(out+'/browser-stderr.log',b,{flag:'a'});});
  const endpoint=await new Promise((resolve,reject)=>{let text='';child.on('error',reject);child.once('exit',c=>reject(Error('Browser exited before CDP '+c)));child.stderr.on('data',b=>{text+=b;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});});
  ws=new WebSocket(endpoint);ws.addEventListener('close',()=>disconnect('Browser connection closed'));child.once('exit',()=>disconnect('Owned browser exited'));
  ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id){const p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}}});
  await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  report.browser.version=await call('Browser.getVersion');
  const {targetId}=await call('Target.createTarget',{url:'about:blank'}),{sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Page.enable',{},sessionId);await call('Runtime.enable',{},sessionId);
  report.phase='navigation';save();const navigation=await call('Page.navigate',{url:baseUrl+'/finger-fluid-webgpu-core.js'},sessionId);report.navigation=navigation;
  if(navigation.errorText||navigation.isDownload)throw Error('Native document navigation failed '+JSON.stringify(navigation));
  await evalPage('new Promise(r=>document.readyState==="complete"?r():addEventListener("load",r,{once:true}))',sessionId);
  report.page=await evalPage('({href:location.href,secure:isSecureContext,gpu:!!navigator.gpu})',sessionId);assert.equal(report.page.href,baseUrl+'/finger-fluid-webgpu-core.js');assert.ok(report.page.secure&&report.page.gpu);
  report.phase='native-cohesion-dispatch';save();
  report.native=await evalPage('('+nativeCohesionFixture.toString()+')('+JSON.stringify(config.nativeCases)+')',sessionId);save();
  report.phase='native-response-validation';save();validateNativeCohesion(report.native,config.nativeCases);
  report.lastTrustworthyEvidence='complete-production-cohesion-responses';save();
 }
 report.phase='source-postflight';save();
 for(const f of report.source.files)assert.equal(sha(readFileSync(report.source.repoRoot+'/'+f.name)),f.sha256,'Source changed during calibration');
 assert.equal(git('rev-parse','HEAD'),revision,'Revision changed during calibration');
 report.status='complete';report.phase='complete';
 report.claimLimit='Completed response measurement; mechanical targets may fail. No physical material calibration, motion improvement or speedup is implied by a complete report.';
}catch(e){report.status='failed';report.failurePhase=report.phase;report.error=e.stack;process.exitCode=1;}
finally{
 save();ws?.close();
 if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;}
}
console.log(JSON.stringify({status:report.status,phase:report.phase,report:out+'/report.json',internalMomentumTarget:report.response?.calibration.internalMomentumTarget,error:report.error}));
