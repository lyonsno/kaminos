// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {prepareStoneFromGlb} from '../structural-material-stone-prepare.mjs';

const original=fs.readFileSync(new URL('../assets/arch-stones/03-bedded-stone-500-normal.glb',import.meta.url));
function withoutTangents({degenerateUvs=false}={}){
 const bytes=Buffer.from(original),length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+length));
 const primitive=gltf.meshes[0].primitives[0];delete primitive.attributes.TANGENT;
 if(degenerateUvs){const accessor=gltf.accessors[primitive.attributes.TEXCOORD_0],view=gltf.bufferViews[accessor.bufferView],start=28+length+(view.byteOffset??0)+(accessor.byteOffset??0);bytes.fill(0,start,start+accessor.count*8);}
 const json=Buffer.from(JSON.stringify(gltf));assert(json.length<=length);bytes.fill(32,20,20+length);json.copy(bytes,20);return bytes;
}
const options={size:[2.4,.6,.6],cellSize:4};
test('an admitted textured solid without a tangent binding retains its geometry and UVs',()=>{
 const baseline=prepareStoneFromGlb(original,options),actual=prepareStoneFromGlb(withoutTangents(),options);
 assert.equal(actual.sourceTriangles,baseline.sourceTriangles);assert.equal(actual.volume,baseline.volume);
 const a=actual.cells[0].geometry,b=baseline.cells[0].geometry;assert.deepEqual(a.indices,b.indices);
 for(let i=0;i<a.properties.length;i+=12){assert.deepEqual(a.properties.slice(i,i+8),b.properties.slice(i,i+8));assert(a.properties.slice(i+8,i+12).every(Number.isFinite));assert(Math.abs(Math.hypot(...a.properties.slice(i+8,i+11))-1)<1e-5);}
 assert.equal(actual.attributeSources.tangent,'three-computed-with-normal-basis-for-degenerate-uv');
 assert.equal(baseline.attributeSources.tangent,'source');
});
test('degenerate UVs have a finite orthogonal tangent basis rather than dropping material',()=>{
 const actual=prepareStoneFromGlb(withoutTangents({degenerateUvs:true}),options),g=actual.cells[0].geometry;
 assert(actual.volume>0);for(let i=0;i<g.properties.length;i+=12){const n=g.properties.slice(i+3,i+6),t=g.properties.slice(i+8,i+11);assert(Math.abs(Math.hypot(...t)-1)<1e-5);assert(Math.abs(n.reduce((sum,v,k)=>sum+v*t[k],0))<1e-5);}
});
