// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneDrawRuntime} from '../scene-draw-runtime.mjs';
function fixture(){
  const calls=[],transport={},settings={giMode:'combined',giView:'scene',waterVisible:true,beautyFrameOptions:{viewportHeight:100}},resources={
    renderer:{},renderPipeline:{render:()=>calls.push('render')},waterFeature:{host:null},transportFrame:transport,
    fireLightFieldPass:{renderShadows:()=>calls.push('shadows')},sceneBeautyLods:{setPreparation:value=>calls.push(['preparation',value])},
    sceneExposureControls:{sync:()=>calls.push('exposure')},outlinedSceneOutput:{outlined:true},outlinedCameraOutput:{camera:true},rawSceneOutput:{raw:true},sceneEmissionSource:{emission:true},activeSceneDepth:{depth:true},
  };
  const operations={beforeDraw:time=>calls.push(['before',time]),readPhysicalCamera:()=>({physical:true}),applyCamera:(...args)=>calls.push(['camera',args]),
    syncProxies:()=>calls.push('proxies'),planFrame:time=>{calls.push(['plan',time]);return {water:{advance:true,maxSteps:3}};},
    withBeautyFrame:(options,run)=>{calls.push(['beauty',options]);run();return {shading:true};},refreshWaterStatus:()=>calls.push('refresh-water'),renderFlameHDR:value=>calls.push(['hdr',value]),
  };
  const draw=createSceneDrawRuntime({THREE:{AgXToneMapping:'agx',ACESFilmicToneMapping:'aces'},readSettings:()=>settings,readResources:()=>resources,operations,
    onCameraStatus:value=>calls.push(['camera-status',value]),onWaterFrame:value=>calls.push(['water-status',value]),
    onWaterError:(error,fallback)=>{calls.push(['water-error',error.message]);fallback();},afterDraw:(receipt,time)=>calls.push(['complete',receipt,time]),now:()=>10});
  return {calls,settings,resources,operations,draw,transport};
}
test('ordinary scene preserves shadows, preparation, beauty and frame completion order without DOM',()=>{
  const f=fixture();f.draw();assert.equal(f.resources.renderer.toneMapping,'agx');
  assert.deepEqual(f.calls,[['before',10],'shadows',['preparation',undefined],'exposure','proxies',['beauty',f.settings.beautyFrameOptions],'render',['complete',{shading:true},10]]);
  f.settings.held=true;f.calls.length=0;f.draw();assert.deepEqual(f.calls,[]);
});
test('water consumes the existing plan and exact transport before status and completion',()=>{
  const f=fixture(),state={clock:{step:7}};
  f.resources.waterFeature={host:{state:()=>state,setSceneCamera:()=>{}},render:value=>f.calls.push(['water',value])};
  f.draw();const water=f.calls.find(call=>call[0]==='water');assert.deepEqual(water[1],{advance:true,maxSteps:3,volumeTransport:f.transport});
  assert.ok(f.calls.indexOf('refresh-water')>f.calls.indexOf(water));assert.deepEqual(f.calls.at(-2),['water-status',state]);assert.equal(f.calls.at(-1)[0],'complete');
  assert.equal(f.calls.includes('render'),false);
});
test('hidden water and recoverable water failure preserve ordinary render fallback',()=>{
  const f=fixture();f.resources.waterFeature={host:{},render(){throw Error('water failed');}};
  f.settings.waterVisible=false;f.draw();assert.equal(f.calls.includes('render'),true);assert.equal(f.calls.some(call=>call[0]==='plan'),false);
  f.settings.waterVisible=true;f.calls.length=0;f.draw();assert.ok(f.calls.some(call=>call[0]==='water-error'));assert.equal(f.calls.includes('render'),true);assert.equal(f.calls.at(-1)[0],'complete');
  f.settings.capturing=true;f.calls.length=0;assert.throws(f.draw,/water failed/);assert.equal(f.calls.some(call=>call[0]==='water-error'||call[0]==='complete'),false);
});
test('flame HDR receives exact shared-frame resources and suppresses a duplicate ordinary render',()=>{
  const f=fixture();f.settings.flameHDRActive=true;f.settings.matchFlameCamera=true;f.draw();
  assert.deepEqual(f.calls.find(call=>call[0]==='hdr')[1],{frame:f.transport,input:f.resources.rawSceneOutput,emissionInput:f.resources.sceneEmissionSource,depthInput:f.resources.activeSceneDepth,matched:true});
  assert.equal(f.calls.includes('render'),false);
});
test('camera matching and diagnostic inspection retain water linear-intermediate policy',()=>{
  const f=fixture();f.settings.matchFlameCamera=true;
  f.resources.waterFeature.host={setSceneCamera:(...args)=>f.calls.push(['water-camera',args]),state:()=>({})};f.settings.waterVisible=false;
  f.resources.sceneEmissiveCamera={update:(requested,physical)=>{assert.equal(requested,true);assert.deepEqual(physical,{physical:true});return {effective:true,toneMapping:'agx',whiteBalanceKelvin:6500,exposureEV:0};}};
  f.draw();const camera=f.calls.find(call=>call[0]==='camera');assert.equal(camera[1][3],true);assert.deepEqual(camera[1][4],{linearIntermediate:true});
  assert.equal(f.calls.find(call=>call[0]==='camera-status')[1].effective,true);
  f.settings.giView='indirect';f.calls.length=0;f.draw();assert.equal(f.calls.find(call=>call[0]==='camera-status')[1].diagnostic,true);
  assert.deepEqual(f.calls.find(call=>call[0]==='water-camera')[1],[false]);
});
test('an asynchronous beauty wrapper cannot certify synchronous frame completion',()=>{
  const f=fixture();f.operations.withBeautyFrame=()=>Promise.resolve({pending:true});
  assert.throws(f.draw,/synchronous/);assert.equal(f.calls.some(call=>call[0]==='complete'),false);
});
