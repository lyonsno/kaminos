// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneBurning} from '../scene-burning.mjs';

let objects=[],retained=[],active=false,consumer=null,binds=0,gasDisposals=0;
const events=[],created=new Map();
const runtime={debugState:()=>({active}),borrowThermalGpuContext:async()=>({device:'device'}),bindGpuThermalConsumer(value){assert.equal(consumer,null);consumer=value;binds++;return()=>{consumer=null;};},
  setActive(){assert.fail('component changed global activation');},setSimulationPaused(){assert.fail('component changed global pause');},resetThermalExperimentFluid(){assert.fail('component reset the shared field');}};
const gas={descriptor:{device:'device'},begin:()=>events.push('begin'),resolve:()=>events.push('resolve'),resize:d=>events.push(d),read:()=>({}),dispose:()=>gasDisposals++};
const burning=createSceneBurning({objects:()=>objects,retained:()=>retained,runtime:()=>runtime,createGas:async()=>gas,createBody:async entry=>{
  created.set(entry.id,(created.get(entry.id)||0)+1);
  let steps=0;
  return {setMounted:value=>events.push(entry.id+':mounted:'+value),encodeGasSource:()=>events.push(entry.id+':gas'),encode:()=>steps++,materialMask:()=>entry.id,read:()=>({steps}),dispose:()=>events.push(entry.id+':dispose')};
}});
const object=id=>({id,object:{},burnable:{enabled:true,material:'wood'}});
objects=[object('a'),object('b')];await burning.sync();assert.equal(binds,0);assert.equal(created.size,0);
assert.equal(burning.read('a').status,'waiting-for-fire');
active=true;await burning.sync();assert.equal(binds,1);assert.equal(created.size,2);
events.length=0;consumer.prepareSource({},{});consumer.encode({},{});
assert.deepEqual(events,['begin','a:gas','b:gas','resolve']);assert.deepEqual(consumer.materialMasks(),['a','b']);
objects[0].burnable.enabled=false;await burning.sync();assert.equal(burning.read('b').state.steps,1);assert.equal(binds,1);assert.equal(gasDisposals,0);
assert.ok(events.includes('a:dispose'));consumer.encode({},{});assert.equal(burning.read('b').state.steps,2);
retained=[objects.pop()];await burning.sync();assert.equal(consumer,null);assert.equal(gasDisposals,1);assert.ok(!events.includes('b:dispose'));
objects.push(retained.pop());await burning.sync();assert.equal(created.get('b'),1);assert.equal(burning.read('b').state.steps,2);
retained=[{...objects[1],burnable:{enabled:true,material:'wood'}}];
objects[1].burnable.enabled=false;await burning.sync();assert.ok(events.includes('b:dispose'));assert.equal(consumer,null);
await burning.dispose();

// A disable while GPU preparation is pending must dispose the late result.
let release;objects=[object('late')];let lateDisposed=0;
const late=createSceneBurning({objects:()=>objects,runtime:()=>runtime,createGas:async()=>gas,createBody:()=>new Promise(resolve=>{release=()=>resolve({dispose:()=>lateDisposed++});})});
const setup=late.sync();await new Promise(resolve=>setImmediate(resolve));objects[0].burnable.enabled=false;release();await setup;
assert.equal(lateDisposed,1);await late.dispose();assert.equal(consumer,null);

// Resource disposal must restore the source material before the host destroys it.
objects=[object('purged')];let purged=0;
const purge=createSceneBurning({objects:()=>objects,runtime:()=>runtime,createGas:async()=>gas,createBody:async()=>({dispose:()=>purged++})});
await purge.sync();purge.forget?.(objects[0].object);
assert.equal(purged,1,'Host disposal releases the live material wrapper synchronously');
objects=[];await purge.dispose();assert.equal(purged,1);
