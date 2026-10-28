// kaminos-test: node
import assert from 'node:assert/strict';
import * as lighting from '../scene-lighting-compile.mjs';
assert.equal(typeof lighting.createLightingPreparation,'function','ordinary light edits need exclusive, coalesced asynchronous preparation');
const releases=[],events=[];let calls=0;
const prepare=lighting.createLightingPreparation({
 hold:value=>events.push(['hold',value]),
 compile:async()=>{calls++;events.push(['compile',calls]);await new Promise(resolve=>releases.push(resolve));},
});
const a=prepare.request(()=>events.push(['change','a']));
const b=prepare.request(()=>events.push(['change','b']));
assert.equal(prepare.state().held,true,'hold begins before another draw can start');
await new Promise(r=>setImmediate(r));
assert.equal(calls,1,'same-turn edits share preparation');
assert.deepEqual(events.slice(0,4),[['hold',true],['change','a'],['change','b'],['compile',1]]);
prepare.setExternalHold(true);
const c=prepare.request(()=>events.push(['change','c']));
assert(!events.some(e=>e[1]==='c'),'graph mutation waits for the in-flight compilation');
releases.shift()();await new Promise(r=>setImmediate(r));
assert.equal(calls,2);assert.equal(prepare.state().held,true);
releases.shift()();await Promise.all([a,b,c]);
assert.equal(prepare.state().held,true,'ordinary compilation cannot release flame rebuild hold');
prepare.setExternalHold(false);assert.equal(prepare.state().held,false);
let fail=true;
const failed=lighting.createLightingPreparation({hold:()=>{},compile:async()=>{if(fail)throw Error('pipeline rejection');}});
await assert.rejects(failed.request(),/pipeline rejection/);
assert.equal(failed.state().held,true);assert.match(failed.state().error,/pipeline rejection/);
fail=false;await failed.request();assert.equal(failed.state().held,false);assert.equal(failed.state().error,null);
console.log('PASS exclusive preparation, same-turn coalescing, graph mutation ordering, independent holds, failure and retry');
let drainRelease,drainCompiled=false;
const draining=lighting.createLightingPreparation({hold:value=>value?new Promise(r=>drainRelease=r):undefined,compile:async()=>{drainCompiled=true;}});
const drain=draining.setExternalHold(true);
const duringDrain=draining.request();
await new Promise(r=>setImmediate(r));
assert.equal(drainCompiled,false,'an existing flame hold must retain its foreground drain for ordinary preparation');
drainRelease();await drain;await duringDrain;draining.setExternalHold(false);
