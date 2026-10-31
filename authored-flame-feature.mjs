import {createSceneSimulationActivity} from './scene-simulation-activity.mjs';

// The flame prototype and its device remain with the rendering owner. Scene
// admission owns whether that retained prototype may perform work.
export function createAuthoredFlameFeature({runtime,visible,composed}) {
 let wanted=false,request=0,compositionAdmitted=false;
 const reconcile=createSceneSimulationActivity({prototype:runtime,wanted:()=>wanted});
 async function setActive(active,{isCurrent=()=>true}={}){
  if(!isCurrent())return false;
  const id=++request;wanted=Boolean(active);compositionAdmitted=Boolean(composed());
  await reconcile();
  if(id!==request)return false;
  if(!isCurrent()){wanted=false;await reconcile();return false;}
  return true;
 }
 return Object.freeze({
  setActive,
  sync:()=>composed()?setActive(visible()):compositionAdmitted?setActive(false):Promise.resolve(),
  clear:()=>setActive(false),
  restore:({present,composition,isCurrent})=>setActive(present&&(!composition||visible()),{isCurrent}),
  get active(){return !!runtime()?.isActive();},
 });
}
