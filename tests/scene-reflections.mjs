// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveReflectionSettings} from '../scene-reflections.mjs';
import {installSceneReflectionLighting} from '../scene-reflection-lighting.mjs';
test('reflection requests retain caller budgets and reject unrepresentable values',()=>{
 const s=resolveReflectionSettings({enabled:true,steps:4096,resolutionScale:.75,maxDistance:120});
 assert.equal(s.steps,4096);assert.equal(s.resolutionScale,.75);assert.equal(s.maxDistance,120);
 for(const settings of [{steps:0},{steps:2.5},{steps:4294967296},{enabled:'yes'},{resolutionScale:0},{resolutionScale:2},{maxDistance:NaN},{thickness:-1},{historyWeight:1}])assert.throws(()=>resolveReflectionSettings(settings));
 assert.equal(resolveReflectionSettings().enabled,false);
});
test('physical lighting integration is scoped to the selected receiver context',()=>{
 const indirect=function(){},original=function(){return {indirectSpecular:indirect};};
 const material={isMeshStandardNodeMaterial:true,setupLightingModel:original};
 const library={fromMaterial:x=>x},previous=library.fromMaterial,owner={lightingContext:{}};
 const release=installSceneReflectionLighting({library},owner);
 assert.equal(library.fromMaterial(material),material);
 assert.equal(material.setupLightingModel({context:{sceneReflectionLighting:null}}).indirectSpecular,indirect,'source has no reflection injection');
 assert.equal(material.setupLightingModel({context:{sceneReflectionLighting:{}}}).indirectSpecular,indirect,'other owners keep their lighting');
 assert.notEqual(material.setupLightingModel({context:{sceneReflectionLighting:owner.lightingContext}}).indirectSpecular,indirect);
 material.transparent=true;
 assert.equal(material.setupLightingModel({context:{sceneReflectionLighting:owner.lightingContext}}).indirectSpecular,indirect,'camera opaque surface cannot shade a transparent receiver');
 release();assert.equal(library.fromMaterial,previous);assert.equal(material.setupLightingModel,original);
});
