import {createSceneSimulationActivity} from './scene-simulation-activity.mjs';

// The flame prototype and its device remain with the rendering owner. Scene
// admission owns whether that retained prototype may perform work.
export function createAuthoredFlameFeature({runtime,visible,composed,present=false}) {
 let wanted=false,request=0,compositionAdmitted=false,retired=false,scenePresent=Boolean(present);
 const reconcile=createSceneSimulationActivity({prototype:runtime,wanted:()=>wanted});
 async function setActive(active,{isCurrent=()=>true}={}){
  if(!isCurrent())return false;
  if(active)retired=false;
  const id=++request;wanted=Boolean(active);compositionAdmitted=Boolean(composed());
  await reconcile();
  if(id!==request)return false;
  if(!isCurrent()){wanted=false;await reconcile();return false;}
  return true;
 }
 return Object.freeze({
  setActive,
  sync:()=>retired?reconcile():composed()?setActive(visible()):compositionAdmitted?setActive(false):Promise.resolve(),
  clear:()=>{scenePresent=false;retired=true;return setActive(false);},
  restore:({present,composition,isCurrent=()=>true})=>{
   if(!isCurrent())return Promise.resolve(false);
   scenePresent=Boolean(present);retired=!present;
   return setActive(present&&(!composition||visible()),{isCurrent});
  },
  get present(){return scenePresent;},
  get active(){return !!runtime()?.isActive();},
 });
}
