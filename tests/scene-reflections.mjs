// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import SceneReflections,{resolveReflectionSettings} from '../scene-reflections.mjs';
import {installSceneReflectionLighting} from '../scene-reflection-lighting.mjs';
import {StandardNodeLibrary,MeshStandardMaterial,PerspectiveCamera,Vector3,Texture,TSL} from '../lib/three.webgpu.js';
import {createViewProjection} from '../view-projection.mjs';
import {execFileSync} from 'node:child_process';
test('reflection requests retain caller budgets and reject unrepresentable values',()=>{
 const s=resolveReflectionSettings({enabled:true,steps:4096,resolutionScale:.75,maxDistance:120});
 assert.equal(s.steps,4096);assert.equal(s.resolutionScale,.75);assert.equal(s.maxDistance,120);
 for(const settings of [{steps:0},{steps:2.5},{steps:4294967296},{enabled:'yes'},{resolutionScale:0},{resolutionScale:2},{maxDistance:NaN},{thickness:-1},{historyWeight:1}])assert.throws(()=>resolveReflectionSettings(settings));
 assert.equal(resolveReflectionSettings().enabled,false);
});
test('disabled reflection bookkeeping releases disposed real material conversions',()=>{
 const output=execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',`
  import {StandardNodeLibrary,MeshStandardMaterial} from './lib/three.webgpu.js';
  import {installSceneReflectionLighting} from './scene-reflection-lighting.mjs';
  const library=new StandardNodeLibrary(),release=installSceneReflectionLighting({library},{settings:{enabled:false},lightingContext:{}});
  function conversions(){return Array.from({length:32},()=>{const source=new MeshStandardMaterial(),node=library.fromMaterial(source);source.dispose();return new WeakRef(node);});}
  const refs=conversions();
  for(let i=0;i<4;i++){await new Promise(setImmediate);global.gc();}
  console.log(refs.filter(ref=>ref.deref()).length);release();
 `],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(Number(output.trim()),0,'disposed conversion instances must not be retained by reflection bookkeeping');
});
function fieldFixture(){
 const camera=new PerspectiveCamera(50,1,.1,30),renderer={library:new StandardNodeLibrary()};
 const field=new SceneReflections({getTextureNode:()=>TSL.texture(new Texture())},camera,renderer,{enabled:true});
 return {field,camera,renderer};
}
test('normal projection transitions suspend requested reflections and restore perspective',()=>{
 const {field,camera}=fieldFixture(),view=createViewProjection({camera,target:()=>new Vector3()});
 try{
  assert.equal(field.state().effective??field.state().enabled,true);
  view.setOrthographic(true);
  assert.equal(field.state().enabled,true,'retain operator intent');
  assert.equal(field.state().effective??field.state().enabled,false,'orthographic tracing is suspended');
  assert.equal(field.state().suspensionReason,'perspective-camera-required');
  assert.doesNotThrow(()=>field.setSettings({steps:48}),'quality edits remain usable while suspended');
  view.setOrthographic(false);assert.equal(field.state().effective,true);
 }finally{field.dispose();}
});
test('renderer replacement restores the old converter and hooks the new converter',()=>{
 const {field,renderer}=fieldFixture(),next={library:new StandardNodeLibrary()},source=new MeshStandardMaterial();
 const oldHook=renderer.library.fromMaterial,nextOriginal=next.library.fromMaterial;
 try{
  field.valid.value=true;field.setRenderer?.(next);
  assert.notEqual(renderer.library.fromMaterial,oldHook);
  assert.notEqual(next.library.fromMaterial,nextOriginal);
  const material=next.library.fromMaterial(source),builder={context:{sceneReflectionLighting:field.lightingContext}};
  assert.notEqual(material.setupLightingModel(builder).indirectSpecular,Object.getPrototypeOf(material).setupLightingModel.call(material,builder).indirectSpecular);
  assert.equal(field.state().valid,false);assert.equal(field.state().resetReason,'device-replaced');
 }finally{field.dispose();source.dispose();}
 assert.equal(next.library.fromMaterial,nextOriginal);
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
