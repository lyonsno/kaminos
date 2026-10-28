// Run through Greenroom. Uses an isolated Chrome for Testing and owns its server.
import {mkdirSync,writeFileSync,readFileSync,existsSync,createWriteStream,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const args=process.argv.slice(2),arg=(k,f)=>{const i=args.indexOf(k);return i<0?f:args[i+1];};
const output=resolve(arg('--out','artifacts/mineral-crust-benchmark'));mkdirSync(output,{recursive:true});
const report={schema:'kaminos.capillary-crust-cost.v1',status:'running',phase:'configuration',started:new Date().toISOString(),output,model:[],scene:[]};
const persist=()=>writeFileSync(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');persist();
let server,chrome,cdp,logs=[];
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))];
const summary=values=>({samples:values.length,mean:values.reduce((a,b)=>a+b,0)/values.length,p50:percentile(values,.5),p95:percentile(values,.95),max:Math.max(...values)});
const digest=files=>Object.fromEntries(files.map(file=>[file,createHash('sha256').update(readFileSync(file)).digest('hex')]));
function connect(url){return new Promise((resolve,reject)=>{const ws=new WebSocket(url),pending=new Map();let id=0;ws.onerror=reject;ws.onopen=()=>resolve({ws,call:(method,params={})=>new Promise((ok,no)=>{const key=++id;pending.set(key,{ok,no});ws.send(JSON.stringify({id:key,method,params}));})});ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id){const p=pending.get(message.id);pending.delete(message.id);if(message.error)p.no(Error(JSON.stringify(message.error)));else p.ok(message.result);}};ws.onclose=()=>{for(const p of pending.values())p.no(Error('Owned CDP connection closed'));pending.clear();};});}
async function evaluate(expression){const response=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw Error(JSON.stringify(response.exceptionDetails));return response.result.value;}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}
try{
 const root=realpathSync(arg('--root',process.cwd())),browser=arg('--chrome',process.env.KAMINOS_BROWSER),port=Number(arg('--port','8140')),debug=Number(arg('--debug-port','9348'));
 report.repoRoot=root;report.chrome=browser;report.phase='browser-resolution';persist();
 if(!browser||!existsSync(browser)||!/(Chrome for Testing|headless_shell|chrome-headless-shell|Chromium)/.test(browser)||/\/Applications\/Google Chrome\.app\//.test(browser))throw Error('An independent Chrome for Testing/Chromium executable is required');
 const files=['mineral-worlds/crust.mjs','mineral-worlds/crust-surface.mjs','experiments/mineral-crust.experiment.mjs','mineral-worlds/crust-bench.mjs','mineral-worlds/crust-bench-contract.mjs','index.html','scene-light-timing.mjs'].map(p=>join(root,p));
 report.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();report.sourceBefore=digest(files);report.dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'});report.phase='model';persist();
 const model=await import(new URL('./crust.mjs',import.meta.url)),contract=await import(new URL('./crust-bench-contract.mjs',import.meta.url));let grown,fast;
 for(const setup of [{name:'four-by-four-existing-growth',rows:4,nucleation:0},{name:'four-by-four-birth-and-growth',rows:4,nucleation:45},{name:'four-by-four-higher-mobility',rows:4,nucleation:45,mobility:120},{name:'eight-by-eight-birth-and-growth',rows:8,nucleation:45}]){
  const state=model.createCrust({rows:setup.rows,settings:{nucleation:setup.nucleation,...(setup.mobility==null?{}:{mobility:setup.mobility})}}),samples=[];
  for(let i=0;i<800;i++){const start=performance.now();model.advanceCrust(state,.1);samples.push({step:state.tick,grains:state.grains.length,ms:performance.now()-start});}
  const effective=model.readCrust(state);if(Math.abs(effective.waterError)>1e-8||Math.abs(effective.saltError)>1e-8)throw Error('Cost specimen lost material');
  const result={...setup,effective,cpuStepMs:summary(samples.map(x=>x.ms)),samples};report.model.push(result);writeFileSync(join(output,setup.name+'.json'),JSON.stringify(model.saveCrust(state)));if(setup.rows===4&&setup.nucleation){if(setup.mobility)fast=model.saveCrust(state);else grown=model.saveCrust(state);}persist();
 }
 report.phase='server';persist();const serverLog=createWriteStream(join(output,'server.log'));logs.push(serverLog);server=spawn('python3',['serve.py',String(port)],{cwd:root,stdio:['ignore','pipe','pipe']});server.stdout.pipe(serverLog);server.stderr.pipe(serverLog);report.serverPid=server.pid;
 const base=`http://127.0.0.1:${port}`;let runtime;
 while(!runtime){if(server.exitCode!==null)throw Error('Owned server exited before admission');try{const response=await fetch(base+'/api/runtime-config');if(response.ok)runtime=await response.json();}catch{}if(!runtime)await delay(50);}
 if(runtime.source?.repoRoot!==root)throw Error('Server root was substituted');report.runtime=runtime;
 report.phase='browser';persist();const browserLog=createWriteStream(join(output,'browser.log'));logs.push(browserLog);let stderr='';
 chrome=spawn(browser,['--headless=new','--enable-unsafe-webgpu','--use-mock-keychain','--password-store=basic',`--user-data-dir=${join(output,'chrome-profile')}`,`--remote-debugging-port=${debug}`,'--window-size=1440,1000','--disable-background-networking','about:blank'],{stdio:['ignore','pipe','pipe']});chrome.stdout.pipe(browserLog);chrome.stderr.pipe(browserLog);chrome.stderr.on('data',data=>stderr+=data);report.browserPid=chrome.pid;
 while(!stderr.includes('DevTools listening on ')){if(chrome.exitCode!==null)throw Error('Independent browser exited before CDP admission');await delay(50);}
 const browserSocket=stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1];if(!browserSocket)throw Error('Owned browser socket missing');report.browserSocket=browserSocket;
 const browserCdp=await connect(browserSocket),targets=(await browserCdp.call('Target.getTargets')).targetInfos,target=targets.find(t=>t.type==='page');browserCdp.ws.close();if(!target)throw Error('Owned browser has no page');
 cdp=await connect(`ws://127.0.0.1:${debug}/devtools/page/${target.targetId}`);await cdp.call('Page.enable');await cdp.call('Runtime.enable');const url=base+'/?experiment=mineral-crust&workspace=workbench';await cdp.call('Page.navigate',{url});report.url=url;
 while(!await evaluate('!!window.kaminosWorkbenchExperiments&&window.kaminosWorkbenchExperiments.state().id==="mineral-crust"')){if(chrome.exitCode!==null)throw Error('Browser exited during experiment load');const error=await evaluate('window.kaminosWorkbenchExperimentError??null');if(error)throw Error(error);await delay(50);}
 report.phase='scene-admission';persist();
 const identity=await evaluate(`(async()=>{const state=await window.kaminosWorkbenchExperiments.read(),runtime=await(await fetch('/api/runtime-config')).json(),objects=window.kaminosSceneAuthoring.read().objects,host=window.kaminosWorkbenchSceneState();return {experiment:window.kaminosWorkbenchExperiments.state().id,model:state.model,objectId:state.objectId,registered:objects.some(x=>x.id===state.objectId),source:runtime.source,...host};})()`);
 contract.validateCrustRoute(identity,root);report.identity=identity;
 report.device=await evaluate('(async()=>{const app=await window.kaminosAppGpu();if(!app?.device)throw Error("Shared page GPU device missing");window.__crustBenchDevice=app.device;return {features:Array.from(app.device.features),adapter:app.adapter?.info?{vendor:app.adapter.info.vendor,architecture:app.adapter.info.architecture,description:app.adapter.info.description}:null};})()');
 for(const name of ['initial','grown','higher-mobility','empty-baseline']){
  report.phase='scene-'+name;persist();
  if(name==='grown')await evaluate(`window.kaminosWorkbenchExperiments.invoke('restore',${JSON.stringify({schema:'kaminos.capillary-crust.v1',state:grown,rate:8})})`);
  if(name==='higher-mobility')await evaluate(`window.kaminosWorkbenchExperiments.invoke('restore',${JSON.stringify({schema:'kaminos.capillary-crust.v1',state:fast,rate:8})})`);
  if(name==='empty-baseline')await evaluate('(async()=>{const r=await window.kaminosWorkbenchExperiments.read();window.selectSceneObject(r.objectId);window.kaminosSceneVisibility.hideSelected();})()');
  await evaluate('window.kaminosSelection.clear()');
  await evaluate('(async()=>{for(let i=0;i<8;i++){await new Promise(requestAnimationFrame);window.__kaminosRenderSceneForInspection();await window.__crustBenchDevice.queue.onSubmittedWorkDone();}})()');
  const nativeTiming=await evaluate('window.kaminosWorkbenchMeasureSceneGpu({samples:18})');
  if(nativeTiming.status!=='measured')throw Error('Native scene GPU timing did not complete: '+JSON.stringify(nativeTiming));
  const samples=nativeTiming.records.map(r=>({...r.requestedDraw,cpuMs:r.requestedDraw.cpuMs,gpuMs:r.render.ms,timingFrame:r.render.frame}));
  contract.validateCrustFrames(samples);const state=await evaluate('window.kaminosWorkbenchExperiments.read()');
  const scene={name,state,visibility:name==='empty-baseline'?'owned-root-hidden':'owned-root-visible',samples,nativeTiming,cpuDrawMs:summary(samples.map(x=>x.cpuMs)),gpuSceneMs:samples.every(x=>x.gpuMs!==null)?summary(samples.map(x=>x.gpuMs)):null};report.scene.push(scene);
  const shot=await cdp.call('Page.captureScreenshot',{format:'png'});writeFileSync(join(output,name+'.png'),Buffer.from(shot.data,'base64'));persist();
 }
 report.sourceAfter=digest(files);if(JSON.stringify(report.sourceBefore)!==JSON.stringify(report.sourceAfter))throw Error('Measured source changed during execution');report.status='complete';report.phase='complete';report.finished=new Date().toISOString();report.scope='Model CPU steps; native Three scene render-pass GPU timestamps with explicit requested-frame identity. Headless Workbench, no inference workload. Initial/grown/empty draw samples retained in full.';persist();console.log(JSON.stringify({status:report.status,output,model:report.model.map(({name,effective,cpuStepMs})=>({name,effective,cpuStepMs})),scene:report.scene.map(({name,cpuDrawMs,gpuSceneMs})=>({name,cpuDrawMs,gpuSceneMs}))}));
}catch(error){report.status='failed';report.error=String(error.stack||error);report.finished=new Date().toISOString();persist();console.error(report.error);process.exitCode=1;}
finally{cdp?.ws.close();try{await stop(chrome);await stop(server);report.cleanup={browserStopped:true,serverStopped:true};}catch(error){report.status='failed';report.phase='cleanup';report.cleanup={error:String(error)};process.exitCode=1;}for(const log of logs)log.end();persist();}
