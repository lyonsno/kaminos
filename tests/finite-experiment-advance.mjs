// kaminos-test: node
import assert from 'node:assert/strict';
import definition from '../experiments/lazarus-fluid/finite-pbf.experiment.mjs';
let step=0,finish,paused=true;const events=[];
const water={read:()=>({clock:{step,paused},runtime:{}}),setPaused:value=>{paused=value;},advanceTo:next=>new Promise(resolve=>{finish=()=>{step=next;resolve();};}),dispose(){}};
const instance=await definition.create({host:{fluid:{open:async()=>water}},inputs:{resolution:12,densityIterations:1},record:event=>events.push(event)});
let settled=false;const pending=instance.operations.advance(2/240).then(value=>{settled=true;return value;});
await Promise.resolve();await Promise.resolve();
assert.equal(settled,false,'Advance must remain pending until the producer completes the requested step');
assert.equal(events.some(e=>e.phase==='applied'),false,'Applied receipt cannot precede producer completion');
finish();const result=await pending;assert.equal(result.water.clock.step,2);assert.equal(events.at(-1).effective.water.clock.step,2);
await instance.dispose();

{
 const failedEvents=[];
 const failing={...water,read:()=>({clock:{step:0,paused:true},runtime:{}}),advanceTo:async()=>{throw Error('producer rejected');}};
 const failed=await definition.create({host:{fluid:{open:async()=>failing}},inputs:{resolution:12,densityIterations:1},record:event=>failedEvents.push(event)});
 await assert.rejects(failed.operations.advance(2/240),/producer rejected/);
 assert.deepEqual(failedEvents.map(e=>e.phase),['requested','failed']);
 await failed.dispose();
}
console.log('Experiment advance waits for the producer and records its actual completion or failure');
