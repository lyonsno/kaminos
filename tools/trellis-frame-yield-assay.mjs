// Retained real TRELLIS block on the normal app host. Run through Greenroom.
import {validateFrameYieldState}from '../models/trellis2/frame-yield-checks.js';
import fs from 'node:fs/promises';import path from 'node:path';import {spawn,execFileSync}from 'node:child_process';import {createHash}from 'node:crypto';import {pathToFileURL}from 'node:url';
const cfg=JSON.parse(await fs.readFile(process.argv[2],'utf8')),out=cfg.output;
await fs.mkdir(out,{recursive:true});const report={schema:'trellis2.frame-yield-assay.v0',status:'failed',phase:'admission',config:cfg,command:process.argv};
const persist=()=>fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
const sha=b=>createHash('sha256').update(b).digest('hex');const sleep=ms=>new Promise(r=>setTimeout(r,ms));let browser,server,cdp;
async function connect(url) {
  const socket = new WebSocket(url), pending = new Map(), listeners = new Map();
  let nextId = 0, failure;
  const rejectWaiters = message => {
    failure ||= new Error(message);
    for (const entry of pending.values()) entry.reject(failure);
    pending.clear();
    for (const entries of listeners.values()) for (const entry of entries) entry.reject(failure);
    listeners.clear();
  };
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', () => reject(new Error('browser CDP connection error')), { once: true });
    socket.addEventListener('close', () => reject(new Error('browser CDP connection closed before open')), { once: true }); });
  socket.addEventListener('message', event => {
    const row = JSON.parse(event.data);
    if (row.id) {
      const entry = pending.get(row.id); pending.delete(row.id);
      if (row.error) entry?.reject(new Error(JSON.stringify(row.error))); else entry?.resolve(row.result);
    } else {
      const key = `${row.sessionId || ''}:${row.method}`;
      for (const entry of listeners.get(key) || []) entry.resolve(row.params);
      listeners.delete(key);
    }
  });
  socket.addEventListener('close', () => rejectWaiters('browser CDP connection closed'));
  socket.addEventListener('error', () => rejectWaiters('browser CDP connection error'));
  return {
    call(method, params = {}, sessionId) { return new Promise((resolve, reject) => {
      if (failure || socket.readyState !== WebSocket.OPEN) { reject(failure || new Error('browser CDP connection closed')); return; }
      const id = ++nextId; pending.set(id, { resolve, reject });
      try { socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); }
      catch (error) { pending.delete(id); reject(error); rejectWaiters('browser CDP connection error'); }
    }); },
    once(method, sessionId) { return new Promise((resolve, reject) => {
      if (failure || socket.readyState !== WebSocket.OPEN) { reject(failure || new Error('browser CDP connection closed')); return; }
      const key = `${sessionId || ''}:${method}`;
      listeners.set(key, [...(listeners.get(key) || []), { resolve, reject }]);
    }); },
    close() { socket.close(); },
  };
}

try{
 await persist();const git=(...args)=>execFileSync('git',args,{cwd:cfg.repoRoot,encoding:'utf8'}).trim();
 report.sourceCommit=git('rev-parse','HEAD');if(report.sourceCommit!==cfg.expectedCommit||git('status','--porcelain'))throw Error('changed source revision/worktree');
 report.fixtures={};for(const[group,root]of Object.entries(cfg.fixtureRoots)){
  const raw=await fs.readFile(path.join(root,'manifest.json'));if(sha(raw)!==cfg.fixtureManifestHashes[group])throw Error('changed fixture manifest '+group);
  report.fixtures[group]=JSON.parse(raw);
 }
 const{fluidBrowserLaunch}=await import(pathToFileURL(path.join(cfg.repoRoot,'finger-fluid-browser-launch.mjs')));
 const launch=fluidBrowserLaunch({executable:cfg.chrome,debugPort:cfg.debugPort,userDataDir:path.join(out,'browser-profile'),width:1280,height:900});
 report.browserLaunch={...launch,args:['--headless=new','--enable-unsafe-webgpu',...launch.args]};report.phase='server';await persist();
 server=spawn(cfg.python,[path.join(cfg.repoRoot,'tools/trellis-frame-yield-server.py'),process.argv[2]],{cwd:cfg.repoRoot,stdio:['ignore','pipe','pipe']});
 const sl=await fs.open(path.join(out,'server.log'),'w');server.stdout.on('data',d=>sl.write(d));server.stderr.on('data',d=>sl.write(d));
 const url='http://127.0.0.1:'+cfg.port;
 while(true){if(server.exitCode!==null)throw Error('owned server exited');try{const r=await fetch(url+'/api/runtime-config');if(r.ok){report.runtimeConfig=await r.json();break;}}catch{}await sleep(125);}
 if(report.runtimeConfig.source?.repoRoot!==cfg.repoRoot||report.runtimeConfig.source.commit!==cfg.expectedCommit||report.runtimeConfig.source.dirty)throw Error('wrong served app source');
 report.phase='browser';await persist();browser=spawn(launch.executable,report.browserLaunch.args,{stdio:['ignore','ignore','pipe']});report.browserPid=browser.pid;
 const bl=await fs.open(path.join(out,'browser.log'),'w');browser.stderr.on('data',d=>bl.write(d));
 while(true){if(browser.exitCode!==null)throw Error('owned browser exited');try{const r=await fetch('http://127.0.0.1:'+cfg.debugPort+'/json/version');if(r.ok){report.browserVersion=await r.json();break;}}catch{}await sleep(125);}
 const pages=await(await fetch('http://127.0.0.1:'+cfg.debugPort+'/json/list')).json();cdp=await connect(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
 const evaluate=async expression=>{const r=await cdp.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 await cdp.call('Page.enable');const loaded=cdp.once('Page.loadEventFired');report.url=url+'/index.html?notes=0&vantage=0';await cdp.call('Page.navigate',{url:report.url});await loaded;
 await evaluate('(async()=>{while(!window.kaminosAppGpu)await new Promise(r=>requestAnimationFrame(r));await window.kaminosAppGpu();return true})()');
 report.phase='retained-model-block';await persist();const inputs={fixtures:report.fixtures,frameBudgetMs:cfg.frameBudgetMs};
 report.result=await evaluate('import("/models/trellis2/frame-yield-probe.js").then(m=>m.runFrameYieldProbe('+JSON.stringify(inputs)+'))');
 report.primary=JSON.parse(await fs.readFile(path.join(out,'state.json'),'utf8'));
 if(report.result.status!=='completed'||report.primary.status!=='completed')throw Error(report.primary.error?.message??'block comparison failed');
 const b=report.fixtures.block.config;validateFrameYieldState(report.primary,{shape:[b.tokenRows??b.resolution**3,b.channels],frameBudgetMs:cfg.frameBudgetMs});
 for(const run of report.primary.runs){const raw=await fs.readFile(path.join(out,run.output.file));if(raw.byteLength!==run.output.byteLength||sha(raw)!==run.output.sha256)throw Error('raw output mismatch '+run.mode);const a=new Float32Array(raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength));if(!a.every(Number.isFinite)||!a.some(x=>x!==0))throw Error('blank/nonfinite raw output '+run.mode);}
 report.afterScreenshot=path.join(out,'after.png');await fs.writeFile(report.afterScreenshot,Buffer.from((await cdp.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 report.status='completed';report.phase='complete';
}catch(error){report.error={name:error.name,message:error.message,stack:error.stack};process.exitCode=1;}
finally{
 if(cdp){await cdp.call('Browser.close').catch(()=>{});cdp.close();}
 if(browser&&browser.exitCode===null){await Promise.race([new Promise(r=>browser.once('exit',r)),sleep(1000)]);if(browser.exitCode===null){browser.kill('SIGTERM');await new Promise(r=>browser.once('exit',r));}}
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}
 report.cleanup={ownedBrowserClosed:!browser||browser.exitCode!==null,ownedServerClosed:!server||server.exitCode!==null};await persist();
 console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error}));
}
