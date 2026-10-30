// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrust,advanceCrust,saveCrust,restoreCrust,readCrust,grainVolume} from '../mineral-worlds/crust.mjs';
const empty=s=>{for(const p of s.pools){p.water=p.salt=p.residue=0;}s.ledger.initialWater=s.ledger.initialSalt=0;};
test('neighbor setup retains separate exposed face liquid and a finite shared supply',()=>{
 const s=createCrust({setup:'neighbors'});assert.equal(s.setup,'neighbors');assert.equal(s.grains.length,5);assert.equal(s.settings.feed,0);
 for(const g of s.grains){assert.equal(g.facePools.length,6);assert.deepEqual(g.facePools.filter(id=>id!==null).map(id=>s.pools[id].face),[0,1,2,3,4]);}
 assert.ok(s.pools.some(p=>p.kind==='edge'));
});
test('wetting one side grows that side, never a dry top or opposite side',()=>{
 const s=createCrust({setup:'neighbors',settings:{feed:0,evaporation:0,mobility:0,nucleation:0,growth:.1}});assert.equal(s.setup,'neighbors');empty(s);
 const g=s.grains[0],p=s.pools[g.facePools[0]],before=[...g.faces];p.water=.0001;p.salt=.0002;s.ledger.initialWater=p.water;s.ledger.initialSalt=p.salt;
 advanceCrust(s,.1);assert.ok(g.faces[0]>before[0]);assert.deepEqual(g.faces.slice(1),before.slice(1));
});
test('dryout retains unplaced salt locally instead of extruding a needle',()=>{
 const s=createCrust({setup:'neighbors',settings:{feed:0,evaporation:100,mobility:0,nucleation:0}});assert.equal(s.setup,'neighbors');empty(s);
 const g=s.grains[0],p=s.pools[g.facePools[4]],before=grainVolume(g);p.water=.0001;p.salt=.001;s.ledger.initialWater=p.water;s.ledger.initialSalt=p.salt;
 advanceCrust(s,.1);assert.equal(grainVolume(g),before);assert.equal(p.residue,.001);assert.equal(p.salt,0);assert.ok(Math.abs(readCrust(s).saltError)<1e-12);
});
test('finite face experiment conserves mass and restores exact continuation',()=>{
 const s=createCrust({setup:'neighbors',settings:{nucleation:0}}),v=s.grains.reduce((n,g)=>n+grainVolume(g),0);assert.equal(s.setup,'neighbors');advanceCrust(s,2);
 const b=restoreCrust(saveCrust(s));advanceCrust(s,2);advanceCrust(b,2);assert.deepEqual(s,b);const r=readCrust(s);assert.ok(Math.abs(r.saltError)<1e-10);assert.ok(Math.abs(r.waterError)<1e-10);
 assert.ok(Math.abs((s.grains.reduce((n,g)=>n+grainVolume(g),0)-v)*8-r.deposited)<1e-10);
});
test('a wet patch must reach the shared edge before it supplies an adjacent face',()=>{
 const s=createCrust({setup:'neighbors',settings:{mobility:12000,feed:0,evaporation:0,growth:0,nucleation:0}});empty(s);
 const g=s.grains[0],p=s.pools[g.facePools[0]],area=.22**2;p.entry=[.5,.5];p.water=area*.016*.01;p.salt=p.water;s.ledger.initialWater=p.water;s.ledger.initialSalt=p.salt;
 advanceCrust(s,.1);for(const id of g.facePools.slice(1).filter(id=>id!==null))assert.equal(s.pools[id].water,0,'liquid crossed an unwetted edge');
 p.water=area*.016*1.2;p.salt=p.water;s.ledger.initialWater=p.water;s.ledger.initialSalt=p.salt;
 advanceCrust(s,.1);assert.ok(s.pools[g.facePools[4]].water>0,'top never received liquid after edge contact');
 assert.ok(s.pools[g.facePools[2]].water>0,'adjacent side never received liquid after edge contact');
});
test('equivalently wet faces have comparable normal growth without a shape correction',()=>{
 const s=createCrust({setup:'neighbors',settings:{mobility:0,feed:0,evaporation:0,growth:.01,nucleation:0}});empty(s);const g=s.grains[0],before=[...g.faces];
 for(const id of g.facePools.filter(id=>id!==null)){const p=s.pools[id];p.water=.22**2*.016*1.1;p.salt=p.water*1.5;s.ledger.initialWater+=p.water;s.ledger.initialSalt+=p.salt;}
 advanceCrust(s,.1);const amounts=[0,1,2,3,4].map(f=>Math.abs(g.faces[f]-before[f]));
 assert.ok(Math.min(...amounts)>0);assert.ok(Math.max(...amounts)/Math.min(...amounts)<1.002,JSON.stringify(amounts));
});
test('new grains retain local film state, finite mass and exact saved continuation',()=>{
 const s=createCrust({setup:'neighbors'});advanceCrust(s,8);assert.ok(s.events.nucleations>0);assert.ok(s.pools.some(p=>p.kind==='face'&&p.water>0&&!s.grains[p.grain].authored),'births cannot be fed');
 const copy=restoreCrust(saveCrust(s));advanceCrust(s,1);advanceCrust(copy,1);assert.deepEqual(copy,s);
 assert.ok(Math.abs(readCrust(s).saltError)<1e-10);assert.ok(Math.abs(readCrust(s).waterError)<1e-10);
 const bad=saveCrust(s);bad.pools.find(p=>p.kind==='edge').contactA=[NaN,0];assert.throws(()=>restoreCrust(bad));
});
test('a newborn receives liquid on exposed faces and continues growing beyond its birth size',()=>{
 const s=createCrust({setup:'neighbors'});advanceCrust(s,8);const children=s.grains.filter(g=>!g.authored).map(g=>({id:g.id,volume:grainVolume(g)}));assert.ok(children.length);
 advanceCrust(s,7);assert.ok(children.some(({id,volume})=>grainVolume(s.grains[id])>volume*1.01),'all early newborns are stranded at their birth size');
 for(const {id} of children){const g=s.grains[id];assert.equal(g.facePools[g.supportFace],null,'buried attachment face must not hold an exposed film');}
});
test('wetting reaches a shared edge away from its midpoint',()=>{
 const s=createCrust({setup:'neighbors',settings:{mobility:12000,feed:0,evaporation:0,growth:0,nucleation:0}});empty(s);const g=s.grains[0],p=s.pools[g.facePools[0]];
 p.entry=[0,0];p.water=.22**2*.016*.04;p.salt=p.water;s.ledger.initialWater=p.water;s.ledger.initialSalt=p.salt;
 advanceCrust(s,.1);assert.ok(s.pools[g.facePools[3]].water>0,'wet corner was blocked by a midpoint-only edge port');
 assert.equal(s.pools[g.facePools[4]].water,0,'the dry upper edge must remain disconnected');
});
test('arc and spiral seeds retain full spatial frames and exact evolving continuation',()=>{
 for(const arrangement of ['arcs','spiral']){
  const s=createCrust({setup:'neighbors',arrangement,tilt:.25,settings:{nucleation:0}});
  assert.equal(s.arrangement,arrangement,'requested seed arrangement was ignored');
  assert.ok(s.grains.every(g=>g.basis?.length===3&&g.origin?.length===3));
  assert.ok(s.grains.some(g=>Math.abs(g.basis[1][0])+Math.abs(g.basis[1][2])>.01));
  advanceCrust(s,.3);const b=restoreCrust(saveCrust(s));advanceCrust(s,.3);advanceCrust(b,.3);assert.deepEqual(s,b);
  assert.ok(Math.abs(readCrust(s).saltError)<1e-10);assert.ok(Math.abs(readCrust(s).waterError)<1e-10);
 }
});
test('an interior child patch cannot drain across a dry attachment perimeter',async()=>{
 const {trackGeometry}=await import('../mineral-worlds/crust.mjs');const s=createCrust({setup:'neighbors'});advanceCrust(s,8);
 const e=s.pools.find(e=>e.kind==='edge'&&!e.surfaceEdge&&s.pools[e.a].kind==='face');assert.ok(e);empty(s);Object.assign(s.settings,{feed:0,evaporation:0,growth:0,nucleation:0});
 const b=s.pools[e.b];b.entry=[.5,.5];b.water=trackGeometry(s,b).capacity*.01;b.salt=b.water;advanceCrust(s,.1);assert.equal(s.pools[e.a].water,0);
});
test('authored curved layouts have no initial intersecting seeds across lean settings',async()=>{
 const {frameOverlap}=await import('../mineral-worlds/crust-frame.mjs');
 for(const arrangement of ['neighbors','arcs','spiral'])for(const seed of [1,31])for(const tilt of [0,.24,.8,Math.PI/2,1.6,3]){const s=createCrust({setup:'neighbors',arrangement,tilt,seed});for(let i=0;i<s.grains.length;i++)for(let j=0;j<i;j++)assert.equal(frameOverlap(s.grains[i],s.grains[j]),false,`${arrangement} ${tilt} seeds ${i}/${j}`);}
});
test('a tilted neighbor with clear space can advance a supplied face',async()=>{
 const {trackGeometry}=await import('../mineral-worlds/crust.mjs');
 const s=createCrust({setup:'neighbors',arrangement:'neighbors',tilt:Math.PI/2,settings:{feed:0,evaporation:0,mobility:0,nucleation:0,growth:.1}});empty(s);const g=s.grains[0],p=s.pools[g.facePools[0]],before=g.faces[0];p.water=trackGeometry(s,p).capacity;p.salt=2*p.water;advanceCrust(s,.1);assert.ok(g.faces[0]>before);
});
