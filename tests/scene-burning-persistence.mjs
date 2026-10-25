// kaminos-test: node
import assert from 'node:assert/strict';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';

const wood={id:'wood',type:'glb',source:'/api/read?root=assets&path=wood.glb',burnable:{enabled:true,material:'wood'}};
const document=buildSceneDocument({objects:[wood,{...wood,id:'second'}]});
assert.deepEqual(document.objects.map(object=>object.burnable),[wood.burnable,wood.burnable], 'ordinary scene saves each burnable without requiring a fire or experiment');
assert.deepEqual(planSceneRestore(document).objects[0].burnable,wood.burnable);
assert.deepEqual(buildSceneDocument({objects:[{...wood,burnable:{enabled:false,material:'wood'}}]}).objects[0].burnable,{enabled:false,material:'wood'});
for(const burnable of [{enabled:1,material:'wood'},{enabled:true,material:'metal'}])
  assert.throws(()=>buildSceneDocument({objects:[{...wood,burnable}]}),/burnable/i);
assert.throws(()=>buildSceneDocument({objects:[{...wood,type:'image'}]}),/burnable/i);
assert.equal(buildSceneDocument({objects:[{...wood,burnable:undefined}]}).objects[0].burnable,undefined);
