// kaminos-test: node
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {createSceneFrameComposition} from '../scene-frame-composition.mjs';
const source=process.argv[2]
  ? execFileSync('git',['show',`${process.argv[2]}:index.html`],{encoding:'utf8',maxBuffer:Infinity})
  : readFileSync(new URL('../index.html',import.meta.url),'utf8');
const body=source.match(/function drawSceneFrame\(\) \{([\s\S]*?)\n  \}/)[1];
const calls=[];let mounted=false;
const context={deviceRecoveryHeld:()=>false,sceneAssetPreparationActive:false,performance:{now:()=>100},document:{getElementById:()=>({value:'custom'})},THREE:{ACESFilmicToneMapping:1,AgXToneMapping:2},
 renderer:{},updateSelectionFeedback(){},updateAnnularBurnerFrame(){mounted=true;calls.push('burner');},
 fireLightFieldPass:{renderShadows(){assert.equal(mounted,true,'shadow draw must see current burner placement');calls.push('shadows');}},
 renderPipeline:{render(){calls.push('visible');}},sceneBeautyLods:{setPreparation(){},withFrame:(camera,options,draw)=>draw()},
 sceneExposureControls:null,sceneEmissiveCamera:null,waterFeature:{host:null},syncWaterProxy(){},syncFireProxy(){},
 polyEdit:null,sceneComponents:null,withViewportVisibility:(objects,visible,draw)=>draw(),viewportVisibilityObjects:()=>[],
 isSceneItemVisible:()=>true,camera:{},renderWithViewportShading:draw=>draw(),authoredFlameHDRActive:false,waterProxy:null,
 sceneFrameCount:0,outputCaptureFrame:null,recordingFrameSink:null,lastViewportShadingRender:null,fpsFrames:0,fpsLast:0,fpsEl:{}};
const draw=vm.runInNewContext(`(function(){${body}})`,context);
context.frameComposition=createSceneFrameComposition({readInputs:()=>({}),draw,frameCount:()=>context.sceneFrameCount});
assert.equal(context.frameComposition.render(),true);
assert.deepEqual(calls,['burner','shadows','visible']);assert.equal(context.sceneFrameCount,1);
console.log('burner placement precedes shadow draw and visible composition');
