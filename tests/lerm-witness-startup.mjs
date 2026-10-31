// kaminos-test: node
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {waitForLermScene,waitForLermState} from '../tools/lerm-witness-startup.mjs';

let reads=0;
await waitForLermState(async()=>({carried:++reads===3}),state=>state.carried,async()=>{});
assert.equal(reads,3,'A Promise resolving false must keep waiting');
await assert.rejects(waitForLermState(async()=>{throw Error('GPU failed');},()=>true),/GPU failed/);

let predicate, options;
await waitForLermScene({waitForFunction(fn, arg, config) { predicate=fn; options=config; }});
assert.equal(options?.timeout, 0, 'Scene loading must not inherit Playwright\'s 30-second deadline');
globalThis.window={};globalThis.document={body:{innerText:''}};
assert.equal(predicate(),false,'Missing activation is pending, not success');
window.kaminosWorkbenchExperiments={state:()=>({id:'another-experiment'})};
assert.equal(predicate(),false,'A different experiment cannot satisfy activation');
window.kaminosWorkbenchExperimentError='Missing creature asset';
assert.throws(predicate,/Missing creature asset/,'Activation errors must fail without waiting for a deadline');
delete window.kaminosWorkbenchExperimentError;
window.kaminosWorkbenchExperiments={state:()=>({id:'lerms/hand-goin'})};
assert.equal(predicate(),true);
delete globalThis.window;delete globalThis.document;

const failedPage=new EventEmitter();
failedPage.waitForFunction=()=>new Promise(()=>{});
const failure=waitForLermScene(failedPage);
failedPage.emit('console',{type:()=> 'error',text:()=> 'initScene failed: GPU unavailable'});
await assert.rejects(failure,/initScene failed: GPU unavailable/);
assert.equal(failedPage.listenerCount('console'),0,'Terminal failure releases its listener');
await assert.rejects(waitForLermScene(failedPage,['initScene failed: before wait']),/before wait/);
