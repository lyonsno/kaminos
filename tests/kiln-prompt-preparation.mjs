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
