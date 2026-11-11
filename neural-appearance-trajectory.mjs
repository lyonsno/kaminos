const hashPattern=/^[a-f0-9]{64}$/;
const source=value=>{if(!value||typeof value.url!=='string'||! /^(\/api\/|https?:\/\/)/.test(value.url)||!hashPattern.test(value.sha256??''))throw Error('Retained trajectory source URL and digest required');return structuredClone(value);};
export function readAppearanceTrajectory(raw){
 if(raw?.schema!=='kaminos.neural-appearance.trajectory.v1'||raw.status!=='complete'||raw.response!=='projected-bsdf')throw Error('Complete projected-response trajectory required');
 if(!Number.isSafeInteger(raw.width)||!Number.isSafeInteger(raw.height)||raw.width<1||raw.height<1)throw Error('Valid response slice dimensions required');
 if(!Array.isArray(raw.views)||!raw.views.length||!Array.isArray(raw.checkpoints)||!raw.checkpoints.length)throw Error('Retained views and checkpoints required');
 const ids=new Set();for(const v of raw.views){if(typeof v.id!=='string'||ids.has(v.id))throw Error('Unique response view identity required');ids.add(v.id);source(v.reference);for(const d of [v.view,v.light])if(!Array.isArray(d)||d.length!==3||!d.every(Number.isFinite)||Math.abs(Math.hypot(...d)-1)>1e-5)throw Error('Unit response view/light directions required');}
 let previous=-1;for(const c of raw.checkpoints){if(!Number.isSafeInteger(c.step)||c.step<=previous||!Number.isFinite(c.heldoutLogL1)||c.heldoutLogL1<0)throw Error('Ordered checkpoints and finite heldout errors required');previous=c.step;source(c.source);for(const id of ids)source(c.slices?.[id]);}
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
