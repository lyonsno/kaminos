import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const port=9461, origin='http://127.0.0.1:63818';
const url=origin+'/#authoring=1&scene=Wateremitter_2026-09-26_14-34-15_2fa7c6667b4a42ee8a98bd3fed6fc101.kaminos.json';
const userDataDir='/private/tmp/kaminos-bathtub-liquid-live-smoke-0926/profile-direct-splat-overlap';
const out='/private/tmp/kaminos-bathtub-liquid-live-smoke-0926/direct-splat-overlap-r2'; mkdirSync(out,{recursive:true});
let phase='launching', ws=null, lastEvidence={};
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',[`--remote-debugging-port=${port}`,`--user-data-dir=${userDataDir}`,'--headless=new','--disable-gpu-sandbox','--enable-unsafe-webgpu','--enable-features=Vulkan,UseSkiaRenderer','--window-size=1468,960',url],{stdio:'ignore'});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function cdp(path,options={}){const r=await fetch(`http://127.0.0.1:${port}${path}`,options);if(!r.ok)throw Error(`${path} ${r.status}`);return r.json();}
try {
  phase='connecting'; let target;
  for(let i=0;i<100;i++){try{target=(await cdp('/json/list')).find(t=>t.type==='page');if(target?.webSocketDebuggerUrl)break;}catch{}await wait(100);}
  assert(target?.webSocketDebuggerUrl,'Chrome page target opens');
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let id=0;
  function request(method,params={}){const my=++id;ws.send(JSON.stringify({id:my,method,params}));return new Promise((res,rej)=>{const timer=setTimeout(()=>rej(Error(`CDP timeout ${method}`)),20000);function onmessage(e){const m=JSON.parse(String(e.data));if(m.id!==my)return;clearTimeout(timer);ws.removeEventListener('message',onmessage);m.error?rej(Error(m.error.message)):res(m.result);}ws.addEventListener('message',onmessage);});}
  async function evaluate(expression){const r=await request('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
  await request('Runtime.enable'); await request('Page.enable');
  phase='waiting-for-initial-emitter'; let initial=null;
  for(let i=0;i<250;i++){initial=await evaluate(`(()=>({info:document.getElementById('info-bar')?.textContent?.trim(),state:window.kaminosLocalLiquidState?.()||null,objects:window.kaminosSceneObjectDebugState?.()||[]}))()`);if(initial.info==='Scene loaded: 1 object'&&initial.state?.mounted)break;await wait(100);}
  assert.equal(initial.info,'Scene loaded: 1 object','initial saved emitter scene loaded');
  const emitterId=initial.objects[0]?.id; assert(emitterId,'initial emitter identity exists');
  lastEvidence.initial={info:initial.info,emitterId,hostEmitterIds:initial.state.emitters?.map(x=>x.id)||[],backend:initial.state.backend};
  await evaluate(`history.replaceState(null,'',location.pathname+location.search); true`);
  const listingBefore=await (await fetch(origin+'/api/browse?root=scenes&path=')).json();
  const filesBefore=new Set((listingBefore.entries||[]).map(x=>x.name));
  const base=await (await fetch(origin+'/api/read?root=scenes&path=Wateremitter_2026-09-26_14-34-15_2fa7c6667b4a42ee8a98bd3fed6fc101.kaminos.json')).json();
  const bLabel = 'Race B water emitter';
  const b={...base,environment:null,objects:(base.objects||[]).map(object=>({...object,label:bLabel}))};
  const saveBResponse=await fetch(origin+'/api/save-scene',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...b,_filename:'direct-race-B-water-emitter.kaminos.json'})});
  const bFile=(await saveBResponse.json()).saved; assert.equal(typeof bFile,'string','B fixture saved in isolated namespace');
  const ply='ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nproperty float y\nproperty float z\nend_header\n0 0 0\n';
  await evaluate(`(()=>{const original=window.fetch.bind(window);const gate={started:false,released:false,release:null};window.__directSplatRace=gate;window.fetch=(input,...args)=>{if(String(input).includes('/api/direct-overlap-delayed.ply')){gate.started=true;return new Promise(resolve=>{gate.release=()=>{gate.released=true;resolve(Promise.resolve(new Response(${JSON.stringify(ply)},{status:200,headers:{'content-type':'application/octet-stream'}})));};});}return original(input,...args);};return true;})()`);
  phase='pause-direct-splat-import-A';
  await evaluate(`(()=>{window.__directSplatPromise=window.greenroomImportSplat(${JSON.stringify(origin+'/api/direct-overlap-delayed.ply')},'old-direct.ply',{title:'Old direct splat'},{clear:false,metadata:{splat:{schema:'kaminos.splat-asset.v0',assetSource:${JSON.stringify(origin+'/api/direct-overlap-delayed.ply')},fileName:'old-direct.ply',format:'ply',correction:{},bounds:null,splatCount:null,sidecars:[],provenance:{}}}});return true;})()`);
  for(let i=0;i<100;i++){if(await evaluate('window.__directSplatRace?.started'))break;await wait(100);}
  assert.equal(await evaluate('window.__directSplatRace?.started'),true,'direct Import Splat reaches paused PLY fetch');
  phase='load-saved-emitter-B';
  await evaluate(`(()=>{const input=document.getElementById('scene-file-input');const file=new File([${JSON.stringify(JSON.stringify(b))}],${JSON.stringify(bFile)},{type:'application/json'});const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()`);
  let bState=null;
  const bStateExpression=`(()=>{const objects=window.kaminosSceneObjectDebugState?.()||[];return {info:document.getElementById('info-bar')?.textContent?.trim(),objects,liquid:window.kaminosLocalLiquidState?.()||null,matchesB:objects.some(x=>x.label===${JSON.stringify(bLabel)})};})()`;
  for(let i=0;i<300;i++){bState=await evaluate(bStateExpression);if(bState.info==='Scene loaded: 1 object'&&bState.objects.length===1&&bState.matchesB)break;await wait(100);}
  assert.equal(bState.objects[0]?.label,bLabel,'scene B-specific object identity proves the replacement load completed before stale release');
  assert.deepEqual(bState.objects.map(x=>x.id),[emitterId],'saved B is the sole scene member before stale direct import resumes');
  assert.deepEqual((bState.liquid?.emitters||[]).map(x=>x.id),[emitterId],'saved B is the sole active host emitter before stale direct import resumes');
  const beforeShot=await request('Page.captureScreenshot',{format:'png',fromSurface:true});writeFileSync(out+'/before-release.png',Buffer.from(beforeShot.data,'base64'));
  phase='release-old-direct-splat-A'; await evaluate('window.__directSplatRace.release()');
  const importResult=await evaluate('window.__directSplatPromise'); await wait(500);
  const after=await evaluate(`(()=>({info:document.getElementById('info-bar')?.textContent?.trim(),objects:window.kaminosSceneObjectDebugState?.()||[],liquid:window.kaminosLocalLiquidState?.()||null,rows:[...document.querySelectorAll('[data-scene-object-id]')].map(n=>n.dataset.sceneObjectId)}))()`);
  assert.equal(importResult,null,'superseded direct import reports discarded result');
  assert.deepEqual(after.objects.map(x=>x.id),[emitterId],'stale direct import never attaches or registers into B');
  assert.equal(after.objects.filter(x=>x.active).length,1,'selection remains the B emitter');
  assert.deepEqual((after.liquid?.emitters||[]).map(x=>x.id),[emitterId],'stale import does not change B host source identity');
  assert.deepEqual(after.rows,[emitterId],'visible scene object list remains B only');
  assert.equal(after.info,'Scene loaded: 1 object','direct import does not overwrite B load status');
  const saveResult=await evaluate('window.saveScene()'); await wait(500);
  const saveStatus=await evaluate(`document.getElementById('info-bar')?.textContent?.trim()||null`);
  const listingAfter=await (await fetch(origin+'/api/browse?root=scenes&path=')).json();
  const newFiles=(listingAfter.entries||[]).map(x=>x.name).filter(name=>!filesBefore.has(name));
  const savedFile=saveStatus?.startsWith('Scene saved: ')?saveStatus.slice('Scene saved: '.length):null;
  const saved=savedFile?await (await fetch(origin+'/api/read?root=scenes&path='+encodeURIComponent(savedFile))).json():{};
  assert.equal(savedFile,bFile,'save keeps B identity after rejected direct import');
  assert.deepEqual(saved.objects?.map(x=>x.id),[emitterId],'serialized B contains only its emitter');
  assert.equal(saved.activeObjectId,emitterId,'serialized B selection remains its emitter');
  const afterShot=await request('Page.captureScreenshot',{format:'png',fromSurface:true});writeFileSync(out+'/after-release.png',Buffer.from(afterShot.data,'base64'));
  const report={ok:true,scenario:'direct-import-splat-vs-saved-scene-replacement',requestedUrl:url,effectiveUrl:await evaluate('location.href'),route:{backend:after.liquid?.backend,requested:after.liquid?.requestedRoute,effective:after.liquid?.effectiveRoute,mounted:after.liquid?.mounted},savedB:bFile,emitterId,bLabel,oldDirectImportPaused:true,oldDirectImportReleased:true,directImportResult:importResult,releaseOrder:{sceneBCompletionLabel:bState.objects[0]?.label,assertedBeforePlyRelease:true},sceneBBeforeRelease:{objectIds:bState.objects.map(x=>x.id),labels:bState.objects.map(x=>x.label),hostEmitterIds:(bState.liquid?.emitters||[]).map(x=>x.id)},afterOldDirectImportResolved:{objectIds:after.objects.map(x=>x.id),activeObjectIds:after.objects.filter(x=>x.active).map(x=>x.id),hostEmitterIds:(after.liquid?.emitters||[]).map(x=>x.id),rows:after.rows,info:after.info},serializedB:{file:savedFile,objectIds:saved.objects.map(x=>x.id),labels:saved.objects.map(x=>x.label),activeObjectId:saved.activeObjectId},unusedNewFiles:newFiles.filter(x=>x!==bFile),evidenceScreenshots:[out+'/before-release.png',out+'/after-release.png']};
  writeFileSync(out+'/report.json',JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
} catch(error) {
  const failure={ok:false,phase,error:error?.stack||String(error),lastTrustworthyEvidence:lastEvidence};
  writeFileSync(out+'/report.json',JSON.stringify(failure,null,2)); console.error(JSON.stringify(failure,null,2)); process.exitCode=1;
} finally {try{ws?.close();}catch{}try{chrome.kill('SIGTERM');}catch{}}
