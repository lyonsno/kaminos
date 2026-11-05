// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {MeshBVH} from 'three-mesh-bvh';
import {encodeTrellisPbrGLB} from '../models/trellis2/trellis-material.js';
import {digestBytes,geometrySignature,publishTextureVariants,buildTextureVariants} from '../lod-textures.mjs';
import {prepareMeshTextureLevels} from '../lod-texture-generation.mjs';
const mesh={vertices:new Float32Array([0,0,0,1,0,0,0,1,0]),triangles:new Uint32Array([0,1,2]),uvs:new Float32Array([0,0,1,0,0,1])};
async function asset(size){return encodeTrellisPbrGLB(mesh,{textures:{width:size,height:size,alphaMode:'OPAQUE',baseColor:new Uint8Array(size*size*4).fill(255),metallicRoughness:new Uint8Array(size*size*4).fill(127)}});}
const response=(body,ok=true)=>({ok,json:async()=>body});

test('existing levels gain separately registered texture choices without remeshing or changing their UVs',async()=>{
  const hero=await asset(4),base=await asset(2),source=await digestBytes(hero),geometry=await digestBytes(base),files=new Map([[source,hero],[geometry,base]]);
  const catalog={source,levels:[{sha256:geometry,faces:1,route:'fixture',textureSize:2}],textureSets:{}};
  const fetch=async(url,options={})=>{
    if(url.includes('/api/mesh-lods?'))return response(catalog);
    if(url.includes('/api/read?'))return {ok:true,arrayBuffer:async()=>files.get(new URL(url,'http://local').searchParams.get('path').slice(0,-4))};
    if(url.includes('/api/ingest-mesh')){const sha256=await digestBytes(options.body);files.set(sha256,options.body);return response({sha256});}
    if(url.endsWith('/api/mesh-lod-textures')){const payload=JSON.parse(options.body),textureSet={geometry:payload.geometry,variants:payload.variants};catalog.textureSets[payload.geometry]=textureSet;return response({source,geometry:payload.geometry,textureSet});}
    throw Error('Unexpected route '+url);
  };
  const report=await prepareMeshTextureLevels({source,heroGLB:hero,geometries:[geometry],sizes:[4,2],THREE,MeshBVH,fetch});
  assert.equal(report.status,'complete',report.error?.message);
  assert.equal(report.geometries[0].geometry,geometry);
  assert.deepEqual(report.geometries[0].textureSet.variants.map(v=>v.textureSize),[4,2]);
  for(const v of report.geometries[0].textureSet.variants)assert.equal(await geometrySignature(files.get(v.sha256)),await geometrySignature(base));
  const repeated=await prepareMeshTextureLevels({source,heroGLB:hero,geometries:[geometry],sizes:[4,2],THREE,MeshBVH,fetch});
  assert.equal(repeated.geometries[0].status,'existing');
  const wrong=await prepareMeshTextureLevels({source:'f'.repeat(64),heroGLB:hero,geometries:[geometry],sizes:[4],THREE,MeshBVH,fetch:async()=>response({...catalog,source:'f'.repeat(64)})});
  assert.match(wrong.error.message,/source bytes/);
  assert.equal(wrong.geometries.length,0);
});

test('publication rejects a success response that names different texture content',async()=>{
  const [variant]=await buildTextureVariants({baseGLB:await asset(4),sizes:[2]});
  await assert.rejects(publishTextureVariants({source:'a',geometry:'b',variants:[variant],fetch:async(url)=>url.includes('ingest')?response({sha256:variant.sha256}):response({source:'a',geometry:'b',textureSet:{variants:[{...variant,sha256:'other'}]}})}),/registration failed/);
});
