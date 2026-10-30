import {createPromptLettering} from './prompt-lettering.mjs';
import {promptReliefRecord} from './inference-kiln-record.mjs';
import {COMPOSITION_SCHEMA} from './scene-authoring.mjs';
import {FLAME_EMITTER_SOURCE,defaultFlameEmitterPose} from './scene-flame-emitter.mjs';
import {buildSceneDocument} from './scene-persistence-core.js';
import {flamePoseFromImmersedControls,flameDomainControlsFromSettings,flameDomainTranslationForPose} from './scene-flame-emitter.mjs';
import {kilnScenePlan} from './inference-kiln-selection.mjs';
// The starter is an ordinary authored scene. Saving in Workbench replaces this
// recipe through the shared scene library, with no second kiln file format.
export function defaultKilnRecipe(document,artifact,settings){
 const mesh=createPromptLettering(document,'Your next image','composed'),id='kiln-prompt';
 const pose={position:mesh.position.toArray(),rotation:[mesh.rotation.x,mesh.rotation.y,mesh.rotation.z],scale:mesh.scale.toArray()};
 const prompt={...promptReliefRecord(mesh),id,label:'Prompt lettering',fileName:'Prompt lettering',transform:pose,burnable:{enabled:true,material:'wood',appearance:{profile:'composed',glow:1}}};
 mesh.geometry.dispose();mesh.material.dispose();
 const shape=flameDomainControlsFromSettings(settings),emitter=defaultFlameEmitterPose();
 const transform=(position,rotation=[0,0,0])=>({position,rotation,scale:[1,1,1]});
 const box=(id,label,parameters,position)=>({id,label,fileName:label,type:'procedural-mesh',source:'kaminos:geometry',geometry:{kind:'box',parameters},surface:{color:'#181a1e',roughness:.97,metalness:0},transform:transform(position)});
 const scene=buildSceneDocument({objects:[prompt,box('kiln-floor','Kiln floor',{width:8,height:.02,depth:8},[0,-.85,0]),box('kiln-backdrop','Kiln backdrop',{width:8,height:6,depth:.05},[0,1,-2.5]),
  {id:'flame-emitter',type:'flame-emitter',source:FLAME_EMITTER_SOURCE,label:'Flame source',transform:emitter,emissionEnabled:true},
  {id:'kiln-light',type:'light',source:'kaminos:scene-spot-light',label:'Kiln key light',transform:transform([0,2,3],[-.4,0,0]),light:{kind:'spot',enabled:true,color:'#d6dce4',intensity:18,angle:45,penumbra:1,aimDistance:4}}],
  composition:{schema:COMPOSITION_SCHEMA,flame:{presetId:artifact.presetId,stationary:true,label:'Inference Kiln'},lightGainStops:0,route:{volume_light_field:'1',volume_light_field_distributed:'1',volume_light_field_hybrid:'1',volume_light_field_scene_depth:'1'}},
  fireSettings:settings,flameDomainTranslation:flameDomainTranslationForPose(emitter,shape),
  camera:{position:[0,.45,3.4],target:[0,.3,0],up:[0,1,0],fov:40,near:.01,far:100},
  sceneCamera:{schema:'kaminos.scene-camera.v1',activeId:null,aspect:[16,9]},environment:null,
  postprocessing:{fireLighting:{'rendering-match-flame-camera':true},sceneGI:{mode:'combined'},ao:{enabled:true,intensity:1},bloom:{enabled:true,strength:.08,radius:.12,threshold:0,composeFlame:true}},
 });
 scene.label='Inference Kiln';return {selection:null,document:scene,plan:kilnScenePlan(scene,{promptObjectId:id})};
}
