#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const args = new Map();
for (let index=2; index<process.argv.length; index+=2) args.set(process.argv[index],process.argv[index+1]);
if (process.argv.includes('--help')) {
  console.log('Usage: node tools/trellis-dinov3-prefix-block-browser-parity-smoke.mjs --reference-dir PATH --source-image PATH --output-dir PATH --report PATH [--source-revision SHA] [--chrome PATH] [--debug-port N] [--server-port N] [--timeout-ms N] [--atol N] [--rtol N]');
  process.exit(0);
}
const root=resolve(new URL('..',import.meta.url).pathname);
const referenceDir=resolve(args.get('--reference-dir')||'');
const sourceImagePath=resolve(args.get('--source-image')||'');
const outputDir=resolve(args.get('--output-dir')||'');
const reportPath=resolve(args.get('--report')||'');
const sourceRevision=args.get('--source-revision')||'unreported-source-revision';
const debugPort=Number(args.get('--debug-port')||9577);
const serverPort=Number(args.get('--server-port')||18577);
const timeoutMs=Number(args.get('--timeout-ms')||0);
const atol=Number(args.get('--atol')||0.002);
const rtol=Number(args.get('--rtol')||0.001);
const chrome=process.env.KAMINOS_CHROME||args.get('--chrome')||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const invocationId=randomUUID();
const requestedRouteId='trellis2.dinov3.prefix-block0.phase-program.webgpu-local.v0';
const reportSchema='kaminos.trellis-dinov3-prefix-block0.browser-parity-smoke.v0';
const outputSizes={ patchEmbeddings:1024*1024*4, prefixHiddenStates:1029*1024*4, block0HiddenStates:1029*1024*4 };
const allowedOutputNames=new Set(Object.keys(outputSizes).map(name=>`${name}.f32`));
let userDataDir=null;
let server=null;
let chromeProcess=null;
let browserVersion=null;
let browserState=null;
let phase='initializing';
let stderr='';
let outputReceipts={};
let sourceImageSha256=null;
let referenceManifestSummary=null;
const requestedUrl=`http://127.0.0.1:${serverPort}/smokes/trellis-dinov3-prefix-block-browser.html?smokeId=${invocationId}&sourceRevision=${encodeURIComponent(sourceRevision)}&atol=${atol}&rtol=${rtol}`;
const delay=ms=>new Promise(resolveDelay=>setTimeout(resolveDelay,ms));

function inside(base,candidate) { return candidate===base||candidate.startsWith(`${base}${sep}`); }
function writeReport(extra={}) {
  const actualRoute=browserState?.status==='passed'&&browserState?.receipt ? browserState.receipt.effectiveRouteId : browserState?.effectiveRouteId||null;
  const report={
    schema:reportSchema, ok:false, failure_phase:phase, requestedUrl, invocationId, reportPath,
    requestedRouteId, effectiveRouteId:actualRoute, sourceRevision, chrome, chromeProcessPid:chromeProcess?.pid||null,
    browserVersion:browserVersion?.Browser||null, browser:browserState?.browser||null,
    adapterInfo:browserState?.adapterInfo||null, adapterName:browserState?.adapterName||null,
    adapterClassification:browserState?.adapterClassification||'unreported', effectiveBackend:browserState?.receipt?.backend||null,
    device:browserState?.device||null, requestedFeatures:browserState?.requestedFeatures||[], precision:browserState?.precision||{requested:'fp32',effective:'unverified',shaderF16Requested:false},
    model:browserState?.model||referenceManifestSummary?.model||null, kernel:browserState?.kernel||null,
    sourceImage:{path:sourceImagePath,sha256:sourceImageSha256}, referenceManifest:referenceManifestSummary,
    inputHashes:browserState?.referenceHashes||null, lastTrustworthyEvidence:browserState?.lastTrustworthyEvidence||{description:'local command setup only',detail:{phase}},
    evidenceChain:browserState?.evidenceChain||[], lastCompletedPhase:browserState?.lastCompletedPhase||null,
    comparisons:browserState?.comparisons||{}, actualOutputs:browserState?.actualOutputs||{}, persistedOutputReceipts:outputReceipts,
    receipt:browserState?.receipt||null, browserState:browserState||null, stderrTail:stderr.slice(-6000),
    ...extra,
  };
  mkdirSync(dirname(reportPath),{recursive:true});
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  return report;
}
function contentType(path) {
  const extension=extname(path).toLowerCase();
  if (extension==='.html') return 'text/html; charset=utf-8';
  if (extension==='.js'||extension==='.mjs') return 'text/javascript; charset=utf-8';
  if (extension==='.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
async function readRequestBody(request,maximumBytes) {
  const chunks=[]; let length=0;
  for await (const chunk of request) {
    length+=chunk.length;
    if (length>maximumBytes) throw new Error(`output request exceeds its exact expected byte length ${maximumBytes}`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks,length);
}
function startServer() {
  server=createServer(async (request,response)=>{
    try {
      const url=new URL(request.url,requestedUrl);
      if (url.pathname==='/__smoke_state') {
        response.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
        response.end(Buffer.from(JSON.stringify(browserState||null)));
        return;
      }
      if (url.pathname==='/__source/source-image.png'&&request.method==='GET') {
        const bytes=readFileSync(sourceImagePath);
        response.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});
        response.end(bytes);
        return;
      }
      if (url.pathname.startsWith('/__reference/')&&request.method==='GET') {
        const relative=decodeURIComponent(url.pathname.slice('/__reference/'.length));
        const path=resolve(referenceDir,relative);
        if (!inside(referenceDir,path)) { response.writeHead(403); response.end('forbidden'); return; }
        const bytes=readFileSync(path);
        response.writeHead(200,{'content-type':contentType(path),'cache-control':'no-store'});
        response.end(bytes);
        return;
      }
      if (url.pathname.startsWith('/__output/')&&request.method==='POST') {
        const name=decodeURIComponent(url.pathname.slice('/__output/'.length));
        if (!allowedOutputNames.has(name)) { response.writeHead(400); response.end('unexpected output name'); return; }
        const expectedBytes=outputSizes[name.replace(/\.f32$/,'')];
        const bytes=await readRequestBody(request,expectedBytes);
        if (bytes.byteLength!==expectedBytes) { response.writeHead(422); response.end(`partial output ${bytes.byteLength}; expected ${expectedBytes}`); return; }
        const sha256=createHash('sha256').update(bytes).digest('hex');
        if (request.headers['x-output-sha256']!==sha256) { response.writeHead(422); response.end('output digest header mismatch'); return; }
        mkdirSync(resolve(outputDir,'gpu'),{recursive:true});
        const path=resolve(outputDir,'gpu',name);
        writeFileSync(path,bytes);
        outputReceipts[name]={path,sha256,byteLength:bytes.byteLength,dtype:'float32'};
        response.writeHead(201,{'content-type':'application/json','cache-control':'no-store'});
        response.end(JSON.stringify(outputReceipts[name]));
        return;
      }
      const path=resolve(root,url.pathname.slice(1));
      if (!inside(root,path)) { response.writeHead(403); response.end('forbidden'); return; }
      const body=readFileSync(path);
      response.writeHead(200,{
        'content-type':contentType(path),'cache-control':'no-store',
        'cross-origin-opener-policy':'same-origin','cross-origin-embedder-policy':'require-corp',
      });
      response.end(body);
    } catch(error) { response.writeHead(404); response.end(String(error)); }
  });
  return new Promise((resolveListen,rejectListen)=>{
    server.once('error',rejectListen);
    server.listen(serverPort,'127.0.0.1',resolveListen);
  });
}
async function cdp(path) {
  const response=await fetch(`http://127.0.0.1:${debugPort}${path}`);
  if (!response.ok) throw new Error(`CDP ${path} failed with HTTP ${response.status}`);
  return response.json();
}
async function waitForCdp() {
  for(let attempt=0;attempt<120;attempt+=1) {
    try { return await cdp('/json/version'); } catch { await delay(125); }
  }
  throw new Error('Chrome DevTools endpoint did not open');
}
function wsRequest(ws,method,params={}) {
  const id=ws._requestId= (ws._requestId||0)+1;
  ws.send(JSON.stringify({id,method,params}));
  return new Promise((resolveRequest,rejectRequest)=>{
    const timer=timeoutMs>0?setTimeout(()=>rejectRequest(new Error(`${method} timed out after ${timeoutMs}ms`)),timeoutMs):null;
    const listener=event=>{
      const message=JSON.parse(String(event.data));
      if(message.id!==id) return;
      if(timer) clearTimeout(timer);
      ws.removeEventListener('message',listener);
      if(message.error) rejectRequest(new Error(message.error.message)); else resolveRequest(message.result);
    };
    ws.addEventListener('message',listener);
  });
}
async function evaluate(ws,expression) {
  const result=await wsRequest(ws,'Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
  return result.result.value;
}
async function waitForState(ws,expectedInvocationId) {
  const deadline=timeoutMs>0?Date.now()+timeoutMs:Infinity;
  while(Date.now()<deadline) {
    const state=await evaluate(ws,'window.trellisDinoPrefixBlockSmoke||null');
    if(state&&state.invocationId!==expectedInvocationId) throw new Error(`browser invocation identity mismatch: expected ${expectedInvocationId}, got ${state.invocationId||'missing'}`);
    if(state?.status==='passed'||state?.status==='failed') return state;
    await delay(250);
  }
  throw new Error(`browser smoke exceeded explicitly supplied timeout-ms=${timeoutMs}`);
}

let ws;
let exitCode=1;
try {
  phase='local_preflight';
  if(!args.has('--reference-dir')||!args.has('--source-image')||!args.has('--output-dir')||!args.has('--report')) throw new Error('--reference-dir, --source-image, --output-dir, and --report are required');
  if(!Number.isInteger(debugPort)||debugPort<1||debugPort>65535||!Number.isInteger(serverPort)||serverPort<1||serverPort>65535) throw new Error('debug-port and server-port must be valid TCP ports');
  if(timeoutMs<0||!Number.isFinite(timeoutMs)) throw new Error('timeout-ms must be zero (no time limit) or a positive finite number');
  const manifest=JSON.parse(readFileSync(resolve(referenceDir,'reference-manifest.json'),'utf8'));
  referenceManifestSummary={ok:manifest.ok,schema:manifest.schema,model:{id:manifest.model?.id,revision:manifest.model?.revision,dtype:manifest.model?.dtype,files:manifest.model?.files},preprocessing:manifest.preprocessing,computation:manifest.computation,reference:manifest.reference};
  sourceImageSha256=createHash('sha256').update(readFileSync(sourceImagePath)).digest('hex');
  if(sourceImageSha256!=='abf395cc52d81c26dadae9f024072d6c7301679be4e8fc08d572723d7ae32a21') throw new Error(`source image digest mismatch: ${sourceImageSha256}`);
  if(manifest.ok!==true||manifest.model?.revision!=='ea8dc2863c51be0a264bab82070e3e8836b02d51'||manifest.model?.files?.['model.safetensors']?.sha256!=='dcb2e45127cccbf1601e5f42fef165eea275c8e5213197e8dcf3f48822718179') throw new Error('local reference manifest is not the expected pinned F32 DINOv3 export');
  mkdirSync(outputDir,{recursive:true});
  phase='start_server';
  await startServer();
  phase='create_browser_profile';
  userDataDir=mkdtempSync(`${tmpdir()}/kaminos-trellis-dinov3-prefix-block0-chrome-`);
  phase='launch_browser';
  chromeProcess=spawn(chrome,[
    `--remote-debugging-port=${debugPort}`,`--user-data-dir=${userDataDir}`,
    '--no-first-run','--no-default-browser-check','--disable-extensions',
    '--enable-unsafe-webgpu','--enable-features=Vulkan,WebGPU,WebGPUDeveloperFeatures',
    '--headless=new',requestedUrl,
  ],{stdio:['ignore','ignore','pipe']});
  let launchError=null;
  chromeProcess.once('error',error=>{launchError=error;});
  chromeProcess.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  browserVersion=await waitForCdp();
  if(launchError) throw new Error(`Chrome launch failed: ${launchError.message}`);
  phase='browser_webgpu_reference_parity';
  const targets=await cdp('/json/list');
  const page=targets.find(target=>target.type==='page'&&target.url===requestedUrl);
  if(!page?.webSocketDebuggerUrl) throw new Error(`Chrome page target missing for exact invocation ${requestedUrl}`);
  ws=new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen,rejectOpen)=>{
    ws.addEventListener('open',resolveOpen,{once:true});
    ws.addEventListener('error',()=>rejectOpen(new Error('Chrome DevTools WebSocket failed')),{once:true});
  });
  await wsRequest(ws,'Runtime.enable');
  browserState=await waitForState(ws,invocationId);
  const report=writeReport({ok:browserState.status==='passed',failure_phase:browserState.status==='passed'?null:browserState.failurePhase||phase,error:browserState.error||null});
  console.log(JSON.stringify({ok:report.ok,reportPath,requestedRouteId:report.requestedRouteId,effectiveRouteId:report.effectiveRouteId,sourceRevision,browser:report.browserVersion,adapterName:report.adapterName,adapterClassification:report.adapterClassification,precision:report.precision,model:report.model,comparisons:report.comparisons,outputReceipts:report.persistedOutputReceipts,error:browserState.error||null},null,2));
  if(!report.ok) throw new Error(browserState.error||'matched WebGPU-vs-MLX comparison failed');
  exitCode=0;
} catch(error) {
  const report=writeReport({error:String(error?.stack||error)});
  console.error(JSON.stringify({ok:false,failure_phase:phase,reportPath,lastTrustworthyEvidence:report.lastTrustworthyEvidence,error:String(error?.message||error)},null,2));
} finally {
  try { ws?.close(); } catch {}
  try { chromeProcess?.kill(); } catch {}
  try { await new Promise(resolveClose=>server?.close(resolveClose)); } catch {}
}
process.exitCode=exitCode;
