// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrust,advanceCrust,saveCrust,restoreCrust,readCrust} from '../mineral-worlds/crust.mjs';

const specimen=()=>createCrust({setup:'neighbors',wetting:'regions',settings:{feed:0,evaporation:0,mobility:0,growth:0,nucleation:0}});
test('separate wet regions are an explicit retained model, with the old model preserved',()=>{
 const s=specimen();assert.equal(s.wetting,'regions','requested separate wet-region model was ignored');
 assert.ok(s.pools.filter(p=>p.kind==='face').every(p=>Array.isArray(p.regions)));
 assert.equal(createCrust({setup:'neighbors'}).wetting,undefined);
 assert.deepEqual(restoreCrust(saveCrust(s)),s);
});
test('distant arrivals keep separate salt; touching regions merge without filling dry corners',async()=>{
 const {addWetRegion,mergeWetRegions,regionRects}=await import('../mineral-worlds/crust-regions.mjs');
 const s=specimen(),p=s.pools[s.grains[0].facePools[4]],cap=.22**2*.016;
 addWetRegion(s,p,[.1,.1],cap*.04,cap*.08);addWetRegion(s,p,[.9,.9],cap*.04,cap*.02);
 mergeWetRegions(s,p);assert.equal(p.regions.length,2);assert.notEqual(p.regions[0].salt/p.regions[0].water,p.regions[1].salt/p.regions[1].water);
 p.regions=[];addWetRegion(s,p,[.25,.25],cap*.25,cap*.5);addWetRegion(s,p,[.6,.6],cap*.25,cap*.25);
 mergeWetRegions(s,p);assert.equal(p.regions.length,1);assert.ok(Math.abs(p.water-cap*.5)<1e-14);assert.ok(Math.abs(p.salt-cap*.75)<1e-14);
 const rects=regionRects(s,p,p.regions[0]);assert.ok(!rects.some(r=>r.lo[0]<=.1&&r.hi[0]>=.1&&r.lo[1]<=.8&&r.hi[1]>=.8),'merger invented liquid across a dry corner');
});
test('a changing gap changes liquid passage and a closed gap cannot transmit',async()=>{
 const {bridgeGeometry,refreshBridges}=await import('../mineral-worlds/crust-bridges.mjs');
 const s=specimen();refreshBridges(s);const e=s.pools.find(p=>p.kind==='bridge');assert.ok(e,'no neighboring gap reconstructed');
 const before=bridgeGeometry(s,e);assert.ok(before.aperture>0&&before.width>0);
 const a=s.pools[e.a],grain=s.grains[a.grain],sign=a.face%2===0?1:-1;
 grain.faces[a.face]+=sign*before.aperture*.25;
 const narrow=bridgeGeometry(s,e);assert.ok(narrow.aperture<before.aperture);assert.ok(narrow.conductance<before.conductance);
 grain.faces[a.face]+=sign*before.aperture*2;
 assert.equal(bridgeGeometry(s,e).closed,true);
});
test('regions and reconstructed passages conserve salt/water and save exact continuation',()=>{
 const s=createCrust({setup:'neighbors',wetting:'regions'});advanceCrust(s,1);
 const copy=restoreCrust(saveCrust(s));advanceCrust(s,.2);advanceCrust(copy,.2);assert.deepEqual(copy,s);
 const r=readCrust(s);assert.ok(Math.abs(r.waterError)<1e-10,JSON.stringify(r));assert.ok(Math.abs(r.saltError)<1e-10,JSON.stringify(r));
});
test('drying a joined footprint separates disconnected remaining spots and their supplies',async()=>{
 const {addWetRegion,mergeWetRegions}=await import('../mineral-worlds/crust-regions.mjs');
 const s=specimen(),p=s.pools[s.grains[0].facePools[4]],cap=.22**2*.016;
 addWetRegion(s,p,[.25,.25],cap*.25,cap*.5);addWetRegion(s,p,[.6,.6],cap*.25,cap*.25);mergeWetRegions(s,p);assert.equal(p.regions.length,1);
 p.regions[0].water*=.01;mergeWetRegions(s,p);assert.equal(p.regions.length,2,'dry separation still shared one liquid reservoir');
 assert.ok(Math.abs(p.water-cap*.005)<1e-14);assert.ok(Math.abs(p.salt-cap*.75)<1e-14);
});
test('transport arriving far from an existing wet spot does not mix their salt',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');
 const s=specimen();s.settings.mobility=12000;s.pools[0].water=s.pools[0].salt=0;
 const g=s.grains[0],side=s.pools[g.facePools[0]],top=s.pools[g.facePools[4]],cap=.22**2*.016;
 const old=addWetRegion(s,side,[.1,.1],cap*.01,cap*.02);addWetRegion(s,top,[1,.9],cap*.04,cap*.02);
 advanceCrust(s,.1);assert.ok(side.regions.length>=2,'arrival was merged across a dry side');assert.equal(old.salt/old.water,2);
 assert.ok(side.regions.some(r=>r!==old&&r.water>0&&Math.abs(r.salt/r.water-.5)<1e-8));
});
test('the new model rejects corrupt region and bridge history on restore',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');
 const s=specimen(),p=s.pools[s.grains[0].facePools[0]];addWetRegion(s,p,[.2,.2],.00001,.00002);
 const bad=saveCrust(s);bad.pools[p.id].regions[0].salt=-1;assert.throws(()=>restoreCrust(bad),/wet region/);
 const wrong=saveCrust(s);wrong.pools[p.id].water+=.1;assert.throws(()=>restoreCrust(wrong),/disagrees/);
});
test('a supplied gap fills before feeding a previously dry neighboring crystal',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');const {refreshBridges,bridgeGeometry}=await import('../mineral-worlds/crust-bridges.mjs');
 const s=specimen();s.settings.mobility=12000;s.pools[0].water=s.pools[0].salt=0;refreshBridges(s);
 const e=s.pools.find(p=>p.kind==='bridge'),a=s.pools[e.a],b=s.pools[e.b];
 addWetRegion(s,a,e.portA,.08,.08);s.ledger.initialWater=.08;s.ledger.initialSalt=.08;
 advanceCrust(s,1);assert.ok(e.water>0,'gap did not draw supplied liquid');assert.ok(b.water>0&&e.throughput>0,'gap filling never delivered liquid to the dry neighbor');
 assert.ok(e.water>=bridgeGeometry(s,e).capacity*(1-1e-8));assert.ok(Math.abs(readCrust(s).waterError)<1e-10);
});
test('a growing wet corner keeps one receiving spot at that corner',async()=>{
 const {addWetRegion,syncFace}=await import('../mineral-worlds/crust-regions.mjs');
 const {stepWetRegions}=await import('../mineral-worlds/crust-regions.mjs');
 const {trackGeometry}=await import('../mineral-worlds/crust.mjs');
 const s=specimen(),g=s.grains[0],top=s.pools[g.facePools[4]],side=s.pools[g.facePools[0]];
 s.pools[0].water=s.pools[0].salt=0;
 const donor=addWetRegion(s,top,[1,0],1e-6,0);
 for(const amount of [1e-6,4e-6,9e-6,16e-6]){
  donor.water=amount;syncFace(top);
  stepWetRegions(s,.1,{geometry:trackGeometry,neighbors:()=>[],react:()=>{},exchange:(a,b)=>{if(a===donor){a.water-=1e-9;b.water+=1e-9;}}});
 }
 assert.equal(side.regions.filter(r=>r.water>0).length,1,'continuous corner inflow manufactured disconnected spots');
 const entry=side.regions.find(r=>r.water>0).lobes[0].entry;assert.ok(Math.abs(entry[0])<1e-12&&Math.abs(entry[1]-1)<1e-12);
});
test('local supply reaches one seed directly; the others require liquid connections',()=>{
 const s=createCrust({setup:'neighbors',wetting:'regions',supply:'local'}),source=s.sources[0];
 const fed=new Set(s.pools.filter(p=>p.kind==='edge'&&p.a===source).map(p=>s.pools[p.b].grain));
 assert.deepEqual([...fed],[0]);assert.equal(readCrust(s).supply,'local');assert.equal(restoreCrust(saveCrust(s)).supply,'local');
});
test('separating liquid renews independent birth clocks rather than dividing event progress',async()=>{
 const {addWetRegion,mergeWetRegions}=await import('../mineral-worlds/crust-regions.mjs');
 const s=specimen(),p=s.pools[s.grains[0].facePools[4]],cap=.22**2*.016;
 addWetRegion(s,p,[.25,.25],cap*.25,cap*.5);addWetRegion(s,p,[.6,.6],cap*.25,cap*.25);mergeWetRegions(s,p);
 p.regions[0].hazard=.2;p.regions[0].threshold=1;p.regions[0].water*=.01;mergeWetRegions(s,p);
 assert.equal(p.regions.length,2);assert.ok(p.regions.every(r=>r.hazard===0&&r.threshold>0));assert.notEqual(p.regions[0].threshold,p.regions[1].threshold);
});
test('unequal wet spots sharing an edge exchange without spawning a duplicate spot',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');const {trackGeometry}=await import('../mineral-worlds/crust.mjs');
 const s=specimen();s.pools[0].water=s.pools[0].salt=0;s.settings.mobility=100;
 const g=s.grains[0],side=s.pools[g.facePools[0]],top=s.pools[g.facePools[4]],cap=trackGeometry(s,side).capacity;
 addWetRegion(s,side,[.4,1],cap*.64,cap*.64);addWetRegion(s,top,[1,.1],cap*.04,cap*.04);
 advanceCrust(s,.1);assert.equal(top.regions.length,1,'already connected edge produced a second receiving spot');
});
test('dryout separates residue locations and rewetting cannot jump a dry interval',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');const {trackGeometry}=await import('../mineral-worlds/crust.mjs');
 const s=specimen(),g=s.grains[0],p=s.pools[g.facePools[0]],cap=trackGeometry(s,p).capacity;s.pools[0].water=s.pools[0].salt=0;s.settings.evaporation=100;
 addWetRegion(s,p,[.5,0],cap*.25,cap*.25);addWetRegion(s,p,[.5,.45],cap*.25,cap*.25);advanceCrust(s,.1);
 s.settings.evaporation=0;s.settings.mobility=12000;s.pools[0].water=s.pools[0].salt=cap*.01;advanceCrust(s,.1);
 const remote=p.regions.find(r=>r.lobes.some(l=>l.entry[1]===.45));assert.ok(remote);assert.equal(remote.water,0,'resupply jumped to remote dry residue');
});
test('fresh water covering a dry salt spot can redissolve it',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');const {trackGeometry}=await import('../mineral-worlds/crust.mjs');
 const s=specimen(),p=s.pools[s.grains[0].facePools[4]],cap=trackGeometry(s,p).capacity;
 const dry=addWetRegion(s,p,[.5,.5]);dry.residue=1e-4;addWetRegion(s,p,[.2,.2],cap,0);
 advanceCrust(s,.1);assert.equal(p.residue,0);assert.ok(Math.abs(p.salt-1e-4)<1e-12);
});
test('parent-child liquid enters the receiving attachment perimeter in both directions',async()=>{
 const {addWetRegion}=await import('../mineral-worlds/crust-regions.mjs');const {trackGeometry}=await import('../mineral-worlds/crust.mjs');
 const original=createCrust({setup:'neighbors',wetting:'regions'});advanceCrust(original,3);
 const edge=original.pools.find(p=>p.kind==='edge'&&!p.surfaceEdge&&original.pools[p.a].kind==='face');assert.ok(edge);
 for(const reverse of [false,true]){
  const s=restoreCrust(saveCrust(original));for(const p of s.pools){p.water=p.salt=p.residue=0;if(p.regions)p.regions=[];}
  Object.assign(s.settings,{feed:0,evaporation:0,growth:0,nucleation:0,mobility:12000});
  const from=s.pools[reverse?edge.b:edge.a],to=s.pools[reverse?edge.a:edge.b],entry=reverse?edge.portB:edge.portA,expected=[...(reverse?edge.portA:edge.portB)],extent=[...((reverse?edge.contactA:edge.contactB)??[0,0])];
  addWetRegion(s,from,entry,trackGeometry(s,from).capacity*.01,0);advanceCrust(s,.1);
  const current=s.pools[edge.id];expected.splice(0,2,...(reverse?current.portA:current.portB));extent.splice(0,2,...((reverse?current.contactA:current.contactB)??[0,0]));
  const wet=to.regions.filter(r=>r.water>0);assert.ok(wet.length);
  assert.ok(wet.every(r=>r.lobes.every(l=>l.entry.every((v,i)=>Math.abs(v-expected[i])<=extent[i]+1e-8))),'arrival jumped off attachment perimeter: '+JSON.stringify({reverse,expected,extent,entries:wet.map(r=>r.lobes.map(l=>l.entry))}));
 }
});
test('closed bridges clear their live connection and flux while retaining trapped liquid',async()=>{
 const {refreshBridges,bridgeGeometry}=await import('../mineral-worlds/crust-bridges.mjs');
 const s=specimen();refreshBridges(s);const e=s.pools.find(p=>p.kind==='bridge'),a=s.pools[e.a],g=s.grains[a.grain];
 e.connected=true;e.lastFlux=.01;e.water=.0001;g.faces[a.face]+=(a.face%2===0?1:-1)*bridgeGeometry(s,e).aperture*2;
 advanceCrust(s,.1);assert.equal(e.connected,false);assert.equal(e.lastFlux,0);assert.equal(e.water,.0001);
});
