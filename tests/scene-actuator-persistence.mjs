// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';

export const pose=position=>({position,rotation:[0,0,0],scale:[1,1,1]});
export const fixture=()=>({id:'piston-1',label:'Lift piston',fixedId:'base',followerId:'boom',barrelId:'barrel',rodId:'rod',
  baseMount:[0,0,0],movingMount:[1,1,0],hinge:[0,1,0],axis:[0,0,1],
  reference:{base:pose([0,0,0]),boom:pose([0,1,0]),barrel:pose([0,0,0]),rod:pose([1,1,0])},
  carried:[],length:Math.sqrt(2),drive:{min:1,max:1.8,period:2,outward:0.5}});
const objects=['base','boom','barrel','rod'].map(id=>({id,type:'glb',source:`/api/read?root=generated-meshes&path=${id}.glb`,transform:pose([0,0,0])}));

test('ordinary scene save and restore retain the actuator recipe, not just the current mesh poses',()=>{
  const actuator=fixture();
  const doc=buildSceneDocument({objects,actuators:[actuator]});
  assert.equal(doc.actuators?.length,1,'Save must retain the installed actuator');
  assert.deepEqual(planSceneRestore(doc).actuators,doc.actuators);
  actuator.baseMount[0]=9;
  assert.equal(doc.actuators[0].baseMount[0],0,'document owns its snapshot');
});

test('older documents restore with no implicit actuator',()=>{
  assert.deepEqual(planSceneRestore(buildSceneDocument({objects})).actuators,[]);
});
