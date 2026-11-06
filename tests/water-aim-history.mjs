// kaminos-test: node
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import * as THREE from '../lib/three.core.js';
import {createSceneEdits} from '../scene-edit-session.mjs';
import {normalizeLocalLiquidEmitter,LOCAL_LIQUID_EMITTER_TYPE} from '../local-liquid-setup.mjs';
import {resolveWaterAim,waterBallisticPreview} from '../water-aim.mjs';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=(name,end)=>{const a=page.indexOf('function '+name+'(');return page.slice(a,page.indexOf(end,a));};
const scene=new THREE.Scene(),object=new THREE.Group(),target=new THREE.Group();object.position.set(0,1,0);object.rotation.x=Math.PI/2;target.position.set(0,1,1);scene.add(object,target);
const initial={schema:'kaminos.local-liquid-emitter.v1',mode:'continuous',baseRadius:.075,strength:1.5,rate:120,volumeRate:Math.PI*.075**2*1.5};
const entry={id:'jet',type:LOCAL_LIQUID_EMITTER_TYPE,object,localLiquidEmitter:initial};
const context={THREE,scene,resolveWaterAim,waterBallisticPreview,structuredClone,LOCAL_LIQUID_EMITTER_TYPE,normalizeLocalLiquidEmitter,waterFeature:{},viewportDisplay:{helpers:false,emitters:true},workingScene:{objects:[entry,{id:'target',object:target}]},sceneObjectDisplayLabel:row=>row.id,sceneObjectTransformState:o=>({position:o.position.toArray(),rotation:o.rotation.toArray().slice(0,3),scale:o.scale.toArray()}),assertSceneConstructionAvailable(){},waterSettingTargets:new Set(),waterAimGuides:null,isSceneItemVisible:()=>true};
context.replaceAuthoredWaterSettings=(id,value)=>{entry.localLiquidEmitter=value;context.updateWaterAimConstraints();};
context.scenePlacementTools={edits:createSceneEdits({read:()=>context.sceneObjectTransformState(object),write:(id,pose)=>{object.position.fromArray(pose.position);object.rotation.fromArray(pose.rotation);object.scale.fromArray(pose.scale);context.updateWaterAimConstraints();}})};
vm.createContext(context);vm.runInContext(source('waterAimTargets','function waterAimState')+source('updateWaterAimConstraints','async function createWaterAimTarget')+source('applyAuthoredWaterSettings','function replaceAuthoredWaterSettings'),context);
context.applyAuthoredWaterSettings('jet',{aimAt:'target'});assert(Math.abs(object.rotation.x)<1e-10);
await context.scenePlacementTools.edits.undo();assert(Math.abs(object.rotation.x-Math.PI/2)<1e-10,'Undo aim assignment restores the previous free orientation');
await context.scenePlacementTools.edits.redo();assert.equal(entry.localLiquidEmitter.aimAt,'target');assert(Math.abs(object.rotation.x)<1e-10);
entry.localLiquidEmitter=normalizeLocalLiquidEmitter({...initial,aimAt:'target',flowMode:'flow'},context.sceneObjectTransformState(object));context.viewportDisplay.helpers=true;context.scenePlacementTools.edits.apply('jet',{scale:[2,2,2]});
const effective=normalizeLocalLiquidEmitter(entry.localLiquidEmitter,context.sceneObjectTransformState(object)),duration=1/effective.strength,arc=context.waterAimGuides.children[1].geometry.attributes.position;
assert(Math.abs(arc.getY(arc.count-1)-(1-4.905*duration**2))<1e-4,'Trajectory guide uses pose-normalized effective flow speed');
console.log('Native aim assignment history and scaled flow trajectory agree');

await context.scenePlacementTools.edits.undo();assert.equal(object.scale.x,1);await context.scenePlacementTools.edits.redo();assert.equal(object.scale.x,2);
context.applyAuthoredWaterSettings('jet',{flowMode:'speed',strength:1.5});
const speedArc=context.waterAimGuides.children[1].geometry.attributes.position;assert(Math.abs(speedArc.getY(speedArc.count-1)-(1-4.905*(1/1.5)**2))<1e-5);
