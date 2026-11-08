// kaminos-test: node
import assert from 'node:assert/strict';
import test from 'node:test';
import SceneReflections,{resolveReflectionSettings} from '../scene-reflections.mjs';
import {installSceneReflectionLighting} from '../scene-reflection-lighting.mjs';
import {StandardNodeLibrary,MeshStandardMaterial,PerspectiveCamera,Vector3,Texture,TSL} from '../lib/three.webgpu.js';
import {createViewProjection} from '../view-projection.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
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

test('glossy capture admission rejects repeated reflection and pyramid frames',async()=>{
 const {assertGlossySourceEvidence}=await import('../tools/scene-reflections-witness-contracts.mjs');
 const arm=()=>({sourcePeak:4096,peak:256,before:{frame:20,pyramid:20},frames:Array.from({length:12},(_,i)=>({frame:21+i,pyramid:21+i}))});
 const valid={small:arm(),broad:{...arm(),peak:4096}};assert.doesNotThrow(()=>assertGlossySourceEvidence(valid));
 const cached=structuredClone(valid);cached.small.frames=Array(12).fill(cached.small.frames[0]);
 assert.throws(()=>assertGlossySourceEvidence(cached),/fresh reflection frame/);
 const stalePyramid=structuredClone(valid);stalePyramid.small.frames[1].pyramid--;
 assert.throws(()=>assertGlossySourceEvidence(stalePyramid),/fresh source-pyramid frame/);
});

test('the document reflection writer synchronizes initialized controls without adding history',async()=>{
 const {readFileSync}=await import('node:fs'),{runInNewContext}=await import('node:vm');
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const a=source.indexOf('  restoreSceneReflectionSettings='),b=source.indexOf('\n',a);
 let runtime={enabled:false,resolutionScale:.5,steps:64},display={...runtime},writes=0;
 let resetReason;const context={writeReflections:value=>{runtime={...runtime,...value};writes++;},reflectionControls:{sync:()=>{display={...runtime};}},sceneGI:{reflections:{reset:reason=>{resetReason=reason;}}}};
 runInNewContext(source.slice(a,b),context);
 context.restoreSceneReflectionSettings({enabled:true,resolutionScale:.25,steps:6});
 assert.equal(writes,1);assert.deepEqual(display,runtime,'visible controls describe the restored settings');assert.equal(resetReason,'scene-restored');
});

test('reflection sample budgets and sequence identity are explicit and validated',()=>{
 assert.equal(resolveReflectionSettings().samples,1);assert.equal(resolveReflectionSettings().sampling,'stochastic');
 for(const bad of [{samples:0},{samples:1.5},{samples:4294967296},{sampling:'hidden-fallback'}])assert.throws(()=>resolveReflectionSettings(bad));
 const value=resolveReflectionSettings({samples:8,sampling:'stable',steps:6,resolutionScale:.3});assert.equal(value.samples,8);assert.equal(value.sampling,'stable');
});

test('crossing refinement is a distinct saved budget, with zero allowed and caller values retained',()=>{
 assert.equal(resolveReflectionSettings().refinementSteps,6);
 for(const refinementSteps of [0,3,16,4096])assert.equal(resolveReflectionSettings({refinementSteps}).refinementSteps,refinementSteps);
 for(const refinementSteps of [-1,1.5,4294967296])assert.throws(()=>resolveReflectionSettings({refinementSteps}),/refinement/i);
});

test('legacy scene restoration clears reflection history without replacing session settings',()=>{
 const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
 const a=source.indexOf('  if(restorePlan.reflections)'),b=source.indexOf('  if (data.postprocessing)',a);
 assert.ok(a>=0&&b>a);
 for(const reflections of [null,{enabled:true}]){
  const resets=[],writes=[],context={restorePlan:{reflections},restoreSceneReflectionSettings:value=>writes.push(value),sceneGI:{reflections:{reset:reason=>resets.push(reason)}}};
  runInNewContext(source.slice(a,b),context);
  if(reflections)assert.deepEqual(writes,[reflections]);
  else {assert.deepEqual(writes,[]);assert.deepEqual(resets,['scene-restored']);}
 }
});
