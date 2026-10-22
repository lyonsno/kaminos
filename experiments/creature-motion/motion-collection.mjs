import {validateGivenMotionSource} from './given-motion-source.mjs';
export const motionText=value=>JSON.stringify(value,(_key,v)=>ArrayBuffer.isView(v)?Array.from(v):v);
export const motionDigest=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
export function skeletonMotionKey(motion){
 if(!/^[a-f0-9]{64}$/i.test(motion.assetCondSha256??''))throw Error('Motion needs verified conditioning identity');
 return JSON.stringify([motion.assetCondSha256,motion.skeleton.jointNames,motion.skeleton.parents]);
}
function checkGeometry(m){
 if(!Number.isInteger(m.frames)||m.frames<1||!Number.isInteger(m.joints)||m.joints<1||!Number.isFinite(m.skeleton?.fps)||m.skeleton.fps<=0||m.skeleton.jointNames?.length!==m.joints||m.skeleton.parents?.length!==m.joints)throw Error('Incomplete motion skeleton or frames');
 if(new Set(m.skeleton.jointNames).size!==m.joints||m.skeleton.parents.some((p,i)=>!Number.isInteger(p)||p< -1||p>=i))throw Error('Invalid motion hierarchy');
 for(const [key,width] of [['positions',3],['localRotations',4]])if(m[key]?.length!==m.frames*m.joints*width||!m[key].every(Number.isFinite))throw Error('Incomplete motion '+key);
 return skeletonMotionKey(m);
}
export function checkMotion(m){validateGivenMotionSource({motion:m});return checkGeometry(m);}
export function checkPartial(m){
 if(m?.status!=='partial'||m.route!=='unimate.text-to-motion.webgpu-local.v0'||m.textEncoder!=='browser T5'||m.cooperative!==true||m.controllerNorm!=='valid-joints')throw Error('Partial motion route is missing or fallback');
 const r=m.refinement;if(!r||!Number.isFinite(r.t)||r.t<0||r.t>1||!Number.isInteger(r.index)||r.index<0||!Number.isInteger(r.evaluations)||r.evaluations<0)throw Error('Invalid refinement sample');
 return checkGeometry(m);
}
function checkGeneration(run){
 if(!run?.id||!['running','completed','stopped','failed','interrupted'].includes(run.status)||!Array.isArray(run.samples))throw Error('Invalid generation history');
 let t=-Infinity;for(const sample of run.samples){if(checkPartial(sample)!==run.skeletonKey||sample.refinement.t<=t)throw Error('Generation sample identity/order differs');t=sample.refinement.t;}
 return run;
}
export function createMotionCollection(){
 const rows=new Map(),histories=new Map(),listeners=new Set();
 const emit=()=>listeners.forEach(fn=>fn());
 async function prepare(motion,expected){const text=motionText(motion),copy=JSON.parse(text),skeletonKey=checkMotion(copy),id=await motionDigest(text);if(expected&&id!==expected)throw Error('Motion collection digest mismatch');return {id,skeletonKey,motion:copy,text,bytes:new TextEncoder().encode(text).byteLength};}
 return {
  beginGeneration(run){if(histories.has(run.id))throw Error('Generation already exists');histories.set(run.id,checkGeneration(structuredClone(run)));emit();},
  appendPartial(id,motion){const run=histories.get(id);if(!run||run.status!=='running')throw Error('Generation is not running');if(checkPartial(motion)!==run.skeletonKey||motion.refinement.t<=(run.samples.at(-1)?.refinement.t??-Infinity))throw Error('Generation sample identity/order differs');const text=motionText(motion);run.samples.push(JSON.parse(text));run.bytes=(run.bytes??0)+new TextEncoder().encode(text).byteLength;emit();},
  finishGeneration(id,status,detail=null){const run=histories.get(id);if(!run||!['completed','stopped','failed'].includes(status))throw Error('Invalid generation terminal state');run.status=status;run.detail=detail;emit();},
  generations:key=>[...histories.values()].filter(r=>!key||r.skeletonKey===key),
  async add(motion){const row=await prepare(motion);if(!rows.has(row.id)){rows.set(row.id,row);emit();}return rows.get(row.id);},
  get:id=>rows.get(id),list:key=>[...rows.values()].filter(r=>!key||r.skeletonKey===key),
  read:()=>({count:rows.size,bytes:[...rows.values()].reduce((n,r)=>n+r.bytes,0)}),
  subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},
  export:()=>({schema:'kaminos.skeleton-motion-collection.v1',motions:[...rows.values()].map(({id,motion})=>({id,motion})),generations:[...histories.values()]}),
  async import(value){if(value?.schema!=='kaminos.skeleton-motion-collection.v1'||!Array.isArray(value.motions))throw Error('Invalid motion collection');const prepared=await Promise.all(value.motions.map(r=>prepare(r.motion,r.id)));const runs=(value.generations??[]).map(r=>checkGeneration(JSON.parse(motionText(r))));for(const row of prepared)if(!rows.has(row.id))rows.set(row.id,row);for(const run of runs)if(!histories.has(run.id)){if(run.status==='running')run.status='interrupted';histories.set(run.id,run);}emit();},
 };
}
// Page-session ownership: closing an inspector/experiment never discards takes.
export const sessionMotions=createMotionCollection();
