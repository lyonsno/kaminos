// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {Group} from '../lib/three.core.js';
import {createAshSceneObject} from '../ash/scene-object.mjs';
import {defaultAshSettings} from '../ash/scene-record.mjs';
const settings={...defaultAshSettings(),width:12.8,depth:6.4,height:2.4,cellSize:.025,initialDepth:0,refinement:{ratio:2,mode:'adaptive',fineFraction:.125}};
const record=ash=>({id:'capacity-field',type:'retained-ash',source:'kaminos:retained-ash',transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},ash});
const renderer=limit=>({backend:{device:{limits:{maxStorageBufferBindingSize:limit,maxBufferSize:limit}}}});
// Declared limits exercise the real admission caller. A construction sentinel
// observes its continuation without allocating a large GPU field.
test('native compact field admission reaches construction when only legacy records exceed capacity',async()=>{
 const sentinel=Error('construction reached');let calls=0;
 await assert.rejects(createAshSceneObject({record:record(settings),renderer:renderer(128*1024**2),readObjects:()=>[],createPatch:async()=>{calls++;throw sentinel;}}),error=>error===sentinel);
 assert.equal(calls,1);
});
test('native admission rejects an actual selected surface excess before construction',async()=>{
 let calls=0;await assert.rejects(createAshSceneObject({record:record(settings),renderer:renderer(16*1024**2),readObjects:()=>[],createPatch:async()=>{calls++;throw Error('must not construct');}}),/effective GPU capacity/);assert.equal(calls,0);
});
test('native regrid uses the selected surface capacity and preserves the field on rejection',async()=>{
 let calls=0;const object=await createAshSceneObject({record:record({...settings,width:3.2,depth:3.2,height:.8,cellSize:.04}),renderer:renderer(128*1024**2),readObjects:()=>[],createPatch:async()=>{calls++;return {root:new Group(),syncScene(){},read:()=>({}),dispose(){}};}});
 try{
  await object.regrid(settings);assert.equal(calls,2);assert.equal(object.read().settings.cellSize,.025);
  const before=object.read().settings;await assert.rejects(object.regrid({...settings,cellSize:.0125}),/effective GPU capacity/);assert.equal(calls,2);assert.deepEqual(object.read().settings,before);
 }finally{object.dispose();}
});
test('uniform field admission retains its existing capacity check',async()=>{
 let calls=0;await assert.rejects(createAshSceneObject({record:record({...settings,width:.8,depth:.8,height:.8,cellSize:.1,refinement:null}),renderer:renderer(10000),readObjects:()=>[],createPatch:async()=>{calls++;throw Error('must not construct');}}),/effective GPU capacity/);assert.equal(calls,0);
});
