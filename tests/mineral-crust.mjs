// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrust,advanceCrust,interfaceState,trackGeometry,setCrustConditions,saveCrust,restoreCrust,readCrust,grainVolume} from '../mineral-worlds/crust.mjs';
test('an interfacial track advances continuously from finite brine supply',()=>{
 const s=createCrust({rows:3});const track=s.pools.find(p=>p.kind==='gap');
 assert.equal(interfaceState(s,track).fraction,0);advanceCrust(s,4);
 assert.ok(interfaceState(s,track).fraction>0,'capillary front did not advance');
 assert.ok(readCrust(s).time>=4-1e-9);
});
test('salt and water stay conserved while evaporation, face growth and new crystals compete',()=>{
 const s=createCrust({rows:2,settings:{salinity:2.1,nucleation:200}}),initial=s.grains.reduce((a,g)=>a+grainVolume(g),0);
 advanceCrust(s,25);const r=readCrust(s);
 assert.ok(r.deposited>0,'no salt precipitated onto the material');
 assert.ok(s.grains.reduce((a,g)=>a+grainVolume(g),0)>initial,'retained grain geometry did not grow');
 assert.ok(Math.abs(r.waterError)<1e-9,JSON.stringify(r));assert.ok(Math.abs(r.saltError)<1e-9,JSON.stringify(r));
 assert.ok(s.pools.every(p=>p.water>=0&&p.salt>=0));
});
test('changing actual grain faces changes the gap and subsequent local interface response',()=>{
 const a=createCrust({rows:3}),b=restoreCrust(saveCrust(a)),ea=a.pools.find(p=>p.kind==='gap'),eb=b.pools[ea.id],g=b.grains[eb.walls[0]],other=b.grains[eb.walls[1]],face=Math.abs(other.x-g.x)>Math.abs(other.z-g.z)?0:2;
 g.faces[face]+=.12;assert.ok(trackGeometry(b,eb).gap<trackGeometry(a,ea).gap);
 advanceCrust(a,3);advanceCrust(b,3);assert.notEqual(interfaceState(a,ea).fraction,interfaceState(b,eb).fraction,'grain geometry has no fluid feedback');
});
test('local nucleation needs wet supersaturated salt and creates independent state',()=>{
 const dry=createCrust({rows:1,settings:{feed:0,evaporation:0,nucleation:1000}});for(const p of dry.pools){p.water=0;p.salt=0;}dry.ledger.initialWater=0;dry.ledger.initialSalt=0;
 advanceCrust(dry,5);assert.equal(dry.events.nucleations,0);
 const wet=createCrust({rows:1,settings:{salinity:3,nucleation:300,growth:.002}});advanceCrust(wet,20);
 assert.ok(wet.events.nucleations>0,'supersaturated liquid-air interfaces produced no nuclei');
 const child=wet.grains.find(g=>!g.authored);assert.ok(child);assert.ok(wet.pools.some(p=>p.kind==='face'&&p.grain===child.id),'new grain has no independent liquid state');
});
test('checkpoint continuation preserves wetting fronts, birth clocks and local salt history',()=>{
 const a=createCrust({rows:2});advanceCrust(a,2);const b=restoreCrust(saveCrust(a));advanceCrust(a,3);advanceCrust(b,3);assert.deepEqual(a,b);
 const before=saveCrust(a);assert.throws(()=>setCrustConditions(a,{feed:2,evaporation:NaN}));assert.deepEqual(a,before);
 const invalid=saveCrust(a);invalid.pools[0].water=-1;assert.throws(()=>restoreCrust(invalid));
});
test('a retained fine grain inside a slot changes its storage and hydraulic response',()=>{
 const s=createCrust({rows:3}),track=s.pools.find(p=>p.kind==='gap'),before=trackGeometry(s,track),a=before.endpoints[0],b=before.endpoints[1],size=before.gap*.45;
 s.grains.push({id:s.grains.length,x:(a[0]+b[0])/2,z:(a[2]+b[2])/2,angle:0,faces:[size/2,-size/2,size/2,-size/2,.08,0],authored:false,parent:null});
 const after=trackGeometry(s,track);assert.ok(after.capacity<before.capacity);assert.ok(after.aperture<before.aperture);
 assert.ok(after.profile.segments.some(segment=>segment.open.length===2),'obstacle did not create parallel side passages');
});
test('a film still on the approach substrate cannot grow an unwetted carrier face',()=>{
 const s=createCrust({rows:1,settings:{feed:0,evaporation:0,nucleation:0,growth:1}});for(const p of s.pools){p.water=0;p.salt=0;}
 const film=s.pools.find(p=>p.kind==='film'),capacity=trackGeometry(s,film).capacity;film.water=capacity*.02;film.salt=film.water*2;
 s.ledger.initialWater=film.water;s.ledger.initialSalt=film.salt;const before=grainVolume(s.grains[0]);advanceCrust(s,.1);assert.equal(grainVolume(s.grains[0]),before,'unwetted crystal face grew from liquid on the substrate');
});
test('malformed saved accounting, sources or anchors are rejected before reconstruction',()=>{
 const s=createCrust({rows:3});
 for(const edit of [a=>a.ledger.initialWater=NaN,a=>a.sources=[999],a=>a.pools.find(p=>p.kind==='film').anchor=[NaN,0,0]]){const bad=saveCrust(s);edit(bad);assert.throws(()=>restoreCrust(bad));}
});
