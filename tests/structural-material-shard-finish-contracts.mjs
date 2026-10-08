import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const text=fs.readFileSync(new URL('../structural-material-shard-view.js',import.meta.url),'utf8'),source=text.slice(text.indexOf('async function finishGesture('),text.indexOf('async function release('));
let resume;const gate=new Promise(r=>resume=r),ctx={gestureGeneration:1,gesture:{phase:'active'},pickTask:gate,paused:false,finishing:false,steps:0,stamp(){},settle:async()=>{},advance:async()=>ctx.steps++,release:async()=>ctx.gesture=null};
vm.runInNewContext(source+'; task=finishGesture()',ctx);ctx.paused=true;resume();await ctx.task;assert.equal(ctx.steps,1,'A pause after release admission must not discard the accepted final force');assert.equal(ctx.gesture,null);assert.equal(ctx.finishing,false);
console.log('Admitted live gesture completion drains through a later pause');
