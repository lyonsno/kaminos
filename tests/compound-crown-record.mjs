// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneRecordOperations} from '../scene-record-operations.mjs';
import {createCrownObject,CROWN_SOURCE,crownOutputs} from '../compound-crown-record.mjs';
import {buildSceneDocument,planSceneRestore} from '../scene-persistence-core.js';
import {defaultFlameAttachment} from '../flame-attachment.mjs';
const recipe={opening:.7,swirl:.2,vaneCount:12,irisCount:10,rate:.12,playing:false};
const raw={id:'crown',type:'pbr',source:CROWN_SOURCE,compoundCrown:recipe,transform:{position:[2,0,0],rotation:[0,.2,0],scale:[.5,.5,.5]},flameAttachment:{...defaultFlameAttachment(),radius:{output:'clearRadius',factor:.8}}};
const ops=createSceneRecordOperations({readers:{transform:()=>raw.transform,materials:()=>null},loaders:{constructed:(object,record)=>({object,record})}});
const normalized=ops.normalize(raw);assert.deepEqual(normalized.compoundCrown,recipe);assert.deepEqual(normalized.flameAttachment,raw.flameAttachment);assert.equal(ops.reloadable(normalized),true);
const object=createCrownObject(raw);object.userData.kaminosSceneObject=normalized;
const serialized=ops.serialize({...normalized,object});assert.deepEqual(serialized.flameAttachment,raw.flameAttachment);assert.deepEqual(serialized.compoundCrown,recipe);
const restored=await ops.load(JSON.parse(JSON.stringify(serialized)));assert.equal(restored.object.name,'Compound Crown');assert.deepEqual(restored.record.compoundCrown,recipe);
assert.ok(crownOutputs(recipe).clearRadius>0);assert.equal(crownOutputs({...recipe,opening:0}).clearRadius,0);
assert.throws(()=>ops.normalize({...raw,flameAttachment:{...raw.flameAttachment,feed:-1}}),/feed/);
assert.throws(()=>ops.normalize({...raw,compoundCrown:undefined}),/complete mechanism recipe/);
const document=buildSceneDocument({objects:[raw]});assert.equal(document.version,12,'older clients must refuse attachments rather than dropping behavior');assert.deepEqual(planSceneRestore(JSON.parse(JSON.stringify(document))).objects[0].flameAttachment,raw.flameAttachment);
console.log('Compound Crown: ordinary admission, source reconstruction, recipe and generic attachment retained');
