const hashPattern=/^[a-f0-9]{64}$/;
const source=value=>{if(!value||typeof value.url!=='string'||! /^(\/api\/|https?:\/\/)/.test(value.url)||!hashPattern.test(value.sha256??''))throw Error('Retained trajectory source URL and digest required');return structuredClone(value);};
export function readAppearanceTrajectory(raw){
 if(raw?.schema!=='kaminos.neural-appearance.trajectory.v1'||!['complete','checkpoints-only'].includes(raw.status)||raw.response!=='projected-bsdf')throw Error('Complete projected-response trajectory required');
 if(!raw.fit||typeof raw.fit.job!=='string'||!raw.fit.job.trim()||! /^[a-f0-9]{40}$/.test(raw.fit.sourceCommit??'')||!hashPattern.test(raw.fit.reportHash??''))throw Error('Training trajectory provenance requires job, source commit and report digest');
 if(!Number.isSafeInteger(raw.width)||!Number.isSafeInteger(raw.height)||raw.width<1||raw.height<1)throw Error('Valid response slice dimensions required');
 if(!Array.isArray(raw.views)||!raw.views.length||!Array.isArray(raw.checkpoints)||!raw.checkpoints.length)throw Error('Retained views and checkpoints required');
 const ids=new Set();for(const v of raw.views){if(typeof v.id!=='string'||ids.has(v.id))throw Error('Unique response view identity required');ids.add(v.id);if(raw.status==='complete')source(v.reference);for(const d of [v.view,v.light])if(!Array.isArray(d)||d.length!==3||!d.every(Number.isFinite)||Math.abs(Math.hypot(...d)-1)>1e-5)throw Error('Unit response view/light directions required');}
 let previous=-1;for(const c of raw.checkpoints){if(!Number.isSafeInteger(c.step)||c.step<=previous||!Number.isFinite(c.heldoutLogL1)||c.heldoutLogL1<0)throw Error('Ordered checkpoints and finite heldout errors required');previous=c.step;source(c.source);if(raw.status==='complete')for(const id of ids)source(c.slices?.[id]);}
 return structuredClone(raw);
}
export async function loadResponseSlice(entry,width,height,{fetcher=fetch}={}){
 source(entry);const response=await fetcher(entry.url);if(!response.ok)throw Error(`Response slice HTTP ${response.status}`);
 const bytes=await response.arrayBuffer();if(bytes.byteLength!==width*height*3*4)throw Error('Response slice byte count mismatch');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');if(hash!==entry.sha256)throw Error('Response slice digest mismatch');
 const view=new DataView(bytes),out=new Float32Array(bytes.byteLength/4);for(let i=0;i<out.length;i++){out[i]=view.getFloat32(i*4,true);if(!Number.isFinite(out[i])||out[i]<0)throw Error('Response slice requires finite nonnegative values');}return out;
}
// The identical exposure/display map applies to every retained response slice.
export function responseDisplayPixels(values,exposure=4){
 if(!Number.isFinite(exposure)||exposure<=0)throw Error('Display exposure must be positive');
 const out=new Uint8ClampedArray(values.length/3*4);for(let i=0;i<values.length;i++){const x=1-Math.exp(-Math.max(0,values[i])*exposure),s=x<=.0031308?12.92*x:1.055*x**(1/2.4)-.055;out[Math.floor(i/3)*4+i%3]=Math.round(s*255);if(i%3===2)out[Math.floor(i/3)*4+3]=255;}return out;
}
export function assertTrajectoryContinuation(previous,next){
 readAppearanceTrajectory(previous);readAppearanceTrajectory(next);
 const conflict=label=>{throw Error('Trajectory refresh conflict: '+label+' changed');};
 for(const key of ['job','sourceCommit','reportHash'])if(previous.fit[key]!==next.fit[key])conflict('fit '+key);
 for(const key of ['width','height','response'])if(previous[key]!==next[key])conflict(key);
 if(previous.status==='complete'&&next.status!=='complete')conflict('completed response status');
 for(const view of previous.views){const value=next.views.find(x=>x.id===view.id);if(!value||JSON.stringify(view.view)!==JSON.stringify(value.view)||JSON.stringify(view.light)!==JSON.stringify(value.light))conflict('reference view '+view.id);if(view.reference&&view.reference.sha256!==value.reference?.sha256)conflict('reference response '+view.id);}
 for(const c of previous.checkpoints){const value=next.checkpoints.find(x=>x.step===c.step);if(!value||c.source.sha256!==value.source.sha256||c.heldoutLogL1!==value.heldoutLogL1)conflict('checkpoint '+c.step);for(const [id,field] of Object.entries(c.slices??{}))if(field.sha256!==value.slices?.[id]?.sha256)conflict('checkpoint response '+c.step+'/'+id);}
 return next;
}
export function trajectorySceneState(run,recipes){
 if(!recipes.length)return {state:'external',step:null};
 const hashes=recipes.map(r=>r.parameters?.source?.sha256),unique=new Set(hashes);
 if(unique.size!==1)return {state:'mixed',step:null};
 const checkpoint=run.checkpoints.find(c=>c.source.sha256===hashes[0]);return checkpoint?{state:'matched',step:checkpoint.step}:{state:'external',step:null};
}
export function assertNativeRGB(rgb){
 if(!(Array.isArray(rgb)||ArrayBuffer.isView(rgb))||rgb.length!==3||!Array.from(rgb).every(Number.isFinite))throw Error('Native RGB readback must contain three finite channels');return rgb;
}
