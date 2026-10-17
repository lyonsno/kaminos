// kaminos-test: node
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../lib/three.core.js';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('the actual domain helper retires when its field is absent and survives toggles',()=>{
  let flameDomainGuide=null,activeSceneComposition={},flameDomainDraft=null,flameDomainProxy=null;
  const isSceneItemVisible=()=>true;
  const scene=new THREE.Scene(),selectionCaptureSuspended=false,viewportHelpersVisible=true;
  const viewportDisplay={domains:true,domainOpacity:1,domainWidth:1},transformControls=null;
  const acceptedFlameDomainPose=()=>({position:[0,1,0],rotation:[0,0,0],scale:[1,1,1]});
  const domainTransformForPose=()=>({translation:[0,0,0],scale:1}),flameDomainTopY=()=>3,styleHelperLines=()=>{},styleSimulationDomainGuide=()=>{};
  const document={getElementById:()=>null},window={_kaminosDirty:()=>{}};
  const a=source.indexOf('function refreshFlameDomainPreview()'),b=source.indexOf('function writeFlameDomainPreview',a);
  const refresh=eval('('+source.slice(a,b)+')');refresh();assert.equal(flameDomainGuide.visible,true);
  activeSceneComposition=null;refresh();assert.equal(flameDomainGuide.visible,false);
  viewportDisplay.domains=false;refresh();viewportDisplay.domains=true;refresh();assert.equal(flameDomainGuide.visible,false);
  activeSceneComposition={};refresh();assert.equal(flameDomainGuide.visible,true);assert.equal(scene.children.length,1);
});

test('both actual GI graph arms retain the mounted water host linear input',()=>{
  for(const cached of [false,true]) {
    const sceneGISettings={mode:'gtao',view:'scene',denoise:1,temporal:false},document={body:{dataset:{}}},localLiquidHost={};
    const scenePass={},prePassDepth={},prePassNormal={},sceneGI={debugState:()=>({filterImplementation:'shared'})};let activeSceneDepth,fireLightFieldPass;
    let rawSceneOutput,outlinedSceneOutput,outlinedCameraOutput,sceneEmissiveCamera=null;
    const renderPipeline={outputColorTransform:false},selectionFeedback={output:x=>x};
    const sharedGpu={device:{}},isFireLightFieldRoute=()=>true,fireLightFieldRouteParams=()=>new URLSearchParams();
    const refreshRenderingControls=()=>{},createFireLightFieldReceiverPass=()=>({outputNode:{}});
    const giOutputGraphs=new Map(cached?[['shared:gtao:true:false:true:false',{rawSceneOutput:{},outlinedSceneOutput:{},outlinedCameraOutput:null,sceneEmissiveCamera:null,fireLightFieldPass:{}}]]:[]);
    const a=source.indexOf('  function rebuildSceneGIOutput()'),b=source.indexOf('  updateSceneGI =',a);
    const rebuild=eval('('+source.slice(a,b).trim()+')');rebuild();assert.equal(renderPipeline.outputColorTransform,false);
  }
});
