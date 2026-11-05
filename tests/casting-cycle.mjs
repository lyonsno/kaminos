// kaminos-test: node
import assert from 'node:assert/strict';
const m=await import('../casting-cycle.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return {};throw e;});
assert.equal(typeof m.createCastingCycle,'function','Workshop needs one sequenced operation');
let s={pieceId:null,transfer:{moving:false},carriage:{moving:false},igniting:false},filled=false,events=[],release;
const actions={pour:async()=>events.push('pour'),sampleFill:async()=>filled,stopPour:async()=>events.push('close'),unmold:async()=>{events.push('unmold');s.pieceId='A';s.transfer.moving=true;},carry:async()=>{events.push('carry');s.carriage.moving=true;},ignite:async()=>{events.push('ignite');s.igniting=true;},returnLoader:async()=>{events.push('return');s.carriage.moving=true;},stop:async()=>events.push('stop')};
const c=m.createCastingCycle({read:()=>s,actions});
c.start();await c.tick();assert.deepEqual(events,['pour']);await c.tick();assert.deepEqual(events,['pour'],'Elapsed presentation time cannot substitute for measured fill');
filled=true;await c.tick();assert.deepEqual(events,['pour','close','unmold']);await c.tick();assert.equal(events.at(-1),'unmold');
s.transfer.moving=false;await c.tick();assert.equal(events.at(-1),'carry');await c.tick();assert.equal(events.at(-1),'carry');
s.carriage.moving=false;await c.tick();assert.equal(events.at(-1),'ignite');await c.tick();assert.equal(events.at(-1),'ignite');
s.igniting=false;await c.tick();assert.equal(events.at(-1),'return');s.carriage.moving=false;await c.tick();assert.equal(c.read().phase,'complete');assert.equal(c.read().running,false);
await assert.rejects(async()=>c.start(),/Remove/);
s.pieceId=null;filled=false;c.start();await c.tick();actions.sampleFill=()=>new Promise(r=>release=r);const waiting=c.tick();await c.stop();release(true);await waiting;assert.equal(events.at(-1),'stop');assert.equal(c.read().running,false,'Late measurement cannot restart a stopped cycle');
actions.pour=async()=>{throw Error('Missing water');};c.start();await c.tick();assert.equal(c.read().running,false);assert.match(c.read().error,/Missing water/);assert.equal(events.at(-1),'stop');
console.log('Cycle follows physical fill and operation completion; stop and failure cannot advance it');
