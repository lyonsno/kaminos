// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import * as THREE from '../lib/three.core.js';
import * as emitters from '../scene-flame-emitter.mjs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const block=(name,next)=>html.slice(html.indexOf(`function ${name}(`),html.indexOf(`function ${next}(`));
const pose=x=>({position:[x,-.5,0],rotation:[0,0,0],scale:[1,1,1]});
const record=(id,x)=>({id,type:'flame-emitter',source:'kaminos:analytic-flame',label:id,emissionEnabled:true,transform:pose(x)});
function host(){
 const ctx={...emitters,THREE,structuredClone,scene:new THREE.Scene(),sceneObjects:[],authoredFlamePresent:true,flameEmitterPose:pose(-.3),applyFlameEmitterPose:()=>{},window:{__kaminosVolumeEmitterReceipt:{effective:{family:'ring'},requested:{inputRadius:.2}}},
  isFireLightFieldRoute:()=>true,scenePlacementTools:null,activeSceneObjectId:null,clearActiveSceneObjectSelection:()=>{},disposeObjectTree:()=>{},pruneSceneGroups:()=>{},pruneSceneSelection:()=>{},renderSceneObjectList:()=>{},refreshFlameDomainPreview:()=>{},flameDomainGuide:null,
  activeSceneComposition:{},selectionCaptureSuspended:false,viewportHelpersVisible:true,viewportDisplay:{domains:true,domainOpacity:1,emitters:true,emitterOpacity:1},isSceneItemVisible:()=>true,styleHelperLines:()=>{},applySceneObjectTransformState:(object,p)=>{object.position.fromArray(p.position);object.rotation.fromArray(p.rotation);object.scale.fromArray(p.scale);},
  setActiveSceneObject:()=>{},primaryAuthoredFlameSource:()=>ctx.sceneObjects.find(o=>o.id==='flame-emitter')??ctx.sceneObjects.find(o=>o.type==='flame-emitter'),
  registerSceneObject:(object,metadata)=>{const r={...metadata,object};object.userData.kaminosSceneObject={...metadata};ctx.sceneObjects.push(r);return r;}};
 vm.createContext(ctx);vm.runInContext(block('ensureAuthoredFlameEmitter','acceptedFlameDomainPose'),ctx);return ctx;
}
test('ordinary host mounts two distinct emitter handles and restores each authored pose',()=>{
 const h=host();h.ensureAuthoredFlameEmitter(record('flame-emitter',-.3));h.ensureAuthoredFlameEmitter(record('flame-source-second',.35));
 assert.equal(h.sceneObjects.length,2,'second source must not overwrite the fixed-id source');
 assert.deepEqual(h.sceneObjects.map(o=>o.id),['flame-emitter','flame-source-second']);
 assert.equal(h.sceneObjects[0].object.position.x,-.3);assert.equal(h.sceneObjects[1].object.position.x,.35);
 h.ensureAuthoredFlameEmitter();
 assert.equal(h.sceneObjects[1].object.position.x,.35,'primary refresh must not move another source');
});
test('a remaining source does not recreate a deleted original emitter',()=>{
 const h=host();h.ensureAuthoredFlameEmitter(record('flame-source-second',.35));h.ensureAuthoredFlameEmitter();
 assert.deepEqual(h.sceneObjects.map(o=>o.id),['flame-source-second']);
});
test('ordinary Duplicate accepts flame source objects',()=>{
 const ctx={LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',FLAME_EMITTER_TYPE:'flame-emitter',PROCEDURAL_MESH_TYPE:'procedural-mesh',CAMERA_TYPE:'camera'};vm.createContext(ctx);vm.runInContext(block('canDuplicateObject','duplicateSceneObject'),ctx);
 assert.equal(ctx.canDuplicateObject(record('flame-source-second',.35)),true);
});

test('source property edits publish only the target data and Undo keeps the other supply unchanged',async()=>{
 const {createSceneEdits}=await import('../scene-edit-session.mjs');
 const {checkedFireSourceRecord,fireControlOwner,flameSourceInputs}=await import('../scene-fire-domain.mjs');
 const sourceHtml=process.env.KAMINOS_AUTHORING_SOURCE?fs.readFileSync(process.env.KAMINOS_AUTHORING_SOURCE,'utf8'):html;
 const start=sourceHtml.indexOf('const flameSourceDataTargets=new Set();');
 assert.ok(start>=0,'source property edits need a per-object history target');
 const code=sourceHtml.slice(start,sourceHtml.indexOf('function acceptedFlameDomainPose(',start));
 const a={...record('flame-emitter',-.3),emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':{value:.25}}}},b={...record('other',.35),emission:{domainId:'flame-field',settings:{'volume-immersed-fuel':{value:.8}}}};
 const objects=[a,b].map(record=>{const object=new THREE.Object3D();object.userData.kaminosSceneObject={};return {...record,object};});
 const edits=createSceneEdits({read:()=>null,write(){}}),publications=[];
 const ctx={structuredClone,checkedFireSourceRecord,fireControlOwner,sceneObjects:objects,scenePlacementTools:{edits},flameInspector:null,ensureAuthoredFlameEmitter:()=>{},
  authoredFlameSourceRecords:()=>objects.map(o=>checkedFireSourceRecord({...o,object:undefined})),primaryAuthoredFlameSource:()=>objects[0],
  document:{getElementById:()=>({tagName:'INPUT',type:'range'})},sceneObjectTransformState:()=>pose(0),
  applyFlameEmitterPose:()=>assert.fail('editing the other source must not apply the primary pose'),
  syncAuthoredFlameSources:()=>publications.push(flameSourceInputs(objects.map(o=>({...o,object:undefined})),{controls:{emitterSourceLaw:'immersed-source'}}))};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 ctx.editAuthoredFlameSource('other',{'volume-immersed-fuel':.65});
 assert.equal(a.emission.settings['volume-immersed-fuel'].value,.25);
 assert.equal(objects[1].emission.settings['volume-immersed-fuel'].value,.65);
 assert.equal(publications.at(-1)[1].controls.immersedFuel,.65);
 await edits.undo();assert.equal(objects[1].emission.settings['volume-immersed-fuel'].value,.8);
 await edits.redo();assert.equal(objects[1].emission.settings['volume-immersed-fuel'].value,.65);
 ctx.editAuthoredFlameSource('other',{enabled:false});
 assert.equal(publications.at(-1)[0].controls.immersedSourceEnabled,true);
 assert.equal(publications.at(-1)[1].controls.immersedSourceEnabled,false);
 await edits.undo();assert.equal(publications.at(-1)[1].controls.immersedSourceEnabled,true);
 assert.equal(edits.state().active,null);
});


test('moving a source in a plural field never relocates or restarts its shared gas',()=>{
 const sources=[record('flame-emitter',-.3),record('other',.35)];
 const h={sceneObjects:sources,FLAME_EMITTER_TYPE:'flame-emitter',flameDomainFollowSource:true,flameDomainTranslation:[0,0,0],flameDomainScale:1,flameEmitterInjectionSuspended:true,
  flameDomainTranslationForAcceptedPose:()=>[9,0,0],readVolumeControls:()=>({}),effectiveFlameDomainControls:x=>x,volumePrototype:{},setInfo:()=>{},
  setFlameDomainTranslation:()=>assert.fail('source move must leave the shared field in place'),writeAuthoredFlameEmitterPose:()=>assert.fail('no relocation rewrite')};
 vm.createContext(h);vm.runInContext(block('settleFlameDomainForPose','writeAuthoredFlameEmitterPose'),h);
 assert.equal(h.settleFlameDomainForPose(pose(9)),false);
 assert.equal(h.settleFlameDomainForPose(pose(9),[1,0,0]),false,'source Undo must not relocate a plural field either');
});


test('compatibility state follows the remaining source after deleting the original',()=>{
 const remaining={...record('other',.35),emissionEnabled:false};
 const h={window:{},structuredClone,sceneObjects:[remaining],FLAME_EMITTER_ID:'flame-emitter',primaryAuthoredFlameSource:()=>remaining,authoredFlamePresent:true,
 flameEmitterPose:remaining.transform,authoredFlameSourceRecords:()=>[remaining],flameDomainTranslation:[0,0,0],flameDomainScale:1,flameDomainFollowSource:true,flameEmitterInjectionSuspended:false};
 vm.createContext(h);vm.runInContext(html.slice(html.indexOf('window.kaminosFlameEmitterState ='),html.indexOf('function cloneTransformState(')),h);
 assert.equal(h.window.kaminosFlameEmitterState().registered,true);
 assert.equal(h.window.kaminosFlameEmitterState().emissionEnabled,false);
});
