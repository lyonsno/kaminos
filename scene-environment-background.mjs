import {Color} from './lib/three.core.js';
import {pmremTexture,mix,vec3,uniform} from './lib/three.tsl.js';
const states=new WeakMap();
// One background contract for the native scene and its saved-scene consumers.
// Grading affects the backdrop, leaving material illumination in linear space.
export function applySceneEnvironmentBackground(scene,environment,map){
 if(environment?.showBackground&&map){
  let state=states.get(scene);if(!state){state={contrast:uniform(1)};states.set(scene,state);}
  if(scene.background!==map||!scene.backgroundNode){const graded=pmremTexture(map).rgb.max(0).div(.18).pow(state.contrast.max(1)).mul(.18);scene.backgroundNode=mix(vec3(.18),graded,state.contrast.min(1));}
  scene.background=map;scene.backgroundBlurriness=environment.backgroundBlur;scene.backgroundIntensity=environment.backgroundBrightness;state.contrast.value=environment.backgroundContrast;scene.backgroundRotation=scene.environmentRotation;
  return {mode:'environment',rotation:scene.backgroundRotation.y,blur:scene.backgroundBlurriness,brightness:scene.backgroundIntensity,contrast:state.contrast.value};
 }
 scene.backgroundNode=null;scene.background=new Color(0x0a0a0a);scene.backgroundBlurriness=0;return {mode:'solid',color:'0a0a0a'};
}
