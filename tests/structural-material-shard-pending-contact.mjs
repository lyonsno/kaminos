import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('async function beginPick('),text.indexOf('async function release('));
let resume;const gate=new Promise(r=>resume=r),ctx={failure:null,gestureGeneration:0,pendingPick:false,busy:false,gesture:null,components:[0],pieces:[{id:0,component:0,nodes:[0]}],body:{positions:[[0,0,0]]},observed:{state:Array(16).fill(0)},controls:{enabled:true},settle:()=>gate,positions:()=>[[0,0,0]],contactPatch:()=>[{index:0,weight:1}],configuration:{patchRadius:.28,gripStiffness:200000},resident:{capturePatch:async()=>{}},marker:{position:{fromArray(){}},visible:false},stamp(){}};
vm.runInNewContext(source+'; task=beginPick(0,[0,0,0])',ctx);
assert.ok(ctx.gesture,'Pointer movement must have a contact state before awaiting GPU work');assert.equal(ctx.gesture.phase,'capturing');assert.equal(ctx.controls.enabled,false);ctx.gesture.displacement=[.3,0,0];resume();await ctx.task;assert.equal(ctx.gesture.phase,'active');assert.deepEqual(ctx.gesture.displacement,[.3,0,0]);
console.log('Actual pending-contact lifecycle retains early pointer movement; synthetic scheduling is not native input evidence');
