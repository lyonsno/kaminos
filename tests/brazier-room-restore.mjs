// kaminos-test: node
import assert from 'node:assert/strict';
import {isReloadableSceneObjectRecord,planSceneRestore} from '../scene-persistence-core.js';
// Observed room record from the operator's beamings-braziers saved scene.
const room={id:'experiment-14c88643-d256-4cd6-b579-5423f19d5d69',type:'experiment',source:'http://127.0.0.1:18706/scratch/brazier-corridor-1024/factor-2/',label:'Two-brazier corridor',transform:{position:[0,1.25,0],rotation:[0,0,0],scale:[8,8,8]}};
assert.equal(isReloadableSceneObjectRecord(room),true,'the existing saved corridor room must be reconstructible');
assert.equal(isReloadableSceneObjectRecord({...room,source:'http://127.0.0.1:18706/scratch/unknown/'}),false,'unrelated experiments remain unsupported');
assert.equal(isReloadableSceneObjectRecord({...room,source:'javascript:alert(1)'}),false);
console.log('saved brazier room reconstruction admission passed');
