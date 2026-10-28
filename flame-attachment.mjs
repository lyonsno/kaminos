import {Euler,Matrix4,Quaternion,Vector3} from './lib/three.core.js';
import {checkedPose} from './scene-edit-session.mjs';
import {flamePoseInDomain,normalizeFlameDomainScale} from './scene-flame-emitter.mjs';
const vector=(v,name)=>{if(!Array.isArray(v)||v.length!==3||!v.every(Number.isFinite))throw Error(name+' requires three finite values');return [...v];};
export function checkedFlameAttachment(value){
 if(value==null)return null;
 if(value.schema!=='kaminos.flame-attachment.v1'||typeof value.enabled!=='boolean')throw Error('Invalid flame attachment');
 const r=structuredClone(value);r.centre=vector(r.centre,'Attachment centre');r.rotation=vector(r.rotation,'Attachment rotation');
 const radius=r.radius;
 if(!radius||Object.hasOwn(radius,'value')===Object.hasOwn(radius,'output')||('value' in radius?!(Number.isFinite(radius.value)&&radius.value>=0):!(typeof radius.output==='string'&&radius.output.trim()&&Number.isFinite(radius.factor)&&radius.factor>=0)))throw Error('Invalid attachment radius');
 for(const [key,max]of [['feed',1],['fuel',1],['heat',2]])if(!Number.isFinite(r[key])||r[key]<0||r[key]>max)throw Error('Invalid attachment '+key);
 if(r.flow!=='speed')throw Error('Unsupported attachment flow invariant');
 return r;
}
export const defaultFlameAttachment=()=>({schema:'kaminos.flame-attachment.v1',enabled:true,centre:[0,0,0],rotation:[0,0,0],radius:{value:.2},feed:.18,fuel:.7,heat:2,flow:'speed'});
const control=(id,value)=>({id,type:typeof value==='string'?'select-one':'range',value,rawValue:String(value)});
export function compileFlameAttachment(record,outputs={}){
 const r=checkedFlameAttachment(record.flameAttachment);if(!r)throw Error('Object has no flame attachment');
 const pose=checkedPose(record.transform),s=pose.scale[0];
 if(!(s>0)||pose.scale.some(v=>Math.abs(v-s)>1e-10*s))throw Error('Flame attachment requires positive uniform object scale');
 const radius=Object.hasOwn(r.radius,'value')?r.radius.value:outputs[r.radius.output]*r.radius.factor;
 if(!Number.isFinite(radius)||radius<0)throw Error('Unavailable aperture output '+r.radius.output);
 const q=new Quaternion().setFromEuler(new Euler(...pose.rotation)),matrix=new Matrix4().compose(new Vector3(...pose.position),q,new Vector3(...pose.scale));
 q.multiply(new Quaternion().setFromEuler(new Euler(...r.rotation)));
 const values={'volume-emitter-source-law':'immersed-source','volume-emitter-aperture-pattern':'shape','volume-immersed-radius':radius,'volume-immersed-speed':r.feed,'volume-immersed-fuel':r.fuel,'volume-immersed-temperature':r.heat,'volume-immersed-back-wall':0};
 return {id:record.id,type:'flame-emitter',source:'kaminos:analytic-flame',transform:{position:new Vector3(...r.centre).applyMatrix4(matrix).toArray(),rotation:new Euler().setFromQuaternion(q).toArray().slice(0,3),scale:[s,s,s]},emissionEnabled:r.enabled&&radius>0,emission:{domainId:'flame-field',settings:Object.fromEntries(Object.entries(values).map(([id,value])=>[id,control(id,value)]))}};
}
export function attachmentSupport(source,{translation,scale,controls}){
 scale=normalizeFlameDomainScale(scale);
 const requestedRadius=source.emission.settings['volume-immersed-radius'].value*source.transform.scale[0],domainRadius=requestedRadius/scale;
 return {inside:flamePoseInDomain(source.transform,translation,scale,controls),requestedRadius,effectiveRadius:Math.max(.02,domainRadius)*scale,footprintFloor:domainRadius>0&&domainRadius<.02,diameterCells:domainRadius*Number(controls.resolution??64),enabled:source.emissionEnabled};
}
export function createFlameAttachmentEditor({edits,read,check,write}){
 const targets=new Set();
 function target(id){const key='@flame-attachment:'+id;if(!targets.has(key)){
  edits.register(key,{allowMissing:true,read:()=>({attachment:checkedFlameAttachment(read(id))}),
   check:value=>{const attachment=checkedFlameAttachment(value.attachment);check(id,attachment);return {attachment};},
   write:value=>{const before=checkedFlameAttachment(read(id));check(id,value.attachment);try{write(id,value.attachment);}catch(error){write(id,before);throw error;}}});targets.add(key);
 }return key;}
 function set(id,value){const attachment=checkedFlameAttachment(value);check(id,attachment);const key=target(id);try{return edits.apply(key,{attachment},'Set flame attachment');}catch(error){if(edits.state().active?.id===key)edits.cancel();throw error;}}
 return {target,set};
}
