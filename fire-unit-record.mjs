import {resolveWorldRegions} from './volume-region-controls.mjs';
import {resolveGridHeight} from './volume-grid-shape.mjs';
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
// Quality changes the solver layout, never the emitter's world-space pose.
export function changeFireUnitBoxMode(value,mode){
 if(!['single','double'].includes(mode))throw Error('Unknown Flame box mode');
 const next=copy(value),controls=next.controls;
 if((controls.worldSmoke==='on'?'double':'single')===mode)return next;
 const set=(key,id,value)=>{controls[key]=value;const d=next.settings?.domControls?.[id];if(d){d.value=value;if('rawValue'in d)d.rawValue=String(value);if(next.settings.route){const url=new URL(next.settings.route);url.searchParams.set(d.param??id.replaceAll('-','_'),String(value));next.settings.route=url.href;}}};
 if(mode==='single'){
  next.doubleFine={offset:copy(next.fineOffset??[0,0,0]),scale:next.fineScale??1,heightRatio:Number(controls.gridHeightRatio??2),manualHold:next.fineManualHold===true};
  const width=Number(controls.resolution),dims=next.worldReferenceDims??[width,resolveGridHeight(controls,width).heightCells,width],world=resolveWorldRegions(controls,dims).world,size=world.max.map((v,i)=>v-world.min[i]);
  next.worldReferenceDims=copy(dims);next.fineScale=size[0]/2;next.fineOffset=[(world.min[0]+world.max[0])/2,world.min[1]+next.fineScale,(world.min[2]+world.max[2])/2];next.fineManualHold=true;
  set('gridHeightRatio','volume-grid-height-ratio',size[1]/size[0]);set('worldSmoke','volume-world-smoke','off');
 }else{
  if(next.doubleFine){const saved=next.doubleFine;next.fineOffset=copy(saved.offset);next.fineScale=saved.scale;next.fineManualHold=saved.manualHold;set('gridHeightRatio','volume-grid-height-ratio',saved.heightRatio);delete next.doubleFine;}
  set('worldSmoke','volume-world-smoke','on');
 }
 return next;
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
 if(f.fineManualHold!==undefined&&typeof f.fineManualHold!=='boolean')throw Error('Fine manual hold must be boolean');
 if(f.doubleFine){const d=f.doubleFine;if(!Array.isArray(d.offset)||d.offset.length!==3||!d.offset.every(Number.isFinite)||!Number.isFinite(d.scale)||d.scale<=0||!Number.isFinite(d.heightRatio)||d.heightRatio<=0||typeof d.manualHold!=='boolean')throw Error('Invalid double-box Fine layout');}
 if(f.worldReferenceDims!==undefined)checkedWorldFrame({translate:[0,0,0],scale:1,referenceDims:f.worldReferenceDims});
 r.transform=checkedFireUnitPose(r.transform);
 r.fireUnit={...f,controls:checkedControls(f.controls),emitter:normalizeFlameEmitterPose(f.emitter)};
 return r;
}
export const fireUnitRecordDomain={type:FIRE_UNIT_TYPE,source:FIRE_UNIT_SOURCE,check:checkedFireUnitRecord,
 fields:r=>({fireUnit:copy(r.fireUnit)}),reloadable:r=>{checkedFireUnitRecord(r);return true;},load:(r,loaders,options)=>loaders.fireUnit(r,options),
 capture:entry=>({fireUnit:copy(entry.object.userData.fireUnitOwner?.capture()??entry.fireUnit)})};
