import {normalizeFlameEmitterPose} from './scene-flame-emitter.mjs';
import {checkedPose} from './scene-edit-session.mjs';
import {checkedWorldFrame} from './volume-world-frame.mjs';
export const FIRE_UNIT_TYPE='fire-unit';
export const FIRE_UNIT_SOURCE='kaminos:fire-unit';
const copy=value=>structuredClone(value);
export function checkedFireUnitPose(value){
 const p=checkedPose(value);
 if(p.rotation.some(v=>v!==0))throw Error('Fire grids stay aligned with world axes; use Move or uniform Scale');
 if(p.scale[0]<=0||p.scale.some(v=>v!==p.scale[0]))throw Error('Fire grids require positive uniform scale');
 return p;
}
export function fireUnitFrame(pose){const p=checkedFireUnitPose(pose);return {translate:[...p.position],scale:p.scale[0]};}
export function fireUnitFineFrame(pose,offset=[0,0,0],relativeScale=1){const frame=fireUnitFrame(pose);return {...frame,scale:frame.scale*relativeScale,translate:frame.translate.map((v,i)=>v+offset[i]*frame.scale)};}
export function moveLinkedFireEmitter(source,before,after,linked){
 const s=checkedPose(source),a=checkedFireUnitPose(before),b=checkedFireUnitPose(after);
 if(!linked)return s;
 const ratio=b.scale[0]/a.scale[0];
 return {...s,position:s.position.map((v,i)=>b.position[i]+(v-a.position[i])*ratio),scale:s.scale.map(v=>v*ratio)};
}
function checkedControls(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Fire unit needs its simulation controls');
 const walk=v=>{if(typeof v==='number'&&!Number.isFinite(v))throw Error('Fire controls must be finite');if(v&&typeof v==='object')Object.values(v).forEach(walk);else if(v!==null&&!['number','boolean','string','undefined'].includes(typeof v))throw Error('Invalid fire control');};walk(value);return copy(value);
}
export function checkedFireUnitRecord(raw){
 if(raw?.type!==FIRE_UNIT_TYPE||raw.source!==FIRE_UNIT_SOURCE||typeof raw.id!=='string'||!raw.id)throw Error('Invalid fire unit identity');
 const r=copy(raw),f=r.fireUnit;
 if(!f||typeof f.moveEmitterWithGrid!=='boolean')throw Error('Move emitter with grid must be boolean');
 if(f.emissionEnabled!==undefined&&typeof f.emissionEnabled!=='boolean')throw Error('Fire emission enabled must be boolean');
 if(f.fineOffset!==undefined&&(!Array.isArray(f.fineOffset)||f.fineOffset.length!==3||!f.fineOffset.every(Number.isFinite)))throw Error('Fine offset must have three finite coordinates');
 if(f.fineScale!==undefined&&(!Number.isFinite(f.fineScale)||f.fineScale<=0))throw Error('Fine scale must be finite and positive');
 if(f.worldReferenceDims!==undefined)checkedWorldFrame({translate:[0,0,0],scale:1,referenceDims:f.worldReferenceDims});
 r.transform=checkedFireUnitPose(r.transform);
 r.fireUnit={...f,controls:checkedControls(f.controls),emitter:normalizeFlameEmitterPose(f.emitter)};
 return r;
}
export const fireUnitRecordDomain={type:FIRE_UNIT_TYPE,source:FIRE_UNIT_SOURCE,check:checkedFireUnitRecord,
 fields:r=>({fireUnit:copy(r.fireUnit)}),reloadable:r=>{checkedFireUnitRecord(r);return true;},load:(r,loaders,options)=>loaders.fireUnit(r,options),
 capture:entry=>({fireUnit:copy(entry.object.userData.fireUnitOwner?.capture()??entry.fireUnit)})};
