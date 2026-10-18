// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
let module;try{module=await import('../scripts/skeleton-open-wait.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('restoration polling returns synchronous booleans and retries awaited false reads',async()=>{
 assert.equal(typeof module?.restoredBodyPoll,'function','The witness has no awaited-read/synchronous-predicate polling path');
 const previous=globalThis.window;let calls=0;globalThis.window={kaminosWorkbenchExperiments:{async read(){calls++;return {objectId:calls<3?'old':'new',joints:Array(51)};}}};
 try{window.__skeletonOpenProbe={previousId:'old',jointCount:51,pending:false,state:null,reads:0,delayReads:1};for(let i=0;i<4;i++){assert.equal(module.restoredBodyPoll(),false);await new Promise(resolve=>setImmediate(resolve));}assert.equal(module.restoredBodyPoll(),true);assert.ok(calls>=3);assert.ok(window.__skeletonOpenProbe.reads>=4);
 window.__skeletonOpenProbe={previousId:'old',jointCount:51,pending:false,state:{objectId:'old',joints:Array(51)},reads:0};assert.equal(module.restoredBodyPoll(),false);await Promise.resolve();
 }finally{globalThis.window=previous;}
});
