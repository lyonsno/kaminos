// kaminos-test: node
import assert from 'node:assert/strict';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {defaultFlameAttachment,createFlameAttachmentEditor} from '../flame-attachment.mjs';
import {createCrownObject,writeCrownRecipe,CROWN_SOURCE} from '../compound-crown-record.mjs';
import {crownRecipe} from '../experiments/compound-crown/mechanism.mjs';
import {createSceneRepetitionController} from '../scene-repetition-controller.mjs';
const edits=createSceneEdits({read:()=>null,write(){}});let accepted=null,legacy=true,failWrite=false;
const editor=createFlameAttachmentEditor({edits,read:()=>accepted,check:(_id,value)=>{if(value&&legacy)throw Error('Multiple scene sources require the immersed source law');},write:(_id,value)=>{accepted=value;if(failWrite&&value?.feed===.8)throw Error('runtime admission failed');}});
const before=edits.state();assert.throws(()=>editor.set('mesh',defaultFlameAttachment()),/immersed source law/);assert.equal(accepted,null);assert.equal(edits.state().active,null);assert.equal(edits.state().undoCount,before.undoCount);
legacy=false;editor.set('mesh',defaultFlameAttachment());assert.equal(accepted.radius.value,.2);await edits.undo();assert.equal(accepted,null);await edits.redo();assert.equal(accepted.radius.value,.2);
failWrite=true;const prior=structuredClone(accepted),undoCount=edits.state().undoCount;assert.throws(()=>editor.set('mesh',{...prior,feed:.8}),/runtime admission failed/);assert.deepEqual(accepted,prior);assert.equal(edits.state().active,null);assert.equal(edits.state().undoCount,undoCount);
const recipe=crownRecipe(),root=createCrownObject({compoundCrown:recipe}),entry={id:'crown',type:'pbr',source:CROWN_SOURCE,object:root,compoundCrown:recipe,repetition:{schema:'kaminos.repetition.v1',mode:'line',count:3,axis:'y',angle:360,step:[4,0,0],space:'world',center:[0,0,0],mirror:[false,false,false]}};
root.userData.kaminosSceneObject={compoundCrown:recipe};
const repetition=createSceneRepetitionController({objects:()=>[entry],groups:()=>[],readPose:()=>({position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]})});
repetition.sync();const copies=()=>root.children.filter(n=>n.userData.kaminosRepetitionCopy);assert.equal(copies().length,2);
writeCrownRecipe(entry,{...recipe,opening:.8},repetition);repetition.sync();assert.equal(copies().length,2);assert.equal(entry.compoundCrown.opening,.8);
const ledger=createSceneEdits({read:()=>null,write(){}});ledger.register('@mechanism',{check:v=>({recipe:crownRecipe(v.recipe)}),read:()=>({recipe:entry.compoundCrown}),write:({recipe})=>writeCrownRecipe(entry,recipe,repetition)});ledger.apply('@mechanism',{recipe:{...recipe,opening:.2}},'Open iris');assert.equal(copies().length,2);await ledger.undo();assert.equal(entry.compoundCrown.opening,.8);assert.equal(copies().length,2);await ledger.redo();assert.equal(copies().length,2);
ledger.begin('@mechanism','Preview iris');ledger.preview({recipe:{...recipe,opening:.9}});assert.equal(copies().length,2);await ledger.cancel();assert.equal(entry.compoundCrown.opening,.2);assert.equal(copies().length,2);
// A drag changes rigid part poses, not the mesh/resource population. Repeated
// geometry must follow those poses without being reconstructed at each input.
const originalCopies=copies(),part=root.getObjectByName('iris-leaf-0'),oldAngle=part.rotation.y;
const meshes=[];root.traverse(n=>{if(n.isMesh)meshes.push(n);});
const resources=new Set(meshes.flatMap(n=>[n.geometry,...[n.material].flat()]));let disposals=0;
for(const resource of resources)resource.addEventListener('dispose',()=>disposals++);
ledger.begin('@mechanism','Drag iris');
for(let i=0;i<32;i++){
 ledger.preview({recipe:{...recipe,opening:.3+i*.02,swirl:i*.02}});
 assert.ok(root.getObjectByName('iris-leaf-0')===part,'pose edits retain the mechanism parts');
}
ledger.commit();
assert.ok(root.getObjectByName('iris-leaf-0')===part,'pose edits retain the mechanism parts');
assert.notEqual(part.rotation.y,oldAngle);
assert.equal(disposals,0,'dragging must not dispose geometry or materials');
assert.deepEqual(copies().map(n=>n.uuid),originalCopies.map(n=>n.uuid),'linked instances survive the drag');
const after=[];root.traverse(n=>{if(n.isMesh)after.push(n);});assert.deepEqual(after.map(n=>n.uuid),meshes.map(n=>n.uuid));
for(const copy of copies())assert.equal(copy.getObjectByName('iris-leaf-0').rotation.y,part.rotation.y,'linked leaf follows the source');
await ledger.undo();assert.equal(entry.compoundCrown.opening,.2);await ledger.redo();assert.equal(entry.compoundCrown.opening,.3+31*.02);
// Changing part counts is structural and still rebuilds the producer geometry.
writeCrownRecipe(entry,{...entry.compoundCrown,irisCount:12},repetition);
assert.notEqual(root.getObjectByName('iris-leaf-0'),part);assert.ok(disposals>0);
assert.equal(copies().length,2);for(const copy of copies())assert.ok(copy.getObjectByName('iris-leaf-11'));
console.log('attachment refusal/recovery and repeated Crown history pass');
