// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneObjectRecord} from '../scene-object-record.mjs';
const root={userData:{}};
const metadata={type:'glb',burnable:{enabled:true,material:'wood'}};
const entry=createSceneObjectRecord(root,metadata,{id:'prompt'});
assert.deepEqual(entry.burnable,metadata.burnable,'working-scene admission retains combustion settings');
assert.deepEqual(root.userData.kaminosSceneObject.burnable,metadata.burnable,'saved object identity carries the same combustion setting');
metadata.burnable.enabled=false;
assert.equal(entry.burnable.enabled,true,'admitted state is independent of caller metadata');
assert.throws(()=>createSceneObjectRecord({userData:{}},{type:'image',burnable:{enabled:true,material:'wood'}},{id:'image'}),/mesh object/);
