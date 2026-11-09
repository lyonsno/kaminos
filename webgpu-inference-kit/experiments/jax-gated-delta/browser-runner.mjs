import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {validateBrowserResult} from './validation.mjs';
import {validateQ4Result} from './q4-validation.mjs';

const {values:args}=parseArgs({options:{chrome:{type:'string'},out:{type:'string'},'expected-vendor':{type:'string',default:'apple'},experiment:{type:'string',default:'recurrence'},fixture:{type:'string'}}});
if(!args.out)throw new Error('--out must name the caller-owned report');
const root=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
const prefix='/experiments/jax-gated-delta/';
const output=path.resolve(args.out),nonce=randomUUID();
const report={status:'failed',phase:'preflight',nonce,requested:{backend:'webgpu',vendor:args['expected-vendor'],chrome:args.chrome},
  workload:'tiny deterministic conformance; largest input 48 FP32 elements; no weights or performance comparison',cases:[],errors:[],cleanup:{}};
let browser,server;
let config={};
const persist=async()=>{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2)+'\n');};
try{
  await persist();
  if(!['recurrence','q4-lora'].includes(args.experiment))throw new Error('unknown experiment');
  report.requested.experiment=args.experiment;
  if(args.experiment==='q4-lora'){
    const bytes=await fs.readFile(args.fixture);config={fixture:JSON.parse(bytes),fixtureSha256:createHash('sha256').update(bytes).digest('hex')};
    report.fixture={path:path.resolve(args.fixture),sha256:config.fixtureSha256,provenance:config.fixture.provenance,consumer:config.fixture.consumer};
    report.workload='tiny Q4/LoRA conformance; synthetic5x128base and observed1x4096row; no full model or performance comparison';
  }
  if(!args.chrome)throw new Error('--chrome must name an independent browser executable');
  report.browserExecutable=await fs.realpath(args.chrome);
  if(report.browserExecutable.includes('/Google Chrome.app/'))throw new Error('installed GUI Chrome is not an automation executable');
  report.sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  report.sourceDirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
  const names=args.experiment==='recurrence'?['recurrence.mjs','reference.mjs','checks.mjs','browser-checks.mjs']:
    ['q4-lora.mjs','q4-reference.mjs','q4-checks.mjs','q4-browser-checks.mjs','reference.mjs'];
  const entry=args.experiment==='recurrence'?'browser-checks.mjs':'q4-browser-checks.mjs';
  report.sourceSha256={};
  for(const name of names)report.sourceSha256[prefix+name]=createHash('sha256').update(await fs.readFile(new URL(name,import.meta.url))).digest('hex');
  report.packageVersions={};
  report.packageVersions.jax=JSON.parse(await fs.readFile(new URL('node_modules/@jax-js/jax/package.json',import.meta.url))).version;
  const html='<!doctype html><title>Gated DeltaNet computational check</title><script type="importmap">'+JSON.stringify({imports:{
    '@jax-js/jax':prefix+'node_modules/@jax-js/jax/dist/index.js'}})+'</script><p>Computational conformance check.</p>';
  server=http.createServer(async(req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    res.setHeader('Cache-Control','no-store');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
    if(pathname==='/'){res.setHeader('Content-Type','text/html');return res.end(html);}
    if(!pathname.startsWith('/src/')&&!pathname.startsWith(prefix))return res.writeHead(403).end();
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    try{res.setHeader('Content-Type',/\.m?js$/.test(file)?'text/javascript':'application/json');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  report.requestedRoute='http://127.0.0.1:'+server.address().port+'/';
  report.profile=await fs.mkdtemp(path.join(os.tmpdir(),'eventual-jax-gdn-'));
  report.phase='browser-launch';await persist();
  const {default:puppeteer}=await import('puppeteer-core');
  browser=await puppeteer.launch({executablePath:report.browserExecutable,headless:true,userDataDir:report.profile,protocolTimeout:0,
    args:['--enable-unsafe-webgpu','--use-mock-keychain','--password-store=basic']});
  report.browserPid=browser.process().pid;report.browserVersion=await browser.version();
  const page=await browser.newPage();page.setDefaultTimeout(0);
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto(report.requestedRoute,{timeout:0});report.effectiveRoute=page.url();
  if(report.effectiveRoute!==report.requestedRoute)throw new Error('browser route changed');
  await page.exposeFunction('recordGdnProgress',async value=>{
    report.phase=value.phase;
    if(value.backend){report.backend=value.backend;if(value.backend.vendor.toLowerCase()!==args['expected-vendor'].toLowerCase())throw new Error('unexpected GPU vendor');}
    if(value.case)report.cases.push(value.case);
    await persist();
  });
  report.phase='source-verification';await persist();
  const result=await page.evaluate(async({nonce,hashes,entry,config})=>{
    for(const [url,expected]of Object.entries(hashes)){
      const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw new Error('source unavailable: '+url);
      const bytes=await response.arrayBuffer(),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
      if(hash!==expected)throw new Error('served source changed: '+url);
    }
    const {runBrowserChecks}=await import(entry);
    return runBrowserChecks(nonce,window.recordGdnProgress,config);
  },{nonce,hashes:report.sourceSha256,entry:prefix+entry,config});
  (args.experiment==='recurrence'?validateBrowserResult:validateQ4Result)(result,{nonce,vendor:args['expected-vendor'],...config});
  if(report.errors.length)throw new Error('browser page errors: '+report.errors.join('; '));
  report.result=result;report.status='succeeded';report.phase=null;
}catch(error){report.error={message:error.message,stack:error.stack};process.exitCode=1;}
finally{
  try{if(browser)await browser.close();report.cleanup.browserClosed=true;}catch(error){report.cleanup.browserError=error.message;report.status='failed';process.exitCode=1;}
  try{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}report.cleanup.serverClosed=true;}catch(error){report.cleanup.serverError=error.message;report.status='failed';process.exitCode=1;}
  await persist();console.log(JSON.stringify({status:report.status,phase:report.phase,cases:report.cases.length,output,error:report.error?.message}));
}
