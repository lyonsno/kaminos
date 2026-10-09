import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
const source=text.slice(text.indexOf('async function beginPick('),text.indexOf('function ray('));
const point=[0,0,0],mesh={positions:[point],tetrahedra:[],domains:[]};
async function exercise(candidateFault='support'){
 const log=[],held={generation:1,phase:'active',pieceId:0,component:0,point,patch:[{index:0,weight:1}],displacement:[.1,0,0],baselineDisplacement:[0,0,0]};
 const live={runId:'retained',steps:1,model:{points:1},state:Array(16).fill(0),bonds:[],stresses:[{active:true,invalid:false}]};
 const retained={step:async()=>({totalMilliseconds:1}),read:async()=>live,movePatch:async()=>log.push('move'),capturePatch:async()=>log.push('capture'),release:async()=>log.push('release'),dispose:()=>log.push('live-disposed')};
 const candidate={read:async()=>{if(candidateFault==='device')throw new Error('GPU device lost');return {...live,runId:'candidate',stresses:[{active:true,invalid:true}]};},dispose:()=>log.push('candidate-disposed')};
 const status={textContent:''},other={textContent:'',value:18};let proposals=0;
 const ctx={performance,crypto,device:{},interiorSplit:true,gesture:held,gestureGeneration:1,failure:null,busy:false,paused:false,pendingPick:false,finishing:false,pickTask:Promise.resolve(),resident:retained,observed:live,
  body:{...mesh},pieces:[{id:0,component:0,nodes:[0]}],components:[0],volumes:[1],interiorState:{epoch:0,mesh,nodeDomains:[0],transfers:[]},initialBody:{geometry:{}},materialRegime:null,configuration:{patchRadius:1,gripStiffness:1,volumeBarrier:400},manifest:{material:{density:1}},events:[],timings:[],latestSelection:null,lastPick:null,
  positions:()=>[point],contactPatch:()=>[{index:0,weight:1}],materialComponents:()=>[0],selectStressRelease:()=>({normal:[1,0,0],offset:0}),
  splitMaterialInterior:()=>{proposals++;return {mesh,fields:{positions:[point],velocities:[point],pinned:[false]},receipt:{route:'fixture',volumeBefore:1,volumeAfter:1}};},
  prepareSeparatedTopology:()=>({positions:[point],elements:[],bonds:[],constitutiveLayout:'fixture',bufferLayout:{},colorCount:1}),packSolidTopology:()=>({state:new Float32Array(16)}),createSolidResident:async()=>candidate,
  surface:{interiorChildren:()=>[1,2],stageInteriorCut:()=>{throw new Error('Invalid candidate reached publication');}},
  stamp:(kind,data)=>log.push({kind,data}),fail:e=>{ctx.failure={message:e.message};ctx.gesture=null;ctx.controls.enabled=true;},present:()=>log.push('present'),observeSurface:async()=>log.push('surface-observation'),$:id=>id==='failure'?status:other,settle:async()=>{},controls:{enabled:false},marker:{position:{fromArray(){}},visible:true},arrow:{visible:true}};
 vm.runInNewContext(source,ctx);
 if(candidateFault==='device'){await assert.rejects(ctx.advance(),/GPU device lost/);assert.equal(ctx.failure.message,'GPU device lost');return;}
 await assert.doesNotReject(ctx.advance(),'A rejected candidate must not latch a failure of the retained material');
 assert.equal(ctx.failure,null);assert.equal(ctx.resident,retained);assert.equal(ctx.observed,live);assert.equal(ctx.interiorState.epoch,0);assert.equal(ctx.events.length,0);
 assert.equal(ctx.interiorState.lastFailedCut.candidateState.runId,'candidate');assert.ok(log.includes('candidate-disposed'));assert.ok(!log.includes('live-disposed'));
 assert.equal(ctx.gesture,held);assert.equal(ctx.controls.enabled,false);assert.match(status.textContent,/Cut declined/);
 await ctx.advance();assert.equal(proposals,1,'A refused gesture must not rebuild the same invalid candidate every frame');
 await ctx.finishGesture();assert.equal(ctx.failure,null);assert.equal(ctx.gesture,null);assert.equal(ctx.controls.enabled,true);
 await ctx.beginPick(0,point);assert.equal(ctx.gesture.phase,'active');assert.equal(ctx.controls.enabled,false);assert.equal(ctx.failure,null);
 await ctx.advance();assert.equal(proposals,2,'A later grip must be allowed to propose a new fracture');
 assert.ok(log.some(v=>v.kind==='interior-cut-declined'));
}
await exercise();await exercise('device');
console.log('Actual view refuses invalid candidate without losing retained material, release or later grip; device errors remain fatal. Synthetic lifecycle contract, not native GPU coverage.');
