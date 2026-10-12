import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {stoneObservationStamp,validateStoneObservationStamp,reconstructStoneObservation} from '../structural-material-observation-economics.mjs';
const source=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8');
const start=source.indexOf('  witness('),end=source.indexOf('\n  pixels()',start);
assert.ok(start>0&&end>start);
const piece={id:0,geometry:{properties:[0,0,0],indices:[0]},binding:{route:'fixed'},mesh:{geometry:{attributes:{position:{array:[0,0,0]}}}}};
const ctx={synchronizePicking(){},route:'bounded',failure:null,adapter:{info:{}},affineComparison:false,surfaceObservation:null,observed:{runId:'run',steps:0},manifest:{},materialRegime:null,configuration:{},$:()=>({value:180}),interiorSplit:false,interiorState:null,cameraState:()=>({}),gesture:null,lastPick:null,events:[],pieces:[piece],inputs:[],timings:[],frames:1,paused:true,structuredClone};
vm.runInNewContext('api={'+source.slice(start,end)+'};result=api.witness({resources:false});',ctx);
assert.equal('geometry' in ctx.result.pieces[0],false,'Dynamic acquisition must not transfer unchanged geometry');
assert.equal('binding' in ctx.result.pieces[0],false,'Dynamic acquisition must not transfer unchanged ownership');
assert.equal(ctx.result.pieces[0].renderedPositions.length,3,'Complete changing surface is retained');
vm.runInNewContext('full=api.witness();',ctx);
assert.deepEqual(ctx.full.pieces[0].geometry,piece.geometry,'Existing full witness remains compatible');
console.log('Dynamic transfer excludes immutable geometry; old witness stays complete');
const data={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',state:{runId:'run',steps:2,state:[0,1],bonds:[0,1,1,0],damageEpoch:0},resourceVersion:'run',paused:true,busy:false,pendingPick:false,finishing:false,failure:null,configuration:{iterations:12},camera:{position:[0,0,2]},viewport:{width:800},gesture:{displacement:[0,0,0]},inputs:[],events:[],timings:[],threshold:180};
const first=await stoneObservationStamp(data);validateStoneObservationStamp(first);
assert.deepEqual(await stoneObservationStamp(structuredClone(data)),first);
for(const mutate of [d=>d.state.state[0]=.1,d=>d.state.bonds[2]=0,d=>d.state.steps++,d=>d.state.damageEpoch++,d=>d.camera.position[0]++,d=>d.viewport.width++,d=>d.configuration.iterations++,d=>d.gesture.displacement[0]++,d=>d.gesture=null,d=>d.inputs.push({kind:'release'}),d=>d.events.push({id:'cut'}),d=>d.timings.push({total:1}),d=>d.threshold++,d=>d.paused=false,d=>d.busy=true,d=>d.pendingPick=true,d=>d.finishing=true,d=>d.failure={message:'lost'},d=>d.state.runId='reset']){
 const changed=structuredClone(data);mutate(changed);assert.notEqual((await stoneObservationStamp(changed)).digest,first.digest,'Relevant dynamic mutation must invalidate stamp');
}
for(const patch of [{paused:false},{busy:true},{pendingPick:true},{finishing:true},{failure:{}},{route:'fallback'},{resourceVersion:'old'},{digest:''}])assert.throws(()=>validateStoneObservationStamp({...first,...patch}),/stamp/);
const dynamic={runId:'run',pieces:[{id:0,renderedPositions:[1,2,3]}]},resource={schema:'stone-observation-resource-v1',version:'run',pieces:[{id:0,geometry:piece.geometry,binding:piece.binding}]};
assert.deepEqual(reconstructStoneObservation(dynamic,resource).pieces[0],{...dynamic.pieces[0],geometry:piece.geometry,binding:piece.binding});
for(const bad of [undefined,{...resource,version:'old'},{...resource,pieces:[]},{...resource,pieces:[{id:1}]}])assert.throws(()=>reconstructStoneObservation(dynamic,bad),/resource/);
console.log('Complete dynamic stamp mutations invalidate; busy/fallback/stale/incomplete resource evidence fails loud');
