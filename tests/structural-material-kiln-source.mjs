// kaminos-test: node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {prepareStoneFromGlb} from '../structural-material-stone-prepare.mjs';
import {readArchGlbTriangles} from '../structural-material-arch-profile.mjs';
import {createHash} from 'node:crypto';

const original=fs.readFileSync(new URL('../assets/arch-stones/03-bedded-stone-500-normal.glb',import.meta.url));
function withoutTangents({degenerateUvs=false}={}){
 const bytes=Buffer.from(original),length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.toString('utf8',20,20+length));
 const primitive=gltf.meshes[0].primitives[0];delete primitive.attributes.TANGENT;
 if(degenerateUvs){const accessor=gltf.accessors[primitive.attributes.TEXCOORD_0],view=gltf.bufferViews[accessor.bufferView],start=28+length+(view.byteOffset??0)+(accessor.byteOffset??0);bytes.fill(0,start,start+accessor.count*8);}
 const json=Buffer.from(JSON.stringify(gltf));assert(json.length<=length);bytes.fill(32,20,20+length);json.copy(bytes,20);return bytes;
}
const options={size:[2.4,.6,.6],cellSize:4};
const rotation=[1,0,0,0,0,0,-1,0,0,1,0,0,0,0,0,1];
function withNode(node){
 const length=original.readUInt32LE(12),gltf=JSON.parse(original.toString('utf8',20,20+length));
 gltf.nodes=[{mesh:0,...node}];gltf.scenes=[{nodes:[0]}];gltf.scene=0;
 const json=Buffer.from(JSON.stringify(gltf)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,32);json.copy(padded);
 const binary=original.subarray(20+length),header=Buffer.from(original.subarray(0,20));
 header.writeUInt32LE(20+padded.length+binary.length,8);header.writeUInt32LE(padded.length,12);
 return Buffer.concat([header,padded,binary]);
}
test('single rigid mesh-node rotation is baked before Stone normalization, preserving source identity',()=>{
 const bytes=withNode({matrix:rotation});
 assert.throws(()=>readArchGlbTriangles(bytes),/does not admit node transforms/);
 const baseline=prepareStoneFromGlb(original,{size:[2.4,.6,.9],cellSize:4});
 const actual=prepareStoneFromGlb(bytes,{size:[2.4,.9,.6],cellSize:4});
 assert.equal(actual.sourceSha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(actual.mechanicalPreparation.sourceNodeMatrix,rotation);
 assert(Math.abs(actual.volume-baseline.volume)<1e-6);
 const a=actual.cells[0].geometry,b=baseline.cells[0].geometry;
 assert.equal(a.indices.length,b.indices.length);
 assert.equal(a.properties.length,b.properties.length);
 const rows=Array.from({length:a.properties.length/12},(_,i)=>a.properties.slice(i*12,i*12+12));
 for(let i=0;i<b.properties.length;i+=12){
  const p=b.properties.slice(i,i+12),expected=[p[0],p[2],-p[1],p[3],p[5],-p[4],p[6],p[7],p[8],p[10],-p[9],p[11]];
  assert(rows.some(row=>expected.every((v,k)=>Math.abs(row[k]-v)<1e-5)),`transformed material vertex ${i/12}`);
 }
});
test('Stone rigid-node admission rejects non-rigid and ambiguous node transforms',()=>{
 const scaled=[...rotation];scaled[0]=2;
 assert.throws(()=>prepareStoneFromGlb(withNode({matrix:scaled}),options),/rigid/);
 const reflected=[...rotation];reflected[0]=-1;
 assert.throws(()=>prepareStoneFromGlb(withNode({matrix:reflected}),options),/rigid/);
 assert.throws(()=>prepareStoneFromGlb(withNode({matrix:rotation,children:[0]}),options),/single root/);
});
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
