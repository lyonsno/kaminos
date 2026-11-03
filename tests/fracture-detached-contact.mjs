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
const allCollisions=structuredClone(observed.landing);allCollisions.before.config.collisions=allCollisions.after.config.collisions='all';
assert.ok(run(allCollisions).excess<0,'Detached contact energy contract must accept full inter-piece + floor collision mode');
const {buildIgnoredPairTable,CONTACT_TOPOLOGY_RESET}=await import('../fracture-contact-cache.mjs');
assert.equal(typeof buildIgnoredPairTable,'function','Contact cache must build the GPU-resident ignored-pair table');
const cells=[
 {index:0,position:[0,0,0],halfExtents:[.5,.5,.5]},
 {index:1,position:[1,0,0],halfExtents:[.5,.5,.5]},
 {index:2,position:[.6,0,0],halfExtents:[.2,.2,.2]},
 {index:3,position:[5,0,0],halfExtents:[.5,.5,.5]}
];
const bonds=[{a:0,b:1},{a:1,b:2}];
const table=buildIgnoredPairTable(cells,bonds,100);
assert.equal(table.pairs.length,3,'Bonded (0,1), (1,2) and rest-overlapping (0,2) must be tracked; disjoint (0,3),(1,3),(2,3) stay active');
const p01=table.pairs.find(p=>p.i===0&&p.j===1),p12=table.pairs.find(p=>p.i===1&&p.j===2),p02=table.pairs.find(p=>p.i===0&&p.j===2);
assert.equal(p01.requireSeparation,false,'Clean face-touching bonded pair clears immediately when its bond breaks');
assert.equal(p12.requireSeparation,true,'Rest-overlapping bonded pair waits for separation after bond break');
assert.equal(p02.requireSeparation,true,'Rest-overlapping multi-hop pair waits for separation after its local bond path breaks');
assert.deepEqual(p02.bonds,[0,1,0xffffffff,0xffffffff],'Multi-hop overlapping pair tracks its exact shortest local bond path');
assert.match(CONTACT_TOPOLOGY_RESET,/fn updateIgnoredPairs/,'Resident shader must update pairIgnoredBits on the GPU');
assert.match(CONTACT_TOPOLOGY_RESET,/boxesSeparated/,'Resident shader must gate rest-overlapping pairs on 3D OBB separation');
