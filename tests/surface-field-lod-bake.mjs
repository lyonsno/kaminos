// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {readGLBLocalSurfaceAndMaterials,createGLBMeshMaterialBaker} from '../lod-mesh-bake.mjs';

function fixture({count=4,values=[.2,.3,.2,.3,.2,.3,.2,.3]}={}){
 const arrays=[new Float32Array([-1,0,0,0,0,0,0,1,0,-1,1,0]),new Float32Array([0,0,.5,0,.5,1,0,1]),new Uint32Array([0,1,2,0,2,3]),new Float32Array(values),new Float32Array([0,0,0,1,0,0,1,1,0,0,1,0]),new Float32Array([.5,0,1,0,1,1,.5,1])];
 let n=0;const views=arrays.map(a=>{const view={buffer:0,byteOffset:n,byteLength:a.byteLength};n+=a.byteLength;return view;});
 const doc={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1,_KAMINOS_MATERIAL:3},indices:2,material:0},{attributes:{POSITION:4,TEXCOORD_0:5},indices:2,material:1}]}],materials:[{pbrMetallicRoughness:{metallicFactor:.01,roughnessFactor:.99}},{pbrMetallicRoughness:{metallicFactor:.4,roughnessFactor:.6}}],buffers:[{byteLength:n}],bufferViews:views,accessors:arrays.map((a,i)=>({bufferView:i,componentType:i===2?5125:5126,count:i===2?6:i===3?count:4,type:i===2?'SCALAR':i===0||i===4?'VEC3':'VEC2'}))};
 const json=new TextEncoder().encode(JSON.stringify(doc)),size=(json.length+3)&~3,out=new Uint8Array(28+size+n),v=new DataView(out.buffer);
 for(const [offset,value]of [[0,0x46546c67],[4,2],[8,out.length],[12,size],[16,0x4e4f534a],[20+size,n],[24+size,0x004e4942]])v.setUint32(offset,value,true);
 out.fill(32,20,20+size);out.set(json,20);for(let i=0;i<arrays.length;i++)out.set(new Uint8Array(arrays[i].buffer),28+size+views[i].byteOffset);return out;
}
test('mesh LOD baking preserves spatial PBR fields and the ordinary primitive fallback',async()=>{
 const source=await readGLBLocalSurfaceAndMaterials(fixture());
 const baked=createGLBMeshMaterialBaker(source,{THREE,MeshBVH})({vertices:source.vertices,triangles:source.triangles,uvs:source.uvs,textureSize:8});
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const i=4*(y*8+x),expected=x<4?[0,77,51,255]:[0,153,102,255];
  assert.deepEqual([...baked.metallicRoughness.slice(i,i+4)],expected,`PBR at ${x},${y}`);
 }
});
test('partial or invalid spatial PBR fields are rejected before baking',async()=>{
 await assert.rejects(readGLBLocalSurfaceAndMaterials(fixture({count:3})),/material field/i);
 for(const value of [NaN,-.1,1.1])await assert.rejects(readGLBLocalSurfaceAndMaterials(fixture({values:[value,.3,.2,.3,.2,.3,.2,.3]})),/material field/i);
});
