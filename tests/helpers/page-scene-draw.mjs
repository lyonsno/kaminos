import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createSceneDrawRuntime} from '../../scene-draw-runtime.mjs';
const page=readFileSync(new URL('../../index.html',import.meta.url),'utf8');
// Fixture-only domain services; the actual page adapter and production draw
// factory execute together. These recording providers do not claim native GPU.
export function installPageSceneDraw(context,source=page){
  const noop=()=>{},run=(_objects,_visible,draw)=>draw();
  // Older domain fixtures seat these as null because they exercised only an
  // inner water/visibility arm. A complete draw needs recording render owners.
  context.renderer??={};
  context.sceneBeautyLods??={setPreparation:noop,withFrame:(_camera,_options,draw)=>draw()};
  const defaults={createSceneDrawRuntime,THREE:{ACESFilmicToneMapping:1,AgXToneMapping:2},deviceRecoveryHeld:()=>false,
    document:{getElementById:()=>({value:'agx',checked:false})},sceneGISettings:{mode:'combined',view:'scene'},
    sceneAssetPreparationActive:false,outputCaptureExtent:null,isSceneItemVisible:()=>true,authoredFlameHDRActive:false,
    polyEdit:null,sceneComponents:null,renderer:{},renderPipeline:{render:noop},sceneEmissiveCamera:null,waterFeature:{host:null},
    fireLightFieldPass:null,sceneBeautyLods:{setPreparation:noop,withFrame:(_camera,_options,draw)=>draw()},sceneExposureControls:null,
    outlinedSceneOutput:{},outlinedCameraOutput:{},frameComposition:{transportFrame:null},rawSceneOutput:{},sceneEmissionSource:null,activeSceneDepth:{},
    updateSelectionFeedback:noop,updateAnnularBurnerFrame:noop,window:{},applySceneEmissiveCamera:noop,
    syncWaterProxy:noop,syncFireProxy:noop,ensureSimFramePlan:()=>({water:{advance:true}}),
    withViewportVisibility:run,viewportVisibilityObjects:()=>[],camera:{},renderWithViewportShading:draw=>draw(),
    authoredWaterControls:null,sharedWorkbench:null,recordingFrameSink:null,console,refreshLocalLiquidPerformance:noop,setInfo:noop,
    waterProxy:null,sceneFrameCount:0,sceneCameraStatusText:'',outputCaptureFrame:null,lastViewportShadingRender:null,fpsFrames:0,fpsLast:100,fpsEl:{},performance:{now:()=>100},
  };
  for(const [name,value] of Object.entries(defaults))if(!(name in context))context[name]=value;
  const start=source.indexOf('  const sceneDrawRuntime=createSceneDrawRuntime('),end=source.indexOf('\n  function animate() {',start);
  if(start<0||end<start)throw Error('Missing production scene draw installation');
  if(!vm.isContext(context))vm.createContext(context);
  vm.runInContext(source.slice(start,end),context);
  return context.drawSceneFrame;
}
