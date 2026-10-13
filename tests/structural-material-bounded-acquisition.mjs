import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {materialComponents} from '../structural-material-solid-surface.mjs';
import {stoneObservationStamp,validateStoneObservationStamp} from '../structural-material-observation-economics.mjs';
const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
const begin=source.slice(source.indexOf('async function beginPick('),source.indexOf('async function finishGesture(')),release=source.slice(source.indexOf('async function release('),source.indexOf('async function cutInterior('));
const pairs=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]],state={runId:'run',steps:1,model:{points:4,elements:1,bonds:6},state:Array(64).fill(0),bonds:pairs.flatMap(p=>[...p,0,0]),grip:null,observation:{kind:'full-diagnostic'}};
const settleCode=source.slice(source.indexOf(' api.settle='),source.indexOf(" if(parameters.get('smoke')",source.indexOf(' api.settle=')));
test('actual explicit settle publishes acquired topology',async()=>{
const acquired={window:{__stoneShards:{}},observed:{...state,bonds:pairs.flatMap(p=>[...p,1,0])},components:[0,0,0,0],busy:false,settle:async()=>{},resident:{read:async()=>state},materialComponents,observeSurface:async()=>{},observeInteraction:async()=>{},shown:[],present(){acquired.shown.push([...acquired.components]);}};
acquired.api=acquired.window.__stoneShards;
acquired.elasticSupport=false;vm.runInNewContext(source.slice(source.indexOf('function acquiredConnections('),source.indexOf('\nfunction deformPiece(')),acquired);
vm.runInNewContext(settleCode+';task=window.__stoneShards.settle({surface:false});',acquired);await acquired.task;
assert.deepEqual(acquired.shown[0],[0,1,2,3],'Acquired display must publish acquired, not cached, topology');
});
test('paused capture and release invalidate acquired diagnostics',async()=>{
const route='kaminos.picked-stone.bounded-shards.webgpu.v0',ctx={failure:null,bounded:true,pieces:[{id:0,geometry:{indices:[0,1,2]},binding:{}}],observed:structuredClone(state),residentGrip:{route:'resident',begin:async()=>{}},resident:{release:async()=>{}},boundedCellAnchor:()=>1,gestureGeneration:0,controls:{enabled:true},marker:{position:{fromArray(){}},visible:false},arrow:{visible:false},configuration:{patchRadius:.3,gripStiffness:1000},settle:async()=>{},stamp(){},surfaceObservation:{old:true},interactionObservation:{old:true}};
const helperStart=source.indexOf('function invalidateMaterialObservation(');if(helperStart>=0)vm.runInNewContext(source.slice(helperStart,source.indexOf('\nasync function',helperStart)),ctx);
vm.runInNewContext(begin+';task=beginPick(0,[0,0,0],0);',ctx);await ctx.task;
const stamp=()=>stoneObservationStamp({route,state:ctx.observed,resourceVersion:'run',paused:true,busy:false,pendingPick:false,finishing:false,failure:null});
const picked=await stamp();assert.throws(()=>validateStoneObservationStamp(picked),/stamp/,'Paused capture is not an acquired diagnostic state');
ctx.observed=structuredClone(state);ctx.observed.grip={index:-3,anchor:1};
vm.runInNewContext(release+';task=release();',ctx);await ctx.task;const released=await stamp();assert.throws(()=>validateStoneObservationStamp(released),/stamp/,'Paused release must also invalidate');
ctx.observed=structuredClone(state);validateStoneObservationStamp(await stamp());
});
