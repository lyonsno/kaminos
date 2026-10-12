import assert from 'node:assert/strict';
import {validateStoneObservationStamp,reconstructStoneObservation} from './structural-material-observation-economics.mjs';

export function createStoneObservationRuntime({call,resources,resourceDirectory}){
 const acquired=new Map();
 let acquisitions=0;
 const readStamp=()=>call('window.__stoneShards.observationStamp()');
 return {
  settle:()=>call('(async()=>{await window.__stoneShards.settle({surface:false});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));})()'),
  camera:view=>call(`window.__stoneShards.camera(${JSON.stringify(view)})`),
  stability:{read:readStamp,validate:validateStoneObservationStamp,assertStable:(a,b)=>assert.deepEqual(a,b,'Stone changed across capture')},
  async read(){
   const stamp=await readStamp();validateStoneObservationStamp(stamp);
   let resource;
   const reference=await resources.retain({key:'bounded-stone-cells',version:stamp.resourceVersion,read:async()=>{
    resource=JSON.parse(await call('JSON.stringify(window.__stoneShards.observationResources())'));
    assert.equal(resource.version,stamp.resourceVersion,'Stone resource changed during acquisition');
    acquired.set(resource.version,resource);acquisitions++;return resource;
   }});
   const dynamic=JSON.parse(await call('(async()=>{await window.__stoneShards.surfacePositions();return JSON.stringify(window.__stoneShards.witness({resources:false}));})()'));
   assert.equal(dynamic.runId,reference.version,'Stone changed during observation');
   return {...dynamic,resource:{directory:resourceDirectory,reference}};
  },
  reconstruct(dynamic){return reconstructStoneObservation(dynamic,acquired.get(dynamic.resource.reference.version));},
  acquisitions:()=>acquisitions,
 };
}
