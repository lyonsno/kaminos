// kaminos-test: node
import assert from 'node:assert/strict';
import {checkedBurnable} from '../scene-burning-settings.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
const record={id:'wood',type:'glb',source:'/api/read?root=assets&path=wood.glb',burnable:{enabled:true,material:'wood',structure:true}};
assert.equal(checkedBurnable(record).structure,true,'The ordinary burn property must retain requested structural analysis');
assert.equal(planSceneRestore(buildSceneDocument({objects:[record]})).objects[0].burnable.structure,true);
assert.throws(()=>checkedBurnable(record,{...record.burnable,structure:'yes'}),/structure/i);
assert.deepEqual(checkedBurnable(record,{enabled:true,material:'wood'}),{enabled:true,material:'wood'},'Existing burn settings preserve their meaning');
