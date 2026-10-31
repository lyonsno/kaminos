// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {createCrust,saveCrust} from '../mineral-worlds/crust.mjs';
const record=()=>({id:'crystal-1',type:'crystal-growth',source:'kaminos:crystal-growth',label:'Salt crystals',transform:{position:[2,0,1],rotation:[0,.2,0],scale:[1,1,1]},crystalGrowth:{schema:'kaminos.crystal-growth.v1',state:saveCrust(createCrust({setup:'neighbors',arrangement:'arcs',tilt:.24})),rate:1,playing:false,interfaces:false,substrate:true,pendingModelSeconds:0}});
test('ordinary scene records retain evolved crystal state and dispatch their native loader',async()=>{
 const records=createSceneRecordOperations({loaders:{crystal:r=>r}}),input=record();
 assert.equal(records.reloadable(input),true,'crystal simulation must reconstruct through scene records');
 const normalized=records.normalize(input);assert.deepEqual(normalized.crystalGrowth,input.crystalGrowth);
 assert.deepEqual(await records.load(normalized),normalized);
 input.crystalGrowth.state.grains[0].faces[0]=99;assert.notEqual(normalized.crystalGrowth.state.grains[0].faces[0],99);
});
test('malformed crystal snapshots cannot pass scene save admission',()=>{
 const records=createSceneRecordOperations(),input=record();input.crystalGrowth.pendingModelSeconds=-1;
 assert.equal(records.reloadable(input),false);
 assert.throws(()=>records.normalize(input));
});

const {createCrystalObject}=await import('../mineral-worlds/crust-object.mjs');
const {crystalRuntime}=await import('../mineral-worlds/crust-record.mjs');
function fixture(){const frames=new Set(),jobs=new Map();let next=0,mounted=true;return {frames,jobs,setMounted(v){mounted=v;},create(snapshot){return createCrystalObject({snapshot,onFrame:fn=>{frames.add(fn);return()=>frames.delete(fn);},isMounted:()=>mounted,requestIdle:fn=>{jobs.set(++next,fn);return next;},cancelIdle:id=>jobs.delete(id)});},frame(dt){for(const fn of frames)fn({deltaSeconds:dt});},flush(){for(const[id,fn]of [...jobs]){jobs.delete(id);fn({timeRemaining:()=>1});}}};}
test('two native crystals evolve independently, retain pending time, and release idle work on removal',()=>{
 const f=fixture(),a=f.create(),b=f.create();a.invoke('play',true);f.frame(.25);f.flush();
 assert.equal(a.read().tick,2);assert.equal(b.read().tick,0);assert.ok(Math.abs(a.read().clock.pendingModelSeconds-.05)<1e-9);
 const saved=a.snapshot(),c=f.create(saved);assert.deepEqual(c.snapshot(),saved);a.invoke('advance',.1);c.invoke('advance',.1);assert.deepEqual(c.snapshot(),a.snapshot());
 f.frame(.2);assert.ok(f.jobs.size);a.setActive(false);c.setActive(false);assert.equal(f.jobs.size,0);
 const tick=a.read().tick;f.frame(1);f.flush();assert.equal(a.read().tick,tick);
 a.dispose();b.dispose();c.dispose();assert.equal(f.frames.size,0);assert.equal(f.jobs.size,0);assert.throws(()=>a.invoke('play',true),/disposed/);
});
test('scene serialization captures live evolution, and invalid restore preserves it',()=>{
 const f=fixture(),a=f.create();a.invoke('advance',.2);const before=a.snapshot();
 const records=createSceneRecordOperations({readers:{transform:()=>record().transform,materials:()=>null}}),entry={...record(),object:a.root};
 a.root.userData.kaminosSceneObject=record();assert.equal(a.root[crystalRuntime],a);
 assert.deepEqual(records.serialize(entry).crystalGrowth,before);
 const invalid=structuredClone(before);invalid.rate=-1;assert.throws(()=>a.invoke('restore',invalid));assert.deepEqual(a.snapshot(),before);
 const checkpoint={schema:'kaminos.capillary-crust.v1',state:before.state,rate:2,interfaces:true,view:{position:[999,999,999]}};
 a.root.position.set(3,4,5);a.invoke('restore',checkpoint);assert.deepEqual(a.root.position.toArray(),[3,4,5]);assert.equal(a.read().rate,2);assert.equal(a.read().tick,2);a.dispose();
});
