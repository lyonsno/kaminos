import {Group,Mesh,TorusGeometry,MeshBasicMaterial,Vector3} from '../lib/three.core.js';
import {sourceSettings} from './fall-plan.mjs';
import {checkedAshPose} from './scene-record.mjs';
export const ASH_SOURCE_TYPE='ash-source';
export function checkedAshSource(s){
 if(!s||typeof s.fieldId!=='string'||!s.fieldId||typeof s.enabled!=='boolean')throw Error('Ash source requires a field and enabled state');
 sourceSettings({rate:s.rate,spread:s.spread});return {fieldId:s.fieldId,enabled:s.enabled,rate:s.rate,spread:s.spread};
}
export function checkedAshSourceRecord(r){if(r?.type!==ASH_SOURCE_TYPE||r.source!=='kaminos:ash-source'||!r.id)throw Error('Invalid ash source record');checkedAshPose(r.transform);return {...r,ashSource:checkedAshSource(r.ashSource)};}
export const ashSourceRecordDomain={type:ASH_SOURCE_TYPE,check:checkedAshSourceRecord,fields:r=>({ashSource:checkedAshSource(r.ashSource)}),reloadable:r=>{checkedAshSourceRecord(r);return true;},load:(r,loaders,options)=>loaders.ashSource(r,options)};
export function createAshSourceObject(record){
 const r=checkedAshSourceRecord(record),root=new Group();root.name=r.label;root.userData.kaminosSceneObject=r;
 root.position.fromArray(r.transform.position);root.rotation.set(...r.transform.rotation);root.scale.fromArray(r.transform.scale);
 const ring=new Mesh(new TorusGeometry(1,.025,6,48),new MeshBasicMaterial({color:0x9bbeb4}));ring.rotation.x=Math.PI/2;root.add(ring);
 root.userData.kaminosEditorOnly=true;
 root.userData.syncAshSource=()=>ring.scale.setScalar(Math.max(.025,root.userData.kaminosSceneObject.ashSource.spread));root.userData.syncAshSource();return root;
}
export function sourceInField(entry,field){
 const s=checkedAshSource(entry.object.userData.kaminosSceneObject.ashSource);field.root.updateWorldMatrix(true,false);entry.object.updateWorldMatrix(true,false);
 const position=field.root.worldToLocal(entry.object.getWorldPosition(new Vector3())).toArray(),size=field.read().settings;
 const worldScale=entry.object.getWorldScale(new Vector3()),fieldScale=field.root.getWorldScale(new Vector3());
 const spread=s.spread*Math.max(Math.abs(worldScale.x/fieldScale.x),Math.abs(worldScale.z/fieldScale.z));
 const dx=Math.max(0,Math.abs(position[0])-size.width/2),dz=Math.max(0,Math.abs(position[2])-size.depth/2);
 const inside=position[1]>=0&&size.width>0&&size.depth>0&&dx*dx+dz*dz<=spread*spread;
 return {inside,position,spread,rate:s.enabled&&inside?s.rate:0};
}
