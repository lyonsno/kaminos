import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {cdpRequest} from '/private/tmp/kaminos-sinter-local48-0930/artifacts/sinter-authored-mesh-smoke-0923/diagnostic-cdp.mjs';
const out='/private/tmp/kaminos-sinter-local48-0930/artifacts/sinter-authored-mesh-smoke-0923/local48-temporal-0930';
mkdirSync(out,{recursive:true});
const report={status:'running',sourceCommit:'8981eb9b30a584ea09992c1ed5307949de05803e',repoRoot:'/private/tmp/kaminos-sinter-local48-0930',browser:{executable:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,pid:93076},frames:[],errors:[]};
const save=()=>writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));
save();
let ws;
try {
 const targets=await(await fetch('http://127.0.0.1:43991/json/list')).json();
 ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
 await new Promise(r=>ws.addEventListener('open',r,{once:true}));
 await cdpRequest(ws,'Runtime.enable');
 await cdpRequest(ws,'Page.bringToFront');
 ws.addEventListener('message',e=>{const m=JSON.parse(String(e.data));if(m.method==='Runtime.exceptionThrown')report.errors.push(m.params.exceptionDetails);});
 await cdpRequest(ws,'Page.reload',{ignoreCache:true});
 for(const [name,steps] of [['early',10],['late',600]]) {
  let state;
  const end=Date.now()+180000;
  do {
   const r=await cdpRequest(ws,'Runtime.evaluate',{expression:`(() => { const s=window.__kaminosVolumePrototype?.debugState?.(); if(!s)return null; return {url:location.href,backend:s.backend,grid:s.simGrid,effectiveRoute:s.effectiveRoute,assembly:s.gpuStructuralCombustionAssembly,source:s.combustibleObjectSource,sceneStatus:document.getElementById('info-bar')?.textContent,basin:window.__kaminosDefaultVolumeSmokeBasin?.presetId}; })()`,returnByValue:true});
   state=r.result?.value;
   if(state?.assembly?.dispatchCount>=steps)break;
   if(Date.now()>end)throw Error(`No ${name} frame: ${JSON.stringify(state)}`);
   await delay(50);
  } while(true);
  assert.equal(state.backend,'WebGPU:apple');assert.equal(Number(state.grid),48);
  assert.equal(state.assembly.meshTriangleCount,864);assert.equal(state.assembly.runtimeReadbackCount,0);
  assert.equal(state.source.sameDevice,true);assert.match(state.sceneStatus,/Scene loaded: 1 object/);
  assert.equal(state.basin,'vsp-13e22642e71f4ac8f758fae803a83110577ecc6d7ef9f233411e096af8e9097b');
  if(name==='early')assert.ok(state.assembly.dispatchCount<120,'early capture missed the uncharred interval');
  const image=await cdpRequest(ws,'Page.captureScreenshot',{format:'png',fromSurface:true});
  writeFileSync(`${out}/${name}.png`,Buffer.from(image.data,'base64'));
  report.frames.push({name,state,image:`${out}/${name}.png`});save();
 }
 assert.deepEqual(report.errors,[]);report.status='captured-inspection-required';
}catch(e){report.status='failed';report.error=String(e.stack);process.exitCode=1;}
finally{ws?.close();save();console.log(JSON.stringify({status:report.status,frames:report.frames.map(f=>({name:f.name,dispatches:f.state.assembly.dispatchCount})),out}));}
