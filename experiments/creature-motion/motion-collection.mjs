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
 if(!run.solver||![run.solver.rtol,run.solver.atol].every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(run.solver.cfgScale))throw Error('Invalid generation solver settings');
 let t=-Infinity;for(const sample of run.samples){if(checkPartial(sample)!==run.skeletonKey||sample.refinement.t<=t)throw Error('Generation sample identity/order differs');t=sample.refinement.t;}
 return run;
}
function reconcileGeneration(old,next){
 if(!old)return next;
 for(const k of ['skeletonKey','prompt','seed','solver'])if(motionText(old[k])!==motionText(next[k]))throw Error('Generation history identity conflict');
 for(let i=0;i<Math.min(old.samples.length,next.samples.length);i++)if(motionText(old.samples[i])!==motionText(next.samples[i]))throw Error('Generation history prefix conflict');
 // An imported snapshot never takes ownership of a live local generation.
 if(old.status==='running'){
  if(next.samples.length>old.samples.length)throw Error('Generation history conflicts with live run');return old;
 }
 if(next.samples.length<old.samples.length)return old;
 if(['completed','stopped','failed'].includes(old.status)&&next.status!==old.status&&next.status!=='interrupted')throw Error('Generation history terminal conflict');
 if(next.samples.length===old.samples.length&&next.status==='interrupted')return old;
 return next;
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
  async import(value){if(value?.schema!=='kaminos.skeleton-motion-collection.v1'||!Array.isArray(value.motions))throw Error('Invalid motion collection');const prepared=await Promise.all(value.motions.map(r=>prepare(r.motion,r.id)));const staged=new Map(histories);for(const r of value.generations??[]){const run=checkGeneration(JSON.parse(motionText(r)));if(run.status==='running')run.status='interrupted';staged.set(run.id,reconcileGeneration(staged.get(run.id),run));}for(const row of prepared)if(!rows.has(row.id))rows.set(row.id,row);for(const [id,run]of staged)histories.set(id,run);emit();},
 };
}
// Page-session ownership: closing an inspector/experiment never discards takes.
export const sessionMotions=createMotionCollection();

// Group only identical prompt text on the same verified skeleton. Legacy archives
// lacked a result link: matching settings alone is insufficient, so match final geometry.
export function groupMotionTakes(rows,histories){
 const groups=new Map(),claimed=new Set();
 const group=(key,prompt)=>{prompt=prompt?.trim();const id=JSON.stringify([key,prompt]);if(!groups.has(id))groups.set(id,{id,prompt,takes:[]});return groups.get(id);};
 const matches=(h,r)=>{const m=r.motion,last=h.samples.at(-1),solver=m.consumerReport?.solver;
  return h.status==='completed'&&h.skeletonKey===r.skeletonKey&&h.prompt?.trim()===m.prompt?.trim()&&h.seed===m.seed&&last?.refinement.t===1&&
   ['rtol','atol','cfgScale'].every(k=>solver?.[k]===h.solver[k])&&['positions','localRotations'].every(k=>last[k]?.length===m[k]?.length&&last[k].every((v,i)=>v===m[k][i]));};
 for(const row of rows){const history=histories.find(h=>!claimed.has(h.id)&&matches(h,row));if(history)claimed.add(history.id);group(row.skeletonKey,row.motion.prompt).takes.push({...row,history});}
 for(const history of histories)if(history.status!=='running'&&!claimed.has(history.id))group(history.skeletonKey,history.prompt).takes.push({id:history.id,history,motion:history.samples.at(-1)??null});
 return [...groups.values()];
}
