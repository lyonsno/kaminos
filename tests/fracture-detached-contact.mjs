// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertDetachedContactEnergy} from '../tools/fracture-detached-contact-contract.mjs';
const observed=JSON.parse(fs.readFileSync(new URL('./fixtures/fracture-detached-contact.json',import.meta.url)));
const run=row=>assertDetachedContactEnergy(row.before,row.after,row.body);
assert.throws(()=>run(observed.launch),/Detached floor contact added mechanical energy/);
assert.ok(run(observed.landing).excess<0);
for(const [mutate,expected] of [
 [row=>row.after.config.collisions='none',/Removing the floor/],
 [row=>row.after.observation='cached',/acquired GPU state/],
 [row=>row.after.backend='cpu',/actual solver/],
 [row=>row.after.step++,/consecutive physical steps/],
 [row=>row.after.bodies.find(b=>b.index===row.body).velocity.y=NaN,/finite/],
 [row=>row.after.hand={indices:[row.body]},/hand-loaded/],
 [row=>row.after.bonds.push({alive:true,a:row.body,b:0}),/already be detached/]
]){const row=structuredClone(observed.landing);mutate(row);assert.throws(()=>run(row),expected);}
console.log('Observed launch rejected; ordinary landing accepted; fallback, stale, missing-contract and nonfinite evidence rejected');
