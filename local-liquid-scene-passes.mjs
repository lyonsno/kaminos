import * as THREE from './lib/three.webgpu.js';
import {uniform,vec3,vec4,float,Fn,agxToneMapping} from './lib/three.tsl.js';
import {createSceneEmissiveCamera,applySceneEmissiveCamera} from './scene-emissive-camera.mjs';

// Keep the scene's linear lighting graph resident while the ordinary display
// pipeline remains available to other consumers. Water samples no editor
// outlines or display transforms; those belong to the final composed image.
export function createLocalLiquidScenePasses({renderer,composedOutput,getDisplayPolicy,decorateOutput}) {
  if(typeof getDisplayPolicy!=='function'||typeof decorateOutput!=='function')
    throw Error('Local liquid requires scene lighting and presentation bindings');
  const capture=new THREE.RenderPipeline(renderer);
  capture.outputColorTransform=false;
  const camera=createSceneEmissiveCamera(composedOutput,{THREE,TSL:{uniform,vec3,vec4,float,Fn,agxToneMapping}});
  const ordinary=decorateOutput(composedOutput),matched=decorateOutput(camera.outputNode);
  const presentation=new THREE.RenderPipeline(renderer,ordinary);
  let graphChanges=0,cameraState={effective:false};
  return {
    capture,presentation,
    update() {
      const policy=getDisplayPolicy();
      if(!policy?.rawOutput?.isNode)throw Error('Local liquid raw scene lighting is unavailable');
      if(capture.outputNode!==policy.rawOutput){
        capture.outputNode=policy.rawOutput;capture.needsUpdate=true;graphChanges++;
      }
      const state=policy.cameraState;
      cameraState=camera.update(Boolean(state?.effective),state?.effective?{...state,effective:'emissive-transport-v2'}:null);
      applySceneEmissiveCamera(presentation,ordinary,matched,cameraState.effective);
    },
    state:()=>({capture:'resident-linear-hdr',captureGraphChanges:graphChanges,
      linearSceneColorInput:graphChanges>0&&capture.outputColorTransform===false,
      selectionFeedback:'final-presentation',camera:{...cameraState}}),
    dispose(){capture.dispose();presentation.dispose();},
  };
}
