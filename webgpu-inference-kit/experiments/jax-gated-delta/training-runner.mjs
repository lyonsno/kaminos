import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import readline from 'node:readline';
import {validateRun,validateCheckpoint,runIdentity} from './training.mjs';

const argv=process.argv.slice(2),outIndex=argv.indexOf('--out');
if(outIndex<0||!argv[outIndex+1])throw new Error('--out must name a durable report');
const output=path.resolve(argv[outIndex+1]);
// Reject destructive output/input aliases before the first report write.
const canonical=async p=>fs.realpath(p).catch(()=>path.resolve(p));
for(const flag of ['--manifest','--resume']){
  const i=argv.indexOf(flag);
  if(i>=0&&argv[i+1]&&await canonical(output)===await canonical(argv[i+1]))throw new Error('report output aliases '+flag);
}
const root=path.resolve(fileURLToPath(new URL('.',import.meta.url)));
const report={schema:'kaminos.training-report.v1',status:'failed',phase:'arguments',progress:null,cleanup:{browserClosed:false,serverClosed:false},events:[]};
let args,browser,server,trainerPage,lines,input;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+process.pid+'.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,file);}
const persist=()=>atomic(output,report);
const emit=event=>process.stdout.write(JSON.stringify(event)+'\n');
try{
  await persist();
  ({values:args}=parseArgs({options:{manifest:{type:'string'},out:{type:'string'},chrome:{type:'string'},resume:{type:'string'},'checkpoint-out':{type:'string'},'invocation-id':{type:'string'},managed:{type:'boolean',default:false},'expected-vendor':{type:'string',default:'apple'}}}));
  report.invocation=args['invocation-id']??randomUUID();
  report.phase='manifest';await persist();
  const manifestBytes=await fs.readFile(args.manifest),run=validateRun(JSON.parse(manifestBytes));
  report.manifest={path:path.resolve(args.manifest),sha256:hash(manifestBytes),runIdentity:await runIdentity(run)};
  const names=['training.mjs','q4-lora.mjs','q4-checks.mjs','q4-reference.mjs','reference.mjs'];
  report.source={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),files:{},jax:JSON.parse(await fs.readFile(path.join(root,'node_modules/@jax-js/jax/package.json'))).version};
  for(const name of [...names,'training-runner.mjs'])report.source.files[name]=hash(await fs.readFile(path.join(root,name)));
  let resume;
  if(args.resume){
    report.phase='resume-validation';await persist();
    const bytes=await fs.readFile(args.resume),envelope=JSON.parse(bytes);
    if(envelope.schema!=='kaminos.training-checkpoint.v1'||JSON.stringify(envelope.source)!==JSON.stringify(report.source))throw new Error('checkpoint source identity mismatch');
    if(envelope.route?.backend!=='webgpu'||envelope.route?.vendor!==args['expected-vendor'])throw new Error('checkpoint route identity mismatch');
    await validateCheckpoint(run,envelope.state);resume=envelope.state;
    report.resumedFrom={path:path.resolve(args.resume),sha256:hash(bytes),update:resume.update};
  }
  report.phase='browser-launch';await persist();
  const executable=await fs.realpath(args.chrome);
  if(executable.includes('/Google Chrome.app/'))throw new Error('installed GUI Chrome is not an automation executable');
  report.browserExecutable=executable;report.requested={backend:'webgpu',vendor:args['expected-vendor']};
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'kaminos-training-'));report.profile=profile;
  const html='<!doctype html><title>Training control conformance</title><script type="importmap">'+JSON.stringify({imports:{'@jax-js/jax':'/node_modules/@jax-js/jax/dist/index.js'}})+'</script><button id="pause">Pause training</button><p id="state">Initializing</p>';
  server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(!names.some(n=>pathname==='/'+n)&&!pathname.startsWith('/node_modules/@jax-js/jax/dist/'))return res.writeHead(403).end();
    const file=path.resolve(root,'.'+decodeURIComponent(pathname));
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.setHeader('Content-Type','text/javascript');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  report.servedRoute='http://127.0.0.1:'+server.address().port+'/';
  const {default:puppeteer}=await import('puppeteer-core');
  browser=await puppeteer.launch({executablePath:executable,headless:true,userDataDir:profile,protocolTimeout:0,args:['--enable-unsafe-webgpu','--use-mock-keychain','--password-store=basic']});
  report.browserPid=browser.process().pid;report.browserVersion=await browser.version();
  trainerPage=await browser.newPage();trainerPage.setDefaultTimeout(0);
  const errors=[];trainerPage.on('pageerror',e=>errors.push(e.message));
  await trainerPage.goto(report.servedRoute,{timeout:0});
  if(trainerPage.url()!==report.servedRoute)throw new Error('browser route changed');
  report.phase='initialization';await persist();
  report.backend=await trainerPage.evaluate(async({run,resume,expected,hashes})=>{
    for(const [name,digest]of Object.entries(hashes)){
      if(name==='training-runner.mjs')continue;
      const response=await fetch('/'+name),bytes=await response.arrayBuffer();
      const actual=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if(!response.ok||actual!==digest)throw new Error('served source changed: '+name);
    }
    const jax=await import('@jax-js/jax'),{createQ4Trainer}=await import('/training.mjs');
    await jax.init('webgpu');jax.defaultDevice('webgpu');
    const device=jax.getWebGPUDevice(),vendor=device.adapterInfo.vendor.toLowerCase();
    if(vendor!==expected.toLowerCase())throw new Error('effective GPU vendor mismatch');
    const gpuErrors=[];device.addEventListener('uncapturederror',e=>gpuErrors.push(e.error.message));
    const trainer=await createQ4Trainer(jax,run,'webgpu',resume);
    let pause=false;document.querySelector('#pause').onclick=()=>{pause=true;document.querySelector('#state').textContent='Pause requested';};
    const hostTurn=()=>new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=()=>{c.port1.close();c.port2.close();resolve();};c.port2.postMessage(null);});
    window.training={
      async next(){await device.queue.onSubmittedWorkDone();await hostTurn();if(pause)return {paused:true,...trainer.progress};
        const result=await trainer.step();await device.queue.onSubmittedWorkDone();await hostTurn();
        if(gpuErrors.length)throw new Error('WebGPU errors: '+gpuErrors.join('; '));
        return {paused:pause,...result};},
      snapshot:()=>trainer.snapshot(),
      async dispose(){await device.queue.onSubmittedWorkDone();await trainer.dispose();await device.queue.onSubmittedWorkDone();device.destroy();}
    };
    return {effective:'webgpu',vendor,architecture:device.adapterInfo.architecture,features:[...device.features]};
  },{run,resume,expected:args['expected-vendor'],hashes:report.source.files});
  if(report.backend.effective!=='webgpu')throw new Error('wrong effective backend');
  if(args.managed){input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});lines=input[Symbol.asyncIterator]();}
  report.progress={update:resume?.update??0,total:run.updates};
  while(true){
    report.phase='boundary';await persist();emit({event:'boundary',progress:report.progress,backend:report.backend});
    let command={action:'next'};
    if(lines){const line=await lines.next();if(line.done)throw new Error('managed controller disconnected');command=JSON.parse(line.value);}
    if(command.action==='pause'){
      // Exercise a real DOM event, not a flag supplied through the optimizer.
      await trainerPage.click('#pause');
      const observed=await trainerPage.evaluate(()=>window.training.next());
      if(!observed.paused||observed.update!==report.progress.update)throw new Error('pause admitted another update');
      report.pauseObserved=observed;command={action:'checkpoint'};
    }
    if(command.action==='checkpoint'||report.progress.update===run.updates){
      report.phase='checkpoint';await persist();
      const state=await trainerPage.evaluate(()=>window.training.snapshot());
      await validateCheckpoint(run,state);
      const file=path.resolve(args['checkpoint-out']??path.join(path.dirname(output),'checkpoint.json'));
      if(file===output||file===path.resolve(args.manifest)||file===path.resolve(args.resume??output))throw new Error('checkpoint output aliases an input/report');
      await atomic(file,{schema:'kaminos.training-checkpoint.v1',source:report.source,route:{backend:'webgpu',vendor:args['expected-vendor']},state});
      const bytes=await fs.readFile(file);await validateCheckpoint(run,JSON.parse(bytes).state);
      report.checkpoint={path:file,sha256:hash(bytes),update:state.update};report.progress={...report.progress,update:state.update};
      report.phase='release';await persist();
      await trainerPage.evaluate(()=>window.training.dispose());
      report.status=state.update===run.updates?'completed':'checkpointed';break;
    }
    if(command.action!=='next')throw new Error('unknown controller command');
    report.phase='update';await persist();
    const p=await trainerPage.evaluate(()=>window.training.next());
    if(p.paused)throw new Error('browser paused without a checkpoint command');
    if(p.update!==report.progress.update+1)throw new Error('training cursor did not advance exactly once');
    report.progress=p;report.events.push({update:p.update,loss:p.lastLoss});
    if(errors.length)throw new Error('browser error: '+errors.join('; '));
  }
}catch(error){report.error={message:error.message,stack:error.stack};report.status='failed';process.exitCode=1;}
finally{
  input?.close();
  try{if(browser)await browser.close();report.cleanup.browserClosed=true;}catch(e){report.cleanup.error=e.message;report.status='failed';process.exitCode=1;}
  try{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.cleanup.serverClosed=true;}catch(e){report.cleanup.serverError=e.message;report.status='failed';process.exitCode=1;}
  await persist();emit({event:'terminal',report:output,status:report.status,phase:report.phase,checkpoint:report.checkpoint,cleanup:report.cleanup,error:report.error?.message});
}
