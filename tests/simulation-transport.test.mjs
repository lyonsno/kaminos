// kaminos-test: node
// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
assert.ok(fs.existsSync(new URL('../simulation-transport.mjs',import.meta.url)), 'Shared fixed-tick transport is absent');
const {createSimulationTransport}=await import('../simulation-transport.mjs');
let step=12,paused=false,rate=1,dt=1/240,restarts=0,calls=[];
const adapter={read:()=>({step,dt,paused,rate}),pause:v=>{paused=v;},rate:v=>{rate=v;},restart:()=>{step=0;restarts++;},advance:n=>{calls.push(n);step=n;}};
const t=createSimulationTransport(adapter);
await t.step(1);assert.equal(step,13);assert.equal(paused,true);
await t.rate(.25);assert.equal(dt,1/240);await t.step(1);assert.equal(step,14);
await t.seek(.1);assert.equal(step,24);assert.equal(restarts,0);
await t.step(-1);assert.equal(step,23);assert.equal(restarts,1);
await t.seek(0);assert.equal(step,0);assert.equal(restarts,2);
await assert.rejects(t.seek(-1),/nonnegative/);assert.equal(restarts,2);
await assert.rejects(t.rate(0),/positive/);
await t.toggle();assert.equal(paused,false);
let release;const held=new Promise(r=>release=r);const busy=createSimulationTransport({...adapter,advance:async n=>{await held;step=n;}});
const inFlight=busy.step(1);await Promise.resolve();await assert.rejects(busy.step(1),/busy/);release();await inFlight;
await busy.dispose();await assert.rejects(busy.toggle(),/disposed/);
const wrong=createSimulationTransport({...adapter,advance:()=>{}});await assert.rejects(wrong.step(1),/completed step/);
console.log('Fixed tick, rate separation, explicit recomputation, busy/disposal and effective-clock checks pass');
