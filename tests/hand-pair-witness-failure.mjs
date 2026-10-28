// kaminos-test: node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
if (!process.execArgv.includes('--experimental-vm-modules')) {
  const result=spawnSync(process.execPath,['--experimental-vm-modules',new URL(import.meta.url).pathname],{encoding:'utf8'});
  process.stdout.write(result.stdout);process.stderr.write(result.stderr);assert.equal(result.status,0);process.exit(0);
}
const {SourceTextModule,SyntheticModule,createContext}=await import('node:vm');
const source=await readFile(new URL('../tools/hand-pair-witness.mjs',import.meta.url),'utf8');
for(const failure of ['source failure before candidate request','page/context closed','candidate fetch failed']){
 const original='2b634114dadb324802c9e55a8b7a9236f0e7b476157ac0b175f0eb258d9d276c',trained='84b3b434aaf63f77720ec4615116464ad36f85ec866268bc29e08435f86acfb1';
 let starts=0,closed=false,report,routeHandler,modelState={running:false,received:0,fingerJuice:{enabled:false},models:[{endpoint:'http://127.0.0.1:18792',identity:{checkpointSha256:original},visible:false},{endpoint:'http://127.0.0.1:18794',identity:{checkpointSha256:trained},visible:false}]};
 const update=(fields)=>{modelState={...modelState,...fields};};
 const start=()=>{
  starts++;
  if(starts===1){update({running:true,received:3,error:null,captureId:'sample',sourceImage:{captureId:'sample'}});modelState.models.forEach(m=>m.visible=true);}
  if(starts===2){update({running:false,received:0,error:'witness_candidate_failure',camera:null});modelState.models.forEach(m=>m.visible=false);}
  if(starts===3){
   update({running:false,received:0,error:failure==='candidate fetch failed'?null:failure,camera:null});
   if(failure==='candidate fetch failed')Promise.resolve().then(()=>routeHandler({fetch:async()=>{throw Error(failure);},abort:async()=>{}}));
  }
 };
 const page={on(){},addInitScript:async()=>{},goto:async()=>{},
  request:{get:async()=>({json:async()=>({source:{}})})},
  getByRole:()=>({click:async()=>start()}),
  locator:()=>({count:async()=>1,getAttribute:async name=>name==='src'?'data:image/jpeg;base64,jpeg':'sample'}),
  waitForFunction:async()=>{if(starts===3&&failure==='page/context closed')throw Error(failure);if(starts===3&&failure==='candidate fetch failed')await new Promise(()=>{});},
  screenshot:async()=>{},route:async(url,handler)=>{routeHandler=handler;},unroute:async()=>{},
  evaluate:async(fn)=>{
   const code=String(fn);
   if(code.includes("invoke('start')")){start();return structuredClone(modelState);}
   if(code.includes("invoke('stop')")){update({running:false,camera:null});return structuredClone(modelState);}
   if(code.includes("objectStore('captures').getAll()"))return [{captureId:'sample',request:{image:'jpeg'},outcome:{state:'computed',results:[{captureId:'sample',cropBox:[0,0,1,1],identity:{checkpointSha256:original}},{captureId:'sample',cropBox:[0,0,1,1],identity:{checkpointSha256:trained}}]}}];
   return structuredClone(modelState);
  }};
 const context=createContext({console,URL,Promise,process:{exitCode:0},Buffer});
 const synthetic=async exports=>{const m=new SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;};
 const imports={
  'node:assert/strict':{default:assert},
  'node:util':{parseArgs:()=>({values:{url:'http://127.0.0.1:18547/',fixture:'fixture',browser:'isolated-test-browser',playwright:'fake-playwright',output:'output'}})},
  'node:fs/promises':{mkdir:async()=>{},writeFile:async(path,data)=>{if(path.endsWith('/report.json'))report=JSON.parse(data);}},
  'node:path':{resolve:p=>p},'node:url':{pathToFileURL:p=>p},
 };
 const browser=await synthetic({chromium:{launchPersistentContext:async()=>({newPage:async()=>page,close:async()=>{closed=true;}})}});
 const script=new SourceTextModule(source,{context,importModuleDynamically:async()=>browser});
 await script.link(name=>synthetic(imports[name]));
 const outcome=await Promise.race([script.evaluate().then(()=> 'settled'),new Promise(resolve=>setTimeout(()=>resolve('hung'),100))]);
 assert.equal(outcome,'settled',failure+' must terminate the actual witness');
 assert.equal(report.status,'failed');assert.equal(report.phase,'stop_in_flight');assert.match(report.error,new RegExp(failure.replace('/','\\/')));
 assert.equal(closed,true);assert.equal(report.browserClosed,true);assert.equal(context.process.exitCode,1);
}
console.log('hand pair witness: source failure and page closure terminate with report and cleanup');
