// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const begin=html.indexOf('async function showGLB('),end=html.indexOf('// Scene-session owners borrow',begin);
function fixture(){
 let release;const gate=new Promise(r=>release=r),events=[];let generation=1;
 const model={userData:{},traverse(){}};
 const ctx={URL,AbortController,window:{location:{origin:'http://localhost'}},workingScene:{get generation(){return generation;}},
  sceneLightingPreparation:{whenIdle(){events.push('lighting');return gate;}},shouldClearSceneForImport:()=>false,resolveAssetArrivalMode:()=>null,
  loadingTelemetry:{start(){events.push('feedback');return {token:1};},progress(){},complete(){events.push('complete');},cancel(){events.push('cancel');},fail(){events.push('failed');}},
  readAssetBytes:async(file)=>{events.push('bytes');return file.arrayBuffer();},
  GLTFLoader:class{constructor(){events.push('loader');}load(url,done){queueMicrotask(()=>done({scene:model}));}async parseAsync(){events.push('parse');return{scene:model};}},
  glbFileName:null,modelSourceUrl:null,modelSourceType:null,glbSourceScene:null,greenroomPreviewIsActive:()=>false,
  sceneEnvironment:{read:()=>({intensity:1})},applyAssetArrival:()=>null,scene:{add(){events.push('scene-add');}},
  registerSceneObject:()=>({id:'added'}),document:{getElementById:()=>({classList:{add(){}}})},setInfo(){},disposeObjectTree(){events.push('dispose');},
 };
 vm.createContext(ctx);vm.runInContext(html.slice(begin,end),ctx);
 const file=new File([new ArrayBuffer(12)],'asset.glb');
 return{ctx,events,file,release,show:ctx.showGLB,change(){generation++;}};
}
test('actual GLB page path acknowledges and reads bytes before lighting releases; parsing waits',async()=>{
 const f=fixture();const loading=f.show(f.file,{clear:false});await new Promise(r=>setImmediate(r));
 assert.ok(f.events.includes('feedback'),'acknowledge before the lighting wait');
 assert.ok(f.events.includes('bytes'),'read file while lighting owns renderer');assert.ok(!f.events.includes('loader'));
 f.release();await loading;assert.ok(f.events.indexOf('parse')>f.events.indexOf('lighting'));assert.ok(f.events.includes('complete'));
});
test('actual GLB path rejects a scene change during byte acquisition without publication',async()=>{
 const f=fixture();const loading=f.show(f.file,{clear:false});f.change();f.release();await assert.rejects(loading,/stale|changed/i);assert.ok(!f.events.includes('scene-add'));
});

test('late progress/failure/completion from an old asset cannot overwrite the current operation',async()=>{
 const {createLoadingTelemetryTracker}=await import('../asset-arrival.mjs');const tracker=createLoadingTelemetryTracker();const old=tracker.start('asset',{label:'Old'});tracker.start('asset',{label:'Current'});
 tracker.progress('asset',{token:old.token,label:'Old',phase:'decoding'});assert.equal(tracker.read().primary.label,'Current');
 tracker.fail('asset',Error('old failure'),{token:old.token});assert.equal(tracker.read().primary.label,'Current');assert.equal(tracker.read().lastFailed,null);
 tracker.complete('asset',{token:old.token});assert.equal(tracker.read().primary.label,'Current');
});

test('byte reader preserves all streamed bytes, forwards cancellation, and rejects HTTP errors',async()=>{
 const {readAssetBytes}=await import('../asset-input-preparation.mjs');const controller=new AbortController(),updates=[];let seenSignal;
 const bytes=await readAssetBytes('/mesh.glb',{signal:controller.signal,progress:p=>updates.push(p),fetch:async(url,options)=>{seenSignal=options.signal;return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3,4,5]));c.close();}}),{headers:{'content-length':'5'}});}});
 assert.equal(seenSignal,controller.signal);assert.deepEqual([...new Uint8Array(bytes)],[1,2,3,4,5]);assert.equal(updates.at(-1).loadedBytes,5);assert.equal(updates.at(-1).totalBytes,5);
 await assert.rejects(readAssetBytes('/missing',{fetch:async()=>new Response('missing',{status:404})}),/HTTP 404/);
});
test('Assets page callback carries downloaded bytes into persistent import without another file read',async()=>{
 const begin=html.indexOf('addMesh:async entry=>{'),end=html.indexOf('\n    }});',begin);let passed,fetches=0;
 const bytes=new ArrayBuffer(24),ctx={File,loadingTelemetry:{start:()=>({token:7}),progress(){},fail(){}},readAssetBytes:async()=>{fetches++;return bytes;},importSceneMesh:async(file,options)=>{passed=options;return 'inserted';}};
 vm.createContext(ctx);const add=vm.runInContext('('+html.slice(begin,end).replace('addMesh:','')+'})',ctx);
 assert.equal(await add({kind:'mesh',name:'asset.glb',source:'/api/read?root=generated-meshes&path=a.glb'}),'inserted');assert.equal(fetches,1);assert.equal(passed.bytes,bytes);assert.equal(passed.telemetryOp.token,7);
});


test('GLB publication waits for off-thread geometry and rejects a stale prepared root',async()=>{
 for(const stale of [false,true]){
  const f=fixture();let finish;const gate=new Promise(r=>finish=r);
  f.ctx.resolveAssetArrivalMode=()=> 'append';
  f.ctx.prepareGLBGeometryArrival=async()=>{f.events.push('geometry-worker');await gate;return {placement:{scale:1},bounds:{min:[0,0,0],max:[1,1,1]}};};
  const loading=f.show(f.file,{clear:false});f.release();await new Promise(r=>setImmediate(r));
  assert.ok(f.events.includes('geometry-worker'),'actual loader must invoke geometry preparation');
  assert.ok(!f.events.includes('scene-add'),'unprepared root must not publish');
  if(stale)f.change();finish();
  if(stale){await assert.rejects(loading,/stale/);assert.ok(!f.events.includes('scene-add'));assert.ok(f.events.includes('dispose'));}
  else{await loading;assert.ok(f.events.includes('scene-add'));}
 }
});
