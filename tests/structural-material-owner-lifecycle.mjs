import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {openExperiment} from '../workbench-experiments.mjs';
import definition from '../experiments/stone/stone-fracture.experiment.mjs';
import {createStoneOwnerHost} from '../structural-material-owner-host.mjs';
import {openStoneOwnerExperiment} from '../structural-material-owner-entry.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};
function producer(){
 const state={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',backend:'webgpu',adapterFallback:false,connectivity:'elastic-support',runId:'native-fixture',submittedSteps:0,paused:true,threshold:180,failure:null};
 return {state,experimentStatus:()=>({...state}),threshold:value=>{state.threshold=value;},pause:value=>{state.paused=value;},waitSubmitted:async()=>{},advance:async()=>{state.submittedSteps++;},release:async()=>{},reportFailure(){},reset:async()=>{},camera(){},pick:async()=>({status:'applied'}),move(){},settle:async()=>{},witness:()=>({})};
}
function controls({missingThreshold=false,lateThrow=false}={}){
 const nodes=Object.fromEntries(['reset','release','pause','threshold'].map(id=>[id,{onclick(){},oninput(){}}]));
 const originals=Object.fromEntries(Object.entries(nodes).map(([id,node])=>[id,{onclick:node.onclick,oninput:node.oninput}]));
 if(lateThrow){let handler=nodes.threshold.oninput;Object.defineProperty(nodes.threshold,'oninput',{get:()=>handler,set(value){if(value!==originals.threshold.oninput)throw Error('Late mount refusal');handler=value;}});}
 if(missingThreshold)delete nodes.threshold;
 return {nodes,originals,document:{getElementById:id=>nodes[id]??null}};
}
test('actual producer supersession never records an applied owner grip',async()=>{
 const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),gate=deferred();let captures=0;
 const ctx={failure:null,pieces:[{id:0,binding:{},geometry:{indices:[]}}],bounded:true,residentGrip:{begin:async()=>{captures++;}},boundedCellAnchor:()=>0,gestureGeneration:0,gesture:null,pendingPick:false,controls:{enabled:true},marker:{position:{fromArray(){}},visible:false},arrow:{visible:false},configuration:{patchRadius:.28,gripStiffness:200000},settle:()=>gate.promise,busy:false,stamp(){},invalidateMaterialObservation(){},resident:{release:async()=>{}},pointerContact:null,lastPick:null};
 vm.runInNewContext(source.slice(source.indexOf('async function beginPick('),source.indexOf('async function finishGesture('))+source.slice(source.indexOf('async function release('),source.indexOf('async function cutInterior(')),ctx);
 const api=producer();api.pick=ctx.beginPick;api.release=ctx.release;api.experimentStatus=()=>({...api.state,gripping:ctx.gesture?.phase??null});
 const records=[],entry=await openExperiment(definition,{host:createStoneOwnerHost(api),record:value=>records.push(value)});
 const grip=entry.invoke('grip',{pieceId:0,faceIndex:0,point:[0,0,0]});
 await new Promise(resolve=>setImmediate(resolve));await entry.invoke('release');gate.resolve();
 await assert.rejects(grip,/superseded|cancelled/);assert.equal(captures,0);
 assert.ok(records.some(row=>row.kind==='stone.grip'&&row.phase==='cancelled'));assert.ok(!records.some(row=>row.kind==='stone.grip'&&row.phase==='applied'));
 await entry.dispose();
});
test('normal grip retains its applied receipt',async()=>{
 const api=producer(),records=[];const entry=await openExperiment(definition,{host:createStoneOwnerHost(api),record:value=>records.push(value)});
 await entry.invoke('grip',{pieceId:0,faceIndex:0,point:[0,0,0]});assert.equal(records.at(-1).phase,'applied');await entry.dispose();
});
test('entry disposal waits for pending step and retains its outcome before finishing',async()=>{
 const api=producer(),ui=controls(),entered=deferred(),gate=deferred();let advances=0,completed=false;
 api.advance=async()=>{entered.resolve();await gate.promise;advances++;api.state.submittedSteps++;};
 const entry=await openStoneOwnerExperiment(api,{document:ui.document,source:{kind:'fixture'}});
 const step=entry.invoke('step',2);await entered.promise;const disposal=entry.dispose().then(()=>{completed=true;});
 await new Promise(resolve=>setImmediate(resolve));assert.equal(completed,false,'Disposal ended while its step was pending');
 gate.resolve();await step;await disposal;const atDisposal=advances;await new Promise(resolve=>setImmediate(resolve));assert.equal(advances,atDisposal);assert.equal(advances,2);
 const recording=entry.recording();assert.equal(recording.status,'finished');assert.ok(recording.operations.some(row=>row.kind==='stone.step'&&row.phase==='applied'&&row.effective.submittedSteps===2));
});
test('failed partial mount restores all prior native handlers',async()=>{
 for(const options of [{missingThreshold:true},{lateThrow:true}]){
  const api=producer(),ui=controls(options);await assert.rejects(openStoneOwnerExperiment(api,{document:ui.document,source:{kind:'fixture'}}));
  for(const [id,node] of Object.entries(ui.nodes)){assert.equal(node.onclick,ui.originals[id].onclick,id);assert.equal(node.oninput,ui.originals[id].oninput,id);}
 }
});
