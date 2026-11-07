// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createKilnPromptPreparation} from '../kiln-prompt-preparation.mjs';
const turn=()=>new Promise(resolve=>setImmediate(resolve));
test('the exact draft reuses one worker job, errors reject, disposal releases outstanding work',async()=>{
 let worker,rasters=0;
 class Worker {constructor(){worker=this;this.jobs=[];}postMessage(message){this.jobs.push(message);}terminate(){this.terminated=true;}}
 const prep=createKilnPromptPreparation({Worker,rasterize:async()=>{rasters++;return {width:2,height:2,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(16)})})};}});
 const first=prep.prepare('same words'),again=prep.prepare('same words');assert.equal(first,again);await turn();assert.equal(rasters,1);assert.equal(worker.jobs.length,1);
 worker.onmessage({data:{id:1,error:'Unsupported glyph'}});await assert.rejects(first,/Unsupported glyph/);
 const pending=prep.prepare('new words');await turn();prep.dispose();await assert.rejects(pending,/disposed/);assert.equal(worker.terminated,true);
});
test('a worker module failure before the first draft rejects later preparation instead of hanging',async()=>{
 let worker;class Worker{constructor(){worker=this;}postMessage(){}terminate(){}}
 const prep=createKilnPromptPreparation({Worker,rasterize:async()=>{throw Error('must not rasterize after worker failure');}});
 worker.onerror({message:'module export missing'});
 await assert.rejects(prep.prepare('first words'),/module export missing/);prep.dispose();
});
test('worker failure during rasterization rejects admission without posting to a dead worker',async()=>{
 let worker,release,posted=0,settled=null;class Worker{constructor(){worker=this;}postMessage(){posted++;}terminate(){}}
 const raster=new Promise(r=>release=r);const prep=createKilnPromptPreparation({Worker,rasterize:()=>raster});
 const pending=prep.prepare('in flight');pending.catch(e=>{settled=e.message;});
 worker.onerror({message:'worker could not load'});release({width:2,height:2,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(16)})})});await turn();
 assert.equal(posted,0);assert.equal(settled,'worker could not load');await assert.rejects(pending,/worker could not load/);prep.dispose();
});
