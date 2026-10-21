// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile),scratch=fs.mkdtempSync(path.join(os.tmpdir(),'kaminos-contact-mode-'));
const mock=path.join(scratch,'browser.mjs');
// Fault injection at the effective browser-control boundary. This fixture
// tests admission policy only; it supplies no native rendering evidence.
fs.writeFileSync(mock,`import fs from 'node:fs';
let state={steps:0,frame:0,motion:false,physical:true,clock:{timeStep:1/60},clip:{fps:30,frames:60},volume:{steps:0,minJ:1,volumeRatio:1,maxDisplacement:0},body:{vertices:3,triangles:1},deformer:{backend:'webgpu-dense-dq',physicalBackend:'cpu-tetrahedral-local-energy',allInfluences:true,dispatches:1,pending:false},source:{caseSha256:'case'},preparedSha256:'prepared'};
globalThis.requestAnimationFrame=fn=>queueMicrotask(fn);
globalThis.window={kaminosWorkbenchExperiments:{state:()=>({id:'creature-flesh/contact'}),async invoke(op,v){if(op==='motion'&&process.env.CONTACT_MODE!=='noop')state.motion=v;if(op==='replay'){state.steps=state.frame=0;}if(op==='advance'){state.steps++;state.volume.steps++;state.deformer.dispatches++;if(state.motion&&process.env.CONTACT_MODE!=='frozen')state.frame=Math.min(59,Math.floor(state.steps/60*30));}}},kaminosCreatureFlesh:{read:()=>structuredClone(state),physicalState:()=>({points:[],offsets:[]}),geometry:()=>({attributes:{position:{array:new Float32Array(9)}}}),gpu:async()=>({positions:new Float32Array(9),layout:'vec4',backend:'webgpu-dense-dq'})}};
const screenshot=async({path})=>fs.writeFileSync(path,'synthetic-control-fixture-not-native-image');
const page={on(){},goto:async()=>{},waitForFunction:async()=>{},evaluate:async(fn,arg)=>fn(arg),screenshot,locator:()=>({screenshot,textContent:async()=>''})};
export const chromium={launchPersistentContext:async()=>({setDefaultTimeout(){},pages:()=>[page],close:async()=>{}})};`);
const server=http.createServer((request,response)=>{response.setHeader('Content-Type','application/json');response.end(JSON.stringify({source:{repoRoot:scratch,commit:'fixture',dirty:false}}));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
try{
 for(const variant of ['noop','frozen','correct']){
  const out=path.join(scratch,variant),args=['tools/creature-flesh-witness.mjs','--out',out,'--url',`http://127.0.0.1:${server.address().port}/`,'--mode','motion','--browser',process.execPath,'--playwright',mock,'--root',scratch,'--revision','fixture','--case-sha','case','--prepared-sha','prepared'];
  let code=0;try{await run(process.execPath,args,{env:{...process.env,CONTACT_MODE:variant}});}catch(e){code=e.code;}
  const report=JSON.parse(fs.readFileSync(path.join(out,'report.json')));
  if(variant==='correct'){assert.equal(code,0);assert.equal(report.status,'passed');assert.equal(report.frames.length,180);assert.equal(report.final.frame,59);}
  else{assert.equal(code,1);assert.equal(report.status,'failed');assert.match(report.failure.message,/motion mode|frame mismatch/);assert.equal(report.failure.phase,'contact-stroke');}
  assert.equal(report.browserClosed,true);
 }
}finally{await new Promise(resolve=>server.close(resolve));}
console.log('actual witness refuses no-op and frozen moving controls, admits retained clip terminal hold (synthetic policy fixture)');
