import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Quaternion,Vector3} from 'three';
const api=await import('../structural-material-component-transport.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
assert.ok(api?.bindComponentTransport&&api?.applyComponentTransport,'Repeated cuts need a non-extrapolative, component-owned surface transport');
const rest=[[0,0,0],[1,0,0],[0,1,0],[0,0,1]],vertices=[[.2,.3,.4],[2,2,2]],components=[0,0,0,0],volumes=[1,2,3,4];
const binding=api.bindComponentTransport(rest,vertices,{components,component:0,volumes,radius:.1});
const compare=(a,b)=>a.forEach((p,i)=>p.forEach((v,k)=>assert.ok(Math.abs(v-b[i][k])<1e-9)));
compare(api.applyComponentTransport(binding,rest,{components}),vertices);
for(const angle of [0,.4,Math.PI]){const q=new Quaternion().setFromAxisAngle(new Vector3(1,2,3).normalize(),angle),transform=p=>new Vector3(...p).applyQuaternion(q).add(new Vector3(2,3,4)).toArray();compare(api.applyComponentTransport(binding,rest.map(transform),{components}),vertices.map(transform));}
assert.ok(binding.entries.every(e=>e.weights.every(w=>w>0)&&Math.abs(e.weights.reduce((a,b)=>a+b,0)-1)<1e-12));
const current=rest.map((p,i)=>p.map((x,k)=>x+(i===0&&k===1?.2:0))),deformed=api.applyComponentTransport(binding,current,{components});
for(let i=0;i<vertices.length;i++){const center=[0,0,0];binding.entries[i].ids.forEach((id,j)=>current[id].forEach((x,k)=>center[k]+=x*binding.entries[i].weights[j]));assert.ok(Math.abs(Math.hypot(...deformed[i].map((x,k)=>x-center[k]))-Math.hypot(...binding.entries[i].offset))<1e-10,'Rest offset is rotated, never affine-extrapolated');}
assert.throws(()=>api.applyComponentTransport(binding,current,{components:[1,0,0,0]}),/component/);
const malformed=structuredClone(binding);malformed.entries[0].weights[0]=-1;assert.throws(()=>api.applyComponentTransport(malformed,current,{components}),/positive/i);
const wrongOffset=structuredClone(binding);wrongOffset.entries[0].offset[0]+=100;assert.throws(()=>api.applyComponentTransport(wrongOffset,current,{components}),/rest offset/);
const partial=structuredClone(binding);partial.frame.ids.pop();partial.frame.rest.pop();partial.frame.weights.pop();const sum=partial.frame.weights.reduce((a,b)=>a+b,0);partial.frame.weights=partial.frame.weights.map(x=>x/sum);assert.throws(()=>api.applyComponentTransport(partial,current,{components}),/complete/i);
if(process.argv[2]){
 const w=JSON.parse(fs.readFileSync(process.argv[2])),n=w.state.model.points,r=Array.from({length:n},(_,i)=>w.state.state.slice(i*16,i*16+3)),c=Array.from({length:n},(_,i)=>w.state.state.slice(i*16+4,i*16+7)),labels=Array(n),v=Array.from({length:n},(_,i)=>w.state.state[i*16+3]);for(const p of w.pieces)for(const i of p.nodes)labels[i]=p.component;
 let prior=0,transport=0;for(const p of w.pieces){const pts=p.binding.entries.map(e=>e.point),b=api.bindComponentTransport(r,pts,{components:labels,component:p.component,volumes:v,radius:.45}),m=api.applyComponentTransport(b,c,{components:labels});for(let i=0;i<p.geometry.indices.length;i++){const id=p.geometry.indices[i];prior=Math.max(prior,Math.hypot(...p.renderedPositions.slice(i*3,i*3+3).map((x,k)=>x-pts[id][k])));transport=Math.max(transport,Math.hypot(...m[id].map((x,k)=>x-pts[id][k])));}}
 assert.ok(prior>1,'Observed replay fixture must expose the disputed surface amplification');assert.ok(transport<prior,'Same physical state must no longer receive the prior exaggerated surface motion');console.log(JSON.stringify({observedFile:process.argv[2],priorSurfaceTravel:prior,transportSurfaceTravel:transport,claim:'Same observed GPU state, different explicit surface approximation; no mechanics repair claimed'}));
}
console.log('Component transport preserves rest/rigid motion, positive support, ownership, and the rotated-offset bound');
