import {rawFieldSource} from './trellis-raw-training-source.mjs';
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
export async function loadRawFieldBundle(manifestBytes,read){
 const meta=JSON.parse(new TextDecoder().decode(manifestBytes));
 if(meta.schema!=='trellis-raw-region.v1'||meta.ok!==true||meta.stride!==12||!Number.isSafeInteger(meta.count)||meta.count<1)throw Error('Completed raw region manifest required');
 const files=[['surfels.f32',meta.dataSHA256,Float32Array,meta.count*12],['triangles.u32',meta.triangles?.sha256,Uint32Array,meta.triangles?.count*3],['source-triangle-ids.u32',meta.sourceTriangleIds?.sha256,Uint32Array,meta.triangles?.count],['source-vertex-ids.u32',meta.sourceVertexIds?.sha256,Uint32Array,meta.count]];
 const arrays=[];
 for(const [name,sha,Type,count]of files){const b=await read(name);if(!/^[a-f0-9]{64}$/.test(sha??'')||b.byteLength!==count*4||await digest(b)!==sha)throw Error('Raw region bytes or hash mismatch: '+name);arrays.push(new Type(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)));}
 return rawFieldSource(arrays[0],arrays[1],{...meta,originalTriangleIds:arrays[2],originalVertexIds:arrays[3]});
}
