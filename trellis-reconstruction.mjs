// Lossless raw reconstruction in a normal, viewable geometry GLB. Learned
// material samples are retained as binary extras; the fallback view is neutral.
import {encodeTrellisGeometryGLB} from './models/trellis2/trellis-mesh.js';
const SCHEMA='kaminos.trellis-reconstruction.v1';
export function encodeTrellisReconstruction(levelInputs,{provenance={}}={}){
 const {decode,materialFields:m}=levelInputs??{};
 if(!(m?.features instanceof Float32Array)||!(m.coordinates instanceof Int32Array)||m.coordinates.length%3||m.features.length!==m.coordinates.length*2||!m.features.every(Number.isFinite)||!Number.isSafeInteger(m.resolution)||m.resolution<1)throw Error('complete raw material fields required');
 const base=encodeTrellisGeometryGLB(decode,{provenance}),header=new DataView(base),jl=header.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(base,20,jl))),old=new Uint8Array(base,28+jl);
 let length=old.byteLength;const extra=[];
 const append=t=>{const index=json.bufferViews.length;json.bufferViews.push({buffer:0,byteOffset:length,byteLength:t.byteLength});extra.push(new Uint8Array(t.buffer,t.byteOffset,t.byteLength));length+=t.byteLength;return index;};
 json.extras.trellisReconstruction={schema:SCHEMA,decode:{vertices:0,triangles:1},materialFields:{features:append(m.features),coordinates:append(m.coordinates),resolution:m.resolution}};
 json.buffers[0].byteLength=length;
 const text=new TextEncoder().encode(JSON.stringify(json)),padded=Math.ceil(text.length/4)*4,out=new Uint8Array(28+padded+length),v=new DataView(out.buffer);
 v.setUint32(0,0x46546c67,true);v.setUint32(4,2,true);v.setUint32(8,out.length,true);v.setUint32(12,padded,true);v.setUint32(16,0x4e4f534a,true);out.fill(32,20,20+padded);out.set(text,20);
 v.setUint32(20+padded,length,true);v.setUint32(24+padded,0x004e4942,true);let offset=28+padded;out.set(old,offset);offset+=old.length;for(const bytes of extra){out.set(bytes,offset);offset+=bytes.length;}return out.buffer;
}
export function decodeTrellisReconstruction(glb){
 const h=new DataView(glb);if(h.getUint32(0,true)!==0x46546c67||h.getUint32(4,true)!==2||h.getUint32(8,true)!==glb.byteLength)throw Error('complete reconstruction GLB required');
 const jl=h.getUint32(12,true),json=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,jl))),raw=json.extras?.trellisReconstruction;
 if(raw?.schema!==SCHEMA)throw Error('unsupported reconstruction schema');
 const read=(index,T)=>{const v=json.bufferViews[index],start=28+jl+(v?.byteOffset??0),length=v?.byteLength;
  if(!Number.isSafeInteger(index)||index<0||v?.buffer!==0||!Number.isSafeInteger(v.byteOffset??0)||(v.byteOffset??0)<0||!Number.isSafeInteger(length)||length<0||length%4||start+length>glb.byteLength)throw Error('invalid reconstruction buffer view');return new T(glb.slice(start,start+length));};
 const levelInputs={decode:{vertices:read(raw.decode.vertices,Float32Array),triangles:read(raw.decode.triangles,Uint32Array)},materialFields:{features:read(raw.materialFields.features,Float32Array),coordinates:read(raw.materialFields.coordinates,Int32Array),resolution:raw.materialFields.resolution}};
 return {levelInputs,provenance:json.extras.trellis.provenance};
}
