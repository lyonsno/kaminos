import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {surfaceReceiverLayout,interpolateReceiverValues,validateReceiverSpacing} from '../scene-surface-receivers.mjs';
function grid(n=16,z=0){const vertices=[],triangles=[];
 for(let y=0;y<=n;y++)for(let x=0;x<=n;x++)vertices.push({position:[x/n,y/n,z],normal:[0,0,1],twoSided:true});
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const a=x+(n+1)*y,b=a+1,c=a+n+1,d=c+1;triangles.push(a,b,c,b,d,c);}
 return {vertices,triangles};}
const f=grid();
// Operator-facing coarse choices extend to five times the original .16 ceiling.
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const spacingSelect=html.match(/<select\b[^>]*id="rendering-receiver-spacing"[^>]*>([\s\S]*?)<\/select>/)?.[1];
assert(spacingSelect,'receiver spacing control exists');
const options=[...spacingSelect.matchAll(/<option\b([^>]*)value="([^"]+)"([^>]*)>/g)];
for(const value of [.32,.48,.64,.8])assert(options.some(o=>Number(o[2])===value),`receiver spacing ${value} is selectable`);
assert.equal(Number(options.find(o=>/\bselected\b/.test(o[1]+o[3]))?.[2]),0,'per-vertex default stays unchanged');
for(const spacing of [.32,.48,.64,.8]){
 const layout=surfaceReceiverLayout(f.vertices,f.triangles,{spacing});
 assert.equal(layout.metadata.spacing,spacing,'coarse request is not clamped');
 assert(layout.receivers.length<f.vertices.length);
 const field=interpolateReceiverValues(layout,new Float32Array(layout.receivers.length*4).fill(3));
 assert(field.every(x=>Math.abs(x-3)<1e-6),'extended coarse choices preserve a constant field');
}
const dense=surfaceReceiverLayout(f.vertices,f.triangles);
assert.equal(dense.receivers.length,f.vertices.length);
assert.deepEqual([...dense.triangles],f.triangles);
const low=surfaceReceiverLayout(f.vertices,f.triangles,{spacing:.25});
assert(low.receivers.length<f.vertices.length/2,'coarse receiver spacing must actually reduce ray receivers, not only label the request');
assert.equal(low.metadata.spacing,.25);
for(const r of low.receivers)assert(f.vertices.includes(r),'samples remain on actual authored input vertices');
for(let i=0;i<f.vertices.length;i++){
 const weights=[...low.weights.subarray(i*4,i*4+4)];assert(weights.every(w=>w>=0&&Number.isFinite(w)));assert(Math.abs(weights.reduce((a,b)=>a+b,0)-1)<1e-6);
 for(let j=0;j<4;j++)assert(low.indices[i*4+j]>=0&&low.indices[i*4+j]<low.receivers.length);
}
const constant=interpolateReceiverValues(low,new Float32Array(low.receivers.length*4).fill(3));
assert(constant.every(x=>Math.abs(x-3)<1e-6),'reconstruction preserves a constant current field');
// Nearby disconnected sheets must not share a lighting receiver/stencil.
const a=grid(2,0),b=grid(2,.001),offset=a.vertices.length;
const separate=surfaceReceiverLayout([...a.vertices,...b.vertices],[...a.triangles,...b.triangles.map(x=>x+offset)],{spacing:1});
const first=new Set([...separate.indices.subarray(0,offset*4)]);
for(let i=offset;i<a.vertices.length+b.vertices.length;i++)for(let j=0;j<4;j++)if(separate.weights[i*4+j])assert(!first.has(separate.indices[i*4+j]),'disconnected sheets do not exchange incident fields');
// Materials and opposing normals retain distinct receiving populations.
const opposite=surfaceReceiverLayout([...a.vertices,...a.vertices.map(v=>({...v,normal:[0,0,-1]}))],[...a.triangles,...a.triangles.map(x=>x+offset)],{spacing:1});
for(let i=0;i<opposite.weights.length/4;i++)for(let j=0;j<4;j++)if(opposite.weights[i*4+j])assert.equal(opposite.receivers[opposite.indices[i*4+j]].normal[2],i<offset?1:-1);
const regions=surfaceReceiverLayout(f.vertices,f.triangles,{spacing:.25,regions:f.vertices.map(v=>v.position[0]<.5?'left':'right')});
for(let i=0;i<f.vertices.length;i++)for(let j=0;j<4;j++)if(regions.weights[i*4+j])assert.equal(regions.receivers[regions.indices[i*4+j]].position[0]<.5,f.vertices[i].position[0]<.5);
assert.throws(()=>validateReceiverSpacing(-1),/finite and nonnegative/);assert.throws(()=>validateReceiverSpacing(NaN),/finite and nonnegative/);
console.log('surface-local receiver reduction, valid origins, convex reconstruction and boundary contracts passed');
