import {Matrix4} from './lib/three.core.js';
import {checkedRepetition,createRepetitionView,repetitionMatrices,isRepetitionCopy} from './scene-repetition.mjs';
export function canRepeatSceneObject(entry){
 if(!entry?.object||!['glb','pbr','procedural-mesh'].includes(entry.type))return false;
 let valid=true;function inspect(node){if(isRepetitionCopy(node))return;if(node.isSkinnedMesh||node.isInstancedMesh||node.morphTargetInfluences?.length)valid=false;for(const c of node.children)inspect(c);}inspect(entry.object);return valid;
}
export function createSceneRepetitionController({objects,groups,readPose}){
 const view=createRepetitionView(),mounted=new Map();
 const groupFor=entry=>groups().find(g=>g.objectIds.includes(entry.id));
 const ancestors=entry=>{const rows=groups(),result=[];let group=groupFor(entry);while(group){result.unshift(group);group=rows.find(g=>g.id===group.parentId);}return result;};
 const outerMatrices=rows=>rows.reduce((matrices,g)=>matrices.flatMap(m=>repetitionMatrices(g.repetition,g.transform).map(next=>m.clone().multiply(next))),[new Matrix4()]);
 function matrices(entry){const outer=outerMatrices(ancestors(entry)),own=repetitionMatrices(entry.repetition,readPose(entry.object));return outer.flatMap(g=>own.map(m=>g.clone().multiply(m)));}
 function sync(){
  const current=new Set(objects().map(o=>o.object));for(const root of mounted.keys())if(!current.has(root)){view.clear(root);mounted.delete(root);}
  for(const entry of objects()){
   const chain=ancestors(entry),own=checkedRepetition(entry.repetition),inherited=chain.some(g=>g.repetition);
   if(!own&&!inherited){if(mounted.has(entry.object)){view.clear(entry.object);mounted.delete(entry.object);}continue;}
   const pose=readPose(entry.object),key=JSON.stringify([own,chain.map(g=>[g.repetition,g.transform]),pose,entry.source,entry.geometry,entry.surface,entry.object.uuid]);
   if(mounted.get(entry.object)===key)continue;
   if(!canRepeatSceneObject(entry))throw Error('Repetition supports static mesh objects and mesh groups');
   const outer=outerMatrices(chain);view.sync(entry.object,own,pose,{outer});mounted.set(entry.object,key);
  }
 }
 function clear(root){view.clear(root);mounted.delete(root);}
 return {sync,clear,matrices,groupFor,clearAll(){for(const root of mounted.keys())view.clear(root);mounted.clear();}};
}
