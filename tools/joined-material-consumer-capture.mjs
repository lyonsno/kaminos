// Run an actual browser fine consumer with explicitly named fine/outer roots.
import {createServer} from 'node:http';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,existsSync,realpathSync} from 'node:fs';
import {resolve,extname,join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {assertJoinedPreview} from './joined-preview-contract.mjs';
const [fineArg,outerArg,outArg,browserArg,fault='',witness='material',warmBudget='32']=process.argv.slice(2);
assert(outArg,'fine root, outer root, output and independent browser required');
const fine=resolve(fineArg),outer=resolve(outerArg),out=resolve(outArg);
mkdirSync(out,{recursive:true});
const report={status:'running',phase:'source',fine,outer,fault,witness,command:process.argv,browser:{},startedAt:new Date().toISOString()};
const save=()=>writeFileSync(join(out,'report.json'),JSON.stringify(report,null,2));save();
let server,child,ws,serial=0;const pending=new Map();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const call=(method,params={})=>new Promise((resolve,reject)=>{if(ws?.readyState!==WebSocket.OPEN){reject(Error('owned CDP is not open'));return;}const id=++serial;pending.set(id,{resolve,reject});try{ws.send(JSON.stringify({id,method,params}));}catch(error){pending.delete(id);reject(error);}});
async function evaluate(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
try{
  assert(['material','pressure','pressure-sequence','preview','preview-smoke'].includes(witness),'unknown witness');
  const preview=witness.startsWith('preview'),interactive=witness==='preview';
  const pressureWitness=witness.startsWith('pressure');
  assert(Number.isInteger(Number(warmBudget))&&Number(warmBudget)>0,'invalid warm iteration budget');
  assert((preview?['','missing-import']:witness==='pressure-sequence'?['','stale-generation']:pressureWitness?['','no-scatter']:['','stale-generation','missing-control']).includes(fault),'unknown fault');
  const entry=`tools/joined-${pressureWitness?'pressure':'material'}-consumer-browser.mjs`;
  report.sources=Object.fromEntries([['fine',fine],['outer',outer]].map(([k,p])=>[k,{root:p,commit:execFileSync('git',['rev-parse','HEAD'],{cwd:p,encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{cwd:p,encoding:'utf8'}),hashes:Object.fromEntries((preview?[]:k==='fine'?['volume-core.js','volume-reactant-combustion.mjs','tools/joined-material-consumer-browser.mjs','tools/joined-material-consumer-capture.mjs']:['volume-outer-smoke.mjs','volume-passive-material.mjs']).map(f=>[f,hash(join(p,f))]))}]));
  report.sources.fine.hashes[entry]=hash(join(fine,entry));
  if(preview)for(const file of ['tools/joined-material-consumer-capture.mjs','tools/joined-preview-contract.mjs','tools/joined-flame-preview.html'])report.sources.fine.hashes[file]=hash(join(fine,file));
  if(pressureWitness)for(const f of ['volume-composite-grid.mjs','volume-composite-storage.mjs','volume-composite-storage-gpu.mjs','volume-composite-producer.mjs','volume-composite-producer-gpu.mjs','volume-composite-pcg-gpu.mjs'])report.sources.outer.hashes[f]=hash(join(outer,f));
  const executable=interactive?null:realpathSync(browserArg);if(!interactive)assert(/Google Chrome for Testing|chromium|headless.shell/i.test(executable),'independent headless browser required');report.browser.executable=executable;
  server=createServer((req,res)=>{try{const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);res.setHeader('Cache-Control','no-store');if(path==='/checkpoint'){let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{report.lastCheckpoint=JSON.parse(b);save();res.end('ok');}catch{res.statusCode=400;res.end('bad checkpoint');}});return;}if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<div id="viewport" style="width:256px;height:256px"></div><script>window.loadErrors=[];window.addEventListener("error",e=>loadErrors.push(e.message));window.addEventListener("unhandledrejection",e=>loadErrors.push(String(e.reason)));</script><script type="module" src="/fine/tools/joined-material-consumer-browser.mjs"></script>');return;}const base=path.startsWith('/fine/')?fine:path.startsWith('/outer/')?outer:null;assert(base,'unknown route');const file=resolve(base,path.slice(path.indexOf('/',1)+1));assert(file.startsWith(base+'/'),'outside source');res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.png':'image/png','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch(e){res.statusCode=404;res.end(String(e));}});
  const serveSource=server.listeners('request')[0];server.removeAllListeners('request');
  server.on('request',(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(preview&&fault==='missing-import'&&path==='/fine/volume-core.js'){res.statusCode=404;res.end('intentional missing dependency');return;}
    if(preview&&path==='/'){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html');res.end(readFileSync(join(fine,'tools/joined-flame-preview.html')));return;}
    if(preview&&(path.startsWith('/fine/')||path.startsWith('/outer/'))){const key=path.startsWith('/fine/')?'fine':'outer',relative=path.slice(key.length+2),file=resolve(report.sources[key].root,relative);if(file.startsWith(report.sources[key].root+'/')&&existsSync(file)){report.sources[key].hashes[relative]??=hash(file);save();}}
    if(path==='/'&&pressureWitness){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/html');res.end(`<div id="viewport" style="width:256px;height:256px"></div><script>window.loadErrors=[];window.addEventListener('error',e=>loadErrors.push(e.message));window.addEventListener('unhandledrejection',e=>loadErrors.push(String(e.reason)));</script><script type="module" src="/fine/${entry}"></script>`);return;}
    if(!path.startsWith('/raw/'))return serveSource(req,res);
    const name=path.slice(5);
    if(req.method!=='POST'||!/^(empty|loaded|open|wall)-(step-\d+-)?(fine|outer|predicted|projected|next|flux|pressure|target|mask)\.f32$/.test(name)){res.statusCode=400;res.end('invalid evidence target');return;}
    const chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
      try{const bytes=Buffer.concat(chunks);writeFileSync(join(out,name),bytes);report.rawEvidence??={};report.rawEvidence[name]={bytes:bytes.length,sha256:hash(join(out,name))};save();res.end('retained');}
      catch(e){report.evidenceWriteError=String(e);save();res.statusCode=500;res.end('evidence write failed');}
    });
  });
  report.phase='listener-start';save();
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  const url=`http://127.0.0.1:${server.address().port}/`;report.url=url;
  if(interactive){report.status='serving-unverified';report.phase='interactive-listener';save();console.log(JSON.stringify({preview:true,url,report:join(out,'report.json')}));await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});report.status='stopped';returnPreview();}
  function returnPreview(){server.close();save();process.exit(0);}
  const profile=mkdtempSync(join(out,'browser-profile-'));report.browser.profile=profile;
  report.phase='browser-launch';save();
  child=spawn(executable,['--headless=new','--password-store=basic','--enable-unsafe-webgpu','--disable-background-timer-throttling','--disable-renderer-backgrounding','--remote-debugging-port=0',`--user-data-dir=${profile}`,url],{stdio:['ignore','ignore','pipe']});report.browser.pid=child.pid;child.on('exit',(code,signal)=>{report.browser.exit={code,signal};save();});
  let launchError;child.on('error',e=>launchError=e);child.stderr.on('data',b=>{writeFileSync(join(out,'browser-stderr.log'),b,{flag:'a'});});
  while(!existsSync(join(profile,'DevToolsActivePort'))){if(launchError)throw launchError;assert(child.exitCode===null,'browser exited');await sleep(100);}
  const port=Number(readFileSync(join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);report.browser.port=port;
  let target;while(!target){target=(await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t=>t.type==='page');if(!target)await sleep(100);}
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
  ws.onmessage=e=>{const r=JSON.parse(e.data),p=pending.get(r.id);if(p){pending.delete(r.id);r.error?p.reject(Error(JSON.stringify(r.error))):p.resolve(r.result);}};
  ws.onclose=e=>{report.cdpClose={code:e.code,reason:e.reason};for(const p of pending.values())p.reject(Error('owned CDP closed'));pending.clear();};
  if(preview){
    await call('Emulation.setDeviceMetricsOverride',{width:1200,height:900,deviceScaleFactor:1,mobile:false});
    report.phase='visible-joined-sequence';save();
    async function settle(steps){let state;for(;;){state=await evaluate('window.joinedPreview');if(state?.phase==='failed')throw Error(state.error);if(state?.steps>=steps)break;assert(child.exitCode===null,'browser exited');await sleep(250);}await evaluate("document.getElementById('pause').click();joinedPreviewCheckpoint()");return await evaluate('window.joinedPreview');}
    report.preview={open:await settle(64)};
    assertJoinedPreview(report.preview.open,{fine:[32,32,32],coarse:[32,64,32],roof:false});
    const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'open.png'),Buffer.from(shot.data,'base64'));save();
    await evaluate("document.getElementById('fine').value='48';document.getElementById('coarse').value='32';document.getElementById('roof').checked=true;document.getElementById('apply').click()");
    for(;;){const state=await evaluate('window.joinedPreview');if(state.phase==='failed')throw Error(state.error);if(state.generation>=2)break;assert(child.exitCode===null,'browser exited');await sleep(100);}
    report.preview.roofRebuild=await settle(32);
    assertJoinedPreview(report.preview.roofRebuild,{fine:[48,48,48],coarse:[32,64,32],roof:true});
    const roofShot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'roof-rebuild.png'),Buffer.from(roofShot.data,'base64'));
    for(const source of Object.values(report.sources))for(const [file,h]of Object.entries(source.hashes))assert.equal(hash(join(source.root,file)),h,'source changed during execution');
    report.status='passed';report.phase='complete';
  }else{
  report.phase='module-load';save();while(!await evaluate('typeof window.runConsumer === "function"')){const errors=await evaluate('window.loadErrors');assert(!errors?.length,JSON.stringify(errors));assert(child.exitCode===null,'browser exited');await sleep(100);}
  report.phase='consumer';save();const result=await evaluate(`runConsumer(${JSON.stringify(fault)},${witness==='pressure-sequence'},${Number(warmBudget)})`);
  for(const arm of result.arms)for(const raw of Object.values(arm.raw)){assert.equal(readFileSync(join(out,raw.file)).byteLength,raw.bytes,'raw evidence incomplete');raw.sha256=hash(join(out,raw.file));}
  report.result=result;
  for(const source of Object.values(report.sources))for(const [file,h]of Object.entries(source.hashes))assert.equal(hash(join(source.root,file)),h,'source changed during execution');
  assert.equal(result.phase,'complete');report.status='passed';report.phase='complete';
  }
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;if(ws?.readyState===WebSocket.OPEN)try{report.lastTrustworthyEvidence=await evaluate('({status:window.consumerStatus,result:window.consumerResult,preview:window.joinedPreview})');const shot=await call('Page.captureScreenshot',{format:'png'});writeFileSync(join(out,'failure.png'),Buffer.from(shot.data,'base64'));}catch{} }
finally{report.finishedAt=new Date().toISOString();save();ws?.close();child?.kill();server?.close();console.log(JSON.stringify({status:report.status,phase:report.phase,error:report.error,probes:report.result?.arms.map(a=>a.probe)}));}
