import {createSceneRepetitionController} from './scene-repetition-controller.mjs';
// This cache warms downloads. Current camera/viewport policy still selects beauty.
const schema='kaminos.scene-lod-preparation.v2';
export function lodPreparationContext({camera,viewport,settings,objects,groups=[]}){
  return JSON.stringify({camera,viewport,settings,objects:objects.filter(row=>row.type==='glb').map(({id,source,transform,giProxy,repetition})=>({id,source,transform,giProxy,repetition})).sort((a,b)=>a.id.localeCompare(b.id)),groups:groups.map(({id,objectIds,transform,repetition})=>({id,objectIds:[...objectIds].sort(),transform,repetition})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function captureLodPreparation(context,allocation){
  if(!allocation?.enabled)return null;
  return {schema,context,levels:allocation.objects.map(({id,targetTier})=>({id,sha:targetTier}))};
}
export function cachedLodPreparation(hint,context){
  if(hint?.schema!==schema||hint.context!==context||!Array.isArray(hint.levels))return new Map();
  return new Map(hint.levels.filter(row=>typeof row?.id==='string'&&typeof row.sha==='string'&&/^[a-f0-9]{64}$/.test(row.sha)).map(row=>[row.id,row.sha]));
}

export function createCoarseRepetition({previews,groups}){return createSceneRepetitionController({objects:()=>previews().filter(row=>row.root).map(({record,root})=>({...record,object:root})),groups,readPose:object=>({position:object.position.toArray(),rotation:[object.rotation.x,object.rotation.y,object.rotation.z],scale:object.scale.toArray()})});}
