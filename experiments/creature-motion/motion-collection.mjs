import {validateGivenMotionSource} from './given-motion-source.mjs';
export const motionText=value=>JSON.stringify(value,(_key,v)=>ArrayBuffer.isView(v)?Array.from(v):v);
export const motionDigest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export function skeletonMotionKey(motion){
 if(!/^[a-f0-9]{64}$/i.test(motion.assetCondSha256??''))throw Error('Motion needs verified conditioning identity');
 return JSON.stringify([motion.assetCondSha256,motion.skeleton.jointNames,motion.skeleton.parents]);
}
export function checkMotion(m){
 validateGivenMotionSource({motion:m});
 if(!Number.isInteger(m.frames)||m.frames<1||!Number.isInteger(m.joints)||m.joints<1||!Number.isFinite(m.skeleton?.fps)||m.skeleton.fps<=0||m.skeleton.jointNames?.length!==m.joints||m.skeleton.parents?.length!==m.joints)throw Error('Incomplete motion skeleton or frames');
 if(new Set(m.skeleton.jointNames).size!==m.joints||m.skeleton.parents.some((p,i)=>!Number.isInteger(p)||p< -1||p>=i))throw Error('Invalid motion hierarchy');
 for(const [key,width] of [['positions',3],['localRotations',4]])if(m[key]?.length!==m.frames*m.joints*width||!m[key].every(Number.isFinite))throw Error('Incomplete motion '+key);
 return skeletonMotionKey(m);
}
export function createMotionCollection(){
 const rows=new Map(),listeners=new Set();
 const emit=()=>listeners.forEach(fn=>fn());
 async function prepare(motion,expected){const text=motionText(motion),copy=JSON.parse(text),skeletonKey=checkMotion(copy),id=await motionDigest(text);if(expected&&id!==expected)throw Error('Motion collection digest mismatch');return {id,skeletonKey,motion:copy,text,bytes:new TextEncoder().encode(text).byteLength};}
 return {
  async add(motion){const row=await prepare(motion);if(!rows.has(row.id)){rows.set(row.id,row);emit();}return rows.get(row.id);},
  get:id=>rows.get(id),list:key=>[...rows.values()].filter(r=>!key||r.skeletonKey===key),
  read:()=>({count:rows.size,bytes:[...rows.values()].reduce((n,r)=>n+r.bytes,0)}),
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  export:()=>({schema:'kaminos.skeleton-motion-collection.v1',motions:[...rows.values()].map(({id,motion})=>({id,motion}))}),
  async import(value){if(value?.schema!=='kaminos.skeleton-motion-collection.v1'||!Array.isArray(value.motions))throw Error('Invalid motion collection');const prepared=await Promise.all(value.motions.map(r=>prepare(r.motion,r.id)));for(const row of prepared)if(!rows.has(row.id))rows.set(row.id,row);emit();},
 };
}
// Page-session ownership: closing an inspector/experiment never discards takes.
export const sessionMotions=createMotionCollection();
