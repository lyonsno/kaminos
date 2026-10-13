// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {assertJoinedPreview} from '../tools/joined-preview-contract.mjs';
import vm from 'node:vm';
test('restart settles a failed step, disposes it and attempts a new generation',async()=>{
  const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{value:id==='fine'||id==='coarse'?'32':'0',checked:false});return elements.get(id);};
  let disposed=0,replacements=0;
  const context=vm.createContext({document:{getElementById:element},window:{requestAnimationFrame(){},addEventListener(){}},fetch:async()=>({}),THREE:{PerspectiveCamera:class{position={set(){}};lookAt(){}},Vector3:class{}},createKaminosVolumePrototype(){replacements++;throw Error('replacement reached');}});
  const source=readFileSync('tools/joined-flame-preview-browser.mjs','utf8').replace(/^import .*;\n/gm,'').replace('await rebuild();nextFrame(loop);','');
  vm.runInContext(source+`;globalThis.restartProbe=async()=>{inFlight=Promise.reject(Error('original step failed'));await inFlight.catch(()=>{});active={device:{queue:{onSubmittedWorkDone:async()=>globalThis.disposed()}},bridges:[],solver:{destroy(){}},target:{destroy(){}},lower:{destroy(){}},outer:{destroy(){}},p:{dispose(){}}};await rebuild();return {generation,error:evidence.error};};`,context);
  context.disposed=()=>disposed++;
  const result=await context.restartProbe();assert.equal(disposed,1);assert.equal(result.generation,1);assert.equal(replacements,1);assert.match(result.error,/replacement reached/);
});
test('bootstrap records dependency failures before the imported module can run',()=>{
  const html=readFileSync('tools/joined-flame-preview.html','utf8');
  const bootstrap=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert(bootstrap,'pre-module bootstrap missing');
  const events={},error={textContent:''},context=vm.createContext({window:{addEventListener:(name,fn)=>events[name]=fn},document:{getElementById:()=>error},fetch:()=>Promise.resolve({})});
  vm.runInContext(bootstrap,context);events.error({message:'failed module import'});
  assert.equal(context.window.joinedPreview.phase,'failed');assert.match(context.window.joinedPreview.error,/failed module import/);assert.match(error.textContent,/failed module import/);
});
test('CDP calls after close reject immediately and failed sends leave no pending request',async()=>{
  const source=readFileSync('tools/joined-material-consumer-capture.mjs','utf8').match(/^const call=.*$/m)[0];
  const socket={readyState:3,send(){}};const context=vm.createContext({ws:socket,WebSocket:{OPEN:1},Error});
  vm.runInContext('let serial=0;const pending=new Map();'+source+';globalThis.invoke=call;globalThis.count=()=>pending.size;',context);
  let outcome='pending';context.invoke('Runtime.evaluate').then(()=>outcome='resolved',()=>outcome='rejected');await new Promise(resolve=>setImmediate(resolve));assert.equal(outcome,'rejected');assert.equal(context.count(),0);
  socket.readyState=1;socket.send=()=>{throw Error('send failed');};await assert.rejects(context.invoke('Runtime.evaluate'),/send failed/);assert.equal(context.count(),0);
});
test('a converged joined solve cannot pass as a visible flame with a blank frame',()=>{
  const state={phase:'running',effective:{fine:[32,32,32]},coarse:[32,64,32],roof:false,backend:'WebGPU:apple',frame:{meanLuma:0,litPixels:0}};
  assert.throws(()=>assertJoinedPreview(state,{fine:[32,32,32],coarse:[32,64,32],roof:false}),/blank/);
});
test('preview admission rejects missing source controls, stale generations and fallback routes',()=>{
  const expected={fine:[32,32,32],coarse:[32,64,32],roof:false};
  const state={phase:'running',effective:{fine:[32,32,32],physicalColor:{effective:'emissive-transport-v2'},ghostGeneration:64},coarse:[32,64,32],roof:false,backend:'WebGPU:apple',frame:{meanLuma:1,litPixels:42},controls:{curl:0,emitterSourceLaw:'immersed-source'},steps:64,gpuErrors:[],pressure:{breakdown:false,maxDivergenceError:.0009}};
  assert.doesNotThrow(()=>assertJoinedPreview(state,expected));
  for(const mutate of [s=>delete s.controls.curl,s=>s.effective.ghostGeneration=63,s=>s.backend='fallback',s=>s.effective.physicalColor.effective='legacy',s=>s.frame=null,s=>s.pressure.maxDivergenceError=.002,s=>s.coarse=[16,32,16],s=>s.phase='failed']){
    const bad=structuredClone(state);mutate(bad);assert.throws(()=>assertJoinedPreview(bad,expected));
  }
});
test('interactive joined preview serves explicit roots and names diagnostic scheduling',async()=>{
  const out=mkdtempSync(join(tmpdir(),'joined-preview-test-'));
  const child=spawn(process.execPath,['tools/joined-material-consumer-capture.mjs',resolve('.'),resolve('.'),out,'','', 'preview'],{stdio:['ignore','pipe','pipe']});
  try{
    const address=await new Promise((accept,reject)=>{let text='';child.stdout.on('data',b=>{text+=b;for(const line of text.split('\n')){try{const r=JSON.parse(line);if(r.preview)accept(r.url);}catch{}}});child.on('error',reject);child.on('exit',()=>reject(Error('preview never listened: '+readFileSync(join(out,'report.json'),'utf8'))));});
    const page=await(await fetch(address)).text();
    assert.match(page,/joined-flame-preview-browser.mjs/);
    assert.match(page,/Diagnostic/);
    const source=await fetch(new URL('/fine/volume-core.js',address));assert.equal(source.status,200);
    const missing=await fetch(new URL('/unknown/path',address));assert.equal(missing.status,404);
    const report=JSON.parse(readFileSync(join(out,'report.json')));assert.equal(report.phase,'interactive-listener');assert.equal(report.status,'serving-unverified');
  }finally{child.kill();}
});
