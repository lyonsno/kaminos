// kaminos-test: node
// Exercise the production adapters with rendering endpoints substituted. This
// is scene/visibility/configuration evidence, never a native GPU witness.
import test from'node:test';import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{runInNewContext}from'node:vm';import * as THREE from'../lib/three.webgpu.js';import{sceneItemVisible,withViewportVisibility}from'../scene-visibility.mjs';import{flameSourceInputs}from'../scene-fire-domain.mjs';import{applySceneEnvironmentBackground}from'../scene-environment-background.mjs';
const root=process.env.KILN_RECONSTRUCTION_SOURCE_ROOT;const source=readFileSync(root?root+'/inference-kiln-preview.mjs':new URL('../inference-kiln-preview.mjs',import.meta.url),'utf8');
const pose={position:[0,-.2,0],rotation:[0,0,0],scale:[1,1,1]},record={id:'source',type:'flame-emitter',source:'kaminos:analytic-flame',transform:pose,emissionEnabled:true};
test('the preview obeys group visibility while retaining authored objects for physics',()=>{
 const object=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshStandardMaterial()),entries=[{id:'prompt',object}],plan={objects:entries,groups:[{id:'lettering',objectIds:['prompt']}]},hidden=['@group:lettering'];let drawn;
 const a=source.indexOf('  function draw(){'),b=source.indexOf('\n  fire=',a);assert.ok(a>0&&b>a);
 const scope={disposed:false,lighting:null,runFrames(){},transport:null,pipeline:{render(){drawn=object.visible;}},frameCount:0,entries,visible:id=>sceneItemVisible(id,hidden,plan),withViewportVisibility};
 runInNewContext(source.slice(a,b)+';draw();',scope);assert.equal(drawn,false,'group visibility must apply during the actual draw');assert.equal(object.visible,true,'viewport hiding must not remove the authored collision/thermal object');object.geometry.dispose();object.material.dispose();
});
test('source conversion inherits flame-field visibility and preserves a visible control arm',()=>{
 const line=source.split('\n').find(line=>line.trim().startsWith('fire.setImmersedSources('));assert.ok(line);
 for(const hiddenIds of [['flame-field'],[]]){let inputs;const plan={objects:[record],groups:[],flameSources:[record],flameDomainTranslation:[0,0,0],flameDomainScale:1};
  runInNewContext(line,{fire:{setImmersedSources:value=>{inputs=value;}},flameSourceInputs,plan,settings:{resolution:32,gridHeightRatio:1,immersedRadius:.3},hidden:new Set(hiddenIds),visible:id=>sceneItemVisible(id,hiddenIds,plan)});
  assert.equal(inputs[0].controls.immersedSourceEnabled,hiddenIds.length===0);
 }
});
test('the preview uses native HDR background visibility, rotation and grading fields',async()=>{
 const a=source.indexOf('  const env=saved.environment;'),b=source.indexOf('  const post=saved.postprocessing',a);assert.ok(a>0&&b>a);const block=source.slice(a,b);
 const map=new THREE.Texture(),load=()=>Promise.resolve(new THREE.Texture());
 for(const showBackground of [true,false]){const scene=new THREE.Scene(),environment={url:'observed-fixture.hdr'},settings={name:'studio',showBackground,exposure:1.2,intensity:.7,rotation:.6,backgroundBlur:.2,backgroundBrightness:.35,backgroundContrast:1.7};
  const T={...THREE,PMREMGenerator:class{fromEquirectangular(){return {texture:map,dispose(){}};}dispose(){}}};
  await Function('saved','scene','environment','renderer','signal','RGBELoader','THREE','owned','applySceneEnvironmentBackground','return(async()=>{'+block+'})()')({environment:settings},scene,environment,{},null,class{loadAsync=load;},T,[],applySceneEnvironmentBackground);
  if(showBackground){assert.equal(scene.background,map);assert.equal(scene.backgroundRotation.y,.6);assert.equal(scene.backgroundBlurriness,.2);assert.equal(scene.backgroundIntensity,.35);assert.ok(scene.backgroundNode);}
  else{assert.equal(scene.background.isColor,true);assert.equal(scene.backgroundNode,null);}
 }
 const scene=new THREE.Scene();scene.environmentRotation.y=.6;assert.deepEqual(applySceneEnvironmentBackground(scene,{showBackground:true,backgroundBlur:.2,backgroundBrightness:.35,backgroundContrast:1.7},map),{mode:'environment',rotation:.6,blur:.2,brightness:.35,contrast:1.7});map.dispose();
});
