import assert from 'node:assert/strict';
import * as economics from '../structural-material-observation-economics.mjs';
assert.ok(economics.assertStableStoneObservationStamps,'Physical and camera stability need distinct semantic comparisons');
const camera={position:[1,2,3],target:[0,1,0],up:[0,1,0],near:.01,far:100,fov:40},data={route:'kaminos.picked-stone.bounded-shards.webgpu.v0',state:{runId:'run',steps:60,observation:{kind:'full-diagnostic'},state:[1,2,3]},resourceVersion:'run',configuration:{gravity:9.81},camera,paused:true,busy:false,pendingPick:false,finishing:false,failure:null};
const stamp=await economics.stoneObservationStamp(data),jitter=await economics.stoneObservationStamp({...data,camera:{...camera,position:[1+1e-15,2,3]}});
assert.notEqual(stamp.digest,jitter.digest,'Raw all-data hash still records every value');
assert.deepEqual(jitter.camera.position,[1+1e-15,2,3],'Raw camera values are never rounded away');
assert.doesNotThrow(()=>economics.assertStableStoneObservationStamps(stamp,jitter));
for(const changed of [{...data,camera:{...camera,position:[1.001,2,3]}},{...data,camera:{...camera,fov:41}},{...data,state:{...data.state,state:[1,2,3.01]}},{...data,state:{...data.state,steps:61}},{...data,configuration:{gravity:0}}]){const next=await economics.stoneObservationStamp(changed);assert.throws(()=>economics.assertStableStoneObservationStamps(stamp,next),/changed|camera/i);}
assert.throws(()=>economics.assertStableStoneObservationStamps({...stamp,physicalDigest:null},stamp),/physical/i);
assert.throws(()=>economics.assertStableStoneObservationStamps({...stamp,camera:null},stamp),/camera/i);
assert.throws(()=>economics.assertStableStoneObservationStamps({...stamp,route:'fallback'},stamp),/stone/i);
console.log('Raw values retained; float camera jitter accepted; physical, meaningful pose, lens and route drift rejected');
