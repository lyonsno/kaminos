import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('async function beginPick('),text.indexOf('async function advance('));
async function run(fracture){
 let complete;const gate=new Promise(r=>complete=r),log=[],ctx={failure:null,gestureGeneration:1,gesture:{generation:1,phase:'active'},paused:false,pendingPick:false,finishing:false,busy:false,pickTask:Promise.resolve(),controls:{enabled:false},pieces:[{id:0,component:0,nodes:[0,1]}],components:[0,0],body:{positions:[[0,0,0],[.1,0,0]]},observed:{state:Array(32).fill(0)},configuration:{patchRadius:.28,gripStiffness:200000},positions:()=>[[0,0,0],[.1,0,0]],contactPatch:()=>{log.push('patch');return[{index:0,weight:.2},{index:1,weight:.8}];},marker:{position:{fromArray(){}},visible:false},arrow:{visible:false},stamp(kind){log.push(kind);},resident:{capturePatch:async()=>log.push('capture'),release:async()=>log.push('release')}};
 ctx.interiorSplit=false;let started;const admitted=new Promise(r=>started=r);ctx.advance=async()=>{ctx.busy=true;started();await gate;ctx.busy=false;};ctx.settle=async()=>{if(ctx.busy)await gate;};
 vm.runInNewContext(source+'; finish=finishGesture()',ctx);await admitted;assert.equal(ctx.busy,true);
 vm.runInNewContext('next=beginPick(0,[0,0,0])',ctx);assert.equal(ctx.gesture.phase,'capturing');ctx.gesture.displacement=[.2,0,0];
 if(fracture){ctx.components=[1,7];ctx.pieces=[{id:1,component:7,nodes:[1]},{id:2,component:1,nodes:[0]}];}
 complete();await ctx.finish;await ctx.next;assert.ok(ctx.gesture,'Old completion must not erase the later grip');assert.equal(ctx.gesture.phase,'active','Old completion must leave the next grip active');assert.deepEqual(ctx.gesture.displacement,[.2,0,0]);assert.equal(ctx.controls.enabled,false);assert.equal(log.filter(x=>x==='capture').length,1);assert.equal(log.filter(x=>x==='release').length,0);
 if(fracture){assert.equal(ctx.gesture.pieceId,1);assert.equal(ctx.gesture.component,7);assert.equal(ctx.gesture.patch.length,1);assert.equal(ctx.gesture.patch[0].index,1);assert.equal(ctx.gesture.patch[0].weight,1);}assert.equal(log.filter(x=>x==='patch').length,1,'The displayed contact must be resolved before the old step changes its pose');
}
await run(false);await run(true);console.log('Actual completion ownership preserves later grip and stable picked-node ownership across an in-flight fracture');
