// kaminos-test: node
import {sceneContext,runInSceneContext} from './helpers/scene-context.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
test('formerly reserved light transforms use the ordinary object pose owner',()=>{
 const start=html.indexOf('function applyAuthoredScenePose('),end=html.indexOf('function validateLiveLocalLiquidEmitterPose',start);
 let applied=null;
 const entry={id:'@rim-light',type:'light',object:{}};
 const context=sceneContext({CAMERA_TYPE:'camera',updateSelectionFeedback(){},sceneObjects:[entry],FLAME_EMITTER_TYPE:'flame-emitter',LOCAL_LIQUID_EMITTER_TYPE:'local-liquid-emitter',RIM_LIGHT_ID:'@rim-light',
  restoringSceneLight:false,serializeSceneObject:e=>({id:e.id,type:e.type,source:'kaminos:scene-spot-light',light:{kind:'spot'}}),sceneLightRuntimeRecipe:r=>r,setRimLight(){throw Error("obsolete rim setter was called");},mountSceneSpotLight:record=>{applied=record.transform;},writeAuthoredRimPose:pose=>{applied=pose;},applySceneObjectTransformState(){},updateTransformInspector(){},window:{kaminosSceneObjectDebugState:()=>[entry]}});
 vm.runInContext(html.slice(start,end),context);
 vm.runInContext("applyAuthoredScenePose('@rim-light',{position:[1,2,3],rotation:[0,1,0],scale:[1,1,1]})",context);
 assert.deepEqual(applied?.position && Array.from(applied.position),[1,2,3]);
});

test('selected flame shortcuts bind controls present in the Volume cockpit',()=>{
 const body=html.slice(html.indexOf('function createFlameQuickFields()'),html.indexOf('function installAuthoringParameterEditing()'));
 for(const match of body.matchAll(/\['(volume-[^']+)'\s*,/g))assert.ok(html.includes(`id="${match[1]}"`),`missing source control ${match[1]}`);
});

